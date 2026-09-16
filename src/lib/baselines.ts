// A named point in a project's history: "Issued to client, 16 Sep".
//
// ============================================================================
// A BASELINE IS A MATERIALISED SET, NOT A TIMESTAMP.
//
// The obvious implementation of "compare the 3rd with the 16th" is, for each
// record, the newest version with created_at <= that date. It is wrong, and
// subtly enough to survive a demo: created_at is TRANSACTION START time, and
// two guarded transactions that overlap can commit in the opposite order to
// their timestamps. A version would then land on the wrong side of a baseline
// taken between them, and a comparison would report a change that had already
// been made, or miss one that had not.
//
// So taking a baseline WRITES DOWN the exact version of every record in the
// project, while holding the project row lock — the same lock the BOQ confirm
// takes, so no record write can interleave. Comparing two baselines is then
// two exact sets and no inference at all.
//
// The cost is one row per record per baseline. A 60-record project taking a
// baseline a week for a year is 3,000 rows, which is nothing, and the
// alternative is a comparison nobody can fully trust.
//
// A record with NO version yet cannot be a member. That only happens between
// its creation and the end of the transaction that created it, which the lock
// makes unobservable — but it is why membership is a join rather than an
// assumption.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { diffSnapshots, parseAtoms, type SnapshotDiff } from "@/lib/snapshot-diff";
import type { SqlLike } from "@/lib/record-atoms";

export type TakeBaselineResult = { changeSetId: string; label: string; members: number };

export async function takeBaseline(
  txn: TxnSql,
  {
    projectId,
    label,
    reason,
    actor,
  }: { projectId: string; label: string; reason: string; actor: string },
): Promise<TakeBaselineResult> {
  const projects = await txn`select id from projects where id = ${projectId} for update`;
  if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });

  const changeSetId = await openChangeSet(txn, { projectId, kind: "baseline", label, reason, actor });

  // The newest version of every ACTIVE record. Retired records are out: a
  // baseline is what the project looked like, and a retired record is not part
  // of that any more — it shows up as "removed" when this baseline is compared
  // with an earlier one, which is exactly the right reading.
  const inserted = await txn`
    insert into baseline_members (change_set_id, record_id, snapshot_id)
    select ${changeSetId}, r.id, s.id
    from spec_records r
    join lateral (
      select id from record_snapshots
      where record_id = r.id
      order by snapshot_no desc
      limit 1
    ) s on true
    where r.project_id = ${projectId} and r.status = 'active'
    returning record_id
  `;

  return { changeSetId, label, members: inserted.length };
}

export type RecordComparison = {
  recordId: string;
  label: string;
  itemDescription: string;
  change: "added" | "removed" | "changed" | "unchanged";
  fromVersion: number | null;
  toVersion: number | null;
  diff: SnapshotDiff | null;
  unreadable: string | null;
};

export type ProjectComparison = {
  from: { changeSetId: string; label: string | null; kind: string; createdAt: string };
  to: { changeSetId: string; label: string | null; kind: string; createdAt: string };
  records: RecordComparison[];
  counts: { added: number; removed: number; changed: number; unchanged: number };
};

type Side = Map<string, { snapshotNo: number; atoms: unknown; label: string; itemDescription: string }>;

async function membersOf(exec: SqlLike, changeSetId: string): Promise<Side> {
  // A baseline names its members. Anything else — an ordinary change — is
  // taken as the versions IT produced, which is what "compare this change
  // against that one" means on a single change.
  const rows = await exec`
    select s.record_id, s.snapshot_no, s.atoms, r.record_no, r.item_description, p.bws_project_number
    from baseline_members m
    join record_snapshots s on s.id = m.snapshot_id
    join spec_records r on r.id = s.record_id
    join projects p on p.id = r.project_id
    where m.change_set_id = ${changeSetId}
  `;
  const out: Side = new Map();
  for (const row of rows) {
    out.set(String(row.record_id), {
      snapshotNo: Number(row.snapshot_no),
      atoms: row.atoms,
      label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
      itemDescription: String(row.item_description),
    });
  }
  return out;
}

/**
 * Every record's state at one change, for a change that is NOT a baseline.
 *
 * "As at this change" means: for each record, the newest version taken at or
 * before it. Ordered by snapshot_no within a record and by the change's own
 * creation between records — which is safe here in a way it is not for a
 * baseline, because this is a view of history rather than a set somebody will
 * sign off and refer back to.
 */
async function stateAt(exec: SqlLike, projectId: string, changeSetId: string): Promise<Side> {
  const rows = await exec`
    with mark as (select created_at from change_sets where id = ${changeSetId})
    select distinct on (s.record_id)
           s.record_id, s.snapshot_no, s.atoms, r.record_no, r.item_description, p.bws_project_number
    from record_snapshots s
    join change_sets cs on cs.id = s.change_set_id
    join spec_records r on r.id = s.record_id
    join projects p on p.id = r.project_id
    where r.project_id = ${projectId}
      and cs.created_at <= (select created_at from mark)
    order by s.record_id, s.snapshot_no desc
  `;
  const out: Side = new Map();
  for (const row of rows) {
    out.set(String(row.record_id), {
      snapshotNo: Number(row.snapshot_no),
      atoms: row.atoms,
      label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
      itemDescription: String(row.item_description),
    });
  }
  return out;
}

export async function compareChangeSets(
  exec: SqlLike,
  projectId: string,
  fromId: string,
  toId: string,
): Promise<ProjectComparison | { error: string }> {
  const rows = await exec`
    select id, kind, label, created_at from change_sets
    where project_id = ${projectId} and id in (${fromId}, ${toId})
  `;
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const fromRow = byId.get(fromId);
  const toRow = byId.get(toId);
  if (!fromRow || !toRow) return { error: "No such change on this project." };

  const side = async (row: Record<string, unknown>) =>
    String(row.kind) === "baseline" ? membersOf(exec, String(row.id)) : stateAt(exec, projectId, String(row.id));

  const before = await side(fromRow);
  const after = await side(toRow);

  const ids = new Set([...before.keys(), ...after.keys()]);
  const records: RecordComparison[] = [];
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  for (const id of ids) {
    const a = before.get(id);
    const b = after.get(id);
    const known = b ?? a;
    if (!known) continue;

    let change: RecordComparison["change"];
    let diff: SnapshotDiff | null = null;
    let unreadable: string | null = null;

    if (!a) change = "added";
    else if (!b) change = "removed";
    else if (a.snapshotNo === b.snapshotNo) change = "unchanged";
    else {
      try {
        diff = diffSnapshots(parseAtoms(a.atoms), parseAtoms(b.atoms));
        // Two different versions can still hold the same thing — a change that
        // touched a record without altering anything the diff reports. Saying
        // "changed" there would send somebody looking for a difference that is
        // not in the data.
        change = diff.isEmpty ? "unchanged" : "changed";
      } catch (cause) {
        change = "changed";
        unreadable = cause instanceof Error ? cause.message : "One of these versions could not be read.";
      }
    }

    counts[change] += 1;
    records.push({
      recordId: id,
      label: known.label,
      itemDescription: known.itemDescription,
      change,
      fromVersion: a?.snapshotNo ?? null,
      toVersion: b?.snapshotNo ?? null,
      diff,
      unreadable,
    });
  }

  // Changed first, then what came and went, then the rest — a reviewer opens
  // this to find what moved, and the unchanged records are the long tail.
  const rank: Record<RecordComparison["change"], number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  records.sort((x, y) => rank[x.change] - rank[y.change] || x.label.localeCompare(y.label));

  const end = (row: Record<string, unknown>) => ({
    changeSetId: String(row.id),
    label: row.label === null || row.label === undefined ? null : String(row.label),
    kind: String(row.kind),
    createdAt: new Date(String(row.created_at)).toISOString(),
  });

  return { from: end(fromRow), to: end(toRow), records, counts };
}
