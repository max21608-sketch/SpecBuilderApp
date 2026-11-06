// Taking the RECORD's row lock before the rows that hang off it.
//
// ============================================================================
// THE ORDER IS A CONTRACT, AND FOUR WRITERS HAD IT BACKWARDS (audit B6, E8,
// 2026-11-06).
//
// `withTransaction` documents one acquisition order: the project row (where
// project-wide serialisation is needed), then the owning draft or intake row,
// then RECORDS, then requirements, then answers and attributes, each by id.
// The confirms keep it: `confirm-drawings`, `confirm-spec-document` and
// `editCommonSpec` lock their records in id order and only then touch an
// answer or an attribute.
//
// The single-row edits did not. `editAnswer` locked the ANSWER and reached the
// record only at the end, inside `snapshotRecords`; `correctAttribute`,
// `retireAttribute`, `restoreAttribute`, `setAttributeFinish` and
// `resolveDisagreement` locked the ATTRIBUTE (or the disagreement) first. Two
// consequences, both seen as a bare 500 or a 503:
//
//   * A DEADLOCK against any records-first writer. `editCommonSpec` holds the
//     configuration's record and waits for the attribute; a correction on that
//     configuration's own screen holds the attribute and waits for the record
//     in `snapshotRecords`. Postgres kills one with 40P01, which reaches the
//     reviewer as "someone else was changing this".
//   * A UNIQUE VIOLATION where a refusal belonged. The occupancy check ("is
//     anything already in SH?") ran with no lock on the record, so two
//     corrections moving two values into one slot both found it free, and the
//     second died on `record_attributes_dimension_slot_key` — "Nothing was
//     written. Check the logs." `createAttribute` has always locked the record
//     first, which is why a typed spec never had this.
//
// So every one of them now calls one of these BEFORE it reads the row it
// edits. The record lock is the same `for update` `snapshotRecords` takes a
// moment later, so nothing new is locked; it is only taken first.
//
// `for update` FIRES NO TRIGGER. `bump_version` is `before update` (0002), so
// locking a record never moves `spec_records.version`, which every extraction
// snapshot and chase coverage row is taken against. That is the one thing a
// lock helper here must never do.
//
// tests/db/lock-order.test.ts holds each writer to it: a records-first writer
// and the edit run on two connections, and the edit must WAIT, never deadlock
// and never meet a unique violation.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";

/** Locks these records in id order. Ids that are not records are skipped. */
export async function lockRecords(txn: TxnSql, recordIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(recordIds)].sort();
  if (ids.length === 0) return [];
  const rows = await txn`
    select id from spec_records
     where id = any(${ids}::uuid[])
     order by id
       for update
  `;
  return rows.map((row) => String(row.id));
}

/**
 * Locks the record an attribute belongs to, and returns its id (null where the
 * attribute does not exist). An attribute never moves between records, so the
 * unlocked read of `record_id` cannot be overtaken.
 */
export async function lockRecordOfAttribute(txn: TxnSql, attributeId: string): Promise<string | null> {
  const rows = await txn`
    select r.id from spec_records r
     where r.id = (select a.record_id from record_attributes a where a.id = ${attributeId})
       for update
  `;
  return rows[0] ? String(rows[0].id) : null;
}

/** The same, for a checklist answer. An answer never moves between records either. */
export async function lockRecordOfAnswer(txn: TxnSql, answerId: string): Promise<string | null> {
  const rows = await txn`
    select r.id from spec_records r
     where r.id = (select a.record_id from spec_answers a where a.id = ${answerId})
       for update
  `;
  return rows[0] ? String(rows[0].id) : null;
}

/** The records of several answers, locked in id order: a batch's first statement. */
export async function lockRecordsOfAnswers(txn: TxnSql, answerIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(answerIds)];
  if (ids.length === 0) return [];
  const rows = await txn`
    select r.id from spec_records r
     where r.id in (select a.record_id from spec_answers a where a.id = any(${ids}::uuid[]))
     order by r.id
       for update
  `;
  return rows.map((row) => String(row.id));
}

/** The record a disagreement is about. A disagreement never moves either. */
export async function lockRecordOfDisagreement(txn: TxnSql, disagreementId: string): Promise<string | null> {
  const rows = await txn`
    select r.id from spec_records r
     where r.id = (select d.record_id from attribute_disagreements d where d.id = ${disagreementId})
       for update
  `;
  return rows[0] ? String(rows[0].id) : null;
}
