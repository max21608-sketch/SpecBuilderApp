// What a bill's description plan is resolved against, loaded once for the two
// callers that plan it: the BOQ review's GET (what the reviewer is shown) and
// the confirm (what is written). One loader, so the screen and the commit
// cannot be handed different registers — the `loadExportScope` rule.
//
// Read only. Both queries run inside whatever the caller is: the neon client
// for the screen, the locked transaction for the confirm.
import type { SqlLike } from "@/lib/record-atoms";
import { specFieldEntries, type SpecFieldEntry } from "@/lib/drawing-document";
import { BILL_SPECS_REQUEST_PREFIX } from "@/lib/bill-rows";
import { isDimensionSlot } from "@/lib/spec-vocab";
import type { HeldAttributes, HeldSpecs } from "@/lib/bill-description";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import type { AttributeState, AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";
import { heldBillFinishKind } from "@/lib/bill-finish-kind";

/** The BWS field register, as the finish slots are resolved against it. */
export async function loadDescriptionFields(exec: SqlLike): Promise<SpecFieldEntry[]> {
  return specFieldEntries(await exec`select id, json_id, name from spec_fields order by json_id`);
}

/**
 * What each record a REVISION carries forward already holds, for
 * `revisionDescriptionRefusal`.
 *
 * `fromBill` is a specification a bill's DESCRIPTION wrote before — any active
 * attribute sourced to a bill of quantities other than a row a FINISH LINE
 * writes (a `material` row, or one shaped as `billFinishShape` writes a
 * timber, metal, hardware, trim or unsaid finish — a description always
 * writes something else too), or one from a charged read of a bill's own
 * file. The
 * slots and fields are every active one, from any document, because writing
 * over any of them would be a replace nobody chose.
 */
export async function loadHeldAttributes(exec: SqlLike, recordIds: string[]): Promise<Map<string, HeldAttributes>> {
  const held = new Map<string, HeldAttributes>();
  for (const id of recordIds) held.set(id, { fromBill: false, slots: [], fieldIds: [] });
  if (recordIds.length === 0) return held;
  const rows = await exec`
    select a.record_id, a.attr_group, a.label, a.dimension_slot, a.spec_field_id,
           r.source_kind, r.registration_request_id
    from record_attributes a
    left join intake_runs r on r.id = a.source_run_id
    where a.record_id = any(${recordIds}::uuid[]) and a.status = 'active'
  `;
  for (const row of rows) {
    const entry = held.get(String(row.record_id));
    if (!entry) continue;
    const fromBillDescription =
      row.source_kind === "boq_xlsx" &&
      heldBillFinishKind({ attrGroup: String(row.attr_group), label: String(row.label ?? "") }) === undefined;
    const fromBillRead = String(row.registration_request_id ?? "").startsWith(BILL_SPECS_REQUEST_PREFIX);
    if (fromBillDescription || fromBillRead) entry.fromBill = true;
    const slot = row.dimension_slot === null || row.dimension_slot === undefined ? null : String(row.dimension_slot);
    if (isDimensionSlot(slot)) entry.slots.push(slot);
    if (row.spec_field_id !== null && row.spec_field_id !== undefined && row.attr_group !== "dimension") {
      entry.fieldIds.push(String(row.spec_field_id));
    }
  }
  return held;
}

/**
 * What each carried record HOLDS NOW, for the review to say what a held-back
 * description states differently (RV2, `revisionDescriptionDifferences`): its
 * dimension cell, composed by the one composer over its active dimension
 * rows, and each finish field's code and value. Read only by the review GET;
 * the confirm still decides by `loadHeldAttributes`.
 */
export async function loadHeldSpecs(exec: SqlLike, recordIds: string[]): Promise<Map<string, HeldSpecs>> {
  const held = new Map<string, HeldSpecs>();
  if (recordIds.length === 0) return held;
  const rows = await exec`
    select record_id, attr_group, dimension_slot, value, unit, state, spec_field_id, material_code, sort_order
    from record_attributes
    where record_id = any(${recordIds}::uuid[]) and status = 'active'
    order by record_id, sort_order, created_at
  `;
  const dimensions = new Map<string, DimensionRow[]>();
  const fields = new Map<string, Map<string, { materialCode: string | null; value: string | null }>>();
  for (const row of rows) {
    const id = String(row.record_id);
    const slot = row.dimension_slot === null || row.dimension_slot === undefined ? null : String(row.dimension_slot);
    if (row.attr_group === "dimension" && isDimensionSlot(slot)) {
      const list = dimensions.get(id) ?? [];
      list.push({
        slot: slot as DimensionSlot,
        value: row.value === null || row.value === undefined ? null : String(row.value),
        unit: (row.unit ?? null) as AttributeUnit | null,
        state: String(row.state) as AttributeState,
        sortOrder: list.length,
      });
      dimensions.set(id, list);
    } else if (row.spec_field_id !== null && row.spec_field_id !== undefined) {
      const byField = fields.get(id) ?? new Map();
      if (!byField.has(String(row.spec_field_id))) {
        byField.set(String(row.spec_field_id), {
          materialCode: row.material_code ? String(row.material_code) : null,
          value: row.value === null || row.value === undefined ? null : String(row.value),
        });
      }
      fields.set(id, byField);
    }
  }
  for (const id of recordIds) {
    const list = dimensions.get(id) ?? [];
    held.set(id, {
      dimensionCell: list.length > 0 ? composeDimensionCell(list).text : "",
      fields: fields.get(id) ?? new Map(),
    });
  }
  return held;
}
