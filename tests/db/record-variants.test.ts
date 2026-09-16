// Database tier — a split bill line, and what the export ships for it.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// NEEDS 0024. The variant_label column and its indexes come from
// `0024_record_variants.sql`; without it every test here fails on the insert
// rather than on the behaviour.
//
// ============================================================================
// WHAT THIS PROVES, AND WHY IT IS A DATABASE TEST AND NOT A UNIT TEST.
//
// The rule is one SQL predicate — a parent with a live variant is out of scope —
// and the thing that can go wrong with it is not arithmetic. It is that the
// EXPORT and the CHECK SHEET might disagree about which records exist, which is
// the single failure that would make a signed-off check sheet worthless. Both
// load `loadExportScope`, so the only way to prove they agree is to run the
// real loader against a real database holding a real split.
//
// It also pins the half of the rule that is easy to write as a stored flag and
// wrong to: retiring every variant puts the parent BACK in the export. A bill
// line with no live variants is still a line on the bill, and a file that
// omitted it would wipe every BWS field it holds.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("a split bill line in the export scope", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let parentId = "";
  let variantA = "";
  let variantB = "";

  const recordIds = async (): Promise<string[]> => {
    const loaded = await loadExportScope(projectId, runId);
    if (isScopeFailure(loaded)) throw new Error(loaded.error);
    return loaded.scope.records.map((record) => record.id);
  };

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA AP364V', '__QA Variants', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    // The bill's own line: S-201, 45 off, one row.
    const parent = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, qty, status, created_by, updated_by)
       values ($1, $2, 1, 'Armchair', 45, 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    parentId = parent.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    // Children first: 0024 made parent_id cascade, but an explicit order keeps
    // this cleanup readable rather than relying on it.
    await client.query(`delete from spec_records where parent_id is not null and project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("ships the bill line while it has no variants", async () => {
    expect(await recordIds()).toEqual([parentId]);
  });

  it("refuses a variant with no letter, and a letter with no parent", async () => {
    // 0024's biconditional, the same shape as 0002's split_reason rule.
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, created_by, updated_by)
         values ($1, $2, 98, 'Armchair', $3, 1, 'fabric', 'qa', 'qa')`,
        [projectId, runId, parentId],
      ),
    ).rejects.toThrow(/variant_requires_parent/);
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, variant_label, created_by, updated_by)
         values ($1, $2, 97, 'Armchair', 'A', 'qa', 'qa')`,
        [projectId, runId],
      ),
    ).rejects.toThrow(/variant_requires_parent/);
  });

  it("creates A and B, and stops shipping the bill line", async () => {
    const a = await client.query(
      `insert into spec_records
         (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, variant_label, status, created_by, updated_by)
       values ($1, $2, 2, 'Armchair', $3, 1, 'fabric', 'A', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, parentId],
    );
    variantA = a.rows[0].id;
    const b = await client.query(
      `insert into spec_records
         (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, variant_label, status, created_by, updated_by)
       values ($1, $2, 3, 'Armchair', $3, 1, 'fabric', 'B', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, parentId],
    );
    variantB = b.rows[0].id;

    // The variants are the jobs; the bill line is a heading.
    expect(await recordIds()).toEqual([variantA, variantB]);
  });

  it("carries no quantity on either variant", async () => {
    // The bill says 45 and never says how many are fabric A. Apportioning it is
    // a decision with a price attached.
    const rows = await client.query(`select qty from spec_records where parent_id = $1 order by variant_label`, [parentId]);
    expect(rows.rows.map((row) => row.qty)).toEqual([null, null]);
  });

  it("refuses a second A under the same parent", async () => {
    await expect(
      client.query(
        `insert into spec_records
           (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, variant_label, created_by, updated_by)
         values ($1, $2, 4, 'Armchair', $3, 1, 'fabric', 'A', 'qa', 'qa')`,
        [projectId, runId, parentId],
      ),
    ).rejects.toThrow(/spec_records_parent_variant_key/);
  });

  it("puts the bill line back once every variant is retired", async () => {
    // RETIRED THE WAY THE REAL PATHS DO IT. `spec_records_retired_has_actor`
    // (0017) refuses a retired row with no actor, and a fixture that flipped
    // only `status` was refused by it — correctly. Every retiring path in
    // src/lib sets all three columns together.
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa'
        where id = any($1::uuid[])`,
      [[variantA, variantB]],
    );
    // NOT "has ever been split": the line is still 45 off on the bill, and a
    // file that omitted it would wipe every BWS field it holds.
    expect(await recordIds()).toEqual([parentId]);
  });

  it("drops it again as soon as one variant comes back", async () => {
    // A restore clears the retirement rather than leaving it standing beside
    // an active row: the constraint permits that, a reader would not.
    await client.query(
      `update spec_records set status = 'active', retired_at = null, retired_by = null, updated_by = 'qa'
        where id = $1`,
      [variantB],
    );
    expect(await recordIds()).toEqual([variantB]);
  });

  it("lets a parent be deleted with its variants, rather than refusing", async () => {
    // The lesson 0013, 0014 and 0015 each learned separately: append-only means
    // refuse the rewrite and allow the cascade. `parent_id` was `on delete
    // restrict`, which would have refused a project delete the moment anything
    // was split.
    const doomed = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, status, created_by, updated_by)
       values ($1, $2, 50, 'Doomed', 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    await client.query(
      `insert into spec_records
         (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, variant_label, created_by, updated_by)
       values ($1, $2, 51, 'Doomed A', $3, 1, 'fabric', 'A', 'qa', 'qa')`,
      [projectId, runId, doomed.rows[0].id],
    );
    await expect(client.query(`delete from spec_records where id = $1`, [doomed.rows[0].id])).resolves.toBeTruthy();
    const left = await client.query(`select count(*)::int as n from spec_records where parent_id = $1`, [doomed.rows[0].id]);
    expect(left.rows[0].n).toBe(0);
  });
});
