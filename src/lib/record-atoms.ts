// What a spec record IS, loaded once and shaped once.
//
// ============================================================================
// WHY ONE LOADER
//
// Three things need to know what a record holds: the export, the check sheet,
// and a version snapshot. If a snapshot described a record differently from
// the export, then "what changed between the file we sent on the 3rd and the
// one we sent on the 16th" would be answered by comparing two things that were
// never the same shape — and a history that disagrees with the file is worse
// than no history, because it is believed.
//
// So the atoms here ARE the export's own shapes (ExportRecord,
// ExportAttribute, ExportAnswer), `composeRowCells` runs over a snapshot
// unchanged, and `loadExportScope` is this loader with a scope query in front
// of it.
//
// ---- WHY ALL THE ANSWERS, NOT JUST THE EXPORTABLE ONES -------------------
//
// The export wants confirmed answers that map to a BWS field. A history wants
// every answer, because "Dimensions went from missing to TBC" is exactly the
// kind of change somebody is looking for, and an atom set holding only the
// exportable ones could not show it. So the loader takes them all and
// `exportAnswers()` applies the export's filter in ONE place, rather than a
// WHERE clause here and a different one somewhere else.
// ============================================================================
import type { Row } from "@/lib/db";
import {
  isDimensionSlot,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type AnswerState,
  type RequirementKind,
} from "@/lib/spec-vocab";
import { isFinishKind } from "@/lib/finishes";
import type { ExportAnswer, ExportAttribute, ExportRecord, ExportScope } from "@/lib/bws-export";

/** Both drivers satisfy this: `sql` from db.ts and `TxnSql` from db-transaction.ts. */
export type SqlLike = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** Every answer on the record, whatever its state — see the header. */
export type SnapshotAnswer = {
  id: string;
  requirementId: string;
  prompt: string;
  section: string | null;
  kind: RequirementKind;
  specFieldJsonId: number | null;
  specFieldName: string | null;
  value: string | null;
  state: AnswerState;
  sourceKind: string;
  sourceId: string | null;
};

export type SnapshotRef = { system: string; value: string };

/**
 * One record, whole. This is what a `record_snapshots.atoms` column holds, so
 * every field added here needs a `schema_version` bump and an upgrade on read
 * — the same discipline as `upgradeDimensionSlots`.
 */
export type RecordAtoms = {
  schemaVersion: number;
  project: { number: string; name: string; client: string | null };
  record: ExportRecord;
  runId: string;
  runName: string;
  status: string;
  categoryId: string | null;
  categoryName: string | null;
  /** simple | complex | hero, or null where nobody has decided (0019). */
  level: string | null;
  productReference: string | null;
  designer: string | null;
  boqCategory: string | null;
  parentId: string | null;
  splitReason: string | null;
  refs: SnapshotRef[];
  attributes: ExportAttribute[];
  answers: SnapshotAnswer[];
  itemImage: { attachmentId: string; storagePath: string } | null;
};

/**
 * 1 — the original shape.
 * 2 — each attribute carries the finish its code resolves to (0018).
 * 3 — the record carries the item level a TGQ tier is read against (0019).
 *
 * Bumped whenever a field is added, and every addition since 1 is optional on
 * read, so an older version still parses rather than reading as "everything
 * was deleted that day".
 */
export const RECORD_ATOMS_SCHEMA_VERSION = 3;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Row → ExportAttribute. The single mapping; the export and a snapshot share it. */
export function toExportAttribute(row: Row): ExportAttribute {
  return {
    id: String(row.id),
    recordId: String(row.record_id),
    attrGroup: String(row.attr_group) as AttributeGroup,
    label: String(row.label),
    value: text(row.value),
    unit: text(row.unit) as AttributeUnit | null,
    dimensionSlot: isDimensionSlot(row.dimension_slot) ? row.dimension_slot : null,
    materialCode: text(row.material_code),
    // The library entry, when this attribute is linked to one. Loaded with the
    // attribute rather than resolved later, so a snapshot holds what the
    // finish said ON THE DAY — which is how a version can show "CH-01.1 went
    // from TBC to Yarn Tessarae" rather than silently re-rendering history.
    finish: row.finish_id
      ? {
          id: String(row.finish_id),
          code: String(row.finish_code),
          codeNorm: String(row.finish_code_norm),
          kind: isFinishKind(row.finish_kind) ? row.finish_kind : null,
          description: text(row.finish_description),
          supplierRaw: text(row.finish_supplier_raw),
          reference: text(row.finish_reference),
          colour: text(row.finish_colour),
          state: String(row.finish_state) as AttributeState,
        }
      : null,
    specFieldJsonId: num(row.json_id),
    state: String(row.state) as AttributeState,
    sortOrder: Number(row.sort_order),
    sourceFilename: text(row.source_filename),
    sourcePage: num(row.source_page),
  };
}

export function toSnapshotAnswer(row: Row): SnapshotAnswer {
  return {
    id: String(row.id),
    requirementId: String(row.requirement_id),
    prompt: String(row.prompt),
    section: text(row.section),
    kind: String(row.kind) as RequirementKind,
    specFieldJsonId: num(row.json_id),
    specFieldName: text(row.field_name)?.trim() ?? null,
    value: text(row.value),
    state: String(row.state) as AnswerState,
    sourceKind: String(row.source_kind),
    sourceId: text(row.source_id),
  };
}

/**
 * The export's view of a record's answers: confirmed, and mapping to a BWS
 * field. `na` is settled but carries no value; `tbc` and `missing` are not
 * answers to export.
 */
export function exportAnswers(atoms: RecordAtoms): ExportAnswer[] {
  return atoms.answers
    .filter((answer) => answer.state === "confirmed" && answer.specFieldJsonId !== null)
    .map((answer) => ({
      recordId: atoms.record.id,
      specFieldJsonId: answer.specFieldJsonId as number,
      value: answer.value,
    }));
}

/** An ExportScope holding exactly one record, so composeRowCells runs over a snapshot. */
export function scopeForAtoms(atoms: RecordAtoms): ExportScope {
  return {
    projectName: atoms.project.name,
    client: atoms.project.client,
    runName: atoms.runName,
    records: [atoms.record],
    attributes: atoms.attributes,
    answers: exportAnswers(atoms),
  };
}

/**
 * Every atom for the given records, in one set of queries.
 *
 * Works on either driver, so the export (HTTP) and a confirm transaction
 * (`pg`) load the same thing.
 */
export async function loadRecordAtoms(exec: SqlLike, recordIds: string[]): Promise<Map<string, RecordAtoms>> {
  const out = new Map<string, RecordAtoms>();
  if (recordIds.length === 0) return out;

  const recordRows = await exec`
    select r.id, r.record_no, r.item_description, r.product_reference, r.qty, r.designer, r.area,
           r.boq_category, r.status, r.category_id, r.level, r.run_id, r.parent_id, r.split_reason,
           r.variant_label,
           p.bws_project_number, p.name as project_name, p.client,
           run.name as run_name,
           c.name as category_name,
           -- A VARIANT READS ITS PARENT'S CODES. S-201 A deliberately carries
           -- no boq_code ref of its own: copying the client ref onto two
           -- variants would put three records with that ref on one run and
           -- every drawing card for it would resolve as ambiguous. The ref is
           -- still the client's key for the thing, so the export's Client Code
           -- has to find it -- without this, every split item shipped a blank
           -- one. Only boq_code is redirected; a bws_job ref belongs to the
           -- variant that earned it.
           coalesce((select array_agg(x.ref_value order by x.ref_value)
                       from spec_record_refs x
                      where x.record_id = coalesce(r.parent_id, r.id)
                        and x.ref_system = 'boq_code'), '{}') as boq_codes
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    where r.id = any(${recordIds}::uuid[])
    order by r.record_no
  `;

  for (const row of recordRows) {
    const id = String(row.id);
    out.set(id, {
      schemaVersion: RECORD_ATOMS_SCHEMA_VERSION,
      project: {
        number: String(row.bws_project_number),
        name: String(row.project_name),
        client: text(row.client),
      },
      record: {
        id,
        recordNo: Number(row.record_no),
        label: `${String(row.bws_project_number)}-${String(row.record_no).padStart(3, "0")}`,
        itemDescription: String(row.item_description),
        qty: num(row.qty),
        area: text(row.area),
        runName: String(row.run_name),
        boqCodes: (row.boq_codes as string[] | null)?.map(String) ?? [],
        variantLabel: text(row.variant_label),
      },
      runId: String(row.run_id),
      runName: String(row.run_name),
      status: String(row.status),
      categoryId: text(row.category_id),
      categoryName: text(row.category_name),
      level: text(row.level),
      productReference: text(row.product_reference),
      designer: text(row.designer),
      boqCategory: text(row.boq_category),
      parentId: text(row.parent_id),
      splitReason: text(row.split_reason),
      refs: [],
      attributes: [],
      answers: [],
      itemImage: null,
    });
  }

  const found = [...out.keys()];
  if (found.length === 0) return out;

  const refRows = await exec`
    select record_id, ref_system, ref_value from spec_record_refs
    where record_id = any(${found}::uuid[])
    order by ref_system, ref_value
  `;
  for (const row of refRows) {
    out.get(String(row.record_id))?.refs.push({ system: String(row.ref_system), value: String(row.ref_value) });
  }

  const attributeRows = await exec`
    select a.id, a.record_id, a.attr_group, a.label, a.value, a.unit, a.dimension_slot, a.material_code,
           a.state, a.sort_order, a.source_page, f.json_id, at.filename as source_filename,
           a.finish_id, fin.code as finish_code, fin.code_norm as finish_code_norm, fin.kind as finish_kind,
           fin.description as finish_description, fin.supplier_raw as finish_supplier_raw,
           fin.reference as finish_reference, fin.colour as finish_colour, fin.state as finish_state
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join project_finishes fin on fin.id = a.finish_id
    left join intake_runs ir on ir.id = a.source_run_id
    left join attachments at on at.id = ir.attachment_id
    where a.record_id = any(${found}::uuid[]) and a.status = 'active'
    order by a.sort_order, a.created_at
  `;
  for (const row of attributeRows) {
    out.get(String(row.record_id))?.attributes.push(toExportAttribute(row));
  }

  const answerRows = await exec`
    select a.id, a.record_id, a.requirement_id, a.value, a.state, a.source_kind, a.source_id,
           q.prompt, q.section, q.kind, f.json_id, f.name as field_name
    from spec_answers a
    join requirements q on q.id = a.requirement_id
    left join spec_fields f on f.id = a.spec_field_id
    where a.record_id = any(${found}::uuid[]) and a.revision_no = 0
    order by q.section nulls last, q.sort_order
  `;
  for (const row of answerRows) {
    out.get(String(row.record_id))?.answers.push(toSnapshotAnswer(row));
  }

  // The crop somebody confirmed off the drawings. Its storage_path is stored
  // beside the id because an attachment can be superseded, and a version that
  // pointed only at an id would lose the picture it was taken with.
  const imageRows = await exec`
    select entity_id, id, storage_path from attachments
    where entity_type = 'spec_records' and entity_id = any(${found}::uuid[]) and kind = 'item_image'
  `;
  for (const row of imageRows) {
    const atoms = out.get(String(row.entity_id));
    if (atoms) atoms.itemImage = { attachmentId: String(row.id), storagePath: String(row.storage_path) };
  }

  return out;
}
