// Composing the five dimension slots into the single BWS `Dimensions` cell.
//
// Pure, and shared on purpose. The export composes this cell, the record screen
// shows what BWS will receive, and the drawings review previews it before a
// reviewer commits — so all three must produce the same string from the same
// rows. A second implementation is how a screen starts promising something the
// file does not deliver.
//
// THE RULING (Matthew, 2026-09-15). `W*** x D*** x H***mm`: everything in
// millimetres, the unit written ONCE at the end. Seat height appended as
// `SH***`. A round item written `Dia.***` IN PLACE OF `W*** x D***`.
//
// WHAT THIS FILE WILL NOT DO. It will not emit a number it could not derive.
// A dimension with no unit cannot be converted, and a value like
// "approx 720-740" is not a measurement; both are rendered verbatim, outside
// the millimetre group, in a bracket that says why. Guessing a unit or picking
// the first number out of a phrase would produce a figure that looks exactly
// like a real one, and nothing downstream would ever question it. Loud beats
// tidy here.
//
// THE CELL IS A SUMMARY, NOT THE RECORD. Every dimension — including ones this
// cell suppresses, like a width recorded alongside a diameter — is still listed
// long-form on the export's second sheet with its original value, its original
// unit and its source page. That is what makes a converted figure re-checkable
// against the page it came from, and it is why suppression here loses nothing.
import {
  DIMENSION_SLOT_LABELS,
  normaliseDimensionSlot,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";

/** Multipliers to millimetres. `normaliseUnit` guarantees the key exists. */
const TO_MM: Record<AttributeUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** How each slot is written in a BWS cell. `Dia.` carries its own full stop. */
const SLOT_PREFIX: Record<DimensionSlot, string> = { W: "W", D: "D", H: "H", SH: "SH", DIA: "Dia." };

export type MillimetreResult = { ok: true; mm: number } | { ok: false; reason: "not_numeric" };

/**
 * A figure and its unit to whole millimetres.
 *
 * Rounded, because BWS field 3 is a text field a person reads and `W457.2` is
 * false precision on a dimension the drawing itself captioned "Do not scale".
 * The original value and unit stay on the row, so the rounding is always
 * reversible by looking. At most half a millimetre is lost, and only from an
 * inch source.
 */
export function toMillimetres(value: string | null, unit: AttributeUnit): MillimetreResult {
  const { figure } = parseDimensionFigure(value);
  if (figure === null) return { ok: false, reason: "not_numeric" };
  return { ok: true, mm: Math.round(figure * TO_MM[unit]) };
}

export type DimensionFigure = { figure: number | null; tbcInline: boolean };

/**
 * The single number in a dimension value, and whether it is marked TBC.
 *
 * STRICT ON PURPOSE, and this is the function that stops a whole class of
 * silent wrongness. An earlier reader stripped every non-digit, so "190 x 79"
 * became 19079 — a number large enough to vote "millimetres" and flip an entire
 * page to the wrong unit, with nothing anywhere to say so. Anything that is not
 * one figure returns null and contributes nothing.
 *
 * `suggestUnit` shares this, so the magnitude vote and the conversion can never
 * disagree about what counts as a number.
 */
export function parseDimensionFigure(value: string | null): DimensionFigure {
  const text = (value ?? "").trim();
  if (text === "") return { figure: null, tbcInline: false };

  // A leading or trailing TBC is an annotation on the figure, not part of it:
  // the Panther sheets write "1520 TBC" where the dimension is stated but not
  // yet settled. A TBC in the MIDDLE of something is a sentence, not a figure.
  const stripped = text.replace(/^tbc\b[\s:.-]*/i, "").replace(/[\s:.-]*\btbc\.?$/i, "").trim();
  const tbcInline = stripped !== text;

  if (!/^[0-9]+(?:[.,][0-9]+)?$/.test(stripped)) return { figure: null, tbcInline };
  const figure = Number(stripped.replace(",", "."));
  return { figure: Number.isFinite(figure) && figure > 0 ? figure : null, tbcInline };
}

export type CombinedPart = {
  slot: DimensionSlot | null;
  value: string;
  tbc: boolean;
  /** True only where the slot came from printed ORDER rather than a prefix. */
  slotSuggested: boolean;
};

export type CombinedDimensions = { parts: CombinedPart[]; unitRaw: string | null };

/**
 * Reads an overall dimension printed as ONE line: "80 x 70 x 90 cm".
 *
 * The Panther pack carries two specification-sheet templates. One prints a
 * labelled table (`WIDTH 1900 MM`); the other prints this, with no labels at
 * all, in centimetres. Both arrive in the same delivery, so the second cannot
 * be treated as malformed.
 *
 * HOW FAR THE INFERENCE GOES, AND WHY IT STOPS THERE. A prefix on a part
 * (`W1520`, `Dia.460`, `SH420`) is the page stating which dimension it is, and
 * is taken exactly. Three bare parts are read as W x D x H in printed order,
 * flagged `slotSuggested` so the screen badges them. Everything else gets NO
 * slot:
 *
 *   - TWO bare parts could be W x H, W x D or Dia x H. A 60/40 guess here
 *     writes a height into the depth, and nothing downstream questions it.
 *   - FOUR or more has no convention at all.
 *   - A line MIXING prefixed and bare parts resolves only the prefixed ones.
 *     Mixing an explicit reading with a positional one is how the positional
 *     half silently inherits the explicit half's credibility.
 *
 * Three-bare is inferred rather than refused because the reviewer sees the
 * composed cell on the card and a transposed order is obvious there in a
 * second — where refusing would mean hand-assigning three slots per item
 * across a pack, which is the volume that makes a question stop being read.
 */
export function parseCombinedDimensions(raw: string): CombinedDimensions {
  const text = (raw ?? "").trim();
  if (text === "") return { parts: [], unitRaw: null };

  const segments = text.split(/\s*[x×]\s*/i).filter((segment) => segment.trim() !== "");
  if (segments.length === 0) return { parts: [], unitRaw: null };

  // A unit on the LAST segment belongs to the whole line: "80 x 70 x 90 cm"
  // is three centimetre figures, not two unitless ones and a third in cm.
  let unitRaw: string | null = null;
  const parts: CombinedPart[] = segments.map((segment, index) => {
    let body = segment.trim();
    if (index === segments.length - 1) {
      const trailing = /^(.*?)[\s]*([a-zA-Z"']+\.?)$/.exec(body);
      // Only strip a trailing word that is NOT itself part of a slot prefix:
      // "H450mm" must lose "mm", "Dia.460" must not lose "Dia.".
      if (trailing && trailing[1] && /[0-9]$/.test(trailing[1].trim())) {
        unitRaw = trailing[2] ?? null;
        body = trailing[1].trim();
      }
    }
    const prefix = /^([A-Za-z.]+?)\s*([0-9].*)$/.exec(body);
    const slot = prefix ? normaliseDimensionSlot(prefix[1] ?? "") : null;
    const value = prefix && slot ? (prefix[2] ?? body) : body;
    const figure = parseDimensionFigure(value);
    return { slot, value: value.trim(), tbc: figure.tbcInline, slotSuggested: false };
  });

  const anyPrefixed = parts.some((part) => part.slot !== null);
  if (!anyPrefixed && parts.length === 3) {
    const positional: DimensionSlot[] = ["W", "D", "H"];
    parts.forEach((part, index) => {
      part.slot = positional[index] ?? null;
      part.slotSuggested = true;
    });
  }

  return { parts, unitRaw };
}

export type DimensionRow = {
  slot: DimensionSlot;
  value: string | null;
  unit: AttributeUnit | null;
  state: AttributeState;
  sortOrder: number;
};

export type DimensionProblem =
  | { code: "no_unit"; slot: DimensionSlot; message: string }
  | { code: "not_numeric"; slot: DimensionSlot; message: string }
  | { code: "dia_conflict"; slots: DimensionSlot[]; message: string }
  | { code: "duplicate_slot"; slot: DimensionSlot; message: string };

export type DimensionCell = { text: string; problems: DimensionProblem[] };

/** Rendered order. A diameter replaces width and depth rather than joining them. */
const ORDER_ROUND: DimensionSlot[] = ["DIA", "H", "SH"];
const ORDER_SQUARE: DimensionSlot[] = ["W", "D", "H", "SH"];

export function composeDimensionCell(rows: DimensionRow[]): DimensionCell {
  const problems: DimensionProblem[] = [];

  // One row per slot. A second active row in a slot cannot arrive through
  // intake — the unique index in 0011 refuses it — so this is for a legacy or
  // hand-edited record, and the lowest sort order wins because that is the one
  // the reviewer confirmed first.
  const bySlot = new Map<DimensionSlot, DimensionRow>();
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (bySlot.has(row.slot)) {
      problems.push({
        code: "duplicate_slot",
        slot: row.slot,
        message: `Two ${DIMENSION_SLOT_LABELS[row.slot].toLowerCase()} values are recorded; the first is used.`,
      });
      continue;
    }
    bySlot.set(row.slot, row);
  }

  const round = bySlot.has("DIA");
  if (round) {
    const suppressed = (["W", "D"] as const).filter((slot) => bySlot.has(slot));
    if (suppressed.length > 0) {
      const rendered = suppressed
        .map((slot) => {
          const row = bySlot.get(slot)!;
          return `${SLOT_PREFIX[slot]}${row.value ?? ""}${row.unit ?? ""}`;
        })
        .join(", ");
      problems.push({
        code: "dia_conflict",
        slots: [...suppressed],
        message: `${rendered} also recorded — Dia. replaces W and D`,
      });
    }
  }

  // Each part keeps its figure and its TBC apart, because the unit has to land
  // between them. Appending "mm" to the finished string produced "SH440 TBCmm"
  // whenever the LAST slot was the unsettled one — found in the browser, not by
  // a test, because every fixture happened to put the TBC first.
  const inline: { text: string; hasFigure: boolean; tbc: boolean }[] = [];
  const trailing: string[] = [];
  let converted = false;

  for (const slot of round ? ORDER_ROUND : ORDER_SQUARE) {
    const row = bySlot.get(slot);
    if (!row) continue;
    const prefix = SLOT_PREFIX[slot];
    const { figure, tbcInline } = parseDimensionFigure(row.value);
    // Either source counts. The state is a reviewer's decision; `tbcInline` is
    // the document's own word next to the figure ("1520 TBC" on the Panther
    // sheets). Reading only the state would drop a TBC the page printed.
    const tbc = row.state === "tbc" || tbcInline;

    // A slot marked TBC with no figure is an ANSWER — somebody asked and the
    // client has not decided — and it must reach BWS as one. A blank here
    // would read as "nobody looked".
    if (figure === null && tbc) {
      inline.push({ text: prefix, hasFigure: false, tbc: true });
      continue;
    }

    if (figure === null) {
      problems.push({
        code: "not_numeric",
        slot,
        message: `${prefix} ${quoted(row.value)} is not a measurement BWS can take.`,
      });
      trailing.push(`[${prefix} ${quoted(row.value)} — not a number]`);
      continue;
    }

    if (!row.unit) {
      problems.push({
        code: "no_unit",
        slot,
        message: `${prefix}${row.value} has no unit, so it cannot be converted to millimetres.`,
      });
      trailing.push(`[${prefix} ${row.value} — no unit]`);
      continue;
    }

    const result = toMillimetres(row.value, row.unit);
    if (!result.ok) continue; // unreachable: figure is non-null, so the parse agreed
    converted = true;
    inline.push({ text: `${prefix}${result.mm}`, hasFigure: true, tbc });
  }

  // The unit is written once, against the LAST FIGURE rather than at the end of
  // the string — otherwise a TBC on the final slot reads "SH440 TBCmm". And
  // only when something was actually converted, so a cell of nothing but TBCs
  // never claims a measurement it does not have.
  const lastFigure = inline.reduce((last, part, index) => (part.hasFigure ? index : last), -1);
  const group = inline
    .map((part, index) => `${part.text}${converted && index === lastFigure ? "mm" : ""}${part.tbc ? " TBC" : ""}`)
    .join(" x ");
  const conflict = problems.find((problem) => problem.code === "dia_conflict");
  const parts = [group, ...trailing, ...(conflict ? [`[conflict: ${conflict.message}]`] : [])].filter((part) => part !== "");
  return { text: parts.join(" "), problems };
}

/** A phrase is quoted so it reads as something the document said; a bare figure is not. */
function quoted(value: string | null): string {
  const text = (value ?? "").trim();
  if (text === "") return '""';
  return /^[0-9]+(?:[.,][0-9]+)?$/.test(text) ? text : `"${text}"`;
}
