// A checklist question that has no answer row yet.
//
// ============================================================================
// WHY A QUESTION CAN HAVE NO ROW (review 1, finding 1, 2026-11-21).
//
// A record's answer rows are created when it is given a category, one per
// question its cheat sheet asks THAT DAY. A seed that adds questions to a
// sheet later (0014 added 77 to the eight cabinetry sheets, which already held
// 403 live records on the local copy) leaves every existing record asking
// questions it has nowhere to record. Every screen lists them — the record
// screen and the fill-in screen drive off `requirements` with a left join, and
// `gateStatus` counts an asked controller with no row as a question — and
// until this file NOTHING could answer one: `PATCH /api/answers/[id]` needs an
// id, "Set the category again" returned early on an unchanged category, the
// fill-in screen said "No checklist row for this question yet", and changing
// category away and back is refused once anybody has answered or chased. So
// those items could never read ready to quote.
//
// Two ways out, one statement each:
//
//   * `insertMissingAnswerRows` — the rows a record's CURRENT category asks
//     and it lacks, created `missing`, for a caller that has already locked
//     the records and opened its change. `setRecordCategory` on an unchanged
//     category and `db:backfill-question-rows` use it.
//   * `answerQuestionWithoutRow` — a person answering one such question: the
//     row is created inside the same change set and under the same record
//     lock as the answer, and the answer is the ordinary `editAnswer`, so the
//     reason rule, ownership (`source_kind = 'manual'`) and the version are
//     exactly an edit's. `POST /api/records/[id]/answers` is its route.
//
// `project-wide.ts` creates rows for the same reason with the same insert
// (its own, inside its batch); it is the other coder's file in the chase
// build and is left as it is.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit, type VerifiedEvidence } from "@/lib/change-sets";
import { editAnswer, type EditAnswerResult } from "@/lib/answer-edit";
import { lockRecords } from "@/lib/record-lock";
import type { AnswerState } from "@/lib/spec-vocab";

export type CreatedAnswerRow = { id: string; recordId: string; requirementId: string; version: number };

/**
 * Creates, `missing`, every answer row these records' CURRENT categories ask
 * for and they do not hold. A record with no category asks nothing.
 *
 * THE CALLER HOLDS THE RECORD LOCKS (`lockRecords`, id order) and has opened
 * the change set the rows belong to: an insert outside one is a write the
 * change trail cannot account for, and `tests/db/change-history.test.ts`
 * fails a record written under a change with no version under it — so the
 * caller versions every record this returns a row for.
 */
export async function insertMissingAnswerRows(
  txn: TxnSql,
  recordIds: readonly string[],
  actor: string,
): Promise<CreatedAnswerRow[]> {
  const ids = [...new Set(recordIds)].sort();
  if (ids.length === 0) return [];
  const rows = await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select r.id, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
      from spec_records r
      join requirements q on q.category_id = r.category_id
     where r.id = any(${ids}::uuid[])
       and not exists (
         select 1 from spec_answers a where a.record_id = r.id and a.requirement_id = q.id and a.revision_no = 0
       )
     order by r.id, q.sort_order
    on conflict (record_id, requirement_id, revision_no) do nothing
    returning id, record_id, requirement_id, version
  `;
  return rows.map((row) => ({
    id: String(row.id),
    recordId: String(row.record_id),
    requirementId: String(row.requirement_id),
    version: Number(row.version),
  }));
}

/**
 * A person answering a question this record has no answer row for.
 *
 * Refused, in words and with nothing written, where the question is not on
 * the record's checklist — its CURRENT category does not ask it (a stale
 * screen after a category change, or a crafted request) — and where a row has
 * appeared since the screen loaded, because then the screen did not show the
 * answer it would be replacing.
 */
export async function answerQuestionWithoutRow(
  txn: TxnSql,
  {
    recordId,
    requirementId,
    value,
    qualifier,
    state,
    reason,
    evidence,
    actor,
  }: {
    recordId: string;
    requirementId: string;
    value: string | null;
    qualifier?: string | null;
    state: AnswerState;
    reason?: string | null;
    evidence?: VerifiedEvidence | null;
    actor: string;
  },
): Promise<EditAnswerResult> {
  // THE RECORD FIRST (`record-lock.ts`): the "is there a row yet" read below
  // is a promise only the record lock keeps until the insert.
  await lockRecords(txn, [recordId]);
  const records = await txn`
    select r.id, r.project_id, r.category_id, c.name as category_name
      from spec_records r left join item_categories c on c.id = r.category_id
     where r.id = ${recordId}
  `;
  const record = records[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });

  const questions = await txn`select id, category_id, prompt from requirements where id = ${requirementId}`;
  const question = questions[0];
  if (!question) throw new DomainConflictError("not_found", "No such question.", { status: 404 });
  const prompt = String(question.prompt);

  if (!record.category_id) {
    throw new DomainConflictError(
      "question_not_on_checklist",
      `This item has no category, so it has no checklist to answer “${prompt}” on. Set its category first.`,
    );
  }
  if (String(question.category_id) !== String(record.category_id)) {
    throw new DomainConflictError(
      "question_not_on_checklist",
      `“${prompt}” is not on this item's checklist: it is asked under another category, and this item is ${String(record.category_name)}. Reload to see its questions.`,
    );
  }

  const existing = await txn`
    select id from spec_answers where record_id = ${recordId} and requirement_id = ${requirementId} and revision_no = 0
  `;
  if (existing[0]) {
    throw new DomainConflictError(
      "answer_version_stale",
      `“${prompt}” changed since this screen loaded. The answer now on record stands; yours was not saved — reload.`,
    );
  }

  // THE CHANGE BEFORE THE ROW, so the insert's audit row carries it.
  const { changeSetId, attached } = await changeSetForEdit(txn, {
    projectId: String(record.project_id),
    actor,
    kind: "manual_edit",
    reason,
    evidence,
  });

  const created = await insertRow(txn, recordId, requirementId, actor);
  // A new row is `missing`, so this never overrides anything and never needs
  // a reason; passing the change makes the edit belong to it rather than
  // opening a second.
  const result = await editAnswer(txn, {
    answerId: created.id,
    value,
    qualifier,
    state,
    expectedVersion: created.version,
    actor,
    changeSetId,
  });
  return { ...result, attachedToOpenChange: attached };
}

async function insertRow(
  txn: TxnSql,
  recordId: string,
  requirementId: string,
  actor: string,
): Promise<{ id: string; version: number }> {
  const rows = await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
      from requirements q where q.id = ${requirementId}
    returning id, version
  `;
  const row = rows[0];
  if (!row) throw new Error(`answer row for requirement ${requirementId} was not created`);
  return { id: String(row.id), version: Number(row.version) };
}
