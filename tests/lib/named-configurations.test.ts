// Pure tier. Configurations a document NAMES (schemaVersion 3, 2026-09-23):
// which records a page's rows land on, and what stops the card before the
// confirm does. Synthetic fixture in the S-301 shape — see
// tests/fixtures/named-configurations.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
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
