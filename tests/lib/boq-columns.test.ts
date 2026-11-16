// Pure tier — a bill is never refused; it is mapped (staged BOQ v4, 0040).
//
// Every fixture is SYNTHETIC. The pricing-document layout copies the HEADINGS
// of the bill that was refused on 2026-09-23 and invents every row
// (`tests/fixtures/boq-shapes.ts`); nothing here is client material.
import { describe, expect, it } from "vitest";
import type { SheetData } from "read-excel-file/node";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import {
  assertBoqDocument,
  describeHeader,
  parseBoqSheets,
  readSheetWithColumns,
  REFERENCE_BOQ_ALIASES,
  sheetsNeedingColumns,
  sheetsWithColumnsInDoubt,
  sheetWidth,
  type BoqLayout,
  type ParsedBoqSheet,
} from "@/lib/boq-import";
import {
  BOQ_ROLES,
  columnMappingProblem,
  columnsAwaitingALook,
  columnsFromSelections,
  composeBoqArea,
  foldHeading,
  type BoqReadRole,
} from "@/lib/boq-roles";
import { effectiveArea, lineDeltas, type ExistingRecord } from "@/lib/boq-reconcile";
import {
  PRICING_DOC_HEADINGS,
  pricingDoc,
  programmeDatesSheet,
  tenderSummarySheet,
} from "../fixtures/boq-shapes";
import { pricingDocWorkbook, programmeDatesWorkbook } from "../fixtures/build-boq";

const TYPICAL: SheetData = [
  ["EXAMPLE CLIENT LTD", null, null, null],
  ["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Unit cost - EUR"],
  ["Example lounge", "ZZ-101", "Sofa", 4, null],
  ["Example lounge", "ZZ-102", "Armchair", 2, null],
];

/** The pricing document's mapping, as a reviewer sets it on the Columns panel. */
const PRICING_COLUMNS: Partial<Record<BoqReadRole, number>> = {
  sourceLine: 0,
  area: 1,
  subArea: 2,
  boqCategory: 3,
  code: 4,
  itemDescription: 7,
  qtyUnit: 11,
  qty: 12,
  notes: 16,
  // Image (6), Target Unit Cost (9), Unit Price (13), Total Price (14): not read.
};

/** The same mapping as a saved layout: role → folded heading. */
const PRICING_LAYOUT: BoqLayout = {
  id: "layout-1",
  name: "Example specifier — pricing document",
  headerRows: 1,
  mapping: Object.fromEntries(
    Object.entries(PRICING_COLUMNS).map(([role, index]) => [role, foldHeading(String(PRICING_DOC_HEADINGS[index]))]),
  ),
};

const pricingWorkbook = (titled: boolean) => [
  { sheet: "CASEGOODS+SEATING+TABLES", data: pricingDoc({ titled }) },
  { sheet: "LOGISTICS", data: tenderSummarySheet() },
];

function first(sheets: ParsedBoqSheet[] | undefined): ParsedBoqSheet {
  const sheet = sheets?.[0];
  if (!sheet) throw new Error("no sheet staged");
  return sheet;
}

describe("staged BOQ v4: every sheet says which column each role came from", () => {
  it("records the columns, their own headings, the source, and a preview", () => {
    const result = parseBoqSheets([{ sheet: "MAIN", data: TYPICAL }]);
    expect(result.ok).toBe(true);
    const sheet = first(result.sheets);
    expect(sheet.columns).toEqual({
      area: { index: 0, heading: "Area" },
      code: { index: 1, heading: "FF&E code" },
      itemDescription: { index: 2, heading: "Item description" },
      qty: { index: 3, heading: "TOTAL Q-ty" },
    });
    expect(sheet.headings).toEqual(["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Unit cost - EUR"]);
    expect(sheet.mappingSource).toBe("synonym");
    expect(sheet.layout).toBeNull();
    expect(sheet.needsColumns).toBe(false);
    expect(sheet.columnsNote).toBeNull();
    // The preview is the sheet as displayed text, blanks as empty strings.
    expect(sheet.preview?.[1]).toEqual(["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Unit cost - EUR"]);
    expect(sheet.preview?.[0]).toEqual(["EXAMPLE CLIENT LTD", "", "", "", ""]);
    expect(sheet.preview).toHaveLength(4);
  });

  it("does not put the three new columns on a line from a bill that has none of them", () => {
    const line = first(parseBoqSheets([{ sheet: "MAIN", data: TYPICAL }]).sheets).lines[0]!;
    expect("subArea" in line).toBe(false);
    expect("sourceLine" in line).toBe(false);
    expect("notes" in line).toBe(false);
    // Step 2 fills this; this reader invents no rule for it.
    expect(line.rowKind).toBeUndefined();
  });

  it("reads v3 as it is, and v4, and nothing else", () => {
    const base = { filename: null, sourcePreserved: true, sheets: [] };
    expect(assertBoqDocument({ ...base, schemaVersion: 3 }).schemaVersion).toBe(3);
    expect(assertBoqDocument({ ...base, schemaVersion: 4 }).schemaVersion).toBe(4);
    expect(() => assertBoqDocument({ ...base, schemaVersion: 5 })).toThrow(/Upload the BOQ again/);
  });

  it("says a sheet with no header set has none, rather than 'row 0'", () => {
    expect(describeHeader({ headerRow: 0, lines: [] })).toBe("No header row has been set on this sheet yet.");
  });
});

describe("the synonyms are passed in, and still match a WHOLE heading", () => {
  it("reads with the list it is given, not a list of its own", () => {
    const aliases = [
      { role: "code" as const, term: "Spec Code" },
      { role: "itemDescription" as const, term: "Item Description" },
      { role: "qty" as const, term: "Total QTY" },
    ];
    const result = parseBoqSheets(pricingWorkbook(false), { aliases });
    expect(result.ok).toBe(true);
    const sheet = first(result.sheets);
    expect(sheet.mappingSource).toBe("synonym");
    expect(sheet.columns?.code).toEqual({ index: 4, heading: "Spec Code" });
    expect(sheet.lines[0]?.code).toBe("ZZ-FUR-10");
    // The reference list knows none of those words for a code, so with no list
    // passed the same bill does not read.
    expect(parseBoqSheets(pricingWorkbook(false)).ok).toBe(false);
  });

  it("never matches inside a heading: 'code' is not 'Category Code', 'unit' is not 'Unit Price'", () => {
    const result = parseBoqSheets(pricingWorkbook(false));
    const sheet = first(result.sheets);
    expect(sheet.columns?.code).toBeUndefined();
    // "Unit" is a whole heading here and IS the unit; the price columns beside
    // it are not claimed by it.
    expect(sheet.columns?.qtyUnit).toEqual({ index: 11, heading: "Unit" });
    expect(Object.values(sheet.columns ?? {}).map((ref) => ref?.index)).not.toContain(13);
  });

  it("recognises a heading mapped to `ignore` and reads nothing from it", () => {
    const aliases = [...REFERENCE_BOQ_ALIASES, { role: "ignore" as const, term: "Unit cost - EUR" }];
    const result = parseBoqSheets([{ sheet: "MAIN", data: TYPICAL }], { aliases });
    expect(first(result.sheets).columns).not.toHaveProperty("ignore");
  });

  it("the reference list is the old constant, role for role, and every role is a known one", () => {
    // 27, plus "q-ty" off a real mock-up tab, plus "dims", "dimensions" and
    // "finish" off the Butler Arms bills (both 2026-10-06), plus "com code"
    // off the Ronnie Scott's procurement schedule (2026-10-15).
    expect(REFERENCE_BOQ_ALIASES.length).toBe(33);
    for (const alias of REFERENCE_BOQ_ALIASES) expect(BOQ_ROLES).toContain(alias.role);
    expect(new Set(REFERENCE_BOQ_ALIASES.map((alias) => foldHeading(alias.term))).size).toBe(33);
  });
});

describe("a bill whose headings nobody knows is STAGED, not refused", () => {
  it("stages both sheets as needing columns, with their preview, and keeps the sentence", () => {
    const result = parseBoqSheets(pricingWorkbook(true));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Could not find a header row on any sheet/);
    expect(result.sheets).toHaveLength(2);
    const [bill, summary] = result.sheets!;
    expect(bill).toMatchObject({ needsColumns: true, ignored: false, lines: [] });
    expect(summary).toMatchObject({ needsColumns: true, ignored: false, lines: [] });
    expect(bill!.preview!.length).toBeGreaterThanOrEqual(13);
    expect(bill!.preview![7]![4]).toBe("Spec Code");
    expect(summary!.preview![3]![0]).toBe("TENDER SUMMARY");
    // The columns the reader DID know on the closest row are kept as the
    // panel's starting point, on that row.
    expect(bill!.headerRow).toBe(8);
    expect(Object.keys(bill!.columns ?? {}).sort()).toEqual(["area", "itemDescription", "qty", "qtyUnit"]);
    // The sentence is the panel's explanation now, and points at the panel.
    expect(bill!.columnsNote).toMatch(/Could not find a header row on this sheet/);
    expect(bill!.columnsNote).toMatch(/Set the columns below/);
    expect(bill!.columnsNote).toContain("“Spec Code”");
    // The metadata above the candidate header is still read.
    expect(bill!.metadata.revision).toBe("Rev 0");
    expect(bill!.metadata.date).toBe("XX");
    // A confirm is refused on both, by the one function that decides it.
    expect(sheetsNeedingColumns({ sheets: result.sheets! })).toHaveLength(2);
  });

  it("ignores, with a reason, a sheet that does not read when another does", () => {
    const result = parseBoqSheets(pricingWorkbook(false), { layouts: [PRICING_LAYOUT] });
    expect(result.ok).toBe(true);
    const summary = result.sheets![1]!;
    expect(summary).toMatchObject({
      sheetName: "LOGISTICS",
      needsColumns: true,
      ignored: true,
      ignoredReason: "No bill columns found on this sheet.",
    });
    expect(sheetsNeedingColumns({ sheets: result.sheets! })).toHaveLength(0);
  });

  it("does not crash on a programme-dates sheet, and does not read it", () => {
    const result = parseBoqSheets([{ sheet: "FF&E Critical Path", data: programmeDatesSheet() }]);
    expect(result.ok).toBe(false);
    expect(first(result.sheets).needsColumns).toBe(true);
    expect(first(result.sheets).lines).toEqual([]);
  });
});

describe("read with a person's columns", () => {
  const read = (titled: boolean) =>
    readSheetWithColumns("CASEGOODS+SEATING+TABLES", pricingDoc({ titled }), {
      headerRow: titled ? 8 : 1,
      headerRows: 1,
      columns: PRICING_COLUMNS,
    });

  it("reads every line, fabric rows included, with the three new columns", () => {
    const sheet = read(false);
    expect(sheet.mappingSource).toBe("person");
    expect(sheet.needsColumns).toBe(false);
    expect(sheet.lines).toHaveLength(8);
    expect(sheet.lines.map((line) => line.code)).toEqual([
      "ZZ-FUR-10",
      "ZZ-FAB-13 (ZZ-FUR-10)",
      "ZZ-FUR-26",
      "ZZ-FUR-03",
      "ZZ-FUR-03",
      "N/A",
      null,
      "ZZ-FUR-40",
    ]);
    expect(sheet.lines[0]).toMatchObject({
      lineNo: 2,
      sourceLine: "-6",
      area: "Example Suites",
      subArea: "Example Corridor",
      boqCategory: "SEAT-X",
      qty: 54,
      qtyUnit: "ea",
      notes: null,
    });
    // A FABRIC row is a line with no quantity — never a 1 — and a unit of m.
    expect(sheet.lines[1]).toMatchObject({ qty: null, qtyUnit: "m", boqCategory: "FAB-SEAT-X" });
    // The same code twice, told apart by its notes. Nothing deduplicates.
    expect(sheet.lines.filter((line) => line.code === "ZZ-FUR-03").map((line) => [line.qty, line.notes])).toEqual([
      [9, "OPTION 1"],
      [3, "OPTION 2"],
    ]);
    // No price, cost or picture reaches a line: a line has no field for one,
    // and the 350 target cost on this row is nowhere in it.
    expect(Object.keys(sheet.lines[0]!).sort()).toEqual(
      [
        "area", "boqCategory", "code", "designer", "itemDescription", "itemDescriptionRaw", "lineNo", "notes",
        "productReference", "qty", "qtyUnit", "sourceLine", "subArea",
      ].sort(),
    );
    // The multi-line cell staged AS PRINTED beside the collapsed description,
    // which is what the confirm reads the item's name and specs out of.
    expect(sheet.lines[0]!.itemDescriptionRaw).toBe(
      "Stool\nModel Ref: Bespoke\nSizes (mm): W 450 x D 450 x SH 460\nFinish: Example oak\nFabric: COM",
    );
    expect(Object.values(sheet.lines[0]!)).not.toContain(350);
    expect(sheet.columns?.code).toEqual({ index: 4, heading: "Spec Code" });
    // THE BRACKET RULE (Step 2): the fabric row names its item in brackets, so
    // it is read as that item's fabric line, and nothing else is given a kind.
    expect(sheet.lines[1]).toMatchObject({ rowKind: "finish_for", rowKindSource: "bill", finishFor: { row: sheet.lines[0]!.lineNo, code: "ZZ-FUR-10" } });
    expect(sheet.lines.filter((line, index) => index !== 1).every((line) => line.rowKind === undefined)).toBe(true);
  });

  it("reads the titled copy from row 8, with its revision and date", () => {
    const sheet = read(true);
    expect(sheet.lines).toHaveLength(8);
    expect(sheet.lines[0]!.sourceLine).toBe("1");
    expect(sheet.metadata.revision).toBe("Rev 0");
    expect(sheet.metadata.date).toBe("XX");
  });

  it("composes the area the record will carry from Area and Sub-Area", () => {
    const line = read(false).lines[0]!;
    expect(effectiveArea(line)).toBe("Example Suites / Example Corridor");
    expect(composeBoqArea("Example Suites", null)).toBe("Example Suites");
    expect(composeBoqArea(null, "Example Corridor")).toBe("Example Corridor");
    expect(composeBoqArea(" ", " ")).toBeNull();
  });

  it("reads a revision of the SAME bill as unchanged, area included", () => {
    const line = read(false).lines[0]!;
    const record: ExistingRecord = {
      id: "r1",
      version: 1,
      recordNo: 1,
      label: "ZZ-001",
      itemDescription: line.itemDescription,
      productReference: null,
      qty: 54,
      designer: null,
      // What the confirm wrote.
      area: "Example Suites / Example Corridor",
      boqCategory: "SEAT-X",
      codes: ["ZZ-FUR-10"],
      attributeCount: 0,
      hasImage: false,
      settledAnswers: 0,
    };
    expect(
      lineDeltas({ ...line, index: 0, ignored: false, replaces: null }, record),
    ).toEqual([]);
  });
});

describe("a saved layout applies only when EVERY heading it maps is there", () => {
  it("applies, names itself, and reads the lines", () => {
    const result = parseBoqSheets(pricingWorkbook(false), { layouts: [PRICING_LAYOUT] });
    const sheet = first(result.sheets);
    expect(sheet.mappingSource).toBe("layout");
    expect(sheet.layout).toEqual({ id: "layout-1", name: "Example specifier — pricing document" });
    expect(sheet.lines).toHaveLength(8);
    expect(sheet.columnsChecked).toBeUndefined();
  });

  it("applies to the other copy, whose header is seven rows further down", () => {
    const sheet = first(parseBoqSheets(pricingWorkbook(true), { layouts: [PRICING_LAYOUT] }).sheets);
    expect(sheet.mappingSource).toBe("layout");
    expect(sheet.headerRow).toBe(8);
    expect(sheet.lines).toHaveLength(8);
    expect(sheet.metadata.revision).toBe("Rev 0");
  });

  it("does NOT apply when one mapped heading was renamed", () => {
    const renamed = pricingDoc({ titled: false }).map((row, index) =>
      index === 0 ? row.map((cell) => (cell === "Sub-Area" ? "Sub Area" : cell)) : row,
    );
    const result = parseBoqSheets(
      [{ sheet: "CASEGOODS+SEATING+TABLES", data: renamed }],
      { layouts: [PRICING_LAYOUT] },
    );
    expect(result.ok).toBe(false);
    expect(first(result.sheets).needsColumns).toBe(true);
    expect(first(result.sheets).mappingSource).toBe("synonym");
  });

  it("still applies when the bill ADDS a column the layout does not map", () => {
    const widened = pricingDoc({ titled: false }).map((row, index) => [...row, index === 0 ? "Lead time" : null]);
    const sheet = first(parseBoqSheets([{ sheet: "BILL", data: widened }], { layouts: [PRICING_LAYOUT] }).sheets);
    expect(sheet.mappingSource).toBe("layout");
  });

  it("wins over the synonyms, and folds only case and whitespace", () => {
    const shouting: BoqLayout = {
      ...PRICING_LAYOUT,
      mapping: { ...PRICING_LAYOUT.mapping, code: "  SPEC   CODE " },
    };
    const aliases = [...REFERENCE_BOQ_ALIASES, { role: "code" as const, term: "Spec Code" }];
    const sheet = first(parseBoqSheets(pricingWorkbook(false), { aliases, layouts: [shouting] }).sheets);
    expect(sheet.mappingSource).toBe("layout");
    // Punctuation is NOT folded: "Spec-Code" is a different heading.
    const hyphen: BoqLayout = { ...PRICING_LAYOUT, mapping: { ...PRICING_LAYOUT.mapping, code: "spec-code" } };
    expect(parseBoqSheets(pricingWorkbook(false), { layouts: [hyphen] }).ok).toBe(false);
  });
});

describe("a cell with nothing printable in it is blank", () => {
  it("reads a formula with no cached result as blank, never as [object Object]", async () => {
    const sheets = await readSpreadsheetSheets(
      await pricingDocWorkbook({ titled: false, sharedFormulaGap: true }),
      "bill.xlsx",
      "",
    );
    const sheet = readSheetWithColumns(sheets[0]!.sheet, sheets[0]!.data, {
      headerRow: 1,
      headerRows: 1,
      columns: PRICING_COLUMNS,
    });
    expect(sheet.lines).toHaveLength(8);
    const lines = sheet.lines.map((line) => line.sourceLine);
    expect(lines).toEqual(["-6", "-5", "-4", null, "-2", "-1", "0", "1"]);
    expect(JSON.stringify(sheet)).not.toContain("[object Object]");
    // The merged heading reads in its first column; the second is blank.
    expect(sheet.headings?.[4]).toBe("Spec Code");
    expect(sheet.headings?.[5]).toBe("");
  });

  it("treats an object a reader hands back as an empty cell, in a line and in the preview", () => {
    const odd = { sharedFormula: "A2" } as unknown as string;
    const data: SheetData = [
      ["Line", "FF&E code", "Item description"],
      [odd, "ZZ-1", "Sofa"],
    ];
    const sheet = readSheetWithColumns("S", data, {
      headerRow: 1,
      headerRows: 1,
      columns: { sourceLine: 0, code: 1, itemDescription: 2 },
    });
    expect(sheet.lines[0]!.sourceLine).toBeNull();
    expect(sheet.preview?.[1]?.[0]).toBe("");
  });

  it("reads the programme-dates workbook without throwing", async () => {
    const sheets = await readSpreadsheetSheets(await programmeDatesWorkbook(), "dates.xlsx", "");
    expect(() => parseBoqSheets(sheets)).not.toThrow();
    expect(sheetWidth(sheets[0]!.data)).toBe(8);
  });
});

describe("a person's mapping is checked in words", () => {
  const sheet = { rowCount: 20, width: 17 };

  it("needs a header row, and a code or a description", () => {
    expect(columnMappingProblem({ ...sheet, columns: { code: 4 }, headerRow: 0, headerRows: 1 })).toMatch(
      /Choose the row the column headings are on/,
    );
    expect(columnMappingProblem({ ...sheet, columns: { qty: 12 }, headerRow: 1, headerRows: 1 })).toMatch(
      /code or the item description/,
    );
    expect(columnMappingProblem({ ...sheet, columns: { code: 4 }, headerRow: 1, headerRows: 1 })).toBeNull();
    expect(columnMappingProblem({ ...sheet, columns: { itemDescription: 7 }, headerRow: 1, headerRows: 1 })).toBeNull();
  });

  it("refuses one column read as two things, and a column off the sheet", () => {
    expect(
      columnMappingProblem({ ...sheet, columns: { code: 4, itemDescription: 4 }, headerRow: 1, headerRows: 1 }),
    ).toMatch(/Column E is set as code \(client ref\) and item description/);
    expect(columnMappingProblem({ ...sheet, columns: { code: 40 }, headerRow: 1, headerRows: 1 })).toMatch(
      /not on this sheet/,
    );
    expect(columnMappingProblem({ ...sheet, columns: { code: 4 }, headerRow: 1, headerRows: 2 })).toMatch(
      /two-row header needs a row above/,
    );
  });

  it("refuses two columns set to one role, from the panel's selects", () => {
    const selections = Array.from({ length: 17 }, () => null as null | "code" | "ignore");
    selections[3] = "code";
    selections[4] = "code";
    expect(columnsFromSelections(selections).problem).toMatch(/Columns D and E are both set as code/);
    selections[3] = "ignore";
    expect(columnsFromSelections(selections)).toEqual({ columns: { code: 4 }, keep: [], problem: null });
  });
});

// ---- audit C6 / C7 (2026-11-16): the reader's own doubt about its columns ----

describe("two columns claiming one role are a question, never a silent first-wins (C6)", () => {
  // `item` and `description` are BOTH synonyms of the item description. The
  // first column used to win and the second vanished: every record was named
  // "1.01" and the real description was never read, with no columns check.
  const ITEM_AND_DESCRIPTION: SheetData = [
    ["Item", "Code", "Description", "Qty"],
    ["1.01", "ZZ-101", "Sofa", 2],
    ["1.02", "ZZ-102", "Armchair", 4],
  ];

  it("stages the sheet with the doubt in words, naming both columns", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: ITEM_AND_DESCRIPTION }]).sheets);
    expect(sheet.needsColumns).toBe(false);
    expect(sheet.columnsDoubt).toMatch(/Columns A \(“Item”\) and C \(“Description”\)/);
    expect(sheet.columnsDoubt).toMatch(/takes as the description/);
    expect(sheet.columnsDoubt).toMatch(/column A was read as it/);
  });

  it("opens the Columns panel and holds the confirm until a person has looked", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: ITEM_AND_DESCRIPTION }]).sheets);
    expect(columnsAwaitingALook(sheet)).toBe(true);
    expect(sheetsWithColumnsInDoubt({ sheets: [sheet] })).toHaveLength(1);
    // "The columns are right" is the look.
    expect(sheetsWithColumnsInDoubt({ sheets: [{ ...sheet, columnsChecked: true }] })).toHaveLength(0);
    expect(columnsAwaitingALook({ ...sheet, columnsChecked: true })).toBe(false);
    // A person's own columns carry no doubt.
    const person = readSheetWithColumns("Bill", ITEM_AND_DESCRIPTION, {
      headerRow: 1,
      headerRows: 1,
      columns: { code: 1, itemDescription: 2, qty: 3 },
    });
    expect(person.columnsDoubt).toBeUndefined();
    expect(person.lines.map((line) => line.itemDescription)).toEqual(["Sofa", "Armchair"]);
  });

  it("says nothing where each role has one column, so such a sheet stages as it always did", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: TYPICAL }]).sheets);
    expect("columnsDoubt" in sheet).toBe(false);
    expect(columnsAwaitingALook(sheet)).toBe(false);
  });

  it("counts one column read three ways as ONE claim on a two-row header", () => {
    const sheet = first(
      parseBoqSheets([
        {
          sheet: "Bill",
          data: [
            ["FF&E", "Item", "TOTAL"],
            ["code", "description", "Q-ty"],
            ["ZZ-1", "Sofa", 1],
          ],
        },
      ]).sheets,
    );
    expect(sheet.headerRows).toBe(2);
    expect("columnsDoubt" in sheet).toBe(false);
  });
});

describe("a saved layout narrower than the known headings does not outrank them (C7)", () => {
  // A person saved `Description | Qty` off a bill with no code column. Layouts
  // are global, and that layout fitted every later bill printing those two
  // headings — and outranked the synonyms, so the code was never read.
  const NARROW: BoqLayout = {
    id: "narrow",
    name: "Somebody's two-column layout",
    headerRows: 1,
    mapping: { itemDescription: "description", qty: "qty" },
  };
  const BILL: SheetData = [
    ["Code", "Description", "Qty", "Unit"],
    ["ZZ-201", "Bench", 3, "nr"],
  ];

  it("lets the synonyms read the sheet, and says why in the sheet's doubt", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: BILL }], { layouts: [NARROW] }).sheets);
    expect(sheet.mappingSource).toBe("synonym");
    expect(sheet.lines[0]?.code).toBe("ZZ-201");
    expect(sheet.columnsDoubt).toMatch(/saved layout “Somebody's two-column layout” fits this sheet but reads 2 columns/);
    expect(sheet.columnsDoubt).toMatch(/known headings read 4/);
    expect(sheetsWithColumnsInDoubt({ sheets: [sheet] })).toHaveLength(1);
  });

  it("still applies a layout that reads at least as much as the synonyms", () => {
    const full: BoqLayout = {
      ...NARROW,
      id: "full",
      mapping: { code: "code", itemDescription: "description", qty: "qty", qtyUnit: "unit" },
    };
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: BILL }], { layouts: [full] }).sheets);
    expect(sheet.mappingSource).toBe("layout");
    expect("columnsDoubt" in sheet).toBe(false);
  });

  it("still applies a narrow layout where the synonyms cannot read the sheet at all", () => {
    const sheet = first(
      parseBoqSheets([{ sheet: "Bill", data: [["Spec Code", "Description", "Qty"], ["ZZ-1", "Stool", 1]] }], {
        layouts: [{ ...NARROW, mapping: { code: "spec code", itemDescription: "description" } }],
      }).sheets,
    );
    expect(sheet.mappingSource).toBe("layout");
    expect(sheet.lines[0]?.code).toBe("ZZ-1");
  });
});

describe("a header printed again above a section is passed over and counted (C9)", () => {
  const SECTIONS: SheetData = [
    ["Code", "Description", "Qty"],
    ["ZZ-301", "Sofa", 2],
    [null, null, null],
    ["code", " DESCRIPTION ", "QTY"],
    ["ZZ-302", "Armchair", 4],
    ["Code", "Description", null],
    ["ZZ-303", "Description of works", 1],
    ["ZZ-304", "Description", 1],
  ];

  it("stages no record named “Description”, and says how many it passed over", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: SECTIONS }]).sheets);
    expect(sheet.lines.map((line) => line.code)).toEqual(["ZZ-301", "ZZ-302", "ZZ-303", "ZZ-304"]);
    expect(sheet.repeatedHeaderRows).toBe(2);
    expect(describeHeader(sheet)).toMatch(/2 repeated heading rows under the header were passed over/);
  });

  it("matches the WHOLE cell: a line whose description merely contains a heading, or is one, stays a line", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: SECTIONS }]).sheets);
    expect(sheet.lines.find((line) => line.code === "ZZ-303")?.itemDescription).toBe("Description of works");
    // One cell equal to its heading is not a reprinted header: its code is real.
    expect(sheet.lines.find((line) => line.code === "ZZ-304")?.itemDescription).toBe("Description");
  });

  it("adds nothing to a sheet with no reprint", () => {
    const sheet = first(parseBoqSheets([{ sheet: "Bill", data: TYPICAL }]).sheets);
    expect("repeatedHeaderRows" in sheet).toBe(false);
  });
});
