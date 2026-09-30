// Pure tier. Two readings a drawing needs when its title block and its finish
// tags are written differently from the bill: an item code that is the END of
// a bill code (`ZQ-08` on the page, `LV-ZQ-08` on the bill), and a finish tag
// drawn as three stacked boxes (`LV FAB 04` for `LV-FAB-04`). The shapes are the
// Aman drawings'; every code, name and file here is invented.
import { describe, it, expect } from "vitest";
import {
  alreadyRecorded,
  assertStagedDrawings,
  classifyCallout,
  drawingItemBlockers,
  drawingNumberOf,
  resolveDrawingTargets,
  resolveStagedItem,
  targetRecordIds,
  type OccupiedSlots,
  type SpecFieldEntry,
} from "@/lib/drawing-document";
import { endsOnSegment, namesOnSegments, type RecordEntry } from "@/lib/record-refs";
import { projectCodeKind, stackedTagCode } from "@/lib/material-words";

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

function record(code: string, overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: `rec-${code}`,
    recordNo: 1,
    label: "P00001-001",
    itemDescription: "Bedframe",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId: "run-main",
    runName: "Main",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

// The bill's shape: one code per floor, and a sister line with a letter.
const BILL = [record("LV-ZQ-08"), record("LV-ZQ-08A"), record("UP-ZQ-08"), record("LV-ZQ-03"), record("UP-ZQ-03B")];

const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-timber1", jsonId: 4, name: "Main timber finish" },
  { id: "f-metal1", jsonId: 5, name: "Main metal finish" },
];

describe("endsOnSegment / namesOnSegments", () => {
  it("reads an ending only where a printed segment of the longer code begins", () => {
    expect(endsOnSegment("LV-ZQ-08", "ZQ-08")).toBe(true);
    expect(endsOnSegment("UP-ZQ-03B", "ZQ-03 B")).toBe(true);
    expect(endsOnSegment("LV-ZQ-08A", "ZQ-08")).toBe(false);
    expect(endsOnSegment("LVZQ-08", "ZQ-08")).toBe(false);
  });

  it("is never the whole code, and never a code with no letter or no digit", () => {
    expect(endsOnSegment("ZQ-08", "ZQ-08")).toBe(false);
    expect(endsOnSegment("LV-ZQ-08", "08")).toBe(false);
    expect(endsOnSegment("LV-ZQ-AB", "ZQ-AB")).toBe(false);
  });

  it("names a code only whole, on its own boundaries", () => {
    expect(namesOnSegments("AB-CD-UP-ZQ-08 Bed frame", "UP-ZQ-08")).toBe(true);
    expect(namesOnSegments("AB-CD-UP-ZQ-08 Bed frame", "LV-ZQ-08")).toBe(false);
    expect(namesOnSegments("AB-CD-UP-ZQ-08A", "UP-ZQ-08")).toBe(false);
  });
});

describe("resolveDrawingTargets — a code read off the end of a bill code", () => {
  it("never reads an ending when the page's code matches a record exactly", () => {
    // The trap: a bill that really does list ZQ-08 must not be out-voted by
    // LV-ZQ-08 on the strength of an ending.
    const resolution = resolveDrawingTargets("ZQ-08", [...BILL, record("ZQ-08")], {
      drawingNumber: "AB-CD-LV-ZQ-08",
    });
    expect(resolution.suggested).toEqual(["rec-ZQ-08"]);
    expect(resolution.matchedBy).toBeUndefined();
  });

  it("never reads an ending when ANOTHER code the document gave the item matches exactly", () => {
    const resolution = resolveDrawingTargets("ZQ-08", [...BILL, record("MUR.8 BED")], { codes: ["ZQ-08", "MUR.8 BED"] });
    expect(resolution.runs).toEqual([]);
    expect(resolution.matchedBy).toBeUndefined();
  });

  it("resolves the one bill code the page's code ends, and says so", () => {
    const resolution = resolveDrawingTargets("ZQ-03 B", BILL);
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-03B"]);
    expect(resolution.matchedBy?.code).toBe("UP-ZQ-03B");
    expect(resolution.matchedBy?.message).toBe(
      "Matched UP-ZQ-03B: the page names ZQ-03 B, and UP-ZQ-03B is the only bill code ending with it.",
    );
  });

  it("takes the one of several that the drawing number names whole", () => {
    const resolution = resolveDrawingTargets("ZQ-08", BILL, { drawingNumber: "AB-CD-UP-ZQ-08 Bed frame" });
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-08"]);
    expect(resolution.matchedBy).toMatchObject({ code: "UP-ZQ-08", candidates: ["LV-ZQ-08", "UP-ZQ-08"] });
    expect(resolution.matchedBy?.message).toBe(
      "Matched UP-ZQ-08: the page names ZQ-08, and the drawing number AB-CD-UP-ZQ-08 names UP-ZQ-08.",
    );
  });

  it("picks NOTHING among several when the document names none of them, and offers them all", () => {
    for (const drawingNumber of [null, "Bed frame schedule", "AB-CD-LV-ZQ-08 and UP-ZQ-08"]) {
      const resolution = resolveDrawingTargets("ZQ-08", BILL, { drawingNumber });
      expect(resolution.suggested).toEqual([]);
      expect(resolution.matchedBy?.code).toBeNull();
      expect(resolution.runs).toHaveLength(1);
      const run = resolution.runs[0]!;
      expect(run.status).toBe("ambiguous");
      expect(run.status === "ambiguous" && run.candidates.map((c) => c.id).sort()).toEqual([
        "rec-LV-ZQ-08",
        "rec-UP-ZQ-08",
      ]);
    }
  });

  it("keeps a phase holding ONE of several candidates ambiguous: the choice between codes is not made", () => {
    const split = [record("LV-ZQ-08", { runId: "run-a", runName: "A" }), record("UP-ZQ-08", { runId: "run-b", runName: "B" })];
    const resolution = resolveDrawingTargets("ZQ-08", split);
    expect(resolution.suggested).toEqual([]);
    expect(resolution.runs.map((run) => run.status)).toEqual(["ambiguous", "ambiguous"]);
    const blockers = drawingItemBlockers(
      { id: "i", version: 1, page: 1, itemCodeRaw: "ZQ-08", itemNameRaw: null, confidence: "high", targets: null, observations: [] },
      resolution,
      NO_OCCUPANCY,
    );
    expect(blockers.filter((b) => b.code === "ambiguous_run").map((b) => b.message)[0]).toMatch(
      /^A: The page names ZQ-08, which is the end of 2 bill codes \(LV-ZQ-08, UP-ZQ-08\)/,
    );
  });

  it("fans the settled code out one record per phase, and keeps two in one phase ambiguous", () => {
    const records = [
      record("UP-ZQ-03B", { id: "r-mur", runId: "run-mur", runName: "Mock-up" }),
      record("UP-ZQ-03B", { id: "r-main-1", runId: "run-main", runName: "Main" }),
      record("UP-ZQ-03B", { id: "r-main-2", runId: "run-main", runName: "Main" }),
    ];
    const resolution = resolveDrawingTargets("ZQ-03B", records);
    expect(resolution.suggested).toEqual(["r-mur"]);
    expect(resolution.runs.find((run) => run.runId === "run-main")?.status).toBe("ambiguous");
  });

  it("lets a reviewer's pick stand, and suggests nothing a later read could call new", () => {
    // The confirm's targets_changed guard reads `suggested` against what the
    // reviewer decided: with nothing suggested, a pick is the whole decision.
    const resolution = resolveDrawingTargets("ZQ-08", BILL);
    const item = { targets: { ticked: ["rec-UP-ZQ-08"], unticked: [] } } as Parameters<typeof targetRecordIds>[0];
    expect(targetRecordIds(item, resolution)).toEqual(["rec-UP-ZQ-08"]);
    expect(resolution.suggested).toEqual([]);
  });
});

describe("a finish tag drawn as stacked boxes", () => {
  it("reads exactly three groups separated by whitespace, and nothing else", () => {
    expect(stackedTagCode("LV FAB 04")).toBe("LV-FAB-04");
    expect(stackedTagCode(" up  tim\n03a ")).toBe("UP-TIM-03A");
    expect(stackedTagCode("LV-FAB-04")).toBeNull();
    expect(stackedTagCode("LV FAB 04 walnut")).toBeNull();
    expect(stackedTagCode("FAB 04")).toBeNull();
    expect(stackedTagCode("CH 01 2")).toBeNull();
  });

  it("reads a three-part code's kind from its middle group, through the known prefixes only", () => {
    expect(projectCodeKind("LV-FAB-04")).toBe("fabric");
    expect(projectCodeKind("LV-TIM-03")).toBe("timber");
    expect(projectCodeKind("UP-MTL-01")).toBe("metal");
    expect(projectCodeKind("LV-STN-04")).toBeNull();
    expect(projectCodeKind("LV-CH-01")).toBeNull();
    expect(projectCodeKind("LV FAB 04")).toBeNull();
  });

  it("classifies the hyphenated code, and leaves a code the prefix test read as it was", () => {
    expect(classifyCallout({ labelRaw: "Material 1", valueRaw: "LV FAB 04", materialCodeRaw: "LV-FAB-04" })).toMatchObject({
      kind: "fabric",
      group: "material",
      guessed: false,
    });
    expect(classifyCallout({ labelRaw: "Material 2", valueRaw: "x", materialCodeRaw: "LV-TIM-03" }).kind).toBe("timber");
    // MT is a prefix; the prefix test still decides a code it already read.
    expect(classifyCallout({ labelRaw: "Tag", valueRaw: "x", materialCodeRaw: "MT-FAB-01" }).kind).toBe("metal");
  });
});

// ---- read time, over a run shaped like the two Aman drawings ----------------

const miamiShapedRun = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  kind: "shop_drawings",
  filename: "AB-CD-UP-ZQ-08 Bed frame.pdf",
  documentNotes: null,
  codeGroups: [],
  items: [
    {
      id: "item-1",
      version: 1,
      page: 1,
      itemCodeRaw: "ZQ-08",
      itemNameRaw: "BEDFRAME (MUR)",
      confidence: "high",
      targets: null,
      observations: [
        {
          id: "obs-fab",
          version: 1,
          attrGroup: "other",
          labelRaw: "Material 1",
          valueRaw: "LV FAB 04",
          materialCodeRaw: "LV FAB 04",
          value: "LV FAB 04",
          unit: null,
          unitSuggested: false,
          specFieldId: null,
          state: "confirmed",
          stateReason: null,
          reviewStatus: "pending",
          reviewedAt: null,
          reviewedBy: null,
          applied: null,
          ...overrides,
        },
        {
          id: "obs-tim",
          version: 1,
          attrGroup: "other",
          labelRaw: "Material 2",
          valueRaw: "LV TIM 03",
          // The code the reader extracted is null here: the VALUE is the tag.
          materialCodeRaw: null,
          value: "LV TIM 03",
          unit: null,
          unitSuggested: false,
          specFieldId: null,
          state: "confirmed",
          stateReason: null,
          reviewStatus: "pending",
          reviewedAt: null,
          reviewedBy: null,
          applied: null,
        },
      ],
    },
  ],
});

describe("read time, a run staged before either reading existed", () => {
  it("reads both tags as their codes, files them, and keeps the drawing's words", () => {
    const [fabric, timber] = assertStagedDrawings(miamiShapedRun(), FIELDS).items[0]!.observations;
    expect(fabric).toMatchObject({
      materialCodeRaw: "LV-FAB-04",
      attrGroup: "material",
      specFieldId: "f-com1",
      value: "LV FAB 04",
      valueRaw: "LV FAB 04",
    });
    expect(timber).toMatchObject({
      materialCodeRaw: "LV-TIM-03",
      attrGroup: "finish",
      specFieldId: "f-timber1",
      value: "LV TIM 03",
    });
  });

  it("leaves a row a person has edited as they left it", () => {
    const fabric = assertStagedDrawings(miamiShapedRun({ version: 2 }), FIELDS).items[0]!.observations[0]!;
    expect(fabric).toMatchObject({ materialCodeRaw: "LV FAB 04", attrGroup: "other", specFieldId: null });
  });

  it("reads the same on a second pass", () => {
    const once = assertStagedDrawings(miamiShapedRun(), FIELDS);
    expect(assertStagedDrawings(once, FIELDS)).toEqual(once);
  });

  it("is the SAME cloth the bill already filed on COM 1, not a second one", () => {
    const fabric = assertStagedDrawings(miamiShapedRun(), FIELDS).items[0]!.observations[0]!;
    expect(
      alreadyRecorded(fabric, { value: "Fabric @ Headboard, an invented cloth", unit: null, state: "confirmed", materialCode: "LV-FAB-04" }),
    ).toBe(true);
  });

  it("lands the card on the bill line its drawing number names", () => {
    const staged = assertStagedDrawings(miamiShapedRun(), FIELDS);
    expect(drawingNumberOf(staged.filename)).toBe("AB-CD-UP-ZQ-08 Bed frame");
    const resolution = resolveStagedItem(staged, staged.items[0]!, BILL);
    expect(resolution.suggested).toEqual(["rec-UP-ZQ-08"]);
    expect(resolution.matchedBy?.message).toBe(
      "Matched UP-ZQ-08: the page names ZQ-08, and the drawing number AB-CD-UP-ZQ-08 names UP-ZQ-08.",
    );
  });
});

describe("alreadyRecorded — a converted figure and the bill's millimetres", () => {
  it("reads 6'-4\" and 1930mm as the same width, and 6'-5\" as a different one", () => {
    const base = { attrGroup: "dimension" as const, dimensionSlot: "W" as const, valueRaw: null, state: "confirmed" as const };
    const occupant = { value: "1930", unit: "mm", state: "confirmed" };
    expect(alreadyRecorded({ ...base, value: "6'-4\"", unit: "in" }, occupant)).toBe(true);
    expect(alreadyRecorded({ ...base, value: "6'-5\"", unit: "in" }, occupant)).toBe(false);
  });
});
