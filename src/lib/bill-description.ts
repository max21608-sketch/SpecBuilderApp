// A bill line's description cell, read as a NAME and its specifications.
//
// ============================================================================
// WHY THIS EXISTS
//
// The Aman pricing document writes each item as one multi-line cell: the first
// line is what the item is ("Drawers", "Armchair (Option 1)"), every later line
// a labelled statement — "Spec size: D380 x W965 x H860 mm", "Finish: STN-02,
// MTL-01, TIM-03", "Model Ref: Bespoke Design". The bill reader collapsed the
// cell's whitespace, so the record's name was the whole paragraph and nothing
// the paragraph said reached a slot or a field. The charged "Read the
// specifications in this bill" read was the second step meant to fix that; Max
// (2026-09-30) wants it read at intake, with no second step and no charge.
//
// So the confirm reads the cell with the readers the email path already uses
// (`readDimension`, `readFinishes`, the vocabulary in `spec-reading-vocab.ts`).
// There is no second parser: what this file adds is only the SHAPE of a cell —
// which line is the name, which is a label, which lines sit under a heading —
// and the rules about which of several statements of one thing is the one
// placed. What it plans is shown on the BOQ review screen before the confirm,
// which is the approval gate for these values, and the confirm writes exactly
// that plan: both call `planSheetDescriptions` over the staged JSON.
//
// ============================================================================
// THE RULES, EACH A TRAP
//
// - ONLY A MULTI-LINE CELL IS READ. A single-line description is its own name
//   and states nothing else, so every bill without this shape — Panther,
//   P17231, the fixtures — reads exactly as it always did.
// - ONE SIZE STATEMENT FILLS THE SLOTS. A bill writes the size twice, "Sizes
//   (ft-in)" and "Sizes (mm)": one size, two notations. The first line whose
//   unit is stated as mm or cm is placed; only where there is none does a
//   plain-inch line convert (exactly — `in` is a unit this app holds). Every
//   other size line is kept as a note. Two statements on one slot would ship
//   whichever the composer happened to prefer.
// - NOT OVERALL IS NOT A SLOT. "Fully reclined", "SEAT:", "Overhang",
//   "Undertable", a base's W x D, a garbled `D 51 0`: notes, verbatim. A
//   reclined length in W is a width nothing downstream would question.
// - A TBC SIZE IS A STATEMENT, not a blank: a note in state `tbc`, no slots.
// - A FABRIC NAMED IN THE DESCRIPTION NEVER CLAIMS A COM SLOT WHEN THE ITEM
//   HAS A FABRIC LINE. The fabric line is the fuller statement of the same
//   cloth and is written as the next free COM at confirm; a second COM from
//   the description would ship a fabric that does not exist. "Fabric: COM"
//   never claims one either — the client supplies the cloth.
// - A FINISH NEEDS THE DOCUMENT'S OWN CODE (`readFinishes`' gate). "BESPOKE",
//   "CUSTOM", "OAK-Smoked Open Pore" are notes; a code the bill mentions in
//   passing ("to match TIM-09") is a cross-reference, not the finish.
// - NOTHING IS LOST. Every line after the name becomes an attribute, and a
//   line the readers cannot place is a note carrying its label and value
//   exactly as printed. The cell as printed stays on the staged line.
//
// PURE. No database; the BWS field register is passed in.
// ============================================================================
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import { readDimension, sizeLabel, sizeLineRefusal, type DimensionReading } from "@/lib/spec-dimensions";
import { leadingFinishCode, readFinishes, type FinishReading } from "@/lib/spec-finishes";
import { suggestSpecField, type SpecFieldEntry } from "@/lib/drawing-document";
import {
  DIMENSION_SLOT_LABELS,
  TBC_TOKENS,
  isDimensionSlot,
  type AttributeGroup,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { normaliseName } from "@/lib/matching";
import { WELDED_LABELS } from "@/lib/spec-reading-vocab";

// ---- the shape of the cell ---------------------------------------------------

export type BillStatement = {
  /** The line as the cell printed it, trimmed — for the screen. */
  line: string;
  /**
   * The printed label, or the HEADING's label for an unlabelled line under
   * one ("Finish:" over "GR-TIM-10 - Lime Washed Oak"), or the label of the
   * statement above for a line continuing its list of codes. Null for a line
   * with none of these.
   */
  label: string | null;
  /** What follows the label, trimmed; the whole line where there is no label. */
  value: string;
  /** Where the label came from, when it was not this line's own. */
  labelFrom: "heading" | "above" | null;
};

export type BillDescriptionReading = { name: string; statements: BillStatement[] };

const WELDED = new RegExp(`(\\d)(?=(?:${WELDED_LABELS.map((entry) => entry.label).join("|")})\\s*:)`, "gi");

/**
 * The cell's lines, empty ones dropped, each trimmed. A label welded onto the
 * figure before it (`SH 355Finish: …`, a lost line break) starts a line of its
 * own — only where a digit sits right in front of a known label and a colon
 * follows it.
 */
function cellLines(raw: string): string[] {
  return raw
    .split(/\r\n|\r|\n/)
    .flatMap((line) => line.replace(WELDED, "$1\n").split("\n"))
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * `Label: value`, split on the FIRST colon. `Fabric:: X` is one colon too
 * many, not an empty statement and another: the extra colons are dropped from
 * the value. A line whose first colon has nothing in front of it is not
 * labelled.
 */
function splitLabel(line: string): { label: string; value: string } | null {
  const at = line.indexOf(":");
  if (at <= 0) return null;
  const label = line.slice(0, at).trim();
  if (label === "") return null;
  return { label, value: line.slice(at + 1).replace(/^[\s:]+/, "").trim() };
}

/**
 * The name and the statements of a description cell, or null where the cell
 * is one line — a single-line description is its own name and says nothing
 * else, which is what keeps every other bill reading exactly as before.
 */
export function readBillDescription(raw: string | null | undefined): BillDescriptionReading | null {
  if (typeof raw !== "string") return null;
  const lines = cellLines(raw);
  if (lines.length < 2) return null;
  const [name, ...rest] = lines as [string, ...string[]];

  const statements: BillStatement[] = [];
  let heading: string | null = null;
  /** Whether any line has followed the current heading. */
  let headingUsed = false;
  // A heading states nothing itself, so it is kept as a statement only where
  // NOTHING follows it — "Finish:" as a cell's last line is still a line of
  // the cell, and dropping it would lose it.
  const closeHeading = () => {
    if (heading !== null && !headingUsed) {
      statements.push({ line: `${heading}:`, label: heading, value: "", labelFrom: null });
    }
  };
  for (const line of rest) {
    const labelled = splitLabel(line);
    if (labelled && labelled.value === "") {
      // A HEADING: "Finish:" over the lines that say what the finishes are.
      closeHeading();
      heading = labelled.label;
      headingUsed = false;
      continue;
    }
    headingUsed = true;
    if (labelled) {
      statements.push({ line, label: labelled.label, value: labelled.value, labelFrom: null });
      continue;
    }
    if (heading !== null) {
      statements.push({ line, label: heading, value: line, labelFrom: "heading" });
      continue;
    }
    // A LIST OF CODES CARRIED ON TO THE NEXT LINE — "Finish: GR-TIM-07 LIME
    // WASHED OAK" over "GR-MTL-01 ANTIQUE BRONZE" — is the statement above,
    // continued. Only where the line LEADS with a code: anything else with no
    // label is a note of its own, not an unexplained tail on the line above.
    const above = statements[statements.length - 1];
    if (above?.label && leadingFinishCode(line)) {
      statements.push({ line, label: above.label, value: line, labelFrom: "above" });
      continue;
    }
    statements.push({ line, label: null, value: line, labelFrom: null });
  }
  closeHeading();
  return { name, statements };
}

// ---- the plan ----------------------------------------------------------------

/**
 * One `record_attributes` row the confirm will write, exactly. Carries the
 * line it came from so the screen can show every statement verbatim beside
 * what it became.
 */
export type PlannedAttribute = {
  attrGroup: AttributeGroup;
  label: string;
  value: string;
  /** Dimensions only — the unit the line stated. Never read from a figure's size. */
  unit: "mm" | "cm" | "m" | "in" | null;
  slot: DimensionSlot | null;
  /** The client's own code, as the bill wrote it. Finishes only. */
  materialCode: string | null;
  /**
   * The words beside the code, for the finishes library's description and its
   * CONFLICT rule: the value with the code taken off. Null where there is no code.
   */
  finishWords: string | null;
  specFieldId: string | null;
  specFieldName: string | null;
  state: "confirmed" | "tbc";
  /** The line of the cell it came from, as printed. */
  line: string;
  /** Why it became what it did, where that is worth saying — a note's reason, a field not taken. */
  why: string | null;
  /**
   * The PART of the placed size line this row is, where it is one — the
   * address a reviewer's slot change is stored under (`slotOverrides`), the
   * slot the bill printed, and whether a person has set it. Absent on every
   * other row.
   */
  part?: { key: string; printed: DimensionSlot; overridden: boolean } | null;
};

// ---- a reviewer's slot change ----------------------------------------------

/**
 * WHAT A REVIEWER SAYS A PART OF THE SIZE LINE IS: one of the five slots, or
 * a note. Matthew, 2026-10-01: a round stool's "D" is its diameter, and the
 * bill review had no way to say so before the confirm wrote it as a depth.
 */
export type SlotOverride = DimensionSlot | "note";

export function isSlotOverride(value: unknown): value is SlotOverride {
  return value === "note" || isDimensionSlot(value);
}

/**
 * The address of one part of a size line: the slot it was printed with and
 * its figure, `D 380`. Keyed on what the BILL printed, never on a position,
 * so the plan recomputed on every read finds the same part — and a part the
 * line no longer prints matches nothing, rather than the override landing on
 * whatever now sits in its place.
 */
export function slotPartKey(part: { slot: DimensionSlot; figure: string | null }): string {
  return part.figure ? `${part.slot} ${part.figure}` : part.slot;
}

/** The size line the plan places: its statement and its reading, or null. */
export type PlacedSize = { index: number; statement: BillStatement; reading: DimensionReading; metric: boolean };

/**
 * WHICH SIZE LINE IS PLACED — the one rule, shared by the plan and by the
 * route that accepts a slot change, so the parts a reviewer is offered are
 * the parts the confirm writes. The first metric line, else the first inch
 * line; every other size line is a note.
 */
export function placedSizeOf(statements: readonly BillStatement[]): PlacedSize | null {
  const sizes: PlacedSize[] = [];
  statements.forEach((statement, index) => {
    if (!statement.label || !sizeLabel(statement.label)) return;
    const dimension = readDimension(statement.label, statement.value);
    if (!dimension || dimension.parts.length === 0) return;
    const metric = !dimension.imperial && (dimension.unit === "mm" || dimension.unit === "cm");
    const inches = dimension.unit === "in";
    if (metric || inches) sizes.push({ index, statement, reading: dimension, metric });
  });
  return sizes.find((candidate) => candidate.metric) ?? sizes.find((candidate) => !candidate.metric) ?? null;
}

export type ResolvedSlotOverrides = {
  /** Each part's key → the slot it is written in, or `note`. Every part of the line, overridden or not. */
  effective: Map<string, SlotOverride>;
  /** The keys a person set that this line's parts carry. */
  applied: Set<string>;
  /** Keys that name no part of the line as it now reads — ignored, and said so. */
  unmatched: string[];
  /**
   * Why NONE of the changes is applied: they would put two parts in one slot.
   * A slot holds one figure (`composeDimensionCell`'s `duplicate_slot`), and
   * picking which of two a person meant would be this app deciding.
   */
  problem: string | null;
};

/**
 * A reviewer's slot changes, read against the parts of the placed size line.
 * Pure: the plan applies the result, and the PATCH refuses a change whose
 * result carries a `problem` before anything is stored.
 */
export function resolveSlotOverrides(
  placed: PlacedSize | null,
  overrides: Readonly<Record<string, unknown>> | null | undefined,
): ResolvedSlotOverrides {
  const effective = new Map<string, SlotOverride>();
  const applied = new Set<string>();
  const parts = placed?.reading.parts ?? [];
  const keys = new Set(parts.map(slotPartKey));
  const wanted = Object.entries(overrides ?? {}).filter(([, value]) => isSlotOverride(value)) as [string, SlotOverride][];
  const unmatched = wanted.map(([key]) => key).filter((key) => !keys.has(key));
  const asked = new Map(wanted.filter(([key]) => keys.has(key)));

  const candidate = new Map<string, SlotOverride>();
  for (const part of parts) {
    const key = slotPartKey(part);
    candidate.set(key, asked.get(key) ?? part.slot);
  }
  const bySlot = new Map<DimensionSlot, string[]>();
  for (const [key, slot] of candidate) {
    if (slot === "note") continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), key]);
  }
  const clash = [...bySlot.entries()].find(([, holders]) => holders.length > 1);
  if (clash && asked.size > 0) {
    const [slot, holders] = clash;
    for (const part of parts) effective.set(slotPartKey(part), part.slot);
    return {
      effective,
      applied,
      unmatched,
      problem: `That would put ${holders.map((key) => `“${key}”`).join(" and ")} both in the ${DIMENSION_SLOT_LABELS[slot].toLowerCase()} slot, and a slot holds one figure. Move the other part first.`,
    };
  }
  for (const [key, slot] of candidate) effective.set(key, slot);
  for (const key of asked.keys()) applied.add(key);
  return { effective, applied, unmatched, problem: null };
}

export type BillDescriptionPlan = {
  name: string;
  statements: BillStatement[];
  attributes: PlannedAttribute[];
  /** `composeDimensionCell` over the planned slots — the one composer. Empty where no slot is planned. */
  dimensionCell: string;
  /**
   * The SAME cell in the composer's screen mode, for the review screen: a
   * feet-and-inches slot as the bill printed it with its millimetres beside it
   * (`W 3'-7" (1092mm)`). `dimensionCell` stays the file's millimetre cell —
   * the one the confirm writes into the checklist answer and BWS receives.
   */
  dimensionCellShown: string;
  /** The screen cell converted at least one slot from feet and inches — the chip says so. */
  dimensionFromImperial: boolean;
  /** Things a person must look at: an unconverted imperial size, a TBC size, a cell the composer flags. */
  cautions: string[];
  /**
   * The key of the placed line's `D` part where the line gives a D and no W
   * and nobody has said what it is — the caution's own address, so the screen
   * can offer "It's the diameter" / "It's the width" beside it. Null otherwise.
   */
  depthWithoutWidth: string | null;
};

/**
 * The WHOLE value says "not decided" — "TBC", "To be confirmed". A size line
 * with one TBC figure among others ("W 5'-8'' X D TBC X H 2'-5''") is not a
 * TBC size: it states two figures, and is read — or refused — as what it is.
 */
function isTbcValue(value: string): boolean {
  const norm = normaliseName(value);
  return norm !== "" && TBC_TOKENS.includes(norm);
}

function note(statement: BillStatement, why: string | null, state: "confirmed" | "tbc" = "confirmed"): PlannedAttribute {
  return {
    attrGroup: "note",
    label: statement.label ?? "Note",
    value: statement.value,
    unit: null,
    slot: null,
    materialCode: null,
    finishWords: null,
    specFieldId: null,
    specFieldName: null,
    state,
    line: statement.line,
    why,
  };
}

/** The words after a code: "GR-TIM-10 - Lime Washed Oak" → "Lime Washed Oak". Whitespace folded. */
function wordsBeside(value: string, code: string | null): string | null {
  if (!code) return null;
  const at = value.indexOf(code);
  const rest = at >= 0 ? value.slice(at + code.length) : value;
  const words = rest.replace(/^[\s\-–—:;,.]+/, "").replace(/\s+/g, " ").trim();
  return words === "" ? null : words;
}

/**
 * A value that carries a label of its own before a code: "Finish: Wood:
 * GR-TIM-09 LIME WASHED OAK" is the timber, and "Wood" is what says so. Read
 * as (Wood, GR-TIM-09 …) — only where what follows LEADS with a code, so a
 * size like "H:1' 9 1/4"" is never taken apart.
 */
function innerLabel(value: string): { label: string; value: string } | null {
  const inner = splitLabel(value);
  if (!inner || inner.value === "" || inner.label.length > 30) return null;
  return leadingFinishCode(inner.value) ? inner : null;
}

/**
 * The plan for ONE description cell, or null where it is a single line.
 *
 * `hasFabricLine`: the bill has a fabric line under this item (a `finish_for`
 * row naming it), which will be written as its COM. `fields` is the BWS
 * register the finish slots are resolved against.
 */
export function planBillDescription(
  raw: string | null | undefined,
  {
    fields,
    hasFabricLine,
    slotOverrides,
  }: {
    fields: SpecFieldEntry[];
    hasFabricLine: boolean;
    /** A reviewer's slot changes, by part key (`StagedBoqLine.slotOverrides`). */
    slotOverrides?: Readonly<Record<string, unknown>> | null;
  },
): BillDescriptionPlan | null {
  const reading = readBillDescription(raw);
  if (!reading) return null;
  const { statements } = reading;
  const cautions: string[] = [];
  let depthWithoutWidth: string | null = null;

  // ---- which size line is placed, and what a reviewer said about its parts --
  const placed = placedSizeOf(statements);
  const resolved = resolveSlotOverrides(placed, slotOverrides);
  if (resolved.problem) cautions.push(`Your slot changes on this line are not applied: ${resolved.problem}`);
  for (const key of resolved.unmatched) {
    cautions.push(`A slot change for “${key}” is ignored: the size line no longer prints that part.`);
  }

  const attributes: PlannedAttribute[] = [];
  const taken = new Set<string>();

  statements.forEach((statement, index) => {
    const label = statement.label;

    // ---- a size line ------------------------------------------------------
    if (label && sizeLabel(label)) {
      if (isTbcValue(statement.value)) {
        cautions.push("The bill gives the size as TBC: no slot is filled.");
        attributes.push(note(statement, "The size is to be confirmed: kept as a TBC note, filling no slot.", "tbc"));
        return;
      }
      if (placed && placed.index === index) {
        const unit = placed.reading.unit;
        const converted = placed.metric ? null : "Converted from inches, exactly: the bill gives no metric size.";
        for (const part of placed.reading.parts) {
          const key = slotPartKey(part);
          const slot = resolved.effective.get(key) ?? part.slot;
          const overridden = resolved.applied.has(key);
          const printedAs = `printed as ${DIMENSION_SLOT_LABELS[part.slot].toLowerCase()} (${key})`;
          if (slot === "note") {
            attributes.push({
              attrGroup: "note",
              label,
              value: key,
              unit,
              slot: null,
              materialCode: null,
              finishWords: null,
              specFieldId: null,
              specFieldName: null,
              state: "confirmed",
              line: statement.line,
              why: `Set by the reviewer: ${printedAs}, kept as a note rather than a slot.`,
              part: { key, printed: part.slot, overridden },
            });
            continue;
          }
          attributes.push({
            attrGroup: "dimension",
            label,
            value: part.figure ?? statement.value,
            unit,
            slot,
            materialCode: null,
            finishWords: null,
            specFieldId: null,
            specFieldName: null,
            state: "confirmed",
            line: statement.line,
            why: overridden
              ? slot === part.slot
                ? `Checked by the reviewer: a ${DIMENSION_SLOT_LABELS[slot].toLowerCase()}, as printed.${converted ? ` ${converted}` : ""}`
                : `Set by the reviewer: ${printedAs}, written as the ${DIMENSION_SLOT_LABELS[slot].toLowerCase()}.${converted ? ` ${converted}` : ""}`
              : converted,
            part: { key, printed: part.slot, overridden },
          });
        }
        // A DEPTH WITH NO WIDTH, on a line that names no diameter, is the
        // shape a round stool or side table is written in when "D" means its
        // diameter. The slot is taken as printed — `D` is a depth in this
        // app's vocabulary, and reading it as a diameter from the ABSENCE of
        // a W would be an inference nothing states — and the reviewer is told,
        // with the two answers beside it. Once a person has said what the D
        // is, there is nothing left to tell them.
        const depth = placed.reading.parts.find((part) => resolved.effective.get(slotPartKey(part)) === "D");
        const holds = new Set(resolved.effective.values());
        if (depth && !holds.has("W") && !holds.has("DIA") && !resolved.applied.has(slotPartKey(depth))) {
          depthWithoutWidth = slotPartKey(depth);
          cautions.push(
            `“${statement.line}” gives a D and no W. It is placed as a depth, as printed; on a round item D may mean the diameter — check it against the drawing.`,
          );
        }
        // What the line states that is not one of the five slots — a length,
        // a base, a clearance — stays as the whole line, verbatim.
        if (placed.reading.qualifier) {
          attributes.push(
            note(statement, `Not one of the five slots: ${placed.reading.qualifier}. The line is kept as printed.`),
          );
        }
        return;
      }
      const refusal = sizeLineRefusal(label, statement.value);
      const why = placed
        ? `Not placed: “${placed.statement.label}” is the size line placed, and this states the same size again.`
        : (refusal ?? "Not read as a size: no stated unit this app converts.");
      if (!placed) cautions.push(`“${statement.line}”: ${refusal ?? "a size this app could not place."}`);
      attributes.push(note(statement, why));
      return;
    }

    // ---- a finish ----------------------------------------------------------
    const inner = statement.value ? innerLabel(statement.value) : null;
    const finishes: FinishReading[] = statement.value
      ? readFinishes(inner?.label ?? label, inner?.value ?? statement.value)
      : [];
    if (finishes.length === 0) {
      attributes.push(note(statement, null));
      return;
    }
    for (const finish of finishes) {
      const pieceValue = finish.value ?? statement.value;
      const value = inner ? `${inner.label}: ${pieceValue}` : pieceValue;
      const piece: BillStatement = { ...statement, value };
      if (finish.kind === null && finish.group === "note") {
        // "Fabric: COM": the client supplies the cloth; nothing is named.
        attributes.push(note(piece, finish.noField));
        continue;
      }
      if (finish.kind === "fabric" && hasFabricLine) {
        attributes.push(
          note(
            piece,
            "This item has its own fabric line, which is written as its COM: this names the same cloth, so it is kept as a note and claims no COM slot.",
          ),
        );
        continue;
      }
      let specFieldId: string | null = null;
      let why: string | null = finish.noField;
      if (!finish.noField) {
        specFieldId = suggestSpecField(
          {
            attrGroup: finish.group,
            labelRaw: inner?.label ?? label,
            valueRaw: pieceValue,
            materialCodeRaw: finish.kindCodeRaw ?? finish.codeRaw,
          },
          fields,
          taken,
        );
        if (specFieldId) taken.add(specFieldId);
        else why = "Every BWS field of this kind is already taken on this item, so it is kept against the item in none.";
      }
      attributes.push({
        attrGroup: finish.group,
        // The label AS PRINTED; an inner label ("Wood:") stays in the value.
        label: label ?? "Finish",
        value,
        unit: null,
        slot: null,
        materialCode: finish.codeRaw,
        finishWords: wordsBeside(pieceValue, finish.codeRaw),
        specFieldId,
        specFieldName: fields.find((field) => field.id === specFieldId)?.name ?? null,
        state: finish.tbc ? "tbc" : "confirmed",
        line: statement.line,
        why,
      });
    }
  });

  const rows: DimensionRow[] = attributes
    .filter((attribute): attribute is PlannedAttribute & { slot: DimensionSlot } => attribute.slot !== null)
    .map((attribute, sortOrder) => ({
      slot: attribute.slot,
      value: attribute.value,
      unit: attribute.unit,
      state: attribute.state,
      sortOrder,
    }));
  const cell = rows.length > 0 ? composeDimensionCell(rows) : { text: "", problems: [] };
  for (const problem of cell.problems) cautions.push(problem.message);
  // One composer, two renderings of the same rows; the problems are the same
  // list in both modes, so they are read once, above.
  const shown = rows.length > 0 ? composeDimensionCell(rows, null, { mode: "screen" }) : null;

  return {
    name: reading.name,
    statements,
    attributes,
    dimensionCell: cell.text,
    dimensionCellShown: shown?.text ?? "",
    dimensionFromImperial: shown?.fromImperial === true,
    cautions: [...new Set(cautions)],
    depthWithoutWidth,
  };
}

// ---- over a sheet ------------------------------------------------------------

type PlanLine = {
  index: number;
  lineNo: number;
  itemDescriptionRaw?: string | null;
  ignored?: boolean;
  rowKind?: string;
  finishFor?: { row: number } | null;
  slotOverrides?: Readonly<Record<string, unknown>> | null;
};

/**
 * Every item line's plan, by its staged index. The review screen and the
 * confirm both call this over the staged sheet, so what the reviewer is shown
 * is what is written. A fabric line has no plan (it is written onto its item
 * by its own path), and neither does a single-line description.
 */
export function planSheetDescriptions(
  lines: readonly PlanLine[],
  fields: SpecFieldEntry[],
): Map<number, BillDescriptionPlan> {
  const withFabric = new Set(
    lines
      .filter((line) => line.rowKind === "finish_for" && !line.ignored && line.finishFor)
      .map((line) => line.finishFor!.row),
  );
  const plans = new Map<number, BillDescriptionPlan>();
  for (const line of lines) {
    if (line.rowKind === "finish_for") continue;
    const plan = planBillDescription(line.itemDescriptionRaw, {
      fields,
      hasFabricLine: withFabric.has(line.lineNo),
      slotOverrides: line.slotOverrides ?? null,
    });
    if (plan) plans.set(line.index, plan);
  }
  return plans;
}

/** The name a line's record carries: the cell's first line where it has more than one, else the description. */
export function billItemName(line: { itemDescription: string; itemDescriptionRaw?: string | null }): string {
  return readBillDescription(line.itemDescriptionRaw)?.name ?? line.itemDescription;
}

/** Whether any live item line of these sheets has its description read at confirm. */
export function billReadsDescriptions(
  sheets: readonly { ignored?: boolean; lines: readonly PlanLine[] }[],
): boolean {
  return sheets.some(
    (sheet) =>
      !sheet.ignored &&
      sheet.lines.some((line) => !line.ignored && line.rowKind !== "finish_for" && readBillDescription(line.itemDescriptionRaw) !== null),
  );
}

// ---- a revision ----------------------------------------------------------------

/** What a record carried forward by a revision already holds. */
export type HeldAttributes = {
  /** It holds a specification this bill's description (or a read of this bill) wrote before. */
  fromBill: boolean;
  slots: DimensionSlot[];
  fieldIds: string[];
};

/**
 * Why a REVISION writes nothing from this line's description onto the record
 * it continues, or null where it writes the plan.
 *
 * A carried record keeps its specs. Writing the description again beside
 * what the first bill wrote is every statement twice; writing it over a slot
 * or field something else fills is a silent replace. Either way nothing is
 * written, and the review says so in these words.
 */
export function revisionDescriptionRefusal(plan: BillDescriptionPlan, held: HeldAttributes): string | null {
  if (plan.attributes.length === 0) return null;
  if (held.fromBill) {
    return "The record this line continues already holds specifications from a bill, so nothing from this description is written. Correct them on the record's Specs tab if the revision changed them.";
  }
  const slots = new Set(held.slots);
  const fieldIds = new Set(held.fieldIds);
  const clash = plan.attributes.find(
    (attribute) =>
      (attribute.slot !== null && slots.has(attribute.slot)) ||
      (attribute.specFieldId !== null && fieldIds.has(attribute.specFieldId)),
  );
  if (clash) {
    return `The record this line continues already holds ${clash.slot ? `a ${clash.slot} dimension` : (clash.specFieldName ?? "that field")} from another document, so nothing from this description is written — replacing what a document said is a person's decision, on the record's Specs tab.`;
  }
  return null;
}
