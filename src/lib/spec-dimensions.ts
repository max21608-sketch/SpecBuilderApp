// Reading a dimension out of an email, which writes prose where a drawing
// writes a figure.
//
// ============================================================================
// WHY THIS EXISTS AT ALL
//
// A drawing's dimension arrives already split: `labelRaw` "WIDTH", `valueRaw`
// "1900", `unitRaw` "MM". An email writes "the seat height is 445mm (measured
// to top of cushion, compressed)" and the model copies that wording verbatim,
// as it is told to. So `parseDimensionFigure` — which is STRICT on purpose and
// returns nothing for anything that is not one bare figure — reads null, and
// the value reaches the checklist as a string or not at all.
//
// The consequence found on the first real email (2026-09-17): "Seat height"
// and "Overall" both belong to the ONE `Dimensions` question, so aliasing them
// both onto it would put two proposals on one answer and hit the
// `duplicate_target` blocker. A dimension does not reach its field by matching
// a question — it carries a SLOT, and all five slots compose into BWS field 3.
//
// SO AN EMAIL'S DIMENSION BECOMES A `record_attributes` ROW, exactly like a
// drawing's, and the checklist answer is composed by `promote-answers.ts` over
// every slot the record holds. That is not a workaround, it is the existing
// architecture: `record_attributes` is what a DOCUMENT said, an email is a
// document, and `composeDimensionCell` stays the single composer. Writing the
// answer directly instead would mean the next drawing confirm recomposed from
// the attributes alone and silently wiped what the email contributed.
//
// ============================================================================
// WHAT IT REFUSES TO DO
//
// - It never infers a unit from a figure's SIZE. That is the rule the whole
//   dimension model is built around: a wrong unit reads as a real measurement
//   and nothing downstream questions it. A unit is taken from the email's own
//   wording or it is left null, and `composeDimensionCell` then renders the
//   value verbatim in a bracket saying why.
// - It never HALF-reads a measurement. Plain inches are a unit this app holds
//   and `18"` converts exactly; feet-and-inches is not, and `1'6"` is refused
//   whole rather than read as its feet figure. See `imperialCompound`.
// - It never matches a slot on a SUBSTRING. `normaliseDimensionSlot` folds the
//   WHOLE label, so "ARM HEIGHT" is not a height and "WIDTH SEAT" is not a
//   width. Both are printed beside values they would destroy.
// - It never throws the qualifier away. "measured to top of cushion,
//   compressed" and "from FFL" are specification content; the figure is the
//   derived reading and the wording is the evidence. Anything left over after
//   the figure and unit are taken out is handed back for the caller to keep as
//   a note.
// ============================================================================
import { imperialCompound, parseCombinedDimensions, parseDimensionFigure } from "@/lib/dimensions";
import {
  containsPhrase,
  normaliseDimensionSlot,
  normaliseUnit,
  TBC_TOKENS,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { normaliseName } from "@/lib/matching";
import { SIZE_LABELS } from "@/lib/spec-reading-vocab";

export type DimensionPart = {
  slot: DimensionSlot;
  /** The bare figure, as the email wrote it. Null when the email says TBC. */
  figure: string | null;
  /** True where the slot came from printed ORDER rather than a stated prefix. */
  slotSuggested: boolean;
};

export type DimensionReading = {
  parts: DimensionPart[];
  unit: AttributeUnit | null;
  /**
   * Where the unit came from. `stated` is the email's own wording, which is the
   * email's equivalent of a unit printed on the page — the top of the unit
   * precedence order. There is deliberately no magnitude fallback.
   */
  unitSource: "stated" | null;
  /** What is left of the wording once the figures and unit are taken out. */
  qualifier: string | null;
  /** The email says this dimension is not settled. A real state, not a blank. */
  tbc: boolean;
  /**
   * The line is in inches — its own unit, or an imperial label. Read by the
   * resolver, which places an item's METRIC size line in preference to its
   * imperial one where a document gives both (a bill's "Sizes (mm)" beside
   * "Sizes (ft-in)"): the two are one statement twice, and placing both would
   * be a duplicate on every slot. Optional so a caller building a reading by
   * hand is not made to say.
   */
  imperial?: boolean;
};

/**
 * Labels that mean "the overall size", where the VALUE carries the slots — the
 * list lives in `spec-reading-vocab.ts`, with where each came from, so it can be
 * re-checked against the next specifier's bill.
 */
const OVERALL_LABELS = new Set(SIZE_LABELS.map((entry) => entry.label));

/** What an overall label says about itself: its bracketed unit, if it gives one. */
export type SizeLabel = {
  /** The unit the bracket names — "Sizes (mm)" — or null. Never read from a figure's size. */
  unit: AttributeUnit | null;
  /** The bracket names feet, inches or both — "Sizes (ft-in)", "Sizes (Inch)". */
  imperial: boolean;
};

/**
 * Whether a label is an overall-size label, and what its bracket says.
 *
 * Null for every other label, which is what keeps "Arm height (mm)" and
 * "Width seat" out: the bracket is taken off and the REST must be a whole
 * overall label.
 */
export function sizeLabel(attributeRaw: string | null): SizeLabel | null {
  const raw = attributeRaw ?? "";
  const brackets = [...raw.matchAll(/\(([^)]*)\)/g)].map((match) => (match[1] ?? "").trim());
  const rest = raw.replace(/\([^)]*\)/g, " ");
  if (!OVERALL_LABELS.has(fold(rest))) return null;
  const inner = brackets.find((text) => text !== "") ?? null;
  return {
    unit: inner ? normaliseUnit(inner) : null,
    imperial: inner ? /ft|feet|foot|inch|\bin\b|["'′″]/i.test(inner) : false,
  };
}

function fold(raw: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A leading figure, an optional unit word, and whatever wording follows.
 *
 * The unit is only taken when `normaliseUnit` recognises it, so "445 measured
 * to the top" keeps "measured to the top" as the qualifier rather than
 * recording a unit of "measured". A bare `m` IS a metre, which is why the unit
 * word has to be a whole token: "520mm from FFL" must not read the "f" of
 * "from".
 */
function splitFigure(raw: string): { figure: string | null; unit: AttributeUnit | null; rest: string } {
  // FEET AND INCHES IS REFUSED WHOLE, before the leading figure is taken.
  // `1'6"` matched the regex below as a figure of ONE with `' 6"` left over as
  // the qualifier, so an 18-inch arm height reached the reviewer as a 1 with a
  // unit box beside it. Plain inches are NOT this case and are not touched:
  // `in` is in the unit vocabulary and `18"` converts exactly.
  if (imperialCompound(raw)) return { figure: null, unit: null, rest: raw.trim() };
  const match = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z"']+\.?)?\s*([\s\S]*)$/.exec(raw);
  if (!match || !match[1]) return { figure: null, unit: null, rest: raw.trim() };

  const figure = match[1];
  const candidate = (match[2] ?? "").trim();
  const trailing = (match[3] ?? "").trim();
  // A PROPORTION IS NOT A LENGTH. A fabric's "Width: 22% PC, 22% WV, …" is its
  // composition, and reading the 22 as a width put 22 in an item's W slot.
  if (!candidate && trailing.startsWith("%")) return { figure: null, unit: null, rest: raw.trim() };
  if (!candidate) return { figure, unit: null, rest: trailing };

  const unit = normaliseUnit(candidate);
  // An unrecognised word after the figure is wording, not a unit. Put it back.
  if (!unit) return { figure, unit: null, rest: [candidate, trailing].filter(Boolean).join(" ") };
  return { figure, unit, rest: trailing };
}

function isTbc(raw: string): boolean {
  const norm = normaliseName(raw);
  return TBC_TOKENS.includes(norm) || TBC_TOKENS.some((token) => containsPhrase(norm, token));
}

/**
 * The dimension an observation states, or null where it states none.
 *
 * Null is the ordinary answer and the caller falls through to requirement
 * matching with it: "Arm height" returns null DELIBERATELY, because it is not
 * one of the five slots and CLAUDE.md names it as the case a substring rule
 * would destroy.
 */
export function readDimension(attributeRaw: string | null, valueRaw: string | null): DimensionReading | null {
  const value = (valueRaw ?? "").trim();
  if (value === "") return null;

  // ---- one labelled slot: "Seat height" / "Width" -------------------------
  const slot = normaliseDimensionSlot(attributeRaw);
  if (slot) {
    if (isTbc(value)) {
      return { parts: [{ slot, figure: null, slotSuggested: false }], unit: null, unitSource: null, qualifier: null, tbc: true };
    }
    const { figure, unit, rest } = splitFigure(value);
    // A labelled slot whose value carries no leading figure is not a
    // measurement this can read — "as existing", "match the sofa", or a
    // feet-and-inches compound. Handing it back as null keeps it on the
    // ordinary path, wording intact, rather than inventing a row.
    if (!figure) return null;
    return {
      parts: [{ slot, figure, slotSuggested: false }],
      unit,
      unitSource: unit ? "stated" : null,
      qualifier: rest || null,
      tbc: false,
    };
  }

  // ---- an overall line: "Overall" / "Sizes (mm)" / "Spec size" -----------
  const label = sizeLabel(attributeRaw);
  if (!label) return null;
  if (isTbc(value)) return null; // "Dimensions: TBC" places no slot at all.

  const text = normaliseMarks(value);
  // FEET AND INCHES ANYWHERE ON THE LINE REFUSES THE WHOLE LINE. One part in
  // `2'-5"` beside two plain-inch parts is not a line with two readable
  // figures: it is an imperial line this app does not convert, and placing the
  // two it could read would present a half-read size as the item's.
  if (imperialCompoundAnywhere(text)) return null;

  const combined = parseCombinedDimensions(splitSlashStatements(text));
  const parts: DimensionPart[] = [];
  const units = new Set<AttributeUnit>();
  const lineUnit = normaliseUnit(combined.unitRaw);
  if (lineUnit) units.add(lineUnit);
  if (label.unit) units.add(label.unit);
  /** What the line states that is not one of the five slots, verbatim. */
  const leftovers: string[] = [];
  // A COMPONENT named partway along the line — "Dia 122 x H 75 x Base: W 66 x
  // D 66" — ends the item's own size. What follows is the base's, and reading
  // its `D 66` as the table's depth would sit a depth beside a diameter.
  let component = false;
  for (const part of combined.parts) {
    const shown = part.slot && !part.slotSuggested ? `${part.slot} ${part.value}`.trim() : part.value;
    if (component || part.value.includes(":")) {
      component = true;
      leftovers.push(shown);
      continue;
    }
    if (!part.slot) {
      // `L`, `OAH`, `P`: printed, and not one of the five. Never mapped — `L`
      // is not `W` — and never dropped.
      leftovers.push(part.value);
      continue;
    }
    const figure = figureWithUnit(part.value);
    if (!figure) {
      leftovers.push(shown);
      continue;
    }
    if (figure.unit) units.add(figure.unit);
    parts.push({ slot: part.slot, figure: figure.figure, slotSuggested: part.slotSuggested });
  }
  if (parts.length === 0) return null;

  // Two parts claiming one slot is the page contradicting itself. Place
  // nothing rather than picking: the reviewer reads the line on the card.
  const slots = new Set(parts.map((part) => part.slot));
  if (slots.size !== parts.length) return null;

  // Two units on one line — a label saying (mm) over a figure written in
  // inches — is the document disagreeing with itself about its scale. Nothing
  // converts that; the reviewer reads the line.
  if (units.size > 1) return null;
  const unit = [...units][0] ?? null;

  return {
    parts,
    unit,
    unitSource: unit ? "stated" : null,
    qualifier: leftovers.length > 0 ? leftovers.join(" x ") : null,
    tbc: false,
    imperial: unit === "in" || label.imperial,
  };
}

/**
 * A spreadsheet's quote marks, as they arrive: a model copying a cell writes
 * an inch mark as `""` (the CSV escape) or as `''`, and a typesetter as `″`.
 * All are one inch mark here, and `′` is a foot mark, so the imperial tests
 * below see one spelling of each.
 */
function normaliseMarks(raw: string): string {
  return raw.replace(/""/g, '"').replace(/''/g, '"').replace(/″/g, '"').replace(/′/g, "'");
}

/** A feet mark after a figure, anywhere on the line: `3'`, `2'-5"`, `4 ft`. */
function imperialCompoundAnywhere(text: string): boolean {
  return /[0-9]\s*(?:'|ft\b|foot\b|feet\b)/i.test(text);
}

/**
 * "SH 450/H 660" is two statements, a seat height and a height. Split only
 * where BOTH sides carry a prefix, so a range ("450/460") or a fraction stays
 * one part — and then fails to read as a figure, which is right.
 */
function splitSlashStatements(text: string): string {
  return text.replace(/([0-9]"?)\s*\/\s*(?=[A-Za-z]{1,3}\.?\s*[0-9])/g, "$1 x ");
}

/**
 * One part's figure and the unit written on it, if any: `450`, `450mm`,
 * `21"`. Strict like `parseDimensionFigure`: anything else is not a figure.
 */
function figureWithUnit(value: string): { figure: string; unit: AttributeUnit | null } | null {
  const match = /^([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z"]+)?\.?$/.exec(value.trim());
  if (!match?.[1]) return null;
  if (parseDimensionFigure(match[1]).figure === null) return null;
  const unitWord = match[2] ?? null;
  if (!unitWord) return { figure: match[1], unit: null };
  const unit = normaliseUnit(unitWord);
  return unit ? { figure: match[1], unit } : null;
}

/**
 * Why a SIZE line reads no dimension, in the reviewer's words — or null where
 * it is not a size line, or it read.
 *
 * Only the refusal worth saying: a feet-and-inches line. Every other size line
 * that reads nothing (a TBC, a sentence) is plain to a person looking at it.
 */
export function sizeLineRefusal(attributeRaw: string | null, valueRaw: string | null): string | null {
  if (!sizeLabel(attributeRaw)) return null;
  const value = (valueRaw ?? "").trim();
  if (value === "" || isTbc(value)) return null;
  if (!imperialCompoundAnywhere(normaliseMarks(value))) return null;
  return "Feet and inches are not converted, so this size is kept as the document wrote it and fills no slot.";
}
