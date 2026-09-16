// Taking a version of a record.
//
// ============================================================================
// ONE FUNCTION, CALLED AT THE END OF EVERY TRANSACTION THAT CHANGES A RECORD.
//
// `snapshotRecords` re-reads the record from the tables rather than being
// handed what the caller just wrote. That is the promote-answers rule again
// and it matters for the same reason: a drawing card supplying only a height
// still has to produce a version showing the width and depth an earlier
// document confirmed. A snapshot assembled from the caller's own writes would
// show a record that has one dimension on it.
//
// It writes NOTHING to spec_records — not a column, not updated_at. Recording
// that something happened must never bump the row it happened to, because
// `bump_version` invalidates every extraction snapshot and chase coverage row
// taken against it for a reason that has nothing to do with them. That rule is
// stated four times in CLAUDE.md and this is the function most tempted to
// break it.
//
// `cells` is stored as NAMED columns rather than 109 positional strings: BWS
// inserts a column occasionally, every letter after it shifts, and a version
// written before that would then be read against the wrong headings.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import { composeRowCells, BWS_EXPORT_COLUMNS, COMPOSER_VERSION } from "@/lib/bws-export";
import {
  exportAnswers,
  loadRecordAtoms,
  scopeForAtoms,
  RECORD_ATOMS_SCHEMA_VERSION,
  type RecordAtoms,
} from "@/lib/record-atoms";

export type StoredCell = { name: string; jsonId: number | null; value: string };

export function composeStoredCells(atoms: RecordAtoms): StoredCell[] {
  const cells = composeRowCells(scopeForAtoms(atoms), atoms.record, atoms.attributes, exportAnswers(atoms));
  return BWS_EXPORT_COLUMNS.map((column, index) => ({
    name: column.name,
    jsonId: column.jsonId,
    value: cells[index]?.value ?? "",
  }));
}

/**
 * A version of each record, under one change set.
 *
 * Ids are snapshotted in sorted order, the same order every confirm path locks
 * records in. Reversing it between two call sites is how a deadlock gets
 * introduced.
 *
 * Returns the snapshot numbers written, keyed by record — routes report "now
 * at v4" and a test asserts the numbering.
 */
export async function snapshotRecords(
  txn: TxnSql,
  recordIds: string[],
  changeSetId: string,
): Promise<Map<string, number>> {
  const written = new Map<string, number>();
  const ordered = [...new Set(recordIds)].sort();
  if (ordered.length === 0) return written;

  const atoms = await loadRecordAtoms(txn, ordered);

  for (const recordId of ordered) {
    const record = atoms.get(recordId);
    // A record deleted inside this transaction has no state to record. Nothing
    // in the app deletes one — retiring is a status — so this is defensive.
    if (!record) continue;

    const numbers = await txn`
      select coalesce(max(snapshot_no), 0) as last from record_snapshots where record_id = ${recordId}
    `;
    const next = Number(numbers[0]?.last ?? 0) + 1;

    // `on conflict do nothing` on (record_id, change_set_id): a transaction
    // that touches a record twice — a drawing confirm that writes attributes
    // and then promotes answers — still produces ONE version of it, which is
    // what a reader expects from one change.
    const inserted = await txn`
      insert into record_snapshots
        (record_id, change_set_id, snapshot_no, schema_version, composer_version, atoms, cells)
      values
        (${recordId}, ${changeSetId}, ${next}, ${RECORD_ATOMS_SCHEMA_VERSION}, ${COMPOSER_VERSION},
         ${JSON.stringify(record)}::jsonb, ${JSON.stringify(composeStoredCells(record))}::jsonb)
      on conflict (record_id, change_set_id) do nothing
      returning snapshot_no
    `;
    if (inserted[0]) written.set(recordId, Number(inserted[0].snapshot_no));
  }

  return written;
}
