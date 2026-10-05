// Pure tier — BW's own finish, set once per CODE in the finishes library (0045).
//
// ============================================================================
// WHAT THESE HOLD
//
//   * Which list a code's BW finish comes from (`paletteForFinish`): the
//     fields its items sit in, then its kind, then none -- with why in words.
//   * The ONE rule for which standard is in force (`standardInForce`), and
//     that every reader goes through it: the BWS cell, the checklist answer,
//     the check sheet's BW standard column and a version diff.
//   * A version written before 0045 reads the item's own standard as the one
//     in force that day, so history does not change under it.
//
// Fixtures are synthetic. The option names are BWS's SHAPE, not a real row.
// ============================================================================
import { describe, it, expect } from "vitest";
import { paletteForFinish } from "@/lib/finish-standard-palette";
import {
  composeAttributeStatement,
  replacedItemStandard,
  standardInForce,
  type AttributeStandard,
} from "@/lib/bw-standard";
import { renderAttributeValue, type ExportAttribute, type ExportScope } from "@/lib/bws-export";
import { planAnswerFills, type PromotableAttribute } from "@/lib/promote-answers";
import { composeCheckSheet, CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { RECORD_ATOMS_SCHEMA_VERSION, type RecordAtoms } from "@/lib/record-atoms";
import type { Finish } from "@/lib/finishes";
import type { Palette } from "@/lib/palettes";

function palette(key: string, name: string, values: string[]): Palette {
  return {
    key,
    name,
    owner: "bws",
    allowsFreeText: true,
    sourceNote: null,
    syncedAt: "2026-09-22T00:00:00.000Z",
    options: values.map((value, index) => ({
      id: `opt-${key}-${index}`,
      value,
      label: value,
      sortOrder: index,
      isDefault: false,
      code: null,
    })),
  };
}

const TIMBER = palette("bws_timber_finish", "BWS timber finish palette", ["BW Oak Grey - Open grain 10%", "BW Walnut Dark"]);
const METAL = palette("bws_metal_finish", "BWS metal finish palette", ["BW Antiqued Brass"]);
// The register as `palettesByFieldJsonId` reads it: timber 4/31/143, metal
// 5/35, COM 1/2/3 nothing.
const BY_FIELD = new Map<number, Palette>([
  [4, TIMBER],
  [31, TIMBER],
  [143, TIMBER],
  [5, METAL],
  [35, METAL],
]);
const COM_1 = 1;

describe("which list a code's BW finish comes from — paletteForFinish", () => {
  it("timber fields read the timber list, whatever the kind says", () => {
    const reading = paletteForFinish(
      { kind: null },
      [
        { jsonId: 4, fieldName: "Main timber finish" },
        { jsonId: 31, fieldName: "Timber Finish 2" },
      ],
      BY_FIELD,
    );
    expect(reading.palette?.key).toBe("bws_timber_finish");
    expect(reading.from).toBe("fields");
    expect(reading.mixed).toBe(false);
    expect(reading.why).toMatch(/Main timber finish, Timber Finish 2/);
  });

  it("metal fields read the metal list", () => {
    const reading = paletteForFinish({ kind: "timber" }, [{ jsonId: 5 }, { jsonId: 35 }], BY_FIELD);
    expect(reading.palette?.key).toBe("bws_metal_finish");
    expect(reading.from).toBe("fields");
  });

  it("fields that disagree fall to the kind, and say the finish goes into every one of them", () => {
    const reading = paletteForFinish(
      { kind: "metal" },
      [
        { jsonId: 4, fieldName: "Main timber finish" },
        { jsonId: 5, fieldName: "Main metal finish" },
      ],
      BY_FIELD,
    );
    expect(reading.palette?.key).toBe("bws_metal_finish");
    expect(reading.from).toBe("kind");
    expect(reading.mixed).toBe(true);
    expect(reading.why).toMatch(/different fields/);
  });

  it("no placed item falls to the kind", () => {
    const reading = paletteForFinish({ kind: "timber" }, [{ jsonId: null }], BY_FIELD);
    expect(reading.palette?.key).toBe("bws_timber_finish");
    expect(reading.from).toBe("kind");
    expect(reading.mixed).toBe(false);
  });

  it("a fabric on COM has NO list, and says why rather than offering an empty one", () => {
    const onCom = paletteForFinish({ kind: "fabric" }, [{ jsonId: COM_1, fieldName: "COM 1" }], BY_FIELD);
    expect(onCom.palette).toBeNull();
    expect(onCom.why).toMatch(/COM 1/);
    const unplaced = paletteForFinish({ kind: "fabric" }, [], BY_FIELD);
    expect(unplaced.palette).toBeNull();
    expect(unplaced.why).toMatch(/COM fields carry no BWS list/);
  });

  it("items on COM win over a timber kind: a timber option must never ship into a COM cell", () => {
    expect(paletteForFinish({ kind: "timber" }, [{ jsonId: COM_1 }], BY_FIELD).palette).toBeNull();
  });

  it("nothing to read at all is none, in words, never an invented list", () => {
    const reading = paletteForFinish({ kind: null }, [], BY_FIELD);
    expect(reading.palette).toBeNull();
    expect(reading.why).toMatch(/set its kind/);
    // A register that could not be read offers nothing either.
    expect(paletteForFinish({ kind: "timber" }, [{ jsonId: 4 }], new Map()).palette).toBeNull();
  });
});

const ITEM_OWN: AttributeStandard = { value: "BW Walnut Dark", optionId: "opt-walnut", state: "agreed" };
const LIBRARY: AttributeStandard = { value: "BW Oak Grey - Open grain 10%", optionId: "opt-grey", state: "proposed" };
const LIBRARY_TBC: AttributeStandard = { value: null, optionId: null, state: "tbc" };

function finish(standard: AttributeStandard | null): Finish {
  return {
    id: "fin-1",
    code: "WD-05",
    codeNorm: "WD-05",
    codeOrigin: "client",
    kind: "timber",
    description: "Dark tinted oak",
    supplierRaw: null,
    reference: null,
    colour: null,
    state: "confirmed",
    standard,
  };
}

describe("which standard is in force — standardInForce, the one rule", () => {
  it("linked: the finish's, winning over the item's own from before", () => {
    expect(standardInForce({ standard: ITEM_OWN, finish: finish(LIBRARY) })).toEqual(LIBRARY);
  });

  it("unlinked: the attribute's own, exactly as 0041", () => {
    expect(standardInForce({ standard: ITEM_OWN, finish: null })).toEqual(ITEM_OWN);
  });

  it("linked to a finish whose BW finish is TBC: TBC, and the item's own does not ship", () => {
    expect(standardInForce({ standard: ITEM_OWN, finish: finish(LIBRARY_TBC) })).toEqual(LIBRARY_TBC);
  });

  it("linked to a finish with NONE: none -- per code only, no per-item override by the back door", () => {
    expect(standardInForce({ standard: ITEM_OWN, finish: finish(null) })).toBeNull();
  });

  it("names the item's own choice the library replaces, and nothing when they agree", () => {
    expect(replacedItemStandard({ standard: ITEM_OWN, finish: finish(LIBRARY) })).toEqual(ITEM_OWN);
    expect(replacedItemStandard({ standard: ITEM_OWN, finish: finish(null) })).toEqual(ITEM_OWN);
    expect(replacedItemStandard({ standard: LIBRARY, finish: finish(LIBRARY) })).toBeNull();
    expect(replacedItemStandard({ standard: ITEM_OWN, finish: null })).toBeNull();
    expect(replacedItemStandard({ standard: null, finish: finish(LIBRARY) })).toBeNull();
  });
});

describe("every reader asks the same rule", () => {
  const attribute = (over: Partial<ExportAttribute> = {}): ExportAttribute => ({
    id: "attr-1",
    recordId: "rec-1",
    attrGroup: "finish",
    label: "Feet",
    value: "feet dark tinted wood",
    unit: null,
    qualifier: null,
    dimensionSlot: null,
    materialCode: "WD-05",
    finish: finish(LIBRARY),
    standard: ITEM_OWN,
    specFieldJsonId: 4,
    state: "confirmed",
    sortOrder: 1,
    sourceFilename: "S-100.pdf",
    sourcePage: 1,
    ...over,
  });

  it("the BWS cell ships the library's BW finish, held at TBC while proposed", () => {
    expect(renderAttributeValue(attribute())).toBe("BW Oak Grey - Open grain 10% TBC");
    expect(renderAttributeValue(attribute({ finish: finish({ ...LIBRARY, state: "agreed" }) }))).toBe(
      "BW Oak Grey - Open grain 10%",
    );
    // No BW finish on the code: the library's words, and the item's own
    // earlier standard does not reappear.
    expect(renderAttributeValue(attribute({ finish: finish(null) }))).toBe("WD-05; Dark tinted oak");
    expect(composeAttributeStatement(attribute({ finish: finish(null) })).fromStandard).toBe(false);
  });

  it("the checklist answer makes the same choice as the cell", () => {
    const promotable: PromotableAttribute = {
      attrGroup: "finish",
      dimensionSlot: null,
      specFieldId: "field-4",
      value: "feet dark tinted wood",
      qualifier: null,
      unit: null,
      state: "confirmed",
      sortOrder: 1,
      sourceRunId: "run-1",
      standard: ITEM_OWN,
      finish: finish(LIBRARY),
    };
    const [fill] = planAnswerFills([promotable]);
    expect(fill).toMatchObject({ value: "BW Oak Grey - Open grain 10%", state: "tbc" });
  });

  it("the check sheet's BW standard column names the library's", () => {
    const scope: ExportScope = {
      projectName: "__QA",
      client: null,
      runName: "MAIN",
      records: [{ id: "rec-1", recordNo: 1, label: "P1-001", itemDescription: "Sofa", qty: 1, area: null, runName: "MAIN", boqCodes: ["S-100"] }],
      attributes: [attribute()],
      answers: [],
    };
    const sheet = composeCheckSheet(scope);
    const line = sheet.rows.find((row) => row[CHECK_SHEET_HEADER.indexOf("Field id")] === "4");
    expect(line?.[CHECK_SHEET_HEADER.indexOf("BW standard")]).toBe("BW Oak Grey - Open grain 10% (proposed)");
    expect(line?.[CHECK_SHEET_HEADER.indexOf("Client specified")]).toBe("feet dark tinted wood");
  });
});

describe("a version and its diff", () => {
  function atoms(attributes: ExportAttribute[], schemaVersion = RECORD_ATOMS_SCHEMA_VERSION): RecordAtoms {
    return {
      schemaVersion,
      project: { number: "P1", name: "__QA", client: null },
      record: { id: "rec-1", recordNo: 1, label: "P1-001", itemDescription: "Sofa", qty: 1, area: null, runName: "MAIN", boqCodes: [] },
      runId: "run-1",
      runName: "MAIN",
      status: "active",
      categoryId: null,
      categoryName: null,
      level: null,
      productReference: null,
      designer: null,
      boqCategory: null,
      parentId: null,
      splitReason: null,
      refs: [],
      attributes,
      answers: [],
      itemImage: null,
    };
  }
  const base = (standard: AttributeStandard | null, own: AttributeStandard | null): ExportAttribute => ({
    id: "attr-1",
    recordId: "rec-1",
    attrGroup: "finish",
    label: "Feet",
    value: "feet dark tinted wood",
    unit: null,
    qualifier: null,
    dimensionSlot: null,
    materialCode: "WD-05",
    finish: finish(standard),
    standard: own,
    specFieldJsonId: 4,
    state: "confirmed",
    sortOrder: 1,
    sourceFilename: null,
    sourcePage: null,
  });

  it("setting the code's BW finish is a change on the item's version, named as the library's", () => {
    const before = parseAtoms(JSON.parse(JSON.stringify(atoms([base(null, null)]))));
    const after = parseAtoms(JSON.parse(JSON.stringify(atoms([base(LIBRARY, null)]))));
    const diff = diffSnapshots(before, after);
    const line = diff.attributes[0]?.fields.find((field) => field.field === "standard");
    expect(line).toMatchObject({ label: "BW finish (set on WD-05)", was: null, now: "BW Oak Grey - Open grain 10% (proposed)" });
    // And the file moved with it.
    expect(diff.cells.some((cell) => cell.now === "BW Oak Grey - Open grain 10% TBC")).toBe(true);
  });

  it("a version written before 0045 reads the item's own standard as the one in force that day", () => {
    const old = JSON.parse(JSON.stringify(atoms([base(null, ITEM_OWN)], 7)));
    delete old.attributes[0].finish.standard;
    const parsed = parseAtoms(old);
    expect(parsed.attributes[0]?.finish?.standard).toEqual(ITEM_OWN);
    expect(renderAttributeValue(parsed.attributes[0]!)).toBe("BW Walnut Dark");
    // A version written since carries the finish's own, null included.
    const fresh = parseAtoms(JSON.parse(JSON.stringify(atoms([base(null, ITEM_OWN)]))));
    expect(fresh.attributes[0]?.finish?.standard).toBeNull();
  });
});
