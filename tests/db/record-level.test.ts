// Database tier — a suggested level is not a level, and accepting one is.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// What is worth testing here rather than in the pure tier: 0025's constraints,
// the bulk accept's ONE change set, and a variant inheriting its parent's
// level — all three are facts about the database, not about a function.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { acceptSuggestedLevels, setRecordLevel } from "@/lib/record-category";
import { ensureVariant } from "@/lib/variant-create";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("item level suggestions", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";

  /** Next free number in the project — ensureVariant allocates from the same
      sequence, so a local counter collides with the variants it creates. */
  async function nextRecordNo(): Promise<number> {
    const row = await client.query(
      `select coalesce(max(record_no), 0) + 1 as n from spec_records where project_id = $1`,
      [projectId],
    );
    return Number(row.rows[0].n);
  }

  async function makeRecord(suggested: string | null, reason: string | null = "the bill names no metalwork") {
    const nextNo = await nextRecordNo();
    const row = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status,
                                 level_suggested, level_suggested_reason, created_by, updated_by)
       values ($1, $2, $3, $4, '__QA Sofa', 'active', $5, $6, 'qa', 'qa')
       returning id, version`,
      [projectId, runId, nextNo, categoryId, suggested, suggested ? reason : null],
    );
    return row.rows[0] as { id: string; version: number };
  }

  const read = async (id: string) =>
    (
      await client.query(
        `select level, level_suggested, level_suggested_reason from spec_records where id = $1`,
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00026', '__QA Levels', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;
    const category = await client.query(`select id from item_categories order by sort_order limit 1`);
    categoryId = category.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    // NOT record_snapshots: 0013 refuses to delete a version while its record
    // exists, and lets it go WITH the record. Deleting the records is the
    // whole cleanup.
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("refuses to hold a decision and a suggestion at once", async () => {
    const record = await makeRecord("simple");
    await expect(
      client.query(`update spec_records set level = 'hero' where id = $1`, [record.id]),
    ).rejects.toThrow(/spec_records_level_or_suggestion/);
  });

  it("refuses a suggestion with no reason, because nobody could check it", async () => {
    const nextNo = await nextRecordNo();
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, status, level_suggested,
                                   created_by, updated_by)
         values ($1, $2, $3, '__QA No reason', 'active', 'hero', 'qa', 'qa')`,
        [projectId, runId, nextNo],
      ),
    ).rejects.toThrow(/spec_records_level_suggested_has_reason/);
  });

  it("accepting the suggested value writes the decision and clears the suggestion", async () => {
    const record = await makeRecord("simple");
    await withTransaction((txn) =>
      setRecordLevel(txn, { recordId: record.id, level: "simple", expectedVersion: record.version, actor: "qa" }),
    );
    const after = await read(record.id);
    // The no-op guard must NOT swallow this: "simple suggested" and "simple
    // decided" look the same and are the whole difference.
    expect(after.level).toBe("simple");
    expect(after.level_suggested).toBeNull();
    expect(after.level_suggested_reason).toBeNull();
  });

  it("accepts a whole run under ONE change set", async () => {
    const before = await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId]);
    const a = await makeRecord("complex", "a brass callout on page 4");
    const b = await makeRecord("simple");
    const c = await makeRecord(null);
    // Counted rather than assumed: earlier cases in this file leave their own
    // suggestions behind, and the point is that ONE call settles the run.
    const pending = await client.query(
      `select count(*)::int as n from spec_records
        where project_id = $1 and level is null and level_suggested is not null`,
      [projectId],
    );

    const result = await withTransaction((txn) =>
      acceptSuggestedLevels(txn, { projectId, runId, actor: "qa" }),
    );
    expect(result.accepted).toBe(Number(pending.rows[0].n));
    expect((await read(a.id)).level).toBe("complex");
    expect((await read(b.id)).level).toBe("simple");
    // Nothing to agree with is nothing to write.
    expect((await read(c.id)).level).toBeNull();

    const after = await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId]);
    expect(after.rows[0].n - before.rows[0].n).toBe(1);
  });

  it("a configuration is born on its bill line's level", async () => {
    const parent = await makeRecord(null);
    await client.query(`update spec_records set level = 'hero' where id = $1`, [parent.id]);
    const variant = await withTransaction((txn) =>
      ensureVariant(txn, { parentId: parent.id, variantLabel: "A", actor: "qa" }),
    );
    const after = await read(variant.recordId);
    expect(after.level).toBe("hero");
  });

  it("a configuration inherits a SUGGESTION as a suggestion, not as a decision", async () => {
    const parent = await makeRecord("complex", "a brass callout on page 4");
    const variant = await withTransaction((txn) =>
      ensureVariant(txn, { parentId: parent.id, variantLabel: "A", actor: "qa" }),
    );
    const after = await read(variant.recordId);
    expect(after.level).toBeNull();
    expect(after.level_suggested).toBe("complex");
  });
});
