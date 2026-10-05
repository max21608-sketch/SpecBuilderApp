// What each item on a phase table IS, in one line: its size and its finishes.
//
// ============================================================================
// THE PHASE TABLE HAD NO SPEC ON IT.
//
// Max, 2026-10-05, reading the Aman pack: the rest of what a document says
// "will just go in relevant fields to fill out more details for each line item
// ... make sure ... it all appears in that line items overview as it should".
// The line items overview is the phase table, and until this it carried counts
// and nothing an item actually is. The bill review already showed the size and
// the finish codes as chips under each item's name; this is the same reading
// for a record that has been confirmed.
//
// BULK, ALWAYS. One statement for every record on the phase — never one per
// record — and the composition is `composeDimensionCell` in SCREEN mode, the
// one composer, so the phase table's cell is the record screen's cell is the
// export's figures. Measured on the largest local project (101 records):
// see the commit that added this.
//
// WHICH ROWS ARE "FINISHES". The groups that are not a dimension and not a
// note, carrying a code: the client's own `material_code`, or the library
// code the row is linked to. A finish with no code is still on the record and
// the record screen lists it; a chip with no code would say nothing a reader
// could check against a page.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import { isDimensionSlot, type AttributeState, type AttributeUnit } from "@/lib/spec-vocab";

export type SpecSummaryFinish = {
  code: string;
  /** The BWS field it lands in, or null where it lands in none. */
  field: string | null;
  /** What the document said, for the chip's title. */
  value: string | null;
};

export type SpecSummary = {
  /** `composeDimensionCell(..., { mode: "screen" }).text`, or "" where nothing is placed. */
  dimensions: string;
  /** The screen cell converted a feet-and-inches slot. */
  fromImperial: boolean;
  finishes: SpecSummaryFinish[];
};

export type SpecSummaryRow = {
  recordId: string;
  attrGroup: string;
  dimensionSlot: string | null;
  value: string | null;
  unit: string | null;
  state: string;
  sortOrder: number;
  materialCode: string | null;
  finishCode: string | null;
  fieldName: string | null;
};

export const EMPTY_SPEC_SUMMARY: SpecSummary = { dimensions: "", fromImperial: false, finishes: [] };

/** Pure: one record's rows and its typed dimension note, into the summary line. */
export function summariseSpecs(rows: readonly SpecSummaryRow[], dimensionNote: string | null): SpecSummary {
  const dimensionRows: DimensionRow[] = rows
    .filter((row) => row.attrGroup === "dimension" && row.dimensionSlot && isDimensionSlot(row.dimensionSlot))
    .map((row) => ({
      slot: row.dimensionSlot as DimensionRow["slot"],
      value: row.value,
      unit: (row.unit ?? null) as AttributeUnit | null,
      state: row.state as AttributeState,
      sortOrder: row.sortOrder,
    }));
  const cell =
    dimensionRows.length > 0 || (dimensionNote ?? "").trim()
      ? composeDimensionCell(dimensionRows, dimensionNote, { mode: "screen" })
      : null;

  const finishes: SpecSummaryFinish[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.attrGroup === "dimension" || row.attrGroup === "note") continue;
    const code = (row.finishCode ?? row.materialCode ?? "").trim();
    if (!code) continue;
    // One chip per code: a code on two fields (COM 1 and its piping) is one
    // finish, and two identical chips read as two.
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    finishes.push({ code, field: row.fieldName, value: row.value });
  }

  return { dimensions: cell?.text ?? "", fromImperial: cell?.fromImperial === true, finishes };
}

/** Every record's summary, in ONE statement. Absent from the map means nothing recorded. */
export async function loadSpecSummaries(
  exec: SqlLike,
  records: readonly { id: string; dimensionNote: string | null }[],
): Promise<Map<string, SpecSummary>> {
  const out = new Map<string, SpecSummary>();
  if (records.length === 0) return out;
  const rows = await exec`
    select a.record_id, a.attr_group, a.dimension_slot, a.value, a.unit, a.state, a.sort_order,
           a.material_code, fin.code as finish_code, f.name as field_name
      from record_attributes a
      left join project_finishes fin on fin.id = a.finish_id
      left join spec_fields f on f.id = a.spec_field_id
     where a.record_id = any(${records.map((record) => record.id)}::uuid[])
       and a.status = 'active'
       and a.attr_group <> 'note'
     order by a.record_id, a.attr_group, a.sort_order, a.created_at
  `;
  const byRecord = new Map<string, SpecSummaryRow[]>();
  for (const row of rows) {
    const recordId = String(row.record_id);
    const list = byRecord.get(recordId) ?? [];
    list.push({
      recordId,
      attrGroup: String(row.attr_group),
      dimensionSlot: row.dimension_slot === null || row.dimension_slot === undefined ? null : String(row.dimension_slot),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
      state: String(row.state),
      sortOrder: Number(row.sort_order ?? 0),
      materialCode: row.material_code === null || row.material_code === undefined ? null : String(row.material_code),
      finishCode: row.finish_code === null || row.finish_code === undefined ? null : String(row.finish_code),
      fieldName: row.field_name === null || row.field_name === undefined ? null : String(row.field_name),
    });
    byRecord.set(recordId, list);
  }
  for (const record of records) {
    const list = byRecord.get(record.id) ?? [];
    if (list.length === 0 && !(record.dimensionNote ?? "").trim()) continue;
    out.set(record.id, summariseSpecs(list, record.dimensionNote));
  }
  return out;
}
