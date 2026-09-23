// Pure tier. Configurations a document NAMES (schemaVersion 3, 2026-09-23):
// which records a page's rows land on, and what stops the card before the
// confirm does. Synthetic fixture in the S-301 shape — see
// tests/fixtures/named-configurations.ts.
import { readFileSync } from "node:fs";
import { PROMPTS } from "@/lib/anthropic";
import { describe, expect, it } from "vitest";
import {
  alreadyRecorded,
  letteredPlan,
  ownVariantsOf,
  configurationTarget,
  namedTargetsFor,
  configurationsDistinguishSomething,
  crossPageClaims,
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

describe("creating a configuration beside existing ones (plan step 5)", () => {
  const doc = namedSheetRun();
  const drawing = drawingOf(doc);
  const plan = namedConfigurationPlans(doc.items, doc).get(drawing.id)!;
  const resolution = resolveDrawingTargets("Q-301", [record()]);
  const typesExist = () =>
    parentVariantsOf([
      record({ id: "v1", parentId: "bill-main", variantLabel: "TYPE 1", boqCodes: [], refs: [] }),
      record({ id: "v5", parentId: "bill-main", variantLabel: "TYPE 5", boqCodes: [], refs: [] }),
    ]);

  it("pairs silently only on the PAGE'S OWN WORDS — never on the model's translation", () => {
    // The drawing's title block says MUR 1 & TYPO 5; the model read them as
    // Type 1 and Type 5. That is a translation nobody has confirmed: ask.
    const asked = drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, namedTargetsFor(drawing, plan, typesExist(), doc)).filter(
      (b) => b.code === "configuration_new",
    );
    expect(asked.map((b) => b.code === "configuration_new" && b.label)).toEqual(["TYPE 1", "TYPE 5"]);
    expect(asked[0]!.message).toMatch(/^The page says MUR 1 \(read as TYPE 1\), and this item on MAIN RUN already has TYPE 1, TYPE 5\./);

    // A page whose own words ARE the name lands with no question: case and
    // whitespace folded, nothing more.
    const own = stageDrawings(
      [
        {
          ...SHOP_DRAWING,
          itemCodeRaw: "Q-301",
          configurations: [{ name: "Type 1", nameRaw: "type  1", evidence: null }, { name: "Type 5", nameRaw: "Type 5", evidence: null }],
          depictsConfigurations: [],
          // Something that differs, or the two names would distinguish nothing.
          materials: [{ labelRaw: "PIPING", valueRaw: "Contrast piping", materialCodeRaw: null, configurations: ["Type 5"] }],
        },
      ],
      NAMED_FIELDS,
      null,
      null,
    );
    const ownPlan = namedConfigurationPlans(own.items, own).get(own.items[0]!.id)!;
    const named = namedTargetsFor(own.items[0]!, ownPlan, typesExist(), own);
    expect(drawingItemBlockers(own.items[0]!, resolution, NO_OCCUPANCY, named)).toEqual([]);
    expect(configurationTarget("bill-main", "TYPE 1", named)).toMatchObject({ kind: "existing", variantIds: ["v1"], via: "exact" });
  });

  it("writes to the configuration the reviewer paired it with", () => {
    const named = {
      plan,
      variants: typesExist(),
      pairs: [
        { recordId: "bill-main", label: "TYPE 1", pairWith: ["TYPE 1"] },
        { recordId: "bill-main", label: "TYPE 5", pairWith: ["TYPE 5"] },
      ],
    };
    expect(drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, named)).toEqual([]);
    const width = drawing.observations.find((o) => o.dimensionSlot === "W")!;
    expect(rowWriteRecords(width.id, ["bill-main"], named)).toEqual(["v1", "v5"]);
  });

  it("refuses two configurations paired onto one record", () => {
    const named = {
      plan,
      variants: typesExist(),
      pairs: [
        { recordId: "bill-main", label: "TYPE 1", pairWith: ["TYPE 1"] },
        { recordId: "bill-main", label: "TYPE 5", pairWith: ["TYPE 1"] },
      ],
    };
    expect(drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, named).map((b) => b.code)).toEqual(["configuration_pair_twice"]);
  });

  it("creates a new one on the reviewer's word, and reads a pre-step-5 tick as the same", () => {
    const variants = parentVariantsOf(
      ["A", "B", "C", "D"].map((letter) => record({ id: `v-${letter}`, parentId: "bill-main", variantLabel: letter, boqCodes: [], refs: [] })),
    );
    const asked = drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, { plan, variants }).filter((b) => b.code === "configuration_new");
    expect(asked.map((b) => b.code === "configuration_new" && b.label)).toEqual(["TYPE 1", "TYPE 5"]);
    expect(asked[0]!.message).toContain("A, B, C, D");
    expect(asked[0]!.message).toContain("or create it as a new configuration");
    const acked = { ...drawing, configurationAcks: [{ recordId: "bill-main", label: "TYPE 1" }] };
    const after = drawingItemBlockers(acked, resolution, NO_OCCUPANCY, namedTargetsFor(acked, plan, variants, doc)).filter(
      (b) => b.code === "configuration_new",
    );
    expect(after.map((b) => b.code === "configuration_new" && b.label)).toEqual(["TYPE 5"]);
  });

  it("cannot create a new one under a name that already exists", () => {
    const named = { plan, variants: typesExist(), pairs: [{ recordId: "bill-main", label: "TYPE 1", pairWith: null }] };
    expect(configurationTarget("bill-main", "TYPE 1", named)).toMatchObject({ kind: "ask", collides: true });
  });

  it("lands this document's own later page where its earlier page landed, with no question", () => {
    const named = { plan, variants: typesExist(), links: [
      { recordId: "bill-main", label: "TYPE 1", variantId: "v1" },
      { recordId: "bill-main", label: "TYPE 5", variantId: "v5" },
    ] };
    expect(drawingItemBlockers(drawing, resolution, NO_OCCUPANCY, named)).toEqual([]);
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
    const pairs = [
      { recordId: "bill-main", label: "TYPE 1", pairWith: ["TYPE 1"] },
      { recordId: "bill-main", label: "TYPE 5", pairWith: ["TYPE 5"] },
    ];
    const blockers = drawingItemBlockers(drawing, resolveDrawingTargets("Q-301", [record()]), occupied, { plan, variants, pairs });
    const widths = blockers.filter((b) => b.code === "dimension_slot_taken");
    expect(widths).toHaveLength(1);
    expect(widths[0]).toMatchObject({ recordId: "v5" });
  });
});

// ============================================================================
// A CLASH THE CARD CAN SEE IS SHOWN BEFORE CONFIRM (2026-09-23).
//
// Pressing Confirm applied the sheet and then refused the drawing with
// slot_taken: both gave TYPE 1 / TYPE 5 a COM 1, in different words. Compared
// across pages, per configuration, by one function the card and the confirm
// both call.
// ============================================================================
describe("two pages giving one configuration the same BWS field", () => {
  const doc = namedSheetRun();
  const sheet = sheetOf(doc);
  const drawing = drawingOf(doc);
  const claims = crossPageClaims(doc.items, doc, NAMED_FIELDS);
  const sheetFabricA = sheet.observations.find((o) => o.configurations?.includes("Type 1"))!;
  const drawingFabric = drawing.observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
  const sheetTimber = sheet.observations.find((o) => o.materialCodeRaw === "QW-01")!;
  const drawingTimber = drawing.observations.find((o) => o.materialCodeRaw === "QW-01")!;

  it("is a decision on BOTH rows where the words differ, naming the other page's", () => {
    const a = claims.get(sheetFabricA.id);
    const b = claims.get(drawingFabric.id);
    expect(a?.kind).toBe("conflict");
    expect(b?.kind).toBe("conflict");
    expect(a?.kind === "conflict" && b?.kind === "conflict" && a.pairKey === b.pairKey).toBe(true);
    expect(a?.message).toBe(
      "Page 1 and page 2 both give COM 1 for TYPE 1 · TYPE 5, in different words — page 2 says “Maker A, Ref. X, woven”. Ignore one, or move one to another field.",
    );
    expect(b?.message).toContain("page 1 says “Maker A, Ref. X”");
  });

  it("is the same finish where both carry the same client code — the later one already recorded", () => {
    expect(claims.get(sheetTimber.id)).toBeUndefined();
    const later = claims.get(drawingTimber.id);
    expect(later).toMatchObject({ kind: "same_finish", keptId: sheetTimber.id, code: "QW-01" });
    expect(later?.message).toBe("Page 2 names the same finish, QW-01 — already recorded from page 1.");
  });

  it("never compares configurations the rows do not share", () => {
    const type2 = sheet.observations.find((o) => o.configurations?.includes("Type 2"))!;
    expect(claims.get(type2.id)).toBeUndefined();
  });

  it("blocks the card on both pages, and goes once a row is ignored", () => {
    const resolution = resolveDrawingTargets("Q-301", [record()]);
    const plans = namedConfigurationPlans(doc.items, doc);
    const blocked = (item: typeof sheet, map = claims) =>
      drawingItemBlockers(item, resolution, NO_OCCUPANCY, { plan: plans.get(item.id)!, variants: new Map() }, map)
        .filter((b) => b.code === "field_conflict")
        .map((b) => b.observationId);
    expect(blocked(sheet)).toEqual([sheetFabricA.id]);
    expect(blocked(drawing)).toEqual([drawingFabric.id]);
    const ignoredDoc = {
      ...doc,
      items: doc.items.map((item) => ({
        ...item,
        observations: item.observations.map((o) => (o.id === drawingFabric.id ? { ...o, reviewStatus: "ignored" as const } : o)),
      })),
    };
    const after = crossPageClaims(ignoredDoc.items, ignoredDoc, NAMED_FIELDS);
    expect(blocked(sheet, after)).toEqual([]);
  });

  it("treats the same client code already on the record as already recorded, at confirm too", () => {
    expect(
      alreadyRecorded(
        { ...drawingTimber },
        { value: "feet dark tinted wood as per approved sample", unit: null, state: "confirmed", materialCode: "qw-01 " },
      ),
    ).toBe(true);
    expect(alreadyRecorded({ ...drawingTimber }, { value: "Dark tinted wood", unit: null, state: "confirmed", materialCode: "QW-02" })).toBe(false);
    expect(alreadyRecorded({ ...drawingFabric }, { value: "Maker A", unit: null, state: "confirmed", materialCode: null })).toBe(false);
  });
});

// ============================================================================
// A TITLE-BLOCK ROOM LABEL IS NOT A CONFIGURATION (2026-09-23).
//
// S-100 SOFA came out as TYPE 1 and TYPE 5 because its shop drawing is titled
// "SOFA MUR 1 & TYPO 5"; nothing on its pages differs between the two.
// A configuration exists only where the document gives it something different.
// ============================================================================
describe("configurations that distinguish nothing", () => {
  const sofaSheet = {
    ...SPEC_SHEET,
    itemCodeRaw: "Q-100",
    itemNameRaw: "Sofa",
    materials: [{ labelRaw: "FABRIC", valueRaw: "Invented cloth YC-01", materialCodeRaw: null, configurations: [] }],
    configurations: [],
    depictsConfigurations: [],
  };
  const sofaDrawing = {
    ...SHOP_DRAWING,
    itemCodeRaw: "SOFA MUR 1 & TYPO 5",
    itemNameRaw: "Sofa",
    materials: [{ labelRaw: "FABRIC", valueRaw: "Invented cloth YC-01", materialCodeRaw: null, configurations: [] }],
  };
  const sofaRun = () =>
    stageDrawings([sofaSheet, sofaDrawing], NAMED_FIELDS, null, null, null, [
      { itemCodes: ["Q-100", "SOFA MUR 1 & TYPO 5"], pages: [1, 2], relationship: "one_item", evidence: "one sofa" },
    ]);

  it("reads S-100's shape as ONE item: no plan, no letters, onto the bill line", () => {
    const doc = sofaRun();
    const entry = [...codeConfigurations(doc.items, doc).values()][0]!;
    expect(entry.read.map((c) => c.label)).toEqual(["TYPE 1", "TYPE 5"]);
    expect(entry.undistinguished).toBe(true);
    expect(entry.effective).toEqual([]);
    expect(namedConfigurationPlans(doc.items, doc).size).toBe(0);
    expect(namedConfigurationsByCode(doc.items, doc).size).toBe(0);
    expect([...variantLettersByItem(doc.items, doc).values()]).toEqual([null, null]);
    // The confirm reads the same plan: no named targets, so it writes the bill line.
    expect(configurationsDistinguishSomething(doc.items, ["TYPE 1", "TYPE 5"])).toBe(false);
  });

  it("still reads S-301's shape as five", () => {
    const doc = namedSheetRun();
    expect(namedConfigurationsByCode(doc.items, doc).values().next().value?.length).toBe(5);
  });

  it("keeps two where only ONE of them has a row of its own", () => {
    const item = {
      ...sofaSheet,
      configurations: [
        { name: "Type 1", nameRaw: "Type 1", evidence: null },
        { name: "Type 5", nameRaw: "Type 5", evidence: null },
      ],
      materials: [
        { labelRaw: "FABRIC", valueRaw: "Invented cloth YC-01", materialCodeRaw: null, configurations: [] },
        { labelRaw: "PIPING", valueRaw: "Contrast piping", materialCodeRaw: null, configurations: ["Type 5"] },
      ],
    };
    const doc = stageDrawings([item], NAMED_FIELDS, null, null);
    expect(namedConfigurationPlans(doc.items, doc).get(doc.items[0]!.id)!.labels).toEqual(["TYPE 1", "TYPE 5"]);
  });

  it("lets a reviewer split it by hand all the same", () => {
    const doc = sofaRun();
    const split = {
      ...doc,
      items: doc.items.map((i) => ({ ...i, configurationsByReviewer: [{ label: "TYPE 1", readAs: "TYPE 1" }, { label: "TYPE 5", readAs: "TYPE 5" }] })),
    };
    expect(namedConfigurationPlans(split.items, split).size).toBe(2);
  });

  it("tells the model a title block names configurations only where the pages differ, in their own words", () => {
    expect(PROMPTS.shop_drawings).toMatch(/A TITLE BLOCK OR "WHERE USED" LABEL SAYS WHICH ROOMS A DRAWING IS FOR/);
    expect(PROMPTS.shop_drawings).toMatch(/where nothing differs[^]*name none/);
    // Where the pages DO differ, the title blocks name them, in the page's own words.
    expect(PROMPTS.shop_drawings).toMatch(/in the page's own words \("MUR 1", "TYPO 5", "MUR 2",/);
    expect(PROMPTS.shop_drawings).toMatch(/IS THE PAGE'S OWN WORDS[^]*never a\s+translation/);
  });
});

// ============================================================================
// THE GUARD COVERS PAGE LETTERS TOO (2026-09-23).
//
// S-301's bill lines held TYPE 1–5 from the specification sheet; the drawing
// set's S-301 card (four pages, "configurations", no names) offered to create
// S-301 A–D beside them with no question — nine configurations, four duplicate
// jobs. Every configuration a confirm would CREATE goes through the same
// pair-or-create choice.
// ============================================================================
describe("a page letter beside another document's configurations", () => {
  // A drawing-set page: one fabric of its own, no names — the v2-style read.
  const page = {
    ...SPEC_SHEET,
    itemCodeRaw: "Q-301",
    materials: [{ labelRaw: "FABRIC", valueRaw: "Maker A, Ref. X", materialCodeRaw: null }],
    configurations: undefined,
    depictsConfigurations: undefined,
  };
  const lettered = stageDrawings([{ ...page, page: 8 }, { ...page, page: 9 }], NAMED_FIELDS, null, null, null, [
    { itemCodes: ["Q-301"], pages: [8, 9], relationship: "configurations", evidence: "a different fabric per room" },
  ]);
  const [eight, nine] = lettered.items;
  const types = () =>
    parentVariantsOf(
      ["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"].map((label, index) =>
        record({ id: `t${index + 1}`, parentId: "bill-main", variantLabel: label, boqCodes: [], refs: [] }),
      ),
    );
  const resolution = resolveDrawingTargets("Q-301", [record()]);

  it("letters the pages as before, and asks before creating S-301 A beside TYPE 1-5", () => {
    expect([...variantLettersByItem(lettered.items, lettered).values()]).toEqual(["A", "B"]);
    const named = namedTargetsFor(eight!, letteredPlan(eight!, "A"), types(), lettered);
    const asked = drawingItemBlockers(eight!, resolution, NO_OCCUPANCY, named).filter((b) => b.code === "configuration_new");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ label: "A", existing: ["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"] });
  });

  it("writes one page to MORE THAN ONE existing configuration when the reviewer says so", () => {
    const paired = { ...eight!, configurationPairs: [{ recordId: "bill-main", label: "A", pairWith: ["TYPE 1", "TYPE 5"] }] };
    const named = namedTargetsFor(paired, letteredPlan(paired, "A"), types(), lettered);
    expect(drawingItemBlockers(paired, resolution, NO_OCCUPANCY, named)).toEqual([]);
    expect(configurationTarget("bill-main", "A", named)).toMatchObject({ kind: "existing", variantIds: ["t1", "t5"], as: ["TYPE 1", "TYPE 5"] });
    const width = paired.observations.find((o) => o.dimensionSlot === "W")!;
    expect(rowWriteRecords(width.id, ["bill-main"], named)).toEqual(["t1", "t5"]);
  });

  it("never asks a document about configurations it made itself", () => {
    // Page 8 was confirmed first and created S-301 A; page 9's B asks nothing.
    const withA = parentVariantsOf([record({ id: "va", parentId: "bill-main", variantLabel: "A", boqCodes: [], refs: [] })]);
    const own = ownVariantsOf(lettered, "run-drawings", new Map([["va", new Set(["run-drawings"])]]));
    const named = namedTargetsFor(nine!, letteredPlan(nine!, "B"), withA, lettered, own);
    expect(configurationTarget("bill-main", "B", named)).toEqual({ kind: "create", via: "first" });
    // Another document's A is a different matter.
    const theirs = namedTargetsFor(nine!, letteredPlan(nine!, "B"), withA, lettered, ownVariantsOf(lettered, "run-drawings", new Map([["va", new Set(["run-sheet"])]])));
    expect(configurationTarget("bill-main", "B", theirs).kind).toBe("ask");
  });

  it("reads a pairing saved as one name, from before the multi-select, as a list", () => {
    const legacy = { ...eight!, configurationPairs: [{ recordId: "bill-main", label: "A", pairWith: "TYPE 3" }] };
    expect(configurationTarget("bill-main", "A", namedTargetsFor(legacy, letteredPlan(legacy, "A"), types(), lettered))).toMatchObject({
      variantIds: ["t3"],
    });
  });
});
