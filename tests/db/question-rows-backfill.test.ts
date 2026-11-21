// Database tier — `db:backfill-question-rows` (review 1, finding 1).
//
// The seed's shape, on a fixture: records categorised, THEN questions added to
// their sheet. The pass must give every live record the rows it lacks, fill
// the one its specs answer as a projection, name the question a spec speaks to
// but cannot answer, take one change set for the project and one
// version per record it touched — and do nothing the second time.
//
// Rows are `__QA `-prefixed; the project goes by `deleteProjectRows`.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber, qaPlaceholderCategory } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { setRecordCategory } from "@/lib/record-category";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { applyQuestionRows, planQuestionRows, QUESTION_ROWS_REASON } from "@/lib/question-rows-backfill";
import { sql } from "@/lib/db";
import { deleteProjectRows } from "../../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the question-rows backfill", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let sheet: { id: string; drop: () => Promise<void> } | null = null;
  let recordNo = 0;
  let sortOrder = 990;
  const ids = { a: "", b: "", c: "" };
  const questions = { added: "", readiness: "", silent: "" };

  const q = async (text: string, values: unknown[] = []) => (await client.query(text, values)).rows;

  async function categorised(description: string): Promise<string> {
    recordNo += 1;
    const [row] = await q(
      `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'qa', 'qa') returning id, version`,
      [projectId, runId, recordNo, description],
    );
    await withTransaction((txn) =>
      setRecordCategory(txn, { recordId: String(row!.id), categoryId: sheet!.id, expectedVersion: Number(row!.version), actor: "qa" }),
    );
    return String(row!.id);
  }

  async function addQuestion(prompt: string, fieldId: string | null): Promise<string> {
    sortOrder += 1;
    const [row] = await q(
      `insert into requirements (category_id, kind, spec_field_id, local_key, prompt, section, sort_order, tgq_levels,
                                 created_by, updated_by)
       values ($1, $2, $3, $4, $5, '__QA added', $6, array['simple','complex','hero'], 'qa', 'qa') returning id`,
      [sheet!.id, fieldId ? "spec_field" : "readiness", fieldId, fieldId ? null : `__qa_${sortOrder}`, prompt, sortOrder],
    );
    return String(row!.id);
  }

  const answer = async (recordId: string, requirementId: string) =>
    (await q(`select value, state, source_kind from spec_answers where record_id = $1 and requirement_id = $2 and revision_no = 0`, [
      recordId,
      requirementId,
    ]))[0];

  /** Live records of this project lacking a row for a question their category asks. */
  const lacking = async () =>
    Number(
      (await q(
        `select count(*)::int as n
           from spec_records r join requirements q on q.category_id = r.category_id
          where r.project_id = $1 and r.status = 'active'
            and not exists (select 1 from spec_answers a where a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0)`,
        [projectId],
      ))[0]!.n,
    );

  beforeAll(async () => {
    await client.connect();
    sheet = await qaPlaceholderCategory(client, "question rows");
    projectId = String(
      (await q(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Question rows', 'qa', 'qa') returning id`, [
        qaNumber("P90072"),
      ]))[0]!.id,
    );
    runId = String(
      (await q(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`, [projectId]))[0]!.id,
    );
    // A field the copied sheet does not ask, and one it does — by json_id and
    // sort_order, never by uuid.
    const [added] = await q(
      `select f.id from spec_fields f
        where f.json_id <> 3 and not exists (select 1 from requirements q where q.category_id = $1 and q.spec_field_id = f.id)
        order by f.json_id limit 1`,
      [sheet.id],
    );
    const [silent] = await q(
      `select f.id from spec_fields f
        where f.json_id <> 3 and f.id <> $2
          and not exists (select 1 from requirements q where q.category_id = $1 and q.spec_field_id = f.id)
        order by f.json_id limit 1`,
      [sheet.id, String(added!.id)],
    );

    ids.a = await categorised("__QA Console with a spec");
    ids.b = await categorised("__QA Console with a silent spec");
    ids.c = await categorised("__QA Retired console");
    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa", reason: "__QA fixture" });
      await txn`insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, created_by, updated_by)
                values (${ids.a}, 'finish', '__QA finish', '__QA Walnut', ${String(added!.id)}, 'confirmed', 'qa', 'qa')`;
      await recomposeAnswers(txn, ids.a, null, "qa");
      // A spec on the field that says nothing the checklist can take: TBC, no words.
      await txn`insert into record_attributes (record_id, attr_group, label, spec_field_id, state, created_by, updated_by)
                values (${ids.b}, 'finish', '__QA finish', ${String(silent!.id)}, 'tbc', 'qa', 'qa')`;
      await txn`update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa' where id = ${ids.c}`;
      await snapshotRecords(txn, [ids.a, ids.b, ids.c], changeSetId);
    });

    // THE SEED: three questions arrive after the records were categorised.
    questions.added = await addQuestion("__QA Timber finish 2", String(added!.id));
    questions.readiness = await addQuestion("__QA Stone top?", null);
    questions.silent = await addQuestion("__QA Metal finish 2", String(silent!.id));
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await sheet?.drop().catch(() => undefined);
    await client.end();
  });

  it("plans the live records' missing rows, the fill a spec gives, and what it cannot decide — writing nothing", async () => {
    expect(await lacking()).toBe(6);
    const [plan] = await planQuestionRows(sql, projectId);
    expect(plan!.rowsToAdd).toBe(6);
    expect(plan!.records.map((record) => record.recordId).sort()).toEqual([ids.a, ids.b].sort());
    const a = plan!.records.find((record) => record.recordId === ids.a)!;
    expect(a.fills).toEqual([{ prompt: "__QA Timber finish 2", value: "__QA Walnut", state: "confirmed" }]);
    expect(plan!.undecided).toEqual([{ recordLabel: expect.any(String), prompt: "__QA Metal finish 2", specs: ["“” (tbc)"] }]);
    expect(await lacking()).toBe(6);
  });

  it("writes them under ONE change set, one version per record, fills the projection, and leaves the decision", async () => {
    const [plan] = await planQuestionRows(sql, projectId);
    const result = await withTransaction((txn) => applyQuestionRows(txn, plan!, "system:backfill-question-rows"));
    expect(result).toMatchObject({ rowsAdded: 6, recordsVersioned: 2 });
    expect(await lacking()).toBe(0);

    expect(await answer(ids.a, questions.added)).toMatchObject({ value: "__QA Walnut", state: "confirmed", source_kind: "attribute" });
    expect(await answer(ids.a, questions.readiness)).toMatchObject({ state: "missing" });
    expect(await answer(ids.b, questions.silent)).toMatchObject({ state: "missing" });
    // The retired record keeps what it had.
    expect(await answer(ids.c, questions.added)).toBeUndefined();

    const [change] = await q(`select kind, reason, actor from change_sets where id = $1`, [result.changeSetId]);
    expect(change).toEqual({ kind: "manual_edit", reason: QUESTION_ROWS_REASON, actor: "system:backfill-question-rows" });
    const versions = await q(`select record_id from record_snapshots where change_set_id = $1 order by record_id`, [result.changeSetId]);
    expect(versions.map((row) => String(row.record_id))).toEqual([ids.a, ids.b].sort());
    // change-history's coverage rule, for this change: every record it wrote
    // an answer to has its version under it.
    const uncovered = await q(
      `select distinct a.record_id from audit_log al join spec_answers a on a.id::text = al.row_id
        where al.table_name = 'spec_answers' and al.change_set_id = $1
          and not exists (select 1 from record_snapshots s where s.change_set_id = $1 and s.record_id = a.record_id)`,
      [result.changeSetId],
    );
    expect(uncovered).toEqual([]);
  });

  it("does nothing the second time: no rows, no change set", async () => {
    const [plan] = await planQuestionRows(sql, projectId);
    expect(plan!.rowsToAdd).toBe(0);
    const changes = Number((await q(`select count(*)::int as n from change_sets where project_id = $1`, [projectId]))[0]!.n);
    const result = await withTransaction((txn) => applyQuestionRows(txn, plan!, "system:backfill-question-rows"));
    expect(result).toEqual({ rowsAdded: 0, recordsVersioned: 0, changeSetId: null });
    expect(Number((await q(`select count(*)::int as n from change_sets where project_id = $1`, [projectId]))[0]!.n)).toBe(changes);
  });
});
