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
//
// ---- ONE VERSION PER TRANSACTION, NOT PER CHANGE (audit B1, 0052) ----------
//
// The insert used to say `on conflict (record_id, change_set_id) do nothing`,
// written for a confirm: one change, one transaction, a record touched twice.
// An OPEN change is many transactions -- every edit a person makes after
// "Start a change" attaches to it -- so the clause kept the FIRST edit's state
// as the change's version of the record and silently dropped every later one.
// The width was v1; the depth typed a minute later had no version; it showed
// up in the next change's diff, under that change's reason.
//
// The property the clause protected is about a TRANSACTION, so that is where
// it is kept now: the records versioned so far are remembered in a setting
// local to the transaction (`app.snapshotted_records`), and a second call in
// the same transaction skips them. A transaction-local setting ends with the
// transaction and rolls back with a savepoint, which is exactly the lifetime
// of the rows it describes. A JavaScript Set would outlive both, and a
// transaction id is what 0012 refuses to rely on.
//
// The first call in a transaction wins. A caller that writes more to a record
// AFTER versioning it in the same transaction gets a version without those
// writes, so the callers that fan out (`configuration-family.ts`, the
// project-wide and apply routes) pass `snapshot: false` and version once, at
// the end. That has been the rule since 0012 and nothing here changes it.
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

  // The records are LOCKED before any snapshot number is read, in sorted order
  // — `confirm-drawings`' rule, for the reason `baseline_members` is
  // materialised under the project lock: transaction start time does not order
  // commits. Without it, two transactions editing two different questions of
  // ONE record both read `max(snapshot_no)` as n, both claim n+1, and the
  // second dies on `record_snapshots_record_no_key` — which reaches the
  // reviewer as a 500 saying nothing was written, over an edit that had
  // nothing to do with the other one. Seen on the infill screen, 2026-09-20.
  //
  // The alternative is to compute the number inside the insert
  // (`select coalesce(max(snapshot_no),0)+1`) and retry once on the unique
  // violation. Its trap is that a retry re-runs a statement inside a
  // transaction that Postgres has already aborted, so the caller has to
  // savepoint every insert — and every other write path in this app already
  // takes a row lock instead.
  //
  // `for update` fires no trigger: `bump_version` is `before update` (0002),
  // so locking a record does not bump the version M2's extraction snapshots
  // and the chase coverage rows are taken against. That is the one thing this
  // function must never do.
  //
  // It introduces no lock that was not already being taken: the snapshot's own
  // foreign key to `spec_records` has always taken a key-share lock on the
  // same rows a moment later. What changes is only how long it is held.
  // A record that is missing here is not an error: the loop below skips a
  // record with no atoms for the same reason.
  await txn`
    select id from spec_records
    where id = any(${ordered}::uuid[])
    order by id
    for update
  `;

  // What this transaction has already versioned. Keyed on the change as well
  // as the record, so a transaction that (unusually) works under two changes
  // still gives each its version, as the old unique did.
  const already = await txn`select current_setting('app.snapshotted_records', true) as seen`;
  const seen = new Set(
    String(already[0]?.seen ?? "")
      .split(",")
      .filter(Boolean),
  );
  const pending = ordered.filter((recordId) => !seen.has(`${changeSetId}:${recordId}`));
  if (pending.length === 0) return written;

  const atoms = await loadRecordAtoms(txn, pending);

  for (const recordId of pending) {
    const record = atoms.get(recordId);
    // A record deleted inside this transaction has no state to record. Nothing
    // in the app deletes one — retiring is a status — so this is defensive.
    if (!record) continue;

    const numbers = await txn`
      select coalesce(max(snapshot_no), 0) as last from record_snapshots where record_id = ${recordId}
    `;
    const next = Number(numbers[0]?.last ?? 0) + 1;

    const inserted = await txn`
      insert into record_snapshots
        (record_id, change_set_id, snapshot_no, schema_version, composer_version, atoms, cells)
      values
        (${recordId}, ${changeSetId}, ${next}, ${RECORD_ATOMS_SCHEMA_VERSION}, ${COMPOSER_VERSION},
         ${JSON.stringify(record)}::jsonb, ${JSON.stringify(composeStoredCells(record))}::jsonb)
      returning snapshot_no
    `;
    if (inserted[0]) {
      written.set(recordId, Number(inserted[0].snapshot_no));
      seen.add(`${changeSetId}:${recordId}`);
    }
  }

  // Published once, after the loop: the list only ever grows inside one
  // transaction, and `is_local = true` ends it with the transaction.
  await txn`select set_config('app.snapshotted_records', ${[...seen].join(",")}, true)`;

  return written;
}
