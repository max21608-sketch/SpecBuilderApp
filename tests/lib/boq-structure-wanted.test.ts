import { describe, expect, it } from "vitest";
import { sheetWantsStructureRead } from "@/lib/boq-structure-wanted";

const ref = (heading: string, index: number) => ({ heading, index });

describe("which sheets the model reads on its own", () => {
  it("reads a sheet nobody could map, once", () => {
    const sheet = { sheetName: "A", needsColumns: true, ignored: false };
    expect(sheetWantsStructureRead(sheet, false)).toBe(true);
    expect(sheetWantsStructureRead(sheet, true)).toBe(false);
  });

  it("reads a sheet the known headings mapped with NO quantity column (the Ronnie Scott's schedule)", () => {
    const sheet = {
      sheetName: "UPHOLSTERED",
      needsColumns: false,
      ignored: false,
      mappingSource: "synonym" as const,
      columns: { code: ref("FF&E CODE", 5), itemDescription: ref("DESCRIPTION", 7), qtyUnit: ref("UOM", 13) },
    };
    expect(sheetWantsStructureRead(sheet, false)).toBe(true);
    expect(sheetWantsStructureRead(sheet, true)).toBe(false);
  });

  it("leaves a synonym-mapped sheet WITH a quantity alone", () => {
    const sheet = {
      sheetName: "MAIN RUN",
      needsColumns: false,
      ignored: false,
      mappingSource: "synonym" as const,
      columns: { code: ref("Code", 0), qty: ref("Qty", 3) },
    };
    expect(sheetWantsStructureRead(sheet, false)).toBe(false);
  });

  it("never second-guesses a person's, a layout's or a model's mapping, nor a dropped sheet", () => {
    for (const mappingSource of ["person", "layout", "model"] as const) {
      expect(sheetWantsStructureRead({ sheetName: "A", ignored: false, mappingSource, columns: {} }, false)).toBe(false);
    }
    expect(sheetWantsStructureRead({ sheetName: "A", ignored: true, needsColumns: true }, false)).toBe(false);
  });
});
