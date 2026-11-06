// Database tier — the apply path of `db:backfill-answer-provenance` (0050).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/answer-provenance-backfill.test.ts
//
// The rows are written the way the code before 0050 left them: every answer
// the recompose composed is `document`, with the run of the spec it came from.
// The decision table itself is proved in tests/lib/answer-provenance-backfill
// .test.ts; this proves what `--apply` does with it, in one change set, with a
// version per record, and that a second run does nothing.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { sql } from "@/lib/db";
import { applyAnswerProvenance, planAnswerProvenance } from "@/lib/answer-provenance-backfill";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the answer provenance backfill", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let specRunId = "";
  let billRunId = "";
  let scheduleRunId = "";
  let categoryId = "";
  let com1FieldId = "";
  let com2FieldId = "";
  let recordNo = 9600;

  const records: Record<string, string> = {};

  async function record(name: string): Promise<string> {
    recordNo += 1;
    const id = String(
      (
        await client.query(
          `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
           values ($1, $2, $3, 'active', $4, $5, 'qa', 'qa') returning id`,
          [projectId, specRunId, recordNo, categoryId, `__QA ${name}`],
        )
      ).rows[0].id,
    );
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa' from requirements q where q.category_id = $2`,
      [id, categoryId],
    );
    records[name] = id;
    return id;
  }

  async function fabricSpec(recordId: string, fieldId: string, value: string, runId: string) {
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, source_run_id, sort_order, created_by, updated_by)
       values ($1, 'material', 'Fabric', $2, $3, 'confirmed', $4, 1, 'qa', 'qa')`,
      [recordId, value, fieldId, runId],
    );
  }

  /** An answer as the code before 0050 wrote it. */
  async function oldAnswer(recordId: string, fieldId: string, value: string, runId: string) {
    await client.query(
      `update spec_answers set value = $3, state = 'confirmed', confirmed_by = 'qa', confirmed_at = now(),
              source_kind = 'document', source_id = $4
        where record_id = $1 and spec_field_id = $2 and revision_no = 0`,
      [recordId, fieldId, value, runId],
    );
  }

  const answer = async (recordId: string, fieldId: string) =>
    (
      await client.query(
        `select value, state, source_kind from spec_answers where record_id = $1 and spec_field_id = $2 and revision_no = 0`,
        [recordId, fieldId],
      )
    ).rows[0];

  const versions = async (recordId: string) =>
    Number((await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n);

  beforeAll(async () => {
    await client.connect();
    const category = await client.query(
      `select q.category_id from requirements q join spec_fields f on f.id = q.spec_field_id
        where f.json_id = 1
          and exists (select 1 from requirements c join spec_fields cf on cf.id = c.spec_field_id
                       where c.category_id = q.category_id and cf.json_id = 2)
        order by q.category_id limit 1`,
    );
    categoryId = String(category.rows[0].category_id);
    com1FieldId = String((await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id);
    com2FieldId = String((await client.query(`select id from spec_fields where json_id = 2`)).rows[0].id);
    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90052")}', '__QA Provenance backfill', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
    specRunId = String(
      (
        await client.query(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`, [
          projectId,
        ])
      ).rows[0].id,
    );
    billRunId = String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
           values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
    scheduleRunId = String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
           values ($1, 'spec_document', 'ffe_schedule', 'confirmed', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );

    // FROZEN: the bill's fabric was corrected after its confirm, and the
    // answer could not follow.
    const frozen = await record("frozen");
    await fabricSpec(frozen, com1FieldId, "__QA Velvet Moss", billRunId);
    await oldAnswer(frozen, com1FieldId, "__QA Velvet Rose", billRunId);

    // RETIRED: the bill's fabric was taken off; its answer still shipped.
    const retired = await record("retired");
    await oldAnswer(retired, com1FieldId, "__QA Velvet Rose", billRunId);

    // IN STEP: relabelled, nothing changes.
    const inStep = await record("in-step");
    await fabricSpec(inStep, com1FieldId, "__QA Linen Sand", billRunId);
    await oldAnswer(inStep, com1FieldId, "__QA Linen Sand", billRunId);

    // A REVIEWER'S OWN answer off a schedule, no spec behind it: left alone.
    // And on the same record, a schedule answer over a BILL spec that says
    // something else: only a person can say which it is.
    const reviewer = await record("reviewer");
    await oldAnswer(reviewer, com1FieldId, "__QA Reviewer cloth", scheduleRunId);
    await fabricSpec(reviewer, com2FieldId, "__QA Bill cloth", billRunId);
    await oldAnswer(reviewer, com2FieldId, "__QA Schedule cloth", scheduleRunId);
  }, 60_000);

  afterAll(async () => {
    if (!projectId) {
      await client.end();
      return;
    }
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, 60_000);

  it("plans, applies in one change with a version per record written, and a second run does nothing", async () => {
    const [plan] = await planAnswerProvenance(sql, projectId);
    expect(plan).toBeDefined();
    // Measured before anything is written: the retired fabric's answer, and
    // the reviewer's own (which may be legitimate; it is a count for Max).
    expect(plan!.standingOnNothing).toBe(2);
    expect(plan!.relabelled).toBe(3);
    const changed = new Map(plan!.changed.map((line) => [line.recordId, [line.from.value, line.to.value]]));
    expect(changed.get(records.frozen!)).toEqual(["__QA Velvet Rose", "__QA Velvet Moss"]);
    expect(changed.get(records.retired!)).toEqual(["__QA Velvet Rose", null]);
    expect(changed.size).toBe(2);
    expect(plan!.leftAsDocument).toBe(1);
    expect(plan!.needsPerson.map((line) => [line.held.value, line.composed.value])).toEqual([
      ["__QA Schedule cloth", "__QA Bill cloth"],
    ]);

    const before = {
      frozen: await versions(records.frozen!),
      inStep: await versions(records["in-step"]!),
      reviewer: await versions(records.reviewer!),
    };
    const result = await withTransaction((txn) => applyAnswerProvenance(txn, plan!, "qa"));
    expect(result.relabelled).toBe(3);
    expect(result.changeSetId).not.toBeNull();

    expect(await answer(records.frozen!, com1FieldId)).toEqual({ value: "__QA Velvet Moss", state: "confirmed", source_kind: "attribute" });
    expect(await answer(records.retired!, com1FieldId)).toEqual({ value: null, state: "missing", source_kind: "attribute" });
    expect(await answer(records["in-step"]!, com1FieldId)).toEqual({ value: "__QA Linen Sand", state: "confirmed", source_kind: "attribute" });
    expect(await answer(records.reviewer!, com1FieldId)).toMatchObject({ value: "__QA Reviewer cloth", source_kind: "document" });
    expect(await answer(records.reviewer!, com2FieldId)).toMatchObject({ value: "__QA Schedule cloth", source_kind: "document" });

    // One version of each record written, none of one left alone.
    expect(await versions(records.frozen!)).toBe(before.frozen + 1);
    expect(await versions(records["in-step"]!)).toBe(before.inStep + 1);
    expect(await versions(records.reviewer!)).toBe(before.reviewer);
    const changes = await client.query(
      `select count(distinct change_set_id)::int as n from record_snapshots s join spec_records r on r.id = s.record_id
        where r.project_id = $1`,
      [projectId],
    );
    expect(changes.rows[0].n).toBe(1);

    const [again] = await planAnswerProvenance(sql, projectId);
    expect(again!.relabelled).toBe(0);
    const second = await withTransaction((txn) => applyAnswerProvenance(txn, again!, "qa"));
    expect(second.changeSetId).toBeNull();
  });
});
