// Database tier — when a project reports itself COMPLETED, and over which
// records.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// THE SCOPE TEST IS THE POINT OF THIS FILE. `loadProjectCompletion` counts with
// its own SQL because the driver cannot share a fragment with
// `loadExportScope`, so nothing but a test can hold the two together — and a
// pill reading COMPLETED over a different set of records from the file it
// ships is the check sheet's own failure mode, worn as a badge.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { EMPTY_COMPLETION, loadProjectCompletion } from "@/lib/project-completion";
import { isScopeFailure, loadExportScope } from "@/lib/export-scope";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("project completion", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let recordId = "";

  // Read the way every caller reads it: a project with nothing in scope is
  // ABSENT from the map, and EMPTY_COMPLETION is the honest reading of that —
  // no records, and therefore not finished.
  const completion = async () => (await loadProjectCompletion([projectId])).get(projectId) ?? EMPTY_COMPLETION;

  /** Every question this record's category asks, answered with one state. */
  async function answerEverything(state: "confirmed" | "tbc" | "na") {
    await client.query(`delete from spec_answers where record_id = $1`, [recordId]);
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, confirmed_by, confirmed_at,
                                 created_by, updated_by)
       select $1, q.id, q.spec_field_id, $2,
              case when $2 = 'na' then null else '__QA value' end,
              case when $2 = 'confirmed' then 'qa' end,
              case when $2 = 'confirmed' then now() end,
              'qa', 'qa'
         from requirements q where q.category_id = $3`,
      [recordId, state, categoryId],
    );
  }

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00025")}', '__QA Completion', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;
    // A category that actually asks something: a category with no authored
    // requirements would score 0 outstanding and prove nothing.
    const category = await client.query(
      `select c.id from item_categories c
        where exists (select 1 from requirements q where q.category_id = c.id)
        order by c.sort_order limit 1`,
    );
    categoryId = category.rows[0].id;
    const record = await client.query(
      // `status` defaults to 'draft' and the export takes only 'active', so a
      // fixture that left it would be counted by neither side and would prove
      // nothing about either.
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status,
                                 created_by, updated_by)
       values ($1, $2, 1, $3, '__QA Sofa', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    recordId = record.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("a record with no answers at all is outstanding, not settled", async () => {
    // Driven off requirements, not off answers: a question nobody has an
    // answer ROW for is missing, and counting answers would make it invisible.
    const result = await completion();
    expect(result?.records).toBe(1);
    expect(result?.outstanding).toBeGreaterThan(0);
    expect(result?.complete).toBe(false);
  });

  it("TBC keeps it open, because TBC is an answer and not a settled one", async () => {
    await answerEverything("tbc");
    const result = await completion();
    expect(result?.outstanding).toBeGreaterThan(0);
    expect(result?.complete).toBe(false);
  });

  it("completes once every question is confirmed or N/A", async () => {
    await answerEverything("confirmed");
    const result = await completion();
    expect(result?.outstanding).toBe(0);
    expect(result?.uncategorised).toBe(0);
    expect(result?.complete).toBe(true);
  });

  it("an uncategorised record blocks it, having asked nothing", async () => {
    const extra = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, status, created_by, updated_by)
       values ($1, $2, 2, '__QA Unknown thing', 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    const result = await completion();
    expect(result?.uncategorised).toBe(1);
    // Nothing is outstanding on it — that is exactly the trap.
    expect(result?.outstanding).toBe(0);
    expect(result?.complete).toBe(false);
    await client.query(`delete from spec_records where id = $1`, [extra.rows[0].id]);
  });

  it("a retired run is out, like the export", async () => {
    await client.query(
      `update spec_runs set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
      [runId],
    );
    const result = await completion();
    expect(result.records).toBe(0);
    // Zero records is NOT complete: an empty project is one nobody started.
    expect(result?.complete).toBe(false);
    await client.query(
      `update spec_runs set status = 'active', retired_at = null, retired_by = null where id = $1`,
      [runId],
    );
  });

  it("counts the same records the export ships, split lines included", async () => {
    const agree = async () => {
      const scope = await loadExportScope(projectId, null);
      if (isScopeFailure(scope)) throw new Error(scope.error);
      const result = await completion();
      expect(result?.records ?? 0).toBe(scope.scope.records.length);
    };

    await agree();

    // A bill line with a live configuration is a heading, and the
    // configuration is the job. Both sides have to agree about that, or the
    // pill describes a different file from the one a person uploads.
    const variant = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description,
                                 parent_id, depth, split_reason, variant_label, status, created_by, updated_by)
       values ($1, $2, 3, $3, '__QA Sofa', $4, 1, 'fabric', 'A', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId, recordId],
    );
    await agree();

    // Retire it and the parent is an item again — on both sides.
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
      [variant.rows[0].id],
    );
    await agree();
    await client.query(`delete from spec_records where id = $1`, [variant.rows[0].id]);
  });
});
