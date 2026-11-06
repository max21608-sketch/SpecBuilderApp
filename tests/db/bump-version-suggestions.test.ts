// Database tier — a SUGGESTED level is not a change to the record (0051).
//
// Skips silently without DATABASE_URL. On the local stack run it with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bump-version-suggestions.test.ts
//
// AUDIT D4 (2026-11-06). The drawings confirm revises `level_suggested` when a
// page names brass, and `spec_records_bump_version` fired on that update like
// any other: the record's version moved, every unsent chase draft covering it
// read stale, and the file header and CLAUDE.md both said the version was
// untouched. 0051 puts a WHEN clause on the trigger so it fires only when a
// column other than the suggestion pair (and the bookkeeping updated_by /
// updated_at / version) changes. These tests are facts about the trigger, so
// they live here and not in the pure tier.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("spec_records version ignores a suggested level", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let recordId = "";

  const version = async () =>
    Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Bump version ignores suggestions', 'qa', 'qa') returning id`,
        [qaNumber("P90051")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, status, created_by, updated_by)
         values ($1, $2, 1, '__QA Armchair', 'active', 'qa', 'qa') returning id`,
        [projectId, runId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("leaves the version alone when the drawings confirm revises the suggestion", async () => {
    const before = await version();
    // The statement confirm-drawings.ts runs, column for column.
    await client.query(
      `update spec_records
          set level_suggested = 'complex',
              level_suggested_reason = '__QA the page names brass',
              updated_by = '__qa-other-actor'
        where id = $1 and level is null and level_suggested is distinct from 'complex'`,
      [recordId],
    );
    const row = (await client.query(`select level_suggested, version from spec_records where id = $1`, [recordId]))
      .rows[0];
    expect(row.level_suggested).toBe("complex");
    expect(Number(row.version)).toBe(before);
  });

  it("still bumps it when a person's LEVEL changes in the same statement", async () => {
    const before = await version();
    await client.query(
      `update spec_records set level = 'complex', level_suggested = null, level_suggested_reason = null,
              updated_by = 'qa' where id = $1`,
      [recordId],
    );
    expect(await version()).toBe(before + 1);
  });

  it("still bumps it for any other column, an internal note included", async () => {
    const before = await version();
    await client.query(`update spec_records set internal_notes = '__QA a note', updated_by = 'qa' where id = $1`, [
      recordId,
    ]);
    expect(await version()).toBe(before + 1);
  });

  it("is the optimistic lock still: a stale version predicate matches nothing after a real change", async () => {
    const seen = await version();
    await client.query(`update spec_records set item_description = '__QA Armchair, revised', updated_by = 'qa' where id = $1`, [
      recordId,
    ]);
    const stale = await client.query(
      `update spec_records set item_description = '__QA lost update', updated_by = 'qa'
        where id = $1 and version = $2 returning id`,
      [recordId, seen],
    );
    expect(stale.rowCount).toBe(0);
  });
});
