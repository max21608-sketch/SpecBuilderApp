// The wording a specification document's statements are recognised by (audit
// H4: `spec-reading-vocab.ts` had no direct test). Pure, invented values.
//
// The module is data, and its header makes promises about that data which
// nothing held: every entry says where it came from; every list is matched
// WHOLE after folding, so an entry written in a form the fold never produces
// is an entry that can never match; and three things are left out on purpose.
// Each promise is asserted on the lists themselves AND through the reader
// that uses them, so a list edited into a shape its reader cannot see fails
// here rather than quietly matching nothing.
import { describe, expect, it } from "vitest";
import {
  COM_ONLY_VALUES,
  NO_FIELD_CODE_PREFIXES,
  SIZE_LABELS,
  SIZE_PREFIX_SLOTS,
  WELDED_LABELS,
  ZONED_CODE,
} from "@/lib/spec-reading-vocab";
import { readDimension, sizeLabel } from "@/lib/spec-dimensions";
import { kindCode, readFinish, readFinishes } from "@/lib/spec-finishes";
import { readBillDescription } from "@/lib/bill-description";
import { DIMENSION_SLOTS } from "@/lib/spec-vocab";

/** The fold the readers apply: lower case, every run of non-alphanumerics one space. */
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

describe("every entry says where it came from", () => {
  it.each([
    ["SIZE_LABELS", SIZE_LABELS],
    ["NO_FIELD_CODE_PREFIXES", NO_FIELD_CODE_PREFIXES],
    ["SIZE_PREFIX_SLOTS", SIZE_PREFIX_SLOTS],
    ["WELDED_LABELS", WELDED_LABELS],
  ] as const)("%s", (_name, list) => {
    for (const entry of list) expect(entry.from.trim().length, JSON.stringify(entry)).toBeGreaterThan(0);
  });
});

describe("SIZE_LABELS: an overall label, matched whole", () => {
  it("holds each label in the folded form, so the reader can match it at all", () => {
    for (const { label } of SIZE_LABELS) expect(fold(label), label).toBe(label);
    expect(new Set(SIZE_LABELS.map((entry) => entry.label)).size).toBe(SIZE_LABELS.length);
  });

  it("is read by sizeLabel, with a bracketed unit taken off and kept", () => {
    for (const { label } of SIZE_LABELS) {
      expect(sizeLabel(label), label).toEqual({ unit: null, imperial: false });
      expect(sizeLabel(`${label.toUpperCase()} (mm)`)?.unit, label).toBe("mm");
    }
    expect(sizeLabel("Sizes (ft-in)")).toEqual({ unit: null, imperial: true });
    expect(sizeLabel("Spec size:")).not.toBeNull();
  });

  it("never matches a label that only CONTAINS one", () => {
    // The whole-label rule: a substring rule reads these as the item's size.
    for (const label of ["Arm height (mm)", "Width seat", "Overall height", "Seat size", "Size of base", "Spec sizes approx"]) {
      expect(sizeLabel(label), label).toBeNull();
    }
  });

  it("leaves out a reclined size on purpose, so a reclined length is never a width", () => {
    expect(SIZE_LABELS.map((entry) => entry.label)).not.toContain("sizes fully reclined");
    expect(sizeLabel("Sizes (cm) - Fully reclined")).toBeNull();
    expect(readDimension("Sizes (cm) - Fully reclined", "W 90 x D 180 x H 80")).toBeNull();
  });

  it("licenses reading the VALUE as a combined line", () => {
    const reading = readDimension("Spec size", "D 460 X H 450 mm");
    expect(reading?.parts.map((part) => [part.slot, part.figure])).toEqual([
      ["D", "460"],
      ["H", "450"],
    ]);
    expect(reading?.unit).toBe("mm");
  });
});

describe("SIZE_PREFIX_SLOTS: a vocabulary prefix inside a size line", () => {
  it("holds lower-case prefixes with no dots, each for a real slot, and never L", () => {
    for (const { prefix, slot } of SIZE_PREFIX_SLOTS) {
      expect(prefix).toMatch(/^[a-z]+$/);
      expect(DIMENSION_SLOTS).toContain(slot);
    }
    expect(SIZE_PREFIX_SLOTS.map((entry) => entry.prefix)).not.toContain("l");
  });

  it("reads OAH as the height, as the line prints it", () => {
    const reading = readDimension("Sizes (mm)", "W 1651 x D 482 x OAH 406 x SH 355");
    expect(reading?.parts.map((part) => [part.slot, part.figure])).toEqual([
      ["W", "1651"],
      ["D", "482"],
      ["H", "406"],
      ["SH", "355"],
    ]);
  });

  it("gives L no slot: a length is not a width", () => {
    const reading = readDimension("Sizes (mm)", "L 540 x W 345 x H 450");
    expect(reading?.parts.map((part) => part.slot) ?? []).not.toContain("L");
    expect(reading?.parts.filter((part) => part.slot === "W").map((part) => part.figure) ?? []).toEqual(["345"]);
  });
});

describe("ZONED_CODE: a zone in front of the document's own code", () => {
  it("takes the zone off, and leaves anything else as it is", () => {
    expect(kindCode("GR-TIM-09")).toBe("TIM-09");
    expect(kindCode("PL-MTL-03")).toBe("MTL-03");
    expect(kindCode("ZZ-STN-03 COMPOSITE")).toBe("STN-03 COMPOSITE");
    for (const code of ["TIM-09", "CH-01.1", "ABCDE-TIM-01", "G-TIM-01", "GR-01"]) expect(kindCode(code), code).toBe(code);
    expect(ZONED_CODE.test("GR-TIM-09")).toBe(true);
  });
});

describe("NO_FIELD_CODE_PREFIXES: a material no BWS field holds", () => {
  it("holds lower-case letters only, the form the reader compares", () => {
    for (const { prefix } of NO_FIELD_CODE_PREFIXES) expect(prefix).toMatch(/^[a-z]+$/);
  });

  it("is kept against the item and placed in no field, zoned or not", () => {
    for (const code of ["STN-02", "GR-STN-02"]) {
      const reading = readFinish("Finish", code);
      expect(reading, code).toMatchObject({ kind: null, group: "finish", codeRaw: code });
      expect(reading?.noField, code).toMatch(/is a stone code and no BWS field holds it/);
    }
    // A prefix with no known meaning is named as a code and nothing more.
    expect(readFinish("Finish", "SPF-01")?.noField).toMatch(/^SPF-01 is a finish code and no BWS field holds it/);
  });

  it("does not stop the codes beside it reaching their fields", () => {
    expect(readFinishes("Finish", "STN-07, MTL-02").map((reading) => [reading.codeRaw, reading.kind])).toEqual([
      ["STN-07", null],
      ["MTL-02", "metal"],
    ]);
  });
});

describe("COM_ONLY_VALUES: customer's own material names no cloth", () => {
  it("holds each value in the folded form the reader compares", () => {
    for (const value of COM_ONLY_VALUES) expect(fold(value), value).toBe(value);
  });

  it("claims no COM slot for any spelling of it, matched as the WHOLE value", () => {
    for (const value of ["COM", "C.O.M.", "Customer's Own Material", "clients own material"]) {
      expect(readFinish("Fabric", value), value).toMatchObject({ kind: null, group: "note" });
    }
    // The whole value, not a word in it: a cloth "to follow" is a TBC fabric.
    expect(readFinish("Fabric", "COM fabric to follow")).toMatchObject({ kind: "fabric", tbc: true });
  });
});

describe("WELDED_LABELS: a label stuck to the figure before it", () => {
  it("holds lower-case words", () => {
    for (const { label } of WELDED_LABELS) expect(label).toMatch(/^[a-z]+$/);
  });

  it("starts its own statement only after a digit and before a colon", () => {
    const welded = readBillDescription("Example bench\nSizes(mm): W 1651 x D 482 x SH 355Finish: ZZ-TIM-09");
    expect(welded?.statements.map((statement) => statement.line)).toEqual([
      "Sizes(mm): W 1651 x D 482 x SH 355",
      "Finish: ZZ-TIM-09",
    ]);
    // A space in front, or no colon after, is not a lost line break.
    const kept = readBillDescription("Example bench\nNote: 355 Finish to match\nRefinish: none");
    expect(kept?.statements.map((statement) => statement.line)).toEqual(["Note: 355 Finish to match", "Refinish: none"]);
  });
});
