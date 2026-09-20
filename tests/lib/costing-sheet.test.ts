// Pure tier — the costing sheet's item block.
//
// The shapes here are read off a real completed sheet (Maybourne Paris
// seating, 2026-09-18). No client value, ref or price from that file is
// reproduced: the schema is what gets committed, never a row.
import { describe, it, expect } from "vitest";
import {
  COSTING_HEADER,
  composeCostingSheet,
  costingRowCells,
  dimensionTag,
  pickSources,
  sourceLink,
  type CostingSource,
  type CostingRow,
} from "@/lib/costing-sheet";
import type { ExportAttribute, ExportRecord, ExportScope } from "@/lib/bws-export";

const ORIGIN = "https://spec.example.com";

const record = (overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  id: "rec-1",
  recordNo: 1,
  label: "P00001-001",
  itemDescription: "Armchair",
  qty: 40,
  area: "Type 006/102",
  runName: "Main run",
  boqCodes: ["FU02"],
  ...overrides,
});

const dimension = (slot: "W" | "D" | "H" | "SH" | "DIA", value: string, over: Partial<ExportAttribute> = {}): ExportAttribute => ({
  id: `attr-${slot}`,
  recordId: "rec-1",
  attrGroup: "dimension",
  label: slot,
  value,
  unit: "mm",
  qualifier: null,
  dimensionSlot: slot,
  materialCode: null,
  finish: null,
  specFieldJsonId: null,
  state: "confirmed",
  sortOrder: 0,
  sourceFilename: "drawings.pdf",
  sourcePage: 4,
  ...over,
});

const scope = (over: Partial<ExportScope> = {}): ExportScope => ({
  projectName: "A project",
  client: "A client",
  runName: "Main run",
  records: [record()],
  attributes: [],
  answers: [],
  ...over,
});

/**
 * The first row, asserted present.
 *
 * `noUncheckedIndexedAccess` is on, and threading `?.` through every assertion
 * would make a missing row pass as a silent undefined rather than fail.
 */
const only = (sheet: { rows: CostingRow[] }): CostingRow => {
  const row = sheet.rows[0];
  if (!row) throw new Error("expected at least one row");
  return row;
};

const compose = (
  over: Partial<ExportScope> = {},
  options: Partial<Parameters<typeof composeCostingSheet>[1]> = {},
) =>
  composeCostingSheet(scope(over) as Parameters<typeof composeCostingSheet>[0], {
    origin: ORIGIN,
    sourcesByRecord: new Map(),
    imageRecordIds: new Set(),
    ...options,
  });

describe("the shape of the file", () => {
  it("is ten columns, A to J, and stops before the estimator's", () => {
    expect(COSTING_HEADER).toHaveLength(10);
    expect(COSTING_HEADER).toEqual(["Specs", "", "Specs 2", "Area", "Client Ref", "Item", "Qty", "Image", "Comments", "Tags"]);
    // B is the template's own spacer and must stay empty, or every column
    // right of it lands one across when the block is pasted in.
    expect(COSTING_HEADER[1]).toBe("");
  });

  it("emits one row per record, in record order", () => {
    const sheet = compose({
      records: [record({ id: "b", recordNo: 7, itemDescription: "Stool" }), record({ id: "a", recordNo: 2 })],
    });
    expect(sheet.rows.map((row) => row.recordNo)).toEqual([2, 7]);
    expect(costingRowCells(only(sheet))).toHaveLength(10);
  });
});

describe("Tags carries the composed dimensions", () => {
  it("is the same string the BWS file and the quote compose", () => {
    const sheet = compose({
      attributes: [dimension("W", "660"), dimension("D", "685"), dimension("H", "680"), dimension("SH", "445")],
    });
    expect(only(sheet).tags).toBe("W660 x D685 x H680 x SH445mm");
  });

  it("is blank rather than guessed where the record has no dimensions", () => {
    const sheet = compose();
    expect(only(sheet).tags).toBe("");
    expect(sheet.notes.join(" ")).toContain("no dimensions recorded yet");
  });

  it("carries the composer's own bracket rather than inventing a figure it could not derive", () => {
    // The unit rule is the point: an unresolved figure is rendered verbatim
    // outside the millimetre group, saying why. A costing sheet that silently
    // converted it would price against a number nobody measured.
    const sheet = compose({ attributes: [dimension("W", "approx 720-740", { unit: null })] });
    expect(only(sheet).tags).not.toBe("");
    expect(only(sheet).tags).toContain("720-740");
    expect(only(sheet).tags).not.toMatch(/^W\d+mm$/);
  });

  it("reads a diameter as a diameter", () => {
    const sheet = compose({ attributes: [dimension("DIA", "460"), dimension("H", "750")] });
    expect(only(sheet).tags).toContain("Dia.460");
  });

  it("carries the record's typed dimension note, in the same bracket the file writes", () => {
    // 0034. An estimator prices against the size, and "1250 L-shaped return"
    // is part of the size. One composer, so the number on this sheet and the
    // number in the BWS file cannot drift apart.
    const sheet = compose({
      records: [record({ dimensionNote: "1250 L-shaped return" })],
      attributes: [dimension("W", "660"), dimension("H", "680")],
    });
    expect(only(sheet).tags).toBe("W660 x H680mm (1250 L-shaped return)");
  });

  it("carries a note even where nothing has been measured yet", () => {
    // The note is then the only thing anybody has written down about the size,
    // and an estimator is exactly the reader who has to see it.
    const sheet = compose({ records: [record({ dimensionNote: "1250 L-shaped return" })] });
    expect(only(sheet).tags).toBe("(1250 L-shaped return)");
  });

  it("only takes rows that carry a slot, so a note is never priced as a size", () => {
    const arm = dimension("W", "520", { id: "arm", label: "ARM HEIGHT", attrGroup: "note", dimensionSlot: null });
    const sheet = compose({ attributes: [dimension("W", "660"), arm] });
    expect(dimensionTag([arm])).toBe("");
    expect(only(sheet).tags).toBe("W660mm");
  });
});

describe("the two document links", () => {
  const source = (over: Partial<CostingSource> = {}): CostingSource => ({
    runId: "run-1",
    filename: "S-200.pdf",
    page: 4,
    weight: 3,
    ...over,
  });

  it("orders by how much of the record each page accounts for", () => {
    const picked = pickSources([
      source({ runId: "run-2", filename: "finishes.pdf", page: 9, weight: 2 }),
      source({ weight: 11 }),
    ]);
    expect(picked.map((s) => s.filename)).toEqual(["S-200.pdf", "finishes.pdf"]);
  });

  it("breaks a tie on the lower page, so the order is stable between exports", () => {
    const picked = pickSources([source({ page: 12, weight: 4 }), source({ page: 3, weight: 4 })]);
    expect(picked[0]?.page).toBe(3);
  });

  it("takes at most two", () => {
    expect(pickSources([source(), source({ page: 5 }), source({ page: 6 })])).toHaveLength(2);
  });

  it("points at this app's own copy, at the page", () => {
    const link = sourceLink(ORIGIN, source());
    expect(link.href).toBe(`${ORIGIN}/api/imports/run-1/source#page=4`);
    expect(link.text).toBe("S-200.pdf p4");
  });

  it("drops the fragment where the page is unknown", () => {
    const link = sourceLink(ORIGIN, source({ page: null }));
    expect(link.href).toBe(`${ORIGIN}/api/imports/run-1/source`);
    expect(link.text).toBe("S-200.pdf");
  });

  it("leaves both blank for a hand-typed spec, which has no page", () => {
    const sheet = compose();
    expect(only(sheet).specs).toBeNull();
    expect(only(sheet).specs2).toBeNull();
    expect(sheet.notes.join(" ")).toContain("no document link");
  });

  it("fills the second only when a second distinct page exists", () => {
    const one = compose({}, { sourcesByRecord: new Map([["rec-1", [source()]]]) });
    expect(only(one).specs?.text).toBe("S-200.pdf p4");
    expect(only(one).specs2).toBeNull();

    const two = compose(
      {},
      { sourcesByRecord: new Map([["rec-1", [source(), source({ runId: "run-2", filename: "f.pdf", page: 9, weight: 1 })]]]) },
    );
    expect(only(two).specs2?.text).toBe("f.pdf p9");
  });
});

describe("the quantity is never apportioned", () => {
  it("prints the bill line's own figure", () => {
    expect(only(compose()).qty).toBe("40");
  });

  it("leaves a configuration blank and says so, rather than dividing the bill", () => {
    const sheet = compose({ records: [record({ qty: null, variantLabel: "A" })] });
    expect(only(sheet).qty).toBe("");
    expect(sheet.notes.join(" ")).toContain("keeps its quantity on the bill line");
  });
});

describe("the item and its ref", () => {
  it("names a configuration, so two rows do not read as one item entered twice", () => {
    const sheet = compose({ records: [record({ variantLabel: "A" })] });
    expect(only(sheet).item).toBe("Armchair (A)");
  });

  it("joins every ref the record carries, the way the BWS file does", () => {
    const sheet = compose({ records: [record({ boqCodes: ["FU02", "SX02"] })] });
    expect(only(sheet).clientRef).toBe("FU02, SX02");
  });
});

describe("what the file admits about itself", () => {
  it("says it is the item block and not the sheet", () => {
    expect(compose().notes[0]).toContain("Columns A to J only");
  });

  it("owns the Tags decision as this repo's judgement", () => {
    expect(compose().notes.join(" ")).toContain("this repo's judgement");
  });

  it("says the links are the app's own copy, not SharePoint", () => {
    expect(compose().notes.join(" ")).toContain("not SharePoint");
  });
});

describe("the csv row", () => {
  it("keeps B empty and renders a link as its URL, because a csv holds neither", () => {
    const sheet = compose(
      { attributes: [dimension("W", "660")] },
      { sourcesByRecord: new Map([["rec-1", [{ runId: "run-1", filename: "d.pdf", page: 2, weight: 1 }]]]) },
    );
    const cells = costingRowCells(only(sheet));
    expect(cells[1]).toBe("");
    expect(cells[0]).toBe(`${ORIGIN}/api/imports/run-1/source#page=2`);
    // H is the picture column and a csv cannot carry one.
    expect(cells[7]).toBe("");
    expect(cells[9]).toBe("W660mm");
  });
});
