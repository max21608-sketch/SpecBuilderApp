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
// - It never matches a slot on a SUBSTRING. `normaliseDimensionSlot` folds the
//   WHOLE label, so "ARM HEIGHT" is not a height and "WIDTH SEAT" is not a
//   width. Both are printed beside values they would destroy.
// - It never throws the qualifier away. "measured to top of cushion,
//   compressed" and "from FFL" are specification content; the figure is the
//   derived reading and the wording is the evidence. Anything left over after
//   the figure and unit are taken out is handed back for the caller to keep as
//   a note.
// ============================================================================
import { parseCombinedDimensions, parseDimensionFigure } from "@/lib/dimensions";
import {
  containsPhrase,
  normaliseDimensionSlot,
  normaliseUnit,
  TBC_TOKENS,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { normaliseName } from "@/lib/matching";

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
};

/**
 * Labels that mean "the overall size", where the VALUE carries the slots.
 *
 * Kept separate from `normaliseDimensionSlot`'s aliases because none of these
 * names a slot: "Overall" is not a width. A label here only licenses reading
 * the value as a combined line — it never places a slot by itself.
 */
const OVERALL_LABELS = new Set([
  "overall",
  "overall dimensions",
  "overall dimension",
  "overall size",
  "overall sizes",
  "dimensions",
  "dimension",
  "dims",
  "size",
  "sizes",
  "footprint",
]);

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
  const match = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z"']+\.?)?\s*([\s\S]*)$/.exec(raw);
  if (!match || !match[1]) return { figure: null, unit: null, rest: raw.trim() };

  const figure = match[1];
  const candidate = (match[2] ?? "").trim();
  const trailing = (match[3] ?? "").trim();
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
    // measurement this can read — "as existing", "match the sofa". Handing it
    // back as null keeps it on the ordinary path rather than inventing a row.
    if (!figure) return null;
    return {
      parts: [{ slot, figure, slotSuggested: false }],
      unit,
      unitSource: unit ? "stated" : null,
      qualifier: rest || null,
      tbc: false,
    };
  }

  // ---- an overall line: "Overall" / "Dimensions" --------------------------
  if (!OVERALL_LABELS.has(fold(attributeRaw))) return null;
  if (isTbc(value)) return null; // "Dimensions: TBC" places no slot at all.

  const combined = parseCombinedDimensions(value);
  const parts: DimensionPart[] = [];
  for (const part of combined.parts) {
    if (!part.slot) continue;
    const figure = parseDimensionFigure(part.value);
    if (figure.figure === null) continue;
    parts.push({ slot: part.slot, figure: String(part.value).trim(), slotSuggested: part.slotSuggested });
  }
  if (parts.length === 0) return null;

  // Two parts claiming one slot is the page contradicting itself. Place
  // nothing rather than picking: the reviewer reads the line on the card.
  const slots = new Set(parts.map((part) => part.slot));
  if (slots.size !== parts.length) return null;

  const unit = normaliseUnit(combined.unitRaw);
  return {
    parts,
    unit,
    unitSource: unit ? "stated" : null,
    qualifier: null,
    tbc: false,
  };
}
