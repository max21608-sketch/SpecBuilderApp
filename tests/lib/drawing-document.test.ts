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
  drawingItemWarnings,
  duplicateTargets,
  repeatedObservations,
  implausibleDimension,
  resolveDimensionUnit,
  splitFigureAndUnit,
  unitSourceOf,
  stageDrawings,
  assertStagedDrawings,
  hasPendingObservations,
  type DrawingItem,
  type OccupiedSlots,
  type PackCard,
  type SpecFieldEntry,
} from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/spec-document";
import type { RawDrawingItem } from "@/lib/extraction-schema";

/** A project where nothing is spoken for yet. */
const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

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
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-999", [record()]), NO_OCCUPANCY);
    expect(blockers[0]?.code).toBe("no_targets");
    expect(blockers[0]?.message).toMatch(/Confirm the BOQ/);
  });

  it("blocks an ambiguous run by name", () => {
    const records = [
      record({ id: "r-a", runId: "run-main", runName: "Main run" }),
      record({ id: "r-b", runId: "run-main", runName: "Main run" }),
    ];
    const blockers = drawingItemBlockers(staged(rawItem()), resolveDrawingTargets("X-100", records), NO_OCCUPANCY);
    expect(blockers.some((b) => b.code === "ambiguous_run" && b.message.includes("Main run"))).toBe(true);
  });

  it("blocks a dimension with no unit", () => {
    const item = staged(rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "735" }] }));
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), NO_OCCUPANCY);
    expect(blockers.filter((b) => b.code === "unit_missing")).toHaveLength(2);
  });

  it("blocks a value the drawing both states and marks TBC", () => {
    const item = staged(rawItem({ materials: [{ labelRaw: "WOOD", valueRaw: "Dark tinted wood TBC", materialCodeRaw: null }] }));
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), NO_OCCUPANCY);
    expect(blockers.some((b) => b.code === "no_state")).toBe(true);
  });

  it("blocks a BWS field that already has a value on a target record", () => {
    const item = staged(rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Yarn Tessarae", materialCodeRaw: null }] }));
    const occupied = { fields: new Map([["rec-1", new Set(["f-com1"])]]), dimensions: new Map() };
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
    expect(drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), NO_OCCUPANCY)).toEqual([]);
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

// ============================================================================
// UNITS: printed, guessed, defaulted — and what happens when the answer is
// implausible. The Panther pack is why all of this exists: its shop-drawing set
// prints no unit anywhere, and the ten per-item specification sheets beside it
// print "WIDTH 1800mm".
// ============================================================================

describe("splitFigureAndUnit", () => {
  it("separates a figure from a unit printed against it", () => {
    expect(splitFigureAndUnit("1800mm")).toEqual({ value: "1800", unit: "mm" });
    expect(splitFigureAndUnit("120 mm")).toEqual({ value: "120", unit: "mm" });
    expect(splitFigureAndUnit("72cm")).toEqual({ value: "72", unit: "cm" });
  });

  it("accepts the spellings normaliseUnit knows", () => {
    expect(splitFigureAndUnit("1800MM")).toEqual({ value: "1800", unit: "mm" });
    expect(splitFigureAndUnit("180 centimetres")).toEqual({ value: "180", unit: "cm" });
    expect(splitFigureAndUnit('36"')).toEqual({ value: "36", unit: "in" });
  });

  it("leaves a value alone when the suffix is not a unit it knows", () => {
    // Truncating "1800off" to "1800" would invent a measurement.
    expect(splitFigureAndUnit("1800off")).toEqual({ value: "1800off", unit: null });
  });

  it("leaves anything that is not one figure alone", () => {
    // A composite or a sentence is for a human to read, not for this to take
    // apart. "190 x 79 x 72" is a real thing a drawing writes.
    expect(splitFigureAndUnit("190 x 79 x 72")).toEqual({ value: "190 x 79 x 72", unit: null });
    expect(splitFigureAndUnit("1800mm nominal")).toEqual({ value: "1800mm nominal", unit: null });
    expect(splitFigureAndUnit("TBC")).toEqual({ value: "TBC", unit: null });
    expect(splitFigureAndUnit(null)).toEqual({ value: null, unit: null });
  });
});

describe("resolveDimensionUnit", () => {
  const guess = { status: "confident", unit: "cm" } as const;

  it("puts a printed unit above everything else", () => {
    // The page said so. Neither a magnitude heuristic nor a project setting
    // gets to overrule a document that stated its own unit.
    expect(
      resolveDimensionUnit({ printed: "mm", pageGuess: guess, projectDefault: "m" }),
    ).toEqual({ unit: "mm", source: "printed" });
  });

  it("puts the page's own figures above the project default", () => {
    // A project is not more authoritative about a page than the page is.
    expect(
      resolveDimensionUnit({ printed: null, pageGuess: guess, projectDefault: "mm" }),
    ).toEqual({ unit: "cm", source: "figures" });
  });

  it("falls back to the project default only when the page offers nothing", () => {
    expect(
      resolveDimensionUnit({ printed: null, pageGuess: { status: "ambiguous" }, projectDefault: "cm" }),
    ).toEqual({ unit: "cm", source: "project_default" });
    expect(
      resolveDimensionUnit({ printed: null, pageGuess: { status: "none" }, projectDefault: "cm" }),
    ).toEqual({ unit: "cm", source: "project_default" });
  });

  it("gives nothing when the project has no default, exactly as before", () => {
    expect(
      resolveDimensionUnit({ printed: null, pageGuess: { status: "ambiguous" }, projectDefault: null }),
    ).toEqual({ unit: null, source: null });
  });
});

describe("implausibleDimension", () => {
  it("says nothing about furniture-sized measurements", () => {
    expect(implausibleDimension("190", "cm")).toBeNull();
    expect(implausibleDimension("1800", "mm")).toBeNull();
    expect(implausibleDimension("1.8", "m")).toBeNull();
    expect(implausibleDimension("36", "in")).toBeNull();
  });

  it("catches the 10x error a project default can introduce", () => {
    // 550 is a seat height in millimetres. Read as centimetres it is 5.5m.
    expect(implausibleDimension("550", "cm")).toMatch(/5\.5m/);
    // And the other way: 190cm read as millimetres is a 19cm sofa.
    expect(implausibleDimension("19", "mm")).toMatch(/19mm/);
  });

  it("says nothing when there is no unit to be wrong about", () => {
    // A blank unit is still the `unit_missing` BLOCKER's business, not this.
    expect(implausibleDimension("550", null)).toBeNull();
  });

  it("says nothing about a value it cannot reason about", () => {
    expect(implausibleDimension("TBC", "cm")).toBeNull();
    expect(implausibleDimension(null, "cm")).toBeNull();
  });
});

describe("stageDrawings units", () => {
  it("reads the unit a specification sheet prints, and strips it off the value", () => {
    // The shape of a Panther SPEC-346 sheet: figures with their unit printed.
    // If the unit stayed on the value, bws-export would render "1800mmmm".
    const sheet = rawItem({
      dimensions: [
        { labelRaw: "WIDTH", valueRaw: "1800", unitRaw: "mm" },
        { labelRaw: "HEIGHT", valueRaw: "1120", unitRaw: "mm" },
        { labelRaw: "DEPTH", valueRaw: "120mm" },
      ],
      materials: [],
      notesRaw: [],
    });
    const staged = stageDrawings([sheet], FIELDS, null, null);
    const dimensions = staged.items[0]!.observations.filter((o) => o.attrGroup === "dimension");
    expect(dimensions.map((o) => o.value)).toEqual(["1800", "1120", "120"]);
    expect(dimensions.every((o) => o.unit === "mm")).toBe(true);
    expect(dimensions.every((o) => o.unitSource === "printed")).toBe(true);
    // A printed unit is not a guess and must not be badged as one.
    expect(dimensions.every((o) => !o.unitSuggested)).toBe(true);
  });

  it("applies the project default on a page whose figures do not agree", () => {
    const mixed = rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "735" }] });
    const staged = stageDrawings([mixed], FIELDS, null, null, "cm");
    const dimensions = staged.items[0]!.observations;
    expect(dimensions.every((o) => o.unit === "cm" && o.unitSource === "project_default")).toBe(true);
    // Still flagged as not-from-the-page, so the screen can say where it came from.
    expect(dimensions.every((o) => o.unitSuggested)).toBe(true);
  });

  it("does not let a project default overrule the page", () => {
    const small = rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "72" }] });
    const staged = stageDrawings([small], FIELDS, null, null, "mm");
    expect(staged.items[0]!.observations.every((o) => o.unit === "cm" && o.unitSource === "figures")).toBe(true);
  });

  it("clears the blocker the project default exists to clear", () => {
    const mixed = rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "H", valueRaw: "735" }] });
    const resolution = resolveDrawingTargets("X-100", [record()]);

    const without = stageDrawings([mixed], FIELDS, null, null, null).items[0]!;
    expect(drawingItemBlockers(without, resolution, NO_OCCUPANCY).filter((b) => b.code === "unit_missing")).toHaveLength(2);

    const withDefault = stageDrawings([mixed], FIELDS, null, null, "cm").items[0]!;
    expect(drawingItemBlockers(withDefault, resolution, NO_OCCUPANCY).filter((b) => b.code === "unit_missing")).toHaveLength(0);
  });
});

describe("drawingItemWarnings", () => {
  it("flags a dimension the chosen unit makes implausible, without blocking it", () => {
    // 550 and 735 are millimetres. A project defaulted to centimetres fills
    // them in as 5.5m and 7.35m — plausible-looking numbers that are not.
    const page = rawItem({
      dimensions: [{ labelRaw: "Seat height", valueRaw: "550" }, { labelRaw: "W", valueRaw: "19" }],
    });
    const item = stageDrawings([page], FIELDS, null, null, "cm").items[0]!;
    const resolution = resolveDrawingTargets("X-100", [record()]);
    const idOf = (label: string) => item.observations.find((o) => o.labelRaw === label)!.id;

    // Only the one that is actually wrong. 19cm is 190mm — a small component,
    // but a real measurement — and warning about it too would make the flag
    // worth ignoring, which is the failure mode of every over-eager check.
    const warnings = drawingItemWarnings(item);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("unit_implausible");
    expect(warnings[0]!.observationId).toBe(idOf("Seat height"));
    expect(warnings[0]!.message).toMatch(/5\.5m/);

    // THE POINT: the card still commits. A warning that blocked would put the
    // reviewer back where the project default was meant to get them out of.
    expect(drawingItemBlockers(item, resolution, NO_OCCUPANCY)).toHaveLength(0);
  });

  it("says nothing about a page that reads sensibly", () => {
    const page = rawItem({ dimensions: [{ labelRaw: "W", valueRaw: "190" }, { labelRaw: "D", valueRaw: "79" }] });
    expect(drawingItemWarnings(stageDrawings([page], FIELDS, null, null).items[0]!)).toEqual([]);
  });
});

describe("unitSourceOf", () => {
  const base = { unit: "cm" as const, unitSuggested: false };

  it("reads the recorded source when there is one", () => {
    expect(unitSourceOf({ ...base, unitSource: "printed" })).toBe("printed");
    expect(unitSourceOf({ ...base, unitSource: "project_default" })).toBe("project_default");
  });

  it("falls back for rows staged before the source was tracked", () => {
    // `unitSuggested: true` meant exactly one thing then.
    expect(unitSourceOf({ unit: "cm", unitSuggested: true })).toBe("figures");
    // A unit with neither flag is one a human chose. No badge.
    expect(unitSourceOf({ unit: "cm", unitSuggested: false })).toBeNull();
  });

  it("has no source to report when there is no unit", () => {
    expect(unitSourceOf({ unit: null, unitSuggested: false })).toBeNull();
  });
});

describe("suggestAttributeState on the specification sheets' wording", () => {
  it("reads the other words for 'not decided yet' as TBC", () => {
    // The Panther sheets write PENDING for timber and TO BID for supplier
    // where the AP364 drawings write TBC. A blank supplier reads as "none";
    // a supplier of "TO BID" reads as the name of a company.
    expect(suggestAttributeState("PENDING")).toEqual({ state: "tbc", value: "PENDING", reason: null });
    expect(suggestAttributeState("TO BID")).toEqual({ state: "tbc", value: "TO BID", reason: null });
  });

  it("asks rather than guessing when the document names who will confirm", () => {
    // "Argenta to confirm" is not a value and is not plain TBC either — it
    // says WHO decides, which is worth keeping. So the reviewer is asked.
    const result = suggestAttributeState("Argenta to confirm");
    expect(result.state).toBeNull();
    expect(result.value).toBe("Argenta to confirm");
    expect(result.reason).toMatch(/somebody else will confirm/i);
  });

  it("does not read a real specification as a deferral", () => {
    // The substring trap: "depending" contains "pending". Matching whole words
    // is what keeps this a specification.
    expect(suggestAttributeState("Finish depending on the veneer").state).toBe("confirmed");
    // And the past tense is a settled fact, not a deferral.
    expect(suggestAttributeState("Confirmed by the client on 4 June").state).toBe("confirmed");
  });

  it("still catches a value that also says it is unsettled", () => {
    const result = suggestAttributeState("Oak, finish to be confirmed");
    expect(result.state).toBeNull();
    expect(result.reason).toMatch(/Choose which this is/);
  });
});

// ============================================================================
// ACROSS A WHOLE PACK. These two failures are invisible from inside one drawing
// document, and the real Panther pack produces both: a combined shop-drawing
// set beside ten per-item specification sheets.
// ============================================================================

function packCard(overrides: Partial<PackCard> & { item: DrawingItem }): PackCard {
  return { importId: "imp-1", filename: "set.pdf", targets: [], ...overrides };
}

function cardFrom(code: string, opts: { importId: string; filename: string; notes?: string[]; targets: string[] }): PackCard {
  const staged = stageDrawings(
    [rawItem({ itemCodeRaw: code, dimensions: [{ labelRaw: "W", valueRaw: "190" }], notesRaw: opts.notes ?? [] })],
    FIELDS,
    opts.filename,
    null,
  );
  return packCard({ importId: opts.importId, filename: opts.filename, item: staged.items[0]!, targets: opts.targets });
}

describe("duplicateTargets", () => {
  it("names a record two documents in one pack both describe", () => {
    // S-100 is a page of the shop-drawing set AND has its own specification
    // sheet. Dimensions are exempt from the unique field-slot index, so both
    // sets insert and nothing complains.
    const cards = [
      cardFrom("X-100", { importId: "imp-set", filename: "drawings.pdf", targets: ["rec-1"] }),
      cardFrom("X-100", { importId: "imp-sheet", filename: "SPEC X-100.pdf", targets: ["rec-1"] }),
    ];
    const duplicates = duplicateTargets(cards);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.recordId).toBe("rec-1");
    expect(duplicates[0]!.cards.map((c) => c.filename)).toEqual(["drawings.pdf", "SPEC X-100.pdf"]);
  });

  it("says nothing when each document describes its own records", () => {
    const cards = [
      cardFrom("X-100", { importId: "imp-a", filename: "a.pdf", targets: ["rec-1"] }),
      cardFrom("X-200", { importId: "imp-b", filename: "b.pdf", targets: ["rec-2"] }),
    ];
    expect(duplicateTargets(cards)).toEqual([]);
  });

  it("is not confused by one card fanning out across runs", () => {
    // ONE drawing of X-100 landing in the mock-up, main and VE runs is the
    // fan-out the whole model is built around, not a duplicate.
    const cards = [cardFrom("X-100", { importId: "imp-a", filename: "a.pdf", targets: ["r-mur", "r-main", "r-ve"] })];
    expect(duplicateTargets(cards)).toEqual([]);
  });
});

describe("repeatedObservations", () => {
  // The fourteen-bullet REMARKS block every Panther specification sheet
  // repeats: package conditions, not facts about any one item.
  const boilerplate = ["ALL MATERIALS MUST COMPLY WITH APPLICABLE FIRE AND SAFETY CODES."];

  it("groups a line that appears on three or more items", () => {
    const cards = ["X-100", "X-200", "X-300"].map((code, i) =>
      cardFrom(code, { importId: `imp-${i}`, filename: `SPEC ${code}.pdf`, notes: boilerplate, targets: [`rec-${i}`] }),
    );
    const repeated = repeatedObservations(cards);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.value).toBe(boilerplate[0]);
    // Every copy, so one action reaches all of them.
    expect(repeated[0]!.occurrences).toHaveLength(3);
    expect(new Set(repeated[0]!.occurrences.map((o) => o.importId)).size).toBe(3);
  });

  it("leaves a line on two items alone", () => {
    // Two items genuinely sharing a fabric is a coincidence worth nothing.
    const cards = ["X-100", "X-200"].map((code, i) =>
      cardFrom(code, { importId: `imp-${i}`, filename: `${code}.pdf`, notes: boilerplate, targets: [] }),
    );
    expect(repeatedObservations(cards)).toEqual([]);
  });

  it("ignores observations somebody has already reviewed", () => {
    const cards = ["X-100", "X-200", "X-300"].map((code, i) =>
      cardFrom(code, { importId: `imp-${i}`, filename: `${code}.pdf`, notes: boilerplate, targets: [] }),
    );
    // Ignoring one copy drops the group below the threshold, which is why this
    // is computed on read and never stored.
    cards[0]!.item.observations = cards[0]!.item.observations.map((o) =>
      o.attrGroup === "note" ? { ...o, reviewStatus: "ignored" as const } : o,
    );
    expect(repeatedObservations(cards)).toEqual([]);
  });

  it("leaves dimensions and materials alone however often they repeat", () => {
    // THE RESTRICTION THAT MATTERS. Every fixture here is 190 wide and carries
    // the same fabric. Those are per-item facts that agree, not boilerplate,
    // and offering "ignore on all" over them would discard real observations.
    const cards = ["X-100", "X-200", "X-300", "X-400"].map((code, i) =>
      cardFrom(code, { importId: `imp-${i}`, filename: `${code}.pdf`, targets: [] }),
    );
    expect(repeatedObservations(cards)).toEqual([]);
  });

  it("does not group a note nobody has filled in", () => {
    const cards = ["X-100", "X-200", "X-300"].map((code, i) =>
      cardFrom(code, { importId: `imp-${i}`, filename: `${code}.pdf`, notes: boilerplate, targets: [] }),
    );
    for (const card of cards) {
      card.item.observations = card.item.observations.map((o) => ({ ...o, value: null }));
    }
    expect(repeatedObservations(cards)).toEqual([]);
  });
});
