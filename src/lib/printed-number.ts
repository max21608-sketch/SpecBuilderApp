// THE ONE READER OF A PRINTED NUMBER: a quantity a bill printed, a figure a
// drawing or an email printed, a total a PDF printed.
//
// ============================================================================
// WHY THERE IS ONE (audit 2026-11-06, C3 / C4 / D10).
//
// There were six, each with its own rule, and each rule was the plausible
// wrong answer in a different place:
//
//   * `Number(String(cell).replace(/[^0-9.-]/g, ""))` read `TBC` as 0
//     (`Number("")` is 0), so a bill that said "not decided" said "none"; it
//     joined `2 x 3` into 23 and `12 (6+6)` into 1266; and it passed `1.5`
//     straight to an INTEGER column, where the confirm failed the whole bill
//     with "Nothing was written".
//   * `Number(text.replace(",", "."))` read EVERY comma as a decimal point,
//     so `W1,200` composed as `W1mm` in BWS field 3 with nothing to flag it,
//     and on an unmarked drawing `1,800` voted the page into centimetres.
//
// ---- THE COMMA IS REFUSED, NOT GUESSED (Max, 2026-11-06) ------------------
//
// `1,200` is twelve hundred in London and one point two in Paris, and both
// kinds of document arrive here. A reading either way is a figure that looks
// exactly like a real one, and nothing downstream would question it. So a
// single group of three digits after one separator (`AMBIGUOUS_GROUP`) is its
// own outcome, `ambiguous_comma`, and every caller turns it into a visible
// refusal that quotes the document's words. What IS unambiguous is read: a
// decimal comma with one or two digits (`1,5`), a leading zero (`0,750` can
// open no thousands group), two groups (`1,200,000`), and a group followed by
// the other separator (`1.200,5`).
//
// ---- WHAT IT RETURNS -------------------------------------------------------
//
// A named outcome, never a bare number-or-null, because the caller's sentence
// depends on WHICH refusal it is: "a quantity is a whole number" and "reads as
// a thousand or as a decimal" are different next steps for a person.
//
// A leaf: it imports nothing, so a client component may use it.
// ============================================================================

export type PrintedNumber =
  /** One integer, as printed. */
  | { kind: "whole"; value: number; raw: string }
  /** One number with a fractional part. */
  | { kind: "decimal"; value: number; raw: string }
  /** `1,200` / `1.200`: a thousand in one convention, a decimal in another. Not read. */
  | { kind: "ambiguous_comma"; raw: string }
  /**
   * Anything else that was printed: letters (`TBC`, `As req'd`), several
   * figures (`2 x 3`, `12 (6+6)`), a date cell, a boolean cell. Never a number.
   */
  | { kind: "words"; raw: string }
  /** Nothing printed: blank, null, a formula with no cached result. */
  | { kind: "none" };

/**
 * The words a bill writes AFTER a count, stripped before the count is read:
 * `2 nr`, `12 No.`, `4pcs`, `6 off`. Only after a number and only at the end.
 * A length unit is not here: `3.6 m` is linear metres, and a quantity in
 * metres is a statement to quote, not a count.
 */
export const QUANTITY_UNIT_WORDS: readonly string[] = ["nr", "no", "no.", "pcs", "pc", "ea", "units", "unit", "off"];

const UNIT_SUFFIX = new RegExp(
  String.raw`^(.*?\d)\s*(?:${QUANTITY_UNIT_WORDS.map((word) => word.replace(/\./g, String.raw`\.`)).join("|")})$`,
  "i",
);

/** A plain integer. */
export const WHOLE = /^-?\d+$/;
/** A decimal POINT: any number of digits after it, except the ambiguous group below. */
export const DECIMAL_POINT = /^-?\d+\.\d+$/;
/** A decimal COMMA, read only with one or two digits after it (`1,5`, `1,20`). */
export const DECIMAL_COMMA = /^-?\d+,\d{1,2}$/;
/**
 * THE REFUSED SHAPE: one group of three after one separator, opened by a
 * non-zero digit. `0,750` is not here: a leading zero opens no thousands group.
 */
export const AMBIGUOUS_GROUP = /^-?[1-9]\d{0,2}[.,]\d{3}$/;
/** Two or more groups with ONE separator: `1,200,000`, `1.200.000`. */
export const GROUPED_WHOLE = /^-?[1-9]\d{0,2}(?:([.,])\d{3})(?:\1\d{3})+$/;
/** Groups, then the OTHER separator as the decimal: `1,200.5`, `1.200,5`. */
export const GROUPED_DECIMAL = /^-?[1-9]\d{0,2}(?:(,)\d{3})+\.\d+$|^-?[1-9]\d{0,2}(?:(\.)\d{3})+,\d+$/;
/** A leading zero before a comma and three or more digits: `0,750`. */
const ZERO_DECIMAL_COMMA = /^-?0,\d+$/;

/** A Date cell as the bill shows it: the UTC calendar day, which is what a sheet holds. */
function dateText(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function numberOutcome(value: number, raw: string): PrintedNumber {
  return Number.isInteger(value) ? { kind: "whole", value, raw } : { kind: "decimal", value, raw };
}

/** The one reading of a printed number. See the header for every rule. */
export function readPrintedNumber(text: unknown): PrintedNumber {
  if (text === null || text === undefined) return { kind: "none" };
  // A NUMBER CELL is already a number: there is no comma to misread. Not
  // finite is not a printed value at all.
  if (typeof text === "number") return Number.isFinite(text) ? numberOutcome(text, String(text)) : { kind: "none" };
  // A boolean or a date cell is something the sheet printed, and never a
  // count. A date read as a number is days since 1900, or milliseconds.
  if (typeof text === "boolean") return { kind: "words", raw: text ? "TRUE" : "FALSE" };
  if (text instanceof Date) return Number.isNaN(text.getTime()) ? { kind: "none" } : { kind: "words", raw: dateText(text) };
  if (typeof text !== "string") return { kind: "none" };

  const raw = text.trim();
  if (raw === "") return { kind: "none" };
  const body = (UNIT_SUFFIX.exec(raw)?.[1] ?? raw).trim();

  if (WHOLE.test(body)) return numberOutcome(Number(body), raw);
  if (AMBIGUOUS_GROUP.test(body)) return { kind: "ambiguous_comma", raw };
  if (DECIMAL_POINT.test(body)) return numberOutcome(Number(body), raw);
  if (DECIMAL_COMMA.test(body) || ZERO_DECIMAL_COMMA.test(body)) return numberOutcome(Number(body.replace(",", ".")), raw);
  if (GROUPED_WHOLE.test(body)) return numberOutcome(Number(body.replace(/[.,]/g, "")), raw);
  if (GROUPED_DECIMAL.test(body)) {
    // The LAST separator is the decimal; every earlier one is a group.
    const at = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
    const value = Number(`${body.slice(0, at).replace(/[.,]/g, "")}.${body.slice(at + 1)}`);
    return numberOutcome(value, raw);
  }
  return { kind: "words", raw };
}

// ---- a quantity ------------------------------------------------------------

/** `spec_records.qty` is a Postgres `integer` (0002). Past these the confirm fails. */
export const INT4_MAX = 2147483647;
export const INT4_MIN = -2147483648;

export type QuantityRefusal = "blank" | "words" | "decimal" | "ambiguous_comma" | "out_of_range";

export type QuantityReading =
  | { ok: true; qty: number }
  /** `raw` is the cell as printed, null only where it was blank. */
  | { ok: false; reason: QuantityRefusal; raw: string | null };

/**
 * A bill's quantity cell: a WHOLE number the integer column can hold, or no
 * quantity at all, with the reason and the cell as printed.
 *
 * NEVER 0 FOR A WORD AND NEVER 1 FOR A BLANK. "Not given" is the honest state
 * and the screens print it with the cell's own words. A negative is kept: it
 * is what the bill printed (a credit line), and a person reads it on review.
 */
export function readQuantity(cell: unknown): QuantityReading {
  const read = readPrintedNumber(cell);
  switch (read.kind) {
    case "none":
      return { ok: false, reason: "blank", raw: null };
    case "whole":
      return read.value > INT4_MAX || read.value < INT4_MIN
        ? { ok: false, reason: "out_of_range", raw: read.raw }
        : { ok: true, qty: read.value };
    case "decimal":
      return { ok: false, reason: "decimal", raw: read.raw };
    case "ambiguous_comma":
      return { ok: false, reason: "ambiguous_comma", raw: read.raw };
    case "words":
      return { ok: false, reason: "words", raw: read.raw };
  }
}

/**
 * What a screen prints where a bill line has no quantity: the cell as the bill
 * printed it, and why it is not a count where that is not plain from the
 * words. ONE wording, so the bill review, the phase table and the record
 * cannot describe one state three ways.
 *
 * Takes the printed text rather than a stored reason, because the reason is
 * COMPUTED from it every time (a stored reason goes stale the day this reader
 * learns a new shape) and a bill staged before 2026-11-06 carries no text.
 */
export function quantityNotGiven(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (text === "") return "quantity not given";
  const reading = readQuantity(text);
  const why = reading.ok
    ? ""
    : reading.reason === "decimal"
      ? "; a quantity is a whole number"
      : reading.reason === "ambiguous_comma"
        ? ", which reads as a thousand or as a decimal"
        : reading.reason === "out_of_range"
          ? ", too large to be a count"
          : "";
  return `quantity not given (the bill says “${text}”${why})`;
}
