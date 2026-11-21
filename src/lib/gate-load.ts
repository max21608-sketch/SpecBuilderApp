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
// GIN index behind it and doing it in JavaScript would mean shipping every
// row per category to filter them again.
//
// ---- "ALL CATEGORIES" WIDENS BY A GENERATED COLUMN (0061) -----------------
//
// Every join onto a type is `g.applies_to_all or g.applies_to && array[code]`.
// His "All categories" rows hold his nine codes literally, so the overlap
// alone gave the eight provisional cabinetry types (seed 0014) their drafted
// rows and NONE of his dimensions, designer reference or production lock: a
// side table read priceable once its four drafted questions were answered.
// `applies_to_all` is generated from his own phrase, so no seed edits his rows.
// The same predicate is in `loadTgqMatrices` below and in
// `project-summary.ts`; a copy without it is the defect again.
//
// ---- A CATEGORY WITH NO MATRIX MAPPING GETS NULL, NOT AN EMPTY GATE ------
//
// Since seed 0014 every seeded cheat sheet is on a gate model: Matthew's nine
// seating types and the eight AI-drafted cabinetry types. A category added
// later, before anybody maps it, still has NO gate view — which the screens
// say in words. An empty field list would compute as "nothing outstanding",
// and a record reported TG0-ready because nobody has written its rules yet is
// the confidently-wrong failure the whole model exists to avoid. `gateStatus`
// refuses an empty list for the same reason; this returns null before it gets
// there.
//
// ---- A PROVISIONAL TYPE SAYS SO, AND THE WORDS ARE DATA -------------------
//
// `spec_matrix_categories.provisional_note` (0061) is the sentence a screen
// prints wherever a gate view or a TGQ count comes from a type nobody has
// confirmed. It travels in the context (`typesByCategory`) and is read by
// `provisionalNoteFor`; no screen holds the sentence as a constant or decides
// it from a row number, so the day Matthew confirms the model is a re-seed.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import { loadQuestionRoutes, routedAudience, type QuestionRoutes } from "@/lib/question-audience-routes";
import { normaliseQuestionAudience, type AnswerState } from "@/lib/spec-vocab";
import type { SheetTgqMatrix } from "@/lib/tgq";
import { effectiveMatrixType } from "@/lib/matrix-type";
import { itemTgq, type ItemTgq, type ItemTgqOutstanding, type ItemTgqQuestion } from "@/lib/item-tgq";
import {
  chainGates,
  gateStatus,
  GATES,
  type Gate,
  type GateAnswerInput,
  type GateField,
  type GateFieldsStatus,
  type GateLocalInput,
  type GateSlotInput,
  type GateStatus,
} from "@/lib/gates";

/** One gate-model type a cheat sheet is mapped to (0026, 0061). */
export type MatrixTypeInfo = {
  code: string;
  name: string;
  /** Null for a type Matthew wrote; the sentence to print otherwise. */
  provisionalNote: string | null;
  /** Words in an item name that suggest this type (src/lib/matrix-type.ts). */
  suggestWords: string[];
  /** The type suggested on this sheet when a name names none. */
  suggestDefault: boolean;
};

export type GateContext = {
  /** Gate rows that apply, per item_categories.id. Absent = no matrix mapping. */
  fieldsByCategory: Map<string, GateField[]>;
  /** The types each category is mapped to, in the seed's order. */
  typesByCategory: Map<string, MatrixTypeInfo[]>;
  /** BWS field ids each category's checklist can actually ask. */
  askedByCategory: Map<string, Set<number>>;
  /** Local keys each category's checklist asks a readiness question for. */
  askedLocalKeysByCategory: Map<string, Set<string>>;
  answersByRecord: Map<string, GateAnswerInput[]>;
  slotsByRecord: Map<string, GateSlotInput[]>;
  localsByRecord: Map<string, GateLocalInput>;
  /**
   * Every checklist question each category asks, whatever its state — what a
   * gate row is matched to by `questionForField`, so `itemTgq` can say which
   * of a gate's rows is a question, a slot, a record column or project-wide.
   */
  questionsByCategory: Map<string, ItemTgqQuestion[]>;
  /**
   * Each record's project and the projects' "ask the client" routes (0062),
   * so a record's questions carry the ROUTED audience the chase reads
   * (`questionsForRecord`, chase review A5). A category's questions are
   * shared across projects; the route is not. Optional so a hand-built
   * context (a pure test) reads the seed's audience.
   */
  projectByRecord?: Map<string, string>;
  questionRoutes?: QuestionRoutes;
};

const EMPTY: GateContext = {
  fieldsByCategory: new Map(),
  typesByCategory: new Map(),
  askedByCategory: new Map(),
  askedLocalKeysByCategory: new Map(),
  answersByRecord: new Map(),
  slotsByRecord: new Map(),
  localsByRecord: new Map(),
  questionsByCategory: new Map(),
  projectByRecord: new Map(),
  questionRoutes: new Map(),
};

export async function loadGateContext(exec: SqlLike, recordIds: string[]): Promise<GateContext> {
  if (recordIds.length === 0) return EMPTY;

  // One row per (category, gate row) that applies. The overlap is the union
  // rule: our sheet receives a field if ANY of Matthew's categories mapped to
  // it carries that field. db/seed/0005 names the two places that widens.
  // `codes` is WHICH of the sheet's types the row reaches, so a record whose
  // type a person has accepted can be judged on that type's rows alone.
  const fieldRows = await exec`
    select m.item_category_id, g.matrix_row, g.gate, g.capture, g.field_name,
           f.json_id, g.local_key, g.dimension_slot, g.value_type,
           g.palette_key, g.palette_raw, g.conditional_on_key, g.conditional_on_value, g.notes,
           array_agg(distinct m.matrix_code order by m.matrix_code) as codes
      from spec_field_gates g
      join spec_matrix_category_map m on g.applies_to_all or g.applies_to && array[m.matrix_code]
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
      appliesTo: ((row.codes ?? []) as unknown[]).map(String),
    });
    fieldsByCategory.set(key, list);
  }

  // The types each record's category is mapped to: the provisional note, and
  // what the type suggestion is read from.
  const typeRows = await exec`
    select m.item_category_id, t.code, t.name, t.provisional_note, t.suggest_words, m.suggest_default
      from spec_matrix_category_map m
      join spec_matrix_categories t on t.code = m.matrix_code
     where m.item_category_id = any(
       select category_id from spec_records where id = any(${recordIds}::uuid[]) and category_id is not null)
     order by m.item_category_id, t.sort_order, t.code
  `;
  const typesByCategory = new Map<string, MatrixTypeInfo[]>();
  for (const row of typeRows) {
    const key = String(row.item_category_id);
    const list = typesByCategory.get(key) ?? [];
    list.push({
      code: String(row.code),
      name: String(row.name),
      provisionalNote: row.provisional_note === null || row.provisional_note === undefined ? null : String(row.provisional_note),
      suggestWords: ((row.suggest_words ?? []) as unknown[]).map(String),
      suggestDefault: row.suggest_default === true,
    });
    typesByCategory.set(key, list);
  }

  // Which BWS fields each category's checklist can ask. A gate over a field
  // with no question is `unanswerable`, not `blocking` — the fix is a seed,
  // not a person.
  // And which local keys: a readiness question the checklist asks is a
  // question whether or not anybody has answered it (`gateStatus`).
  const askedRows = await exec`
    select r.category_id, f.json_id, r.local_key
      from requirements r left join spec_fields f on f.id = r.spec_field_id
     where r.category_id = any(
       select category_id from spec_records where id = any(${recordIds}::uuid[]) and category_id is not null)
       and (r.spec_field_id is not null or r.local_key is not null)
  `;
  const askedByCategory = new Map<string, Set<number>>();
  const askedLocalKeysByCategory = new Map<string, Set<string>>();
  for (const row of askedRows) {
    const key = String(row.category_id);
    if (row.json_id !== null && row.json_id !== undefined) {
      const set = askedByCategory.get(key) ?? new Set<number>();
      set.add(Number(row.json_id));
      askedByCategory.set(key, set);
    }
    if (row.local_key !== null && row.local_key !== undefined) {
      const set = askedLocalKeysByCategory.get(key) ?? new Set<string>();
      set.add(String(row.local_key));
      askedLocalKeysByCategory.set(key, set);
    }
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
    select record_id, dimension_slot, state, value, unit
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
      unit: (row.unit ?? null) as string | null,
    });
    slotsByRecord.set(key, list);
  }

  // ---- Matthew's ten rows with no BWS field --------------------------------
  //
  // Three already have a home on `spec_records` and reporting them
  // unanswerable would be a lie: the item name IS the bill's own words, the
  // designer reference IS the `designer` column, and `spec_description` is
  // 0028's free-text field, which is what his "Spec notes" row describes.
  const localRows = await exec`
    select id, item_description, designer, spec_description
      from spec_records where id = any(${recordIds}::uuid[])
  `;
  const localsByRecord = new Map<string, GateLocalInput>();
  const stated = (raw: unknown) => {
    const value = String(raw ?? "").trim();
    return { state: (value ? "confirmed" : "missing") as AnswerState, value: value || null };
  };
  for (const row of localRows) {
    localsByRecord.set(String(row.id), {
      item_name: stated(row.item_description),
      designer_reference: stated(row.designer),
      spec_notes: stated(row.spec_description),
    });
  }

  // And six are real questions with no BWS column, which 0030's
  // `requirements.local_key` ties to a readiness requirement — so they carry a
  // proper answer with a STATE, which is what makes a conditional evaluable at
  // all. Before this, "Headboard fitted" was unanswerable, so a fitted
  // headboard could never satisfy TG0: there was nowhere to say it was fitted.
  const localAnswerRows = await exec`
    select a.record_id, q.local_key, a.state, a.value
      from spec_answers a
      join requirements q on q.id = a.requirement_id
     where a.record_id = any(${recordIds}::uuid[]) and a.revision_no = 0 and q.local_key is not null
  `;
  for (const row of localAnswerRows) {
    const key = String(row.record_id);
    const locals = localsByRecord.get(key) ?? {};
    locals[String(row.local_key)] = {
      state: String(row.state) as AnswerState,
      value: (row.value ?? null) as string | null,
    };
    localsByRecord.set(key, locals);
  }

  // The checklist questions of the categories on his matrix, for `itemTgq`.
  // Only those: a placeholder category's TGQ is its own questions, which the
  // caller already holds.
  const mapped = [...fieldsByCategory.keys()];
  const questionRows =
    mapped.length === 0
      ? []
      : await exec`
          select q.category_id, q.id, q.kind, q.audience, q.prompt, q.section, q.local_key, f.json_id, f.name as field_name
            from requirements q left join spec_fields f on f.id = q.spec_field_id
           where q.category_id = any(${mapped}::uuid[])
             and q.category_id = any(
               select category_id from spec_records where id = any(${recordIds}::uuid[]) and category_id is not null)
           order by q.sort_order
        `;
  const questionsByCategory = new Map<string, ItemTgqQuestion[]>();
  for (const row of questionRows) {
    const key = String(row.category_id);
    const list = questionsByCategory.get(key) ?? [];
    list.push({
      requirement_id: String(row.id),
      kind: String(row.kind),
      // Who answers it (0062): what decides a chase row from one we record.
      audience: normaliseQuestionAudience(row.audience),
      prompt: String(row.prompt ?? ""),
      section: row.section === null || row.section === undefined ? null : String(row.section),
      local_key: row.local_key === null || row.local_key === undefined ? null : String(row.local_key),
      json_id: row.json_id === null || row.json_id === undefined ? null : Number(row.json_id),
      field_label: row.field_name === null || row.field_name === undefined ? null : String(row.field_name),
    });
    questionsByCategory.set(key, list);
  }

  // WHO ANSWERS EACH QUESTION ON THIS RECORD'S PROJECT (chase review A5): the
  // seed's audience above is per category; a person's "Ask the client" is per
  // project, and the chase reads it. `questionsForRecord` applies it.
  const projectRows = await exec`select id, project_id from spec_records where id = any(${recordIds}::uuid[])`;
  const projectByRecord = new Map(projectRows.map((row) => [String(row.id), String(row.project_id)]));
  const questionRoutes = await loadQuestionRoutes(exec, [...new Set(projectByRecord.values())]);

  return {
    fieldsByCategory,
    typesByCategory,
    askedByCategory,
    askedLocalKeysByCategory,
    answersByRecord,
    slotsByRecord,
    localsByRecord,
    questionsByCategory,
    projectByRecord,
    questionRoutes,
  };
}

/**
 * One record's checklist questions, each with the audience the CHASE reads:
 * the seed's, or this record's project's route over it (chase review A5). The
 * gate rows' chase/readiness split reads it, so the record's "Why" and the
 * chase screen cannot disagree about a question a person moved.
 */
export function questionsForRecord(context: GateContext, record: { id: string; categoryId: string | null }): ItemTgqQuestion[] {
  if (!record.categoryId) return [];
  const projectId = context.projectByRecord?.get(record.id);
  const allRoutes = context.questionRoutes;
  const routes = projectId && allRoutes ? allRoutes.get(projectId) : undefined;
  const questions = context.questionsByCategory.get(record.categoryId) ?? [];
  if (!allRoutes || !routes || routes.size === 0) return questions;
  return questions.map((question) => ({
    ...question,
    audience: routedAudience(allRoutes, projectId, {
      requirementId: question.requirement_id,
      prompt: question.prompt,
      jsonId: question.json_id,
      localKey: question.local_key,
      audience: question.audience,
    }).audience,
  }));
}

/**
 * The sentence to print beside this record's gate view or TGQ count, or null
 * where every type deciding it is one Matthew wrote. The words are the seed's
 * (`spec_matrix_categories.provisional_note`), never a constant.
 */
export function provisionalNoteFor(
  context: GateContext,
  record: { categoryId: string | null; matrixType?: string | null },
): string | null {
  if (!record.categoryId) return null;
  const type = matrixTypeOf(context, record);
  const notes = (context.typesByCategory.get(record.categoryId) ?? [])
    .filter((candidate) => !type || candidate.code === type)
    .map((candidate) => candidate.provisionalNote)
    .filter((note): note is string => Boolean(note));
  return notes[0] ?? null;
}

/**
 * A record as the gate functions need it. `matrixType` is the person's
 * accepted type (`spec_records.matrix_type`); absent or null is the union.
 */
export type GateRecordRef = { id: string; categoryId: string | null; matrixType?: string | null };

/**
 * The type this record is judged as: its accepted type where its sheet maps
 * it, null (the union) otherwise. `effectiveMatrixType` over the context.
 */
export function matrixTypeOf(
  context: GateContext,
  record: { categoryId: string | null; matrixType?: string | null },
): string | null {
  if (!record.categoryId) return null;
  return effectiveMatrixType(record.matrixType ?? null, context.typesByCategory.get(record.categoryId) ?? []);
}

/**
 * ONE RECORD'S TGQ, by the one function (`itemTgq`): the TGQ gate's rows where
 * his matrix covers the category, the checklist's own questions where it does
 * not. The context is loaded once, in bulk, by the caller.
 */
export function itemTgqForRecord(
  context: GateContext,
  record: GateRecordRef,
  outstanding: readonly ItemTgqOutstanding[],
): ItemTgq {
  const gates = gatesForRecord(context, record);
  return itemTgq({
    tgqGateRows: gates ? gates.TGQ.fields : null,
    questions: questionsForRecord(context, record),
    outstanding,
  });
}

/**
 * Every gate for one record, CHAINED, or null where its category is not on
 * Matthew's matrix. Null is a real answer and the screens print it as one.
 *
 * Chained means a gate is satisfied only when every gate before it is — see
 * `chainGates`. This is the only way a caller gets a `GateStatus`, and it is
 * the only type that carries `satisfied`, so no reader can pick up the
 * per-gate reading by mistake.
 */
export function gatesForRecord(
  context: GateContext,
  record: GateRecordRef,
): Record<Gate, GateStatus> | null {
  if (!record.categoryId) return null;
  const sheetFields = context.fieldsByCategory.get(record.categoryId);
  if (!sheetFields || sheetFields.length === 0) return null;
  // BY THE ACCEPTED TYPE where a person has accepted one the sheet maps; the
  // union of the sheet's types otherwise, which is today's reading.
  const type = matrixTypeOf(context, record);
  const typed = type ? sheetFields.filter((field) => !field.appliesTo || field.appliesTo.includes(type)) : sheetFields;
  // A type reaching no row at all is a seed fault, never "nothing to check":
  // judge it on the union rather than on an empty list.
  const fields = typed.length > 0 ? typed : sheetFields;

  const input = {
    answers: context.answersByRecord.get(record.id) ?? [],
    slots: context.slotsByRecord.get(record.id) ?? [],
    locals: context.localsByRecord.get(record.id) ?? {},
    askedFieldIds: context.askedByCategory.get(record.categoryId) ?? new Set<number>(),
    askedLocalKeys: context.askedLocalKeysByCategory.get(record.categoryId) ?? new Set<string>(),
  };

  // Each gate over its OWN fields, then CHAINED — a gate is met only when
  // every gate before it is. Judged separately they read as independent, and
  // they are not: TG1 is largely a re-check of TGQ.
  const own = {} as Record<Gate, GateFieldsStatus>;
  for (const gate of GATES) {
    own[gate] = gateStatus(gate, fields.filter((f) => f.gate === gate), input);
  }
  return chainGates(own);
}

/**
 * What a table column needs, per gate, or null for no matrix view.
 *
 * `outstanding` is this gate's OWN unsettled fields and `blockedBy` is what is
 * holding the gate up regardless. Both are needed, because a bare number
 * cannot tell "TG1 has nothing left" from "TG1 has nothing left and has not
 * been reached" — and the second must never render as a tick.
 */
export type GateSummaryEntry = {
  outstanding: number;
  blockedBy: Gate[];
  satisfied: boolean;
};

export function gateSummary(
  statuses: Record<Gate, GateStatus> | null,
): Record<Gate, GateSummaryEntry> | null {
  if (!statuses) return null;
  const out = {} as Record<Gate, GateSummaryEntry>;
  for (const gate of GATES) {
    const status = statuses[gate];
    const c = status.counts;
    out[gate] = {
      outstanding: c.blocking + c.unknown + c.unanswerable,
      blockedBy: status.blockedBy,
      satisfied: status.satisfied,
    };
  }
  return out;
}

/**
 * Matthew's TGQ set, per cheat-sheet category.
 *
 * ==========================================================================
 * THE DISCRIMINATOR IS PRESENCE IN THE MAP, NOT AN EMPTY SET.
 *
 * `questionTier` reads a category's absence as "he has not written this one,
 * fall back to `tgq_levels`", and its presence as "this is the answer". An
 * empty set returned for an unmapped category would compute as "nothing blocks
 * a quote here", which is the confidently-wrong reading `gatesForRecord`
 * already refuses by returning null. Same rule, and it has to hold in both
 * places or the spec table and the gate panel disagree again.
 *
 * The join is `loadGateContext`'s, unchanged: the union rule, where our sheet
 * receives a field if ANY of his categories mapped to it carries that field.
 * Two copies of that join is how the TGQ column and the TGQ gate start
 * answering differently — the whole defect this function exists to close.
 *
 * Every category in `spec_matrix_category_map` gets an entry even when his
 * matrix puts nothing of its own at TGQ, because "he wrote this category and
 * nothing in it blocks a quote" is a real answer and a different one from "he
 * has not written it".
 * ==========================================================================
 */
export async function loadTgqMatrices(exec: SqlLike): Promise<Map<string, SheetTgqMatrix>> {
  const rows = await exec`
    select m.item_category_id,
           m.matrix_code,
           f.json_id,
           g.local_key,
           g.gate
      from spec_matrix_category_map m
      left join spec_field_gates g
        on (g.applies_to_all or g.applies_to && array[m.matrix_code]) and g.gate = 'TGQ'
      left join spec_fields f on f.id = g.spec_field_id
  `;
  type Sets = { fields: Set<number>; localKeys: Set<string> };
  const empty = (): Sets => ({ fields: new Set<number>(), localKeys: new Set<string>() });
  const out = new Map<string, Sets & { byType: Map<string, Sets> }>();
  for (const row of rows) {
    const key = String(row.item_category_id);
    const entry = out.get(key) ?? { ...empty(), byType: new Map<string, Sets>() };
    // EACH TYPE'S OWN SET beside the union, for `tgqMatrixFor`: a record a
    // person typed is judged on its type's rows (decision B). Every mapped
    // type gets an entry, empty or not, for the reason the union does.
    const code = String(row.matrix_code);
    const own = entry.byType.get(code) ?? empty();
    // The left joins mean a mapped category with no TGQ row of its own still
    // arrives here, with both columns null. That is what puts it in the map.
    if (row.json_id !== null && row.json_id !== undefined) {
      entry.fields.add(Number(row.json_id));
      own.fields.add(Number(row.json_id));
    }
    if (row.local_key !== null && row.local_key !== undefined) {
      entry.localKeys.add(String(row.local_key));
      own.localKeys.add(String(row.local_key));
    }
    entry.byType.set(code, own);
    out.set(key, entry);
  }
  return out;
}
