// Database tier — a finishes schedule confirmed into the project's library
// (brief C, 2026-10-04).
//
// Skips without DATABASE_URL. Through the app's own routes — the review GET,
// the kind autosave and the confirm — so what is proved is what a person's
// clicks write. The staged JSON is built by `stageFinishSchedule` from
// invented entries; no document is read and nothing is charged.
//
// What it holds:
//   * one confirm is ONE change set, `finish_edit`, naming the document, with
//     the schedule as its source run AND its evidence;
//   * a new code is created, with the kind a person filed and nothing else;
//   * a held code with no description is FILLED, and a field it already had
//     is left exactly as it was (`editFinish` replaces the row);
//   * a conflict and a repeat write nothing and stay for a person;
//   * confirming the same schedule again writes nothing and opens no change.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";
import { RawFinishEntry } from "@/lib/extraction-schema";
import { stageFinishSchedule, type StagedFinishSchedule } from "@/lib/finish-schedule";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { GET as importGet, PATCH as importPatch } from "@/app/api/imports/[id]/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const FILENAME = "__QA finishes tracker.pdf";

const entry = (over: Partial<RawFinishEntry>) => RawFinishEntry.parse({ otherRaw: [], ...over });

const ENTRIES = [
  entry({ codeRaw: "QA TIM 01", kindRaw: "TIMBER", nameRaw: "NATURAL OAK", finishRaw: "Stained", supplierRaw: "Example Joinery", page: 1 }),
  entry({ codeRaw: "QA TIM 02", nameRaw: "SMOKED OAK", supplierRaw: "A different supplier", referenceRaw: "SMP-0002", page: 1 }),
  entry({ codeRaw: "QA STN 01", kindRaw: "STONE", nameRaw: "WHITE MARBLE", page: 2 }),
  entry({ codeRaw: "QA TIM 01", nameRaw: "NATURAL OAK", page: 3 }),
  entry({ codeRaw: null, nameRaw: "Uncoded sample", page: 3 }),
];

describeIfDb("a finishes schedule confirmed into the library", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let attachmentId = "";

  const addFinish = (code: string, fields: { description?: string | null; supplier?: string | null }) =>
    client.query(
      `insert into project_finishes (project_id, code, code_norm, description, supplier_raw, state, status, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'tbc', 'active', 'qa', 'qa') returning id`,
      [projectId, code, normaliseFinishCode(code), fields.description ?? null, fields.supplier ?? null],
    );

  async function stageRun(): Promise<{ runId: string; staged: StagedFinishSchedule }> {
    let n = 0;
    const staged = stageFinishSchedule(ENTRIES, FILENAME, null, () => `qa-entry-${(n += 1)}`);
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, attachment_id, created_by, updated_by)
       values ($1, 'spec_document', 'finishes_schedule', 'parsed', $2::jsonb, $3, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify(staged), attachmentId],
    );
    return { runId: String(run.rows[0].id), staged };
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown) =>
    confirmRoute(
      new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      params(id),
    );

  async function stagedOf(runId: string): Promise<{ status: string; parsed: StagedFinishSchedule }> {
    const rows = await client.query(`select status, parsed from intake_runs where id = $1`, [runId]);
    return { status: String(rows.rows[0].status), parsed: rows.rows[0].parsed as StagedFinishSchedule };
  }

  const library = async () =>
    (
      await client.query(
        `select code, kind, description, supplier_raw, reference, notes, state, code_origin, version
           from project_finishes where project_id = $1 and status = 'active' order by code`,
        [projectId],
      )
    ).rows as Record<string, unknown>[];

  const changeSets = async () =>
    (
      await client.query(
        `select kind, reason, source_intake_run_id, evidence_attachment_id from change_sets where project_id = $1 order by created_at`,
        [projectId],
      )
    ).rows as Record<string, unknown>[];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90410")}', '__QA Finishes schedule confirm', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    attachmentId = (
      await client.query(
        `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
         values ('project', $1, 'spec_document', $2, $3, 'application/pdf', 'qa') returning id`,
        [projectId, `projects/${projectId}/__qa-finishes-tracker.pdf`, FILENAME],
      )
    ).rows[0].id;
    // Held before the schedule: one named by a drawing and never described,
    // with a supplier somebody already recorded; one already described.
    await addFinish("QA-TIM-02", { description: null, supplier: "Held supplier" });
    await addFinish("QA-STN-01", { description: "Grey limestone" });
  });

  afterAll(async () => {
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [
      projectId,
    ]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("creates, fills and refuses in ONE change set, and a second confirm of the same schedule is a no-op", async () => {
    const { runId, staged } = await stageRun();
    const [tim01, tim02, stn01, repeat, uncoded] = staged.entries;

    // The review GET: the verdicts the screen shows, from the live library.
    const got = await (await importGet(new Request("http://localhost/test"), params(runId))).json();
    expect(got.ok).toBe(true);
    expect(got.review.map((row: { verdict: { status: string } | null }) => row.verdict?.status)).toEqual([
      "new",
      "fills",
      "conflict",
      "repeated",
      "no_code",
    ]);
    expect(got.review[0].suggestion).toMatchObject({ kind: "timber" });

    // A person files the kind the screen suggested — on the staged entry.
    const patched = await importPatch(
      new Request("http://localhost/test", {
        method: "PATCH",
        body: JSON.stringify({ entryId: tim01!.id, expectedVersion: 1, changes: { kind: "timber" } }),
      }),
      params(runId),
    );
    expect(patched.status).toBe(200);
    // A kind the vocabulary does not hold is refused.
    const bad = await importPatch(
      new Request("http://localhost/test", {
        method: "PATCH",
        body: JSON.stringify({ entryId: tim02!.id, expectedVersion: 1, changes: { kind: "plastic" } }),
      }),
      params(runId),
    );
    expect(bad.status).toBe(400);

    const before = await changeSets();
    const response = await post(runId, {
      action: "confirm",
      entries: [
        { id: tim01!.id, version: 2 },
        { id: tim02!.id, version: 1 },
        { id: stn01!.id, version: 1 },
        { id: repeat!.id, version: 1 },
      ],
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ ok: true, created: 1, filled: 1, unchanged: 0, status: "parsed" });
    expect(result.skipped.map((row: { entryId: string }) => row.entryId)).toEqual([stn01!.id, repeat!.id]);
    expect(result.skipped[0].why).toMatch(/Grey limestone/);

    // ONE change set, naming the document, carrying it as source and evidence.
    const after = await changeSets();
    expect(after).toHaveLength(before.length + 1);
    const change = after[after.length - 1]!;
    expect(change).toMatchObject({
      kind: "finish_edit",
      source_intake_run_id: runId,
      evidence_attachment_id: attachmentId,
    });
    expect(String(change.reason)).toContain(FILENAME);

    const rows = await library();
    const byCode = new Map(rows.map((row) => [String(row.code), row]));
    // New: filed under the hyphenated code, with the person's kind, TBC.
    expect(byCode.get("QA-TIM-01")).toMatchObject({
      kind: "timber",
      description: "NATURAL OAK; Finish: Stained",
      supplier_raw: "Example Joinery",
      state: "tbc",
      code_origin: "client",
    });
    expect(String(byCode.get("QA-TIM-01")!.notes)).toContain(`From ${FILENAME}, page 1`);
    // Filled: the empty description and reference, and NOT the supplier it had.
    expect(byCode.get("QA-TIM-02")).toMatchObject({
      description: "SMOKED OAK",
      supplier_raw: "Held supplier",
      reference: "SMP-0002",
    });
    // The conflict wrote nothing.
    expect(byCode.get("QA-STN-01")).toMatchObject({ description: "Grey limestone", version: 1 });
    expect(rows).toHaveLength(3);

    // The conflict, the repeat and the uncoded entry wait for a person.
    const afterFirst = await stagedOf(runId);
    expect(afterFirst.status).toBe("parsed");
    expect(afterFirst.parsed.entries.map((row) => row.reviewStatus)).toEqual([
      "applied",
      "applied",
      "pending",
      "pending",
      "pending",
    ]);
    expect(afterFirst.parsed.entries[0]!.applied).toMatchObject({ outcome: "created" });
    expect(afterFirst.parsed.entries[1]!.applied).toMatchObject({ outcome: "filled" });

    // An applied entry cannot be confirmed twice.
    const twice = await post(runId, { action: "confirm", entries: [{ id: tim01!.id, version: 3 }] });
    expect(twice.status).toBe(409);

    // Ignoring the rest closes the review.
    const ignored = await post(runId, {
      action: "ignore",
      entries: [
        { id: stn01!.id, version: 1 },
        { id: repeat!.id, version: 1 },
        { id: uncoded!.id, version: 1 },
      ],
    });
    expect((await ignored.json()).status).toBe("confirmed");

    // THE SAME SCHEDULE AGAIN: every code is held and agreeing, so nothing is
    // written and no change is opened — the entries are simply closed.
    const versions = new Map(rows.map((row) => [String(row.code), Number(row.version)]));
    const second = await stageRun();
    const [again01, again02] = second.staged.entries;
    const changesBefore = (await changeSets()).length;
    const noOp = await post(second.runId, {
      action: "confirm",
      entries: [
        { id: again01!.id, version: 1 },
        { id: again02!.id, version: 1 },
      ],
    });
    const noOpResult = await noOp.json();
    expect(noOpResult).toMatchObject({ ok: true, created: 0, filled: 0, unchanged: 2, changeSetId: null });
    expect(await changeSets()).toHaveLength(changesBefore);
    for (const row of await library()) expect(Number(row.version)).toBe(versions.get(String(row.code)));
    const closed = await stagedOf(second.runId);
    expect(closed.parsed.entries.slice(0, 2).map((row) => row.applied?.outcome)).toEqual(["unchanged", "unchanged"]);
  });

  it("refuses a confirm sent over a version the reviewer did not see", async () => {
    const { runId, staged } = await stageRun();
    const response = await post(runId, { action: "confirm", entries: [{ id: staged.entries[0]!.id, version: 7 }] });
    expect(response.status).toBe(409);
  });
});
