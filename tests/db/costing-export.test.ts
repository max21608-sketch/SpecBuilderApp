// Database tier — the costing block, through the REAL route.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// THE SCOPE TEST IS THE POINT OF THIS FILE, the same argument
// `project-completion.test.ts` makes: a costing sheet covering a different set
// of records from the file that gets imported is the check sheet's own failure
// mode. It shares `loadExportScope` in the source; only a test holds that true.
//
// The second thing worth a database is the SPLIT: a bill line with a live
// configuration is a heading, and the costing sheet must cost the
// configurations rather than the heading — which is a correlated `not exists`
// that no pure test can exercise.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { isScopeFailure, loadExportScope } from "@/lib/export-scope";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

type CostingJson = {
  ok: boolean;
  header: string[];
  notes: string[];
  rows: {
    recordId: string;
    item: string;
    qty: string;
    tags: string;
    clientRef: string;
    specs: { text: string; href: string } | null;
    specs2: { text: string; href: string } | null;
  }[];
};

describeIfDb("the costing block", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let recordId = "";

  const costing = async (query = ""): Promise<Response> => {
    const { GET } = await import("@/app/api/projects/[id]/export/costing/route");
    return GET(new Request(`http://localhost/test${query}`), params(projectId));
  };

  // `format=json` is the shape this file asserts against; the default is the
  // xlsx, which is a zip.
  const json = async (query = "?format=json"): Promise<CostingJson> => (await costing(query)).json();

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00031")}', '__QA Costing', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, qty, area, status,
                                 created_by, updated_by)
       values ($1, $2, 1, '__QA Armchair', 40, '__QA Type 006', 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    recordId = record.rows[0].id;

    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', '__QA-FU02', '__qa-fu02', 'qa')`,
      [recordId, projectId],
    );

    // Four slots, in millimetres, so the composed cell is unambiguous.
    for (const [slot, value, order] of [
      ["W", "660", 0],
      ["D", "685", 1],
      ["H", "680", 2],
      ["SH", "445", 3],
    ] as const) {
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state,
                                        sort_order, status, created_by, updated_by)
         values ($1, 'dimension', $2, $3, 'mm', $2, 'confirmed', $4, 'active', 'qa', 'qa')`,
        [recordId, slot, value, order],
      );
    }
  });

  afterAll(async () => {
    await client.query(
      `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from spec_record_refs where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("covers exactly the records the export ships", async () => {
    const body = await json();
    const loaded = await loadExportScope(projectId, null);
    if (isScopeFailure(loaded)) throw new Error(loaded.error);
    expect(body.rows.map((row) => row.recordId).sort()).toEqual(
      loaded.scope.records.map((record) => record.id).sort(),
    );
  });

  it("puts the composed dimension cell in Tags", async () => {
    const body = await json();
    expect(body.rows[0]?.tags).toBe("W660 x D685 x H680 x SH445mm");
  });

  it("is ten columns and names them", async () => {
    const body = await json();
    expect(body.header).toEqual([
      "Specs",
      "",
      "Specs 2",
      "Area",
      "Client Ref",
      "Item",
      "Qty",
      "Image",
      "Comments",
      "Tags",
    ]);
  });

  it("refuses a filter, because the scope is a run or a project and nothing narrower", async () => {
    const response = await costing("?categoryId=abc");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(String(body.error)).toContain("not accepted");
  });

  it("refuses a format it cannot write", async () => {
    expect((await costing("?format=pdf")).status).toBe(400);
  });

  it("writes a csv with the header and no picture column", async () => {
    const response = await costing("?format=csv");
    expect(response.headers.get("content-type")).toContain("text/csv");
    const text = await response.text();
    expect(text).toContain("Client Ref");
    expect(text).toContain("W660 x D685 x H680 x SH445mm");
    expect(text).toContain("__QA-FU02");
  });

  it("costs the configurations and not the bill line they hang off", async () => {
    // 0024: a split bill line is a heading and its configurations are the
    // jobs. The heading must leave the file, or one item reads as two.
    const variant = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, qty, area, parent_id,
                                 depth, split_reason, variant_label, status, created_by, updated_by)
       values ($1, $2, 2, '__QA Armchair', null, '__QA Type 006', $3, 1, 'fabric', 'A', 'active', 'qa', 'qa')
       returning id`,
      [projectId, runId, recordId],
    );
    const variantId = variant.rows[0].id;
    try {
      const body = await json();
      const ids = body.rows.map((row) => row.recordId);
      expect(ids).toContain(variantId);
      expect(ids).not.toContain(recordId);

      const row = body.rows.find((candidate) => candidate.recordId === variantId);
      expect(row?.item).toBe("__QA Armchair (A)");
      // NEVER APPORTIONED: the bill said 40 and never said how many are fabric A.
      expect(row?.qty).toBe("");
      expect(body.notes.join(" ")).toContain("keeps its quantity on the bill line");
    } finally {
      await client.query(`delete from spec_records where id = $1`, [variantId]);
    }
  });

  it("leaves both link columns empty where nothing carries a source page", async () => {
    const body = await json();
    expect(body.rows[0]?.specs).toBeNull();
    expect(body.rows[0]?.specs2).toBeNull();
    expect(body.notes.join(" ")).toContain("no document link");
  });

  it("is not named after the BWS file it must never be mistaken for", async () => {
    // Found by opening a generated one: `exportFilename` hardcodes
    // "BWS spec fields", and this file arriving under that name is the whole
    // confusion the export exists to avoid.
    const disposition = (await costing("?format=csv")).headers.get("content-disposition") ?? "";
    expect(disposition).toContain("costing block.csv");
    expect(disposition).not.toContain("BWS spec fields");
  });

  it("says in the file that it is the item block and not the sheet", async () => {
    const body = await json();
    expect(body.notes[0]).toContain("Columns A to J only");
  });
});
