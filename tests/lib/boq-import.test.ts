// Pure tier. The fixtures below are SYNTHETIC — they reproduce the SHAPE of a
// real client BOQ (title rows, a late header, a repeated code, free-text
// descriptions, a totals row) without carrying a single real line of client
// data. Real BOQs stay in the gitignored reference folder.
import { describe, it, expect } from "vitest";
import type { SheetData } from "read-excel-file/node";
import { parseBoqSheets, normaliseRef } from "@/lib/boq-import";

const HEADER = ["Designer", "Category", "Code", "Item Description", "Product Reference", "Total Qty Updated"];

function sheet(data: SheetData, name = "Feuil1") {
  return [{ sheet: name, data }];
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

describe("parseBoqSheets", () => {
  it("finds a header that is not the first row", () => {
    const result = parseBoqSheets(sheet(TYPICAL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headerRow).toBe(5);
    expect(result.sheet).toBe("Feuil1");
  });

  it("reads every line and keeps the source row number", () => {
    const result = parseBoqSheets(sheet(TYPICAL));
    if (!result.ok) throw new Error(result.error);
    expect(result.lines).toHaveLength(5); // four items + the TOTAL row, which has a description
    expect(result.lines[0]).toEqual({
      lineNo: 6,
      designer: "AAA",
      boqCategory: "Furniture",
      code: "EX-100-01",
      itemDescription: "Side Table",
      productReference: "Round, 600 dia",
      qty: 4,
    });
  });

  it("keeps a repeated client code as two separate lines", () => {
    // The case that killed the original schema: a BOQ code is not unique, so
    // nothing here may deduplicate. Two rows in, two lines out, different qty.
    const result = parseBoqSheets(sheet(TYPICAL));
    if (!result.ok) throw new Error(result.error);
    const repeated = result.lines.filter((line) => line.code === "ZZ11A");
    expect(repeated).toHaveLength(2);
    expect(repeated.map((line) => line.qty)).toEqual([4, 1]);
    expect(repeated.map((line) => line.lineNo)).toEqual([8, 9]);
  });

  it("counts blank-but-not-empty rows rather than dropping them silently", () => {
    const withStray: SheetData = [...TYPICAL, [null, null, null, null, null, 99]];
    const result = parseBoqSheets(sheet(withStray));
    if (!result.ok) throw new Error(result.error);
    expect(result.skippedRows).toBe(1);
  });

  it("finds the BOQ on a later sheet", () => {
    const result = parseBoqSheets([
      { sheet: "Notes", data: [["Some notes"], ["and more"]] },
      { sheet: "BOQ", data: TYPICAL },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.sheet).toBe("BOQ");
  });

  it("accepts synonym headers", () => {
    const result = parseBoqSheets(
      sheet([["Client Ref", "Description", "Qty"], ["EX-1", "Sofa", 2]]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.lines[0]).toMatchObject({ code: "EX-1", itemDescription: "Sofa", qty: 2 });
  });

  it("does not let a Product Reference column be claimed as the code column", () => {
    const result = parseBoqSheets(sheet([HEADER, ["AAA", "Seating", "EX-9", "Sofa", "Model Q", 1]]));
    if (!result.ok) throw new Error(result.error);
    expect(result.lines[0]?.code).toBe("EX-9");
    expect(result.lines[0]?.productReference).toBe("Model Q");
  });

  it("names the columns it needed when there is no header", () => {
    const result = parseBoqSheets(sheet([["just"], ["some"], ["text"]]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/code column/i);
    expect(result.error).toMatch(/description column/i);
  });

  it("reports a header with nothing under it rather than returning zero lines", () => {
    const result = parseBoqSheets(sheet([HEADER]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no rows under it/);
  });

  it("refuses an empty workbook", () => {
    expect(parseBoqSheets([])).toEqual({ ok: false, error: "The file has no sheets." });
  });

  it("tolerates messy quantities and whitespace", () => {
    const result = parseBoqSheets(
      sheet([HEADER, ["AAA ", "Seating", " EX-3 ", "  Bench @entrance ", null, " 12 "]]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.lines[0]).toMatchObject({
      designer: "AAA",
      code: "EX-3",
      itemDescription: "Bench @entrance",
      productReference: null,
      qty: 12,
    });
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
