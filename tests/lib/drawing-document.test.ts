// Pure tier. The fixtures reproduce the SHAPE of the AP364 seating drawings —
// an item code per page, unitless dimension figures, paired swatch captions,
// client finish codes, a TBC marker — with invented codes and materials. No
// client document content is in this repo.
import { describe, it, expect } from "vitest";
import type { DimensionSlot } from "@/lib/spec-vocab";
import {
  resolveDrawingTargets,
  targetRecordIds,
  suggestUnit,
  suggestAttributeState,
  splitTbcMarker,
  suggestSpecField,
  classifyGroup,
  drawingItemBlockers,
  drawingItemWarnings,
  duplicateTargets,
  pickItemView,
  usableViews,
  repeatedObservations,
  implausibleDimension,
  resolveDimensionUnit,
  splitFigureAndUnit,
  unitSourceOf,
  stageDrawings,
  assertStagedDrawings,
  canonicalCode,
  groupItemsByCode,
  classifyCallout,
  variantLettersByItem,
  hasPendingObservations,
  isMeasuredRow,
  mergeNoteBlocks,
  type DrawingItem,
  type OccupiedSlots,
  type PackCard,
  type SpecFieldEntry,
  type OccupiedSlot,
  type DrawingObservation,
  type StagedDrawings,
  type UnitSource,
} from "@/lib/drawing-document";
import type { AttributeUnit } from "@/lib/spec-vocab";
import type { RecordEntry } from "@/lib/spec-document";
import type { RawCodeGroup, RawDrawingDimension, RawDrawingItem } from "@/lib/extraction-schema";

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
    parentId: null,
    variantLabel: null,
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
  dimensionsCombinedRaw: [],
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

  // The real S-100 sheet. The PART is in the label, as the prompt asks for,
  // and the CLOTH is in the value -- so before the word lists carried the
  // vocabulary a swatch caption actually uses, this row staged as `other`
  // with no BWS field while its timber sibling landed correctly.
  it("reads a cloth named in the value", () => {
    expect(classifyGroup("SOFA", "Yarn Tessarae YC04158 - 01")).toBe("material");
    expect(classifyGroup("SEAT", "Bouclé, ivory")).toBe("material");
  });

  it("reads the client's own finish code where the words say nothing", () => {
    expect(classifyGroup("SEAT", "Tessarae 04158", { materialCodeRaw: "UPH-07" })).toBe("material");
    expect(classifyGroup("BASE", "Tinted, satin", { materialCodeRaw: "WD-02" })).toBe("finish");
    expect(classifyGroup("TRIM", "Antique, brushed", { materialCodeRaw: "MT-01" })).toBe("finish");
    // CH is printed on the real set and nothing says what it stands for.
    expect(classifyGroup("SEAT", "Tessarae 04158", { materialCodeRaw: "CH-01.2" })).toBe("other");
  });

  it("reads a caption that names the item itself as its upholstery, and says it guessed", () => {
    const reading = classifyCallout({
      labelRaw: "SOFA",
      valueRaw: "Tessarae YC04158 - 01",
      materialCodeRaw: null,
      itemNameRaw: "Sofa",
    });
    expect(reading.kind).toBe("fabric");
    expect(reading.guessed).toBe(true);
    expect(reading.reason).toBeTruthy();
  });

  it("refuses that guess where the caption names a PART, or says nothing", () => {
    // A part is about that part. Only the whole piece is about its cloth.
    expect(
      classifyCallout({ labelRaw: "SOFA BACK", valueRaw: "Tessarae 04158", materialCodeRaw: null, itemNameRaw: "Sofa" })
        .kind,
    ).toBeNull();
    // One token of nothing is a question, not a fabric.
    expect(
      classifyCallout({ labelRaw: "SOFA", valueRaw: "TBC", materialCodeRaw: null, itemNameRaw: "Sofa" }).kind,
    ).toBeNull();
    // A fabric nobody has confirmed is still a fabric.
    expect(
      classifyCallout({
        labelRaw: "SOFA",
        valueRaw: "TBC – Yarn Collective Tessarae",
        materialCodeRaw: null,
        itemNameRaw: "Sofa",
      }).kind,
    ).toBe("fabric");
  });
});

describe("re-reading a callout on an already-staged run", () => {
  // The shape a pack staged before the word lists were widened holds: group
  // `other`, no field, nobody has touched it.
  const staleRun = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    kind: "shop_drawings",
    filename: "S-100.pdf",
    documentNotes: null,
    items: [
      {
        id: "item-1",
        version: 1,
        page: 1,
        itemCodeRaw: "S-100",
        itemNameRaw: "Sofa",
        confidence: "high",
        targets: null,
        observations: [
          {
            id: "obs-1",
            version: 1,
            attrGroup: "other",
            labelRaw: "SOFA",
            valueRaw: "Yarn Tessarae YC04158 - 01",
            materialCodeRaw: null,
            value: "Yarn Tessarae YC04158 - 01",
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
        ],
      },
    ],
  });

  const firstObservation = (doc: unknown) => assertStagedDrawings(doc, FIELDS).items[0]!.observations[0]!;

  it("gives it the group and the BWS field it should have had", () => {
    const observation = firstObservation(staleRun());
    expect(observation.attrGroup).toBe("material");
    expect(observation.specFieldId).toBe("f-com1");
  });

  it("leaves a row somebody has edited exactly as they left it", () => {
    // version 2 is the only thing that says a person has been here, and it is
    // enough: a reviewer who deliberately filed this as Other keeps it.
    const observation = firstObservation(staleRun({ version: 2 }));
    expect(observation.attrGroup).toBe("other");
    expect(observation.specFieldId).toBeNull();
  });

  it("leaves an applied row alone, because it is history", () => {
    const observation = firstObservation(staleRun({ reviewStatus: "applied" }));
    expect(observation.attrGroup).toBe("other");
  });

  it("never hands one field to two rows", () => {
    const doc = staleRun();
    // A second untouched caption on the same page, and COM 1 already taken by
    // the first: the second takes COM 2, not a second COM 1.
    (doc.items[0]!.observations as unknown[]).push({
      ...(doc.items[0]!.observations[0]! as Record<string, unknown>),
      id: "obs-2",
      labelRaw: "SCATTER CUSHION",
      valueRaw: "Linen, natural",
    });
    const observations = assertStagedDrawings(doc, FIELDS).items[0]!.observations;
    expect(observations.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com2"]);
  });

  it("corrects the group but claims no field when the caller has no register", () => {
    const observation = assertStagedDrawings(staleRun()).items[0]!.observations[0]!;
    expect(observation.attrGroup).toBe("material");
    expect(observation.specFieldId).toBeNull();
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

describe("mergeNoteBlocks", () => {
  // The Panther specification sheets print their general conditions as a
  // column of REMARKS lines. Fifteen rows of them bury the four facts on the
  // page a reviewer actually has to decide.
  const sheetNotes = [
    "ITEM: REFER TO THE DESIGNER'S DRAWINGS",
    "SUPPLIER: TO BID",
    "REMARKS: SUBMIT SHOP DRAWINGS FOR REVIEW AND APPROVAL PRIOR TO FABRICATION.",
    "REMARKS: CONSTRUCTION TO BE OF COMMERCIAL QUALITY.",
    "REMARKS: MOCKUP SAMPLE FOR APPROVAL IS TO BE MADE PRIOR TO MANUFACTURING",
  ];
  const notesItem = () => stageDrawings([rawItem({ notesRaw: sheetNotes })], FIELDS, null, null).items[0]!;

  it("joins the lines a sheet prints under one heading into one row", () => {
    const notes = notesItem().observations.filter((o) => o.attrGroup === "note");
    const remarks = notes.find((o) => o.labelRaw === "Remarks")!;
    expect(notes).toHaveLength(3);
    expect(remarks.value?.split("\n")).toEqual([
      "SUBMIT SHOP DRAWINGS FOR REVIEW AND APPROVAL PRIOR TO FABRICATION.",
      "CONSTRUCTION TO BE OF COMMERCIAL QUALITY.",
      "MOCKUP SAMPLE FOR APPROVAL IS TO BE MADE PRIOR TO MANUFACTURING",
    ]);
    // Nothing is reworded, dropped or reordered: the raw lines are still there,
    // headings and all, for anyone checking the row against the page.
    expect(remarks.valueRaw).toBe(sheetNotes.slice(2).join("\n"));
  });

  it("gives a lone heading its own name instead of calling it Note", () => {
    const supplier = notesItem().observations.find((o) => o.labelRaw === "Supplier")!;
    expect(supplier.value).toBe("TO BID");
    expect(supplier.valueRaw).toBe("SUPPLIER: TO BID");
  });

  it("never touches a figure the vocabulary could not place", () => {
    // ARM HEIGHT is a real measurement with no BWS slot. Merged into a
    // paragraph it would stop being a measurement at all.
    const item = stageDrawings(
      [rawItem({ dimensions: [{ labelRaw: "ARM HEIGHT", valueRaw: "520" }], notesRaw: ["REMARKS: A", "REMARKS: B"] })],
      FIELDS,
      null,
      null,
    ).items[0]!;
    const arm = item.observations.find((o) => o.labelRaw === "ARM HEIGHT");
    expect(arm).toBeDefined();
    expect(arm?.attrGroup).toBe("note");
    expect(item.observations.filter((o) => o.labelRaw === "Remarks")).toHaveLength(1);
  });

  it("leaves the whole block unanswered when one line is", () => {
    const item = stageDrawings(
      [rawItem({ notesRaw: ["REMARKS: SUBMIT SHOP DRAWINGS.", "REMARKS: QUANTITY TBC — the client will confirm"] })],
      FIELDS,
      null,
      null,
    ).items[0]!;
    const remarks = item.observations.find((o) => o.labelRaw === "Remarks")!;
    expect(remarks.state).not.toBe("confirmed");
  });

  it("is stable: the same rows merge to the same ids however often it runs", () => {
    const once = notesItem().observations;
    const twice = mergeNoteBlocks(once);
    expect(twice.map((o) => o.id)).toEqual(once.map((o) => o.id));
    expect(twice.map((o) => o.value)).toEqual(once.map((o) => o.value));
  });

  it("leaves a reviewed row exactly as it was", () => {
    const [first, ...rest] = notesItem().observations.filter((o) => o.labelRaw === "Remarks" || o.labelRaw === "Notes");
    void rest;
    const reviewed = { ...first!, reviewStatus: "ignored" as const, labelRaw: "Note", value: "REMARKS: ONE" };
    const merged = mergeNoteBlocks([reviewed]);
    expect(merged[0]).toBe(reviewed);
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

  it("tells a page with no code at all that the BOQ is not the answer", () => {
    // The Panther two-page sheet: page 1 is S-100, page 2 is the same sofa
    // drawn with no code in its title block. Confirming a bill will never
    // match a page that carries nothing to match on.
    const item = staged(rawItem({ itemCodeRaw: null, page: 2 }));
    const blockers = drawingItemBlockers(item, resolveDrawingTargets(null, [record()]), NO_OCCUPANCY);
    expect(blockers[0]?.code).toBe("no_targets");
    expect(blockers[0]?.message).toMatch(/no item code/);
    expect(blockers[0]?.message).not.toMatch(/Confirm the BOQ/);
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

  // ==========================================================================
  // STATED OR TBC IS ASKED ONLY WHERE SOMETHING READS THE ANSWER.
  //
  // The S-203 general-conditions block — fifteen lines merged into one row —
  // held its card because `mergeNoteBlocks` takes the most cautious state of
  // the lines it joins, so one unruled line left the whole block unruled. The
  // row composes into nothing: no BWS field, no dimension slot. Max,
  // 2026-09-22: "we don't need a state on the notes".
  //
  // The test is what the row REACHES, not the word "note", which is why the
  // two rows below still block.
  // ==========================================================================
  const stateless = (over: Partial<DrawingObservation>): DrawingItem => ({
    id: "item-1",
    version: 1,
    page: 1,
    itemCodeRaw: "X-100",
    itemNameRaw: "Sofa",
    confidence: "high",
    targets: null,
    observations: [
      {
        id: "obs-1",
        version: 1,
        attrGroup: "note",
        labelRaw: "Remarks",
        value: "REMARKS: SUBMIT SHOP DRAWINGS FOR REVIEW\nSUPPLIER: TO BID",
        valueRaw: "REMARKS: SUBMIT SHOP DRAWINGS FOR REVIEW",
        unit: null,
        unitSuggested: false,
        materialCodeRaw: null,
        specFieldId: null,
        dimensionSlot: null,
        state: null,
        stateReason: null,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
        ...over,
      },
    ],
  });

  const codesFor = (item: DrawingItem) =>
    drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), NO_OCCUPANCY).map((b) => b.code);

  it("does not ask a row that reaches nothing whether it is stated or TBC", () => {
    // The whole point: the card CONFIRMS with its general-conditions block
    // unruled. This lets rows through the confirm that are refused today, and
    // `drawingItemBlockers` is re-checked inside that transaction.
    expect(codesFor(stateless({}))).toEqual([]);
  });

  it("still asks a stateless row that carries a BWS field", () => {
    // A note-group row CAN carry one, and then `renderAttributeValue` puts its
    // TBC marker into the exported cell, where the state is read and matters.
    expect(codesFor(stateless({ specFieldId: "f-com1" }))).toContain("no_state");
  });

  it("still asks a stateless row that carries a dimension slot", () => {
    expect(codesFor(stateless({ attrGroup: "dimension", dimensionSlot: "W", value: "840", unit: "mm" }))).toContain(
      "no_state",
    );
  });

  it("refuses a blank value on an unasked row, in words it can act on", () => {
    // `empty_value` reads `stateToWrite`, not the row: an unasked row is
    // written with the column's default and the database refuses a confirmed
    // value that is blank. "Mark it TBC" would be advice with no control
    // behind it, so the sentence differs.
    const blockers = drawingItemBlockers(
      stateless({ value: null }),
      resolveDrawingTargets("X-100", [record()]),
      NO_OCCUPANCY,
    );
    expect(blockers.map((b) => b.code)).toEqual(["empty_value"]);
    expect(blockers[0]?.message).toMatch(/ignore the row/);
    expect(blockers[0]?.message).not.toMatch(/TBC/);
  });

  it("keeps the old sentence where the row does have a state to set", () => {
    const blockers = drawingItemBlockers(
      stateless({ specFieldId: "f-com1", state: "confirmed", value: "  " }),
      resolveDrawingTargets("X-100", [record()]),
      NO_OCCUPANCY,
    );
    expect(blockers.map((b) => b.code)).toEqual(["empty_value"]);
    expect(blockers[0]?.message).toMatch(/mark it TBC/);
  });

  const occupant = (overrides: Partial<OccupiedSlot> = {}): OccupiedSlot => ({
    attributeId: "attr-old",
    attributeVersion: 1,
    label: "FABRIC",
    value: "Yarn Tessarae YC04158 - 01",
    unit: null,
    sourceFilename: "S-100.pdf",
    sourcePage: 1,
    ...overrides,
  });

  it("blocks a BWS field that already has a value on a target record", () => {
    const item = staged(rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Yarn Tessarae", materialCodeRaw: null }] }));
    const occupied = { fields: new Map([["rec-1", new Map([["f-com1", occupant()]])]]), dimensions: new Map() };
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("X-100", [record()]), occupied);
    expect(blockers.some((b) => b.code === "slot_taken")).toBe(true);
  });

  it("stops blocking once the reviewer has ticked the row it would replace", () => {
    // A revised drawing for one item. The clash is the point of the card, not
    // a fault in it — but only for the record the reviewer actually ticked.
    const item = staged(rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Yarn Tessarae", materialCodeRaw: null }] }));
    const occupied = { fields: new Map([["rec-1", new Map([["f-com1", occupant()]])]]), dimensions: new Map() };
    const acknowledged = {
      ...item,
      observations: item.observations.map((observation) => ({
        ...observation,
        replaces: [{ recordId: "rec-1", attributeId: "attr-old", attributeVersion: 1 }],
      })),
    };
    const blockers = drawingItemBlockers(acknowledged, resolveDrawingTargets("X-100", [record()]), occupied);
    expect(blockers.some((b) => b.code === "slot_taken")).toBe(false);
  });

  it("still blocks when the acknowledgement names a DIFFERENT row than the one in the slot", () => {
    // The occupant changed after the card was drawn. Replacing it now would
    // retire a value the reviewer never saw.
    const item = staged(rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Yarn Tessarae", materialCodeRaw: null }] }));
    const occupied = { fields: new Map([["rec-1", new Map([["f-com1", occupant({ attributeId: "attr-newer" })]])]]), dimensions: new Map() };
    const acknowledged = {
      ...item,
      observations: item.observations.map((observation) => ({
        ...observation,
        replaces: [{ recordId: "rec-1", attributeId: "attr-old", attributeVersion: 1 }],
      })),
    };
    const blockers = drawingItemBlockers(acknowledged, resolveDrawingTargets("X-100", [record()]), occupied);
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

  // ==========================================================================
  // THE VIEW GUESS, ON READ. The real AP364 set labels its figures FRONT /
  // SIDE / BACK / TOP / SIDE SECTION, which places nothing, so every one of
  // those pages arrived with an empty Dimensions question. See
  // src/lib/dimension-guess.ts for why the repetition across views is
  // evidence. Applied on READ, never written back, exactly like the slot
  // upgrade — which is what gives the pack already in the sandbox this
  // without a second model call.
  // ==========================================================================
  const viewPage = (
    figures: [string, string][],
    unit: AttributeUnit,
    unitSource: UnitSource,
  ): StagedDrawings => ({
    schemaVersion: 1 as const,
    kind: "shop_drawings" as const,
    filename: "set.pdf",
    documentNotes: null,
    items: [
      {
        id: "item-1",
        version: 1,
        page: 3,
        itemCodeRaw: "S-200",
        itemNameRaw: "ARMCHAIR",
        confidence: "high" as const,
        targets: null,
        observations: figures.map(([labelRaw, value], index): DrawingObservation => ({
          id: `obs-${index}`,
          version: 1,
          attrGroup: "note" as const,
          labelRaw,
          value,
          valueRaw: value,
          unit,
          unitSuggested: unitSource === "figures",
          unitSource,
          materialCodeRaw: null,
          specFieldId: null,
          dimensionSlot: null,
          state: "confirmed" as const,
          stateReason: null,
          reviewStatus: "pending" as const,
          reviewedAt: null,
          reviewedBy: null,
          applied: null,
        })),
      },
    ],
  });

  const S200: [string, string][] = [
    ["FRONT", "110"], ["FRONT", "460"], ["FRONT", "720"], ["FRONT", "5"], ["FRONT", "840"],
    ["SIDE", "650"], ["SIDE", "790"],
    ["BACK", "840"],
    ["TOP", "790"], ["TOP", "840"],
    ["SIDE SECTION", "720"], ["SIDE SECTION", "460"],
  ];

  const slots = (doc: ReturnType<typeof assertStagedDrawings>) =>
    Object.fromEntries(
      doc.items[0]!.observations
        .filter((observation) => observation.dimensionSlot)
        .map((observation) => [observation.dimensionSlot, `${observation.value}${observation.unit}`]),
    );

  it("places the overall size on a page that labels its figures by view", () => {
    const doc = assertStagedDrawings(viewPage(S200, "mm", "figures"));
    expect(slots(doc)).toEqual({ W: "840mm", D: "790mm", H: "720mm", SH: "460mm" });
  });

  it("marks every one of them suggested, so the card renders them amber", () => {
    const doc = assertStagedDrawings(viewPage(S200, "mm", "figures"));
    const placed = doc.items[0]!.observations.filter((observation) => observation.dimensionSlot);
    expect(placed.every((observation) => observation.slotSuggested)).toBe(true);
  });

  it("takes the unit from the OVERALL figures when the project default was standing in", () => {
    // The trap this closes: a shop drawing's figures are mostly COMPONENTS (5,
    // 110, 460) so `suggestUnit` abstains on the page and the project default
    // — `cm`, because the specification SHEETS are in centimetres — stood in.
    // An 840mm armchair then composed as `W8400mm`. The overall figures are
    // the ones that carry the page's scale, and this is the first point at
    // which anything knows which they are.
    const doc = assertStagedDrawings(viewPage(S200, "cm", "project_default"));
    expect(slots(doc)).toEqual({ W: "840mm", D: "790mm", H: "720mm", SH: "460mm" });
  });

  it("never overrides a unit the page printed", () => {
    const doc = assertStagedDrawings(viewPage(S200, "cm", "printed"));
    expect(slots(doc)).toEqual({ W: "840cm", D: "790cm", H: "720cm", SH: "460cm" });
  });

  it("leaves a page in centimetres in centimetres", () => {
    // The S-100 specification sheet: 190 x 79 x 72, and all three under 300.
    const doc = assertStagedDrawings(
      viewPage(
        [
          ["front elevation width", "190"], ["front elevation height", "72"],
          ["side elevation width", "79"], ["side elevation height", "72"],
        ],
        "cm",
        "project_default",
      ),
    );
    expect(slots(doc)).toEqual({ W: "190cm", D: "79cm", H: "72cm" });
  });

  it("leaves an item alone once anything on it carries a slot", () => {
    // A label the vocabulary recognised, a combined line that was read, or a
    // person's own choice. Filling the gaps around a decision would be a guess
    // wearing somebody else's authority.
    const doc = viewPage(S200, "mm", "figures");
    doc.items[0]!.observations[0]!.dimensionSlot = "W";
    doc.items[0]!.observations[0]!.attrGroup = "dimension";
    const out = assertStagedDrawings(doc);
    expect(slots(out)).toEqual({ W: "110mm" });
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

describe("stageDrawings, a dimension printed as one line", () => {
  // The Panther pack carries TWO specification-sheet templates: one labels its
  // figures, the other prints "80 x 70 x 90 cm" and nothing else. Both arrive
  // in the same delivery.
  const staged = (lines: string[], projectDefault: AttributeUnit | null = null) =>
    stageDrawings([rawItem({ dimensionsCombinedRaw: lines })], FIELDS, null, null, projectDefault).items[0]!;

  it("places NOTHING from three bare figures — the order is not the page speaking", () => {
    // It used to read them as W, D and H in printed order and badge it amber.
    // The badge was not enough: `applyViewGuesses` then re-sorted the same three
    // by magnitude, and S-203 shipped `W900 x D800 x H700mm` off a page printing
    // `80 x 70 x 90 cm` beside the words Width, Depth and Height. Two inferences
    // on one line, the weaker winning silently.
    //
    // The model reports these three figures in `dimensions` now, each with the
    // slot it read and the evidence for it. The verbatim line is still staged,
    // as notes, so a reviewer can check the cell against the page.
    const item = staged(["80 x 70 x 90 cm"]);
    expect(item.observations.filter((o) => o.attrGroup === "dimension")).toHaveLength(0);
    expect(item.observations.filter((o) => o.attrGroup === "note").map((o) => o.value)).toEqual(["80", "70", "90"]);
  });

  it("does not call a printed prefix a guess, and keeps its TBC", () => {
    const dims = staged(["W1520 TBC x D560 x H1005 mm"]).observations.filter((o) => o.attrGroup === "dimension");
    expect(dims.map((o) => [o.dimensionSlot, o.slotSuggested, o.state])).toEqual([
      ["W", false, "tbc"],
      ["D", false, "confirmed"],
      ["H", false, "confirmed"],
    ]);
  });

  it("keeps a part it will not place as a note rather than dropping it", () => {
    const item = staged(["80 x 90"]);
    expect(item.observations.filter((o) => o.attrGroup === "dimension")).toHaveLength(0);
    expect(item.observations.filter((o) => o.attrGroup === "note").map((o) => o.value)).toEqual(["80", "90"]);
  });

  it("lets the line's own figures vote on the unit without being read as one number", () => {
    // "80 x 70 x 90" stripped of non-digits is 807090 — one value, far over the
    // threshold, enough to carry the page to millimetres and record an 80cm
    // armchair as 8 metres.
    expect(suggestUnit(["80 x 70 x 90"])).toEqual({ status: "none" });
    // The parts still vote on the unit whether or not they are given slots:
    // they are figures off the same page, and that was never the problem.
    const parts = staged(["80 x 70 x 90"]).observations.filter((o) => o.value === "80" || o.value === "70");
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((o) => o.unit === "cm")).toBe(true);
    expect(parts.every((o) => unitSourceOf(o) === "figures")).toBe(true);
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
      dimensionsCombinedRaw: [],
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
// THE MARKER IS A STATE; THE FABRIC IS THE VALUE.
//
// The specification sheet prints the word TBC beside a fabric it names, and
// both halves landed in the value. Every case below is the same question asked
// of a different shape: is this a marker sitting beside a value, or is it part
// of what the page said? Only a separator, at an edge, answers it.
// ============================================================================
describe("splitTbcMarker", () => {
  it("takes a leading marker off and keeps the fabric", () => {
    expect(splitTbcMarker("TBC – Yarn Collective Tessarae")).toMatchObject({
      tbc: true,
      value: "Yarn Collective Tessarae",
    });
  });

  it("consumes only the FIRST separator, because the rest is the reference", () => {
    // The " - 01" belongs to the fabric's own code. A rule that cut at every
    // separator would hand back "Yarn Collective Tessarae YC04158".
    expect(splitTbcMarker("TBC - Yarn Collective Tessarae YC04158 - 01")).toMatchObject({
      tbc: true,
      value: "Yarn Collective Tessarae YC04158 - 01",
    });
  });

  it("takes a trailing marker off, bracketed or separated", () => {
    expect(splitTbcMarker("Yarn Collective (TBC)")).toMatchObject({ tbc: true, value: "Yarn Collective" });
    expect(splitTbcMarker("Yarn Collective – TBC")).toMatchObject({ tbc: true, value: "Yarn Collective" });
    expect(splitTbcMarker("(TBC) Yarn Collective")).toMatchObject({ tbc: true, value: "Yarn Collective" });
  });

  it("reads the long form, which the token list already carries", () => {
    expect(splitTbcMarker("To be confirmed - oak")).toMatchObject({ tbc: true, value: "oak" });
  });

  it("has no remainder when the marker is the whole value", () => {
    // The caller decides what to keep: `suggestAttributeState` keeps the page's
    // own word, which is the behaviour that has always been there.
    expect(splitTbcMarker("TBC")).toEqual({ value: null, tbc: true, reason: null });
    expect(splitTbcMarker("T.B.C.")).toEqual({ value: null, tbc: true, reason: null });
  });

  it("LEAVES A MARKER IN THE MIDDLE ALONE", () => {
    // "Yarn Collective" reads as a real fabric, is not one, and nothing
    // downstream would question it. The value stays whole and the reviewer is
    // asked — which is what `suggestAttributeState` does with it.
    expect(splitTbcMarker("Yarn TBC Collective")).toEqual({
      value: "Yarn TBC Collective",
      tbc: false,
      reason: null,
    });
  });

  it("LEAVES A BARE SPACE ALONE, in both directions", () => {
    // `TBC by DLA Projects` is a real BWS Routing value and "by" is not a
    // separator. `Dark tinted wood TBC` states a value AND says it is not
    // settled, and neither code nor model gets to decide which won.
    expect(splitTbcMarker("TBC by DLA Projects")).toMatchObject({ tbc: false, value: "TBC by DLA Projects" });
    expect(splitTbcMarker("Dark tinted wood TBC")).toMatchObject({ tbc: false, value: "Dark tinted wood TBC" });
  });

  it("does not read a value's own punctuation as a marker", () => {
    expect(splitTbcMarker("Yarn Tessarae YC04158 - 01")).toMatchObject({ tbc: false });
    expect(splitTbcMarker("Oak, finish to be confirmed")).toMatchObject({ tbc: false });
  });

  it("READS A COLON AS A LABEL, so a trailing marker after one is the VALUE", () => {
    // The Panther sheets stamp every general-conditions line with its field.
    // Taking "SUPPLIER: TO BID" as a trailing marker keeps the HEADING and
    // throws the value away — found by the note-block test, which reads this
    // row as a Supplier line whose value is TO BID.
    expect(splitTbcMarker("SUPPLIER: TO BID")).toMatchObject({ tbc: false, value: "SUPPLIER: TO BID" });
    // The mirror image is a marker, because a colon puts the value on the right.
    expect(splitTbcMarker("TBC: Yarn Collective")).toMatchObject({ tbc: true, value: "Yarn Collective" });
  });
});

describe("suggestAttributeState and a marker at the edge of a value", () => {
  it("records the marker as the state and the fabric as the value", () => {
    const result = suggestAttributeState("TBC – Yarn Collective Tessarae");
    expect(result.state).toBe("tbc");
    expect(result.value).toBe("Yarn Collective Tessarae");
    expect(result.reason).toMatch(/marker is recorded as the state/i);
  });

  it("keeps the page's own word where the marker is the whole value", () => {
    // Unchanged by the split, deliberately: "PIPING  TBC" has nothing else to
    // say and the export renders the marker once either way.
    expect(suggestAttributeState("TBC")).toEqual({ state: "tbc", value: "TBC", reason: null });
  });

  it("still asks about a marker a separator does not bind", () => {
    expect(suggestAttributeState("Dark tinted wood TBC")).toMatchObject({
      state: null,
      value: "Dark tinted wood TBC",
    });
    expect(suggestAttributeState("TBC by DLA Projects")).toMatchObject({
      state: null,
      value: "TBC by DLA Projects",
    });
    expect(suggestAttributeState("Yarn TBC Collective")).toMatchObject({ state: null });
  });

  it("stages the clean value off a fresh read", () => {
    const doc = stageDrawings(
      [rawItem({ materials: [{ labelRaw: "SOFA", valueRaw: "TBC – Yarn Collective Tessarae", materialCodeRaw: "UPH-07" }] })],
      FIELDS,
      "S-100.pdf",
      null,
    );
    const observation = doc.items[0]!.observations[0]!;
    expect(observation.value).toBe("Yarn Collective Tessarae");
    expect(observation.state).toBe("tbc");
    // What the page said is never lost: the card prints it under the box.
    expect(observation.valueRaw).toBe("TBC – Yarn Collective Tessarae");
  });
});

describe("taking an edge TBC marker off a pack already staged", () => {
  // The Panther pack was eleven charged calls. A rule that could only reach a
  // re-read would cost money to fix, so this runs on READ — same discipline as
  // the callout upgrade, and never written back.
  const staged = (observation: Record<string, unknown>) => ({
    schemaVersion: 2,
    kind: "shop_drawings",
    filename: "S-100.pdf",
    documentNotes: null,
    items: [
      {
        id: "item-1",
        version: 1,
        page: 1,
        itemCodeRaw: "S-100",
        itemNameRaw: "Sofa",
        confidence: "high",
        targets: null,
        observations: [
          {
            id: "obs-1",
            version: 1,
            attrGroup: "material",
            labelRaw: "SOFA",
            valueRaw: "TBC – Yarn Collective Tessarae",
            materialCodeRaw: "UPH-07",
            value: "TBC – Yarn Collective Tessarae",
            unit: null,
            unitSuggested: false,
            specFieldId: "f-com1",
            state: null,
            stateReason: "The drawing gives a value and also marks it TBC. Choose which this is.",
            reviewStatus: "pending",
            reviewedAt: null,
            reviewedBy: null,
            applied: null,
            ...observation,
          },
        ],
      },
    ],
  });

  const first = (doc: unknown) => assertStagedDrawings(doc, FIELDS).items[0]!.observations[0]!;

  it("splits the marker out and keeps the row's id", () => {
    const observation = first(staged({}));
    expect(observation.id).toBe("obs-1");
    expect(observation.value).toBe("Yarn Collective Tessarae");
    expect(observation.state).toBe("tbc");
    expect(observation.valueRaw).toBe("TBC – Yarn Collective Tessarae");
  });

  it("leaves the state alone where it was already TBC", () => {
    const observation = first(staged({ state: "tbc" }));
    expect(observation.state).toBe("tbc");
    expect(observation.value).toBe("Yarn Collective Tessarae");
  });

  it("never second-guesses a row somebody has edited", () => {
    expect(first(staged({ version: 2 })).value).toBe("TBC – Yarn Collective Tessarae");
    expect(first(staged({ reviewStatus: "applied" })).value).toBe("TBC – Yarn Collective Tessarae");
    expect(first(staged({ reviewStatus: "ignored" })).value).toBe("TBC – Yarn Collective Tessarae");
  });

  it("leaves a dimension's figure alone", () => {
    // `composeDimensionCell` reads the marker back out of "1520 TBC" itself.
    // Nothing is hidden inside a name there, and a second rewrite of that
    // string is a second place to get it wrong.
    const observation = first(
      staged({ attrGroup: "dimension", dimensionSlot: "W", value: "TBC - 1520", valueRaw: "TBC - 1520", unit: "mm" }),
    );
    expect(observation.value).toBe("TBC - 1520");
  });

  it("leaves a merged note block alone", () => {
    // The edges of a BLOCK are not the edges of any statement in it.
    const block = "TBC – supplier to be appointed\nSubmit shop drawings for review";
    const observation = first(staged({ attrGroup: "note", labelRaw: "Remarks", value: block, valueRaw: block, specFieldId: null }));
    expect(observation.value).toBe(block);
  });

  it("leaves a value with no edge marker exactly as it is", () => {
    const observation = first(staged({ value: "Yarn Tessarae YC04158 - 01", valueRaw: "Yarn Tessarae YC04158 - 01", state: "confirmed" }));
    expect(observation.value).toBe("Yarn Tessarae YC04158 - 01");
    expect(observation.state).toBe("confirmed");
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

// ============================================================================
// WHICH PICTURE OF THE ITEM. "Prefer the 3D view, fall back to a front view" —
// decided here, in code, from what the model reported seeing. Never by the
// model, which is given no "best" field to fill in.
// ============================================================================

const view = (viewType: string, bbox: [number, number, number, number], page: number | null = 1) =>
  ({ viewType, page, bbox }) as never;

describe("usableViews", () => {
  it("keeps a well-formed region as it was reported", () => {
    expect(usableViews([view("3d", [0.1, 0.1, 0.5, 0.6])], 4)).toEqual([
      { viewType: "3d", page: 1, bbox: [0.1, 0.1, 0.5, 0.6] },
    ]);
  });

  it("falls back to the item's own page when the region names none", () => {
    // The model was shown one page; a region with no page meant that one.
    expect(usableViews([view("front", [0, 0, 1, 1], null)], 7)[0]!.page).toBe(7);
  });

  it("clamps an edge that overshoots rather than dropping the crop", () => {
    // 1.02 for the right edge of a full-width photograph means the page edge.
    expect(usableViews([view("photo", [-0.01, 0, 1.02, 0.4])], 1)[0]!.bbox).toEqual([0, 0, 1, 0.4]);
  });

  it("drops a box that is not a picture of anything", () => {
    // Inverted, degenerate, a 1% sliver, or simply malformed. Rendering one
    // produces a smear the reviewer has to notice in order to reject.
    expect(usableViews([view("3d", [0.5, 0.1, 0.2, 0.6])], 1)).toEqual([]);
    expect(usableViews([view("3d", [0.1, 0.1, 0.11, 0.6])], 1)).toEqual([]);
    expect(usableViews([view("3d", [0, 0, 1] as never)], 1)).toEqual([]);
    expect(usableViews(undefined, 1)).toEqual([]);
  });

  it("reads an unknown view type as 'other' rather than dropping the picture", () => {
    expect(usableViews([view("elevation-ish", [0.1, 0.1, 0.9, 0.9])], 1)[0]!.viewType).toBe("other");
  });
});

// Asked on 2026-09-16: "just pick up the 3D view when available, and a front
// view if not." That order is what VIEW_PREFERENCE already encodes and what
// the two cases below have always asserted — the real set simply arrived with
// an EMPTY viewRegions array, the model saying it could not fix exact crop
// boxes, so there was nothing to prefer and the whole page stood in. The fix
// for that is in the prompt (src/lib/anthropic.ts): an approximate box beats
// omitting the region. Documents already read keep their old output and need
// re-reading to gain one.
describe("pickItemView", () => {
  it("prefers a photograph or a render — on a spec sheet that IS the 3D view", () => {
    const views = usableViews(
      [view("front", [0, 0, 0.4, 0.4]), view("photo", [0.5, 0, 0.9, 0.4])],
      1,
    );
    expect(pickItemView(views)!.viewType).toBe("photo");
  });

  it("prefers a 3D line view over an elevation on a shop drawing", () => {
    const views = usableViews([view("plan", [0, 0, 0.4, 0.4]), view("3d", [0.5, 0, 0.9, 0.4])], 1);
    expect(pickItemView(views)!.viewType).toBe("3d");
  });

  it("falls back to the front view when there is no 3D one", () => {
    // Literally the rule as asked for.
    const views = usableViews([view("detail", [0, 0, 0.3, 0.3]), view("front", [0.4, 0, 0.8, 0.5])], 1);
    expect(pickItemView(views)!.viewType).toBe("front");
  });

  it("takes the largest of equals — the big one is the one drawn to be looked at", () => {
    const views = usableViews(
      [view("3d", [0, 0, 0.2, 0.2]), view("3d", [0.3, 0.1, 0.95, 0.8])],
      1,
    );
    expect(pickItemView(views)!.bbox).toEqual([0.3, 0.1, 0.95, 0.8]);
  });

  it("has nothing to propose when nothing usable was reported", () => {
    expect(pickItemView([])).toBeNull();
    expect(pickItemView(usableViews([view("3d", [0.5, 0.5, 0.5, 0.5])], 1))).toBeNull();
  });
});

describe("stageDrawings pictures", () => {
  it("proposes one and keeps the rest to switch between", () => {
    const staged = stageDrawings(
      [
        rawItem({
          page: 2,
          viewRegions: [
            { viewType: "front", page: 2, bbox: [0.05, 0.4, 0.45, 0.9] },
            { viewType: "photo", page: 2, bbox: [0.55, 0.05, 0.95, 0.35] },
          ],
        }),
      ],
      FIELDS,
      null,
      null,
    );
    const item = staged.items[0]!;
    expect(item.viewRegions).toHaveLength(2);
    expect(item.imageProposal!.viewType).toBe("photo");
  });

  it("stages no proposal at all when the page offered no picture", () => {
    // Absent, not an empty object: a card with nothing proposed is one where
    // the reviewer drags a box, and that is a normal state rather than a fault.
    const item = stageDrawings([rawItem({})], FIELDS, null, null).items[0]!;
    expect(item.viewRegions).toBeUndefined();
    expect(item.imageProposal).toBeUndefined();
  });
});

// ============================================================================
// DE-DUPLICATION. A drawing dimensions the same figure on every view that
// shows it, and often twice on one view — the real S-201 front elevation
// prints 5, 5, 27, 27, 42, 42 because the chair is symmetrical, and the card
// arrived with forty-three measured rows for one armchair.
// ============================================================================
describe("assertStagedDrawings de-duplication", () => {
  const page = (figures: [string, string][], unit: AttributeUnit | null = "mm") => ({
    schemaVersion: 1 as const,
    kind: "shop_drawings" as const,
    filename: "set.pdf",
    documentNotes: null,
    items: [
      {
        id: "item-1",
        version: 1,
        page: 5,
        itemCodeRaw: "S-201",
        itemNameRaw: "ARMCHAIR",
        confidence: "high" as const,
        targets: null,
        observations: figures.map(([labelRaw, value], index): DrawingObservation => ({
          id: `obs-${index}`,
          version: 1,
          attrGroup: "note" as const,
          labelRaw,
          value,
          valueRaw: value,
          unit,
          unitSuggested: unit !== null,
          ...(unit === null ? {} : { unitSource: "figures" as UnitSource }),
          materialCodeRaw: null,
          specFieldId: null,
          dimensionSlot: null,
          state: "confirmed" as const,
          stateReason: null,
          reviewStatus: "pending" as const,
          reviewedAt: null,
          reviewedBy: null,
          applied: null,
        })),
      },
    ],
  });

  const values = (doc: StagedDrawings) =>
    doc.items[0]!.observations.map((o) => `${o.labelRaw}:${o.value}`);

  it("collapses a figure repeated on the SAME view", () => {
    const out = assertStagedDrawings(page([["FRONT", "42"], ["FRONT", "42"], ["FRONT", "27"]]));
    expect(values(out)).toEqual(["FRONT:42", "FRONT:27"]);
  });

  it("keeps a figure repeated ACROSS views — that agreement IS the evidence", () => {
    // De-duplicating these would tidy the table by breaking the guess that
    // reads the overall size from exactly this repetition.
    const out = assertStagedDrawings(page([["FRONT", "640"], ["BACK", "640"], ["TOP", "640"]]));
    expect(values(out)).toEqual(["FRONT:640", "BACK:640", "TOP:640"]);
  });

  it("collapses unlabelled figures by figure alone", () => {
    // `Dimension 37` and `Dimension 42` are positions this app invented, not
    // names the page gave, so two rows carrying them are indistinguishable.
    const out = assertStagedDrawings(page([["Dimension 37", "556"], ["Dimension 42", "556"]]));
    expect(values(out)).toEqual(["Dimension 37:556"]);
  });

  it("keeps the FIRST of each group, so ids are stable across reads", () => {
    const doc = page([["FRONT", "42"], ["FRONT", "42"]]);
    const once = assertStagedDrawings(doc);
    const twice = assertStagedDrawings(doc);
    expect(once.items[0]!.observations[0]!.id).toBe("obs-0");
    expect(twice.items[0]!.observations.map((o) => o.id)).toEqual(
      once.items[0]!.observations.map((o) => o.id),
    );
  });

  // ==========================================================================
  // A FIGURE IS A MEASUREMENT WHETHER OR NOT IT HAS A UNIT.
  //
  // `suggestUnit` abstains on a page whose figures disagree about magnitude,
  // and a real shop drawing always does: S-201 prints 5, 27 and 42 beside 640
  // and 680 because most figures on a shop drawing are COMPONENTS. On a
  // project with no `default_dimension_unit` those rows stage with no unit at
  // all -- and every one of the four places that asked "is this a measured
  // row" required one, so nothing was guessed, nothing was de-duplicated,
  // nothing folded, and no control was offered that could have supplied the
  // unit that would have unlocked all of it.
  // ==========================================================================
  describe("a page staged with no unit at all", () => {
    // The real S-201 armchair, as the model read it on a project with no
    // default dimension unit. Every figure arrives unitless.
    const s201 = (): [string, string][] => [
      ["FRONT", "660"], ["FRONT", "640"], ["FRONT", "680"], ["FRONT", "465"],
      ["FRONT", "42"], ["FRONT", "42"], ["FRONT", "27"], ["FRONT", "27"],
      ["BACK", "660"], ["BACK", "640"], ["BACK", "42"],
      ["SIDE", "685"], ["SIDE", "680"], ["SIDE", "445"], ["SIDE", "42"],
      ["TOP", "640"], ["TOP", "42"],
    ];

    it("places the slots, and takes the unit from the OVERALL figures", () => {
      const out = assertStagedDrawings(page(s201(), null));
      const placed = out.items[0]!.observations.filter((o) => o.dimensionSlot);
      expect(placed.map((o) => `${o.dimensionSlot}${o.value}`).sort()).toEqual(
        ["D685", "H680", "SH445", "W640"],
      );
      // Every placed row carries the same unit, read off the placed figures
      // themselves -- the resolution step that could previously only REPLACE a
      // unit, never supply one.
      expect(new Set(placed.map((o) => o.unit))).toEqual(new Set(["mm"]));
      expect(new Set(placed.map((o) => o.unitSource))).toEqual(new Set(["figures"]));
      expect(placed.every((o) => o.slotSuggested)).toBe(true);
    });

    it("de-duplicates the symmetrical figures it could not see before", () => {
      const out = assertStagedDrawings(page(s201(), null));
      // FRONT printed 42 twice and 27 twice because the chair is symmetrical.
      const front = out.items[0]!.observations.filter((o) => o.labelRaw === "FRONT");
      expect(front.map((o) => o.value)).toEqual(["660", "640", "680", "465", "42", "27"]);
    });

    it("leaves the unit blank when the overall figures do not share a scale", () => {
      // Nothing is invented: the slots are still placed, and the card asks for
      // the unit in amber rather than picking one.
      const out = assertStagedDrawings(
        page([["FRONT", "80"], ["FRONT", "900"], ["SIDE", "900"], ["SIDE", "70"], ["TOP", "80"], ["TOP", "70"]], null),
      );
      const placed = out.items[0]!.observations.filter((o) => o.dimensionSlot);
      expect(placed.length).toBeGreaterThanOrEqual(3);
      expect(placed.some((o) => o.unit === null)).toBe(true);
    });

    it("never overwrites a unit the page printed or a person chose", () => {
      const doc = page(s201(), null);
      doc.items[0]!.observations[11]!.unit = "cm";
      doc.items[0]!.observations[11]!.unitSuggested = false;
      doc.items[0]!.observations[11]!.unitSource = "printed";
      const out = assertStagedDrawings(doc);
      const depth = out.items[0]!.observations.find((o) => o.dimensionSlot === "D");
      expect(depth?.unit).toBe("cm");
    });
  });

  it("re-guesses over a slot an autosave persisted, but never over a person's", () => {
    // The guess is computed on read and never written back — but a PATCH
    // writes the doc as the server read it, so the first autosave on any row
    // persists it. Keyed on `slotSuggested`, which the PATCH route sets false
    // when a person chooses.
    const persisted = page([["FRONT", "840"], ["FRONT", "720"], ["SIDE", "720"], ["SIDE", "790"]]);
    persisted.items[0]!.observations[0]!.dimensionSlot = "W";
    persisted.items[0]!.observations[0]!.attrGroup = "dimension";
    persisted.items[0]!.observations[0]!.slotSuggested = true;
    const reguessed = assertStagedDrawings(persisted);
    expect(reguessed.items[0]!.observations.filter((o) => o.dimensionSlot)).toHaveLength(3);

    const chosen = page([["FRONT", "840"], ["FRONT", "720"], ["SIDE", "720"], ["SIDE", "790"]]);
    chosen.items[0]!.observations[0]!.dimensionSlot = "H";
    chosen.items[0]!.observations[0]!.attrGroup = "dimension";
    chosen.items[0]!.observations[0]!.slotSuggested = false;
    const left = assertStagedDrawings(chosen);
    expect(left.items[0]!.observations.filter((o) => o.dimensionSlot).map((o) => o.dimensionSlot)).toEqual(["H"]);
  });
});

// ============================================================================
// CONFIGURATIONS. The AP364 set draws S-201 on pages 5 and 6 with identical
// geometry and different fabric callouts, S-200 on 3 and 4, S-301 on four
// pages — one bill line each. Each page is a configuration; the letter is what
// a person calls it.
// ============================================================================
describe("variantLettersByItem", () => {
  const item = (id: string, code: string | null, page: number | null): DrawingItem => ({
    id,
    version: 1,
    page,
    itemCodeRaw: code,
    itemNameRaw: null,
    confidence: null,
    targets: null,
    observations: [],
  });

  it("gives no letter to a code drawn once — most of any pack", () => {
    const letters = variantLettersByItem([item("i1", "S-100", 1), item("i2", "UP-101", 2)]);
    expect(letters.get("i1")).toBeNull();
    expect(letters.get("i2")).toBeNull();
  });

  it("letters the real S-201 pages A and B in page order", () => {
    const letters = variantLettersByItem([item("i6", "S-201", 6), item("i5", "S-201", 5)]);
    expect(letters.get("i5")).toBe("A");
    expect(letters.get("i6")).toBe("B");
  });

  it("letters S-301's four pages A to D", () => {
    const pages = [8, 9, 10, 11].map((page) => item(`i${page}`, "S-301", page));
    const letters = variantLettersByItem(pages);
    expect(pages.map((p) => letters.get(p.id))).toEqual(["A", "B", "C", "D"]);
  });

  it("folds codes the way the resolver matches them", () => {
    // `findRecordsByRef` compares on spec-document's normaliser, so "S 201"
    // and "s-201" are the same code here too — otherwise the letters would
    // describe a grouping the confirm does not share.
    const letters = variantLettersByItem([item("i5", "S-201", 5), item("i6", "s 201", 6)]);
    expect(letters.get("i5")).toBe("A");
    expect(letters.get("i6")).toBe("B");
  });

  it("keeps the order fixed when pages are missing", () => {
    const letters = variantLettersByItem([item("zz", "S-201", null), item("aa", "S-201", null)]);
    expect(letters.get("aa")).toBe("A");
    expect(letters.get("zz")).toBe("B");
  });

  it("ignores a codeless page entirely", () => {
    const letters = variantLettersByItem([item("i1", null, 1), item("i2", null, 2)]);
    expect(letters.has("i1")).toBe(false);
  });
});

// ============================================================================
// THE MODEL READS THE PAGE; THE APP STOPS GUESSING WHAT IT MEANT (2026-09-18)
//
// EVERY TEST HERE GOES THROUGH `assertStagedDrawings`, NOT `stageDrawings`.
// That is not a style choice, it is the defect. The old suite asserted the
// staged result and stopped, and the transposition happened in the read-time
// pass AFTER it: `stageDrawings` placed W80 / D70 / H90 correctly off
// `80 x 70 x 90 cm`, a green test said so, and `applyViewGuesses` then re-sorted
// the three by magnitude into `W900 x D800 x H700mm`. A test that stops at
// staging cannot see the pipeline the screen actually calls.
// ============================================================================
describe("the model's own reading of a page", () => {
  const read = (item: RawDrawingItem, codeGroups: RawCodeGroup[] = []) =>
    assertStagedDrawings(stageDrawings([item], FIELDS, null, null, null, codeGroups), FIELDS);

  const dim = (over: Partial<RawDrawingDimension>): RawDrawingDimension => ({
    labelRaw: null,
    valueRaw: "0",
    unitRaw: null,
    slot: null,
    slotEvidence: null,
    isOverall: false,
    ...over,
  });

  it("keeps the slots the model read, through the whole read-time pipeline", () => {
    // The S-203 case, end to end. The page prints `80 x 70 x 90 cm` and the
    // words Width, Depth, Height; the model reports which is which and why.
    const doc = read(
      rawItem({
        dimensionsCombinedRaw: ["80 x 70 x 90 cm"],
        dimensions: [
          dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "first of three in the printed line", isOverall: true }),
          dim({ labelRaw: "Depth", valueRaw: "70", unitRaw: "cm", slot: "depth", slotEvidence: "second of three in the printed line", isOverall: true }),
          dim({ labelRaw: "Height", valueRaw: "90", unitRaw: "cm", slot: "height", slotEvidence: "third of three in the printed line", isOverall: true }),
        ],
      }),
    );
    const placed = doc.items[0]!.observations.filter((o) => o.dimensionSlot);
    expect(placed.map((o) => [o.labelRaw, o.value, o.dimensionSlot])).toEqual([
      ["Width", "80", "W"],
      ["Depth", "70", "D"],
      ["Height", "90", "H"],
    ]);
    // Version 3 since 2026-09-23 (named configurations). Everything version 2
    // reads, version 3 reads identically — which is what this test holds.
    expect(doc.schemaVersion).toBe(3);
  });

  it("does not flag a slot the page's own label confirms", () => {
    // Two independent readings agreeing is not a guess, and painting it yellow
    // would leave a reviewer with nothing but yellow to look at.
    const doc = read(
      rawItem({
        dimensions: [dim({ labelRaw: "WIDTH", valueRaw: "1800", unitRaw: "mm", slot: "width", slotEvidence: "labelled WIDTH", isOverall: true })],
      }),
    );
    const row = doc.items[0]!.observations.find((o) => o.dimensionSlot)!;
    expect(row.slotSuggested).toBe(false);
    expect(row.slotReason ?? null).toBeNull();
  });

  it("flags a slot the page did not name, and shows the model's own evidence", () => {
    const doc = read(
      rawItem({
        dimensions: [dim({ valueRaw: "840", unitRaw: "mm", slot: "width", slotEvidence: "spans the whole chair on the front elevation", isOverall: true })],
      }),
    );
    const row = doc.items[0]!.observations.find((o) => o.dimensionSlot)!;
    expect(row.slotSuggested).toBe(true);
    expect(row.slotReason).toBe("spans the whole chair on the front elevation");
  });

  it("lets the PAGE'S WORD win when the two readings disagree, and says so", () => {
    // Neither reading is allowed to win silently. The label is the page's own
    // statement, so it takes the slot, and the row carries the disagreement.
    const doc = read(
      rawItem({
        dimensions: [dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "depth", slotEvidence: "the second largest figure", isOverall: true })],
      }),
    );
    const row = doc.items[0]!.observations.find((o) => o.dimensionSlot)!;
    expect(row.dimensionSlot).toBe("W");
    expect(row.slotSuggested).toBe(true);
    expect(row.slotReason).toContain("The page labels this \"Width\"");
    expect(row.slotReason).toContain("depth");
  });

  it("still votes on a unit the page never printed, and never calls that vote printed", () => {
    // THE UNIT VOTE IS DELIBERATELY KEPT, and it is worth saying why here
    // rather than only in a plan. `suggestUnit` reads cm or mm from the
    // magnitudes on the page, which is the same KIND of inference the slot
    // sort was — but the two are not the same situation. A page that prints
    // `80 x 70 x 90 cm` beside the words Width, Depth and Height HAS stated
    // which figure is the width, and the sort overrode it. The AP364 shop
    // drawings print no unit anywhere, so there is nothing to override: the
    // vote is the only reading available, it is flagged amber on every row it
    // touches, and the card carries a one-click mm/cm control to correct a
    // whole page. Removing it left every figure unitless, every card blocked
    // by `unit_missing`, and no control able to unblock it — which is the
    // self-sealing failure recorded as item 95 on 2026-09-17.
    //
    // What must never happen is the vote passing itself off as a reading.
    const doc = read(
      rawItem({
        dimensions: [dim({ labelRaw: "WIDTH", valueRaw: "840", slot: "width", isOverall: true })],
      }),
    );
    const row = doc.items[0]!.observations.find((o) => o.dimensionSlot)!;
    expect(row.unit).toBe("mm");
    expect(unitSourceOf(row)).toBe("figures");
    expect(unitSourceOf(row)).not.toBe("printed");
  });

  it("takes the unit the page printed over the vote, and calls it printed", () => {
    const doc = read(
      rawItem({
        dimensions: [dim({ labelRaw: "WIDTH", valueRaw: "80", unitRaw: "cm", slot: "width", isOverall: true })],
      }),
    );
    const row = doc.items[0]!.observations.find((o) => o.dimensionSlot)!;
    expect(row.unit).toBe("cm");
    expect(unitSourceOf(row)).toBe("printed");
  });

  it("takes null for a slot as an answer, and keeps the row as a note", () => {
    // ARM HEIGHT is named in the dimension invariant as the label a substring
    // rule destroys. It has no slot, and never had one.
    const doc = read(
      rawItem({ dimensions: [dim({ labelRaw: "ARM HEIGHT", valueRaw: "520", unitRaw: "mm" })] }),
    );
    const row = doc.items[0]!.observations.find((o) => o.labelRaw === "ARM HEIGHT")!;
    expect(row.dimensionSlot ?? null).toBeNull();
    expect(row.attrGroup).toBe("note");
    expect(row.value).toBe("520");
  });

  // ==========================================================================
  // ONE PRINTED LINE, ONE SET OF ROWS (FIU 2026-09-22, item 4b.1)
  //
  // Max, on the S-203 card: *"why are the dimensions getting duplicated? They
  // shouldn't be."* Three yellow rows off the model — 80 → Width, 70 → Depth,
  // 90 → Height, each with its evidence — and four rows below, `Dimension 4 =
  // 80 cm`, `Dimension 5 = 70`, `Dimension 6 = 90`, filed as notes off the same
  // printed line. Six rows for three measurements, and six `record_attributes`
  // rows at confirm.
  //
  // The reduction is in `dedupeMeasured`, which runs at READ time, so a pack
  // already staged gains it with no second model call.
  // ==========================================================================
  describe("the same printed line staged by both paths", () => {
    const s203 = () =>
      rawItem({
        dimensionsCombinedRaw: ["80 x 70 x 90 cm"],
        dimensions: [
          dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "first of three in the printed line", isOverall: true }),
          dim({ labelRaw: "Depth", valueRaw: "70", unitRaw: "cm", slot: "depth", slotEvidence: "second of three in the printed line", isOverall: true }),
          dim({ labelRaw: "Height", valueRaw: "90", unitRaw: "cm", slot: "height", slotEvidence: "third of three in the printed line", isOverall: true }),
        ],
      });

    const measured = (doc: StagedDrawings) =>
      doc.items[0]!.observations.filter((o) => isMeasuredRow(o)).map((o) => `${o.labelRaw}:${o.value}:${o.dimensionSlot ?? "-"}`);

    it("reduces the S-203 shape from six rows to three", () => {
      expect(measured(read(s203()))).toEqual(["Width:80:W", "Depth:70:D", "Height:90:H"]);
    });

    it("keeps a bare part the model never reported", () => {
      // Four segments have no convention, so `parseCombinedDimensions` slots
      // none of them and all four stage as notes. The model placed three. The
      // fourth is the only reading of that figure there is, and dropping every
      // bare part would lose it.
      const doc = read(
        rawItem({
          dimensionsCombinedRaw: ["80 x 70 x 90 x 45 cm"],
          dimensions: s203().dimensions,
        }),
      );
      expect(measured(doc)).toEqual(["Width:80:W", "Depth:70:D", "Height:90:H", "Dimension 7:45:-"]);
    });

    it("reads 80 against 80 TBC as one measurement", () => {
      // The combined path deliberately keeps the page's TBC inside `value`
      // while the model path stores the split figure, so comparing the two as
      // STRINGS would leave the duplicate on the card.
      const doc = read(
        rawItem({
          dimensionsCombinedRaw: ["80 TBC x 70 x 90 cm"],
          dimensions: s203().dimensions,
        }),
      );
      expect(measured(doc)).toEqual(["Width:80:W", "Depth:70:D", "Height:90:H"]);
    });

    it("collapses two slots sharing a figure one for one", () => {
      const doc = read(
        rawItem({
          dimensionsCombinedRaw: ["80 x 80 x 90 cm"],
          dimensions: [
            dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "first of three", isOverall: true }),
            dim({ labelRaw: "Depth", valueRaw: "80", unitRaw: "cm", slot: "depth", slotEvidence: "second of three", isOverall: true }),
            dim({ labelRaw: "Height", valueRaw: "90", unitRaw: "cm", slot: "height", slotEvidence: "third of three", isOverall: true }),
          ],
        }),
      );
      expect(measured(doc)).toEqual(["Width:80:W", "Depth:80:D", "Height:90:H"]);
    });

    it("drops ONE slotless row per slotted row that states the figure", () => {
      // The multiset, asserted directly. One slotted 80 answers for one
      // slotless 80; a second slotless 80 the item states under its own label
      // is a measurement nothing has accounted for and stays.
      const doc = read(
        rawItem({
          dimensions: [
            dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "labelled", isOverall: true }),
            dim({ labelRaw: "Overall across the arms", valueRaw: "80", unitRaw: "cm", isOverall: true }),
            dim({ labelRaw: "Overall across the back", valueRaw: "80", unitRaw: "cm", isOverall: true }),
          ],
        }),
      );
      expect(measured(doc)).toEqual(["Width:80:W", "Overall across the back:80:-"]);
    });

    it("never touches a row the model said is not overall", () => {
      // ARM HEIGHT is the label the dimension invariant names as the one a
      // loose rule destroys, and 80 is also the item's width.
      const doc = read(
        rawItem({
          dimensions: [
            dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "cm", slot: "width", slotEvidence: "labelled", isOverall: true }),
            dim({ labelRaw: "ARM HEIGHT", valueRaw: "80", unitRaw: "cm", isOverall: false }),
          ],
        }),
      );
      expect(measured(doc)).toEqual(["Width:80:W", "ARM HEIGHT:80:-"]);
    });

    it("keeps the figure where the two paths read different units", () => {
      // 80 millimetres and 80 centimetres are not one measurement, and
      // `measuredKey` keeps both for that reason: collapsing them would hide a
      // disagreement rather than settle it. The unit is half this key too.
      const doc = read(
        rawItem({
          dimensionsCombinedRaw: ["80 x 70 x 90 cm"],
          dimensions: [dim({ labelRaw: "Width", valueRaw: "80", unitRaw: "mm", slot: "width", slotEvidence: "labelled", isOverall: true })],
        }),
      );
      expect(measured(doc).filter((row) => row.includes(":80:"))).toEqual(["Width:80:W", "Dimension 2:80:-"]);
    });

    it("leaves a schemaVersion 1 run exactly as it is", () => {
      // FROZEN. Before the model was asked which figure was which, the combined
      // line's parts were the only reading of the overall size there was, so
      // reducing them would delete the only copy. `isOverall` is set on every
      // row here, so the VERSION is the only thing holding the pass back.
      const row = (id: string, labelRaw: string, value: string, slot: DimensionSlot | null): DrawingObservation => ({
        id,
        version: 1,
        attrGroup: slot ? "dimension" : "note",
        labelRaw,
        value,
        valueRaw: value,
        unit: "cm",
        unitSuggested: true,
        unitSource: "figures",
        materialCodeRaw: null,
        specFieldId: null,
        dimensionSlot: slot,
        isOverall: true,
        state: "confirmed",
        stateReason: null,
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      });
      const doc = assertStagedDrawings({
        schemaVersion: 1,
        kind: "shop_drawings",
        filename: "set.pdf",
        documentNotes: null,
        items: [
          {
            id: "item-1",
            version: 1,
            page: 5,
            itemCodeRaw: "S-203",
            itemNameRaw: "ARMCHAIR",
            confidence: "high",
            targets: null,
            observations: [
              row("obs-0", "Width", "80", "W"),
              row("obs-1", "Depth", "70", "D"),
              row("obs-2", "Height", "90", "H"),
              row("obs-3", "Dimension 4", "80", null),
              row("obs-4", "Dimension 5", "70", null),
              row("obs-5", "Dimension 6", "90", null),
            ],
          },
        ],
      });
      expect(doc.items[0]!.observations.map((o) => o.id)).toEqual([
        "obs-0", "obs-1", "obs-2", "obs-3", "obs-4", "obs-5",
      ]);
    });

    it("keeps the FIRST of each group, so ids are stable across reads", () => {
      const staged = stageDrawings([s203()], FIELDS, null, null, null, []);
      const once = assertStagedDrawings(staged, FIELDS);
      const twice = assertStagedDrawings(staged, FIELDS);
      expect(once.items[0]!.observations.map((o) => o.id)).toEqual(twice.items[0]!.observations.map((o) => o.id));
      expect(once.items[0]!.observations.map((o) => o.id)).toEqual(
        staged.items[0]!.observations.slice(0, 3).map((o) => o.id),
      );
    });
  });
});

describe("one item drawn twice, or two things to make", () => {
  const pages = (code: string) => [
    rawItem({ itemCodeRaw: code, page: 1 }),
    rawItem({ itemCodeRaw: code, page: 2 }),
  ];
  const lettersFor = (groups: RawCodeGroup[]) => {
    const doc = assertStagedDrawings(stageDrawings(pages("S-200"), FIELDS, null, null, null, groups), FIELDS);
    return [...variantLettersByItem(doc.items, doc).values()];
  };
  const group = (relationship: RawCodeGroup["relationship"]): RawCodeGroup => ({
    itemCodes: ["S-200"],
    pages: [1, 2],
    relationship,
    evidence: "the specification sheet and the shop drawing of one chair",
  });

  it("letters NOTHING when the model says the pages are one item", () => {
    // The S-200 case. Lettering here makes one armchair into two BWS jobs,
    // because 0024 takes a split bill line out of the export and ships its
    // configurations instead.
    expect(lettersFor([group("one_item")])).toEqual([null, null]);
  });

  it("letters nothing when the model could not tell", () => {
    // `unclear` must not fall towards the expensive answer.
    expect(lettersFor([group("unclear")])).toEqual([null, null]);
  });

  it("letters nothing when the model said nothing at all about the code", () => {
    expect(lettersFor([])).toEqual([null, null]);
  });

  it("letters A and B only when the model says they are configurations", () => {
    expect(lettersFor([group("configurations")])).toEqual(["A", "B"]);
  });

  it("groups pages that TITLE the item differently, under the code the bill uses", () => {
    // Panther's S-200: the specification sheet is headed `S-200` and the shop
    // drawing's title block reads `MUR.2 ARMCHAIR`. The first version 2 read of
    // it produced two separate cards and an item no record could be found for,
    // because the grouping key was each page's own heading.
    const doc = assertStagedDrawings(
      stageDrawings(
        [rawItem({ itemCodeRaw: "S-200", page: 1 }), rawItem({ itemCodeRaw: "MUR.2 ARMCHAIR", page: 2 })],
        FIELDS,
        null,
        null,
        null,
        [{ itemCodes: ["S-200", "MUR.2 ARMCHAIR"], pages: [1, 2], relationship: "one_item", evidence: "same chair" }],
      ),
      FIELDS,
    );
    expect(canonicalCode(doc, "MUR.2 ARMCHAIR")).toBe("S-200");
    expect([...groupItemsByCode(doc.items, doc).keys()]).toEqual(["S200"]);
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
  });

  it("drops a code group it cannot read rather than throwing on it", () => {
    // STAGED JSON IS DATA FROM THE PAST, and this shape has already changed
    // once: the first version 2 read wrote `itemCodeRaw: "S-200 / MLR 2
    // ARMCHAIR"`, and an hour later the field was `itemCodes: string[]`.
    // `assertStagedDrawings` casts rather than validates, so TypeScript said
    // the old rows could not exist and the database said otherwise — every
    // screen reading that run threw `Cannot read properties of undefined`.
    const doc = {
      ...assertStagedDrawings(stageDrawings(pages("S-200"), FIELDS, null, null), FIELDS),
      schemaVersion: 2 as const,
      codeGroups: [{ itemCodeRaw: "S-200 / MLR 2 ARMCHAIR", pages: [1, 2], relationship: "configurations" }],
    } as unknown as Parameters<typeof variantLettersByItem>[1];
    expect(() => variantLettersByItem(pages("S-200").map((raw, index) => ({ ...stageDrawings([raw], FIELDS, null, null).items[0]!, id: `p${index}` })), doc)).not.toThrow();
    expect(canonicalCode(doc, "S-200")).toBe("S-200");
  });

  it("leaves a version 1 run counting pages, because that is how it was staged", () => {
    // Re-reading moves a pack forward. Changing what an already-staged run
    // MEANS, underneath a reviewer who is part way through it, does not.
    const v1 = assertStagedDrawings(
      { ...stageDrawings(pages("S-200"), FIELDS, null, null), schemaVersion: 1, codeGroups: undefined },
      FIELDS,
    );
    expect([...variantLettersByItem(v1.items, v1).values()]).toEqual(["A", "B"]);
  });
});

// ============================================================================
// IMPERIAL — Stage 2 variance row 1, the drawings half.
//
// The unit vocabulary holds `in`, so a page that PRINTS the inch mark is read
// and converted. A feet compound is not in the vocabulary, and the trap the
// project default creates is exactly this one: a figure the page states in feet
// falls through to `projects.default_dimension_unit` and reaches BWS as a
// number that looks like a real measurement.
// ============================================================================
describe("stageDrawings and imperial figures", () => {
  it("takes an inch mark the page printed, and never guesses past it", () => {
    const page = rawItem({
      dimensions: [
        { labelRaw: "WIDTH", valueRaw: '30"', slot: "width", isOverall: true },
        { labelRaw: "HEIGHT", valueRaw: "18 in", slot: "height", isOverall: true },
      ] as RawDrawingDimension[],
    });
    // `cm` as the project default, so a lost unit would be visible.
    const item = stageDrawings([page], FIELDS, null, null, "cm").items[0]!;
    const rows = item.observations.filter((observation) => observation.dimensionSlot !== null);
    expect(rows.map((observation) => [observation.dimensionSlot, observation.value, observation.unit])).toEqual([
      ["W", "30", "in"],
      ["H", "18", "in"],
    ]);
    // Printed, not a suggestion: the page said it.
    expect(rows.every((observation) => unitSourceOf(observation) === "printed")).toBe(true);
  });

  it("refuses a feet compound rather than letting the project default read it", () => {
    const page = rawItem({
      dimensions: [
        { labelRaw: "SEAT HEIGHT", valueRaw: "1'6\"", slot: "seat_height", isOverall: true },
      ] as RawDrawingDimension[],
    });
    const item = stageDrawings([page], FIELDS, null, null, "cm").items[0]!;
    const row = item.observations.find((observation) => observation.dimensionSlot === "SH")!;
    // The wording is kept exactly as the page wrote it — never converted,
    // never dropped.
    expect(row.value).toBe("1'6\"");
    // It votes on nothing: `parseDimensionFigure` refuses it, so it cannot
    // carry the page's unit guess either.
    expect(suggestUnit(["1'6\""])).toEqual({ status: "none" });
  });

  it("does not strip a feet mark off a combined line and read what is left", () => {
    // "5'6\" x 2'4\" x 3'" used to strip the last apostrophe as a trailing
    // unit, leaving a readable 3 — placed, at whatever unit the page or the
    // project offered.
    const item = stageDrawings(
      [rawItem({ dimensionsCombinedRaw: ["5'6\" x 2'4\" x 3'"] })],
      FIELDS,
      null,
      null,
      "cm",
    ).items[0]!;
    expect(item.observations.filter((observation) => observation.attrGroup === "dimension")).toEqual([]);
    expect(item.observations.some((observation) => (observation.value ?? "").includes("3'"))).toBe(true);
  });
});

// ============================================================================
// CONFIGURATIONS A PAGE NAMES, STAGED — schemaVersion 3 (2026-09-23).
//
// Synthetic, in the SHAPE of Panther's S-301 sheet: one set of overall
// dimensions and a fabric heading "As per room type" whose four lines cover
// five room types. The names are invented.
// ============================================================================
describe("staging the configurations a page names", () => {
  const sheet = (): RawDrawingItem => ({
    ...rawItem({ itemCodeRaw: "Q-301", itemNameRaw: "Desk chair" }),
    dimensions: [
      { labelRaw: "Width", valueRaw: "550", unitRaw: "mm", slot: "width", slotEvidence: "labelled WIDTH", isOverall: true, configurations: [] },
    ],
    materials: [
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker A, Ref. X", materialCodeRaw: null, configurations: ["Type 1", "Type 5"] },
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker B, Ref. Y", materialCodeRaw: null, configurations: ["Type 2"] },
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker C, Ref. Z", materialCodeRaw: null, configurations: ["Type 3"] },
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker D, Ref. W", materialCodeRaw: null, configurations: ["Type 4"] },
    ],
    configurations: ["Type 1", "Type 5", "Type 2", "Type 3", "Type 4"].map((name) => ({ name, nameRaw: name, evidence: null })),
  });

  it("gives every room type's fabric COM 1 — on its own configuration, not COM 2 on the chair", () => {
    const staged = stageDrawings([sheet()], FIELDS, null, null);
    expect(staged.schemaVersion).toBe(3);
    const fabrics = staged.items[0]!.observations.filter((o) => o.labelRaw === "FABRIC REFERENCE");
    expect(fabrics.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com1", "f-com1", "f-com1"]);
    expect(fabrics.map((o) => o.configurations)).toEqual([["Type 1", "Type 5"], ["Type 2"], ["Type 3"], ["Type 4"]]);
    expect(staged.items[0]!.configurations?.map((entry) => entry.name)).toEqual(["Type 1", "Type 5", "Type 2", "Type 3", "Type 4"]);
  });

  it("puts a shared fabric in COM 1 everywhere, and a configuration's own fabric after it", () => {
    const item = sheet();
    item.materials = [
      { labelRaw: "FABRIC", valueRaw: "Shared cloth", materialCodeRaw: null, configurations: [] },
      { labelRaw: "FABRIC REFERENCE", valueRaw: "Maker B, Ref. Y", materialCodeRaw: null, configurations: ["Type 2"] },
    ];
    const fabrics = stageDrawings([item], FIELDS, null, null).items[0]!.observations.filter((o) => o.attrGroup === "material");
    expect(fabrics.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com2"]);
  });

  it("stages an item that names no configurations exactly as version 2 did", () => {
    const plain = rawItem({ materials: [{ labelRaw: "FABRIC", valueRaw: "Linen", materialCodeRaw: null }, { labelRaw: "FABRIC", valueRaw: "Wool", materialCodeRaw: null }] });
    const item = stageDrawings([plain], FIELDS, null, null).items[0]!;
    expect("configurations" in item).toBe(false);
    expect("depictsConfigurations" in item).toBe(false);
    expect(item.observations.some((o) => "configurations" in o)).toBe(false);
    // Page-wide claiming, unchanged: two fabrics on one page are COM 1 and COM 2.
    expect(item.observations.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com2"]);
  });

  it("re-reads a callout at read time within the row's own configuration", () => {
    // A row staged with no field (an older word list gave up on it) is filled
    // at READ time by `upgradeCalloutGuesses`, which must seed what is taken
    // per configuration too, or Type 3's fabric reads as COM 2.
    const staged = stageDrawings([sheet()], FIELDS, null, null);
    const item = staged.items[0]!;
    const withoutField = {
      ...staged,
      items: [
        {
          ...item,
          observations: item.observations.map((o) =>
            o.configurations?.[0] === "Type 3" ? { ...o, specFieldId: null, attrGroup: "other" as const } : o,
          ),
        },
      ],
    };
    const read = assertStagedDrawings(withoutField, FIELDS);
    const type3 = read.items[0]!.observations.find((o) => o.configurations?.[0] === "Type 3");
    expect(type3?.specFieldId).toBe("f-com1");
  });
});
