// Database tier — a question with NO answer row can be answered (review 1,
// finding 1, 2026-11-21).
//
// Seed 0014 added 77 questions to sheets that already held records, and
// nothing in the app could create a row for them: the PATCH needs an id, "Set
// the category again" returned early on an unchanged category, and the
// fill-in screen sent people to the item, which could not help either. Here a
// question is added to a sheet AFTER its record was categorised — the seed's
// shape — and each way out is held to the change trail's rules: one change
// set, one version, the row created under the answer's own change.
//
// Rows are `__QA `-prefixed; the project goes by `deleteProjectRows`.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-answer-rows@example.test",
    name: "QA User",
    role: "admin",
  }),
}));
import { describeIfDb, qaNumber, qaPlaceholderCategory } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { setRecordCategory } from "@/lib/record-category";
import { deleteProjectRows } from "../../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("answering a question that has no answer row", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let sheet: { id: string; drop: () => Promise<void> } | null = null;
  let other: { id: string; drop: () => Promise<void> } | null = null;
  let recordNo = 0;
  /** A BWS field the copied sheet does not ask, ordered by json_id — never by uuid. */
  let addedFieldId = "";
  /** `requirements` is unique on (category, sort_order). */
  let sortOrder = 990;

  const q = async (text: string, values: unknown[] = []) => (await client.query(text, values)).rows;

  /** A record categorised on the sheet as it stands: one row per question it asks today. */
  async function categorisedRecord(description: string): Promise<{ id: string; version: number }> {
    recordNo += 1;
    const [row] = await q(
      `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'qa', 'qa') returning id, version`,
      [projectId, runId, recordNo, description],
    );
    const result = await withTransaction((txn) =>
      setRecordCategory(txn, { recordId: String(row!.id), categoryId: sheet!.id, expectedVersion: Number(row!.version), actor: "qa" }),
    );
    return { id: String(row!.id), version: result.version };
  }

  /** What the seed does: a question added to the sheet after its records were categorised. */
  async function addQuestion(prompt: string, kind: "spec_field" | "readiness" = "spec_field"): Promise<string> {
    sortOrder += 1;
    const [row] = await q(
      `insert into requirements (category_id, kind, spec_field_id, local_key, prompt, section, sort_order, tgq_levels,
                                 created_by, updated_by)
       values ($1, $2, $3, $4, $5, '__QA added', $6, array['simple','complex','hero'], 'qa', 'qa') returning id`,
      [sheet!.id, kind, kind === "spec_field" ? addedFieldId : null, kind === "readiness" ? `__qa_${sortOrder}` : null, prompt, sortOrder],
    );
    return String(row!.id);
  }

  const answerOf = async (recordId: string, requirementId: string) =>
    (await q(
      `select id, value, state, source_kind, version from spec_answers
        where record_id = $1 and requirement_id = $2 and revision_no = 0`,
      [recordId, requirementId],
    ))[0];
  const versionsOf = async (recordId: string) =>
    q(
      `select s.snapshot_no, s.change_set_id, c.kind, c.reason from record_snapshots s join change_sets c on c.id = s.change_set_id
        where s.record_id = $1 order by s.snapshot_no`,
      [recordId],
    );

  async function post(recordId: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const { POST } = await import("@/app/api/records/[id]/answers/route");
    const response = await POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) }), params(recordId));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    await client.connect();
    sheet = await qaPlaceholderCategory(client, "answer rows");
    other = await qaPlaceholderCategory(client, "answer rows other");
    const [field] = await q(
      `select f.id from spec_fields f
        where f.json_id <> 3
          and not exists (select 1 from requirements q where q.category_id = $1 and q.spec_field_id = f.id)
        order by f.json_id limit 1`,
      [sheet.id],
    );
    addedFieldId = String(field!.id);
    projectId = String(
      (await q(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Answer rows', 'qa', 'qa') returning id`, [
        qaNumber("P90071"),
      ]))[0]!.id,
    );
    runId = String(
      (await q(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`, [projectId]))[0]!.id,
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await sheet?.drop().catch(() => undefined);
    await other?.drop().catch(() => undefined);
    await client.end();
  });

  it("the first answer creates the row, as a person's answer, under ONE change set with ONE version", async () => {
    const record = await categorisedRecord("__QA Console");
    const question = await addQuestion("__QA Stone top?", "readiness");
    expect(await answerOf(record.id, question)).toBeUndefined();
    const before = await versionsOf(record.id);

    const result = await post(record.id, { requirementId: question, value: "Yes", state: "confirmed" });
    expect(result.status, JSON.stringify(result.body)).toBe(201);

    const answer = await answerOf(record.id, question);
    expect(answer).toMatchObject({ value: "Yes", state: "confirmed", source_kind: "manual" });
    expect(result.body.answer).toMatchObject({ id: answer!.id, value: "Yes", version: Number(answer!.version) });
    const after = await versionsOf(record.id);
    expect(after).toHaveLength(before.length + 1);
    const change = after[after.length - 1]!;
    expect(change.kind).toBe("manual_edit");
    // The row's insert and the answer's update are both under that change.
    const audit = await q(
      `select action, change_set_id from audit_log where table_name = 'spec_answers' and row_id = $1 order by id`,
      [answer!.id],
    );
    expect(audit.map((row) => row.change_set_id)).toEqual(audit.map(() => change.change_set_id));
    expect(audit.length).toBeGreaterThanOrEqual(2);
    // And the record's own version did not move: no unsent chase goes stale.
    expect(Number((await q(`select version from spec_records where id = $1`, [record.id]))[0]!.version)).toBe(record.version);
  });

  it("refuses a question that is not on the record's current checklist, and writes nothing", async () => {
    const record = await categorisedRecord("__QA Sideboard");
    const [foreign] = await q(`select id from requirements where category_id = $1 order by sort_order limit 1`, [other!.id]);
    const before = await versionsOf(record.id);
    const result = await post(record.id, { requirementId: String(foreign!.id), value: "x", state: "confirmed" });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("question_not_on_checklist");
    expect(String(result.body.error)).toMatch(/not on this item's checklist/);
    expect(await answerOf(record.id, String(foreign!.id))).toBeUndefined();
    expect(await versionsOf(record.id)).toHaveLength(before.length);
  });

  it("refuses where a row has appeared since the screen loaded, rather than writing over it unseen", async () => {
    const record = await categorisedRecord("__QA Wardrobe");
    const question = await addQuestion("__QA Fitted to the wall?", "readiness");
    await withTransaction(async (txn) => {
      const { insertMissingAnswerRows } = await import("@/lib/answer-rows");
      const { openChangeSet } = await import("@/lib/change-sets");
      const { snapshotRecords } = await import("@/lib/record-snapshot");
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa", reason: "__QA rows" });
      await insertMissingAnswerRows(txn, [record.id], "qa");
      await txn`update spec_answers set value = 'No', state = 'confirmed', confirmed_by = 'qa', confirmed_at = now()
                 where record_id = ${record.id} and requirement_id = ${question}`;
      await snapshotRecords(txn, [record.id], changeSetId);
    });
    const result = await post(record.id, { requirementId: question, value: "Yes", state: "confirmed" });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("answer_version_stale");
    expect((await answerOf(record.id, question))!.value).toBe("No");
  });

  it("setting the SAME category again adds the missing rows and fills them from the record's specs, with one version", async () => {
    const record = await categorisedRecord("__QA Desk");
    // A spec the record already holds, on the field the new question will ask.
    await withTransaction(async (txn) => {
      const { openChangeSet } = await import("@/lib/change-sets");
      const { snapshotRecords } = await import("@/lib/record-snapshot");
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa", reason: "__QA spec" });
      await txn`insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, created_by, updated_by)
                values (${record.id}, 'finish', '__QA finish', '__QA Walnut', ${addedFieldId}, 'confirmed', 'qa', 'qa')`;
      await snapshotRecords(txn, [record.id], changeSetId);
    });
    const question = await addQuestion("__QA Timber finish 2");
    const readiness = await addQuestion("__QA Integrated lighting?", "readiness");
    const before = await versionsOf(record.id);

    const result = await withTransaction((txn) =>
      setRecordCategory(txn, { recordId: record.id, categoryId: sheet!.id, expectedVersion: record.version, actor: "qa" }),
    );
    expect(result.answersCreated).toBe(2);
    expect(await answerOf(record.id, question)).toMatchObject({ value: "__QA Walnut", state: "confirmed", source_kind: "attribute" });
    expect(await answerOf(record.id, readiness)).toMatchObject({ state: "missing" });
    const after = await versionsOf(record.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]!.kind).toBe("category_set");

    // Nothing left to add: a no-op again, with no change and no version.
    const again = await withTransaction((txn) =>
      setRecordCategory(txn, { recordId: record.id, categoryId: sheet!.id, expectedVersion: record.version, actor: "qa" }),
    );
    expect(again.answersCreated).toBe(0);
    expect(await versionsOf(record.id)).toHaveLength(after.length);
  });

  // L1, 2026-11-21: `project-wide.ts` had its own copy of this insert. It now
  // calls the one function, narrowed to the (record, question) pairs it is
  // about to write — a fan-out writes ONE question, and must not create rows
  // for the record's other missing questions behind a sentence about that one.
  it("narrowed to (record, question) pairs, creates those rows only, and never one the record's category does not ask", async () => {
    const record = await categorisedRecord("__QA Wardrobe");
    const wanted = await addQuestion("__QA Hanging rail?", "readiness");
    const untouched = await addQuestion("__QA Shoe rack?", "readiness");
    const [foreign] = await q(`select id from requirements where category_id = $1 order by sort_order limit 1`, [other!.id]);
    const { insertMissingAnswerRows } = await import("@/lib/answer-rows");
    const created = await withTransaction((txn) =>
      insertMissingAnswerRows(txn, [record.id], "qa", {
        only: [
          { recordId: record.id, requirementId: wanted },
          { recordId: record.id, requirementId: String(foreign!.id) },
        ],
      }),
    );
    expect(created.map((row) => row.requirementId)).toEqual([wanted]);
    expect(await answerOf(record.id, wanted)).toMatchObject({ state: "missing", source_kind: "manual" });
    expect(await answerOf(record.id, untouched)).toBeUndefined();
    expect(await answerOf(record.id, String(foreign!.id))).toBeUndefined();
  });
});
