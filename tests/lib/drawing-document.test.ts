// Pure tier. The fixtures reproduce the SHAPE of the AP364 seating drawings —
// an item code per page, unitless dimension figures, paired swatch captions,
// client finish codes, a TBC marker — with invented codes and materials. No
// client document content is in this repo.
import { describe, it, expect } from "vitest";
import {
  resolveDrawingTargets,
  targetRecordIds,
  suggestUnit,
  suggestAttributeState,
  suggestSpecField,
  classifyGroup,
  drawingItemBlockers,
  stageDrawings,
  assertStagedDrawings,
  hasPendingObservations,
  type DrawingItem,
  type SpecFieldEntry,
} from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/spec-document";
import type { RawDrawingItem } from "@/lib/extraction-schema";

function record(overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: "rec-1",
    recordNo: 1,
    label: "P00001-001",
    itemDescription: "Sofa",
    categoryId: null,
    categoryName: null,
    refs: ["X-100"],
    boqCodes: ["X-100"],
    runId: "run-main",
    runName: "Main run",
    version: 1,
    ...overrides,
  };
}

// The 56-field register, reduced to the slots the suggester can claim.
const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-com2", jsonId: 2, name: "COM 2" },
  { id: "f-com3", jsonId: 14, name: "COM 3" },
  { id: "f-timber1", jsonId: 4, name: "Main timber finish" },
  { id: "f-timber2", jsonId: 31, name: "Timber Finish 2" },
  { id: "f-timber3", jsonId: 143, name: "Timber Finish 3" },
  { id: "f-metal1", jsonId: 5, name: "Main metal finish" },
  { id: "f-metal2", jsonId: 35, name: "Metal Finish 2" },
];

const rawItem = (overrides: Partial<RawDrawingItem> = {}): RawDrawingItem => ({
  itemCodeRaw: "X-100",
  itemNameRaw: "Sofa",
  page: 1,
  dimensions: [],
  materials: [],
  notesRaw: [],
  confidence: "high",
  ...overrides,
});

describe("resolveDrawingTargets", () => {
  it("fans one drawing out to the same code in every run", () => {
    // ONE drawing of X-100; three runs quote it at different quantities. Its
    // specs belong to all three.
    const records = [
      record({ id: "r-mur", runId: "run-mur", runName: "Mock-up run" }),
      record({ id: "r-main", runId: "run-main", runName: "Main run" }),
      record({ id: "r-ve", runId: "run-ve", runName: "VE run" }),
    ];
    const resolution = resolveDrawingTargets("X-100", records);
    expect(resolution.runs.map((run) => run.status)).toEqual(["matched", "matched", "matched"]);
    expect(new Set(resolution.suggested)).toEqual(new Set(["r-mur", "r-main", "r-ve"]));
  });

  it("keeps a run ambiguous when one run holds the code twice, without touching the others", () => {
    // The SX11A case: two lines of one bill sharing a code are two items.
    const records = [
      record({ id: "r-main-a", runId: "run-main", runName: "Main run" }),
      record({ id: "r-main-b", runId: "run-main", runName: "Main run" }),
      record({ id: "r-ve", runId: "run-ve", runName: "VE run" }),
    ];
    const resolution = resolveDrawingTargets("X-100", records);
    const main = resolution.runs.find((run) => run.runId === "run-main");
    const ve = resolution.runs.find((run) => run.runId === "run-ve");
    expect(main?.status).toBe("ambiguous");
    expect(main?.status === "ambiguous" && main.candidates).toHaveLength(2);
    expect(ve?.status).toBe("matched");
    // Nothing from the ambiguous run is suggested; the VE run still is.
    expect(resolution.suggested).toEqual(["r-ve"]);
  });

  it("matches a code written differently, and only against BOQ codes", () => {
    const records = [
      record({ id: "r-a", refs: ["X 100"], boqCodes: ["X 100"] }),
      // A design code that reads the same must not claim the drawing.
      record({ id: "r-b", runId: "run-ve", runName: "VE run", refs: ["X-100"], boqCodes: [] }),
    ];
    const resolution = resolveDrawingTargets("X-100", records);
    expect(resolution.suggested).toEqual(["r-a"]);
  });

  it("resolves to nothing when no record carries the code", () => {
    const resolution = resolveDrawingTargets("X-999", [record()]);
    expect(resolution.runs).toHaveLength(0);
    expect(resolution.suggested).toEqual([]);
  });
});

describe("targetRecordIds", () => {
  const item = (targets: DrawingItem["targets"]): DrawingItem => ({
    id: "i1", version: 1, page: 1, itemCodeRaw: "X-100", itemNameRaw: "Sofa",
    confidence: "high", targets, observations: [],
  });

  it("uses the live suggestion until the reviewer decides", () => {
    const resolution = resolveDrawingTargets("X-100", [record({ id: "r-1" })]);
    expect(targetRecordIds(item(null), resolution)).toEqual(["r-1"]);
  });

  it("honours an unticked run", () => {
    const resolution = resolveDrawingTargets("X-100", [
      record({ id: "r-1" }),
      record({ id: "r-2", runId: "run-ve", runName: "VE run" }),
    ]);
    expect(targetRecordIds(item({ ticked: ["r-1", "r-2"], unticked: ["r-2"] }), resolution)).toEqual(["r-1"]);
  });
});

describe("suggestUnit", () => {
  it("reads a page of small figures as centimetres", () => {
    expect(suggestUnit(["190", "79", "72"])).toEqual({ status: "confident", unit: "cm" });
  });

  it("reads a page of large figures as millimetres", () => {
    expect(suggestUnit(["550", "735", "480"])).toEqual({ status: "confident", unit: "mm" });
  });

  it("refuses to guess on a mixed page", () => {
    // A wrong unit reads as a real measurement and nothing questions it.
    expect(suggestUnit(["190", "735"])).toEqual({ status: "ambiguous" });
  });

  it("returns none when there are no figures", () => {
    expect(suggestUnit([null, ""])).toEqual({ status: "none" });
  });
});

describe("suggestAttributeState", () => {
  it("records a TBC marker as an observation, not as a blank", () => {
    expect(suggestAttributeState("TBC")).toEqual({ state: "tbc", value: "TBC", reason: null });
  });

  it("refuses to choose when a value is also marked TBC", () => {
    const result = suggestAttributeState("Dark tinted wood TBC");
    expect(result.state).toBeNull();
    expect(result.reason).toMatch(/Choose which this is/);
  });

  it("treats a labelled callout with no value as TBC", () => {
    expect(suggestAttributeState(null)).toMatchObject({ state: "tbc", value: null });
  });

  it("takes a real specification verbatim", () => {
    expect(suggestAttributeState("Yarn Tessarae YC04158 - 01")).toEqual({
      state: "confirmed",
      value: "Yarn Tessarae YC04158 - 01",
      reason: null,
    });
  });
});

describe("suggestSpecField", () => {
  it("puts the first fabric in COM 1 and the second in COM 2", () => {
    const taken = new Set<string>();
    const first = suggestSpecField({ attrGroup: "material", labelRaw: "FABRIC", valueRaw: "Yarn Tessarae" }, FIELDS, taken);
    expect(first).toBe("f-com1");
    taken.add(first!);
    const second = suggestSpecField({ attrGroup: "material", labelRaw: "FABRIC", valueRaw: "Tibor Blob" }, FIELDS, taken);
    expect(second).toBe("f-com2");
  });

  it("puts the first wood in Main timber finish and the second in Timber Finish 2", () => {
    const taken = new Set<string>();
    const first = suggestSpecField({ attrGroup: "finish", labelRaw: "SOFA FEET", valueRaw: "Dark tinted wood" }, FIELDS, taken);
    expect(first).toBe("f-timber1");
    taken.add(first!);
    expect(suggestSpecField({ attrGroup: "finish", labelRaw: "LEGS", valueRaw: "Ceruse oak" }, FIELDS, taken)).toBe("f-timber2");
  });

  it("gives a dimension no field — many compose into Dimensions", () => {
    expect(suggestSpecField({ attrGroup: "dimension", labelRaw: "Width", valueRaw: "190" }, FIELDS, new Set())).toBeNull();
  });

  it("gives an unrecognisable callout no field rather than a wrong one", () => {
    // A fabric written into Main timber finish reaches BWS looking correct.
    expect(suggestSpecField({ attrGroup: "other", labelRaw: "PIPING", valueRaw: "TBC" }, FIELDS, new Set())).toBeNull();
  });

  it("stops claiming once every slot of that kind is full", () => {
    const taken = new Set(["f-com1", "f-com2", "f-com3"]);
    expect(suggestSpecField({ attrGroup: "material", labelRaw: "FABRIC", valueRaw: "A fourth" }, FIELDS, taken)).toBeNull();
  });
});

describe("classifyGroup", () => {
  it("separates fabric from finish from hardware", () => {
    expect(classifyGroup("FABRIC", "Yarn Tessarae")).toBe("material");
    expect(classifyGroup("SOFA FEET", "Dark tinted wood")).toBe("finish");
    expect(classifyGroup("Runners", "Soft close")).toBe("hardware");
    expect(classifyGroup("PIPING", "TBC")).toBe("other");
  });
});

describe("stageDrawings", () => {
  const item = rawItem({
    dimensions: [
      { labelRaw: "Width", valueRaw: "190" },
      { labelRaw: "Depth", valueRaw: "79" },
      { labelRaw: "Height", valueRaw: "72" },
    ],
    materials: [
      { labelRaw: "SOFA", valueRaw: "Yarn Tessarae YC04158 - 01", materialCodeRaw: null },
      { labelRaw: "SOFA FEET", valueRaw: "Dark tinted wood", materialCodeRaw: "WD-01" },
    ],
    notesRaw: ["PIPING TBC"],
  });

  it("stages every observation with its own id and version", () => {
    const staged = stageDrawings([item], FIELDS, "drawings.pdf", null);
    const observations = staged.items[0]!.observations;
    expect(observations).toHaveLength(6);
    expect(new Set(observations.map((o) => o.id)).size).toBe(6);
    expect(observations.every((o) => o.version === 1 && o.reviewStatus === "pending")).toBe(true);
  });

  it("suggests centimetres on a small-figure page and says it guessed", () => {
    const staged = stageDrawings([item], FIELDS, null, null);
    const dimensions = staged.items[0]!.observations.filter((o) => o.attrGroup === "dimension");
    expect(dimensions.every((o) => o.unit === "cm" && o.unitSuggested)).toBe(true);
  });

  it("leaves the unit blank on a mixed-figure page", () => {
    const mixed = rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "735" }] });
    const staged = stageDrawings([mixed], FIELDS, null, null);
    expect(staged.items[0]!.observations.every((o) => o.unit === null && !o.unitSuggested)).toBe(true);
  });

  it("keeps the client's own finish code", () => {
    const staged = stageDrawings([item], FIELDS, null, null);
    const feet = staged.items[0]!.observations.find((o) => o.labelRaw === "SOFA FEET");
    expect(feet?.materialCodeRaw).toBe("WD-01");
  });

  it("keeps two callouts that share a label, in different slots", () => {
    // The case spec_answers could not hold: one page, two FABRIC captions.
    const twoFabrics = rawItem({
      materials: [
        { labelRaw: "FABRIC", valueRaw: "Seat: Yarn Tessarae", materialCodeRaw: null },
        { labelRaw: "FABRIC", valueRaw: "Back: Tibor Blob", materialCodeRaw: null },
      ],
    });
    const staged = stageDrawings([twoFabrics], FIELDS, null, null);
    const fabrics = staged.items[0]!.observations.filter((o) => o.labelRaw === "FABRIC");
    expect(fabrics).toHaveLength(2);
    expect(fabrics.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com2"]);
  });
});

describe("drawingItemBlockers", () => {
  const staged = (raw: RawDrawingItem) => stageDrawings([raw], FIELDS, null, null).items[0]!;

  it("blocks a card whose code resolves to no record, and says why", () => {
    const item = staged(rawItem());
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-999", [record()]), new Map());
    expect(blockers[0]?.code).toBe("no_targets");
    expect(blockers[0]?.message).toMatch(/Confirm the BOQ/);
  });

  it("blocks an ambiguous run by name", () => {
    const records = [
      record({ id: "r-a", runId: "run-main", runName: "Main run" }),
      record({ id: "r-b", runId: "run-main", runName: "Main run" }),
    ];
    const blockers = drawingItemBlockers(staged(rawItem()), resolveDrawingTargets("X-100", records), new Map());
    expect(blockers.some((b) => b.code === "ambiguous_run" && b.message.includes("Main run"))).toBe(true);
  });

  it("blocks a dimension with no unit", () => {
    const item = staged(rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "735" }] }));
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), new Map());
    expect(blockers.filter((b) => b.code === "unit_missing")).toHaveLength(2);
  });

  it("blocks a value the drawing both states and marks TBC", () => {
    const item = staged(rawItem({ materials: [{ labelRaw: "WOOD", valueRaw: "Dark tinted wood TBC", materialCodeRaw: null }] }));
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), new Map());
    expect(blockers.some((b) => b.code === "no_state")).toBe(true);
  });

  it("blocks a BWS field that already has a value on a target record", () => {
    const item = staged(rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Yarn Tessarae", materialCodeRaw: null }] }));
    const occupied = new Map([["rec-1", new Set(["f-com1"])]]);
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), occupied);
    expect(blockers.some((b) => b.code === "slot_taken")).toBe(true);
  });

  it("passes a clean card", () => {
    const item = staged(
      rawItem({
        dimensions: [{ labelRaw: "W", valueRaw: "190" }],
        materials: [{ labelRaw: "SOFA", valueRaw: "Yarn Tessarae", materialCodeRaw: null }],
      }),
    );
    expect(drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), new Map())).toEqual([]);
  });
});

describe("assertStagedDrawings", () => {
  it("refuses a run staged as something else", () => {
    expect(() => assertStagedDrawings({ schemaVersion: 1, lines: [] })).toThrow(/not staged as shop drawings/);
  });

  it("reports whether anything is still pending", () => {
    const doc = stageDrawings([rawItem({ notesRaw: ["A note"] })], FIELDS, null, null);
    expect(hasPendingObservations(doc)).toBe(true);
    doc.items[0]!.observations[0]!.reviewStatus = "applied";
    expect(hasPendingObservations(doc)).toBe(false);
  });
});
