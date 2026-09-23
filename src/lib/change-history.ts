// Reading the trail: what changed, when, by whom, why, and off what document.
//
// ============================================================================
// THE DIFFS ARE COMPUTED, NEVER STORED.
//
// Same rule as blockers and as Overdue. A stored diff is a third description
// of a change, and it goes stale the moment `composeRowCells` changes — so the
// history would start disagreeing with the export about records nobody had
// touched. `diffSnapshots` runs on read, over the atoms both versions hold.
//
// The cost is real: rendering a record's whole history composes 109 cells per
// version twice. It is bounded by how many times one record has changed, which
// is small, and the alternative is a cache that can be wrong.
// ============================================================================
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { diffSnapshots, parseAtoms, type SnapshotDiff } from "@/lib/snapshot-diff";
import { CHANGE_SET_KIND_LABELS, isChangeSetKind, type ChangeSetKind } from "@/lib/change-sets";
import type { SqlLike } from "@/lib/record-atoms";

export type ChangeSetSummary = {
  id: string;
  kind: ChangeSetKind | string;
  kindLabel: string;
  reason: string | null;
  label: string | null;
  actor: string;
  createdAt: string;
  closedAt: string | null;
  source: { intakeRunId: string; filename: string | null; documentKind: string | null } | null;
  evidence: { attachmentId: string; filename: string | null } | null;
};

export type RecordVersion = ChangeSetSummary & {
  snapshotNo: number;
  /** Against the version before it. Null on the first, which has nothing to compare to. */
  diff: SnapshotDiff | null;
  /** Set when a version cannot be read — a newer build wrote it, or the jsonb is malformed. */
  unreadable: string | null;
};

function label(kind: unknown): string {
  return isChangeSetKind(kind) ? CHANGE_SET_KIND_LABELS[kind] : String(kind);
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function summarise(row: Record<string, unknown>): ChangeSetSummary {
  return {
    id: String(row.change_set_id ?? row.id),
    kind: String(row.kind),
    kindLabel: label(row.kind),
    reason: text(row.reason),
    label: text(row.change_label),
    actor: String(row.actor),
    createdAt: new Date(String(row.created_at)).toISOString(),
    closedAt: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
    source: row.source_intake_run_id
      ? {
          intakeRunId: String(row.source_intake_run_id),
          filename: text(row.source_filename),
          documentKind: text(row.source_document_kind),
        }
      : null,
    evidence: row.evidence_attachment_id
      ? { attachmentId: String(row.evidence_attachment_id), filename: text(row.evidence_filename) }
      : null,
  };
}

/**
 * Every version of one record, newest first, each with the diff that produced
 * it.
 *
 * A version that cannot be parsed is REPORTED rather than skipped. Dropping it
 * would renumber the history on screen and hide the fact that something is
 * wrong with it.
 */
export async function loadRecordHistory(exec: SqlLike, recordId: string): Promise<RecordVersion[]> {
  const rows = await exec`
    select s.snapshot_no, s.atoms, s.schema_version,
           cs.id as change_set_id, cs.kind, cs.reason, cs.label as change_label, cs.actor,
           cs.created_at, cs.closed_at, cs.source_intake_run_id, cs.evidence_attachment_id,
           src.filename as source_filename, ir.document_kind as source_document_kind,
           ev.filename as evidence_filename
    from record_snapshots s
    join change_sets cs on cs.id = s.change_set_id
    left join intake_runs ir on ir.id = cs.source_intake_run_id
    left join attachments src on src.id = ir.attachment_id
    left join attachments ev on ev.id = cs.evidence_attachment_id
    where s.record_id = ${recordId}
    order by s.snapshot_no
  `;

  const versions: RecordVersion[] = [];
  let previous: ReturnType<typeof parseAtoms> | null = null;

  for (const row of rows) {
    const summary = summarise(row);
    let diff: SnapshotDiff | null = null;
    let unreadable: string | null = null;
    let current: ReturnType<typeof parseAtoms> | null = null;
    try {
      current = parseAtoms(row.atoms);
      if (previous) diff = diffSnapshots(previous, current);
    } catch (cause) {
      unreadable = cause instanceof Error ? cause.message : "This version could not be read.";
    }
    versions.push({ ...summary, snapshotNo: Number(row.snapshot_no), diff, unreadable });
    if (current) previous = current;
  }

  return versions.reverse();
}

/** One diff between any two versions of a record. */
export async function compareRecordVersions(
  exec: SqlLike,
  recordId: string,
  from: number,
  to: number,
): Promise<{ from: number; to: number; diff: SnapshotDiff } | { error: string }> {
  const rows = await exec`
    select snapshot_no, atoms from record_snapshots
    where record_id = ${recordId} and snapshot_no in (${from}, ${to})
    order by snapshot_no
  `;
  const byNo = new Map(rows.map((row) => [Number(row.snapshot_no), row.atoms]));
  const a = byNo.get(from);
  const b = byNo.get(to);
  if (a === undefined || b === undefined) return { error: "No such version of this record." };
  try {
    return { from, to, diff: diffSnapshots(parseAtoms(a), parseAtoms(b)) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "One of those versions could not be read." };
  }
}

export type ProjectChange = ChangeSetSummary & {
  /** How many records this change produced a version of. */
  recordsChanged: number;
  records: { id: string; label: string; snapshotNo: number }[];
};

/**
 * The project's whole trail, newest first.
 *
 * Bounded by `limit` because a project accumulates one of these per edit, and
 * a screen that loads four thousand of them is a screen nobody opens twice.
 */
export async function loadProjectHistory(
  exec: SqlLike,
  projectId: string,
  { runId = null, limit = 100 }: { runId?: string | null; limit?: number } = {},
): Promise<ProjectChange[]> {
  const rows = await exec`
    select cs.id as change_set_id, cs.kind, cs.reason, cs.label as change_label, cs.actor,
           cs.created_at, cs.closed_at, cs.source_intake_run_id, cs.evidence_attachment_id,
           src.filename as source_filename, ir.document_kind as source_document_kind,
           ev.filename as evidence_filename
    from change_sets cs
    left join intake_runs ir on ir.id = cs.source_intake_run_id
    left join attachments src on src.id = ir.attachment_id
    left join attachments ev on ev.id = cs.evidence_attachment_id
    where cs.project_id = ${projectId}
      and (${runId}::uuid is null or exists (
            select 1 from record_snapshots s
            join spec_records r on r.id = s.record_id
            where s.change_set_id = cs.id and r.run_id = ${runId}::uuid))
    order by cs.created_at desc, cs.id desc
    limit ${limit}
  `;
  if (rows.length === 0) return [];

  const ids = rows.map((row) => String(row.change_set_id));
  const touched = await exec`
    select s.change_set_id, s.record_id, s.snapshot_no, r.record_no, p.bws_project_number,
           r.variant_ordinal, (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no
    from record_snapshots s
    join spec_records r on r.id = s.record_id
    join projects p on p.id = r.project_id
    where s.change_set_id = any(${ids}::uuid[])
    order by coalesce((select p2.record_no from spec_records p2 where p2.id = r.parent_id), r.record_no), r.variant_ordinal nulls first, r.record_no
  `;
  const byChange = new Map<string, ProjectChange["records"]>();
  for (const row of touched) {
    const key = String(row.change_set_id);
    const list = byChange.get(key) ?? [];
    list.push({
      id: String(row.record_id),
      label: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
      snapshotNo: Number(row.snapshot_no),
    });
    byChange.set(key, list);
  }

  return rows.map((row) => {
    const records = byChange.get(String(row.change_set_id)) ?? [];
    return { ...summarise(row), recordsChanged: records.length, records };
  });
}
