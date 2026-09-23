// A bill's OWN specification read resolves by the bill's rows (plan any-bill,
// Step 8). Pure: the registers and the bill's row → record map are fixtures,
// every code invented (`ZZ-`).
import { describe, expect, it } from "vitest";
import { billRowTarget, billRunIdOf, billSpecsRequestId, buildBillRowIndex } from "@/lib/bill-rows";
import {
  proposalBlockers,
  rematchProposals,
  resolveProposals,
  type AttributeEntry,
  type RecordEntry,
  type Registers,
} from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

let counter = 0;
const ids = () => `p${++counter}`;
const SHEET = "SEATING";

function record(overrides: Partial<RecordEntry>): RecordEntry {
  return {
    id: "rec",
    recordNo: 1,
    label: "P90000-001",
    itemDescription: "Stool",
    categoryId: "cat-seat",
    categoryName: "Seating",
    refs: [],
    boqCodes: [],
    runId: "run-1",
    runName: "MAIN",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

const stool = record({ id: "rec-stool", label: "P90000-001", refs: ["ZZ-FUR-10"], boqCodes: ["ZZ-FUR-10"] });
const drawers = record({ id: "rec-drawers", label: "P90000-002", refs: ["ZZ-FUR-26"], boqCodes: ["ZZ-FUR-26"], categoryId: null, itemDescription: "Drawers" });
const sofa = record({ id: "rec-sofa", label: "P90000-003", refs: ["ZZ-FUR-03"], boqCodes: ["ZZ-FUR-03"], itemDescription: "Sofa" });
// The same code on another phase: a ref matcher would fan out to it.
const sofaVe = record({ id: "rec-sofa-ve", label: "P90000-010", refs: ["ZZ-FUR-03"], boqCodes: ["ZZ-FUR-03"], runId: "run-2", runName: "VE" });

/** Rows 2..6 of one sheet: stool, its fabric line, drawers, sofa, its fabric line. */
const billRows = buildBillRowIndex(
  "bill-1",
  [
    {
      sheetName: SHEET,
      headerRow: 1,
      headerRows: 1,
      lines: [
        { lineNo: 2, code: "ZZ-FUR-10" },
        { lineNo: 3, code: "ZZ-FAB-13 (ZZ-FUR-10)", rowKind: "finish_for", finishFor: { row: 2 } },
        { lineNo: 4, code: "ZZ-FUR-26" },
        { lineNo: 5, code: "ZZ-FUR-03" },
        { lineNo: 6, code: "N/A", rowKind: "finish_for", finishFor: { row: 5 } },
        { lineNo: 7, code: "ZZ-FUR-99", ignored: true },
      ],
    },
  ],
  (_sheet, lineNo) => ({ 2: "rec-stool", 4: "rec-drawers", 5: "rec-sofa" })[lineNo] ?? null,
);

const specFields = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-tim1", jsonId: 4, name: "Main timber finish" },
  { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
];

function registers(overrides: Partial<Registers> = {}): Registers {
  return {
    records: [stool, drawers, sofa, sofaVe],
    requirements: [],
    answers: [],
    attributes: [],
    specFields,
    billRows,
    ...overrides,
  };
}

function observation(overrides: Partial<RawProposal>): RawProposal {
  return {
    refRaw: null,
    attributeRaw: "Item Description",
    valueRaw: "Stool",
    page: null,
    sourceSheet: SHEET,
    sourceRow: 2,
    confidence: "high",
    note: null,
    ...overrides,
  };
}

describe("the bill's row → record map", () => {
  it("maps an item's row to its record and a fabric line to its ITEM's record", () => {
    expect(billRowTarget(billRows, SHEET, 2)?.target).toEqual({ recordId: "rec-stool", codeRaw: "ZZ-FUR-10", itemRow: null });
    expect(billRowTarget(billRows, SHEET, 3)?.target).toEqual({ recordId: "rec-stool", codeRaw: "ZZ-FAB-13 (ZZ-FUR-10)", itemRow: 2 });
    expect(billRowTarget(billRows, SHEET, 7)).toBeNull(); // ignored: no record
    expect(billRowTarget(billRows, " seating ", 4)?.target.recordId).toBe("rec-drawers");
    expect(billRowTarget(billRows, "OTHER", 2)).toBeNull();
    expect(billRows.sheets[0]?.headerRows).toEqual([1]);
  });

  it("places a row with no sheet only where one sheet holds it", () => {
    const two = buildBillRowIndex(
      "bill-2",
      [
        { sheetName: "A", lines: [{ lineNo: 2, code: "X-1" }] },
        { sheetName: "B", lines: [{ lineNo: 2, code: "X-2" }, { lineNo: 3, code: "X-3" }] },
      ],
      (sheet, lineNo) => `${sheet}${lineNo}`,
    );
    expect(billRowTarget(two, null, 2)).toBeNull();
    expect(billRowTarget(two, null, 3)?.target.recordId).toBe("B3");
  });

  it("recognises a bill's own read by its registration id", () => {
    expect(billSpecsRequestId("abc")).toBe("boq-specs:abc");
    expect(billRunIdOf("boq-specs:abc")).toBe("abc");
    expect(billRunIdOf("email:<x@y>")).toBeNull();
    expect(billRunIdOf(null)).toBeNull();
  });
});

describe("resolveProposals — by the bill's row", () => {
  it("places by row where the ref the model copied names no record", () => {
    // The fabric line's printed code, and N/A: the ref matcher finds nothing.
    const [fabric] = resolveProposals([observation({ sourceRow: 3, refRaw: "ZZ-FAB-13 (ZZ-FUR-10)", attributeRaw: "Color Ref", valueRaw: "Example 0012" })], registers(), ids);
    expect(fabric).toMatchObject({ recordId: "rec-stool", rowMatch: { sheet: SHEET, row: 3, itemRow: 2 } });
    const [na] = resolveProposals([observation({ sourceRow: 6, refRaw: "N/A", attributeRaw: "Color Ref", valueRaw: "Example" })], registers(), ids);
    expect(na?.recordId).toBe("rec-sofa");
  });

  it("does not fan a row out to the same code on another phase", () => {
    const lines = resolveProposals([observation({ sourceRow: 5, refRaw: "ZZ-FUR-03", attributeRaw: "Sizes (mm)", valueRaw: "W 2000 x D 900 x H 780" })], registers(), ids);
    expect(new Set(lines.map((line) => line.recordId))).toEqual(new Set(["rec-sofa"]));
    expect(lines.map((line) => line.dimension?.slot)).toEqual(["W", "D", "H"]);
    // Without the bill map, the same observation fans out to both phases.
    const byRef = resolveProposals([observation({ sourceRow: 5, refRaw: "ZZ-FUR-03", attributeRaw: "Sizes (mm)", valueRaw: "W 2000 x D 900 x H 780" })], registers({ billRows: null }), ids);
    expect(new Set(byRef.map((line) => line.recordId))).toEqual(new Set(["rec-sofa", "rec-sofa-ve"]));
  });

  it("flags a row whose readable ref names a DIFFERENT item, and picks neither", () => {
    const [line] = resolveProposals([observation({ sourceRow: 2, refRaw: "ZZ-FUR-26", attributeRaw: "Finish", valueRaw: "TIM-21" })], registers(), ids);
    expect(line?.recordId).toBeNull();
    expect(line?.recordCandidates.map((candidate) => candidate.id)).toEqual(["rec-stool", "rec-drawers"]);
    expect(line?.readingNote).toMatch(/Row 2 of “SEATING” is P90000-001 on the bill, but this names ZZ-FUR-26, which is P90000-002/);
  });

  it("keeps a row-placed record that has no category, and says what to do", () => {
    const [line] = resolveProposals([observation({ sourceRow: 4, refRaw: "ZZ-FUR-26", attributeRaw: "Model Ref", valueRaw: "Bespoke" })], registers(), ids);
    expect(line?.recordId).toBe("rec-drawers");
    expect(line?.readingNote).toMatch(/no category yet.*re-match \(free\)/);
    expect(proposalBlockers(line!, [line!]).map((blocker) => blocker.code)).toEqual(["unassigned"]);
  });

  it("never writes a fabric line's size to the item it sits under", () => {
    const [line] = resolveProposals([observation({ sourceRow: 3, attributeRaw: "Sizes", valueRaw: "W 140 x H 300 cm" })], registers(), ids);
    expect(line?.dimension ?? null).toBeNull();
    expect(line?.recordId).toBe("rec-stool");
    expect(line?.readingNote).toMatch(/fabric line under row 2/);
  });

  it("places the metric size line and keeps the imperial one, saying so", () => {
    const lines = resolveProposals(
      [
        observation({ sourceRow: 5, attributeRaw: "Sizes (ft-in)", valueRaw: 'W 80" x D 36" x H 31"' }),
        observation({ sourceRow: 5, attributeRaw: "Sizes (mm)", valueRaw: "W 2030 x D 915 x H 790" }),
        observation({ sourceRow: 2, attributeRaw: "Sizes (ft-in)", valueRaw: "W 1'6\" x D 1'6\" x H 1'5\"" }),
      ],
      registers(),
      ids,
    );
    const imperial = lines.filter((line) => line.sourceOrdinal === 0);
    expect(imperial).toHaveLength(1);
    expect(imperial[0]?.dimension ?? null).toBeNull();
    expect(imperial[0]?.readingNote).toMatch(/“Sizes \(mm\)” line is the one placed/);
    expect(lines.filter((line) => line.sourceOrdinal === 1).map((line) => line.dimension?.figure)).toEqual(["2030", "915", "790"]);
    // A feet-and-inches line on an item with no metric line: kept, and why.
    expect(lines.find((line) => line.sourceOrdinal === 2)?.readingNote).toMatch(/Feet and inches are not converted/);
  });

  it("places the plain-inch line where it is the only size the item has", () => {
    const lines = resolveProposals([observation({ sourceRow: 2, attributeRaw: "Sizes (ft-in)", valueRaw: 'W 18" x D 18" x SH 17"' })], registers(), ids);
    expect(lines.map((line) => [line.dimension?.slot, line.dimension?.unit])).toEqual([
      ["W", "in"],
      ["D", "in"],
      ["SH", "in"],
    ]);
  });

  it("puts a size line's kept note on its FIRST slot only", () => {
    const lines = resolveProposals([observation({ sourceRow: 2, attributeRaw: "Sizes(mm)", valueRaw: "L 520 x W 330 x H440" })], registers(), ids);
    expect(lines.map((line) => line.dimension?.qualifier ?? null)).toEqual(["L 520", null]);
  });

  it("reads a value naming several codes as one finish each, the stone placed nowhere", () => {
    const lines = resolveProposals([observation({ sourceRow: 5, attributeRaw: "Finish", valueRaw: "STN-07, MTL-02, TIM-21" })], registers(), ids);
    expect(lines.map((line) => [line.finish?.codeRaw, line.finish?.specFieldName ?? null, line.proposedValue])).toEqual([
      ["STN-07", null, "STN-07"],
      ["MTL-02", "Main metal finish", "MTL-02"],
      ["TIM-21", "Main timber finish", "TIM-21"],
    ]);
    expect(lines[0]?.finish?.noField).toMatch(/stone code/);
    expect(new Set(lines.map((line) => line.id)).size).toBe(3);
  });

  it("keeps Fabric: COM as a note, and it claims no COM slot", () => {
    const lines = resolveProposals(
      [
        observation({ sourceRow: 2, attributeRaw: "Fabric", valueRaw: "COM" }),
        observation({ sourceRow: 2, attributeRaw: "COM", valueRaw: "FAB-31" }),
      ],
      registers(),
      ids,
    );
    expect(lines[0]?.finish).toMatchObject({ group: "note", specFieldId: null });
    // The real fabric code still gets COM 1: the note took nothing.
    expect(lines[1]?.finish?.specFieldName).toBe("COM 1");
  });

  it("aims a code the item already holds at its field, not the next free one", () => {
    const held: AttributeEntry = {
      id: "attr-com1",
      recordId: "rec-stool",
      attrGroup: "material",
      slot: null,
      specFieldId: "f-com1",
      label: "Fabric",
      value: "Fabric @ Stool Example weave",
      unit: null,
      state: "confirmed",
      version: 1,
      materialCode: "FAB-13",
    };
    const regs = registers({ attributes: [held] });
    const [exact] = resolveProposals([observation({ attributeRaw: "COM", valueRaw: "FAB-13" })], regs, ids);
    expect(exact?.finish?.specFieldName).toBe("COM 1");
    expect(exact?.attributeTarget?.attributeId).toBe("attr-com1");
    expect(exact?.readingNote).toMatch(/already holds FAB-13 in COM 1/);
    // Under the bill's zone, the same code — aimed there, and asked about.
    const [zoned] = resolveProposals([observation({ attributeRaw: "COM", valueRaw: "ZZ-FAB-13" })], regs, ids);
    expect(zoned?.finish?.specFieldName).toBe("COM 1");
    expect(zoned?.readingNote).toMatch(/reads as the same code under the bill's own zone/);
    expect(proposalBlockers(zoned!, [zoned!]).map((blocker) => blocker.code)).toContain("replace");
    // A DIFFERENT fabric code still takes the next free slot.
    const [other] = resolveProposals([observation({ attributeRaw: "COM", valueRaw: "FAB-40" })], regs, ids);
    expect(other?.finish?.specFieldName).toBe("COM 2");
  });
});

describe("rematchProposals — a bill read before rows resolved", () => {
  it("re-matches by row for free, and a second pass changes nothing", () => {
    const raw = [
      observation({ sourceRow: 3, refRaw: "ZZ-FAB-13 (ZZ-FUR-10)", attributeRaw: "Color Ref", valueRaw: "Example 0012" }),
      observation({ sourceRow: 5, refRaw: "ZZ-FUR-03", attributeRaw: "Sizes (mm)", valueRaw: "W 2000 x D 900 x H 780" }),
      observation({ sourceRow: 2, refRaw: "ZZ-FUR-10", attributeRaw: "Finish", valueRaw: "TIM-21" }),
    ];
    // Staged the way the first read left it: resolved by ref alone.
    const before = resolveProposals(raw, registers({ billRows: null }), ids);
    expect(before.find((line) => line.sourceOrdinal === 0)?.recordId).toBeNull();
    const staged = { schemaVersion: 1, lines: before, documentNotes: null, filename: null };

    const first = rematchProposals(staged, registers(), ids);
    expect(first.rematched).toBe(2); // the fabric line, and the sofa size no longer fanning out
    expect(first.lines.find((line) => line.sourceOrdinal === 0)?.recordId).toBe("rec-stool");
    expect(new Set(first.lines.filter((line) => line.sourceOrdinal === 1).map((line) => line.recordId))).toEqual(new Set(["rec-sofa"]));
    expect(new Set(first.lines.map((line) => line.id)).size).toBe(first.lines.length);

    const second = rematchProposals({ ...staged, lines: first.lines }, registers(), ids);
    expect(second.rematched).toBe(0);
    expect(second.lines).toEqual(first.lines);
  });
});
