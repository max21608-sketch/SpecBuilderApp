// A bill's Prototype Quantity puts items on the mock-up phase; any column can
// be kept in notes; a sheet with no codes says what that costs (2026-10-06).
//
// Pure tier: the reader, the mapping rules, the model's structure validation
// and the sheet notices, over invented sheets. Nothing here is a client
// document — every code, heading and figure is made up.
import { describe, expect, it } from "vitest";
import {
  BOQ_KEEP_ROLE,
  BOQ_READ_ROLES,
  BOQ_ROLES,
  BOQ_ROLE_LABELS,
  columnMappingProblem,
  columnsFromSelections,
  composeBillNotes,
  keptHeading,
  type BoqRole,
} from "@/lib/boq-roles";
import { parseBoqSheets, readSheetWithColumns, type BoqLayout } from "@/lib/boq-import";
import { STRUCTURE_PROMPT, STRUCTURE_TOOL, StructureOutput, validateStructure } from "@/lib/boq-structure";
import {
  billSheetNotices,
  mockupLines,
  mockupReviewSentence,
  NO_CODES_REVIEW_SENTENCE,
  readMockupQty,
  sheetHasNoCodes,
} from "@/lib/bill-sheet-notices";

/** An invented specifier's bill: an order quantity and a prototype one, and a client phasing column. */
const protoSheet = [
  ["Example Hotel — FF&E bill", null, null, null, null, null],
  ["Code", "Description", "TOTAL Q-ty", "Prototype Quantity", "PHASE", "Zone note"],
  ["ZZ-01", "Armchair", 40, 1, 2, "near window"],
  ["ZZ-02", "Side table", 20, "PARTIAL", 3, null],
  ["ZZ-03", "Bed", 12, "N/A", null, null],
  ["ZZ-04", "Desk", 12, null, 5, "TBC"],
];

describe("the roles", () => {
  it("has a Mock-up quantity read role and a Kept in notes role that is NOT a read role", () => {
    expect(BOQ_READ_ROLES).toContain("mockupQty");
    expect(BOQ_READ_ROLES as readonly string[]).not.toContain(BOQ_KEEP_ROLE);
    expect(BOQ_ROLES).toEqual(expect.arrayContaining(["mockupQty", "keep", "ignore"]));
    expect(BOQ_ROLE_LABELS.mockupQty).toBe("Mock-up quantity");
    expect(BOQ_ROLE_LABELS.keep).toBe("Kept in notes");
  });
});

describe("the synonym", () => {
  it("reads a whole “Prototype Quantity” heading as the mock-up quantity, cell as printed", () => {
    const result = parseBoqSheets([{ sheet: "Bill", data: protoSheet }]);
    expect(result.ok).toBe(true);
    const sheet = result.sheets![0]!;
    expect(sheet.columns?.mockupQty).toEqual({ index: 3, heading: "Prototype Quantity" });
    expect(sheet.lines.map((line) => line.mockupQtyRaw)).toEqual(["1", "PARTIAL", "N/A", null]);
    // The order quantity is untouched by it.
    expect(sheet.lines.map((line) => line.qty)).toEqual([40, 20, 12, 12]);
  });

  it("never maps a bare “Prototype”, and a sheet without the column stages no key", () => {
    const sheet = parseBoqSheets([
      {
        sheet: "Bill",
        data: [
          ["Code", "Description", "Qty", "Prototype"],
          ["ZZ-01", "Armchair", 4, 1],
        ],
      },
    ]).sheets![0]!;
    expect(sheet.columns?.mockupQty).toBeUndefined();
    expect("mockupQtyRaw" in sheet.lines[0]!).toBe(false);
  });
});

describe("kept in notes", () => {
  it("is the one role several columns may share, from the panel's selects", () => {
    const selections: (BoqRole | null)[] = ["code", "itemDescription", "qty", "mockupQty", "keep", "keep"];
    const mapped = columnsFromSelections(selections);
    expect(mapped).toEqual({
      columns: { code: 0, itemDescription: 1, qty: 2, mockupQty: 3 },
      keep: [4, 5],
      problem: null,
    });
    expect(
      columnMappingProblem({ columns: mapped.columns, keep: mapped.keep, headerRow: 2, headerRows: 1, rowCount: 6, width: 6 }),
    ).toBeNull();
  });

  it("still refuses any OTHER role on two columns", () => {
    const mapped = columnsFromSelections(["code", "itemDescription", "mockupQty", "mockupQty"]);
    expect(mapped.problem).toMatch(/Columns C and D are both set as mock-up quantity/);
  });

  it("refuses a column that is both kept and read as something else, and one off the sheet", () => {
    expect(
      columnMappingProblem({ columns: { code: 0, itemDescription: 1 }, keep: [1], headerRow: 2, headerRows: 1, rowCount: 6, width: 6 }),
    ).toMatch(/Column B is set as item description and kept in notes/);
    expect(
      columnMappingProblem({ columns: { code: 0 }, keep: [9], headerRow: 2, headerRows: 1, rowCount: 6, width: 6 }),
    ).toBe("A column kept in notes is not on this sheet.");
  });

  it("stages every kept column's non-blank cell under its heading as printed", () => {
    const sheet = readSheetWithColumns("Bill", protoSheet, {
      headerRow: 2,
      headerRows: 1,
      columns: { code: 0, itemDescription: 1, qty: 2, mockupQty: 3 },
      keep: [4, 5],
    });
    expect(sheet.kept).toEqual([
      { index: 4, heading: "PHASE" },
      { index: 5, heading: "Zone note" },
    ]);
    expect(sheet.lines.map((line) => line.kept)).toEqual([
      [
        { heading: "PHASE", value: "2" },
        { heading: "Zone note", value: "near window" },
      ],
      [{ heading: "PHASE", value: "3" }],
      [],
      [
        { heading: "PHASE", value: "5" },
        { heading: "Zone note", value: "TBC" },
      ],
    ]);
  });

  it("composes the notes: the notes column first, then one line per kept cell", () => {
    expect(
      composeBillNotes("OPTION 1", [
        { heading: "PHASE", value: "2" },
        { heading: "Zone note", value: "near window" },
      ]),
    ).toBe("OPTION 1\nPHASE: 2\nZone note: near window");
    expect(composeBillNotes(null, [{ heading: "PHASE", value: "3" }])).toBe("PHASE: 3");
    expect(composeBillNotes("  ", [])).toBeNull();
    expect(composeBillNotes(undefined, undefined)).toBeNull();
    expect(composeBillNotes(null, [{ heading: "PHASE", value: "  " }])).toBeNull();
    expect(keptHeading("", 4)).toBe("Column E");
    expect(keptHeading("  Client   phase ", 4)).toBe("Client phase");
  });

  it("applies a saved layout only when every kept heading is on the sheet too", () => {
    const layout: BoqLayout = {
      id: "layout-1",
      name: "Example specifier — bill",
      headerRows: 1,
      mapping: { code: "code", itemDescription: "description", qty: "total q-ty" },
      keep: ["phase"],
    };
    const read = parseBoqSheets([{ sheet: "Bill", data: protoSheet }], { layouts: [layout] }).sheets![0]!;
    expect(read.mappingSource).toBe("layout");
    expect(read.kept).toEqual([{ index: 4, heading: "PHASE" }]);
    expect(read.lines[0]!.kept).toEqual([{ heading: "PHASE", value: "2" }]);

    const moved = protoSheet.map((row) => row.slice(0, 4));
    const fallback = parseBoqSheets([{ sheet: "Bill", data: moved }], { layouts: [layout] }).sheets![0]!;
    expect(fallback.mappingSource).toBe("synonym");
    expect(fallback.kept).toBeUndefined();
  });
});

describe("the model's structure read", () => {
  const answer = (columns: { column: string; role: string | null }[]) =>
    StructureOutput.parse({
      notABill: false,
      notABillEvidence: null,
      headerRow: 2,
      headerRows: 1,
      columns: columns.map((entry) => ({ ...entry, heading: null, evidence: "" })),
      rows: [],
    });

  it("allows keep on several columns, and every other role once", () => {
    const reading = validateStructure(
      answer([
        { column: "A", role: "code" },
        { column: "B", role: "itemDescription" },
        { column: "C", role: "qty" },
        { column: "D", role: "mockupQty" },
        { column: "E", role: "keep" },
        { column: "F", role: "keep" },
      ]),
      protoSheet,
    );
    expect(reading.mapping).toEqual({
      headerRow: 2,
      headerRows: 1,
      columns: { code: 0, itemDescription: 1, qty: 2, mockupQty: 3 },
      keep: [4, 5],
    });
    expect(Object.keys(reading.keptEvidence).sort()).toEqual(["4", "5"]);
    expect(reading.notes).toEqual([]);
  });

  it("drops a keep on a column another role holds, and says so", () => {
    const reading = validateStructure(
      answer([
        { column: "A", role: "code" },
        { column: "B", role: "itemDescription" },
        { column: "A", role: "keep" },
        { column: "Z", role: "keep" },
      ]),
      protoSheet,
    );
    expect(reading.mapping?.keep).toEqual([]);
    expect(reading.notes).toEqual([
      "The model named column A as both the code (client ref) and kept in notes; the first was kept.",
      "The model named column Z as kept in notes, and the sheet has no such column; that was not applied.",
    ]);
  });

  it("offers both roles and says keep is never a way to read a price", () => {
    const role = STRUCTURE_TOOL.input_schema.properties.columns.items.properties.role;
    expect(role.anyOf[0]).toMatchObject({ enum: expect.arrayContaining(["mockupQty", "keep"]) });
    expect(role.description).toMatch(/except keep, which may be given to several columns/);
    expect(role.description).toMatch(/- keep: .*NEVER a price, rate, cost or any money column/);
    expect(role.description).toMatch(/- mockupQty: the quantity for the PROTOTYPE or MOCK-UP only/);
    expect(STRUCTURE_PROMPT).toMatch(/give those columns the role ignore — never keep/);
  });
});

describe("the mock-up cell", () => {
  it("reads blank and the not-applicable tokens as not in the mock-up", () => {
    for (const cell of [null, undefined, "", "  ", "N/A", "n/a", "NA", "-", "–", "0", "none", "None", "000"]) {
      expect(readMockupQty(cell)).toEqual({ on: false });
    }
  });

  it("reads a whole number as how many, and anything else as words with no quantity", () => {
    expect(readMockupQty("1")).toEqual({ on: true, qty: 1, note: null });
    expect(readMockupQty(" 2 ")).toEqual({ on: true, qty: 2, note: null });
    expect(readMockupQty("PARTIAL")).toEqual({ on: true, qty: null, note: "Prototype quantity on the bill: PARTIAL" });
    expect(readMockupQty("1.5")).toEqual({ on: true, qty: null, note: "Prototype quantity on the bill: 1.5" });
    expect(readMockupQty("2 nr")).toEqual({ on: true, qty: null, note: "Prototype quantity on the bill: 2 nr" });
  });
});

describe("the sheet's notices", () => {
  const line = (code: string | null, mockupQtyRaw: string | null, extra: Record<string, unknown> = {}) => ({
    code,
    ignored: false,
    mockupQtyRaw,
    ...extra,
  });

  it("counts only live ITEM lines the mock-up cell puts on the phase — never a finish line", () => {
    const sheet = {
      ignored: false,
      columns: { mockupQty: { index: 3, heading: "Prototype Quantity" } },
      lines: [
        line("ZZ-01", "1"),
        line("ZZ-01-F", "1", { rowKind: "finish_for" }),
        line("ZZ-02", "PARTIAL"),
        line("ZZ-03", "N/A"),
        line("ZZ-04", "1", { ignored: true }),
        line("ZZ-05", null),
      ],
    };
    expect(mockupLines(sheet).map((entry) => entry.code)).toEqual(["ZZ-01", "ZZ-02"]);
    expect(billSheetNotices([sheet])).toEqual({
      0: {
        noCodes: false,
        mockup: {
          count: 2,
          sentence: "2 items will also be added to the Mock-up phase (from the bill's Prototype Quantity).",
        },
      },
    });
    expect(mockupLines({ ...sheet, ignored: true })).toEqual([]);
    expect(mockupReviewSentence(1, null)).toBe("1 item will also be added to the Mock-up phase (from the bill's Prototype Quantity).");
  });

  it("flags a live sheet whose item lines carry no code at all, and only that", () => {
    const codeless = { ignored: false, lines: [line(null, null), line("  ", null), line("FAB-1", null, { rowKind: "finish_for" })] };
    expect(sheetHasNoCodes(codeless)).toBe(true);
    expect(billSheetNotices([codeless])[0]).toEqual({ noCodes: true, mockup: null });
    expect(sheetHasNoCodes({ ignored: false, lines: [line(null, null), line("ZZ-01", null)] })).toBe(false);
    expect(sheetHasNoCodes({ ignored: false, lines: [] })).toBe(false);
    expect(sheetHasNoCodes({ ...codeless, ignored: true })).toBe(false);
    expect(NO_CODES_REVIEW_SENTENCE).toMatch(/cannot be paired automatically/);
  });
});
