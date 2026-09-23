// What changed between two versions of a record.
//
// ============================================================================
// PURE, AND OVER ATOMS.
//
// Two rules here are load-bearing.
//
// 1. THE DIFF RUNS OVER ATOMS, NEVER OVER STORED CELLS. `record_snapshots`
//    keeps the 109 composed cells as they were on the day, because "what did
//    the file we sent actually say" is a real question. It is the WRONG input
//    for a diff: `composeRowCells` changes (the Timber Finish naming question
//    is open right now), and a diff over cells stored under two different sets
//    of rules reports edits on records nobody touched. So the cell view is
//    RECOMPOSED from both ends with today's composer, and a change shown there
//    is always a change in the data.
//
// 2. EVERYTHING IS KEYED BY A STABLE ID. Attributes key on the row id and
//    answers on the requirement id, so a value corrected in place is one
//    "changed" line rather than a delete beside an add — which is the
//    difference between a reviewer seeing "W1900 → W1520" and seeing two
//    unrelated lines they have to pair up themselves.
//
// A snapshot's jsonb is untrusted by age: it was written by an older build
// than the one reading it. `parseAtoms` validates with Zod and upgrades, the
// same discipline as `upgradeDimensionSlots`.
// ============================================================================
import { z } from "zod";
import { composeRowCells, BWS_EXPORT_COLUMNS } from "@/lib/bws-export";
import { composeFinishCell } from "@/lib/finishes";
import { describeStandard } from "@/lib/bw-standard";
import { exportAnswers, scopeForAtoms, RECORD_ATOMS_SCHEMA_VERSION, type RecordAtoms } from "@/lib/record-atoms";

// ---- validating a stored snapshot -----------------------------------------

const AtomAttribute = z.object({
  id: z.string(),
  recordId: z.string(),
  attrGroup: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  unit: z.string().nullable(),
  dimensionSlot: z.string().nullable(),
  materialCode: z.string().nullable(),
  // Added at schema version 2. `.nullish()` with a default rather than
  // required, so a version written before the finishes library existed still
  // reads — the same discipline as `dimensionSlot` on a staged observation.
  finish: z
    .object({
      id: z.string(),
      code: z.string(),
      codeNorm: z.string(),
      // Added at 0036, and OPTIONAL for the reason `finish` itself is: a
      // snapshot written before internal codes existed holds no such key,
      // and every one of those finishes was a code a document carried.
      codeOrigin: z.enum(["client", "internal"]).nullish().transform((value) => value ?? "client"),
      kind: z.string().nullable(),
      description: z.string().nullable(),
      supplierRaw: z.string().nullable(),
      reference: z.string().nullable(),
      colour: z.string().nullable(),
      state: z.string(),
    })
    .nullish()
    .transform((value) => value ?? null),
  // Added at schema 7 (0041): the BW standard beside the client's words.
  // Optional and defaulted null, so a version written before it reads as "no
  // standard had been proposed" -- and NAMED, because Zod strips what it does
  // not name, and a version that silently lost its standard would recompose
  // its cells from the client's words and report a change nobody made.
  standard: z
    .object({
      value: z.string().nullable(),
      optionId: z.string().nullable(),
      state: z.enum(["proposed", "agreed", "tbc"]),
    })
    .nullish()
    .transform((value) => value ?? null),
  specFieldJsonId: z.number().nullable(),
  state: z.string(),
  sortOrder: z.number(),
  sourceFilename: z.string().nullable(),
  sourcePage: z.number().nullable(),
});

const AtomAnswer = z.object({
  id: z.string(),
  requirementId: z.string(),
  prompt: z.string(),
  section: z.string().nullable(),
  kind: z.string(),
  specFieldJsonId: z.number().nullable(),
  specFieldName: z.string().nullable(),
  value: z.string().nullable(),
  state: z.string(),
  sourceKind: z.string(),
  sourceId: z.string().nullable(),
});

const AtomSchema = z.object({
  schemaVersion: z.number(),
  project: z.object({ number: z.string(), name: z.string(), client: z.string().nullable() }),
  record: z.object({
    id: z.string(),
    recordNo: z.number(),
    label: z.string(),
    itemDescription: z.string(),
    qty: z.number().nullable(),
    area: z.string().nullable(),
    runName: z.string(),
    boqCodes: z.array(z.string()),
    // THE CONFIGURATION'S LETTER (0024), and it was MISSING here until
    // 2026-09-20. Zod strips what it does not name, so every snapshot read
    // back lost it — and `diffCells` recomposes the Name column from the
    // atoms, so a version of `S-201 A` described a job called `Armchair`
    // where the file had shipped `Armchair (A)`, and comparing a snapshot
    // with a live record reported a change nobody made. Optional and
    // defaulted, because versions written before 0024 genuinely have none.
    variantLabel: z.string().nullable().optional().default(null),
    // Added at schema 5 (0034). Optional and defaulted null, so a version
    // written before the note existed parses as "nobody had typed one" rather
    // than failing the screen -- and, because Zod strips what it does not
    // name, a field left out here would be silently dropped from every
    // snapshot this reads back.
    dimensionNote: z.string().nullable().optional().default(null),
    // Added at schema 6 (0039): the bill line's number and this
    // configuration's under it, which order a configuration under its line.
    // Named here for the reason above -- Zod strips what it does not name --
    // and defaulted null, so a version written before 0039 reads as "not
    // numbered under a line" rather than failing. The LABEL a version carries
    // is never recomputed from them: history keeps the label it was taken with.
    parentRecordNo: z.number().nullable().optional().default(null),
    variantOrdinal: z.number().nullable().optional().default(null),
  }),
  runId: z.string(),
  runName: z.string(),
  status: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  // Added at schema 3. Optional on read, defaulted null, so a version written
  // before 0019 parses as "nobody had said" rather than failing the screen.
  level: z.string().nullable().optional().default(null),
  productReference: z.string().nullable(),
  designer: z.string().nullable(),
  boqCategory: z.string().nullable(),
  parentId: z.string().nullable(),
  splitReason: z.string().nullable(),
  refs: z.array(z.object({ system: z.string(), value: z.string() })),
  attributes: z.array(AtomAttribute),
  answers: z.array(AtomAnswer),
  itemImage: z.object({ attachmentId: z.string(), storagePath: z.string() }).nullable(),
});

/**
 * A stored snapshot back into atoms.
 *
 * Throws rather than returning a partial: a version screen showing a record
 * with its attributes silently dropped would read as "everything was deleted
 * that day", which is a worse answer than an error.
 */
export function parseAtoms(value: unknown): RecordAtoms {
  const parsed = AtomSchema.parse(value);
  if (parsed.schemaVersion > RECORD_ATOMS_SCHEMA_VERSION) {
    throw new Error(
      `This version was written by a newer build (schema ${parsed.schemaVersion}) than this one understands (${RECORD_ATOMS_SCHEMA_VERSION}).`,
    );
  }
  return parsed as RecordAtoms;
}

// ---- the diff --------------------------------------------------------------

export type FieldChange = { field: string; label: string; was: string | null; now: string | null };

export type ListChange = {
  key: string;
  label: string;
  change: "added" | "removed" | "changed";
  fields: FieldChange[];
};

export type SnapshotDiff = {
  core: FieldChange[];
  refs: ListChange[];
  attributes: ListChange[];
  answers: ListChange[];
  /** Recomposed with today's rules from both ends — never the stored cells. */
  cells: FieldChange[];
  isEmpty: boolean;
};

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function compare(field: string, label: string, was: unknown, now: unknown): FieldChange | null {
  const a = show(was);
  const b = show(now);
  return a === b ? null : { field, label, was: a, now: b };
}

/**
 * EXPORTED FOR THE VOCABULARY GUARD, and for nothing else.
 *
 * `tests/lib/vocabulary-guard.test.ts` scans the two SCREEN directories, and
 * deliberately stops short of `src/lib`, where the SQL, the error codes and
 * the column names live -- widening the scan there would turn `run_id` and
 * `run_retire` into an allowlist nobody reads. Its answer is to name the few
 * `src/lib` collections a person actually READS, one by one. These labels are
 * one of them: they head the rows of a record's version diff, and `runName`
 * was headed "Run" for four days after the rename.
 */
export const CORE_FIELDS: { field: keyof RecordAtoms | string; label: string; read: (atoms: RecordAtoms) => unknown }[] = [
  { field: "itemDescription", label: "Item", read: (a) => a.record.itemDescription },
  { field: "qty", label: "Quantity", read: (a) => a.record.qty },
  { field: "area", label: "Area", read: (a) => a.record.area },
  { field: "productReference", label: "Product reference", read: (a) => a.productReference },
  { field: "designer", label: "Designer", read: (a) => a.designer },
  { field: "boqCategory", label: "BOQ category", read: (a) => a.boqCategory },
  { field: "categoryName", label: "Category", read: (a) => a.categoryName },
  { field: "level", label: "Level", read: (a) => a.level },
  // 0034. It is part of the composed Dimensions cell, so a change to it shows
  // TWICE on a version -- here as the note, and in `cells` as the cell moving.
  // Both are wanted: the cell says what BWS received, this says what somebody
  // actually did.
  { field: "dimensionNote", label: "Dimension note", read: (a) => a.record.dimensionNote ?? null },
  { field: "status", label: "Status", read: (a) => a.status },
  // PHASE, not "Run". The 2026-09-19 rename made phase the word on every screen
  // and in every document; the three things that deliberately keep the old word
  // are the TABLE `spec_runs` with its `run_id`, `runId` as the API word and
  // query parameter, and `intake_runs`, which is a document READ and was never
  // a phase. A rendered LABEL is none of the three, and this one is rendered:
  // a record moved between phases showed a diff line headed "Run".
  //
  // `field` STAYS `runName`, because nobody reads it. It names the atom it
  // reads off `RecordAtoms` -- schema-side vocabulary, like `run_id` -- and it
  // is the diff row's React key. Renaming a key beside a label is how the two
  // halves of this rule get confused with each other.
  { field: "runName", label: "Phase", read: (a) => a.runName },
  { field: "splitReason", label: "Split reason", read: (a) => a.splitReason },
  { field: "itemImage", label: "Picture", read: (a) => a.itemImage?.storagePath ?? null },
];

function attributeFields(attribute: RecordAtoms["attributes"][number]): { field: string; label: string; value: unknown }[] {
  return [
    { field: "value", label: "Value", value: attribute.value },
    { field: "unit", label: "Unit", value: attribute.unit },
    { field: "label", label: "Label", value: attribute.label },
    { field: "attrGroup", label: "Group", value: attribute.attrGroup },
    { field: "dimensionSlot", label: "Slot", value: attribute.dimensionSlot },
    { field: "state", label: "State", value: attribute.state },
    { field: "materialCode", label: "Finish code", value: attribute.materialCode },
    // What the LIBRARY said this code meant at the time. Without it, editing a
    // finish would change every linked item's export cell and show as no
    // change at all on any of their versions.
    { field: "finish", label: "Finish", value: attribute.finish ? composeFinishCell(attribute.finish) : null },
    // 0041. What BW proposed beside the client's words, and whether the client
    // agreed -- so a proposal and an agreement are each a visible change on the
    // version that made them, while `value` goes on saying what the page said.
    { field: "standard", label: "BW standard", value: describeStandard(attribute.standard ?? null) },
    { field: "specFieldJsonId", label: "BWS field", value: attribute.specFieldJsonId },
    { field: "source", label: "Source", value: attribute.sourceFilename },
  ];
}

function answerFields(answer: RecordAtoms["answers"][number]): { field: string; label: string; value: unknown }[] {
  return [
    { field: "value", label: "Value", value: answer.value },
    { field: "state", label: "State", value: answer.state },
    { field: "sourceKind", label: "Source", value: answer.sourceKind },
  ];
}

function diffKeyed<T>(
  before: T[],
  after: T[],
  key: (item: T) => string,
  label: (item: T) => string,
  fields: (item: T) => { field: string; label: string; value: unknown }[],
): ListChange[] {
  const a = new Map(before.map((item) => [key(item), item]));
  const b = new Map(after.map((item) => [key(item), item]));
  const out: ListChange[] = [];

  for (const [id, item] of b) {
    const previous = a.get(id);
    if (!previous) {
      out.push({
        key: id,
        label: label(item),
        change: "added",
        fields: fields(item)
          .map((f) => compare(f.field, f.label, null, f.value))
          .filter((f): f is FieldChange => f !== null),
      });
      continue;
    }
    const before_ = fields(previous);
    const after_ = fields(item);
    const changed = after_
      .map((f, index) => compare(f.field, f.label, before_[index]?.value, f.value))
      .filter((f): f is FieldChange => f !== null);
    if (changed.length > 0) out.push({ key: id, label: label(item), change: "changed", fields: changed });
  }

  for (const [id, item] of a) {
    if (b.has(id)) continue;
    out.push({
      key: id,
      label: label(item),
      change: "removed",
      fields: fields(item)
        .map((f) => compare(f.field, f.label, f.value, null))
        .filter((f): f is FieldChange => f !== null),
    });
  }

  return out;
}

/** The 109 export cells at both ends, composed with TODAY's rules. */
export function diffCells(before: RecordAtoms, after: RecordAtoms): FieldChange[] {
  const a = composeRowCells(scopeForAtoms(before), before.record, before.attributes, exportAnswers(before));
  const b = composeRowCells(scopeForAtoms(after), after.record, after.attributes, exportAnswers(after));
  const out: FieldChange[] = [];
  for (let index = 0; index < BWS_EXPORT_COLUMNS.length; index += 1) {
    const column = BWS_EXPORT_COLUMNS[index];
    if (!column) continue;
    const change = compare(column.name, column.name.trim(), a[index]?.value, b[index]?.value);
    if (change) out.push(change);
  }
  return out;
}

export function diffSnapshots(before: RecordAtoms, after: RecordAtoms): SnapshotDiff {
  const core = CORE_FIELDS.map((f) => compare(String(f.field), f.label, f.read(before), f.read(after))).filter(
    (f): f is FieldChange => f !== null,
  );

  const refs = diffKeyed(
    before.refs,
    after.refs,
    (ref) => `${ref.system}:${ref.value}`,
    (ref) => ref.value,
    (ref) => [{ field: "value", label: ref.system, value: ref.value }],
  );

  const attributes = diffKeyed(
    before.attributes,
    after.attributes,
    (attribute) => attribute.id,
    (attribute) => attribute.label,
    attributeFields,
  );

  // Keyed on the REQUIREMENT, not the answer row. Setting a category deletes
  // the old category's `missing` rows and inserts the new category's, so a
  // question that exists under both would otherwise read as removed-and-added
  // with the same prompt printed twice.
  const answers = diffKeyed(
    before.answers,
    after.answers,
    (answer) => answer.requirementId,
    (answer) => answer.prompt,
    answerFields,
  );

  const cells = diffCells(before, after);

  return {
    core,
    refs,
    attributes,
    answers,
    cells,
    isEmpty: core.length === 0 && refs.length === 0 && attributes.length === 0 && answers.length === 0 && cells.length === 0,
  };
}
