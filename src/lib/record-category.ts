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
// the BOQ confirm uses. A category with no answers scores 0/0 and reads as
// complete, which is the same class of error as an empty programme rendering as
// a healthy one.
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { type ItemLevel } from "@/lib/spec-vocab";

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
      "Someone else changed this record while you had it open. Reload before saving.",
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

  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(record.project_id),
    actor,
    kind: "category_set",
  });

  // CHANGING a category is refused once anybody has answered anything under the
  // old one. The answers are keyed on questions that belong to the old
  // category; moving the record would orphan them, and silently discarding
  // somebody's work is not a thing a dropdown should be able to do. Setting a
  // category for the first time is always allowed.
  if (current !== null) {
    const answered = await txn`
      select count(*)::int as n from spec_answers
      where record_id = ${recordId} and revision_no = 0 and state <> 'missing'
    `;
    if (Number(answered[0]?.n ?? 0) > 0) {
      throw new DomainConflictError(
        "category_has_answers",
        `This record already has ${Number(answered[0]?.n)} answered question${Number(answered[0]?.n) === 1 ? "" : "s"} under its current category. Clear them first, or leave the category as it is.`,
      );
    }
    // Only `missing` rows remain, and they belong to questions this record will
    // no longer be asked.
    await txn`delete from spec_answers where record_id = ${recordId} and revision_no = 0 and state = 'missing'`;
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

  await snapshotRecords(txn, [recordId], changeSetId);

  return {
    recordId,
    categoryId,
    answersCreated: created.length,
    version: Number(updated[0].version),
  };
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
      "Someone else changed this record while you had it open. Reload before saving.",
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
