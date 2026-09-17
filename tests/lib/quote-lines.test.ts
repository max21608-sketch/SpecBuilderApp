// Pure tier — the quote CSV, and the four columns it refuses to invent.
import { describe, it, expect } from "vitest";
import {
  QUOTE_HEADER,
  composeQuoteSheet,
  composeSpecification,
  hasMetalFinish,
  pickBoilerplate,
  type QuoteBoilerplate,
} from "@/lib/quote-lines";
import type { ExportAttribute, ExportRecord, ExportScope } from "@/lib/bws-export";

const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  id: "rec-1",
  recordNo: 1,
  label: "P00001-001",
  itemDescription: "Sofa",
  qty: 14,
  area: "FF Living Room",
  runName: "Main run",
  boqCodes: ["S-100"],
  ...overrides,
});

const attribute = (overrides: Partial<ExportAttribute> = {}): ExportAttribute => ({
  id: "attr-1",
  recordId: "rec-1",
  attrGroup: "material",
  label: "SOFA",
  value: "Pierre Frey Teddy Mohair F2500017",
  unit: null,
  qualifier: null,
  dimensionSlot: null,
  materialCode: null,
  finish: null,
  specFieldJsonId: 1,
  state: "confirmed",
  sortOrder: 0,
  sourceFilename: "S-100.pdf",
  sourcePage: 1,
  ...overrides,
});

const register: QuoteBoilerplate[] = [
  { matrixCode: "S", variant: "simple", code: ".BW-Sofa,Simple-BOILERPLATE", bwsId: 847 },
  { matrixCode: "S", variant: "metalwork", code: ".BW-Sofa,with-Metalwork-BOILERPLATE", bwsId: 851 },
];

const scope = (over: Partial<ExportScope> = {}): ExportScope => ({
  projectName: "Panther",
  client: "A client",
  runName: "Main run",
  records: [record()],
  attributes: [],
  answers: [],
  ...over,
});

describe("the boilerplate, by Matthew's own rule", () => {
  it("is Simple with no metal finish and with-Metalwork with one", () => {
    expect(pickBoilerplate(["S"], false, register)?.bwsId).toBe(847);
    expect(pickBoilerplate(["S"], true, register)?.bwsId).toBe(851);
  });

  it("is NOTHING for a category his matrix does not cover", () => {
    // Every cabinetry sheet, today. A blank product code is the honest answer;
    // a guessed one imports against the wrong template.
    expect(pickBoilerplate([], false, register)).toBeNull();
    expect(pickBoilerplate(["CAB"], false, register)).toBeNull();
  });

  it("derives NOTHING where the category maps to more than one of his nine", () => {
    // Our `armchairs-benches-stools-sofas` is one sheet receiving S, A and B.
    // Found in the browser: taking the first alphabetically handed a SOFA the
    // ARMCHAIR boilerplate, which is the app choosing silently between three
    // prices. A blank is a visible gap; a wrong code prices the item against
    // the wrong template.
    expect(pickBoilerplate(["A", "B", "S"], false, register)).toBeNull();
  });

  it("does not count TBC or None as a metal finish", () => {
    // "Populated" cannot mean "carries any string": a metal finish recorded as
    // TBC is somebody saying it is not decided, and it must not silently move
    // the item onto a different boilerplate and a different price.
    expect(hasMetalFinish([attribute({ specFieldJsonId: 5, value: "Antique brass" })])).toBe(true);
    expect(hasMetalFinish([attribute({ specFieldJsonId: 5, value: "TBC" })])).toBe(false);
    expect(hasMetalFinish([attribute({ specFieldJsonId: 35, value: "  none " })])).toBe(false);
    expect(hasMetalFinish([attribute({ specFieldJsonId: 1, value: "Mohair" })])).toBe(false);
  });
});

describe("the Specification block", () => {
  it("opens with the record's own prose and closes with his caveat", () => {
    const spec = composeSpecification({ ...record(), specDescription: "Curved sofa\nRecessed timber plinth" }, [], []);
    expect(spec.split("\n").slice(0, 3)).toEqual([
      "As per details supplied",
      "Curved sofa",
      "Recessed timber plinth",
    ]);
    expect(spec).toContain("*Subject to price increase where furniture is to be made in component form*");
  });

  it("writes DIMS through the SAME composer the BWS file uses", () => {
    const spec = composeSpecification(
      record(),
      [
        attribute({ attrGroup: "dimension", dimensionSlot: "W", value: "2860", unit: "mm", specFieldJsonId: null }),
        attribute({ id: "a2", attrGroup: "dimension", dimensionSlot: "D", value: "860", unit: "mm", specFieldJsonId: null, sortOrder: 1 }),
        attribute({ id: "a3", attrGroup: "dimension", dimensionSlot: "H", value: "800", unit: "mm", specFieldJsonId: null, sortOrder: 2 }),
      ],
      [],
    );
    // A second dimension composer is the one thing that design exists to
    // prevent: a quote saying W2860 where the BWS file said something else
    // would be found by a client rather than by us.
    expect(spec).toContain("DIMS: W2860 x D860 x H800mm");
  });

  it("numbers a label only when the item carries more than one of it", () => {
    const one = composeSpecification(record(), [attribute({ specFieldJsonId: 1, value: "Mohair" })], []);
    expect(one).toContain("COM: Mohair");
    const two = composeSpecification(
      record(),
      [attribute({ specFieldJsonId: 1, value: "Mohair" }), attribute({ id: "a2", specFieldJsonId: 2, value: "Velvet" })],
      [],
    );
    expect(two).toContain("COM 1: Mohair");
    expect(two).toContain("COM 2: Velvet");
  });

  it("carries the placement onto the line, which is where his own file puts it", () => {
    const spec = composeSpecification(
      record(),
      [attribute({ specFieldJsonId: 4, value: "BW Standard Beech, Dark Brown 30% sheen", qualifier: "Recessed plinth" })],
      [],
    );
    expect(spec).toContain("TIMBER: BW Standard Beech, Dark Brown 30% sheen - Recessed plinth");
  });

  it("falls back to a checklist answer where no document claimed the field", () => {
    const spec = composeSpecification(record(), [], [{ specFieldJsonId: 74, value: "Required", qualifier: null }]);
    expect(spec).toContain("FR INTERLINER: Required");
  });
});

describe("the sheet", () => {
  it("is his twelve columns in his order", () => {
    expect(QUOTE_HEADER).toEqual([
      "Type", "Item count", "Description", "Specification", "Internal notes", "Area or room",
      "Net price each", "Net price", "Product code", "Product code id", "UUID", "Image url",
    ]);
  });

  it("fills eight and LEAVES FOUR BLANK, saying why", () => {
    const sheet = composeQuoteSheet(
      { ...scope({ attributes: [attribute()] }), records: [{ ...record(), matrixCodes: ["S"], internalNotes: "previous price 9,200" }] },
      register,
    );
    const row = sheet.rows[0] ?? [];
    expect(row[0]).toBe("J");
    expect(row[1]).toBe("14");
    expect(row[2]).toBe("Sofa");
    expect(row[3]).toContain("COM: Pierre Frey Teddy Mohair F2500017");
    expect(row[4]).toBe("previous price 9,200");
    expect(row[5]).toBe("FF Living Room");
    // No pricing exists anywhere in this app. A generated number would be the
    // first figure in the product nothing downstream could question.
    expect(row[6]).toBe("");
    expect(row[7]).toBe("");
    expect(row[8]).toBe(".BW-Sofa,Simple-BOILERPLATE");
    expect(row[9]).toBe("847");
    expect(row[10]).toBe("");
    expect(row[11]).toBe("");
    expect(sheet.unfillable.join(" ")).toMatch(/no pricing at all/);
    expect(sheet.unfillable.join(" ")).toMatch(/metreage/);
  });

  it("names a configuration the way the BWS file does", () => {
    const sheet = composeQuoteSheet(
      { ...scope(), records: [{ ...record(), variantLabel: "A", matrixCodes: ["S"] }] },
      register,
    );
    expect(sheet.rows[0]?.[2]).toBe("Sofa (A)");
  });

  it("leaves the product code blank rather than guessing one for an unmapped category", () => {
    const sheet = composeQuoteSheet({ ...scope(), records: [{ ...record(), matrixCodes: [] }] }, register);
    expect(sheet.rows[0]?.[8]).toBe("");
    expect(sheet.rows[0]?.[9]).toBe("");
  });
});
