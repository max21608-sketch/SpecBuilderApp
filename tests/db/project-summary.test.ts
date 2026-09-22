// Database tier — the overview's numbers, and WHICH UNIT each of them is in.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// ============================================================================
// TWO THINGS THIS FILE EXISTS FOR.
//
// THE SCOPE. `loadProjectSummary` counts with its own SQL because the driver
// cannot share a fragment with `loadExportScope`, exactly as
// `project-completion.ts` does, so nothing but a test can hold the two
// together. A summary describing a different set of records from the file the
// project ships is the check sheet's own failure mode worn as a badge.
//
// THE UNITS. Since 2026-09-21 the same three things are counted twice: once in
// QUESTIONS, which partition, and once in LINE ITEMS, which do not. The item
// counts deliberately OVERLAP — an item clear at TGQ can still carry other
// questions — and `settledItems` deliberately means "nothing outstanding at
// all" rather than "has a settled answer". Both of those are the kind of
// property somebody tidies into a sum later, so they are asserted here rather
// than described in a comment.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { EMPTY_SUMMARY, loadProjectSummary } from "@/lib/project-summary";
import { isScopeFailure, loadExportScope } from "@/lib/export-scope";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("project summary", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  // clearAtTgq: every question in Matthew's TGQ set answered, the rest not.
  // outstanding: nothing answered at all. settled: everything answered.
  let clearAtTgq = "";
  let outstanding = "";
  let settled = "";
  let tgqRequirementIds: string[] = [];
  let allRequirementIds: string[] = [];

  const summary = async () => (await loadProjectSummary(projectId)) ?? EMPTY_SUMMARY;

  async function record(no: number, description: string): Promise<string> {
    const row = await client.query(
      // `status` defaults to 'draft' and the export takes only 'active'.
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status,
                                 created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'active', 'qa', 'qa') returning id`,
      [projectId, runId, no, categoryId, description],
    );
    return row.rows[0].id;
  }

  async function answer(recordId: string, requirementIds: string[]) {
    if (requirementIds.length === 0) return;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value,
                                 confirmed_by, confirmed_at, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'confirmed', '__QA value', 'qa', now(), 'qa', 'qa'
         from requirements q where q.id = any($2::uuid[])`,
      [recordId, requirementIds],
    );
  }

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90031")}', '__QA Summary', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main phase', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    // A category Matthew's matrix COVERS, and which has both TGQ and non-TGQ
    // questions. Under the 0019 placeholder every question blocks a quote (all
    // three levels are seeded on all 728 rows), so "clear at TGQ and still
    // outstanding elsewhere" — the whole point of this file — is not reachable
    // there. His matrix is a proper subset, which is what makes it testable.
    const category = await client.query(
      `select q.category_id as id,
              count(*) filter (where tgq.is_tgq) as tgq_count,
              count(*) filter (where not tgq.is_tgq) as other_count
         from requirements q
         left join spec_fields f on f.id = q.spec_field_id
         cross join lateral (
           select exists (
             select 1 from spec_matrix_category_map m
              join spec_field_gates g on g.applies_to && array[m.matrix_code] and g.gate = 'TGQ'
              left join spec_fields gf on gf.id = g.spec_field_id
             where m.item_category_id = q.category_id
               and (gf.json_id = f.json_id or g.local_key = q.local_key)
           ) as is_tgq
         ) tgq
        where q.category_id in (select item_category_id from spec_matrix_category_map)
        group by q.category_id
       having count(*) filter (where tgq.is_tgq) > 0
          and count(*) filter (where not tgq.is_tgq) > 0
        limit 1`,
    );
    categoryId = category.rows[0].id;

    const reqs = await client.query(
      `select q.id,
              exists (
                select 1 from spec_matrix_category_map m
                 join spec_field_gates g on g.applies_to && array[m.matrix_code] and g.gate = 'TGQ'
                 left join spec_fields gf on gf.id = g.spec_field_id
                where m.item_category_id = q.category_id
                  and (gf.json_id = f.json_id or g.local_key = q.local_key)
              ) as is_tgq
         from requirements q
         left join spec_fields f on f.id = q.spec_field_id
        where q.category_id = $1`,
      [categoryId],
    );
    allRequirementIds = reqs.rows.map((r) => r.id);
    tgqRequirementIds = reqs.rows.filter((r) => r.is_tgq).map((r) => r.id);

    clearAtTgq = await record(1, "__QA Clear at TGQ, outstanding elsewhere");
    outstanding = await record(2, "__QA Nothing answered");
    settled = await record(3, "__QA Everything answered");
    await answer(clearAtTgq, tgqRequirementIds);
    await answer(settled, allRequirementIds);
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

  it("counts the three in LINE ITEMS as well as in questions", async () => {
    const result = await summary();
    expect(result.records).toBe(3);
    expect(result.itemsWithQuestions).toBe(3);

    // Only the record with nothing answered is held at TGQ.
    expect(result.toQuoteItems).toBe(1);
    // The one clear at TGQ still carries its other questions, and so does the
    // one with nothing answered.
    expect(result.alsoOutstandingItems).toBe(2);
    // SETTLED IS "NOTHING OUTSTANDING AT ALL". The record clear at TGQ has
    // confirmed answers and is NOT settled; counting items that merely hold a
    // settled answer would report 2 here and mean nothing.
    expect(result.settledItems).toBe(1);

    // And the question counts, which are the same facts in the other unit.
    expect(result.toQuote).toBeGreaterThan(0);
    expect(result.settled).toBe(tgqRequirementIds.length + allRequirementIds.length);
  });

  it("the item counts deliberately do NOT sum, where the question counts do", async () => {
    const result = await summary();

    // Every ANSWER is exactly one of the four: that is a partition, and it is
    // what makes the question figures addable.
    expect(result.toQuote + result.missing + result.tbc + result.settled).toBe(
      3 * allRequirementIds.length,
    );

    // Items are not. The record clear at TGQ is in `alsoOutstandingItems`, the
    // record with nothing answered is in BOTH of the first two, so the three
    // together exceed the population. A future change that makes these add up
    // has quietly stopped counting items.
    expect(result.toQuoteItems + result.alsoOutstandingItems + result.settledItems).toBeGreaterThan(
      result.itemsWithQuestions,
    );
  });

  it("an uncategorised record is in `records` and in NONE of the item counts", async () => {
    // It has no questions at all, which is why the screen has to name which
    // population an item count is over. 503 line items and 408 with a category
    // are two true numbers about one project.
    const extra = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, status, created_by, updated_by)
       values ($1, $2, 4, '__QA Unknown thing', 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    const result = await summary();
    expect(result.records).toBe(4);
    expect(result.uncategorised).toBe(1);
    expect(result.itemsWithQuestions).toBe(3);
    expect(result.toQuoteItems + result.alsoOutstandingItems).toBeLessThanOrEqual(3);
    await client.query(`delete from spec_records where id = $1`, [extra.rows[0].id]);
  });

  it("counts the same records the export ships, split lines included", async () => {
    const agree = async () => {
      const scope = await loadExportScope(projectId, null);
      if (isScopeFailure(scope)) throw new Error(scope.error);
      expect((await summary()).records).toBe(scope.scope.records.length);
    };

    await agree();

    // A bill line with a live configuration is a heading and the configuration
    // is the job. Both sides have to agree about that, or every number on the
    // overview is over a different set from the file a person uploads.
    const variant = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description,
                                 parent_id, depth, split_reason, variant_label, status, created_by, updated_by)
       values ($1, $2, 5, $3, '__QA Sofa', $4, 1, 'fabric', 'A', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId, outstanding],
    );
    await agree();

    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
      [variant.rows[0].id],
    );
    await agree();
    await client.query(`delete from spec_records where id = $1`, [variant.rows[0].id]);
  });

  it("a retired phase is out, like the export", async () => {
    await client.query(
      `update spec_runs set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
      [runId],
    );
    const result = await summary();
    expect(result.records).toBe(0);
    expect(result.toQuoteItems).toBe(0);
    expect(result.settledItems).toBe(0);
    await client.query(
      `update spec_runs set status = 'active', retired_at = null, retired_by = null where id = $1`,
      [runId],
    );
  });
});
