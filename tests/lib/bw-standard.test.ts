// Pure tier — the BW standard beside the client's words (0041).
//
// ============================================================================
// WHAT THESE HOLD
//
// One composer decides which half a record carries, and three readers ask it:
// the BWS cell (`renderAttributeValue`), the checklist answer
// (`planAnswerFills`) and the check sheet, which shows both. Plus the one rule
// about what a proposal does to the state, and the read-time reading of a
// palette pick made before 0041, when the pick overwrote `value`.
//
// Fixtures are synthetic. The option names are BWS's SHAPE, not a real row.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  composeAttributeStatement,
  describeStandard,
  stateUnderStandard,
  STANDARD_STATES,
  type AttributeStandard,
} from "@/lib/bw-standard";
import { renderAttributeValue, type ExportAttribute, type ExportScope } from "@/lib/bws-export";
import { planAnswerFills, type PromotableAttribute } from "@/lib/promote-answers";
import { composeCheckSheet, CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";
import { assertStagedDrawings, legacyPaletteStandard, type DrawingObservation } from "@/lib/drawing-document";
import { standardToWrite } from "@/lib/confirm-drawings";
import type { Palette } from "@/lib/palettes";

const PROPOSED: AttributeStandard = { value: "BW Oak Grey - Open grain 10%", optionId: "opt-grey", state: "proposed" };
const AGREED: AttributeStandard = { ...PROPOSED, state: "agreed" };
const TBC_STANDARD: AttributeStandard = { value: null, optionId: null, state: "tbc" };

const timber: Palette = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: null,
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    { id: "opt-grey", value: "BW Oak Grey - Open grain 10%", label: "BW Oak Grey - Open grain 10%", sortOrder: 1, isDefault: false, code: null },
    { id: "opt-walnut", value: "BW Walnut Dark", label: "BW Walnut Dark", sortOrder: 2, isDefault: false, code: null },
  ],
};

describe("which half ships — composeAttributeStatement and the BWS cell", () => {
  const cell = (standard: AttributeStandard | null, over: Partial<Parameters<typeof renderAttributeValue>[0]> = {}) =>
    renderAttributeValue({ value: "30% oak", unit: null, state: "confirmed", standard, ...over });

  it("no standard: the client's words, exactly as before 0041", () => {
    expect(cell(null)).toBe("30% oak");
    expect(cell(null, { qualifier: "Legs" })).toBe("30% oak - Legs");
    expect(cell(null, { state: "tbc" })).toBe("30% oak TBC");
  });

  it("proposed: the standard ships, held at TBC until the client agrees", () => {
    // THE DEFAULT AWAITING MAX. The file carries the TBC marker exactly as the
    // checklist answer is held at TBC, so the two cannot disagree.
    expect(cell(PROPOSED)).toBe("BW Oak Grey - Open grain 10% TBC");
    // The qualifier still goes on LAST, after the marker.
    expect(cell(PROPOSED, { qualifier: "Legs" })).toBe("BW Oak Grey - Open grain 10% TBC - Legs");
  });

  it("agreed: the standard ships at the attribute's own state", () => {
    expect(cell(AGREED)).toBe("BW Oak Grey - Open grain 10%");
    expect(cell(AGREED, { qualifier: "Legs" })).toBe("BW Oak Grey - Open grain 10% - Legs");
    // An agreed standard over words the client left TBC keeps the TBC: the
    // rule is "settles at the attribute's own state", and that state is TBC.
    expect(cell(AGREED, { state: "tbc" })).toBe("BW Oak Grey - Open grain 10% TBC");
  });

  it("a TBC standard ships the client's words, held at TBC", () => {
    expect(cell(TBC_STANDARD)).toBe("30% oak TBC");
    expect(cell(TBC_STANDARD, { qualifier: "Legs" })).toBe("30% oak TBC - Legs");
    // The marker is added once, not again, where the words already carry one.
    expect(cell(TBC_STANDARD, { value: "TBC – oak" })).toBe("TBC – oak");
  });

  it("a BWS option never has the page's unit glued to it", () => {
    expect(cell(AGREED, { unit: "mm" })).toBe("BW Oak Grey - Open grain 10%");
    expect(cell(null, { value: "18", unit: "mm" })).toBe("18mm");
  });

  it("the standard wins over a linked finish, and the finish over the page's words", () => {
    const finish = {
      id: "f1",
      code: "WD-05",
      codeNorm: "WD-05",
      codeOrigin: "client" as const,
      kind: "timber" as const,
      description: "Dark tinted oak",
      supplierRaw: null,
      reference: null,
      colour: null,
      state: "confirmed" as const,
    };
    expect(composeAttributeStatement({ value: "30% oak", state: "confirmed", finish, standard: AGREED }).value).toBe(
      "BW Oak Grey - Open grain 10%",
    );
    const withoutStandard = composeAttributeStatement({ value: "30% oak", state: "confirmed", finish, standard: null });
    expect(withoutStandard.value).toContain("Dark tinted oak");
    expect(withoutStandard.fromStandard).toBe(false);
  });

  it("says each state in the reviewer's words", () => {
    expect(describeStandard(PROPOSED)).toBe("BW Oak Grey - Open grain 10% (proposed)");
    expect(describeStandard(AGREED)).toBe("BW Oak Grey - Open grain 10% (agreed by the client)");
    expect(describeStandard(TBC_STANDARD)).toBe("TBC — BW to propose one");
    expect(describeStandard(null)).toBeNull();
  });
});

describe("the one rule — stateUnderStandard", () => {
  it("holds a proposal and a TBC standard at TBC, and settles an agreed one at the row's own state", () => {
    const table = STANDARD_STATES.map((state) => [
      state,
      stateUnderStandard("confirmed", { state }),
      stateUnderStandard("tbc", { state }),
    ]);
    expect(table).toEqual([
      ["proposed", "tbc", "tbc"],
      ["agreed", "confirmed", "tbc"],
      ["tbc", "tbc", "tbc"],
    ]);
    expect(stateUnderStandard("confirmed", null)).toBe("confirmed");
  });
});

describe("the checklist answer follows the same composer", () => {
  const timberAttribute = (over: Partial<PromotableAttribute> = {}): PromotableAttribute => ({
    attrGroup: "finish",
    dimensionSlot: null,
    specFieldId: "field-timber",
    value: "feet dark tinted wood as per approved sample",
    unit: null,
    state: "confirmed",
    sortOrder: 1,
    sourceRunId: "run-1",
    ...over,
  });

  it("a proposal answers with the standard, TBC, and keeps the client's words as value_raw", () => {
    const [fill] = planAnswerFills([timberAttribute({ standard: PROPOSED })]);
    expect(fill?.value).toBe("BW Oak Grey - Open grain 10%");
    expect(fill?.state).toBe("tbc");
    // value_raw is the CLIENT'S words, never the option -- the half that makes
    // the answer checkable against its drawing.
    expect(fill?.valueRaw).toBe("feet dark tinted wood as per approved sample");
  });

  it("an agreement settles it", () => {
    const [fill] = planAnswerFills([timberAttribute({ standard: AGREED })]);
    expect(fill?.state).toBe("confirmed");
    expect(fill?.value).toBe("BW Oak Grey - Open grain 10%");
  });

  it("no standard: exactly as before", () => {
    const [fill] = planAnswerFills([timberAttribute()]);
    expect(fill?.value).toBe("feet dark tinted wood as per approved sample");
    expect(fill?.state).toBe("confirmed");
  });
});

describe("the check sheet shows both halves", () => {
  const attribute = (over: Partial<ExportAttribute> = {}): ExportAttribute => ({
    id: "attr-1",
    recordId: "rec-1",
    attrGroup: "finish",
    label: "SOFA FEET",
    value: "feet dark tinted wood as per approved sample",
    unit: null,
    qualifier: null,
    dimensionSlot: null,
    materialCode: null,
    finish: null,
    specFieldJsonId: 4,
    state: "confirmed",
    sortOrder: 0,
    sourceFilename: "S-100.pdf",
    sourcePage: 1,
    ...over,
  });
  const scope = (attributes: ExportAttribute[]): ExportScope => ({
    projectName: "Example",
    client: null,
    runName: "Main",
    records: [
      { id: "rec-1", recordNo: 1, label: "P00001-001", itemDescription: "Sofa", qty: 1, area: null, runName: "Main", boqCodes: [] },
    ],
    attributes,
    answers: [],
  });
  const line = (attributes: ExportAttribute[]) => {
    const sheet = composeCheckSheet(scope(attributes));
    const row = sheet.rows.find((r) => r[CHECK_SHEET_HEADER.indexOf("Field id")] === "4");
    return (name: string) => row?.[CHECK_SHEET_HEADER.indexOf(name)];
  };

  it("names the exported value, the client's words and the standard in separate columns", () => {
    const at = line([attribute({ standard: AGREED })]);
    expect(at("Exported value")).toBe("BW Oak Grey - Open grain 10%");
    expect(at("Client specified")).toBe("feet dark tinted wood as per approved sample");
    expect(at("BW standard")).toBe("BW Oak Grey - Open grain 10% (agreed by the client)");
  });

  it("leaves the standard column empty where there is none", () => {
    const at = line([attribute()]);
    expect(at("Exported value")).toBe("feet dark tinted wood as per approved sample");
    expect(at("Client specified")).toBe("feet dark tinted wood as per approved sample");
    expect(at("BW standard")).toBe("");
  });
});

describe("a palette pick made before 0041 — read at read time, never rewritten", () => {
  const FIELDS = [{ id: "field-timber", jsonId: 4, name: "Main timber finish", palette: timber }];
  const pick = (over: Partial<DrawingObservation> = {}): DrawingObservation => ({
    id: "obs-1",
    version: 3,
    attrGroup: "finish",
    labelRaw: "SOFA FEET",
    valueRaw: "feet dark tinted wood as per approved sample",
    materialCodeRaw: null,
    // What the old PaletteChoice wrote.
    value: "BW Oak Grey - Open grain 10%",
    unit: null,
    unitSuggested: false,
    specFieldId: "field-timber",
    state: "confirmed",
    stateReason: null,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...over,
  });
  const staged = (observation: DrawingObservation) => ({
    kind: "shop_drawings",
    schemaVersion: 2,
    items: [{ id: "item-1", version: 1, page: 1, itemCodeRaw: "S-100", itemNameRaw: "SOFA", confidence: "high", targets: null, observations: [observation] }],
  });
  const read = (observation: DrawingObservation, fields = FIELDS) =>
    assertStagedDrawings(staged(observation), fields).items[0]!.observations[0]!;

  it("reads the option as a proposed standard and puts the drawing's words back in value", () => {
    const doc = staged(pick());
    const observation = assertStagedDrawings(doc, FIELDS).items[0]!.observations[0]!;
    expect(observation.value).toBe("feet dark tinted wood as per approved sample");
    expect(observation.standard).toEqual({ state: "proposed", value: "BW Oak Grey - Open grain 10%", optionId: "opt-grey" });
    // NEVER WRITTEN BACK: the staged JSON it was read from is unchanged.
    expect(doc.items[0]!.observations[0]!.value).toBe("BW Oak Grey - Open grain 10%");
    expect(doc.items[0]!.observations[0]!.standard).toBeUndefined();
  });

  it("leaves alone a row a person cleared with Other…", () => {
    expect(read(pick({ standard: null })).value).toBe("BW Oak Grey - Open grain 10%");
  });

  it("leaves alone a drawing that quotes BWS's own wording", () => {
    const observation = read(pick({ valueRaw: "bw oak grey - open grain 10%" }));
    expect(observation.standard).toBeUndefined();
  });

  it("leaves alone a value that is not an option, an applied row, and a register with no palettes", () => {
    expect(read(pick({ value: "dark oak, tidied" })).standard).toBeUndefined();
    expect(read(pick({ reviewStatus: "applied" })).standard).toBeUndefined();
    expect(read(pick(), [{ id: "field-timber", jsonId: 4, name: "Main timber finish", palette: null as unknown as Palette }]).standard).toBeUndefined();
  });

  it("is the same question the backfill asks of an applied row", () => {
    const paletteOf = new Map([["field-timber", timber]]);
    const applied = legacyPaletteStandard(pick({ reviewStatus: "applied" }), paletteOf, { includeApplied: true });
    expect(applied.value).toBe("feet dark tinted wood as per approved sample");
    expect(applied.standard?.state).toBe("proposed");
  });
});

describe("the confirm resolves the staged standard against the field's own list", () => {
  const FIELDS = [{ id: "field-timber", jsonId: 4, name: "Main timber finish", palette: timber }];
  const base = {
    id: "obs-1",
    version: 2,
    attrGroup: "finish" as const,
    labelRaw: "SOFA FEET",
    valueRaw: "dark oak",
    materialCodeRaw: null,
    value: "dark oak",
    unit: null,
    unitSuggested: false,
    specFieldId: "field-timber",
    state: "confirmed" as const,
    stateReason: null,
    reviewStatus: "pending" as const,
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
  };

  it("writes the option with its id, a TBC with none, and no standard as null", () => {
    expect(standardToWrite({ ...base, standard: { state: "proposed", value: "BW Walnut Dark", optionId: null } }, FIELDS)).toEqual({
      value: "BW Walnut Dark",
      optionId: "opt-walnut",
      state: "proposed",
    });
    expect(standardToWrite({ ...base, standard: { state: "tbc", value: null, optionId: null } }, FIELDS)).toEqual({
      value: null,
      optionId: null,
      state: "tbc",
    });
    expect(standardToWrite(base, FIELDS)).toBeNull();
  });

  it("refuses, in words, a standard that is no longer on the field's list", () => {
    expect(() =>
      standardToWrite({ ...base, standard: { state: "proposed", value: "BW Teak", optionId: null } }, FIELDS),
    ).toThrow(/not an option of its BWS field's list/);
  });
});
