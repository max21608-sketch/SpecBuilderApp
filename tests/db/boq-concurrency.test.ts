// Database tier — the BOQ confirm's concurrency, through the REAL route.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// THE DEFECT THIS FILE PROVES IS FIXED. M1 read `coalesce(max(record_no), 0)`,
// built its statement array from it, and only then opened a transaction. Two
// imports confirmed at the same moment read the SAME maximum, allocated the
// same record numbers, and one died on spec_records_project_no_key — after the
// reviewer had been told it was importing.
//
// A sequential narrative would not have caught it. These run on INDEPENDENT
// connections, started before either finishes, so the database is what decides.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("BOQ confirm concurrency", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90007', '__QA BOQ race', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const category = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id
       group by c.id having count(q.id) >= 1
       order by c.id limit 1`,
    );
    categoryId = category.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from status_history where entity_type = 'spec_record'
         and entity_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function stageImport(prefix: string, count: number): Promise<string> {
    const lines = Array.from({ length: count }, (_, index) => ({
      index,
      lineNo: index + 1,
      designer: "__QA",
      boqCategory: "__QA area",
      code: `${prefix}${index + 1}`,
      itemDescription: `__QA item ${prefix}${index + 1}`,
      productReference: null,
      qty: 1,
      categoryId,
      categoryStatus: "chosen",
      ignored: false,
    }));
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify({ sheet: "__QA", headerRow: 1, skippedRows: 0, lines })],
    );
    return run.rows[0].id;
  }

  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post({}), params(runId));
  };

  async function records() {
    const rows = await client.query(
      `select record_no, item_description from spec_records where project_id = $1 order by record_no`,
      [projectId],
    );
    return rows.rows;
  }

  it("allocates distinct record numbers for two simultaneous imports", async () => {
    const [a, b] = await Promise.all([stageImport("__QAA", 3), stageImport("__QAB", 3)]);

    // Started together, on independent connections. Before the fix, one of
    // these died on the unique key.
    const [first, second] = await Promise.all([confirm(a), confirm(b)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await records();
    expect(rows).toHaveLength(6);
    const numbers = rows.map((row) => Number(row.record_no));
    expect(new Set(numbers).size).toBe(6);
    // Contiguous, not merely distinct: a gap would mean a number was allocated
    // and then rolled back, which is a different bug wearing the same clothes.
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses a second confirmation of the same import, and imports nothing twice", async () => {
    const runId = await stageImport("__QAC", 2);
    const before = (await records()).length;

    const [first, second] = await Promise.all([confirm(runId), confirm(runId)]);
    const statuses = [first.status, second.status].sort();
    // One commits; the other is refused as a conflict, not with a driver error.
    expect(statuses).toEqual([200, 409]);

    expect((await records()).length).toBe(before + 2);
  });

  it("refuses an import with an uncategorised line, and writes nothing", async () => {
    const runId = await stageImport("__QAD", 2);
    await client.query(
      `update intake_runs
         set parsed = jsonb_set(parsed, '{lines,0,categoryId}', 'null'::jsonb)
       where id = $1`,
      [runId],
    );
    const before = (await records()).length;

    const res = await confirm(runId);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("uncategorised");
    expect((await records()).length).toBe(before);
    // And the run is still reviewable, not half-closed.
    const run = await client.query(`select status from intake_runs where id = $1`, [runId]);
    expect(run.rows[0].status).toBe("parsed");
  });

  it("writes the record, its ref, its answers and its history together", async () => {
    const runId = await stageImport("__QAE", 1);
    expect((await confirm(runId)).status).toBe(200);

    const record = await client.query(
      `select id from spec_records where project_id = $1 and item_description = '__QA item __QAE1'`,
      [projectId],
    );
    const recordId = record.rows[0].id;

    const refs = await client.query(`select ref_value from spec_record_refs where record_id = $1`, [recordId]);
    expect(refs.rows[0]?.ref_value).toBe("__QAE1");

    const answers = await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [recordId]);
    const expected = await client.query(`select count(*)::int as n from requirements where category_id = $1`, [
      categoryId,
    ]);
    expect(answers.rows[0].n).toBe(expected.rows[0].n);

    const history = await client.query(
      `select to_status from status_history where entity_type = 'spec_record' and entity_id = $1`,
      [recordId],
    );
    expect(history.rows[0]?.to_status).toBe("active");
  });
});
