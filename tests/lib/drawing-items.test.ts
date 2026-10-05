// Pure tier. Staging the ITEM-CENTRIC drawings read (schemaVersion 4).
//
// Every fixture is SYNTHETIC — invented codes, invented materials, invented
// figures — written to the SHAPES the version 4 read was built for: one item on
// two pages under two titles, a codeless continuation page, a five-
// configuration sheet, an imperial sheet whose plan and elevation disagree, a
// page with no item, a statement-rich specification sheet and a finish printed
// as a code alone. No client document content is in this repo.
import { describe, expect, it } from "vitest";
import {
  assertStagedDrawings,
  codeConfigurations,
  crossPageClaims,
  drawingItemBlockers,
  foldableRow,
  namedConfigurationPlans,
  resolveStagedItem,
  variantLettersByItem,
  wasReadByModel,
  type DrawingItem,
  type OccupiedSlots,
  type SpecFieldEntry,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { pagesInWords, stageDrawingsV4 } from "@/lib/drawing-items";
import { resolveStagedRun } from "@/lib/drawing-resolution";
import { DrawingsItemsOutput, MAX_STATEMENTS } from "@/lib/extraction-schema";
import { finishWordsOf, resolveFinishCode, type Finish } from "@/lib/finishes";
import type { RecordEntry } from "@/lib/record-refs";
import { reduceStagedDrawings } from "../../tools/drawings-golden";

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

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

function record(id: string, code: string, runId = "run-main", runName = "Main"): RecordEntry {
  return {
    id,
    recordNo: 1,
    label: `P00001-${id}`,
    itemDescription: "Item",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId,
    runName,
    parentId: null,
    variantLabel: null,
    version: 1,
  };
}

const fig = (valueRaw: string, extra: Record<string, unknown> = {}) => ({
  valueRaw,
  unitRaw: null,
  view: null,
  page: 1,
  evidence: "spans the whole item",
  candidates: [],
  ...extra,
});

const noOverall = { width: null, depth: null, height: null, seatHeight: null, diameter: null };

/** One raw item with every field at its empty value. */
function rawItem(overrides: Record<string, unknown> = {}) {
  return {
    codes: ["X-100"],
    name: "Armchair",
    pages: [1],
    whyOneItem: null,
    overall: noOverall,
    combinedLine: null,
    configurations: [],
    finishes: [],
    statements: [],
    mockup: { is: false, evidence: null },
    otherDimensions: [],
    notes: [],
    pictures: [],
    uncertain: [],
    confidence: "high",
    ...overrides,
  };
}

/** Parse as the response check does, then stage, then read back as every screen does. */
function stage(raw: unknown, projectDefault: "mm" | "cm" | null = null, filename = "X-SET drawings.pdf"): StagedDrawings {
  const parsed = DrawingsItemsOutput.parse(raw);
  const staged = stageDrawingsV4(parsed, FIELDS, filename, projectDefault);
  return assertStagedDrawings(JSON.parse(JSON.stringify(staged)), FIELDS);
}

const one = (raw: Record<string, unknown>, projectDefault: "mm" | "cm" | null = null) =>
  stage({ documentNotes: null, nonItemPages: [], items: [rawItem(raw)] }, projectDefault).items[0]!;

const rowLabelled = (item: DrawingItem, label: string) => item.observations.find((o) => o.labelRaw === label);

describe("one item on two pages under two titles", () => {
  const raw = {
    codes: ["X-200", "MUR.2 ARMCHAIR", "AM-ID-PL-X-200"],
    pages: [1, 2],
    whyOneItem: "page 1 is the sheet and page 2 the shop drawing of the same armchair",
    overall: {
      ...noOverall,
      width: fig("840", { unitRaw: "mm", view: "SPECIFICATION TABLE", evidence: "labelled WIDTH 840mm" }),
      depth: fig("790", { view: "SIDE ELEVATION", page: 2, evidence: "spans the side elevation" }),
      height: fig("720", { unitRaw: "mm", view: "SPECIFICATION TABLE" }),
    },
    finishes: [
      { part: "FABRIC", spec: "Invented Amber Cloth", code: null, configurations: [], page: 1, swatch: null },
      { part: "FEET", spec: "Invented dark oak", code: "WD-01", configurations: [], page: 2, swatch: { page: 2, box: [0.7, 0.1, 0.8, 0.2] } },
    ],
    notes: [
      { text: "REMARKS: SUBMIT SHOP DRAWINGS.", page: 1 },
      { text: "REMARKS: PROVIDE A SAMPLE.", page: 1 },
      { text: "REMARKS: CHECK SITE ACCESS.", page: 2 },
    ],
  };

  it("is ONE staged item spanning both pages, with every code on it", () => {
    const staged = stage({ documentNotes: null, nonItemPages: [], items: [rawItem(raw)] });
    expect(staged.schemaVersion).toBe(4);
    expect(staged.items).toHaveLength(1);
    const item = staged.items[0]!;
    expect(item.pages).toEqual([1, 2]);
    expect(item.page).toBe(1);
    expect(item.itemCodeRaw).toBe("X-200");
    expect(item.itemCodes).toEqual(["X-200", "MUR.2 ARMCHAIR", "AM-ID-PL-X-200"]);
    expect(item.whyOneItem).toMatch(/same armchair/);
    expect(pagesInWords(item.pages!)).toBe("pages 1–2");
  });

  it("puts each value's own page on its row", () => {
    const item = one(raw);
    const depth = item.observations.find((o) => o.dimensionSlot === "D")!;
    expect(depth.page).toBe(2);
    expect(depth.view).toBe("SIDE ELEVATION");
    expect(depth.slotSuggested).toBe(false);
    expect(depth.isOverall).toBe(true);
    expect(depth.slotReason).toMatch(/spans the side elevation/);
    expect(rowLabelled(item, "FEET")!.page).toBe(2);
    expect(rowLabelled(item, "FABRIC")!.page).toBe(1);
    expect(rowLabelled(item, "FEET")!.swatchProposal).toEqual({ page: 2, bbox: [0.7, 0.1, 0.8, 0.2] });
  });

  it("merges a page's remarks into one block, and never a block across two pages", () => {
    const item = one(raw);
    const remarks = item.observations.filter((o) => o.labelRaw === "Remarks");
    expect(remarks).toHaveLength(2);
    expect(remarks.find((o) => o.page === 1)!.value).toBe("SUBMIT SHOP DRAWINGS.\nPROVIDE A SAMPLE.");
    expect(remarks.find((o) => o.page === 2)!.value).toBe("CHECK SITE ACCESS.");
  });

  it("reads an unprinted unit off the overall figures, flagged, as version 3 does", () => {
    // Page 2 prints 790 with no unit; the item's overall figures sit in one
    // scale, so the vote says millimetres — `figures`, amber, correctable.
    const item = one(raw);
    const depth = item.observations.find((o) => o.dimensionSlot === "D")!;
    expect([depth.unit, depth.unitSource, depth.unitSuggested]).toEqual(["mm", "figures", true]);
    expect(item.observations.find((o) => o.dimensionSlot === "W")!.unitSource).toBe("printed");

    // A sofa sheet drawn in centimetres states no unit anywhere: 190 x 79 x 72.
    const sofa = one({
      overall: { ...noOverall, width: fig("190"), depth: fig("79"), height: fig("72") },
      otherDimensions: [{ label: "RAIL", valueRaw: "5", unitRaw: null, view: null, page: 1 }],
    });
    expect(sofa.observations.filter((o) => o.dimensionSlot).map((o) => o.unit)).toEqual(["cm", "cm", "cm"]);
    expect(rowLabelled(sofa, "RAIL")!.unit).toBe("cm");
  });

  it("asks for the unit where the overall figures disagree, and lets the project's default stand in", () => {
    const mixed = { overall: { ...noOverall, width: fig("190"), depth: fig("790") } };
    const item = one(mixed);
    const width = item.observations.find((o) => o.dimensionSlot === "W")!;
    expect(width.unit).toBeNull();
    const blockers = drawingItemBlockers(item, { runs: [], suggested: [] }, NO_OCCUPANCY);
    expect(blockers.some((b) => b.code === "unit_missing" && b.observationId === width.id)).toBe(true);
    const withDefault = one(mixed, "mm").observations.find((o) => o.dimensionSlot === "W")!;
    expect([withDefault.unit, withDefault.unitSource]).toEqual(["mm", "project_default"]);
  });

  it("resolves by its first code, fanning out across the phases as v3 does", () => {
    const staged = stage({ documentNotes: null, nonItemPages: [], items: [rawItem(raw)] });
    const item = staged.items[0]!;
    const fanOut = resolveStagedItem(staged, item, [record("r-main", "X-200"), record("r-mur", "X-200", "run-mur", "Mock-up")]);
    expect(new Set(fanOut.suggested)).toEqual(new Set(["r-main", "r-mur"]));
  });

  it("keeps the suffix rule unchanged: a title ending a bill code, settled by the drawing number", () => {
    const staged = stage(
      { documentNotes: null, nonItemPages: [], items: [rawItem({ codes: ["X-33", "AM-ID-PL-X-33"] })] },
      null,
      "AM-ID-PL-X-33 Desk.pdf",
    );
    const resolution = resolveStagedItem(staged, staged.items[0]!, [record("r-pl", "PL-X-33"), record("r-gr", "GR-X-33")]);
    expect(resolution.suggested).toEqual(["r-pl"]);
    expect(resolution.matchedBy?.code).toBe("PL-X-33");
  });

  it("is reduced by the harness as ONE read item, never regrouped", () => {
    const read = reduceStagedDrawings(stage({ documentNotes: null, nonItemPages: [], items: [rawItem(raw)] }, "mm"));
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.codes).toEqual(["X-200", "MUR.2 ARMCHAIR", "AM-ID-PL-X-200"]);
    expect(read.items[0]!.pages).toEqual([1, 2]);
    expect(read.items[0]!.overall.W).toEqual([840]);
    expect(read.items[0]!.overall.D).toEqual([790]);
  });
});

describe("a codeless continuation page, and a page with no item", () => {
  it("stays on its item's card, where the read put it", () => {
    const staged = stage({
      documentNotes: null,
      nonItemPages: [{ page: 3, why: "general notes only" }],
      items: [
        rawItem({
          codes: ["X-100"],
          pages: [1, 2],
          whyOneItem: "page 2 has no title block and continues the sections of page 1",
          otherDimensions: [{ label: "ARM HEIGHT", valueRaw: "620", unitRaw: "mm", view: "SECTION B", page: 2 }],
        }),
      ],
    });
    expect(staged.items).toHaveLength(1);
    expect(staged.items[0]!.pages).toEqual([1, 2]);
    expect(staged.nonItemPages).toEqual([{ page: 3, why: "general notes only" }]);
    // No card for the non-item page: nothing staged on page 3.
    expect(staged.items.some((item) => item.pages?.includes(3))).toBe(false);
    const arm = rowLabelled(staged.items[0]!, "ARM HEIGHT")!;
    expect(arm.page).toBe(2);
    expect(arm.attrGroup).toBe("note");
    expect(foldableRow(arm)).toBe(true);
  });

  it("says an item with no code has no code, not that the bill is missing", () => {
    const staged = stage({ documentNotes: null, nonItemPages: [], items: [rawItem({ codes: [] })] });
    const item = staged.items[0]!;
    expect(item.itemCodeRaw).toBeNull();
    const resolution = resolveStagedItem(staged, item, [record("r", "X-100")]);
    const blockers = drawingItemBlockers(item, resolution, NO_OCCUPANCY);
    expect(blockers.find((b) => b.code === "no_targets")?.message).toMatch(/no item code/);
  });
});

describe("a five-configuration sheet", () => {
  const raw = rawItem({
    codes: ["X-301"],
    name: "Desk chair",
    pages: [1, 2],
    overall: { ...noOverall, width: fig("550", { unitRaw: "mm" }), height: fig("735", { unitRaw: "mm" }) },
    configurations: [1, 2, 3, 4, 5].map((n) => ({
      name: `Type ${n}`,
      nameRaw: n === 1 || n === 5 ? "Type 1 & 5" : `Type ${n}`,
      differsIn: "fabric",
      pages: [1],
      overall: n === 2 ? { ...noOverall, width: fig("600", { unitRaw: "mm" }) } : noOverall,
    })),
    finishes: [
      { part: "FABRIC REFERENCE", spec: "Invented Raffia", code: null, configurations: ["Type 1", "Type 5"], page: 1, swatch: null },
      { part: "FABRIC REFERENCE", spec: "Invented Velvet", code: null, configurations: ["Type 2"], page: 1, swatch: null },
      { part: "FABRIC REFERENCE", spec: "Invented Linen", code: null, configurations: ["Type 3"], page: 1, swatch: null },
      { part: "FABRIC REFERENCE", spec: "Invented Wool", code: null, configurations: ["Type 4"], page: 1, swatch: null },
      { part: "FRAME", spec: "Invented bronze", code: "MT-01", configurations: [], page: 2, swatch: null },
    ],
  });
  const staged = () => stage({ documentNotes: null, nonItemPages: [], items: [raw] });

  it("names its five configurations and letters nothing", () => {
    const doc = staged();
    const item = doc.items[0]!;
    expect(item.configurations?.map((entry) => entry.name)).toEqual(["Type 1", "Type 2", "Type 3", "Type 4", "Type 5"]);
    expect(variantLettersByItem(doc.items, doc).get(item.id)).toBeNull();
    const configurations = [...codeConfigurations(doc.items, doc).values()][0]!;
    expect(configurations.effective.map((entry) => entry.label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
  });

  it("produces a plan per row, exactly as the v3 machinery does", () => {
    const doc = staged();
    const item = doc.items[0]!;
    const plan = namedConfigurationPlans(doc.items, doc).get(item.id)!;
    expect(plan.labels).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
    const raffia = item.observations.find((o) => o.value === "Invented Raffia")!;
    expect(plan.rows[raffia.id]).toEqual(["TYPE 1", "TYPE 5"]);
    const frame = rowLabelled(item, "FRAME")!;
    expect(plan.rows[frame.id]).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
  });

  it("lands Type 2's own width on Type 2, and the shared width on the other four — never two widths on one chair", () => {
    const doc = staged();
    const item = doc.items[0]!;
    const plan = namedConfigurationPlans(doc.items, doc).get(item.id)!;
    const widths = item.observations.filter((o) => o.dimensionSlot === "W");
    expect(widths).toHaveLength(2);
    const shared = widths.find((o) => o.value === "550")!;
    const own = widths.find((o) => o.value === "600")!;
    expect(plan.rows[shared.id]).toEqual(["TYPE 1", "TYPE 3", "TYPE 4", "TYPE 5"]);
    expect(plan.rows[own.id]).toEqual(["TYPE 2"]);
    const resolved = resolveStagedRun(doc, {
      records: [record("r-301", "X-301")],
      occupied: NO_OCCUPANCY,
      variants: new Map(),
      finishes: [],
      variantSources: new Map(),
    }, FIELDS)[0]!;
    expect(resolved.blockers.filter((b) => b.code === "dimension_slot_taken")).toEqual([]);
  });

  it("gives each configuration's fabric COM 1 within that configuration", () => {
    const item = staged().items[0]!;
    for (const value of ["Invented Raffia", "Invented Velvet", "Invented Linen", "Invented Wool"]) {
      expect(item.observations.find((o) => o.value === value)!.specFieldId).toBe("f-com1");
    }
    expect(rowLabelled(item, "FRAME")!.specFieldId).toBe("f-metal1");
  });

  it("raises no cross-page claim: one item is one card", () => {
    const doc = staged();
    expect(crossPageClaims(doc.items, doc, FIELDS).size).toBe(0);
  });
});

describe("an imperial sheet whose plan and elevation disagree", () => {
  const item = () =>
    one({
      codes: ["X-33"],
      name: "Desk",
      overall: {
        ...noOverall,
        width: fig(`5'-7"`, {
          view: "PLAN",
          evidence: "PLAN, the dimension spanning the top",
          candidates: [{ valueRaw: `5'-6"`, unitRaw: null, view: "ELEVATION 2", page: 1 }],
        }),
        depth: fig(`2'-7 1/4"`, { view: "PLAN" }),
        height: fig(`2'-5 1/2"`, { view: "ELEVATION 1" }),
      },
      uncertain: [{ about: "width", why: "The plan prints 5'-7\" and ELEVATION 2 prints 5'-6\"; the plan spans the top." }],
      confidence: "medium",
    });

  it("reads feet and inches as a printed unit, and keeps the rival figure beside the slot", () => {
    const staged = item();
    const width = staged.observations.find((o) => o.dimensionSlot === "W")!;
    expect(width.value).toBe(`5'-7"`);
    expect(width.unit).toBe("in");
    expect(width.unitSource).toBe("printed");
    expect(width.candidates).toEqual([
      { valueRaw: `5'-6"`, unitRaw: null, view: "ELEVATION 2", page: 1, observationId: expect.any(String) },
    ]);
    // Brief F: the rival figure is a MEASURED ROW too, folded with the other
    // dimensions, so "Use this instead" can swap it into the slot.
    const rival = staged.observations.find((o) => o.id === width.candidates![0]!.observationId)!;
    expect(rival).toMatchObject({ attrGroup: "note", isOverall: false, value: `5'-6"`, unit: "in", view: "ELEVATION 2", page: 1 });
    expect(rival.dimensionSlot ?? null).toBeNull();
    expect(staged.uncertain).toEqual([{ about: "width", why: expect.stringMatching(/ELEVATION 2/) }]);
  });

  it("composes to millimetres through the harness's reduction", () => {
    const read = reduceStagedDrawings({ schemaVersion: 4, kind: "shop_drawings", filename: null, documentNotes: null, items: [item()] });
    expect(read.items[0]!.overall).toMatchObject({ W: [1702], D: [794], H: [749] });
  });

  it("flags a view whose own word names a different slot, and keeps the read's slot", () => {
    const staged = one({ overall: { ...noOverall, width: fig("900", { unitRaw: "mm", view: "DEPTH" }) } });
    const width = staged.observations.find((o) => o.dimensionSlot === "W")!;
    expect(width.slotSuggested).toBe(true);
    expect(width.slotReason).toMatch(/labelled "DEPTH"/);
  });
});

describe("a statement-rich specification sheet", () => {
  const statements = [
    ["FILLING", "Invented feather wrap"],
    ["LEAD TIME", "12 weeks"],
    ["FR STANDARD", "Invented standard, medium hazard"],
    ["SUPPLIER", "TO BID"],
    ["CUSHION", "Loose"],
    ["GLIDES", "Felt"],
  ].map(([label, value]) => ({ label, value, page: 1, configurations: [] }));

  it("keeps every labelled line as its own note, label and value as printed", () => {
    const item = one({ statements });
    for (const [label, value] of [
      ["FILLING", "Invented feather wrap"],
      ["LEAD TIME", "12 weeks"],
      ["GLIDES", "Felt"],
    ]) {
      const row = rowLabelled(item, label!)!;
      expect(row.attrGroup).toBe("note");
      expect(row.value).toBe(value);
      expect(row.page).toBe(1);
    }
    // TO BID is a marker, kept as the page's word and read as TBC.
    expect(rowLabelled(item, "SUPPLIER")!.state).toBe("tbc");
    expect(item.observations.filter((o) => o.attrGroup === "note")).toHaveLength(6);
  });

  it("truncates an over-long list and SAYS so, rather than failing the paid read", () => {
    const many = Array.from({ length: MAX_STATEMENTS + 3 }, (_, index) => ({ label: `LINE ${index}`, value: "x", page: 1, configurations: [] }));
    const item = one({ statements: many });
    expect(item.observations.filter((o) => o.attrGroup === "note")).toHaveLength(MAX_STATEMENTS);
    expect(item.uncertain?.some((entry) => /listed 203 statements; only the first 200/.test(entry.why))).toBe(true);
  });
});

describe("a finish printed as a code alone", () => {
  it("records the code as the value, confirmed, and lets the library supply the words", () => {
    const item = one({ finishes: [{ part: null, spec: null, code: "GR TIM 04", configurations: [], page: 1, swatch: null }] });
    const row = item.observations.find((o) => o.materialCodeRaw)!;
    expect(row.valueRaw).toBeNull();
    expect(row.value).toBe("GR TIM 04");
    expect(row.state).toBe("confirmed");
    // The read-time upgrade reads the stacked boxes as the bill's code.
    expect(row.materialCodeRaw).toBe("GR-TIM-04");
    expect(row.specFieldId).toBe("f-timber1");
    const blockers = drawingItemBlockers(item, { runs: [], suggested: [] }, NO_OCCUPANCY);
    expect(blockers.filter((b) => b.code === "empty_value" || b.code === "no_state")).toEqual([]);

    expect(finishWordsOf(row.materialCodeRaw, row.value)).toBeNull();
    const library: Finish[] = [
      {
        id: "fin-1",
        code: "GR-TIM-04",
        codeNorm: "GR-TIM-04",
        codeOrigin: "client",
        kind: "timber",
        description: "Invented oak, natural",
        supplierRaw: null,
        reference: null,
        colour: null,
        state: "confirmed",
      },
    ];
    expect(resolveFinishCode(row.materialCodeRaw, row.value, library)).toMatchObject({ status: "matched" });
    // Words that DIFFER are still a conflict, exactly as before.
    expect(resolveFinishCode(row.materialCodeRaw, "Invented walnut", library)).toMatchObject({ status: "conflict" });
  });
});

describe("a code-only finish against a library the schedule filled first", () => {
  const described = (code: string): Finish => ({
    id: `fin-${code}`,
    code,
    codeNorm: code,
    codeOrigin: "client",
    kind: "timber",
    description: "Invented oak, natural",
    supplierRaw: null,
    reference: null,
    colour: null,
    state: "confirmed",
  });

  it("reads a stacked tag with a sub-code as the schedule's code, and links rather than conflicts", () => {
    const item = one({ finishes: [{ part: null, spec: null, code: "GR TIM 08.1", configurations: [], page: 1, swatch: null }] });
    const row = item.observations.find((o) => o.materialCodeRaw)!;
    expect(row.materialCodeRaw).toBe("GR-TIM-08.1");
    expect(row.value).toBe("GR TIM 08.1");
    expect(resolveFinishCode(row.materialCodeRaw, row.value, [described("GR-TIM-08.1")])).toMatchObject({
      status: "matched",
      finish: { id: "fin-GR-TIM-08.1" },
    });
    // 08.1 is not 08: the sub-code is part of the code.
    expect(resolveFinishCode(row.materialCodeRaw, row.value, [described("GR-TIM-08")])).toMatchObject({ status: "new" });
  });

  it("keeps the conflict for a callout whose OWN words differ from the described row", () => {
    const item = one({ finishes: [{ part: "TOP", spec: "Invented walnut", code: "GR TIM 04", configurations: [], page: 1, swatch: null }] });
    const row = item.observations.find((o) => o.materialCodeRaw)!;
    expect(resolveFinishCode(row.materialCodeRaw, row.value, [described("GR-TIM-04")])).toMatchObject({ status: "conflict" });
  });
});

describe("the read's own tolerance", () => {
  it("survives bare values and drops a configuration name the item does not list", () => {
    const parsed = DrawingsItemsOutput.parse({
      documentNotes: null,
      nonItemPages: "not a list",
      items: [
        {
          ...rawItem(),
          codes: "X-100",
          pages: 2,
          overall: { ...noOverall, width: "840" },
          configurations: ["Type 1"],
          finishes: ["Invented cloth"],
          statements: [{ label: "FILLING", value: "Feathers", page: 1, configurations: ["Type 1", "Type 9"] }],
          notes: ["Hand made."],
          uncertain: ["Could not read the depth."],
          pictures: [{ kind: "section", page: 1, box: [0.1, 0.1, 0.4, 0.4] }, "not a picture"],
          mockup: "yes",
        },
      ],
    });
    const item = parsed.items[0]!;
    expect(item.codes).toEqual(["X-100"]);
    expect(item.pages).toEqual([2]);
    expect(item.overall.width?.valueRaw).toBe("840");
    expect(item.configurations.map((entry) => entry.name)).toEqual(["Type 1"]);
    expect(item.finishes[0]).toMatchObject({ part: null, spec: "Invented cloth", code: null });
    expect(item.statements[0]!.configurations).toEqual(["Type 1"]);
    expect(item.notes[0]!.text).toBe("Hand made.");
    expect(item.uncertain[0]).toEqual({ about: "other", why: "Could not read the depth." });
    expect(item.pictures).toHaveLength(1);
    // The schema's `mockup` is the quoted evidence: any words are a mock-up.
    expect(item.mockup).toEqual({ is: true, evidence: "yes" });
    expect(parsed.nonItemPages).toEqual([]);
  });

  it("reads the schema's list of slots, a second entry for one slot kept as a candidate of the first", () => {
    const parsed = DrawingsItemsOutput.parse({
      documentNotes: "",
      nonItemPages: [],
      items: [
        {
          ...rawItem(),
          name: "",
          whyOneItem: "",
          combinedLine: "",
          overall: [
            { slot: "width", valueRaw: "840", unitRaw: "", view: "PLAN", page: 1, evidence: "spans the plan", candidates: [] },
            { slot: "depth", valueRaw: "790", unitRaw: "mm", view: "", page: 2, evidence: "side", candidates: [] },
            { slot: "width", valueRaw: "835", unitRaw: "", view: "FRONT", page: 2, evidence: "front", candidates: [] },
            { slot: "length", valueRaw: "1", unitRaw: "", view: "", page: 1, evidence: "", candidates: [] },
          ],
          finishes: [{ part: "", spec: null, code: "WD-01", configurations: [], page: 1, swatch: [{ page: 1, box: [0.1, 0.1, 0.2, 0.2] }] }],
          mockup: { is: false, evidence: "" },
        },
      ],
    });
    const item = parsed.items[0]!;
    expect(parsed.documentNotes).toBeNull();
    expect(item.name).toBeNull();
    expect(item.combinedLine).toBeNull();
    expect(item.overall.width).toMatchObject({ valueRaw: "840", unitRaw: null, view: "PLAN" });
    expect(item.overall.width?.candidates).toEqual([{ valueRaw: "835", unitRaw: null, view: "FRONT", page: 2 }]);
    expect(item.overall.depth).toMatchObject({ valueRaw: "790", unitRaw: "mm", view: null, page: 2 });
    expect(item.overall.height).toBeNull();
    expect(item.finishes[0]).toMatchObject({ part: null, spec: null, code: "WD-01", swatch: { page: 1, box: [0.1, 0.1, 0.2, 0.2] } });
    expect(item.mockup.evidence).toBeNull();
  });

  it("reads the schema's FLAT shape back into the one staging reads", () => {
    const staged = stage({
      documentNotes: "",
      nonItemPages: ["3: general notes only", "page 4 - legend"],
      items: [
        {
          ...rawItem(),
          codes: ["X-301"],
          overall: [
            { slot: "width", valueRaw: "550 mm", view: "TABLE", page: 1, evidence: "labelled", candidates: ["560 (PLAN, page 2)"], configurations: [] },
            { slot: "width", valueRaw: "600 mm", view: "TABLE", page: 1, evidence: "Type 2 row", candidates: [], configurations: ["Type 2"] },
            { slot: "height", valueRaw: "1'-6\"", view: "SIDE", page: 1, evidence: "side", candidates: [], configurations: ["Type 9"] },
          ],
          configurations: [
            { name: "Type 1", nameRaw: "Type 1", differsIn: "fabric" },
            { name: "Type 2", nameRaw: "Type 2", differsIn: "fabric and width" },
          ],
          finishes: [
            { part: "SEAT", spec: "Invented raffia", code: null, configurations: ["Type 1"], page: 1, swatchBox: [0.6, 0.1, 0.7, 0.2] },
            { part: "SEAT", spec: "Invented velvet", code: null, configurations: ["Type 2"], page: 1, swatchBox: [] },
          ],
          statements: [
            { label: "", value: "REMARKS: SUBMIT SAMPLES.", page: 1, configurations: [] },
            { label: "", value: "REMARKS: CHECK ACCESS.", page: 1, configurations: [] },
            { label: "FILLING", value: "Feathers", page: 1, configurations: [] },
          ],
          mockup: "title block reads MOCKUP ROOM",
          otherDimensions: [{ label: "ARM HEIGHT, SECTION B", valueRaw: "620 mm", page: 1 }],
          uncertain: ["width: the plan prints 560", "nothing labelled here"],
        },
      ],
    });
    expect(staged.nonItemPages).toEqual([
      { page: 3, why: "general notes only" },
      { page: 4, why: "legend" },
    ]);
    const item = staged.items[0]!;
    const widths = item.observations.filter((o) => o.dimensionSlot === "W");
    expect(widths.map((o) => [o.value, o.unit, o.unitSource, o.configurations ?? []])).toEqual([
      ["550", "mm", "printed", ["Type 1"]],
      ["600", "mm", "printed", ["Type 2"]],
    ]);
    expect(widths[0]!.candidates).toEqual([
      { valueRaw: "560 (PLAN, page 2)", unitRaw: null, view: null, page: null, observationId: expect.any(String) },
    ]);
    // The one-line candidate is read apart into its figure, view and page, and
    // lands on the configuration its slot row lands on (brief F).
    expect(item.observations.find((o) => o.id === widths[0]!.candidates![0]!.observationId)).toMatchObject({
      attrGroup: "note",
      isOverall: false,
      value: "560",
      unit: "mm",
      view: "PLAN",
      page: 2,
      configurations: ["Type 1"],
    });
    // A size naming a configuration the item does not list reads as the item's own.
    expect(item.observations.find((o) => o.dimensionSlot === "H")).toMatchObject({ value: `1'-6"`, unit: "in" });
    expect(item.observations.find((o) => o.value === "Invented raffia")!.swatchProposal).toEqual({ page: 1, bbox: [0.6, 0.1, 0.7, 0.2] });
    expect(item.observations.find((o) => o.value === "Invented velvet")!.swatchProposal).toBeUndefined();
    expect(rowLabelled(item, "Remarks")!.value).toBe("SUBMIT SAMPLES.\nCHECK ACCESS.");
    expect(rowLabelled(item, "FILLING")!.value).toBe("Feathers");
    expect(rowLabelled(item, "ARM HEIGHT, SECTION B")).toMatchObject({ value: "620", unit: "mm" });
    expect(item.mockup).toEqual({ is: true, evidence: "title block reads MOCKUP ROOM" });
    expect(item.uncertain).toEqual([
      { about: "width", why: "the plan prints 560" },
      { about: "other", why: "nothing labelled here" },
    ]);
  });

  it("refuses a read whose items are not a list: that is a failure to answer", () => {
    expect(DrawingsItemsOutput.safeParse({ documentNotes: null, nonItemPages: [], items: "X-100" }).success).toBe(false);
  });

  it("reads a section picture as a detail, and proposes it", () => {
    const item = one({ pictures: [{ kind: "section", page: 1, box: [0.1, 0.1, 0.4, 0.4] }] });
    expect(item.viewRegions).toEqual([{ viewType: "detail", page: 1, bbox: [0.1, 0.1, 0.4, 0.4] }]);
    expect(item.imageProposal?.viewType).toBe("detail");
  });
});

describe("the page-gluing does not run on version 4", () => {
  it("keeps two figures printed on two pages as two rows", () => {
    const item = one({
      pages: [1, 2],
      otherDimensions: [
        { label: "RAIL", valueRaw: "50", unitRaw: "mm", view: "FRONT", page: 1 },
        { label: "RAIL", valueRaw: "50", unitRaw: "mm", view: "FRONT", page: 2 },
      ],
    });
    expect(item.observations.filter((o) => o.labelRaw === "RAIL").map((o) => o.page)).toEqual([1, 2]);
  });

  it("never runs the slot guess, even on an item that printed no size at all", () => {
    const item = one({ statements: [{ label: "SEAT", value: "450", page: 1, configurations: [] }] });
    expect(wasReadByModel(item)).toBe(true);
    expect(item.observations.some((o) => o.dimensionSlot)).toBe(false);
  });

  it("records a mock-up drawing's evidence, which nothing reads yet", () => {
    const item = one({ mockup: { is: true, evidence: "title block reads MOCKUP ROOM" } });
    expect(item.mockup).toEqual({ is: true, evidence: "title block reads MOCKUP ROOM" });
  });

  it("takes a combined line's PRINTED prefixes only, and keeps the line", () => {
    const item = one({ combinedLine: "W1520 TBC x D560 x H1005 mm" });
    expect(item.observations.filter((o) => o.dimensionSlot).map((o) => [o.dimensionSlot, o.value, o.unit, o.state])).toEqual([
      ["W", "1520 TBC", "mm", "tbc"],
      ["D", "560", "mm", "confirmed"],
      ["H", "1005", "mm", "confirmed"],
    ]);
    expect(rowLabelled(item, "Overall size as printed")!.value).toBe("W1520 TBC x D560 x H1005 mm");
    expect(item.observations.filter((o) => o.dimensionSlot).every((o) => o.slotSuggested === false)).toBe(true);
  });

  it("reads three bare figures as W x D x H in printed order, flagged as the convention", () => {
    // The read left the slots out: the convention fills them, amber.
    const bare = one({ combinedLine: "80 x 70 x 90 cm" });
    const slotted = bare.observations.filter((o) => o.dimensionSlot);
    expect(slotted.map((o) => [o.dimensionSlot, o.value, o.unit, o.slotSuggested])).toEqual([
      ["W", "80", "cm", true],
      ["D", "70", "cm", true],
      ["H", "90", "cm", true],
    ]);
    expect(slotted[0]!.slotReason).toMatch(/printed order/);

    // The read placed them itself, as it is asked to: the same flag on its rows.
    const placed = one({
      combinedLine: "80 x 70 x 90 cm",
      overall: { ...noOverall, width: fig("80 cm"), depth: fig("70 cm"), height: fig("90 cm") },
    });
    expect(placed.observations.filter((o) => o.dimensionSlot).map((o) => [o.dimensionSlot, o.value, o.slotSuggested])).toEqual([
      ["W", "80", true],
      ["D", "70", true],
      ["H", "90", true],
    ]);

    // A figure the read gave a slot by something the page printed is never overwritten by the order.
    const differs = one({ combinedLine: "80 x 70 x 90 cm", overall: { ...noOverall, width: fig("70 cm", { evidence: "labelled WIDTH" }) } });
    expect(differs.observations.filter((o) => o.dimensionSlot === "W").map((o) => [o.value, o.slotSuggested])).toEqual([["70", false]]);
  });
});

describe("a mock-up drawing on a project with no mock-up phase (pilot, AM-ID-MUR-FUR-13)", () => {
  const context = (records: RecordEntry[]) => ({
    records,
    occupied: NO_OCCUPANCY,
    variants: new Map(),
    finishes: [],
    variantSources: new Map(),
  });
  const mockupDoc = () =>
    stage(
      {
        items: [
          rawItem({
            codes: ["FUR-13"],
            name: "Side table",
            mockup: { is: true, evidence: "Drawing title 'MOCKUP ROOM FURNITURE DETAILS'" },
          }),
        ],
      },
      null,
      "AM-ID-MUR-FUR-13.pdf",
    );

  it("lands nowhere, and offers the records carrying the client's code first", () => {
    const records = [record("r-02", "GR-FUR-02"), record("r-46", "GR-FUR-13"), record("r-49", "PL-FUR-13")];
    const resolved = resolveStagedRun(mockupDoc(), context(records), FIELDS)[0]!;
    expect(resolved.resolution.runs).toEqual([]);
    expect(resolved.targets).toEqual([]);
    expect(resolved.codeMatches).toEqual(["r-46", "r-49"]);
  });

  it("sends no code matches where the code names nothing", () => {
    const resolved = resolveStagedRun(mockupDoc(), context([record("r-02", "GR-FUR-02")]), FIELDS)[0]!;
    expect(resolved.codeMatches).toBeUndefined();
  });
});

describe("a card whose records already have a picture (Max, 2026-10-05)", () => {
  // The bill printed a picture on each row and the record took it; confirming
  // the drawings card used to replace it with a crop. The resolution now says
  // which of the records the picture would land on already hold one.
  const context = (records: RecordEntry[], withPicture: string[] = [], variantSources = new Map<string, Set<string>>()) => ({
    records,
    occupied: NO_OCCUPANCY,
    variants: new Map(),
    finishes: [],
    variantSources,
    recordsWithPicture: new Set(withPicture),
  });
  const plainDoc = () => stage({ documentNotes: null, nonItemPages: [], items: [rawItem({ codes: ["X-100"] })] });

  it("names the target holding a picture, out of every record the picture would land on", () => {
    const records = [record("r-main", "X-100", "run-main", "Main"), record("r-ve", "X-100", "run-ve", "VE")];
    const resolved = resolveStagedRun(plainDoc(), context(records, ["r-main"]), FIELDS)[0]!;
    expect(resolved.targets.sort()).toEqual(["r-main", "r-ve"]);
    expect(resolved.pictureHeld).toEqual({ recordIds: ["r-main"], of: 2 });
  });

  it("sends nothing when no target holds one — not even a picture elsewhere in the project", () => {
    const records = [record("r-main", "X-100"), record("r-other", "X-999", "run-other", "Other")];
    expect(resolveStagedRun(plainDoc(), context(records), FIELDS)[0]!.pictureHeld).toBeUndefined();
    expect(resolveStagedRun(plainDoc(), context(records, ["r-other"]), FIELDS)[0]!.pictureHeld).toBeUndefined();
    // A pure caller that never loaded the pictures reads as "none", the old behaviour.
    const { recordsWithPicture: _omitted, ...withoutPictures } = context(records, ["r-main"]);
    void _omitted;
    expect(resolveStagedRun(plainDoc(), withoutPictures, FIELDS)[0]!.pictureHeld).toBeUndefined();
  });

  it("reads a page of configurations off the VARIANTS it writes to, never the bill line", () => {
    const configured = stage({
      documentNotes: null,
      nonItemPages: [],
      items: [
        rawItem({
          codes: ["X-301"],
          name: "Desk chair",
          configurations: [1, 2, 3].map((n) => ({
            name: `Type ${n}`,
            nameRaw: `Type ${n}`,
            differsIn: "fabric",
            pages: [1],
            overall: noOverall,
          })),
          finishes: [
            { part: "FABRIC REFERENCE", spec: "Invented Raffia", code: null, configurations: ["Type 1"], page: 1, swatch: null },
            { part: "FABRIC REFERENCE", spec: "Invented Velvet", code: null, configurations: ["Type 2"], page: 1, swatch: null },
            { part: "FABRIC REFERENCE", spec: "Invented Linen", code: null, configurations: ["Type 3"], page: 1, swatch: null },
          ],
        }),
      ],
    });
    const variant = (id: string, label: string): RecordEntry => ({
      ...record(id, "X-301"),
      refs: [],
      boqCodes: [],
      parentId: "r-301",
      variantLabel: label,
    });
    // Types 1 and 2 exist already, both written by THIS document (so neither
    // is a question); Type 3 is one the confirm would create.
    const sources = new Map([
      ["v-1", new Set(["intake-run"])],
      ["v-2", new Set(["intake-run"])],
    ]);
    const records = [record("r-301", "X-301"), variant("v-1", "TYPE 1"), variant("v-2", "TYPE 2")];
    // The bill line's own picture is NOT one the page would replace.
    const resolved = resolveStagedRun(configured, context(records, ["r-301", "v-2"], sources), FIELDS, "intake-run")[0]!;
    expect(resolved.named?.labels).toEqual(["TYPE 1", "TYPE 2", "TYPE 3"]);
    expect(resolved.pictureHeld).toEqual({ recordIds: ["v-2"], of: 3 });
    expect(
      resolveStagedRun(configured, context(records, ["r-301"], sources), FIELDS, "intake-run")[0]!.pictureHeld,
    ).toBeUndefined();
  });
});
