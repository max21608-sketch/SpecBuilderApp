// Database tier — a finishes schedule meets a library holding a code's ZONE
// TWIN (audit E7, 2026-11-06).
//
// Skips without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/finish-schedule-twins.test.ts
//
// ============================================================================
// THE SCHEDULE'S CONFIRM READ ZONE TWINS WITH LESS THAN THE OTHER CONFIRMS.
//
// `findFinishByCode` folds `GR-XMA-01` onto a bare `XMA-01` only where nothing
// says the zones are kept apart: another zone's twin in the library, or the
// bare finish already standing for another zone on an item (`zonesOnItems`).
// Three of the four library loaders read `zonesOnItems`; the schedule's did
// not, and its "repeated" check keyed on the code as printed rather than on
// the finish it resolved to. Three ways that went wrong, one case each:
//
//   * TWO ZONES ON ONE SCHEDULE folded onto one bare row: GR's words and PL's
//     words both filled `XMA-01`, the second with a version the first had
//     already moved, so the whole confirm came back "changed as you saved".
//   * A BARE ROW ALREADY PL'S on the items took GR's description.
//   * A BARE CODE AND ITS ZONED TWIN in one schedule were two fills of one
//     row, and the second 409'd the confirm.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";
import { RawFinishEntry } from "@/lib/extraction-schema";
import { stageFinishSchedule, type StagedFinishSchedule } from "@/lib/finish-schedule";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const FILENAME = "__QA zone twins schedule.pdf";
const entry = (over: Partial<RawFinishEntry>) => RawFinishEntry.parse({ otherRaw: [], ...over });

describeIfDb("a finishes schedule against zone twins in the library", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let attachmentId = "";
  let runId = "";
  let entrySeq = 0;

  const addFinish = async (code: string) =>
    String(
      (
        await client.query(
          `insert into project_finishes (project_id, code, code_norm, state, status, created_by, updated_by)
           values ($1, $2, $3, 'tbc', 'active', 'qa', 'qa') returning id`,
          [projectId, code, normaliseFinishCode(code)],
        )
      ).rows[0].id,
    );

  async function confirmSchedule(entries: RawFinishEntry[]) {
    const staged: StagedFinishSchedule = stageFinishSchedule(entries, FILENAME, null, () => `qa-twin-${(entrySeq += 1)}`);
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, attachment_id, created_by, updated_by)
       values ($1, 'spec_document', 'finishes_schedule', 'parsed', $2::jsonb, $3, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify(staged), attachmentId],
    );
    const id = String(run.rows[0].id);
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm", entries: staged.entries.map((row) => ({ id: row.id, version: row.version })) }),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: await response.json(), entries: staged.entries };
  }

  async function finish(code: string) {
    const rows = await client.query(
      `select id, code, description from project_finishes where project_id = $1 and code_norm = $2 and status = 'active'`,
      [projectId, normaliseFinishCode(code)],
    );
    return rows.rows[0] as { id: string; code: string; description: string | null } | undefined;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90457")}', '__QA Schedule zone twins', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
    attachmentId = String(
      (
        await client.query(
          `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
           values ('project', $1, 'spec_document', $2, $3, 'application/pdf', 'qa') returning id`,
          [projectId, `projects/${projectId}/__qa-zone-twins.pdf`, FILENAME],
        )
      ).rows[0].id,
    );
    runId = String(
      (
        await client.query(
          `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("two zones on one schedule keep the bare row apart, and the confirm goes through", async () => {
    await addFinish("XMA-01");
    const result = await confirmSchedule([
      entry({ codeRaw: "GR-XMA-01", nameRaw: "__QA BRUSHED BRASS", page: 1 }),
      entry({ codeRaw: "PL-XMA-01", nameRaw: "__QA DARK BRONZE", page: 1 }),
    ]);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    // Each zone is its own finish; the bare one is nobody's description.
    expect((await finish("GR-XMA-01"))?.description).toContain("BRUSHED BRASS");
    expect((await finish("PL-XMA-01"))?.description).toContain("DARK BRONZE");
    expect((await finish("XMA-01"))?.description ?? null).toBeNull();
  });

  it("a bare row that items already read as another zone does not take this zone's words", async () => {
    const bareId = await addFinish("XMB-01");
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
       values ($1, $2, 9801, 'active', '__QA PL chair', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    // A PL item's metal, filed onto the bare XMB-01: the bare row is PL's.
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, material_code, finish_id, state, sort_order, created_by, updated_by)
       values ($1, 'finish', 'Metal', '__QA bronze', 'PL-XMB-01', $2, 'tbc', 1, 'qa', 'qa')`,
      [record.rows[0].id, bareId],
    );
    const result = await confirmSchedule([entry({ codeRaw: "GR-XMB-01", nameRaw: "__QA POLISHED NICKEL", page: 2 })]);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect((await finish("GR-XMB-01"))?.description).toContain("POLISHED NICKEL");
    expect((await finish("XMB-01"))?.description ?? null).toBeNull();
  });

  it("a bare code and its zoned twin on one schedule file once; the second is a repeat, not a 409", async () => {
    await addFinish("XMC-01");
    const result = await confirmSchedule([
      entry({ codeRaw: "XMC-01", nameRaw: "__QA SATIN STEEL", page: 3 }),
      entry({ codeRaw: "GR-XMC-01", nameRaw: "__QA SATIN STEEL", page: 3 }),
    ]);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.filled).toBe(1);
    expect(result.body.skipped).toHaveLength(1);
    expect(result.body.skipped[0].entryId).toBe(result.entries[1]!.id);
    expect((await finish("XMC-01"))?.description).toContain("SATIN STEEL");
    expect(await finish("GR-XMC-01")).toBeUndefined();
  });
});
