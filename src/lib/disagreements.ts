// Reading the disagreements between documents, for every screen that shows one.
//
// ============================================================================
// ONE LOADER, THREE SCREENS.
//
// 0046 keeps what a later document said beside the bill's value rather than
// instead of it (Max, 2026-10-05: "it needs to take in both ... keep them
// separate ... highlight them in red ... flag it up somewhere"). Three screens
// say so — the record's Specs tab lists each one, the phase table counts them
// per item, the project overview counts them per project — and the three are
// one file, so a tile can never say four over a table whose rows add up to
// three. The `loadOutstanding` rule, for a second kind of thing.
//
// WHAT COUNTS AS OPEN, said once and used by both counts: `status = 'open'`.
// The PROJECT count is further narrowed to live records on live phases, the
// population every other overview number is over — a disagreement on a
// retired item is not something the overview should send anybody to find. The
// per-RECORD count is not narrowed, because the phase table asks only about
// the records it is listing, retired ones included when somebody shows them.
//
// ---- A DISAGREEMENT MAY OUTLIVE THE VALUE IT DISAGREED WITH ---------------
//
// The held row can be retired after the disagreement was recorded: a
// correction, another disagreement settled with "use this instead", a revised
// drawing. The disagreement is still open — nobody decided it — but it now
// points at a row that is not the value. So every disagreement carries
// `currentAttributeId`: the held row if it is still live, otherwise the live
// row its supersession chain ends at, otherwise null. The record screen shows
// it under that live row as "was against the bill's value, now replaced", and
// the resolve library will only KEEP such a one, never USE it — using it would
// retire a value nobody compared it with.
//
// Read only. Every query runs on whatever the caller passes: the neon client
// for a screen, a transaction for anything that must agree with a write.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";

/** 0046's `attribute_disagreements_status_check`, in its own order. */
export const DISAGREEMENT_STATUSES = ["open", "kept_held", "used_this"] as const;
export type DisagreementStatus = (typeof DISAGREEMENT_STATUSES)[number];

/** The two ways a person settles one. */
export const DISAGREEMENT_DECISIONS = ["kept_held", "used_this"] as const;
export type DisagreementDecision = (typeof DISAGREEMENT_DECISIONS)[number];

export const DISAGREEMENT_DECISION_LABELS: Record<DisagreementDecision, string> = {
  kept_held: "kept the held value",
  used_this: "used this instead",
};

export function isDisagreementStatus(value: unknown): value is DisagreementStatus {
  return typeof value === "string" && (DISAGREEMENT_STATUSES as readonly string[]).includes(value);
}

export type Disagreement = {
  id: string;
  recordId: string;
  projectId: string;
  version: number;
  status: DisagreementStatus;
  /** The statement, in record_attributes' own shape. */
  attrGroup: string;
  label: string;
  value: string | null;
  unit: string | null;
  dimensionSlot: string | null;
  specFieldId: string | null;
  specFieldName: string | null;
  materialCode: string | null;
  state: string;
  /** Where it was said. Null where the document has since been deleted. */
  sourceRunId: string | null;
  sourcePage: number | null;
  sourceFilename: string | null;
  sourceDocumentKind: string | null;
  createdAt: string;
  /** The value it disagreed with, as it was. */
  heldAttributeId: string;
  heldStatus: string;
  heldVersion: number;
  heldLabel: string;
  heldValue: string | null;
  heldUnit: string | null;
  heldSourceDocumentKind: string | null;
  heldSourceFilename: string | null;
  /** The held value came off a bill of quantities — the screen then says "the bill's". */
  heldFromBill: boolean;
  /**
   * The LIVE row this disagreement sits under on the screen: the held row, or
   * the row its supersession chain ends at. Null where nothing replaced it.
   */
  currentAttributeId: string | null;
  /** Settled: who, when, why, and the row "use this" wrote. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedAttributeId: string | null;
  changeSetId: string | null;
  reason: string | null;
};

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const when = (value: unknown): string | null =>
  value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);

/**
 * Every disagreement on these records — open AND settled, because the record
 * screen shows the settled ones under "show retired" — newest first within a
 * record. Bulk: one statement however many records.
 */
export async function loadDisagreements(
  exec: SqlLike,
  recordIds: readonly string[],
  options: { openOnly?: boolean } = {},
): Promise<Disagreement[]> {
  if (recordIds.length === 0) return [];
  const openOnly = options.openOnly === true;
  const rows = await exec`
    with recursive chain as (
      -- From the held row, along superseded_by_id, until a live row. Bounded:
      -- a chain is one row per correction, and twenty is a record nobody has.
      select d.id as disagreement_id, a.id as attribute_id, a.status, a.superseded_by_id, 0 as depth
        from attribute_disagreements d
        join record_attributes a on a.id = d.held_attribute_id
       where d.record_id = any(${[...recordIds]}::uuid[])
         and (not ${openOnly}::boolean or d.status = 'open')
      union all
      select c.disagreement_id, a.id, a.status, a.superseded_by_id, c.depth + 1
        from chain c
        join record_attributes a on a.id = c.superseded_by_id
       where c.status <> 'active' and c.depth < 20
    ),
    live as (
      select distinct on (disagreement_id) disagreement_id, attribute_id
        from chain where status = 'active'
       order by disagreement_id, depth
    )
    select d.id, d.record_id, d.project_id, d.version, d.status,
           d.attr_group, d.label, d.value, d.unit, d.dimension_slot, d.spec_field_id,
           f.name as spec_field_name, d.material_code, d.state,
           d.source_run_id, d.source_page, src_at.filename as source_filename,
           src.document_kind as source_document_kind, d.created_at,
           d.held_attribute_id, h.status as held_status, h.version as held_version, h.label as held_label,
           h.value as held_value, h.unit as held_unit,
           held_src.document_kind as held_source_document_kind, held_at.filename as held_source_filename,
           held_src.source_kind as held_source_kind,
           live.attribute_id as current_attribute_id,
           d.resolved_at, d.resolved_by, d.resolved_attribute_id, d.change_set_id, cs.reason
      from attribute_disagreements d
      join record_attributes h on h.id = d.held_attribute_id
      left join live on live.disagreement_id = d.id
      left join spec_fields f on f.id = d.spec_field_id
      left join intake_runs src on src.id = d.source_run_id
      left join attachments src_at on src_at.id = src.attachment_id
      left join intake_runs held_src on held_src.id = h.source_run_id
      left join attachments held_at on held_at.id = held_src.attachment_id
      left join change_sets cs on cs.id = d.change_set_id
     where d.record_id = any(${[...recordIds]}::uuid[])
       and (not ${openOnly}::boolean or d.status = 'open')
     order by d.record_id, d.created_at desc, d.id
  `;
  return rows.map((row) => ({
    id: String(row.id),
    recordId: String(row.record_id),
    projectId: String(row.project_id),
    version: Number(row.version),
    status: isDisagreementStatus(row.status) ? row.status : "open",
    attrGroup: String(row.attr_group),
    label: String(row.label),
    value: text(row.value),
    unit: text(row.unit),
    dimensionSlot: text(row.dimension_slot),
    specFieldId: text(row.spec_field_id),
    specFieldName: text(row.spec_field_name),
    materialCode: text(row.material_code),
    state: String(row.state),
    sourceRunId: text(row.source_run_id),
    sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
    sourceFilename: text(row.source_filename),
    sourceDocumentKind: text(row.source_document_kind),
    createdAt: when(row.created_at) ?? "",
    heldAttributeId: String(row.held_attribute_id),
    heldStatus: String(row.held_status),
    heldVersion: Number(row.held_version),
    heldLabel: String(row.held_label),
    heldValue: text(row.held_value),
    heldUnit: text(row.held_unit),
    heldSourceDocumentKind: text(row.held_source_document_kind),
    heldSourceFilename: text(row.held_source_filename),
    heldFromBill: String(row.held_source_kind ?? "") === "boq_xlsx",
    currentAttributeId: text(row.current_attribute_id),
    resolvedAt: when(row.resolved_at),
    resolvedBy: text(row.resolved_by),
    resolvedAttributeId: text(row.resolved_attribute_id),
    changeSetId: text(row.change_set_id),
    reason: text(row.reason),
  }));
}

/** OPEN disagreements per record, for the phase table. Absent means none. */
export async function countOpenDisagreementsByRecord(
  exec: SqlLike,
  recordIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (recordIds.length === 0) return out;
  const rows = await exec`
    select record_id, count(*)::int as n
      from attribute_disagreements
     where record_id = any(${[...recordIds]}::uuid[]) and status = 'open'
     group by record_id
  `;
  for (const row of rows) out.set(String(row.record_id), Number(row.n));
  return out;
}

export type ProjectDisagreements = {
  /** Open disagreements on live records on live phases. */
  open: number;
  /** The first live phase, in phase order, that holds one — where the overview's tile lands. */
  firstRunId: string | null;
};

/** OPEN disagreements per project, for the overview. Absent means none. */
export async function countOpenDisagreementsByProject(
  exec: SqlLike,
  projectIds: readonly string[],
): Promise<Map<string, ProjectDisagreements>> {
  const out = new Map<string, ProjectDisagreements>();
  if (projectIds.length === 0) return out;
  const rows = await exec`
    select d.project_id,
           count(*)::int as n,
           (array_agg(run.id order by run.sort_order, run.created_at, run.id))[1] as first_run_id
      from attribute_disagreements d
      join spec_records r on r.id = d.record_id
      join spec_runs run on run.id = r.run_id
     where d.project_id = any(${[...projectIds]}::uuid[])
       and d.status = 'open'
       and r.status = 'active'
       and run.status = 'active'
     group by d.project_id
  `;
  for (const row of rows) {
    out.set(String(row.project_id), { open: Number(row.n), firstRunId: text(row.first_run_id) });
  }
  return out;
}
