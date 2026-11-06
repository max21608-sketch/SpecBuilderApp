// Setting a record's cheat-sheet category after import.
//
// WHY THIS EXISTS. Until 0007, a BOQ could not be confirmed until every line
// had a category, so a record without one could not exist and no route needed
// to set one. Intake no longer blocks on it — a classification decision belongs
// to a later stage than "get the tender pack into the system" — which opens a
// gap this closes: otherwise a record imported without a category could never
// acquire one, and would sit forever with no checklist and no way to get one.
//
// Setting the category also CREATES THE ANSWER ROWS, with the same insert-select
// the BOQ confirm uses, and fills the ones the record's attributes already
// answer. A category with no answers scores 0/0 and reads as complete, which is
// the same class of error as an empty programme rendering as a healthy one.
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { type ItemLevel } from "@/lib/spec-vocab";
import { draftStateWords } from "@/lib/draft-status";

export type SetCategoryResult = { recordId: string; categoryId: string; answersCreated: number; version: number };

export async function setRecordCategory(
  txn: TxnSql,
  {
    recordId,
    categoryId,
    expectedVersion,
    actor,
  }: { recordId: string; categoryId: string; expectedVersion: number; actor: string },
): Promise<SetCategoryResult> {
  const rows = await txn`
    select id, project_id, category_id, version, status from spec_records where id = ${recordId} for update
  `;
  const record = rows[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });
  if (Number(record.version) !== expectedVersion) {
    throw new DomainConflictError(
      "record_version_stale",
      "This record changed since this screen loaded. Reload before saving.",
    );
  }

  const categories = await txn`select id, name from item_categories where id = ${categoryId}`;
  const category = categories[0];
  if (!category) throw new DomainConflictError("unknown_category", "No such category.", { status: 400 });

  const current = record.category_id ? String(record.category_id) : null;
  if (current === categoryId) {
    // Nothing changed, so there is no version to take and no change to record.
    // A history entry saying "set the category to what it already was" is
    // noise in the one screen that has to stay readable.
    return { recordId, categoryId, answersCreated: 0, version: Number(record.version) };
  }

  // The guards run BEFORE the change is opened: a refusal opens nothing.
  if (current !== null) await assertCategoryMayChange(txn, recordId);

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(record.project_id),
    actor,
    kind: "category_set",
  });

  if (current !== null) {
    // Everything left is the old category's: `missing` rows nobody looked at,
    // and the PROJECTIONS of the record's own specs (`attribute`, 0050), which
    // `recomposeAnswers` below writes again under the new category's
    // questions. Neither is a decision, so neither is lost. After the change
    // is open, so the trail carries the delete under it.
    await txn`delete from spec_answers where record_id = ${recordId} and revision_no = 0`;
  }

  const updated = await txn`
    update spec_records set category_id = ${categoryId}, updated_by = ${actor}
    where id = ${recordId} and version = ${expectedVersion}
    returning version
  `;
  if (!updated[0]) {
    throw new DomainConflictError("record_version_stale", "This record changed as you saved. Reload and try again.");
  }

  const created = await txn`
    insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
    select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
    from requirements q
    where q.category_id = ${categoryId}
    on conflict (record_id, requirement_id, revision_no) do nothing
    returning id
  `;

  // AND FILLS THEM FROM WHAT THE RECORD ALREADY HOLDS (audit E5, 2026-11-06).
  // Intake does not wait for a category, so a bill line routinely arrives with
  // its sizes and fabrics as attributes and no questions for them to answer.
  // Creating the rows `missing` and stopping left a record whose Specs tab
  // showed W1900 x D790 and a fabric while its checklist, its gates and TGQ
  // said nobody had looked, until some later document happened to recompose
  // it. The one recompose every other attribute write uses, inside this change
  // and before its version, so the version holds the answers it filled.
  await recomposeAnswers(txn, recordId, null, actor);

  await snapshotRecords(txn, [recordId], changeSetId);

  return {
    recordId,
    categoryId,
    answersCreated: created.length,
    version: Number(updated[0].version),
  };
}

// ---------------------------------------------------------------------------
// WHEN A CATEGORY MAY CHANGE.
//
// The answers are keyed on the OLD category's questions, so changing the
// category deletes them. Two kinds of answer must not be deleted, and each is
// refused in words BEFORE anything is written.
//
// A PERSON'S ANSWER (audit, Stage 1 walk, 2026-11-06). `manual`, `email` and
// `document` (since 0050 only a reviewer's own) are decisions, and a dropdown
// must not discard one. The guard used to count every row that was not
// `missing`, and since E5 recomposes a record the moment it is categorised,
// that counted the record's OWN SPECS: every bill line with a size or a
// fabric refused to move ("already has 2 answered questions… clear them
// first"), and there was nothing anybody could clear. An `attribute` answer is
// a projection; it goes with the old rows and is recomposed under the new.
// The `missing` placeholders are `manual` too, which is why the state is read
// as well as the kind.
//
// A CHASED QUESTION (audit B3). A chase's coverage row points at the answer it
// asked about (`email_draft_items.answer_id`, 0005, NO ACTION since 0055), and
// coverage is history: never updated, and kept when the draft is superseded or
// its send is voided, as the record of what was asked. So once a question has
// been chased its answer row can never be deleted, and the delete used to meet
// the foreign key as a 23503 the reviewer read as "Nothing was written. Check
// the logs." It is refused naming the chase.
//
// THAT REFUSAL HAS NO WAY ROUND IT TODAY, and the sentence says so rather than
// inventing one. "Void the draft first" was the obvious advice and is false:
// a voided draft keeps its coverage. Letting a chased record change category
// needs a decision about the data (an answer that can be retired rather than
// deleted, or coverage that can outlive its answer), which is a migration and
// is Max's to take. Until then the item keeps its category, and its questions
// can still be answered under it.
// ---------------------------------------------------------------------------

/** The kinds of answer a person gave. `attribute` is the checklist's copy of the specs. */
const PERSON_SOURCES = ["manual", "email", "document"];

async function assertCategoryMayChange(txn: TxnSql, recordId: string): Promise<void> {
  const category = await txn`
    select c.name from spec_records r join item_categories c on c.id = r.category_id where r.id = ${recordId}
  `;
  const under = category[0] ? `under ${String(category[0].name)}` : "under its current category";

  const answered = await txn`
    select q.prompt
      from spec_answers a
      join requirements q on q.id = a.requirement_id
     where a.record_id = ${recordId} and a.revision_no = 0
       and a.state <> 'missing'
       and a.source_kind = any(${PERSON_SOURCES}::text[])
     order by q.sort_order
  `;
  if (answered.length > 0) {
    const prompts = answered.map((row) => `“${String(row.prompt)}”`);
    const named = listed(prompts, 3);
    throw new DomainConflictError(
      "category_has_answers",
      `${answered.length === 1 ? "Somebody has answered" : `Somebody has answered ${answered.length} questions`} ${under}: ${named}. Clear ${answered.length === 1 ? "that answer" : "those answers"} on the checklist first, or keep the category.`,
      { diff: { answered: answered.map((row) => String(row.prompt)) } },
    );
  }

  const chased = await txn`
    select d.id, d.status, d.recipient_name, d.recipient_email,
           coalesce(d.sent_at, d.generated_at)::text as on_day,
           count(distinct i.answer_id)::int as questions
      from email_draft_items i
      join email_drafts d on d.id = i.draft_id
      join spec_answers a on a.id = i.answer_id
     where a.record_id = ${recordId} and a.revision_no = 0
     group by d.id, d.status, d.recipient_name, d.recipient_email, d.sent_at, d.generated_at
     order by coalesce(d.sent_at, d.generated_at)
  `;
  if (chased.length > 0) {
    const chases = chased.map((row) => {
      const who = row.recipient_name ? String(row.recipient_name) : row.recipient_email ? String(row.recipient_email) : "a contact";
      return `the chase to ${who} of ${dayOf(String(row.on_day))}, which ${draftStateWords(String(row.status))}`;
    });
    const questions = chased.reduce((total, row) => Math.max(total, Number(row.questions)), 0);
    throw new DomainConflictError(
      "category_chased",
      `This item's questions ${under} have been chased (${listed(chases, 2)}), and a chase keeps the questions it asked, so the category cannot change on this item. Keep it, and answer ${questions === 1 ? "that question where it is" : "those questions where they are"}.`,
      { diff: { drafts: chased.map((row) => String(row.id)) } },
    );
  }
}

/** "a, b and 2 more" — a refusal names what is in the way, and a long list buries the sentence. */
function listed(items: string[], shown: number): string {
  if (items.length <= shown) {
    return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }
  return `${items.slice(0, shown).join(", ")} and ${items.length - shown} more`;
}

/** A timestamp as a person reads it: "14 Oct 2026". */
function dayOf(iso: string): string {
  const date = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "an earlier date";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

// ---------------------------------------------------------------------------
// The item's level.
//
// Same shape as the category above and for the same reasons, with one
// difference: changing a level is NOT refused once answers exist. A level does
// not decide WHICH questions a record is asked -- the category does that -- only
// which of them hold up a quote. Re-deciding it re-sorts the screen and the next
// chase email; it orphans nothing, so refusing the change would protect nothing.
// ---------------------------------------------------------------------------
export type SetLevelResult = { recordId: string; level: ItemLevel | null; version: number };

export async function setRecordLevel(
  txn: TxnSql,
  {
    recordId,
    level,
    expectedVersion,
    actor,
  }: { recordId: string; level: ItemLevel | null; expectedVersion: number; actor: string },
): Promise<SetLevelResult> {
  const rows = await txn`
    select id, project_id, level, level_suggested, version from spec_records where id = ${recordId} for update
  `;
  const record = rows[0];
  if (!record) throw new DomainConflictError("not_found", "No such record.", { status: 404 });
  if (Number(record.version) !== expectedVersion) {
    throw new DomainConflictError(
      "record_version_stale",
      "This record changed since this screen loaded. Reload before saving.",
    );
  }

  const current = record.level ? (String(record.level) as ItemLevel) : null;
  // A record holding a SUGGESTION and nothing else is not settled, whatever
  // the suggestion happens to say: accepting "simple" over a suggested
  // "simple" is the click that turns a guess into a decision, and it must
  // write. Only a decision that is already the same decision is a no-op.
  if (current === level && !record.level_suggested) {
    return { recordId, level, version: Number(record.version) };
  }

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(record.project_id),
    actor,
    kind: "level_set",
  });

  // THE SUGGESTION ENDS HERE, whichever way the decision went. 0025 refuses a
  // row holding both, and a suggestion left behind a decision is a second
  // answer waiting for a screen to read it first.
  const updated = await txn`
    update spec_records
       set level = ${level},
           level_suggested = null,
           level_suggested_reason = null,
           updated_by = ${actor}
     where id = ${recordId} and version = ${expectedVersion}
    returning version
  `;
  if (!updated[0]) {
    throw new DomainConflictError("record_version_stale", "This record changed as you saved. Reload and try again.");
  }

  await snapshotRecords(txn, [recordId], changeSetId);

  return { recordId, level, version: Number(updated[0].version) };
}

/**
 * Accept the levels this app suggested, a run or a project at a time.
 *
 * ONE CHANGE SET FOR THE LOT, because it is one decision: a reviewer reading
 * a run's levels and saying "yes, those are right". Fifty-nine change sets
 * saying "level set" would bury the trail under the answer to a question
 * nobody asked.
 *
 * It is still a human confirm, in the sense the gates mean: the screen shows
 * every suggested level and what it was guessed from, and this writes only
 * what was on that screen. What it refuses to do is invent one — a record
 * with NO suggestion is untouched, because there is nothing to accept.
 */
export async function acceptSuggestedLevels(
  txn: TxnSql,
  { projectId, runId, actor }: { projectId: string; runId: string | null; actor: string },
): Promise<{ accepted: number }> {
  const pending = await txn`
    select r.id from spec_records r
     where r.project_id = ${projectId}
       and (${runId}::uuid is null or r.run_id = ${runId}::uuid)
       and r.status = 'active'
       and r.level is null
       and r.level_suggested is not null
     order by r.record_no
     for update
  `;
  const ids = pending.map((row) => String(row.id));
  if (ids.length === 0) return { accepted: 0 };

  const { changeSetId } = await changeSetForEdit(txn, { projectId, actor, kind: "level_set" });

  const updated = await txn`
    update spec_records
       set level = level_suggested,
           level_suggested = null,
           level_suggested_reason = null,
           updated_by = ${actor}
     where id = any(${ids}::uuid[])
    returning id
  `;
  await snapshotRecords(txn, updated.map((row) => String(row.id)), changeSetId);
  return { accepted: updated.length };
}

/**
 * Set ONE level on the records a drawings card names, under ONE change set.
 *
 * ============================================================================
 * WHY IT IS NOT `setRecordLevel` CALLED THREE TIMES
 *
 * A drawing of S-200 is quoted by the mock-up phase, the main phase and the VE
 * phase, so one card fans out to three records — and the brass leg the level is
 * being decided from is one fact on one page. Three calls would be three change
 * sets reading "level set" for one decision somebody took once, which is the
 * failure `acceptSuggestedLevels` exists to avoid and the one `editFinish`'s
 * `changeSetId` parameter was added for.
 *
 * WHAT IT WILL NOT DO. It never invents a level — the caller passes one a
 * person clicked. It touches only ACTIVE records on the named project, so a
 * client cannot reach across projects with a list of ids, and it reports how
 * many it actually wrote so the screen can say something true rather than
 * echoing the length of its own request.
 *
 * NO VERSION CHECK, deliberately, and for `acceptSuggestedLevels`' reason: the
 * request names the LEVEL rather than an edit to a value the screen read, so
 * there is nothing to be stale about. Setting hero over hero is a no-op and
 * setting hero over simple is exactly the decision the person just took. The
 * row lock is what keeps two of them from interleaving.
 * ============================================================================
 */
export async function setLevelOnRecords(
  txn: TxnSql,
  {
    projectId,
    recordIds,
    level,
    actor,
  }: { projectId: string; recordIds: string[]; level: ItemLevel; actor: string },
): Promise<{ set: number; level: ItemLevel }> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return { set: 0, level };

  const found = await txn`
    select id from spec_records
     where id = any(${ids}::uuid[]) and project_id = ${projectId} and status = 'active'
     order by record_no
     for update
  `;
  const live = found.map((row) => String(row.id));
  if (live.length === 0) {
    throw new DomainConflictError(
      "no_records",
      "None of those records are on this project any more. Reload before setting a level.",
      { status: 404 },
    );
  }

  const { changeSetId } = await changeSetForEdit(txn, { projectId, actor, kind: "level_set" });

  // THE SUGGESTION ENDS HERE, whichever way the decision went — `setRecordLevel`'s
  // rule, and 0025 refuses a row holding both anyway.
  const updated = await txn`
    update spec_records
       set level = ${level},
           level_suggested = null,
           level_suggested_reason = null,
           updated_by = ${actor}
     where id = any(${live}::uuid[])
    returning id
  `;
  await snapshotRecords(txn, updated.map((row) => String(row.id)), changeSetId);
  return { set: updated.length, level };
}
