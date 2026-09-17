// Loading what src/lib/gates.ts needs, for one record or for a whole run.
//
// ============================================================================
// ONE IMPLEMENTATION, TWO CALLERS — the same rule as questionTier.
//
// The record screen and the spec table both report gate status, and they must
// report the SAME status: a table saying TG0 is met over a record whose own
// screen lists three blockers is worse than either number alone. So the counts
// are not computed in SQL for the list and in JavaScript for the detail. The
// gate rules live in `gateStatus` and nothing else decides an outcome; this
// file only fetches.
//
// The category filtering IS in SQL, because `applies_to && array[code]` has a
// GIN index behind it and doing it in JavaScript would mean shipping all 35
// rows per category to filter them again.
//
// ---- A CATEGORY WITH NO MATRIX MAPPING GETS NULL, NOT AN EMPTY GATE ------
//
// Matthew's matrix covers nine upholstered seating categories. The eight
// cabinetry sheets are not in it and the cabinetry matrix is still to come, so
// those records have NO gate view — which the screens say in words. An empty
// field list would compute as "nothing outstanding", and a record reported
// TG0-ready because nobody has written its rules yet is the confidently-wrong
// failure the whole model exists to avoid. `gateStatus` refuses an empty list
// for the same reason; this returns null before it gets there.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import type { AnswerState } from "@/lib/spec-vocab";
import {
  gateStatus,
  GATES,
  type Gate,
  type GateAnswerInput,
  type GateField,
  type GateLocalInput,
  type GateSlotInput,
  type GateStatus,
} from "@/lib/gates";

export type GateContext = {
  /** Gate rows that apply, per item_categories.id. Absent = no matrix mapping. */
  fieldsByCategory: Map<string, GateField[]>;
  /** BWS field ids each category's checklist can actually ask. */
  askedByCategory: Map<string, Set<number>>;
  answersByRecord: Map<string, GateAnswerInput[]>;
  slotsByRecord: Map<string, GateSlotInput[]>;
  localsByRecord: Map<string, GateLocalInput>;
};

const EMPTY: GateContext = {
  fieldsByCategory: new Map(),
  askedByCategory: new Map(),
  answersByRecord: new Map(),
  slotsByRecord: new Map(),
  localsByRecord: new Map(),
};

export async function loadGateContext(exec: SqlLike, recordIds: string[]): Promise<GateContext> {
  if (recordIds.length === 0) return EMPTY;

  // One row per (category, gate row) that applies. The overlap is the union
  // rule: our sheet receives a field if ANY of Matthew's categories mapped to
  // it carries that field. db/seed/0005 names the two places that widens.
  const fieldRows = await exec`
    select m.item_category_id, g.matrix_row, g.gate, g.capture, g.field_name,
           f.json_id, g.local_key, g.dimension_slot, g.value_type,
           g.palette_key, g.palette_raw, g.conditional_on_key, g.conditional_on_value, g.notes
      from spec_field_gates g
      join spec_matrix_category_map m on g.applies_to && array[m.matrix_code]
      left join spec_fields f on f.id = g.spec_field_id
     group by m.item_category_id, g.matrix_row, g.gate, g.capture, g.field_name, f.json_id,
              g.local_key, g.dimension_slot, g.value_type, g.palette_key, g.palette_raw,
              g.conditional_on_key, g.conditional_on_value, g.notes
     order by m.item_category_id, g.matrix_row
  `;
  const fieldsByCategory = new Map<string, GateField[]>();
  for (const row of fieldRows) {
    const key = String(row.item_category_id);
    const list = fieldsByCategory.get(key) ?? [];
    list.push({
      matrixRow: Number(row.matrix_row),
      gate: String(row.gate) as Gate,
      capture: String(row.capture) as GateField["capture"],
      fieldName: String(row.field_name),
      specFieldJsonId: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
      localKey: row.local_key === null || row.local_key === undefined ? null : String(row.local_key),
      dimensionSlot: (row.dimension_slot ?? null) as GateField["dimensionSlot"],
      valueType: String(row.value_type) as GateField["valueType"],
      paletteKey: (row.palette_key ?? null) as string | null,
      paletteRaw: (row.palette_raw ?? null) as string | null,
      conditionalOnKey: (row.conditional_on_key ?? null) as string | null,
      conditionalOnValue: (row.conditional_on_value ?? null) as string | null,
      notes: (row.notes ?? null) as string | null,
    });
    fieldsByCategory.set(key, list);
  }

  // Which BWS fields each category's checklist can ask. A gate over a field
  // with no question is `unanswerable`, not `blocking` — the fix is a seed,
  // not a person.
  const askedRows = await exec`
    select r.category_id, f.json_id
      from requirements r join spec_fields f on f.id = r.spec_field_id
     where r.category_id = any(
       select category_id from spec_records where id = any(${recordIds}::uuid[]) and category_id is not null)
  `;
  const askedByCategory = new Map<string, Set<number>>();
  for (const row of askedRows) {
    const key = String(row.category_id);
    const set = askedByCategory.get(key) ?? new Set<number>();
    set.add(Number(row.json_id));
    askedByCategory.set(key, set);
  }

  const answerRows = await exec`
    select a.record_id, f.json_id, a.state, a.value
      from spec_answers a
      join requirements q on q.id = a.requirement_id
      join spec_fields f on f.id = q.spec_field_id
     where a.record_id = any(${recordIds}::uuid[]) and a.revision_no = 0
  `;
  const answersByRecord = new Map<string, GateAnswerInput[]>();
  for (const row of answerRows) {
    const key = String(row.record_id);
    const list = answersByRecord.get(key) ?? [];
    list.push({ specFieldJsonId: Number(row.json_id), state: String(row.state) as AnswerState, value: (row.value ?? null) as string | null });
    answersByRecord.set(key, list);
  }

  // A dimension is settled by the ATTRIBUTE that carries the slot, not by the
  // composed cell: "W840 x D790 x H720mm" is confirmed as a whole and says
  // nothing about whether a seat height was ever measured.
  const slotRows = await exec`
    select record_id, dimension_slot, state, value
      from record_attributes
     where record_id = any(${recordIds}::uuid[]) and status = 'active' and dimension_slot is not null
  `;
  const slotsByRecord = new Map<string, GateSlotInput[]>();
  for (const row of slotRows) {
    const key = String(row.record_id);
    const list = slotsByRecord.get(key) ?? [];
    list.push({
      dimensionSlot: String(row.dimension_slot) as GateSlotInput["dimensionSlot"],
      state: String(row.state) as GateSlotInput["state"],
      value: (row.value ?? null) as string | null,
    });
    slotsByRecord.set(key, list);
  }

  // Two of Matthew's ten id-less rows already have a home, and reporting them
  // unanswerable would be a lie: the item name IS the bill's own words, and
  // the designer reference IS the `designer` column. The other eight have
  // nowhere to go yet and say exactly that.
  const localRows = await exec`
    select id, item_description, designer from spec_records where id = any(${recordIds}::uuid[])
  `;
  const localsByRecord = new Map<string, GateLocalInput>();
  for (const row of localRows) {
    const description = String(row.item_description ?? "").trim();
    const designer = String(row.designer ?? "").trim();
    localsByRecord.set(String(row.id), {
      item_name: { state: description ? "confirmed" : "missing", value: description || null },
      designer_reference: { state: designer ? "confirmed" : "missing", value: designer || null },
    });
  }

  return { fieldsByCategory, askedByCategory, answersByRecord, slotsByRecord, localsByRecord };
}

/**
 * Every gate for one record, or null where its category is not on Matthew's
 * matrix. Null is a real answer and the screens print it as one.
 */
export function gatesForRecord(
  context: GateContext,
  record: { id: string; categoryId: string | null },
): Record<Gate, GateStatus> | null {
  if (!record.categoryId) return null;
  const fields = context.fieldsByCategory.get(record.categoryId);
  if (!fields || fields.length === 0) return null;

  const input = {
    answers: context.answersByRecord.get(record.id) ?? [],
    slots: context.slotsByRecord.get(record.id) ?? [],
    locals: context.localsByRecord.get(record.id) ?? {},
    askedFieldIds: context.askedByCategory.get(record.categoryId) ?? new Set<number>(),
  };

  const out = {} as Record<Gate, GateStatus>;
  for (const gate of GATES) {
    out[gate] = gateStatus(gate, fields.filter((f) => f.gate === gate), input);
  }
  return out;
}

/** What a table column needs: outstanding per gate, or null for no matrix view. */
export function gateSummary(statuses: Record<Gate, GateStatus> | null): Record<Gate, number> | null {
  if (!statuses) return null;
  const out = {} as Record<Gate, number>;
  for (const gate of GATES) {
    const c = statuses[gate].counts;
    out[gate] = c.blocking + c.unknown + c.unanswerable;
  }
  return out;
}
