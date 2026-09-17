// Pure tier. Fixtures are synthetic; the column NAMES are the BWS schema, which
// is what this repo commits — never a row of the export.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BWS_EXPORT_COLUMNS,
  SPEC_FIELD_COLUMNS,
  composeRow,
  composeRowCells,
  composeWorkbook,
  EXPORT_QUALIFIER_MODE,
  composeDimensions,
  renderAttributeValue,
  toCsv,
  exportFilename,
  type ExportAttribute,
  type ExportRecord,
  type ExportScope,
} from "@/lib/bws-export";

const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  id: "rec-1",
  recordNo: 1,
  label: "P00001-001",
  itemDescription: "Sofa",
  qty: 14,
  area: "Rooms",
  runName: "Main run",
  boqCodes: ["X-100"],
  ...overrides,
});

const attribute = (overrides: Partial<ExportAttribute> = {}): ExportAttribute => ({
  id: "attr-1",
  finish: null,
  recordId: "rec-1",
  attrGroup: "material",
  label: "SOFA",
  value: "Yarn Tessarae YC04158 - 01",
  unit: null,
  qualifier: null,
  dimensionSlot: null,
  materialCode: null,
  specFieldJsonId: 1,
  state: "confirmed",
  sortOrder: 0,
  sourceFilename: "drawings.pdf",
  sourcePage: 1,
  ...overrides,
});

const scope = (overrides: Partial<ExportScope> = {}): ExportScope => ({
  projectName: "Example Hotel",
  client: "Example Client Ltd",
  runName: "Main run",
  records: [record()],
  attributes: [],
  answers: [],
  ...overrides,
});

const indexOfField = (jsonId: number) => BWS_EXPORT_COLUMNS.findIndex((column) => column.jsonId === jsonId);
// The job-metadata block has NO ids, so it can only be addressed by name.
const indexOfName = (name: string) => BWS_EXPORT_COLUMNS.findIndex((column) => column.name === name);

describe("BWS_EXPORT_COLUMNS", () => {
  it("is the 109-column layout, with ids only from AF onwards", () => {
    expect(BWS_EXPORT_COLUMNS).toHaveLength(109);
    expect(BWS_EXPORT_COLUMNS.slice(0, 31).every((column) => column.jsonId === null)).toBe(true);
    expect(BWS_EXPORT_COLUMNS.slice(31).every((column) => column.jsonId !== null)).toBe(true);
  });

  it("keeps the names verbatim, trailing space and all", () => {
    // 'Stone ' is how BWS spells it. A tidied name is a column BWS will not
    // recognise, and the seed comment records the same trap.
    expect(BWS_EXPORT_COLUMNS[0]?.name).toBe("Id");
    expect(BWS_EXPORT_COLUMNS.some((column) => column.name === "Stone ")).toBe(true);
  });

  it("has spec ids exactly matching the seeded register", () => {
    // Catches a BWS column insertion: every letter after it shifts while the
    // ids do not, so a positional list would quietly export into the wrong
    // columns.
    const seed = readFileSync("db/seed/0001_spec_fields.sql", "utf8");
    const seeded = new Set(
      [...seed.matchAll(/^\s*\((\d+), '[A-Z]{2}',/gm)].map((match) => Number(match[1])),
    );
    const exported = new Set(SPEC_FIELD_COLUMNS.map((column) => column.jsonId as number));
    expect(seeded.size).toBe(56);
    expect(exported).toEqual(seeded);
  });

  it("finds Client Code outside the spec block", () => {
    // json 136 is a website/style column, not one of the 56 — so it is reachable
    // only from the static list, never from spec_fields.
    expect(indexOfField(136)).toBeGreaterThan(86);
  });
});

describe("composeRow", () => {
  it("fills the job columns it can honestly know and leaves BWS vocabularies blank", () => {
    const row = composeRow(scope(), record(), [], []);
    expect(row).toHaveLength(109);
    expect(row[indexOfName("Client")]).toBe("Example Client Ltd");
    expect(row[indexOfName("Project Ref")]).toBe("Example Hotel");
    expect(row[indexOfName("Name")]).toBe("Sofa");
    expect(row[indexOfName("Item Count")]).toBe("14");
    expect(row[indexOfField(136)]).toBe("X-100"); // Client Code
    // Id and Job Number: this app has never had BWS access and does not know them.
    expect(row[0]).toBe("");
    expect(row[2]).toBe("");
    // Category / Status / KAM are BWS vocabularies; a guessed enum is a wrong
    // classification that imports cleanly.
    expect(row[7]).toBe("");
    expect(row[19]).toBe("");
  });

  it("does NOT write a job value into the spec field that shares its position's number", () => {
    // The bug this replaces: the job block carries no ids, so matching it by id
    // put the client's name in `Hinges` (json 9), the item description in
    // `COM 3` (14) and the quantity in `Item Count`'s id-twin. Every value
    // landed in a real column, so the file looked correct.
    const row = composeRow(scope(), record(), [], []);
    expect(row[indexOfField(9)]).toBe(""); // Hinges
    expect(row[indexOfField(10)]).toBe(""); // Runners
    expect(row[indexOfField(14)]).toBe(""); // COM 3
    expect(row[indexOfField(22)]).toBe(""); // Finishing Sheen
  });

  it("puts a fabric in the COM slot its attribute names", () => {
    const attributes = [attribute({ specFieldJsonId: 1 }), attribute({ specFieldJsonId: 2, value: "Tibor Blob" })];
    const row = composeRow(scope({ attributes }), record(), attributes, []);
    expect(row[indexOfField(1)]).toBe("Yarn Tessarae YC04158 - 01");
    expect(row[indexOfField(2)]).toBe("Tibor Blob");
  });

  it("composes the dimension slots into the single Dimensions field, in millimetres", () => {
    // Matthew's ruling, 2026-09-15. This used to read
    // "Width 190cm; Depth 79cm; Height 72cm" — every label a page printed, in
    // whatever unit it was drawn in. Every output string is pinned in
    // tests/lib/dimensions.test.ts; this asserts it reaches cell 3.
    const attributes = [
      attribute({ attrGroup: "dimension", dimensionSlot: "W", label: "WIDTH", value: "190", unit: "cm", specFieldJsonId: null, sortOrder: 0 }),
      attribute({ attrGroup: "dimension", dimensionSlot: "D", label: "DEPTH", value: "79", unit: "cm", specFieldJsonId: null, sortOrder: 1 }),
      attribute({ attrGroup: "dimension", dimensionSlot: "H", label: "HEIGHT", value: "72", unit: "cm", specFieldJsonId: null, sortOrder: 2 }),
    ];
    const row = composeRow(scope({ attributes }), record(), attributes, []);
    expect(row[indexOfField(3)]).toBe("W1900 x D790 x H720mm");
  });

  it("leaves a dimension that never got a slot out of the cell rather than guessing", () => {
    // 0011 cannot store one, so this is a legacy or hand-edited row. It is
    // still listed long-form on the second sheet — the cell is a summary, the
    // sheet is the record.
    const attributes = [
      attribute({ attrGroup: "dimension", dimensionSlot: "W", label: "WIDTH", value: "1900", unit: "mm", specFieldJsonId: null, sortOrder: 0 }),
      attribute({ attrGroup: "dimension", dimensionSlot: null, label: "Side view width", value: "790", unit: "mm", specFieldJsonId: null, sortOrder: 1 }),
    ];
    expect(composeDimensions(attributes)).toBe("W1900mm");
  });

  it("appends the unit exactly once, so a value must never carry its own", () => {
    // renderAttributeValue concatenates value and unit with no separator. That
    // is correct and deliberate for a material or a finish -- but it means a
    // value of "1800mm" with unit `mm` renders "1800mmmm" straight into a BWS
    // cell. Nothing here can tell the difference, so the split happens
    // upstream: splitFigureAndUnit() at staging, and again in the drawings
    // PATCH when a reviewer types one. This test pins the contract those rely on.
    expect(renderAttributeValue({ value: "1800", unit: "mm", state: "confirmed" })).toBe("1800mm");
    expect(renderAttributeValue({ value: "1800mm", unit: "mm", state: "confirmed" })).toBe("1800mmmm");

    // A DIMENSION can no longer reach that shape at all, which is a stronger
    // guarantee than the split upstream: the cell is composed from a parsed
    // figure, so "1800mm" is not a number and is rendered loudly instead of
    // being concatenated into "1800mmmm".
    const attributes = [
      attribute({ attrGroup: "dimension", dimensionSlot: "W", label: "WIDTH", value: "1800", unit: "mm", specFieldJsonId: null, sortOrder: 0 }),
      attribute({ attrGroup: "dimension", dimensionSlot: "H", label: "HEIGHT", value: "1120", unit: "mm", specFieldJsonId: null, sortOrder: 1 }),
    ];
    expect(composeDimensions(attributes)).toBe("W1800 x H1120mm");
    expect(
      composeDimensions([attribute({ attrGroup: "dimension", dimensionSlot: "W", value: "1800mm", unit: "mm", specFieldJsonId: null })]),
    ).toBe('[W "1800mm" — not a number]');
  });

  it("exports TBC as TBC, never as a blank", () => {
    // A blank says nobody looked; TBC says the client has not decided.
    const attributes = [attribute({ label: "PIPING", value: null, state: "tbc", specFieldJsonId: 1 })];
    const row = composeRow(scope({ attributes }), record(), attributes, []);
    expect(row[indexOfField(1)]).toBe("TBC");
    expect(renderAttributeValue({ value: "Brass", unit: null, state: "tbc" })).toBe("Brass TBC");
  });

  it("marks TBC once, whether or not the document already said it", () => {
    // The shape this exists for: the page states nothing about being settled,
    // so the state is the only thing carrying it.
    expect(renderAttributeValue({ value: "sofa feet dark-tinted wood as per approved sample", unit: null, state: "tbc" })).toBe(
      "sofa feet dark-tinted wood as per approved sample TBC",
    );

    // The shape that produced "... YC04158 - 01 TBC" on the real pack: the
    // designer has named a candidate AND said it is not settled. The value is
    // kept exactly as the page wrote it, dash and all, and gains nothing.
    expect(renderAttributeValue({ value: "TBC - Example Collective Fabric AB01234 - 01", unit: null, state: "tbc" })).toBe(
      "TBC - Example Collective Fabric AB01234 - 01",
    );
    // And the whole-value case, which exported as "TBC TBC".
    expect(renderAttributeValue({ value: "TBC", unit: null, state: "tbc" })).toBe("TBC");

    // Anywhere in the value, however the page punctuated or cased it: the
    // question is whether a reader of this cell already sees the marker.
    expect(renderAttributeValue({ value: "Fabric A, or Fabric B tbc - client to choose", unit: null, state: "tbc" })).toBe(
      "Fabric A, or Fabric B tbc - client to choose",
    );
    expect(renderAttributeValue({ value: "Finish T.B.C.", unit: null, state: "tbc" })).toBe("Finish T.B.C.");

    // Word-bounded: a code that merely contains the letters is a code. Losing
    // the marker here is the failure that matters -- a cell nobody has decided
    // reading as a decided one.
    expect(renderAttributeValue({ value: "Lacquer AB-TBC1", unit: null, state: "tbc" })).toBe("Lacquer AB-TBC1 TBC");
    expect(renderAttributeValue({ value: "Ottbcloth weave", unit: null, state: "tbc" })).toBe("Ottbcloth weave TBC");

    // A confirmed value is never marked, even when the wording mentions it --
    // the state is the reviewer's decision and the text is the page's.
    expect(renderAttributeValue({ value: "Brass, TBC sample approved 14 Sep", unit: null, state: "confirmed" })).toBe(
      "Brass, TBC sample approved 14 Sep",
    );
  });

  it("falls back to a confirmed cheat-sheet answer where no attribute claims the field", () => {
    const answers = [{ recordId: "rec-1", specFieldJsonId: 4, value: "Oiled oak", qualifier: null }];
    const row = composeRow(scope({ answers }), record(), [], answers);
    expect(row[indexOfField(4)]).toBe("Oiled oak");
  });

  it("prefers the document attribute over the checklist answer", () => {
    // An attribute is a statement from a client document that can be re-checked
    // against a page; an answer is somebody filling in a checklist.
    const attributes = [attribute({ specFieldJsonId: 4, value: "Dark tinted wood", attrGroup: "finish" })];
    const answers = [{ recordId: "rec-1", specFieldJsonId: 4, value: "Oiled oak", qualifier: null }];
    const row = composeRow(scope({ attributes, answers }), record(), attributes, answers);
    expect(row[indexOfField(4)]).toBe("Dark tinted wood");
  });

  it("joins several client codes", () => {
    const row = composeRow(scope(), record({ boqCodes: ["X-100", "X-100A"] }), [], []);
    expect(row[indexOfField(136)]).toBe("X-100, X-100A");
  });
});

describe("composeWorkbook", () => {
  it("emits one row per record in scope INCLUDING a record with nothing on it", () => {
    // The rule the whole export rests on: a BWS import replaces rather than
    // merges, so a record omitted because it had nothing to say is a record
    // whose fields would be wiped.
    const records = [record({ id: "a", recordNo: 2 }), record({ id: "b", recordNo: 1, itemDescription: "Armchair" })];
    const attributes = [attribute({ recordId: "a" })];
    const workbook = composeWorkbook(scope({ records, attributes }));
    expect(workbook.jobs.rows).toHaveLength(2);
    // Sorted by record number, and the empty record still has its own row.
    expect(workbook.jobs.rows[0]?.[indexOfName("Name")]).toBe("Armchair");
    expect(workbook.jobs.rows[1]?.[indexOfField(1)]).toBe("Yarn Tessarae YC04158 - 01");
  });

  it("writes the two header rows the BWS export has", () => {
    const workbook = composeWorkbook(scope());
    expect(workbook.jobs.headerNames).toHaveLength(109);
    expect(workbook.jobs.headerIds).toHaveLength(109);
    expect(workbook.jobs.headerIds.slice(0, 31).every((id) => id === "")).toBe(true);
    expect(workbook.jobs.headerIds[indexOfField(1)]).toBe("1");
  });

  it("lists every attribute long-form so flattening loses nothing", () => {
    const attributes = [
      attribute({ label: "SOFA FEET", value: "Dark tinted wood", materialCode: "WD-01", specFieldJsonId: 4, attrGroup: "finish", sourcePage: 1 }),
      attribute({ attrGroup: "dimension", dimensionSlot: "W", label: "WIDTH", value: "190", unit: "cm", specFieldJsonId: null, sortOrder: 1 }),
    ];
    const workbook = composeWorkbook(scope({ attributes }));
    expect(workbook.specs.rows).toHaveLength(2);
    expect(workbook.specs.rows[0]).toEqual([
      "P00001-001", "X-100", "Main run", "Finishes", "SOFA FEET", "", "Dark tinted wood", "", "WD-01",
      "Main timber finish", "confirmed", "drawings.pdf", "1",
    ]);
    // The ORIGINAL value and unit, beside the slot — which is what lets a
    // reviewer check the converted W1900 in cell 3 against a page saying 190.
    expect(workbook.specs.rows[1]).toEqual([
      "P00001-001", "X-100", "Main run", "Dimensions", "WIDTH", "Width", "190", "cm", "",
      "", "confirmed", "drawings.pdf", "1",
    ]);
    expect(workbook.specs.header).toHaveLength(13);
  });
});

describe("composeDimensions", () => {
  it("is blank when there are none", () => {
    expect(composeDimensions([])).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a BOM and quotes what needs quoting", () => {
    const csv = toCsv([["a", 'say "hi"', "one,two"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"one,two"');
  });
});

describe("exportFilename", () => {
  it("allowlists the characters that reach a Content-Disposition header", () => {
    expect(exportFilename("P17231", 'Main "run"\r\n/etc', "xlsx")).toBe("P17231 - Main runetc - BWS spec fields.xlsx");
    expect(exportFilename("P17231", null, "csv")).toBe("P17231 - BWS spec fields.csv");
  });
});

describe("the qualifier — the return line", () => {
  it("joins onto the value on ONE line, which is what BWS can receive today", () => {
    const row = composeRow(
      scope({}),
      record(),
      [attribute({ specFieldJsonId: 1, value: "Yarn Tessarae YC04158", qualifier: "Main body & self pipe" })],
      [],
    );
    expect(row[indexOfField(1)]).toBe("Yarn Tessarae YC04158 - Main body & self pipe");
  });

  it("goes on AFTER the TBC marker, so a placement cannot suppress one", () => {
    const row = composeRow(
      scope({}),
      record(),
      [attribute({ specFieldJsonId: 1, value: "Yarn Tessarae", state: "tbc", qualifier: "Outside back" })],
      [],
    );
    expect(row[indexOfField(1)]).toBe("Yarn Tessarae TBC - Outside back");
  });

  it("renders on an ANSWER too, or a placement typed on the record screen vanishes from the file", () => {
    const answers = [{ recordId: "rec-1", specFieldJsonId: 4, value: "Oiled oak", qualifier: "Recessed plinth" }];
    const row = composeRow(scope({ answers }), record(), [], answers);
    expect(row[indexOfField(4)]).toBe("Oiled oak - Recessed plinth");
  });

  it("is absent from the composed DIMENSIONS cell, which has no single placement", () => {
    const cells = composeRowCells(
      scope({}),
      record(),
      [
        attribute({ attrGroup: "dimension", dimensionSlot: "W", value: "1900", unit: "mm", specFieldJsonId: null, qualifier: "Overall" }),
      ],
      [],
    );
    const dimensions = cells[indexOfField(3)];
    expect(dimensions?.qualifier).toBeNull();
  });

  it("NO EXPORTED CELL CONTAINS A NEWLINE while the mode is inline", () => {
    // The guard on EXPORT_QUALIFIER_MODE. Matthew can get Tim to build the BWS
    // importer to take a second line; until that exists and somebody has seen
    // its shape, writing one into the most dangerous file in the product is
    // guessing at a file format. Flipping the constant means watching this
    // fail on purpose and running a fresh check sheet.
    expect(EXPORT_QUALIFIER_MODE).toBe("inline");
    const row = composeRow(
      scope({}),
      record(),
      [
        attribute({ specFieldJsonId: 1, value: "Yarn Tessarae", qualifier: "Main body & self pipe" }),
        attribute({ id: "attr-2", specFieldJsonId: 4, value: "Oiled oak", qualifier: "Recessed plinth" }),
      ],
      [],
    );
    for (const cell of row) expect(cell).not.toMatch(/[\r\n]/);
  });
});
