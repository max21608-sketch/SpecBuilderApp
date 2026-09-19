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
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb } from "./db-tier";
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
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  /** Staged in the v2 shape: a LIST of sheets, each becoming a run. */
  function sheet(prefix: string, count: number, name: string, categoryOverride?: string | null) {
    return {
      sheetName: name,
      proposedRunName: name,
      headerRow: 1,
      skippedRows: 0,
      ignored: false,
      ignoredReason: null as string | null,
      metadata: { revision: "0", date: "14-Sep-26", notes: ["__QA *All fabrics are COM"] },
      lines: Array.from({ length: count }, (_, index) => ({
        index,
        lineNo: index + 1,
        designer: "__QA",
        boqCategory: "__QA Seating",
        area: "__QA Rooms",
        code: `${prefix}${index + 1}`,
        itemDescription: `__QA item ${prefix}${index + 1}`,
        productReference: null,
        qty: 1,
        qtyUnit: "pcs",
        categoryId: categoryOverride === undefined ? categoryId : categoryOverride,
        categoryStatus: "chosen",
        ignored: false,
      })),
    };
  }

  async function stageImport(prefix: string, count: number, sheets?: ReturnType<typeof sheet>[]): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA boq.xlsx",
          sourcePreserved: false,
          sheets: sheets ?? [sheet(prefix, count, `__QA ${prefix}`)],
        }),
      ],
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

  it("imports a line with NO category rather than refusing the whole bill", async () => {
    // Intake must not stall behind a classification decision that belongs to a
    // later stage. The record exists, carries its ref, and simply has no
    // checklist yet — which the spec table says in words.
    const runId = await stageImport("__QAD", 2);
    await client.query(
      `update intake_runs
         set parsed = jsonb_set(parsed, '{sheets,0,lines,0,categoryId}', 'null'::jsonb)
       where id = $1`,
      [runId],
    );
    const before = (await records()).length;

    const res = await confirm(runId);
    expect(res.status).toBe(200);
    expect((await records()).length).toBe(before + 2);

    const uncategorised = await client.query(
      `select id from spec_records where project_id = $1 and item_description = '__QA item __QAD1'`,
      [projectId],
    );
    const answers = await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [
      uncategorised.rows[0].id,
    ]);
    // No category means no questions — NOT a category with zero questions,
    // which would score 0/0 and read as complete.
    expect(answers.rows[0].n).toBe(0);
  });

  it("refuses a category row that no longer exists, and writes nothing", async () => {
    // A stale screen is a different thing from a deferred decision.
    const runId = await stageImport("__QAF", 1);
    await client.query(
      `update intake_runs
         set parsed = jsonb_set(parsed, '{sheets,0,lines,0,categoryId}', '"00000000-0000-0000-0000-000000000009"'::jsonb)
       where id = $1`,
      [runId],
    );
    const before = (await records()).length;

    const res = await confirm(runId);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("unknown_category");
    expect((await records()).length).toBe(before);
    const run = await client.query(`select status from intake_runs where id = $1`, [runId]);
    expect(run.rows[0].status).toBe("parsed");
  });

  it("renames a sheet's run and drops a sheet, addressing each by index", async () => {
    // The staged sheets are a fixed list, so an index is a stable address —
    // unlike a proposal, which moves as the set is reviewed.
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const runId = await stageImport("__QAJ", 0, [sheet("__QAJ", 1, "Sheet1"), sheet("__QAK", 1, "Sheet2")]);

    const rename = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetIndex: 0, runName: "MUR" }),
      }),
      params(runId),
    );
    expect(rename.status).toBe(200);

    const drop = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetIndex: 1, ignored: true }),
      }),
      params(runId),
    );
    expect(drop.status).toBe(200);

    // A blank run name is refused: a run needs something to call it.
    const blank = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetIndex: 0, runName: "   " }),
      }),
      params(runId),
    );
    expect(blank.status).toBe(400);

    // A sheet that is not there is a conflict, not a silent no-op.
    const missing = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetIndex: 9, runName: "Nope" }),
      }),
      params(runId),
    );
    expect(missing.status).toBe(409);

    expect((await confirm(runId)).status).toBe(200);
    const runs = await client.query(
      `select name from spec_runs where project_id = $1 and source_import_id = $2`,
      [projectId, runId],
    );
    // The reviewer's name, and only the sheet they kept.
    expect(runs.rows.map((row) => row.name)).toEqual(["MUR"]);
  });

  it("creates ONE RUN PER SHEET, and files each sheet's records under its own", async () => {
    // The bug 0007 exists for: a three-tab bill imported as one tab, silently.
    const runId = await stageImport("__QAG", 0, [
      sheet("__QAG", 2, "MUR"),
      sheet("__QAH", 3, "MAIN RUN"),
      { ...sheet("__QAI", 1, "Template"), ignored: true, ignoredReason: "No rows under the header." },
    ]);
    expect((await confirm(runId)).status).toBe(200);

    const runs = await client.query(
      `select id, name, source_sheet, boq_revision, boq_date, header_notes
         from spec_runs where project_id = $1 and source_import_id = $2 order by sort_order`,
      [projectId, runId],
    );
    expect(runs.rows.map((row) => row.name)).toEqual(["MUR", "MAIN RUN"]);
    // The ignored sheet produced no run at all.
    expect(runs.rows).toHaveLength(2);
    expect(runs.rows[0].boq_revision).toBe("0");
    // Read back as text, never a Date: the BOQ prints whatever the client typed.
    expect(runs.rows[0].boq_date).toBe("14-Sep-26");
    expect(runs.rows[0].header_notes).toEqual(["__QA *All fabrics are COM"]);

    const counts = await client.query(
      `select run_id, count(*)::int as n from spec_records where project_id = $1 and run_id = any($2::uuid[])
       group by run_id`,
      [projectId, runs.rows.map((row) => row.id)],
    );
    expect(counts.rows.map((row) => row.n).sort()).toEqual([2, 3]);
  });

  it("writes the record, its ref, its answers and its first version together", async () => {
    const runId = await stageImport("__QAE", 1);
    expect((await confirm(runId)).status).toBe(200);

    const record = await client.query(
      `select id from spec_records where project_id = $1 and item_description = '__QA item __QAE1'`,
      [projectId],
    );
    const recordId = record.rows[0].id;

    const refs = await client.query(`select ref_value from spec_record_refs where record_id = $1`, [recordId]);
    expect(refs.rows[0]?.ref_value).toBe("__QAE1");

    // The BOQ's Area column and its own grouping word stop sharing a column.
    const stored = await client.query(`select area, boq_category, run_id from spec_records where id = $1`, [recordId]);
    expect(stored.rows[0].area).toBe("__QA Rooms");
    expect(stored.rows[0].boq_category).toBe("__QA Seating");
    expect(stored.rows[0].run_id).toBeTruthy();

    const answers = await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [recordId]);
    const expected = await client.query(`select count(*)::int as n from requirements where category_id = $1`, [
      categoryId,
    ]);
    expect(answers.rows[0].n).toBe(expected.rows[0].n);

    // 0012 replaced the per-record status_history line with a CHANGE SET and
    // a version. The change names the document that caused it, which the
    // status_history note never did, and the version holds what the record
    // looked like the moment it was imported.
    const versions = await client.query(
      `select s.snapshot_no, s.atoms, cs.kind, cs.actor, cs.source_intake_run_id
         from record_snapshots s join change_sets cs on cs.id = s.change_set_id
        where s.record_id = $1`,
      [recordId],
    );
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0].snapshot_no).toBe(1);
    expect(versions.rows[0].kind).toBe("boq_confirm");
    expect(versions.rows[0].source_intake_run_id).toBe(runId);

    // The version holds the refs and the answer rows written after the record
    // insert, not the bare row the insert returned.
    const atoms = versions.rows[0].atoms;
    expect(atoms.record.itemDescription).toBe("__QA item __QAE1");
    expect(atoms.refs.map((ref: { value: string }) => ref.value)).toContain("__QAE1");
    expect(atoms.answers.length).toBe(expected.rows[0].n);
  });
});
