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
