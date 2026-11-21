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
import {
  cellsByField,
  composeWorkbook,
  toCsv,
  type ExportAnswer,
  type ExportAttribute,
  type ExportRecord,
  type ExportScope,
} from "@/lib/bws-export";
import type { Finish } from "@/lib/finishes";

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
    expect(metal([attribute({ specFieldJsonId: 5, value: "Antique brass" })])).toBe(true);
    expect(metal([attribute({ specFieldJsonId: 5, value: "TBC" })])).toBe(false);
    expect(metal([attribute({ specFieldJsonId: 35, value: "  none " })])).toBe(false);
    expect(metal([attribute({ specFieldJsonId: 1, value: "Mohair" })])).toBe(false);
    // A placement does not make a non-answer an answer.
    expect(metal([attribute({ specFieldJsonId: 5, value: "None", qualifier: "legs" })])).toBe(false);
  });
});

/** What the quote reads: the cells the BWS file ships for this record. */
const metal = (attributes: ExportAttribute[], answers: ExportAnswer[] = []) =>
  hasMetalFinish(cellsByField(scope({ attributes, answers }), record(), attributes, answers));

const metalFinish = (overrides: Partial<Finish> = {}): Finish => ({
  id: "fin-1",
  code: "ZZ-MTL-01",
  codeNorm: "ZZ-MTL-01",
  codeOrigin: "client",
  kind: "metal",
  description: null,
  supplierRaw: null,
  reference: null,
  colour: null,
  state: "confirmed",
  standard: null,
  ...overrides,
});

describe("the template reads what the BWS file SHIPS in MF1/MF2, not the attributes alone (F8)", () => {
  const sofa = () => record({ matrixCodes: ["S"] } as Partial<ExportRecord>) as ExportRecord & { matrixCodes: string[] };
  const productCode = (over: Partial<ExportScope>) =>
    composeQuoteSheet({ ...scope({ records: [sofa()] }), ...over }, register).rows[0]?.[8];

  it("prices a metal finish that is only a confirmed checklist ANSWER on the with-Metalwork template", () => {
    const answers: ExportAnswer[] = [{ recordId: "rec-1", specFieldJsonId: 5, value: "Antique brass", qualifier: null }];
    expect(productCode({ answers })).toBe(".BW-Sofa,with-Metalwork-BOILERPLATE");
    expect(productCode({ answers: [{ ...answers[0]!, value: "TBC" }] })).toBe(".BW-Sofa,Simple-BOILERPLATE");
  });

  it("counts a spec LINKED to a library finish by what the file writes for it", () => {
    // The drawing gave the code alone; the library says what it is.
    const linked = attribute({ specFieldJsonId: 5, value: "", finish: metalFinish({ description: "Antique brass" }) });
    expect(productCode({ attributes: [linked] })).toBe(".BW-Sofa,with-Metalwork-BOILERPLATE");
  });

  it("counts the library's BW standard in force on a client's TBC (the half that already worked, held)", () => {
    const tbc = attribute({
      specFieldJsonId: 35,
      value: "TBC",
      state: "tbc",
      finish: metalFinish({ state: "tbc", standard: { value: "BW Antique Brass", optionId: null, state: "proposed" } }),
    });
    expect(productCode({ attributes: [tbc] })).toBe(".BW-Sofa,with-Metalwork-BOILERPLATE");
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

  it("carries the record's typed dimension note on the DIMS line", () => {
    // 0034. The client reads this line and BWS receives the same string; a
    // quote that dropped the qualifier would be found by a client rather than
    // by us, which is the argument for one composer in a third place.
    const spec = composeSpecification(
      record({ dimensionNote: "1250 L-shaped return" }),
      [attribute({ attrGroup: "dimension", dimensionSlot: "W", value: "2860", unit: "mm", specFieldJsonId: null })],
      [],
    );
    expect(spec).toContain("DIMS: W2860mm (1250 L-shaped return)");
  });

  it("writes a DIMS line for a note with no figures, rather than dropping it", () => {
    const spec = composeSpecification(record({ dimensionNote: "1250 L-shaped return" }), [], []);
    expect(spec).toContain("DIMS: (1250 L-shaped return)");
  });

  it("writes no DIMS line at all where there is neither a figure nor a note", () => {
    expect(composeSpecification(record(), [], [])).not.toContain("DIMS:");
  });

  it("numbers a label only when the item carries more than one of it", () => {
    const one = composeSpecification(record(), [attribute({ specFieldJsonId: 1, value: "Mohair" })], []);
    expect(one).toContain("FABRIC: Mohair");
    const two = composeSpecification(
      record(),
      [attribute({ specFieldJsonId: 1, value: "Mohair" }), attribute({ id: "a2", specFieldJsonId: 2, value: "Velvet" })],
      [],
    );
    expect(two).toContain("FABRIC 1: Mohair");
    expect(two).toContain("FABRIC 2: Velvet");
  });

  // DECISION F (2026-11-20): "COM" is the customer's own material. A fabric BW
  // supplies is FABRIC on the quote; one marked customer-supplied in the
  // finishes library is COM. The BWS file's column is COM 1 and stays that.
  it("prints FABRIC by default and COM for a fabric whose library finish is the customer's own material", () => {
    const linked = (id: string) => metalFinish({ id, kind: "fabric", code: id.toUpperCase(), codeNorm: id.toUpperCase() });
    expect(composeSpecification(record(), [attribute({ value: "Mohair" })], [])).toContain("FABRIC: Mohair");
    const com = composeSpecification(record(), [attribute({ value: "Mohair", finish: linked("fab-1") })], [], {
      customerSuppliedFinishIds: new Set(["fab-1"]),
    });
    expect(com).toMatch(/^COM: /m);
    expect(com).not.toContain("FABRIC");
  });

  it("numbers FABRIC and COM each within its own label", () => {
    const linked = (id: string) => metalFinish({ id, kind: "fabric", code: id.toUpperCase(), codeNorm: id.toUpperCase(), description: `${id} cloth` });
    const spec = composeSpecification(
      record(),
      [
        attribute({ id: "a1", specFieldJsonId: 1, value: "Mohair" }),
        attribute({ id: "a2", specFieldJsonId: 2, value: "Velvet", finish: linked("fab-2") }),
        attribute({ id: "a3", specFieldJsonId: 14, value: "Linen" }),
      ],
      [],
      { customerSuppliedFinishIds: new Set(["fab-2"]) },
    );
    const lines = spec.split("\n");
    expect(lines).toContain("FABRIC 1: Mohair");
    expect(lines).toContain("FABRIC 2: Linen");
    expect(lines.filter((line) => line.startsWith("COM"))).toEqual([expect.stringMatching(/^COM: /)]);
  });

  it("carries the tick through the sheet, read by the route and never by the atoms", () => {
    const sheet = composeQuoteSheet(
      {
        ...scope({ attributes: [attribute({ finish: metalFinish({ id: "fab-9", kind: "fabric" }) })] }),
        records: [{ ...record(), matrixCodes: ["S"] }],
      },
      register,
      { customerSuppliedFinishIds: new Set(["fab-9"]) },
    );
    expect(sheet.rows[0]?.[3]).toMatch(/^COM: /m);
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

  it("writes an answer through the export's own renderer, placement and all", () => {
    // AUDIT 2026-11-06, F8/F14. The answer and its placement were joined by
    // hand with " - ", a second joinQualifier: flipping EXPORT_QUALIFIER_MODE
    // would have left the quote behind, and a break in the answer reached the
    // quote's one-line-per-spec block as two lines.
    const spec = composeSpecification(
      record(),
      [],
      [{ specFieldJsonId: 74, value: "Required\nto BS 5852", qualifier: "Seat\nand back" }],
    );
    expect(spec).toContain("FR INTERLINER: Required to BS 5852 - Seat and back");
  });
});

describe("a formula in an item description (audit A17)", () => {
  it("is neutralised in the quote CSV and left as composed in the BWS CSV", () => {
    const hostile = record({ itemDescription: '=HYPERLINK("http://example.invalid","Sofa")', qty: -3 });
    const quote = composeQuoteSheet(scope({ records: [hostile] }), register);
    // As the quote route writes it.
    const quoteCsv = toCsv([quote.header, ...quote.rows], { neutraliseFormulas: true });
    expect(quoteCsv).toContain(`"'=HYPERLINK(""http://example.invalid"",""Sofa"")"`);
    // The quantity is a number cell, and stays one.
    expect(quoteCsv).toContain(",-3,");
    // As the BWS export route writes it: imported, not opened.
    const bws = composeWorkbook(scope({ records: [hostile] }));
    const bwsCsv = toCsv([bws.jobs.headerNames, bws.jobs.headerIds, ...bws.jobs.rows]);
    expect(bwsCsv).toContain(`"=HYPERLINK(""http://example.invalid"",""Sofa"")"`);
    expect(bwsCsv).not.toContain("'=HYPERLINK");
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
    expect(row[3]).toContain("FABRIC: Pierre Frey Teddy Mohair F2500017");
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
