// "Ask the client": one question moved to the client for ONE project (0062,
// decision D of 2026-11-20, `after-intake` 4b).
//
// ============================================================================
// A CAM WHO DOES NOT KNOW AN ANSWER SENDS IT TO THE CHASE.
//
// The PM takes what is outstanding to the CAM, who fills in what they know
// (Matthew, 2026-09-18). A CAM question they cannot answer is the client's
// after all, on this project — so it moves, and only here: one project's
// decision is not the cheat sheet's, which is why this is a row in
// `project_question_routes` and never a write to `requirements`.
//
// ---- WHAT IT DOES NOT TOUCH, AND WHY ------------------------------------
//
// No `spec_answers` row (bump_version would fire and stale every snapshot
// taken against the answer — the chased_at trap) and no change set: a change
// set is a change to specification CONTENT, and moving who is asked writes
// none. The write is ACCOUNTED FOR by the audit trigger on the table (an
// insert to move, a delete to move back), and by the screen saying "asked of
// the client on this project" beside the question.
//
// ---- THE TWO RULES ------------------------------------------------------
//
//  - THE PROJECT ROW IS LOCKED FIRST. The generate route locks it too, so a
//    route moving while a chase is generated queues rather than interleaves:
//    the chase reads the audience once, under the same lock.
//  - THE QUESTION IS KEYED BY WHAT IT ASKS (`questionGroupKey`), so a move
//    covers it on every cheat sheet on the project that asks it, and the key
//    must be one an item in scope asks — anything else is refused, never
//    stored for a question that does not exist here.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { questionGroupKey } from "@/lib/chase-grouping";
import { normaliseQuestionAudience, type QuestionAudience } from "@/lib/spec-vocab";

export type QuestionRouteResult = { questionKey: string; audience: QuestionAudience; seedAudience: QuestionAudience };

export async function setQuestionRoute(
  txn: TxnSql,
  { projectId, questionKey, askClient, actor }: { projectId: string; questionKey: string; askClient: boolean; actor: string },
): Promise<QuestionRouteResult> {
  const project = await txn`select id from projects where id = ${projectId} for update`;
  if (!project[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  // Every question an item in the export's scope asks, keyed as the screens
  // key one. The scope is `loadOutstanding`'s (active record, active phase,
  // not a split heading); the state is not filtered, because a question
  // answered on one item is still asked on the project.
  const rows = await txn`
    select distinct q.id, q.prompt, q.local_key, q.audience, f.json_id
      from spec_records r
      join spec_runs run on run.id = r.run_id
      join requirements q on q.category_id = r.category_id
      left join spec_fields f on f.id = q.spec_field_id
     where r.project_id = ${projectId}
       and r.status = 'active'
       and run.status = 'active'
       and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
  `;
  const asked = rows.filter(
    (row) =>
      questionGroupKey({
        requirementId: String(row.id),
        prompt: String(row.prompt ?? ""),
        jsonId: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
        localKey: row.local_key === null || row.local_key === undefined ? null : String(row.local_key),
      }) === questionKey,
  );
  if (asked.length === 0) {
    throw new DomainConflictError(
      "question_gone",
      "No item on this project asks that question any more. Nothing was changed — reload.",
    );
  }
  // One question on several sheets carries one audience in the seed; where it
  // does not, the most guarded reading stands for the whole.
  const seeds = new Set(asked.map((row) => normaliseQuestionAudience(row.audience)));
  const seedAudience: QuestionAudience = seeds.has("in_house") ? "in_house" : seeds.has("cam") ? "cam" : "client";

  if (askClient) {
    if (seedAudience === "client") {
      throw new DomainConflictError("already_client", "That is already a client question; a chase can ask it as it is.");
    }
    await txn`
      insert into project_question_routes (project_id, question_key, audience, created_by, updated_by)
      values (${projectId}, ${questionKey}, 'client', ${actor}, ${actor})
      on conflict (project_id, question_key) do update set audience = 'client', updated_by = ${actor}
    `;
    return { questionKey, audience: "client", seedAudience };
  }

  const removed = await txn`
    delete from project_question_routes where project_id = ${projectId} and question_key = ${questionKey} returning id
  `;
  if (removed.length === 0) {
    throw new DomainConflictError(
      "not_moved",
      "That question was not moved to the client on this project, so there is nothing to put back. Reload.",
    );
  }
  return { questionKey, audience: seedAudience, seedAudience };
}
