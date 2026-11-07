// Writing a chase draft's coverage rows, in batches (audit F14, 5.4 A11).
//
// IN BATCHES, BECAUSE THE CALLER HOLDS A LOCK. The generate route holds the
// project row and the edit route the draft row, and a coverage row written one
// statement at a time is a round trip each: measured on the local dev server
// 2026-09-23, one generate was 492 inserts and 22.3 s of a 24.9 s transaction,
// all of it holding `projects ... for update`, and the infill screen's writes
// failed their own `lock_timeout` behind it. The generate route was batched
// then; the edit route kept the per-row loop until 2026-11-06.
//
// What is written is unchanged: the same rows, the same `sort_order`, in the
// caller's transaction. A chunk is 500 rows so one parameter never carries a
// whole 300-line project's snapshots. `sort_order` is the position in the list
// as given, numbered BEFORE anything is chunked: a chunk boundary that
// restarted the count would reorder the email's questions and be invisible in
// the row count.
import type { CoveredQuestion, SqlExecutor } from "@/lib/chase-drafts";
import { ANSWER_STATE_LABELS } from "@/lib/spec-vocab";

export const COVERAGE_CHUNK = 500;

/** The items with their 1-based position, cut into chunks. Pure. */
export function coverageChunks<T>(items: readonly T[]): { item: T; sortOrder: number }[][] {
  const numbered = items.map((item, index) => ({ item, sortOrder: index + 1 }));
  const chunks: { item: T; sortOrder: number }[][] = [];
  for (let from = 0; from < numbered.length; from += COVERAGE_CHUNK) chunks.push(numbered.slice(from, from + COVERAGE_CHUNK));
  return chunks;
}

/** Inserts `covered` as the draft's coverage, in order. Throws if a chunk lands short. */
export async function insertCoverageRows(
  sql: SqlExecutor,
  { draftId, covered, actor }: { draftId: string; covered: readonly CoveredQuestion[]; actor: string },
): Promise<void> {
  for (const chunk of coverageChunks(covered)) {
    const rows = chunk.map(({ item, sortOrder }) => ({
      record_id: item.recordId,
      requirement_id: item.requirementId,
      answer_id: item.answerId,
      snapshot_answer_version: item.answerVersion,
      record_version: item.recordVersion,
      context_snapshot: item.context,
      prompt_text: item.prompt,
      field_label: item.fieldLabel,
      current_value_text: item.currentValueText ?? ANSWER_STATE_LABELS[item.context.state],
      sort_order: sortOrder,
      tier: item.tier,
      record_no: item.recordNo,
      requirement_sort: item.requirementSort,
    }));
    // `jsonb_to_recordset` rather than 14 parallel arrays: the snapshot is
    // already an object, so it stays jsonb the whole way and is never
    // re-encoded into an array literal. Key order is not preserved by jsonb
    // and never was -- `canonicalJson` is what compares a snapshot.
    const inserted = await sql`
      insert into email_draft_items
        (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version,
         record_version, context_snapshot, prompt_text, field_label, current_value_text,
         sort_order, tier, record_no, requirement_sort, created_by)
      select
        ${draftId}, x.record_id, x.requirement_id, 0,
        x.answer_id, x.snapshot_answer_version, x.record_version,
        x.context_snapshot, x.prompt_text, x.field_label, x.current_value_text,
        x.sort_order, x.tier, x.record_no, x.requirement_sort, ${actor}
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(
        record_id uuid, requirement_id uuid, answer_id uuid,
        snapshot_answer_version integer, record_version integer,
        context_snapshot jsonb, prompt_text text, field_label text,
        current_value_text text, sort_order integer, tier text,
        record_no integer, requirement_sort integer)
      returning id
    `;
    // A chunk that lands short has dropped a question the email asks.
    if (inserted.length !== chunk.length) {
      throw new Error(`coverage rows failed to insert: expected ${chunk.length}, wrote ${inserted.length}`);
    }
  }
}
