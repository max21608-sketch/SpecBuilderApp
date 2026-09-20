// Pure tier. The fixtures below are SYNTHETIC — they reproduce the SHAPE of a
// real client BOQ (title rows, a late header, a repeated code, per-level
// quantity columns, free-text descriptions, a totals row) without carrying a
// single real line of client data. Real BOQs stay in the gitignored reference
// folder.
import { describe, it, expect } from "vitest";
import type { SheetData } from "read-excel-file/node";
import {
  parseBoqSheets,
  normaliseRef,
  assertBoqDocument,
  activeSheets,
  countLines,
  describeHeader,
} from "@/lib/boq-import";
import type { BoqParseResult, ParsedBoqSheet } from "@/lib/boq-import";

const HEADER = ["Designer", "Category", "Code", "Item Description", "Product Reference", "Total Qty Updated"];

function sheet(data: SheetData, name = "Feuil1") {
  return [{ sheet: name, data }];
}

function ok(result: BoqParseResult): ParsedBoqSheet[] {
  if (!result.ok) throw new Error(result.error);
  return result.sheets;
}

function one(result: BoqParseResult): ParsedBoqSheet {
  const sheets = ok(result);
  const first = sheets[0];
  if (!first) throw new Error("no sheets staged");
  return first;
}

const TYPICAL: SheetData = [
  ["EXAMPLE CLIENT LTD", null, null, null, null, null],
  ["EX100 - EXAMPLE PROJECT", null, null, null, null, null],
  ["Appendix 2 - Bill of Quantities", null, null, null, null, null],
  [null, null, null, null, null, null],
  HEADER,
  ["AAA", "Furniture", "EX-100-01", "Side Table", "Round, 600 dia", 4],
  ["AAA", "Seating", "EX-100-02", "Armchair", "Model A", 2],
  ["AAA", "Seating", "ZZ11A", "Armchair", "Model B", 4],
  ["AAA", "Seating", "ZZ11A", "Armchair", "Model B", 1],
  [null, null, null, null, null, null],
  [null, null, null, "TOTAL", null, 11],
];

// The shape of the AP364 template: a titles block with the revision and date
// split across two cells, a COM caveat, then a header with an Area column, a
// unit column and SIX per-level quantity columns before the total.
const LEVELLED: SheetData = [
  ["EX364 - Example", null, null, null, null, null, null, null, null, null, null, "Revision: ", "0"],
  ["TENDER - EXAMPLE PACKAGES", null, null, null, null, null, null, null, null, null, null, "Date: ", "14-Sep-26"],
  ["VALUE ENGINEERING PROPOSAL", null, null, null, null, null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, "*All fabrics are COM", null],
  ["Area", "FF&E code", "Item description", "unit", "L1", "L2", "L3", "L4", "L5", "L6", "TOTAL Q-ty", "Unit cost - EUR", "Total cost - EUR"],
  ["Rooms", "X-100", "Sofa", "pcs", 3, 1, 4, 3, 2, 1, 14, null, null],
  ["Rooms", "X-200", "Armchair", "pcs", 14, 13, 11, 12, 6, 2, 58, null, null],
];

describe("parseBoqSheets", () => {
  it("finds a header that is not the first row", () => {
    const staged = one(parseBoqSheets(sheet(TYPICAL)));
    expect(staged.headerRow).toBe(5);
    expect(staged.sheetName).toBe("Feuil1");
    expect(staged.proposedRunName).toBe("Feuil1");
    expect(staged.ignored).toBe(false);
  });

  it("reads every line and keeps the source row number", () => {
    const staged = one(parseBoqSheets(sheet(TYPICAL)));
    expect(staged.lines).toHaveLength(5); // four items + the TOTAL row, which has a description
    expect(staged.lines[0]).toEqual({
      lineNo: 6,
      designer: "AAA",
      boqCategory: "Furniture",
      area: null,
      code: "EX-100-01",
      itemDescription: "Side Table",
      productReference: "Round, 600 dia",
      qty: 4,
      qtyUnit: null,
    });
  });

  it("keeps a repeated client code as two separate lines", () => {
    // The case that killed the original schema: a BOQ code is not unique, so
    // nothing here may deduplicate. Two rows in, two lines out, different qty.
    const staged = one(parseBoqSheets(sheet(TYPICAL)));
    const repeated = staged.lines.filter((line) => line.code === "ZZ11A");
    expect(repeated).toHaveLength(2);
    expect(repeated.map((line) => line.qty)).toEqual([4, 1]);
    expect(repeated.map((line) => line.lineNo)).toEqual([8, 9]);
  });

  it("counts blank-but-not-empty rows rather than dropping them silently", () => {
    const withStray: SheetData = [...TYPICAL, [null, null, null, null, null, 99]];
    const staged = one(parseBoqSheets(sheet(withStray)));
    expect(staged.skippedRows).toBe(1);
  });

  it("stages EVERY sheet that has a header, not just the first", () => {
    // The bug this replaces: a three-tab bill imported as one tab, silently.
    const staged = ok(
      parseBoqSheets([
        { sheet: "Notes", data: [["Some notes"], ["and more"]] },
        { sheet: "MUR", data: TYPICAL },
        { sheet: "MAIN RUN", data: TYPICAL },
        { sheet: "VE", data: TYPICAL },
      ]),
    );
    expect(staged.map((s) => s.sheetName)).toEqual(["MUR", "MAIN RUN", "VE"]);
    expect(staged.every((s) => s.lines.length === 5)).toBe(true);
  });

  it("reads the AP364-shaped header: FF&E code, Area, unit and TOTAL Q-ty", () => {
    const staged = one(parseBoqSheets(sheet(LEVELLED, "MAIN RUN - VE")));
    expect(staged.lines).toHaveLength(2);
    expect(staged.lines[0]).toMatchObject({
      area: "Rooms",
      code: "X-100",
      itemDescription: "Sofa",
      qtyUnit: "pcs",
      qty: 14,
    });
  });

  it("ignores the per-level quantity columns — L1 is not the total", () => {
    // A BOQ that read L1 where qty belonged would order 3 sofas instead of 14.
    const staged = one(parseBoqSheets(sheet(LEVELLED)));
    expect(staged.lines[0]?.qty).toBe(14);
    expect(staged.lines[1]?.qty).toBe(58);
  });

  it("captures the revision, the date and the terms above the header", () => {
    const staged = one(parseBoqSheets(sheet(LEVELLED)));
    expect(staged.metadata.revision).toBe("0");
    expect(staged.metadata.date).toBe("14-Sep-26");
    expect(staged.metadata.notes).toContain("*All fabrics are COM");
    expect(staged.metadata.notes).toContain("VALUE ENGINEERING PROPOSAL");
    // The value cell must not ALSO be recorded as a note.
    expect(staged.metadata.notes).not.toContain("0");
    expect(staged.metadata.notes).not.toContain("14-Sep-26");
  });

  it("keeps the date as the string the client typed", () => {
    // Parsing it into a Date renders the day before it in British Summer Time.
    const staged = one(parseBoqSheets(sheet(LEVELLED)));
    expect(typeof staged.metadata.date).toBe("string");
  });

  it("reads an inline 'Revision: 2' as well as a split one", () => {
    const staged = one(
      parseBoqSheets(sheet([["Revision: 2", null, null, null, null, null], HEADER, ["A", "S", "E-1", "Sofa", null, 1]])),
    );
    expect(staged.metadata.revision).toBe("2");
  });

  it("accepts synonym headers", () => {
    const staged = one(parseBoqSheets(sheet([["Client Ref", "Description", "Qty"], ["EX-1", "Sofa", 2]])));
    expect(staged.lines[0]).toMatchObject({ code: "EX-1", itemDescription: "Sofa", qty: 2 });
  });

  it("does not let a Product Reference column be claimed as the code column", () => {
    const staged = one(parseBoqSheets(sheet([HEADER, ["AAA", "Seating", "EX-9", "Sofa", "Model Q", 1]])));
    expect(staged.lines[0]?.code).toBe("EX-9");
    expect(staged.lines[0]?.productReference).toBe("Model Q");
  });

  it("names the columns it needed when no sheet has a header", () => {
    const result = parseBoqSheets(sheet([["just"], ["some"], ["text"]]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/code column/i);
    expect(result.error).toMatch(/description column/i);
  });

  it("stages a header with nothing under it as ignored, not as a failure", () => {
    // One blank template tab must not cost the reviewer the real tabs beside it.
    const staged = ok(parseBoqSheets([{ sheet: "Template", data: [HEADER] }, { sheet: "MAIN", data: TYPICAL }]));
    expect(staged[0]?.ignored).toBe(true);
    expect(staged[0]?.ignoredReason).toMatch(/no rows under the header/i);
    expect(staged[1]?.ignored).toBe(false);
    // activeSheets reads a STAGED doc; the parser's output becomes one when
    // /api/imports adds each line's index and category suggestion.
    const asStaged = staged.map((sheet) => ({ ...sheet, lines: [] }));
    expect(activeSheets({ schemaVersion: 3, filename: null, sourcePreserved: true, sheets: asStaged })).toHaveLength(1);
  });

  it("refuses an empty workbook", () => {
    expect(parseBoqSheets([])).toEqual({ ok: false, error: "The file has no sheets." });
  });

  it("tolerates messy quantities and whitespace", () => {
    const staged = one(
      parseBoqSheets(sheet([HEADER, ["AAA ", "Seating", " EX-3 ", "  Bench @entrance ", null, " 12 "]])),
    );
    expect(staged.lines[0]).toMatchObject({
      designer: "AAA",
      code: "EX-3",
      itemDescription: "Bench @entrance",
      productReference: null,
      qty: 12,
    });
  });
});

describe("assertBoqDocument", () => {
  const v2 = {
    schemaVersion: 3,
    filename: "boq.xlsx",
    sourcePreserved: true,
    sheets: [{ sheetName: "A", proposedRunName: "A", headerRow: 1, skippedRows: 0, ignored: false, ignoredReason: null, metadata: { revision: null, date: null, notes: [] }, lines: [] }],
  };

  it("accepts a v2 document and counts only the sheets a confirm would act on", () => {
    const doc = assertBoqDocument(v2);
    expect(doc.sheets).toHaveLength(1);
    expect(countLines(doc)).toBe(0);
  });

  it("refuses a v1 document with an instruction, rather than guessing", () => {
    expect(() => assertBoqDocument({ sheet: "Feuil1", headerRow: 5, lines: [] })).toThrow(/Upload the BOQ again/);
    // A v2 row that 0017 did not reach is refused rather than read as v3.
    expect(() => assertBoqDocument({ schemaVersion: 2, sheets: [] })).toThrow(/Upload the BOQ again/);
    expect(() => assertBoqDocument(null)).toThrow(/Upload the BOQ again/);
  });
});

// ============================================================================
// "ROW 6 WAS SKIPPED, HEADER FOUND ON ROW 6" (FIU 1)
//
// Two populations were being reported as one number and neither was named. The
// rows ABOVE the header are read for the revision, the date and the terms; the
// `skippedRows` count is rows UNDER it with neither a code nor a description.
// And the items-start row is the first parsed line's own `lineNo`, never
// `headerRow + 1`, which lies the moment a blank or a totals row sits under the
// header — the same class of mistake as the message being replaced.
// ============================================================================
describe("describeHeader", () => {
  // The AP364 shape that produced the complaint: five rows of titles, the
  // header on 6, the first item on 7.
  const PANTHER: SheetData = [
    ["EX364 - Example", null, null, null, null, null],
    ["TENDER - EXAMPLE PACKAGES", null, null, null, null, null],
    ["Revision: ", "0", null, null, null, null],
    ["Date: ", "14-Sep-26", null, null, null, null],
    ["*All fabrics are COM", null, null, null, null, null],
    HEADER,
    ["AAA", "Seating", "X-100", "Sofa", "Model A", 14],
  ];

  it("names the header row and the row the items actually start on", () => {
    const staged = one(parseBoqSheets(sheet(PANTHER)));
    expect(staged.headerRow).toBe(6);
    expect(staged.lines[0]?.lineNo).toBe(7);
    expect(describeHeader(staged)).toBe(
      "Header on row 6. Items start on row 7. 5 rows above the header were read as the phase's notes " +
        "(revision, date, terms).",
    );
  });

  it("says nothing was above a header on row 1", () => {
    const staged = one(parseBoqSheets(sheet([HEADER, ["AAA", "Seating", "X-100", "Sofa", "Model A", 14]])));
    expect(describeHeader(staged)).toBe("Header on row 1. Items start on row 2. Nothing above it.");
  });

  it("reads the items-start row off the first line, not off the header, when a blank row follows it", () => {
    // `headerRow + 1` would say row 7 here and row 7 is empty. A fully blank
    // row is in NEITHER count: it is not a note and it is not a spacer with
    // content, so nothing claims it was passed over.
    const gap: SheetData = [
      ["EX364 - Example", null, null, null, null, null],
      HEADER,
      [null, null, null, null, null, null],
      [null, null, null, null, null, null],
      ["AAA", "Seating", "X-100", "Sofa", "Model A", 14],
    ];
    const staged = one(parseBoqSheets(sheet(gap)));
    expect(staged.skippedRows).toBe(0);
    expect(describeHeader(staged)).toBe(
      "Header on row 2. Items start on row 5. 1 row above the header was read as the phase's notes " +
        "(revision, date, terms).",
    );
  });

  it("reports the spacers and totals in their TRUE meaning, and only when there are any", () => {
    const staged = one(parseBoqSheets(sheet([...TYPICAL, [null, null, null, null, null, 99]])));
    expect(staged.skippedRows).toBe(1);
    expect(describeHeader(staged)).toContain(
      "1 row under the header with no code or description was passed over (spacers or totals).",
    );
    // TYPICAL on its own has none, and the sentence is then absent rather than
    // reading "0 rows … were passed over".
    expect(describeHeader(one(parseBoqSheets(sheet(TYPICAL))))).not.toContain("passed over");
  });

  it("degrades honestly for a sheet staged before this sentence existed", () => {
    // Data from the past: no field was added to the staged JSON, so the only
    // thing that can be missing is a line number, and it prints as an em dash
    // rather than falling back to header + 1.
    expect(describeHeader({ headerRow: 6, skippedRows: 0, lines: [{}] })).toBe(
      "Header on row 6. Items start on row —. 5 rows above the header were read as the phase's notes " +
        "(revision, date, terms).",
    );
    expect(describeHeader({ headerRow: 6, skippedRows: 0, lines: [] })).toBe(
      "Header on row 6. No items under it. 5 rows above the header were read as the phase's notes " +
        "(revision, date, terms).",
    );
    expect(describeHeader({})).toBe("The header row was not recorded. No items under it.");
  });
});

describe("normaliseRef", () => {
  it("makes the same reference written differently compare equal", () => {
    expect(normaliseRef("FU06C - CG27.2")).toBe(normaliseRef("fu06c-cg27.2"));
    expect(normaliseRef("FU06C—CG27.2")).toBe("FU06C-CG27.2");
  });

  it("keeps genuinely different references different", () => {
    expect(normaliseRef("SX11A")).not.toBe(normaliseRef("SX11B"));
  });
});
