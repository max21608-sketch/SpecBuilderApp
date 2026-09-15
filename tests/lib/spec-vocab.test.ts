// Pure tier. The controlled vocabularies, and the one function that resolves
// free text into them.
//
// `normaliseUnit` had no callers at all until a drawing page's printed unit and
// a project's default unit both needed resolving — its "one implementation"
// comment described an intention rather than a fact. These are the cases both
// of those depend on.
import { describe, it, expect } from "vitest";
import {
  ATTRIBUTE_UNITS,
  ATTRIBUTE_UNIT_LABELS,
  PROJECT_STATUSES,
  isProjectStatus,
  normaliseUnit,
} from "@/lib/spec-vocab";

describe("normaliseUnit", () => {
  it("accepts the four units in their own spelling", () => {
    for (const unit of ATTRIBUTE_UNITS) expect(normaliseUnit(unit)).toBe(unit);
  });

  it("accepts the spellings a document actually uses", () => {
    expect(normaliseUnit("MM")).toBe("mm");
    expect(normaliseUnit("Millimetres")).toBe("mm");
    expect(normaliseUnit("millimeters")).toBe("mm");
    expect(normaliseUnit(" cm ")).toBe("cm");
    expect(normaliseUnit("Centimetre")).toBe("cm");
    expect(normaliseUnit("metres")).toBe("m");
    expect(normaliseUnit("inches")).toBe("in");
    expect(normaliseUnit('"')).toBe("in");
  });

  it("tolerates the trailing full stop of an abbreviation", () => {
    expect(normaliseUnit("mm.")).toBe("mm");
  });

  it("returns null rather than a guess for anything else", () => {
    // The whole contract. A near-miss must fall through to the next source,
    // never become a unit that reads as a real measurement.
    expect(normaliseUnit("cms")).toBeNull();
    expect(normaliseUnit("millimetre(s)")).toBeNull();
    expect(normaliseUnit("feet")).toBeNull();
    expect(normaliseUnit("")).toBeNull();
    expect(normaliseUnit(null)).toBeNull();
    expect(normaliseUnit(undefined)).toBeNull();
    expect(normaliseUnit(1800)).toBeNull();
  });

  it("labels every unit it knows", () => {
    // A missing label would render `undefined` in the project's select.
    for (const unit of ATTRIBUTE_UNITS) expect(ATTRIBUTE_UNIT_LABELS[unit]).toMatch(/\w/);
  });
});

describe("project status", () => {
  it("is archived, never deleted", () => {
    expect(PROJECT_STATUSES).toEqual(["active", "archived"]);
  });

  it("recognises only its own values", () => {
    expect(isProjectStatus("active")).toBe(true);
    expect(isProjectStatus("archived")).toBe(true);
    // `retired` is what a run and a note are. A project is not, and accepting
    // it here would write a value the check constraint refuses.
    expect(isProjectStatus("retired")).toBe(false);
    expect(isProjectStatus("Archived")).toBe(false);
    expect(isProjectStatus(null)).toBe(false);
  });
});
