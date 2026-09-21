// Pure tier. The fixtures below are SYNTHETIC — they reproduce the SHAPE of a
// real client BOQ (title rows, a late header, a repeated code, per-level
// quantity columns, free-text descriptions, a totals row) without carrying a
// single real line of client data. Real BOQs stay in the gitignored reference
// folder.
import { describe, it, expect } from "vitest";
import type { SheetData } from "read-excel-file/node";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { guessNonFurniture } from "@/lib/non-furniture-guess";
import {
  parseBoqSheets,
  normaliseRef,
  assertBoqDocument,
  activeSheets,
  countLines,
  describeHeader,
} from "@/lib/boq-import";
import type { BoqParseResult, ParsedBoqSheet } from "@/lib/boq-import";
// Synthetic, built by `tests/fixtures/build-boq.ts`. Modelled on the shape of a
// real bill; not one line of one.
import {
  bill300,
  blankQtyCells,
  noQtyColumn,
  sectionedBill,
  twoRowHeader,
  twoRowHeaderIncomplete,
} from "../fixtures/boq-shapes";
// The same shapes as real workbooks, built in memory — see the note on the
// workbook suite below for why none of them is committed.
import { bill300Workbook, twoRowHeaderWorkbook } from "../fixtures/build-boq";

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
    // Nothing matched, so there is no row to quote and none is invented.
    expect(result.error).toContain("No row on any sheet named even one of them.");
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

// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 1 — HEADER SYNONYMS NOT MATCHED.
//
// EXPECTED: REFUSES, naming the columns it looked for, the words it accepts,
// and — the half that was missing — the closest row's OWN headings, so the
// person reading the refusal can see which of their columns was not understood.
//
// The synonym list is CODE (`COLUMNS` in src/lib/boq-import.ts), not seed data.
// §6.10.a wants it seeded eventually; until it is, adding a word is a commit,
// and this refusal is what says which word.
//
// The fixture is a bill headed the way the plan names one — "Item No.",
// "Product" — with invented codes and descriptions.
// ============================================================================
describe("a bill whose headings this reader does not know", () => {
  const FOREIGN: SheetData = [
    ["EXAMPLE CLIENT LTD", null, null, null],
    ["Item No.", "Product", "Qty", "Rate"],
    ["1", "ZZ-101 Side table", 4, null],
    ["2", "ZZ-102 Armchair", 2, null],
  ];

  it("refuses rather than reading the first row it can make sense of", () => {
    const result = parseBoqSheets(sheet(FOREIGN, "Bill"));
    // The trap: "Qty" IS recognised, so a reader that took any partial match
    // would stage two lines with no code and no description at all.
    expect(result.ok).toBe(false);
  });

  it("names the closest row, what it recognised, and what it did not", () => {
    const result = parseBoqSheets(sheet(FOREIGN, "Bill"));
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("The closest is row 2 of “Bill”");
    expect(result.error).toContain("named its quantity column but no code and description column");
    // THE BILL'S OWN WORDS. Without these the refusal is unactionable: nobody
    // can see which column to rename or which alias to add.
    expect(result.error).toContain("“Item No.”");
    expect(result.error).toContain("“Product”");
    expect(result.error).toContain("“Rate”");
    expect(result.error).toMatch(/have the bill's own wording added to the reader's list/);
  });

  it("still lists the words it accepts, so renaming is possible without asking", () => {
    const result = parseBoqSheets(sheet(FOREIGN));
    if (result.ok) throw new Error("expected a refusal");
    for (const synonym of ["ff&e code", "client ref"]) expect(result.error).toContain(synonym);
    for (const synonym of ["item description", "description"]) expect(result.error).toContain(synonym);
  });

  it("quotes the CLOSEST row, not the first one it looked at", () => {
    // A title row above the header matches nothing; the header-ish row below it
    // matches one column. The refusal must be about the second.
    const result = parseBoqSheets(
      sheet([
        ["Some client, some project", null, null],
        ["Nr", "Thing", "Total Qty"],
        ["1", "ZZ-101 Side table", 4],
      ]),
    );
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("row 2");
    expect(result.error).toContain("“Nr”");
  });

  it("caps how many headings it quotes rather than printing a wide sheet back", () => {
    const wide = Array.from({ length: 14 }, (_, index) => `Column ${index + 1}`);
    const result = parseBoqSheets(sheet([[...wide, "Qty"], ["x"]]));
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("and more");
    expect(result.error).toContain("“Column 8”");
    expect(result.error).not.toContain("“Column 9”");
  });
});

// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 2 — NO QUANTITY COLUMN.
//
// EXPECTED: FLAGS. Lines are staged with `qty` null, the review and the phase
// table say so in words, and NOTHING writes a 1. The trap is specific and it
// has been guarded since 0007 in one direction only: `L1`..`L6` are per-level
// quantities and are absent from the header synonyms, so a bill carrying only
// those has no quantity at all — and the plausible wrong answer is to read the
// first level's figure, which would order 3 sofas instead of 14.
// ============================================================================
describe("a bill with no quantity column", () => {
  it("gives every line a null quantity, never a 1 and never L1", () => {
    const staged = one(parseBoqSheets(sheet(noQtyColumn(), "Bill")));
    expect(staged.lines).toHaveLength(3);
    expect(staged.lines.map((line) => line.qty)).toEqual([null, null, null]);
    // The figures ARE on the row — 3, 1, 4, 3, 2 — and none of them is read.
    expect(staged.lines[0]?.qtyUnit).toBe("pcs");
  });

  it("reads a blank cell in a quantity column the same way", () => {
    const staged = one(parseBoqSheets(sheet(blankQtyCells(), "Bill")));
    expect(staged.lines.map((line) => line.qty)).toEqual([4, null, null]);
  });

  it("says once, on the tab, that the bill gave no quantity", () => {
    // Said at the sheet's scale rather than as a long label on three hundred
    // rows. The per-row cell is the screen's half and is asserted in the
    // component tier.
    expect(describeHeader(one(parseBoqSheets(sheet(noQtyColumn()))))).toContain(
      "No line here carries a quantity — the bill gave none, so none is written.",
    );
  });

  it("does not say it when any line has one", () => {
    expect(describeHeader(one(parseBoqSheets(sheet(blankQtyCells()))))).not.toContain("carries a quantity");
    expect(describeHeader(one(parseBoqSheets(sheet(TYPICAL))))).not.toContain("carries a quantity");
  });
});

// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 3 — MERGED CELLS / A TWO-ROW HEADER.
//
// EXPECTED: PROCEEDS where the second row completes the first; otherwise
// REFUSES, naming the row it read with it.
//
// The shape is one label split over two rows — "FF&E" above "code", "Item"
// above "description", "Total" above "Q-ty" — which a merged cell and a wrapped
// heading both produce. Neither row is a header on its own, and before this the
// whole bill refused for want of a code column it plainly had.
//
// THE TRAP IS THE OTHER DIRECTION. A reader that paired any two rows would take
// a title row and the first ITEM under it as the header, reading the bill one
// row short with a sofa for a column name. So the pair is only tried on a row
// that already matched at least one column, and only taken when it completes.
// ============================================================================
describe("a header split over two rows", () => {
  it("reads the two rows as one header", () => {
    const staged = one(parseBoqSheets(sheet(twoRowHeader(), "Bill")));
    expect(staged.headerRow).toBe(4);
    expect(staged.headerRows).toBe(2);
    expect(staged.lines).toHaveLength(3);
    expect(staged.lines[0]).toMatchObject({
      lineNo: 5,
      area: "Example lounge",
      code: "ZZ-101",
      itemDescription: "Sofa",
      qty: 14,
    });
  });

  it("does not file the upper half of the header as the phase's notes", () => {
    // The metadata is the rows ABOVE the header, and the header now starts a
    // row earlier. "FF&E", "Item" and "Total" in the revision-and-terms panel
    // would be this fix wearing a new defect.
    const staged = one(parseBoqSheets(sheet(twoRowHeader())));
    expect(staged.metadata.revision).toBe("2");
    expect(staged.metadata.notes).toContain("ZZ001 - Example Project");
    for (const heading of ["FF&E", "Item", "Total", "code", "description"]) {
      expect(staged.metadata.notes).not.toContain(heading);
    }
  });

  it("says both rows in the sentence the review prints", () => {
    const staged = one(parseBoqSheets(sheet(twoRowHeader())));
    expect(describeHeader(staged)).toBe(
      "Header on rows 3 to 4, read as one. Items start on row 5. 2 rows above the header were read as the " +
        "phase's notes (revision, date, terms).",
    );
  });

  it("refuses, and names the row it read with it, when the pair still has no code", () => {
    const result = parseBoqSheets(sheet(twoRowHeaderIncomplete(), "Bill"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Reading it together with row \d+ beneath it did not complete it either\./);
  });

  it("never takes a title row and the first item as a header", () => {
    // The row above the header matches nothing, so no pair is tried at all and
    // the header is found where it is. If it were tried, "Sofa" would be a
    // column name and the bill would be one line short.
    const staged = one(
      parseBoqSheets(
        sheet([
          ["ZZ001 - Example Project", null, null],
          ["FF&E code", "Item description", "TOTAL Q-ty"],
          ["ZZ-101", "Sofa", 14],
        ]),
      ),
    );
    expect(staged.headerRow).toBe(2);
    expect(staged.headerRows).toBe(1);
    expect(staged.lines.map((line) => line.itemDescription)).toEqual(["Sofa"]);
  });

  it("does not pair a row that matched one column with a DATA row to make a header", () => {
    // "Item" alone matches the description column; the row under it is a line,
    // and joining them names no code, so the bill refuses rather than staging
    // the second row as column headings.
    const result = parseBoqSheets(
      sheet([
        ["Item", "Nr", null],
        ["Sofa", 14, null],
      ]),
    );
    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// THE SAME BILL AS A REAL WORKBOOK, WITH A REAL MERGED CELL.
//
// A merged cell is only a merged cell in a FILE: `read-excel-file` puts the
// region's value in its top-left and nothing in the others, and every array
// fixture above is an assumption that it does. `tests/fixtures/build-boq.ts`
// builds `twoRowHeader()` as a real workbook with A3:A4 genuinely merged, and
// this reads it back through `readSpreadsheetSheets` — the same function
// `/api/imports` calls — so the assumption is checked once against the library
// rather than trusted everywhere.
//
// THE BYTES ARE BUILT, NOT COMMITTED. `.gitignore` refuses `*BOQ*.xlsx`
// outright as an NDA guard, and a synthetic fixture named to slip past that
// rule is how the rule stops meaning anything.
// ============================================================================
describe("the same bill as a real workbook", () => {
  it("parses the merged two-row header the same way the array does", async () => {
    const sheets = await readSpreadsheetSheets(await twoRowHeaderWorkbook(), "bill-two-row-header.xlsx", "");
    const staged = one(parseBoqSheets(sheets));
    expect(staged.headerRows).toBe(2);
    expect(staged.headerRow).toBe(4);
    expect(staged.lines.map((line) => line.code)).toEqual(["ZZ-101", "ZZ-102", "ZZ-103"]);
    expect(staged.lines.map((line) => line.area)).toEqual(["Example lounge", "Example lounge", "Example suite"]);
    expect(staged.lines.map((line) => line.qty)).toEqual([14, 58, 2]);
  });

  it("reads three hundred lines, forty areas and sixty non-furniture lines", async () => {
    // Row 7's fixture, through the real reader. The component tier measures
    // what the review screen then does with it.
    const sheets = await readSpreadsheetSheets(await bill300Workbook(), "bill-300-lines.xlsx", "");
    const staged = one(parseBoqSheets(sheets));
    expect(staged.lines).toHaveLength(300);
    expect(new Set(staged.lines.map((line) => line.area)).size).toBe(40);
    expect(staged.lines.filter((line) => guessNonFurniture(line) !== null)).toHaveLength(60);
    // The array and the workbook are the same bill, which is what lets the
    // component tier use the cheaper one.
    expect(one(parseBoqSheets(sheet(bill300()))).lines).toEqual(staged.lines);
  });

  it("really does carry a merged cell, read as a blank on the second row", async () => {
    // If `read-excel-file` ever filled a merged region's every cell, the pair
    // reading above would still pass and this is what would say why.
    const sheets = await readSpreadsheetSheets(await twoRowHeaderWorkbook(), "bill-two-row-header.xlsx", "");
    const rows = sheets[0]?.data ?? [];
    expect(rows[2]?.[0]).toBe("Area");
    expect(rows[3]?.[0] ?? null).toBeNull();
  });
});

// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 6 — SUBTOTAL AND SECTION ROWS.
//
// EXPECTED: PROCEEDS, skipped, and the review says how many and why. IT
// ALREADY DID, so this row is a test and no change — `readRows` counts a row
// carrying neither a code nor a description, and `describeHeader` reports it
// as "spacers or totals" in the sentence the review prints.
//
// WHAT IT DOES NOT COVER, and this is the finding rather than the fix: a
// subtotal or a section heading that carries a DESCRIPTION is staged as a
// line. That is the same rule as a real codeless item ("Bench @ entrance"),
// and it cannot be tightened here without dropping described rows a bill
// genuinely wants — so the reviewer's Include box is the only thing that
// removes one. `non-furniture-guess.ts` is where a suggestion would go, and
// its own header says its word list is Max and Matthew's to extend rather
// than a tidy-up. Reported, not widened.
// ============================================================================
describe("a bill printed in sections with subtotals", () => {
  it("passes over the rows that carry neither a code nor a description", () => {
    const staged = one(parseBoqSheets(sheet(sectionedBill(), "Bill")));
    // Two figure-only rows and one grand total; the fully blank row is in
    // NEITHER count, because it is not a spacer with content.
    expect(staged.skippedRows).toBe(2);
  });

  it("says how many and why, in the sentence the review prints", () => {
    const staged = one(parseBoqSheets(sheet(sectionedBill())));
    expect(describeHeader(staged)).toContain(
      "2 rows under the header with no code or description were passed over (spacers or totals).",
    );
  });

  it("reads every real item, and keeps its source row number", () => {
    const staged = one(parseBoqSheets(sheet(sectionedBill())));
    const items = staged.lines.filter((line) => line.code !== null);
    expect(items.map((line) => [line.code, line.qty, line.lineNo])).toEqual([
      ["ZZ-101", 14, 4],
      ["ZZ-102", 2, 5],
      ["ZZ-201", 4, 9],
    ]);
  });

  it("stages a described section heading and subtotal as lines — the known gap", () => {
    // PINNING TODAY'S BEHAVIOUR, not endorsing it. A described row is staged
    // because a codeless ITEM is normal and losing one is unrecoverable; the
    // consequence is that "SEATING" and "Subtotal — seating" arrive as lines
    // for the reviewer to untick, and nothing suggests it to them.
    const staged = one(parseBoqSheets(sheet(sectionedBill())));
    const described = staged.lines.filter((line) => line.code === null);
    expect(described.map((line) => line.itemDescription)).toEqual([
      "SEATING",
      "Subtotal — seating",
      "TABLES",
    ]);
    // And the subtotal's figure comes through as a quantity, which is what
    // would make it a record for 16 of something.
    expect(described[1]?.qty).toBe(16);
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
