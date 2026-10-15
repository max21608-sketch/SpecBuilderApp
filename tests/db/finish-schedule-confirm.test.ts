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
//   * confirming the same schedule again writes nothing and opens no change;
//   * a version 3 read's swatch files on its code — a new one, or a held one
//     with no picture — never over a swatch the code already has; a proposal
//     on a row that writes nothing is left out, a person's crop there is
//     refused in words, and a pathname outside the project is refused.
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

/** A held TBC name the schedule says more about, and a CONFIRMED one it differs from. */
const DETAIL_ENTRIES = [
  entry({ codeRaw: "QA MTL 01", nameRaw: "ANTIQUE BRASS", finishRaw: "Antique", page: 4 }),
  entry({ codeRaw: "QA MTL 02", nameRaw: "OIL RUBBED BRONZE", finishRaw: "Oil rubbed", page: 4 }),
];

describeIfDb("a finishes schedule confirmed into the library", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let attachmentId = "";

  const addFinish = (
    code: string,
    fields: { description?: string | null; supplier?: string | null; state?: "tbc" | "confirmed" },
  ) =>
    client.query(
      `insert into project_finishes (project_id, code, code_norm, description, supplier_raw, state, status, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'active', 'qa', 'qa') returning id`,
      [projectId, code, normaliseFinishCode(code), fields.description ?? null, fields.supplier ?? null, fields.state ?? "tbc"],
    );

  async function stageRun(entries = ENTRIES): Promise<{ runId: string; staged: StagedFinishSchedule }> {
    let n = 0;
    const staged = stageFinishSchedule(entries, FILENAME, null, () => `qa-entry-${(n += 1)}`);
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
    await client.query(
      `delete from attachments where entity_type = 'project_finishes'
         and entity_id in (select id from project_finishes where project_id = $1)`,
      [projectId],
    );
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
    expect(rows.filter((row) => String(row.code).startsWith("QA-TIM") || String(row.code).startsWith("QA-STN"))).toHaveLength(3);

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

  it("REPLACES a held TBC description the schedule says more about, and leaves a confirmed one a conflict", async () => {
    await addFinish("QA-MTL-01", { description: "Antique  brass", supplier: "Held supplier" });
    await addFinish("QA-MTL-02", { description: "Bronze", state: "confirmed" });
    const { runId, staged } = await stageRun(DETAIL_ENTRIES);
    const got = await (await importGet(new Request("http://localhost/test"), params(runId))).json();
    expect(got.review.map((row: { verdict: { status: string } | null }) => row.verdict?.status)).toEqual([
      "enriches",
      "conflict",
    ]);

    const before = (await changeSets()).length;
    const response = await post(runId, {
      action: "confirm",
      entries: staged.entries.map((row) => ({ id: row.id, version: 1 })),
    });
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, created: 0, filled: 0, enriched: 1 });
    expect(result.skipped.map((row: { entryId: string }) => row.entryId)).toEqual([staged.entries[1]!.id]);
    // One change set for it, under the same rule as every other write here.
    const after = await changeSets();
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({ kind: "finish_edit", source_intake_run_id: runId });

    const byCode = new Map((await library()).map((row) => [String(row.code), row]));
    expect(byCode.get("QA-MTL-01")).toMatchObject({
      description: "ANTIQUE BRASS; Finish: Antique",
      supplier_raw: "Held supplier",
      state: "tbc",
    });
    expect(byCode.get("QA-MTL-02")).toMatchObject({ description: "Bronze", state: "confirmed", version: 1 });
  });

  it("files each swatch on its CODE, never over one the code already has", async () => {
    const box = [0.05, 0.2, 0.15, 0.3];
    const held = await addFinish("QA-FAB-02", { description: "HELD VELVET" });
    const pictured = await addFinish("QA-FAB-03", { description: "PICTURED LINEN" });
    await addFinish("QA-FAB-04", { description: "Something else entirely", state: "confirmed" });
    await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
       values ('project_finishes', $1, 'finish_swatch', $2, 'bill row 4.png', 'image/png', 'qa')`,
      [pictured.rows[0].id, `projects/${projectId}/finish-swatches/held.png`],
    );
    const { runId, staged } = await stageRun([
      entry({ codeRaw: "QA FAB 01", nameRaw: "NEW BOUCLE", page: 5, swatchBox: box }),
      entry({ codeRaw: "QA FAB 02", nameRaw: "HELD VELVET", page: 5, swatchBox: box }),
      entry({ codeRaw: "QA FAB 03", nameRaw: "PICTURED LINEN", page: 5, swatchBox: box }),
      entry({ codeRaw: "QA FAB 04", nameRaw: "A CONFLICTING WOOL", page: 6, swatchBox: box }),
    ]);
    expect(staged.schemaVersion).toBe(3);
    const got = await (await importGet(new Request("http://localhost/test"), params(runId))).json();
    expect(got.review.map((row: { verdict: { status: string; finish?: { hasSwatch?: boolean } } | null }) => [
      row.verdict?.status,
      row.verdict?.finish?.hasSwatch ?? null,
    ])).toEqual([
      ["new", null],
      ["agrees", false],
      ["agrees", true],
      ["conflict", false],
    ]);

    const crop = (index: number, origin: "proposed" | "person", pathname = `projects/${projectId}/finish-swatches/e${index}.png`) => ({
      entryId: staged.entries[index]!.id,
      pathname,
      page: 5,
      width: 40,
      height: 40,
      size: 900,
      origin,
    });
    const refs = staged.entries.map((row) => ({ id: row.id, version: 1 }));

    // A person's crop on a row that writes nothing has nowhere to go: refused, in words.
    const refused = await post(runId, { action: "confirm", entries: refs, entrySwatches: [crop(3, "person")] });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/no library row to go on/);
    // A pathname outside the project is refused before anything is written.
    const foreign = await post(runId, {
      action: "confirm",
      entries: refs,
      entrySwatches: [crop(0, "proposed", "projects/someone-else/x.png")],
    });
    expect(foreign.status).toBe(400);
    expect(await library()).not.toContainEqual(expect.objectContaining({ code: "QA-FAB-01" }));

    const response = await post(runId, {
      action: "confirm",
      entries: refs,
      entrySwatches: [crop(0, "proposed"), crop(1, "proposed"), crop(2, "proposed"), crop(3, "proposed")],
    });
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, created: 1, unchanged: 2, swatchesFiled: 2, swatchesKept: 1, swatchesLeftOut: 1 });

    const swatches = (
      await client.query(
        `select f.code, a.storage_path, a.filename, a.superseded_at
           from attachments a join project_finishes f on f.id = a.entity_id
          where a.entity_type = 'project_finishes' and a.kind = 'finish_swatch' and f.project_id = $1
            and f.code like 'QA-FAB-%'
          order by f.code, a.created_at`,
        [projectId],
      )
    ).rows;
    expect(swatches.map((row) => [row.code, row.filename, row.superseded_at])).toEqual([
      ["QA-FAB-01", "swatch-page-5.png", null],
      ["QA-FAB-02", "swatch-page-5.png", null],
      // The bill's picture stays, and nothing was superseded.
      ["QA-FAB-03", "bill row 4.png", null],
    ]);
    expect(held.rows[0].id).toBeTruthy();
    const after = await stagedOf(runId);
    expect(after.parsed.entries.map((row) => row.swatchFiled ?? null)).toEqual(["filed", "filed", "kept_existing", null]);
    // One change, naming the swatches with everything else.
    const last = (await changeSets()).at(-1);
    expect(String(last?.reason)).toMatch(/2 swatches cropped off the schedule/);
  });

  it("refuses a confirm sent over a version the reviewer did not see", async () => {
    const { runId, staged } = await stageRun();
    const response = await post(runId, { action: "confirm", entries: [{ id: staged.entries[0]!.id, version: 7 }] });
    expect(response.status).toBe(409);
  });
});
