// Database tier. Skips silently without DATABASE_URL — a green `npm test` does
// not mean these ran. Run them with:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) npm test
//
// Uses `pg` rather than the Neon HTTP driver because these need real sessions.
// Every row it creates is prefixed `__QA ` and deleted in FK-safe order.
// audit_log is deliberately left alone: it is append-only by design, and a
// cleanup that deletes from it has broken the thing under test.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("0002 spec model", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00001")}', '__QA Test project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const category = await client.query(`select id from item_categories order by sort_order limit 1`);
    categoryId = category.rows[0].id;
    // Every record belongs to a run (0007): a record on no run is on no tab and
    // in no export scope.
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id::text::uuid from spec_records where project_id = $1)`, [projectId]).catch(() => undefined);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function makeRecord(recordNo: number, description: string): Promise<string> {
    const row = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'qa', 'qa') returning id`,
      [projectId, runId, recordNo, categoryId, description],
    );
    return row.rows[0].id;
  }

  it("imports a repeated client ref as two separate records", async () => {
    // The case that killed the original key design: SX11A appears twice in the
    // pilot BOQ with different quantities. Both must exist, distinguishable.
    const first = await makeRecord(901, "__QA Armchair");
    const second = await makeRecord(902, "__QA Armchair");
    for (const id of [first, second]) {
      await client.query(
        `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
         values ($1, $2, 'boq_code', '__QA SX11A', '__QASX11A', 'qa')`,
        [id, projectId],
      );
    }
    const refs = await client.query(
      `select record_id from spec_record_refs where project_id = $1 and ref_value_norm = '__QASX11A'`,
      [projectId],
    );
    expect(refs.rowCount).toBe(2);
    expect(new Set(refs.rows.map((r) => r.record_id)).size).toBe(2);
  });

  it("refuses the same ref twice on one record", async () => {
    const id = await makeRecord(903, "__QA Sofa");
    const insert = () =>
      client.query(
        `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
         values ($1, $2, 'boq_code', '__QA DUP', '__QADUP', 'qa')`,
        [id, projectId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it("returns zero rows on a stale version rather than overwriting", async () => {
    const recordId = await makeRecord(904, "__QA Bench");
    const requirement = await client.query(
      `select id, spec_field_id from requirements where category_id = $1 order by sort_order limit 1`,
      [categoryId],
    );
    const answer = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
       values ($1, $2, $3, 'missing', 'qa', 'qa') returning id, version`,
      [recordId, requirement.rows[0].id, requirement.rows[0].spec_field_id],
    );
    const { id, version } = answer.rows[0];

    const good = await client.query(
      `update spec_answers set state = 'tbc', updated_by = 'qa' where id = $1 and version = $2 returning version`,
      [id, version],
    );
    expect(good.rowCount).toBe(1);
    expect(good.rows[0].version).toBe(version + 1); // bump_version fired

    const stale = await client.query(
      `update spec_answers set state = 'confirmed', updated_by = 'qa' where id = $1 and version = $2 returning id`,
      [id, version],
    );
    expect(stale.rowCount).toBe(0); // -> the route returns 409, never a silent overwrite
  });

  it("records the actor and the before/after in audit_log", async () => {
    const recordId = await makeRecord(905, "__QA Stool");
    const requirement = await client.query(
      `select id, spec_field_id from requirements where category_id = $1 order by sort_order limit 1`,
      [categoryId],
    );
    const answer = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
       values ($1, $2, $3, 'missing', 'qa-insert', 'qa-insert') returning id`,
      [recordId, requirement.rows[0].id, requirement.rows[0].spec_field_id],
    );
    await client.query(
      `update spec_answers set state = 'tbc', updated_by = 'qa-update' where id = $1`,
      [answer.rows[0].id],
    );
    const log = await client.query(
      `select action, changed_by, old_values->>'state' as old_state, new_values->>'state' as new_state
       from audit_log where table_name = 'spec_answers' and row_id = $1 order by changed_at`,
      [answer.rows[0].id],
    );
    expect(log.rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(log.rows[1].changed_by).toBe("qa-update");
    expect(log.rows[1].old_state).toBe("missing");
    expect(log.rows[1].new_state).toBe("tbc");
  });

  it("refuses `confirmed` with no value or no actor", async () => {
    const recordId = await makeRecord(906, "__QA Table");
    const requirement = await client.query(
      `select id, spec_field_id from requirements where category_id = $1 order by sort_order limit 1`,
      [categoryId],
    );
    await expect(
      client.query(
        `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
         values ($1, $2, $3, 'confirmed', 'qa', 'qa')`,
        [recordId, requirement.rows[0].id, requirement.rows[0].spec_field_id],
      ),
    ).rejects.toThrow(/spec_answers_confirmed_needs_actor/);
  });

  it("refuses an answer whose denormalised field disagrees with its requirement", async () => {
    // The composite FK, not a trigger: a mismatched spec_field_id is
    // unrepresentable, so the M3 export cannot write into the wrong column.
    const recordId = await makeRecord(907, "__QA Console");
    const requirement = await client.query(
      `select id from requirements where category_id = $1 and kind = 'spec_field' order by sort_order limit 1`,
      [categoryId],
    );
    const otherField = await client.query(
      `select id from spec_fields where id not in (
         select spec_field_id from requirements where id = $1 and spec_field_id is not null
       ) limit 1`,
      [requirement.rows[0].id],
    );
    await expect(
      client.query(
        `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
         values ($1, $2, $3, 'missing', 'qa', 'qa')`,
        [recordId, requirement.rows[0].id, otherField.rows[0].id],
      ),
    ).rejects.toThrow(/spec_answers_requirement_field_fk/);
  });

  it("refuses to delete a requirement that answers depend on", async () => {
    // A re-seed of the cheat sheets must fail loudly rather than take 400
    // answers with it.
    const recordId = await makeRecord(908, "__QA Mirror");
    const requirement = await client.query(
      `select id, spec_field_id from requirements where category_id = $1 order by sort_order limit 1`,
      [categoryId],
    );
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
       values ($1, $2, $3, 'missing', 'qa', 'qa')`,
      [recordId, requirement.rows[0].id, requirement.rows[0].spec_field_id],
    );
    await expect(
      client.query(`delete from requirements where id = $1`, [requirement.rows[0].id]),
    ).rejects.toThrow(/violates RESTRICT setting of foreign key constraint/);
  });

  it("caps a split at one level and requires a reason", async () => {
    // 0024 added `spec_records_variant_requires_parent` -- a parent and a
    // letter are the same fact stated twice -- and this 0002-era fixture was
    // never given the letter, so it had been failing on the constraint it was
    // not testing. Every child below now carries one.
    const parent = await makeRecord(909, "__QA Parent");
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, parent_id, depth, variant_label, created_by, updated_by)
         values ($1, $2, 910, $3, '__QA Child no reason', $4, 1, 'A', 'qa', 'qa')`,
        [projectId, runId, categoryId, parent],
      ),
    ).rejects.toThrow(/split_reason/);

    const child = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, parent_id, depth, split_reason, variant_label, created_by, updated_by)
       values ($1, $2, 911, $3, '__QA Child', $4, 1, 'fabric', 'A', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId, parent],
    );
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, parent_id, depth, split_reason, variant_label, created_by, updated_by)
         values ($1, $2, 912, $3, '__QA Grandchild', $4, 2, 'fabric', 'A', 'qa', 'qa')`,
        [projectId, runId, categoryId, child.rows[0].id],
      ),
    ).rejects.toThrow(/depth/);
  });

  it("refuses a variant label with no parent, and a parent with no label", async () => {
    // The other half of 0024's constraint, which nothing exercised: a label
    // with no parent is a top-level record pretending to be a variant.
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, variant_label, created_by, updated_by)
         values ($1, $2, 913, $3, '__QA Orphan letter', 'B', 'qa', 'qa')`,
        [projectId, runId, categoryId],
      ),
    ).rejects.toThrow(/variant_requires_parent/);

    const parent = await makeRecord(914, "__QA Parent for label test");
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, parent_id, depth, split_reason, created_by, updated_by)
         values ($1, $2, 915, $3, '__QA Child no letter', $4, 1, 'fabric', 'qa', 'qa')`,
        [projectId, runId, categoryId, parent],
      ),
    ).rejects.toThrow(/variant_requires_parent/);
  });
});
