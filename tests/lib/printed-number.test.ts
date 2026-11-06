// Pure tier. THE ONE NUMBER READER (audit 2026-11-06, C3 / C4 / D10).
//
// Before this file there were six readers of a printed number, each with its
// own rule for a comma, a word and a fraction. The table below is the whole
// contract of the one that replaced them, and every row is a cell a real bill,
// drawing or email can print. Invented values; no client document is quoted.
import { describe, it, expect } from "vitest";
import {
  AMBIGUOUS_GROUP,
  INT4_MAX,
  INT4_MIN,
  QUANTITY_UNIT_WORDS,
  quantityNotGiven,
  readPrintedNumber,
  readQuantity,
  type PrintedNumber,
} from "@/lib/printed-number";

const ONE_DATE = new Date(Date.UTC(2026, 10, 6));

/** [cell, expected outcome]. The rows the audit named, then the ones the brief added. */
const TABLE: [unknown, PrintedNumber][] = [
  // ---- words are never 0 (C3: `Number("")` is 0) --------------------------
  ["TBC", { kind: "words", raw: "TBC" }],
  ["N/A", { kind: "words", raw: "N/A" }],
  ["As req'd", { kind: "words", raw: "As req'd" }],
  ["Provisional", { kind: "words", raw: "Provisional" }],
  [true, { kind: "words", raw: "TRUE" }],
  // ---- digits are never joined (C3: `2 x 3` → 23, `12 (6+6)` → 1266) -------
  ["2 x 3", { kind: "words", raw: "2 x 3" }],
  ["12 (6+6)", { kind: "words", raw: "12 (6+6)" }],
  ["L1: 3, L2: 4", { kind: "words", raw: "L1: 3, L2: 4" }],
  // ---- a date cell is never a huge number ----------------------------------
  [ONE_DATE, { kind: "words", raw: "2026-11-06" }],
  // ---- the comma (C4) -------------------------------------------------------
  ["1,200", { kind: "ambiguous_comma", raw: "1,200" }],
  ["1.200", { kind: "ambiguous_comma", raw: "1.200" }],
  ["1,5", { kind: "decimal", value: 1.5, raw: "1,5" }],
  ["1,20", { kind: "decimal", value: 1.2, raw: "1,20" }],
  // A leading 0 cannot open a thousands group, so the separator is a decimal.
  ["0,750", { kind: "decimal", value: 0.75, raw: "0,750" }],
  ["0.750", { kind: "decimal", value: 0.75, raw: "0.750" }],
  // Two groups, or a group AND the other separator, say which is which.
  ["1,200,000", { kind: "whole", value: 1200000, raw: "1,200,000" }],
  ["1.200.000", { kind: "whole", value: 1200000, raw: "1.200.000" }],
  ["1,200.5", { kind: "decimal", value: 1200.5, raw: "1,200.5" }],
  ["1.200,5", { kind: "decimal", value: 1200.5, raw: "1.200,5" }],
  // No convention prints four digits after a comma.
  ["1,2000", { kind: "words", raw: "1,2000" }],
  // ---- unit words on a quantity --------------------------------------------
  ["2 nr", { kind: "whole", value: 2, raw: "2 nr" }],
  ["12 No.", { kind: "whole", value: 12, raw: "12 No." }],
  ["4pcs", { kind: "whole", value: 4, raw: "4pcs" }],
  ["6 off", { kind: "whole", value: 6, raw: "6 off" }],
  // ---- plain numbers ---------------------------------------------------------
  ["1.5", { kind: "decimal", value: 1.5, raw: "1.5" }],
  [1.5, { kind: "decimal", value: 1.5, raw: "1.5" }],
  ["-3", { kind: "whole", value: -3, raw: "-3" }],
  ["0", { kind: "whole", value: 0, raw: "0" }],
  [0, { kind: "whole", value: 0, raw: "0" }],
  [14, { kind: "whole", value: 14, raw: "14" }],
  ["2147483648", { kind: "whole", value: 2147483648, raw: "2147483648" }],
  [" 7 ", { kind: "whole", value: 7, raw: "7" }],
  // ---- nothing printed -------------------------------------------------------
  ["", { kind: "none" }],
  ["   ", { kind: "none" }],
  [null, { kind: "none" }],
  [undefined, { kind: "none" }],
  [Number.NaN, { kind: "none" }],
  // A formula with no cached value arrives as an object: not something printed.
  [{ formula: "SUM(A1:A3)" }, { kind: "none" }],
];

describe("readPrintedNumber", () => {
  it.each(TABLE)("reads %j", (cell, expected) => {
    expect(readPrintedNumber(cell)).toEqual(expected);
  });

  it("reads a unit word only at the end, after a number", () => {
    // `nr` alone is a word; `nr 2` is not a number followed by its unit.
    expect(readPrintedNumber("nr").kind).toBe("words");
    expect(readPrintedNumber("nr 2").kind).toBe("words");
    for (const word of QUANTITY_UNIT_WORDS) expect(readPrintedNumber(`3 ${word}`)).toMatchObject({ kind: "whole", value: 3 });
  });

  it("names the ambiguous shape as one pattern the code and the table share", () => {
    expect(AMBIGUOUS_GROUP.test("1,200")).toBe(true);
    expect(AMBIGUOUS_GROUP.test("999.999")).toBe(true);
    expect(AMBIGUOUS_GROUP.test("0,200")).toBe(false);
    expect(AMBIGUOUS_GROUP.test("1,20")).toBe(false);
    expect(AMBIGUOUS_GROUP.test("1,200,000")).toBe(false);
  });
});

describe("readQuantity", () => {
  it("takes a whole number inside the integer column's range", () => {
    expect(readQuantity(14)).toEqual({ ok: true, qty: 14 });
    expect(readQuantity("2 nr")).toEqual({ ok: true, qty: 2 });
    expect(readQuantity("-3")).toEqual({ ok: true, qty: -3 });
    expect(readQuantity("0")).toEqual({ ok: true, qty: 0 });
    expect(readQuantity(INT4_MAX)).toEqual({ ok: true, qty: INT4_MAX });
    expect(readQuantity(INT4_MIN)).toEqual({ ok: true, qty: INT4_MIN });
  });

  it("gives a blank cell no quantity and no reason", () => {
    expect(readQuantity("")).toEqual({ ok: false, reason: "blank", raw: null });
    expect(readQuantity(null)).toEqual({ ok: false, reason: "blank", raw: null });
  });

  it("refuses everything else, keeping the cell as printed", () => {
    // spec_records.qty is an INTEGER (0002): a float or a figure past int4
    // used to reach the confirm and fail the whole bill with "Nothing was
    // written". It is refused at staging instead, line by line.
    expect(readQuantity("TBC")).toEqual({ ok: false, reason: "words", raw: "TBC" });
    expect(readQuantity(1.5)).toEqual({ ok: false, reason: "decimal", raw: "1.5" });
    expect(readQuantity("3,6")).toEqual({ ok: false, reason: "decimal", raw: "3,6" });
    expect(readQuantity("1,200")).toEqual({ ok: false, reason: "ambiguous_comma", raw: "1,200" });
    expect(readQuantity("2147483648")).toEqual({ ok: false, reason: "out_of_range", raw: "2147483648" });
    expect(readQuantity(ONE_DATE)).toEqual({ ok: false, reason: "words", raw: "2026-11-06" });
    expect(readQuantity(true)).toEqual({ ok: false, reason: "words", raw: "TRUE" });
  });
});

describe("quantityNotGiven", () => {
  it("quotes what the bill printed, and why it is not a quantity where that is not plain", () => {
    expect(quantityNotGiven("TBC")).toBe("quantity not given (the bill says “TBC”)");
    expect(quantityNotGiven("1.5")).toBe("quantity not given (the bill says “1.5”; a quantity is a whole number)");
    expect(quantityNotGiven("1,200")).toBe(
      "quantity not given (the bill says “1,200”, which reads as a thousand or as a decimal)",
    );
    expect(quantityNotGiven("2147483648")).toBe("quantity not given (the bill says “2147483648”, too large to be a count)");
  });

  it("says only 'quantity not given' where the bill printed nothing", () => {
    expect(quantityNotGiven(null)).toBe("quantity not given");
    expect(quantityNotGiven(undefined)).toBe("quantity not given");
    expect(quantityNotGiven("  ")).toBe("quantity not given");
  });
});
