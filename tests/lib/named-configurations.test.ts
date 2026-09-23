// Pure tier. Configurations a document NAMES (schemaVersion 3, 2026-09-23):
// which records a page's rows land on, and what stops the card before the
// confirm does. Synthetic fixture in the S-301 shape — see
// tests/fixtures/named-configurations.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alreadyRecorded,
  codeConfigurations,
  configurationEditSummary,
  drawingItemBlockers,
  namedConfigurationPlans,
  namedConfigurationsByCode,
  parentVariantsOf,
  resolveDrawingTargets,
  rowWriteRecords,
  stageDrawings,
  variantLettersByItem,
  type NamedTargets,
  type OccupiedSlots,
  type StagedDrawings,
} from "@/lib/drawing-document";
import { normaliseVariantLabel, VARIANT_LABEL_SHAPE, variantLabelProblem } from "@/lib/record-variants";
import type { RecordEntry } from "@/lib/spec-document";
import { NAMED_FIELDS, namedSheetRun, SHOP_DRAWING, SPEC_SHEET } from "../fixtures/named-configurations";

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

function record(overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: "bill-main",
    recordNo: 1,
    label: "P00001-001",
    itemDescription: "Desk chair",
    categoryId: null,
    categoryName: null,
    refs: ["Q-301"],
    boqCodes: ["Q-301"],
    runId: "run-main",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

const TWO_PHASES = [record(), record({ id: "bill-ve", runId: "run-ve", runName: "MAIN RUN - VE" })];

const sheetOf = (doc: StagedDrawings) => doc.items.find((item) => item.page === 1)!;
const drawingOf = (doc: StagedDrawings) => doc.items.find((item) => item.page === 2)!;

describe("the configurations of a code", () => {
  it("reads five configurations off the S-301 shape, in page order", () => {
    const doc = namedSheetRun();
    const byCode = namedConfigurationsByCode(doc.items, doc);
    expect([...byCode.keys()]).toHaveLength(1);
    const list = [...byCode.values()][0]!;
    expect(list.map((entry) => entry.label)).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"]);
    // Every wording the pages used is kept beside the folded name.
    expect(list[0]!.namesRaw).toEqual(["Type 1 & 5", "MUR 1"]);
    expect(list[1]!.pages).toEqual([1, 2]);
  });

  it("lands each row on its own configurations, the geometry on all five, page 2 on the two it depicts", () => {
    const doc = namedSheetRun();
    const plans = namedConfigurationPlans(doc.items, doc);
    const sheet = sheetOf(doc);
    const plan = plans.get(sheet.id)!;
    expect(plan.labels).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"]);
    const width = sheet.observations.find((o) => o.labelRaw === "Width")!;
    expect(plan.rows[width.id]).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"]);
    const fabrics = sheet.observations.filter((o) => o.labelRaw === "FABRIC REFERENCE");
    expect(fabrics.map((o) => plan.rows[o.id])).toEqual([["TYPE 1", "TYPE 5"], ["TYPE 2"], ["TYPE 3"], ["TYPE 4"]]);

    const drawing = drawingOf(doc);
    const drawingPlan = plans.get(drawing.id)!;
    expect(drawingPlan.labels).toEqual(["TYPE 1", "TYPE 5"]);
    for (const observation of drawing.observations) expect(drawingPlan.rows[observation.id]).toEqual(["TYPE 1", "TYPE 5"]);
  });

  it("replaces page lettering for that code, and only that code", () => {
    const doc = namedSheetRun();
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
  });

  it("leaves a version 3 item naming NO configurations exactly as version 2 had it", () => {
    const plain = { ...SPEC_SHEET, configurations: [], depictsConfigurations: [], materials: SPEC_SHEET.materials.map((m) => ({ ...m, configurations: [] })) };
    const doc = stageDrawings([plain], NAMED_FIELDS, null, null);
    expect(namedConfigurationPlans(doc.items, doc).size).toBe(0);
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null]);
    // One record, one page: four fabrics are COM 1, COM 2, COM 3 and nothing,
    // as they always were for an item that is ONE chair.
    const fabrics = doc.items[0]!.observations.filter((o) => o.labelRaw === "FABRIC REFERENCE");
    expect(fabrics.map((o) => o.specFieldId)).toEqual(["f-com1", "f-com2", "f-com3", null]);
  });

  it("still letters a version 2 run of the S-200 shape A and B", () => {
    // Two pages of one code the model called configurations. The frozen path.
    const page = (id: string, n: number) => ({ ...SPEC_SHEET, itemCodeRaw: "Q-200", page: n, configurations: undefined, depictsConfigurations: undefined });
    const v3 = stageDrawings([page("a", 5), page("b", 6)], NAMED_FIELDS, null, null, null, [
      { itemCodes: ["Q-200"], pages: [5, 6], relationship: "configurations", evidence: "OPTION A and OPTION B" },
    ]);
    const v2: StagedDrawings = { ...v3, schemaVersion: 2 };
    expect([...variantLettersByItem(v2.items, v2).values()]).toEqual(["A", "B"]);
    // And a v3 code with no names but the same relationship letters too.
    expect([...variantLettersByItem(v3.items, v3).values()]).toEqual(["A", "B"]);
  });

  it("never reads a version 2 run's configurations, even if a field says so", () => {
    const doc = namedSheetRun();
    const v2: StagedDrawings = { ...doc, schemaVersion: 2 };
    expect(namedConfigurationPlans(v2.items, v2).size).toBe(0);
  });
});

describe("where a page of named configurations writes", () => {
  const doc = namedSheetRun();
  const sheet = sheetOf(doc);
  const plan = namedConfigurationPlans(doc.items, doc).get(sheet.id)!;
  const resolution = resolveDrawingTargets("Q-301", TWO_PHASES);

  it("fans out to five configurations on each of two phases", () => {
    expect(resolution.suggested.sort()).toEqual(["bill-main", "bill-ve"]);
    expect(plan.labels.length * resolution.suggested.length).toBe(10);
  });

  it("claims COM 1 on every configuration, so four fabrics on one card raise no clash", () => {
    const fabrics = sheet.observations.filter((o) => o.labelRaw === "FABRIC REFERENCE");
    expect(fabrics.every((o) => o.specFieldId === "f-com1")).toBe(true);
    const named: NamedTargets = { plan, variants: new Map() };
    expect(drawingItemBlockers(sheet, resolution, NO_OCCUPANCY, named)).toEqual([]);
    // WITHOUT the plan the same card is four fabrics of ONE record in one
    // field — which is the defect, and it is refused.
    expect(drawingItemBlockers(sheet, resolution, NO_OCCUPANCY).map((b) => b.code)).toContain("slot_taken");
  });

  it("reads occupancy and replace acknowledgements off the REAL variant of each configuration", () => {
    const variants = parentVariantsOf([
      record({ id: "v-main-2", parentId: "bill-main", variantLabel: "TYPE 2", boqCodes: [], refs: [] }),
    ]);
    const named: NamedTargets = { plan, variants };
    const type2 = sheet.observations.find((o) => o.configurations?.[0] === "Type 2")!;
    const type3 = sheet.observations.find((o) => o.configurations?.[0] === "Type 3")!;
    expect(rowWriteRecords(type2.id, ["bill-main", "bill-ve"], named)).toEqual(["v-main-2"]);
    expect(rowWriteRecords(type3.id, ["bill-main", "bill-ve"], named)).toEqual([]);

    const occupant = { attributeId: "a-old", attributeVersion: 3, label: "COM 1", value: "Old cloth", unit: null, sourceFilename: null, sourcePage: 1 };
    const occupied: OccupiedSlots = { fields: new Map([["v-main-2", new Map([["f-com1", occupant]])]]), dimensions: new Map() };
    const blocked = drawingItemBlockers(sheet, resolution, occupied, named);
    // TYPE 2 exists under MAIN RUN beside nothing else → the new ones there need a tick (see below);
    // the COM 1 clash is on TYPE 2's own record and on nothing else.
    const clashes = blocked.filter((b) => b.code === "slot_taken");
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ observationId: type2.id, recordId: "v-main-2" });
    const acknowledged = { ...sheet, observations: sheet.observations.map((o) => (o.id === type2.id ? { ...o, replaces: [{ recordId: "v-main-2", attributeId: "a-old", attributeVersion: 3 }] } : o)) };
    expect(drawingItemBlockers(acknowledged, resolution, occupied, named).filter((b) => b.code === "slot_taken")).toEqual([]);
  });
});

describe("creating a configuration beside existing ones", () => {
  const doc = namedSheetRun();
  const drawing = drawingOf(doc);
  const plan = namedConfigurationPlans(doc.items, doc).get(drawing.id)!;
  const resolution = resolveDrawingTargets("Q-301", [record()]);

  it("lands on an existing configuration of the exact name with no question", () => {
    const variants = parentVariantsOf([
      record({ id: "v1", parentId: "bill-main", variantLabel: "TYPE 1", boqCodes: [], refs: [] }),
      record({ id: "v5", parentId: "bill-main", variantLabel: "TYPE 5", boqCodes: [], refs: [] }),
    ]);
    expect(drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, { plan, variants })).toEqual([]);
  });

  it("asks before adding a name beside OTHER configurations, naming them", () => {
    const variants = parentVariantsOf(
      ["A", "B", "C", "D"].map((letter) => record({ id: `v-${letter}`, parentId: "bill-main", variantLabel: letter, boqCodes: [], refs: [] })),
    );
    const blockers = drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, { plan, variants }).filter((b) => b.code === "configuration_new");
    expect(blockers.map((b) => b.code === "configuration_new" && b.label)).toEqual(["TYPE 1", "TYPE 5"]);
    expect(blockers[0]!.message).toContain("A, B, C, D");
    expect(blockers[0]!.message).toContain("MAIN RUN");
    expect(blockers[0]!.message).toContain("TYPE 1");

    // Ticked for one bill line and one name: that one goes, the other stays.
    const acked = { ...drawing, configurationAcks: [{ recordId: "bill-main", label: "TYPE 1" }] };
    const after = drawingItemBlockers(acked, resolution, NO_OCCUPANCY, { plan, variants }).filter((b) => b.code === "configuration_new");
    expect(after.map((b) => b.code === "configuration_new" && b.label)).toEqual(["TYPE 5"]);
  });

  it("asks nothing when the bill line has no configurations yet", () => {
    expect(drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, { plan, variants: new Map() })).toEqual([]);
  });
});

describe("a configuration name the database would refuse", () => {
  it("is a blocker in words on the card, never a 500 at confirm", () => {
    const long = { ...SPEC_SHEET, configurations: [{ name: "Type 1 & 5 guest", nameRaw: null, evidence: null }], materials: [], depictsConfigurations: [] };
    const doc = stageDrawings([long], NAMED_FIELDS, null, null);
    const item = doc.items[0]!;
    const plan = namedConfigurationPlans(doc.items, doc).get(item.id)!;
    const blockers = drawingItemBlockers(item, resolveDrawingTargets("Q-301", [record()]), NO_OCCUPANCY, { plan, variants: new Map() });
    expect(blockers.map((b) => b.code)).toEqual(["configuration_name"]);
    expect(blockers[0]!.message).toMatch(/^'TYPE 1 & 5 GUEST' is too long to be a configuration name/);
  });

  it("folds a name the way the column stores it", () => {
    expect(normaliseVariantLabel("  type   2 ")).toBe("TYPE 2");
    expect(variantLabelProblem("TYPE 2")).toBeNull();
    expect(variantLabelProblem("TYPE 1&5")).toMatch(/cannot be a configuration name/);
  });

  it("holds the code's shape to 0024's CHECK until 0037 is applied", () => {
    // The constant must say exactly what the LIVE database says. 0037 widens
    // the CHECK and is written, not applied: when it is recorded as applied,
    // widen VARIANT_LABEL_SHAPE to 0037's pattern and flip this test with it.
    const at0024 = readFileSync("db/migrations/0024_record_variants.sql", "utf8");
    const at0037 = readFileSync("db/migrations/0037_variant_label_names.sql", "utf8");
    expect(at0024).toContain(`variant_label ~ '${VARIANT_LABEL_SHAPE.source}'`);
    expect(at0037).toContain("variant_label ~ '^[A-Z0-9][A-Z0-9 ./&-]{0,23}$'");
  });
});

describe("the frozen shop drawing", () => {
  it("keeps the drawing's own swatch on the configurations it depicts, COM 1", () => {
    const doc = namedSheetRun();
    const swatch = drawingOf(doc).observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    expect(swatch.specFieldId).toBe("f-com1");
    expect(SHOP_DRAWING.depictsConfigurations).toEqual(["Type 1", "Type 5"]);
  });
});

// ============================================================================
// A REVIEWER'S CORRECTIONS (brief C1). Stored beside the model's reading on the
// staged JSON; computed into the fan-out by the SAME function the card and the
// confirm call. Every edit below re-computes where every row lands.
// ============================================================================
describe("a reviewer's corrections to the configurations", () => {
  const MODEL = ["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"];
  /** Every page of the code carries the reviewer's list — the card writes it to each. */
  const withList = (doc: StagedDrawings, list: { label: string; readAs: string | null }[] | null): StagedDrawings => ({
    ...doc,
    items: doc.items.map((item) => ({ ...item, configurationsByReviewer: list })),
  });
  const modelList = () => MODEL.map((label) => ({ label, readAs: label }));
  const planOf = (doc: StagedDrawings, page = 1) =>
    namedConfigurationPlans(doc.items, doc).get(doc.items.find((item) => item.page === page)!.id)!;
  const rowOf = (doc: StagedDrawings, predicate: (o: StagedDrawings["items"][number]["observations"][number]) => boolean) =>
    doc.items.find((item) => item.page === 1)!.observations.find(predicate)!;

  it("ADDS a configuration: it gets the shared rows and none of its own", () => {
    const doc = withList(namedSheetRun(), [...modelList(), { label: "Type 6", readAs: null }]);
    const plan = planOf(doc);
    expect(plan.labels).toEqual([...MODEL, "TYPE 6"]);
    const width = rowOf(doc, (o) => o.labelRaw === "Width");
    expect(plan.rows[width.id]).toContain("TYPE 6");
    const fabrics = doc.items[0]!.observations.filter((o) => o.labelRaw === "FABRIC REFERENCE");
    expect(fabrics.some((o) => plan.rows[o.id]!.includes("TYPE 6"))).toBe(false);
  });

  it("RENAMES one: every row the model gave it follows the new name", () => {
    const list = modelList().map((entry) => (entry.label === "TYPE 5" ? { label: "TYPO 5", readAs: "TYPE 5" } : entry));
    const doc = withList(namedSheetRun(), list);
    const fabricA = rowOf(doc, (o) => o.configurations?.includes("Type 5") ?? false);
    expect(planOf(doc).rows[fabricA.id]).toEqual(["TYPE 1", "TYPO 5"]);
    // The drawing depicts Type 5 by the model's name; it follows too.
    expect(planOf(doc, 2).labels).toEqual(["TYPE 1", "TYPO 5"]);
  });

  it("REMOVES one: a row that was only its own needs a decision, and is never silently shared", () => {
    const doc = withList(namedSheetRun(), modelList().filter((entry) => entry.label !== "TYPE 3"));
    const plan = planOf(doc);
    const type3 = rowOf(doc, (o) => o.configurations?.includes("Type 3") ?? false);
    expect(plan.rows[type3.id]).toEqual([]);
    expect(plan.undecided).toEqual([type3.id]);
    const blockers = drawingItemBlockers(doc.items[0]!, resolveDrawingTargets("Q-301", [record()]), NO_OCCUPANCY, { plan, variants: new Map() });
    expect(blockers.filter((b) => b.code === "configuration_undecided").map((b) => b.observationId)).toEqual([type3.id]);
    // And the geometry goes to the four that are left.
    const width = rowOf(doc, (o) => o.labelRaw === "Width");
    expect(plan.rows[width.id]).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 4"]);
  });

  it("…and REASSIGNING that row in the same act settles it", () => {
    const removed = withList(namedSheetRun(), modelList().filter((entry) => entry.label !== "TYPE 3"));
    const type3 = rowOf(removed, (o) => o.configurations?.includes("Type 3") ?? false);
    const shared: StagedDrawings = {
      ...removed,
      items: removed.items.map((item) => ({
        ...item,
        observations: item.observations.map((o) => (o.id === type3.id ? { ...o, configurationsByReviewer: [] } : o)),
      })),
    };
    expect(planOf(shared).rows[type3.id]).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 4"]);
    expect(planOf(shared).undecided).toEqual([]);
  });

  it("CHANGES which configurations a row applies to, the model's reading kept beside it", () => {
    const doc = namedSheetRun();
    const type2 = rowOf(doc, (o) => o.configurations?.includes("Type 2") ?? false);
    const moved: StagedDrawings = {
      ...doc,
      items: doc.items.map((item) => ({
        ...item,
        observations: item.observations.map((o) => (o.id === type2.id ? { ...o, configurationsByReviewer: ["TYPE 3", "type 4"] } : o)),
      })),
    };
    expect(planOf(moved).rows[type2.id]).toEqual(["TYPE 3", "TYPE 4"]);
    // The model's reading is untouched.
    expect(moved.items[0]!.observations.find((o) => o.id === type2.id)!.configurations).toEqual(["Type 2"]);
    // TYPE 2 now has no fabric of its own, and is still made: the geometry lands on it.
    expect(planOf(moved).labels).toContain("TYPE 2");
  });

  it("says what the reviewer changed against what was read", () => {
    const doc = withList(namedSheetRun(), [
      ...modelList()
        .filter((entry) => entry.label !== "TYPE 3")
        .map((entry) => (entry.label === "TYPE 5" ? { label: "TYPO 5", readAs: "TYPE 5" } : entry)),
      { label: "TYPE 6", readAs: null },
    ]);
    const entry = [...codeConfigurations(doc.items, doc).values()][0];
    expect(configurationEditSummary(entry)).toBe("Read as 5, you set 5 — added TYPE 6; renamed TYPE 5 to TYPO 5; removed TYPE 3.");
    expect(configurationEditSummary([...codeConfigurations(namedSheetRun().items, namedSheetRun()).values()][0])).toBeNull();
  });

  it("JOINS: an empty list says the code has none, and the pages are one item again", () => {
    const doc = withList(namedSheetRun(), []);
    expect(namedConfigurationPlans(doc.items, doc).size).toBe(0);
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
  });

  it("reads the first page's list when pages disagree, so every page agrees", () => {
    const doc = namedSheetRun();
    const mixed: StagedDrawings = {
      ...doc,
      items: doc.items.map((item) =>
        item.page === 1 ? { ...item, configurationsByReviewer: [{ label: "TYPE 1", readAs: "TYPE 1" }] } : item,
      ),
    };
    expect(planOf(mixed, 2).configurations.map((c) => c.label)).toEqual(["TYPE 1"]);
  });
});

describe("splitting and joining by page, the manual codeGroups.relationship", () => {
  const twoPages = (relationship: "one_item" | "configurations", schemaVersion: 1 | 2 | 3) => {
    const page = (n: number) => ({ ...SPEC_SHEET, itemCodeRaw: "Q-200", page: n, configurations: undefined, depictsConfigurations: undefined });
    const staged = stageDrawings([page(5), page(6)], NAMED_FIELDS, null, null, null, [
      { itemCodes: ["Q-200"], pages: [5, 6], relationship, evidence: null },
    ]);
    return { ...staged, schemaVersion } as StagedDrawings;
  };
  const say = (doc: StagedDrawings, answer: "one_item" | "configurations"): StagedDrawings => ({
    ...doc,
    items: doc.items.map((item) => ({ ...item, relationshipByReviewer: answer })),
  });

  it("splits pages the model called one item", () => {
    const doc = twoPages("one_item", 2);
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
    const split = say(doc, "configurations");
    expect([...variantLettersByItem(split.items, split).values()]).toEqual(["A", "B"]);
  });

  it("joins pages the model split", () => {
    const doc = say(twoPages("configurations", 3), "one_item");
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
  });

  it("works on a version 1 run, which never had an answer", () => {
    const v1 = twoPages("one_item", 1);
    // Version 1 letters by page count, frozen…
    expect([...variantLettersByItem(v1.items, v1).values()]).toEqual(["A", "B"]);
    // …until a person says otherwise.
    const joined = say(v1, "one_item");
    expect([...variantLettersByItem(joined.items, joined).values()]).toEqual([null, null]);
  });

  it("lets a person NAME the configurations of a v1 or v2 card", () => {
    const v2 = twoPages("one_item", 2);
    const named = { ...v2, items: v2.items.map((item) => ({ ...item, configurationsByReviewer: [{ label: "TYPE 1", readAs: null }, { label: "TYPE 2", readAs: null }] })) };
    const plans = namedConfigurationPlans(named.items, named);
    expect(plans.get(named.items[0]!.id)!.labels).toEqual(["TYPE 1", "TYPE 2"]);
    expect([...variantLettersByItem(named.items, named).values()]).toEqual([null, null]);
  });
});

// ============================================================================
// THE SAME MEASUREMENT FROM TWO PAGES IS NOT A REPLACEMENT (2026-09-23).
//
// S-301's sheet and its shop drawing both state W, D and H. Confirming the
// drawing after the sheet used to ask "replace 550mm with 550mm?" three times.
// Compared as millimetres through the one parser, with the state; dimensions
// only — a finish described two ways is still the reviewer's decision.
// ============================================================================
describe("a dimension already recorded", () => {
  const width = (value: string, unit: "mm" | "cm" | null, state: "confirmed" | "tbc" | null = "confirmed") => ({
    attrGroup: "dimension" as const,
    dimensionSlot: "W" as const,
    value,
    valueRaw: value,
    unit,
    state,
  });
  const occupant = (value: string, unit: string | null, state: string | null = "confirmed") => ({ value, unit, state });

  it("is the same figure in the same unit", () => {
    expect(alreadyRecorded(width("550", "mm"), occupant("550", "mm"))).toBe(true);
    expect(alreadyRecorded(width("550.0", "mm"), occupant("550", "mm"))).toBe(true);
  });

  it("is the same width in centimetres and millimetres — never compared as strings", () => {
    expect(alreadyRecorded(width("55", "cm"), occupant("550", "mm"))).toBe(true);
    expect(alreadyRecorded(width("550", "cm"), occupant("550", "mm"))).toBe(false);
  });

  it("is NOT a different figure", () => {
    expect(alreadyRecorded(width("555", "mm"), occupant("550", "mm"))).toBe(false);
  });

  it("is NOT the same figure in a different state", () => {
    expect(alreadyRecorded(width("550", "mm", "confirmed"), occupant("550", "mm", "tbc"))).toBe(false);
    expect(alreadyRecorded(width("550", "mm", "tbc"), occupant("550", "mm", "confirmed"))).toBe(false);
  });

  it("is never a figure with no unit, nor an occupant whose state is unknown", () => {
    expect(alreadyRecorded(width("550", null), occupant("550", "mm"))).toBe(false);
    expect(alreadyRecorded(width("550", "mm"), occupant("550", "mm", null))).toBe(false);
    expect(alreadyRecorded(width("550", "mm"), undefined)).toBe(false);
  });

  it("is never a finish, whatever its wording", () => {
    const fabric = { attrGroup: "material" as const, dimensionSlot: null, value: "Maker A", valueRaw: "Maker A", unit: null, state: "confirmed" as const };
    expect(alreadyRecorded(fabric, occupant("Maker A", null))).toBe(false);
  });

  it("raises no blocker per record where it is already recorded, and a blocker where it is not", () => {
    const doc = namedSheetRun();
    const drawing = drawingOf(doc);
    const plan = namedConfigurationPlans(doc.items, doc).get(drawing.id)!;
    const variants = parentVariantsOf([
      record({ id: "v1", parentId: "bill-main", variantLabel: "TYPE 1", boqCodes: [], refs: [] }),
      record({ id: "v5", parentId: "bill-main", variantLabel: "TYPE 5", boqCodes: [], refs: [] }),
    ]);
    const slot = (value: string, id: string) => ({ attributeId: id, attributeVersion: 1, label: "Width", value, unit: "mm", state: "confirmed", sourceFilename: null, sourcePage: 1 });
    // TYPE 1 holds the same width; TYPE 5 holds a different one.
    const occupied: OccupiedSlots = {
      fields: new Map(),
      dimensions: new Map([
        ["v1", new Map([["W", slot("550", "a1")]])],
        ["v5", new Map([["W", slot("600", "a5")]])],
      ]),
    };
    const blockers = drawingItemBlockers(drawing, resolveDrawingTargets("Q-301", [record()]), occupied, { plan, variants });
    const widths = blockers.filter((b) => b.code === "dimension_slot_taken");
    expect(widths).toHaveLength(1);
    expect(widths[0]).toMatchObject({ recordId: "v5" });
  });
});
