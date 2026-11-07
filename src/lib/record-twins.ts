// Two bill lines that are ONE item to make (0060).
//
// ============================================================================
// A TWIN IS A LINK, NEVER A MERGE.
//
// Max, 2026-10-12: GR-FUR-13 and PL-FUR-13 are the same stool on two lines of
// the Aman bill, one per suite. "Keep them as separate lines in case one
// changes, but link them better, so a spec is added to both at once." Before
// this, every fix to one of the pair was made twice or missed once (the
// spec-change audit's finding 9).
//
// So the two lines stay two records — quantity, area, client ref, export row
// and every spec their own — and `spec_record_twins` says only that one
// person's act on one of them is OFFERED on the other. Nothing that reads
// specs reads this file: the export, the gates, TGQ, the chase and the history
// see two records exactly as before. The three places that DO read it are the
// person's writers (Add a spec, Edit value, Retire: `twin-offer.ts`), the
// drawing resolution (two twinned lines of one phase are one item, not SX11A),
// and the bill review's suggestion.
//
// ---- WHAT CAN GO WRONG, AND WHERE IT IS HELD -------------------------------
//
//   * A link onto a CONFIGURATION would be a second route to an item its bill
//     line already reaches. Refused here in words and by 0060's trigger.
//   * A link written twice. The pair index is symmetric (least, greatest) and
//     covers retired rows, so linking a pair that was unlinked RESTORES its
//     row: one pair, one history.
//   * A link nobody saw. The bill review only SUGGESTS (`suggestTwins`) and the
//     confirm writes a link only from a line a person accepted; the level and
//     category rule.
//   * The lock order. Both records are locked in id order (`record-lock.ts`)
//     before the link row, the order every records-first writer keeps, so a
//     link made while somebody corrects a spec on either line waits rather
//     than deadlocks.
//
// A link changes no spec, so it takes NO record version and is not one of the
// spec-content tables `tests/db/change-history.test.ts` counts. It is still a
// change set (`twin_link` / `twin_unlink`, reason required): it says two lines
// of a bill are one item, or that they are not, and that is somebody's
// statement about what the bill meant.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit } from "@/lib/change-sets";
import { lockRecords } from "@/lib/record-lock";
import { recordLabel } from "@/lib/record-label";

export const TWIN_STATUSES = ["active", "retired"] as const;
export type TwinStatus = (typeof TWIN_STATUSES)[number];

/** One twin of a record, as the record screen lists it. */
export type TwinLink = {
  /** The link row. */
  twinId: string;
  version: number;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  /** The OTHER record. */
  recordId: string;
  label: string;
  itemDescription: string;
  boqCodes: string[];
  runId: string;
  runName: string;
  area: string | null;
  qty: number | null;
  qtyRaw: string | null;
};

export type LinkTwinsResult = { twinId: string; changeSetId: string; restored: boolean };

/**
 * Says two bill lines are one item. A reason is required (an open change
 * satisfies it, as everywhere).
 *
 * `changeSetId` is for the bill confirm, which links in the change set that
 * created the records: the caller owns it and has published it.
 */
export async function linkTwins(
  txn: TxnSql,
  {
    recordId,
    otherId,
    reason,
    actor,
    changeSetId: attachTo,
  }: { recordId: string; otherId: string; reason: string | null; actor: string; changeSetId?: string },
): Promise<LinkTwinsResult> {
  if (recordId === otherId) {
    throw new DomainConflictError("twin_self", "A line cannot be a twin of itself.", { status: 400 });
  }
  await lockRecords(txn, [recordId, otherId]);
  const rows = await txn`
    select id, project_id, parent_id, status from spec_records where id in (${recordId}, ${otherId})
  `;
  const one = rows.find((row) => String(row.id) === recordId);
  const other = rows.find((row) => String(row.id) === otherId);
  if (!one || !other) throw new DomainConflictError("not_found", "No such item.", { status: 404 });
  if (String(one.project_id) !== String(other.project_id)) {
    throw new DomainConflictError("twin_other_project", "A twin has to be a line of the same project.", { status: 400 });
  }
  // A configuration reaches its bill line's twins through `parent_id`; a link
  // of its own would be a second route to the same item. Said in words here
  // before 0060's trigger says it in SQLSTATE.
  if (one.parent_id || other.parent_id) {
    throw new DomainConflictError(
      "twin_not_a_line",
      "Only a bill line can be a twin. Link the line this configuration belongs to; its configurations follow it.",
      { status: 400 },
    );
  }
  if (String(one.status) !== "active" || String(other.status) !== "active") {
    throw new DomainConflictError("record_retired", "One of these items has been retired. Restore it first.", { status: 400 });
  }

  const projectId = String(one.project_id);
  const existing = await txn`
    select id, status from spec_record_twins
     where least(record_a, record_b) = least(${recordId}::uuid, ${otherId}::uuid)
       and greatest(record_a, record_b) = greatest(${recordId}::uuid, ${otherId}::uuid)
       for update
  `;
  if (existing[0] && String(existing[0].status) === "active") {
    throw new DomainConflictError("already_twins", "These two lines are already twins.");
  }

  const { changeSetId } = attachTo
    ? { changeSetId: attachTo }
    : await changeSetForEdit(txn, { projectId, actor, kind: "twin_link", reason });
  const why = reason?.trim() || "Linked as twins";

  if (existing[0]) {
    // THE PAIR'S OWN ROW COMES BACK. The index covers retired rows, so a pair
    // has one history: linked, unlinked with a reason, linked again.
    await txn`
      update spec_record_twins
         set status = 'active', reason = ${why}, retired_at = null, retired_by = null, retire_reason = null,
             updated_by = ${actor}
       where id = ${existing[0].id}
    `;
    return { twinId: String(existing[0].id), changeSetId, restored: true };
  }
  const inserted = await txn`
    insert into spec_record_twins (project_id, record_a, record_b, reason, created_by, updated_by)
    values (${projectId}, ${recordId}, ${otherId}, ${why}, ${actor}, ${actor})
    returning id
  `;
  return { twinId: String(inserted[0]!.id), changeSetId, restored: false };
}

/** Says two lines are NOT one item after all. Retired, never deleted; a reason is required. */
export async function unlinkTwins(
  txn: TxnSql,
  { twinId, expectedVersion, reason, actor }: { twinId: string; expectedVersion: number; reason: string | null; actor: string },
): Promise<{ twinId: string; changeSetId: string }> {
  const ends = await txn`select record_a, record_b, project_id from spec_record_twins where id = ${twinId}`;
  if (!ends[0]) throw new DomainConflictError("not_found", "No such twin link.", { status: 404 });
  await lockRecords(txn, [String(ends[0].record_a), String(ends[0].record_b)]);
  const rows = await txn`select id, status, version from spec_record_twins where id = ${twinId} for update`;
  const link = rows[0]!;
  if (String(link.status) !== "active") {
    throw new DomainConflictError("already_unlinked", "These two lines are no longer twins. Reload.");
  }
  if (Number(link.version) !== expectedVersion) {
    throw new DomainConflictError("twin_version_stale", "This twin link changed while you had it open. Reload.");
  }
  const { changeSetId } = await changeSetForEdit(txn, {
    projectId: String(ends[0].project_id),
    actor,
    kind: "twin_unlink",
    reason,
  });
  // The retire reason is the change's own reason, or the open change's where
  // the person is working under one: either way the link row says why.
  const own = reason?.trim()
    ? reason.trim()
    : String((await txn`select reason from change_sets where id = ${changeSetId}`)[0]?.reason ?? "").trim();
  await txn`
    update spec_record_twins
       set status = 'retired', retired_at = now(), retired_by = ${actor}, retire_reason = ${own || "Unlinked"},
           updated_by = ${actor}
     where id = ${twinId} and version = ${expectedVersion} and status = 'active'
  `;
  return { twinId, changeSetId };
}

/**
 * The live twins of a record: active links whose other end is an active
 * record. A CONFIGURATION is answered with its bill line's twins (0060: a
 * configuration carries its parent's twins, as it carries its client ref).
 *
 * A retired record's links stay as history and are not followed.
 */
export async function twinsOf(db: TxnSql, recordId: string): Promise<TwinLink[]> {
  const rows = await db`
    with me as (
      select coalesce(r.parent_id, r.id) as line_id from spec_records r where r.id = ${recordId}
    )
    select t.id as twin_id, t.version, t.reason, t.created_by, t.created_at::text as created_at,
           o.id, o.record_no, o.item_description, o.area, o.qty, o.qty_raw, o.run_id, run.name as run_name,
           p.bws_project_number,
           coalesce((select array_agg(x.ref_value order by x.ref_value)
                       from spec_record_refs x where x.record_id = o.id and x.ref_system = 'boq_code'), '{}') as boq_codes
      from me
      join spec_record_twins t on t.status = 'active' and (t.record_a = me.line_id or t.record_b = me.line_id)
      join spec_records o on o.id = case when t.record_a = me.line_id then t.record_b else t.record_a end
      join spec_runs run on run.id = o.run_id
      join projects p on p.id = o.project_id
     where o.status = 'active'
     order by run.sort_order, o.record_no
  `;
  return rows.map((row) => ({
    twinId: String(row.twin_id),
    version: Number(row.version),
    reason: String(row.reason),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    createdAt: String(row.created_at),
    recordId: String(row.id),
    label: recordLabel(String(row.bws_project_number), Number(row.record_no)),
    itemDescription: String(row.item_description),
    boqCodes: ((row.boq_codes as unknown[] | null) ?? []).map(String),
    runId: String(row.run_id),
    runName: String(row.run_name),
    area: row.area === null || row.area === undefined ? null : String(row.area),
    qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
    qtyRaw: row.qty_raw === null || row.qty_raw === undefined ? null : String(row.qty_raw),
  }));
}

/**
 * The ids of the bill lines a record's act may be offered on, read under the
 * caller's lock. The writers' server half: whatever the screen sent, an id is
 * only written to if it is in this set at commit.
 */
export async function liveTwinIds(txn: TxnSql, recordId: string): Promise<Set<string>> {
  return new Set((await twinsOf(txn, recordId)).map((twin) => twin.recordId));
}

/**
 * Every live twin link of a project, as record id -> the ids it is twinned
 * with. ONE read for a whole pack, and the one way a records register learns
 * its twins (`RecordEntry.twinIds`): the review screen's registers and the
 * drawings confirm both call it, so the card and the confirm resolve over the
 * same links. Both ends must be active; a retired record's links are history.
 */
export async function loadTwinIds(db: TxnSql, projectId: string): Promise<Map<string, string[]>> {
  const rows = await db`
    select t.record_a, t.record_b
      from spec_record_twins t
      join spec_records a on a.id = t.record_a and a.status = 'active'
      join spec_records b on b.id = t.record_b and b.status = 'active'
     where t.project_id = ${projectId} and t.status = 'active'
  `;
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const a = String(row.record_a);
    const b = String(row.record_b);
    out.set(a, [...(out.get(a) ?? []), b]);
    out.set(b, [...(out.get(b) ?? []), a]);
  }
  return out;
}

/** The register with each record's twins on it. A record with none keeps no key, so other payloads are unchanged. */
export function withTwinIds<T extends { id: string }>(records: T[], twins: ReadonlyMap<string, string[]>): (T & { twinIds?: string[] })[] {
  if (twins.size === 0) return records;
  return records.map((record) => {
    const ids = twins.get(record.id);
    return ids ? { ...record, twinIds: [...ids].sort() } : record;
  });
}

// The bill review's suggestion lives in the leaf `twin-suggest.ts`, so the
// review screen can read it without pulling this file's database imports into
// the browser. Re-exported for the server callers.
export { acceptedTwinPairs, suggestTwins, type TwinCandidateLine, type TwinSuggestion } from "@/lib/twin-suggest";
