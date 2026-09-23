// What a bill line's configurations have in common. Pure: the rule that
// decides whether an edit may fan out to every configuration has to be
// provable without a database, because a wrong "common" is an edit that
// overwrites a configuration somebody deliberately changed.
import { describe, expect, it } from "vitest";
import {
  commonGroupKey,
  readCommonAnswers,
  readCommonSpecs,
  seenRows,
  type CommonSourceAttribute,
  type CommonSourceConfiguration,
} from "@/lib/configuration-common";

let nextId = 0;
function attr(overrides: Partial<CommonSourceAttribute> = {}): CommonSourceAttribute {
  nextId += 1;
  return {
    id: `a${nextId}`,
    version: 1,
    attrGroup: "dimension",
    label: "Seat height",
    value: "440",
    unit: "mm",
    qualifier: null,
    state: "confirmed",
    dimensionSlot: "SH",
    specFieldId: null,
    fieldName: null,
    sortOrder: nextId,
    ...overrides,
  };
}

function config(n: number, attributes: CommonSourceAttribute[]): CommonSourceConfiguration {
  return { recordId: `r${n}`, number: `12.${n}`, variantLabel: `TYPE ${n}`, version: 1, attributes };
}

const COM1 = "field-com1";
const TIMBER = "field-timber";

describe("readCommonSpecs", () => {
  it("calls a row common when every configuration says exactly the same thing", () => {
    const reading = readCommonSpecs([config(1, [attr()]), config(2, [attr()]), config(3, [attr()])]);
    expect(reading.configurationCount).toBe(3);
    expect(reading.groups).toHaveLength(1);
    expect(reading.groups[0]!.status).toBe("common");
    expect(reading.groups[0]!.shared).toEqual({ label: "Seat height", value: "440", unit: "mm", qualifier: null, state: "confirmed" });
  });

  it("calls a row that differs in value, unit, state or qualifier DIFFERS, with each value", () => {
    for (const change of [{ value: "450" }, { unit: "cm" as const }, { state: "tbc" as const }, { qualifier: "to top of cushion" }]) {
      const reading = readCommonSpecs([config(1, [attr()]), config(2, [attr(change)])]);
      expect(reading.groups[0]!.status).toBe("differs");
      expect(reading.groups[0]!.shared).toBeNull();
      expect(reading.groups[0]!.members.map((member) => member.rows.length)).toEqual([1, 1]);
    }
  });

  it("compares values exactly: case is a difference, surrounding space is not", () => {
    const fabric = (value: string) => attr({ attrGroup: "material", label: "COM 1", dimensionSlot: null, unit: null, specFieldId: COM1, value });
    expect(readCommonSpecs([config(1, [fabric("Oak")]), config(2, [fabric("oak")])]).groups[0]!.status).toBe("differs");
    expect(readCommonSpecs([config(1, [fabric("Oak")]), config(2, [fabric(" Oak ")])]).groups[0]!.status).toBe("common");
  });

  it("calls a row on only SOME configurations differs, with 'none' for the rest", () => {
    const reading = readCommonSpecs([config(1, [attr()]), config(2, []), config(3, [attr()])]);
    const group = reading.groups[0]!;
    expect(group.status).toBe("differs");
    expect(group.members.map((member) => member.rows.length)).toEqual([1, 0, 1]);
  });

  it("handles a configuration with no specs at all", () => {
    const reading = readCommonSpecs([config(1, [attr(), attr({ dimensionSlot: "W", label: "Width", value: "600" })]), config(2, [])]);
    expect(reading.groups.map((group) => group.status)).toEqual(["differs", "differs"]);
    expect(reading.groups.every((group) => group.members[1]!.rows.length === 0)).toBe(true);
  });

  it("returns nothing for one configuration, and nothing for none", () => {
    expect(readCommonSpecs([config(1, [attr()])]).groups).toEqual([]);
    expect(readCommonSpecs([]).groups).toEqual([]);
  });

  it("matches a dimension by SLOT whatever its label says", () => {
    const reading = readCommonSpecs([config(1, [attr({ label: "SH" })]), config(2, [attr({ label: "Seat height" })])]);
    expect(reading.groups).toHaveLength(1);
    // The labels differ, and the reading is about the figure: common.
    expect(reading.groups[0]!.status).toBe("common");
  });

  it("matches a finish by its BWS FIELD, not by the label the drawing printed", () => {
    const timber = (label: string) =>
      attr({ attrGroup: "finish", label, dimensionSlot: null, unit: null, specFieldId: TIMBER, fieldName: "Main timber finish", value: "Oak" });
    const reading = readCommonSpecs([config(1, [timber("LEGS")]), config(2, [timber("Timber")])]);
    expect(reading.groups).toHaveLength(1);
    expect(reading.groups[0]!.title).toBe("Main timber finish");
  });

  it("matches a note by group and label folded by case and whitespace only", () => {
    const note = (label: string) => attr({ attrGroup: "note", label, dimensionSlot: null, unit: null, value: "520" });
    expect(readCommonSpecs([config(1, [note("ARM  HEIGHT")]), config(2, [note("arm height")])]).groups).toHaveLength(1);
    expect(readCommonSpecs([config(1, [note("ARM HEIGHT")]), config(2, [note("ARM HT")])]).groups).toHaveLength(2);
  });

  it("calls a group where one configuration holds TWO rows differs, because an edit would have to choose", () => {
    const note = () => attr({ attrGroup: "note", label: "Remarks", dimensionSlot: null, unit: null, value: "x" });
    const reading = readCommonSpecs([config(1, [note(), note()]), config(2, [note()])]);
    expect(reading.groups[0]!.status).toBe("differs");
    expect(reading.groups[0]!.members[0]!.rows).toHaveLength(2);
  });

  it("orders dimensions W D H SH Dia, then fabrics and finishes, then notes", () => {
    const rows = () => [
      attr({ attrGroup: "note", label: "Remarks", dimensionSlot: null, unit: null, value: "x" }),
      attr({ attrGroup: "material", label: "COM 1", dimensionSlot: null, unit: null, specFieldId: COM1, value: "Velvet" }),
      attr({ dimensionSlot: "SH", label: "SH" }),
      attr({ dimensionSlot: "W", label: "W", value: "600" }),
    ];
    const reading = readCommonSpecs([config(1, rows()), config(2, rows())]);
    expect(reading.groups.map((group) => group.section)).toEqual(["dimensions", "dimensions", "finishes", "notes"]);
    expect(reading.groups.slice(0, 2).map((group) => group.dimensionSlot)).toEqual(["W", "SH"]);
  });

  it("hands back every row it showed, with its version, for the edit's seen list", () => {
    const a = attr({ version: 3 });
    const b = attr({ version: 7 });
    const reading = readCommonSpecs([config(1, [a]), config(2, [b])]);
    expect(seenRows(reading.groups[0]!)).toEqual([
      { attributeId: a.id, version: 3 },
      { attributeId: b.id, version: 7 },
    ]);
  });

  it("keys a row the same way the route re-derives it", () => {
    expect(commonGroupKey({ dimensionSlot: "SH", specFieldId: "x", attrGroup: "dimension", label: "y" })).toBe("slot:SH");
    expect(commonGroupKey({ dimensionSlot: null, specFieldId: COM1, attrGroup: "material", label: "y" })).toBe(`field:${COM1}`);
    expect(commonGroupKey({ dimensionSlot: null, specFieldId: null, attrGroup: "note", label: " Arm  Height " })).toBe("label:note:arm height");
  });
});

describe("readCommonAnswers", () => {
  const answer = (requirementId: string, overrides: Partial<{ value: string | null; state: string; qualifier: string | null }> = {}) => ({
    answerId: `${requirementId}-${Math.random()}`,
    requirementId,
    prompt: requirementId,
    jsonId: null,
    value: null,
    qualifier: null,
    state: "missing",
    version: 1,
    ...overrides,
  });
  const configuration = (n: number, answers: ReturnType<typeof answer>[]) => ({
    recordId: `r${n}`,
    number: `12.${n}`,
    variantLabel: `TYPE ${n}`,
    answers,
  });

  it("calls a question missing on every configuration common, so it can be answered once", () => {
    const groups = readCommonAnswers([configuration(1, [answer("access")]), configuration(2, [answer("access")])]);
    expect(groups[0]!.status).toBe("common");
    expect(groups[0]!.shared).toEqual({ value: null, qualifier: null, state: "missing" });
  });

  it("calls a question answered differently on one configuration differs", () => {
    const groups = readCommonAnswers([
      configuration(1, [answer("access", { value: "Lift", state: "confirmed" })]),
      configuration(2, [answer("access", { value: "Stairs", state: "confirmed" })]),
    ]);
    expect(groups[0]!.status).toBe("differs");
    expect(groups[0]!.shared).toBeNull();
  });

  it("calls a question one configuration does not ask differs", () => {
    const groups = readCommonAnswers([configuration(1, [answer("access")]), configuration(2, [])]);
    expect(groups[0]!.status).toBe("differs");
    expect(groups[0]!.members[1]!.answer).toBeNull();
  });

  it("treats the same value in a different state as a difference", () => {
    const groups = readCommonAnswers([
      configuration(1, [answer("stud", { value: "Nickel", state: "confirmed" })]),
      configuration(2, [answer("stud", { value: "Nickel", state: "tbc" })]),
    ]);
    expect(groups[0]!.status).toBe("differs");
  });
});
