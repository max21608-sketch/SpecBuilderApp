// Pure unit tests for the TOE dates and the Overdue state they unlock.
//
// The clock is an argument everywhere, so these assert real days rather than
// "whatever today happens to be when CI runs".
import { describe, expect, it } from "vitest";
import {
  daysUntilSpecsAgreed,
  hasProgramme,
  isCalendarDate,
  recordUrgency,
  todayLocal,
  validateProgramme,
} from "@/lib/project-programme";

const NONE = { orderDate: null, specsAgreedBy: null, deliveryDate: null };

describe("isCalendarDate", () => {
  it("accepts a real day", () => {
    expect(isCalendarDate("2026-06-17")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects a well-shaped non-day", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2025-02-29")).toBe(false);
  });

  it("rejects anything that is not the ISO shape", () => {
    expect(isCalendarDate("17/06/2026")).toBe(false);
    expect(isCalendarDate("2026-6-17")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("validateProgramme", () => {
  it("accepts an empty programme", () => {
    expect(validateProgramme(NONE)).toBeNull();
  });

  it("accepts a partial programme", () => {
    expect(validateProgramme({ ...NONE, orderDate: "2026-02-17" })).toBeNull();
  });

  it("accepts dates in order", () => {
    expect(
      validateProgramme({ orderDate: "2026-02-17", specsAgreedBy: "2026-04-01", deliveryDate: "2026-06-17" }),
    ).toBeNull();
  });

  it("accepts dates that coincide", () => {
    expect(
      validateProgramme({ orderDate: "2026-04-01", specsAgreedBy: "2026-04-01", deliveryDate: "2026-04-01" }),
    ).toBeNull();
  });

  it("refuses an order date after the delivery date", () => {
    expect(validateProgramme({ ...NONE, orderDate: "2026-06-18", deliveryDate: "2026-06-17" })).toMatch(
      /order date is after the delivery date/,
    );
  });

  it("refuses specs agreed after delivery", () => {
    expect(validateProgramme({ ...NONE, specsAgreedBy: "2026-07-01", deliveryDate: "2026-06-17" })).toMatch(
      /after the delivery date/,
    );
  });

  it("refuses an order date after specs are agreed", () => {
    expect(validateProgramme({ ...NONE, orderDate: "2026-05-01", specsAgreedBy: "2026-04-01" })).toMatch(
      /after the date specifications must be agreed/,
    );
  });

  it("refuses a date that is not a real day", () => {
    expect(validateProgramme({ ...NONE, deliveryDate: "2026-02-30" })).toMatch(/not a real date/);
  });
});

describe("recordUrgency", () => {
  const today = "2026-06-01";

  it("is complete when nothing is outstanding, whatever the date", () => {
    expect(recordUrgency({ outstanding: 0, allChased: false, specsAgreedBy: "2020-01-01", today })).toBe(
      "complete",
    );
  });

  it("is action_required when something has not been asked", () => {
    expect(recordUrgency({ outstanding: 3, allChased: false, specsAgreedBy: null, today })).toBe(
      "action_required",
    );
  });

  it("is waiting when everything outstanding has been asked", () => {
    expect(recordUrgency({ outstanding: 3, allChased: true, specsAgreedBy: null, today })).toBe("waiting");
  });

  // The null-date case the plan calls out: no programme must not render as
  // on-time. Nothing here can tell the two apart -- hasProgramme is what the
  // screen reads -- so this asserts only that a null date never invents Overdue.
  it("never reports overdue without a date", () => {
    expect(recordUrgency({ outstanding: 9, allChased: false, specsAgreedBy: null, today })).toBe(
      "action_required",
    );
    expect(recordUrgency({ outstanding: 9, allChased: true, specsAgreedBy: null, today })).toBe("waiting");
  });

  it("is overdue once the specs-agreed date has passed", () => {
    expect(recordUrgency({ outstanding: 1, allChased: false, specsAgreedBy: "2026-05-31", today })).toBe(
      "overdue",
    );
    expect(recordUrgency({ outstanding: 1, allChased: true, specsAgreedBy: "2026-05-31", today })).toBe(
      "overdue",
    );
  });

  it("is not overdue on the day itself", () => {
    expect(recordUrgency({ outstanding: 1, allChased: true, specsAgreedBy: today, today })).toBe("waiting");
  });

  it("is not overdue before the date", () => {
    expect(recordUrgency({ outstanding: 1, allChased: false, specsAgreedBy: "2026-06-02", today })).toBe(
      "action_required",
    );
  });
});

describe("hasProgramme", () => {
  it("is false when every date is null", () => {
    expect(hasProgramme(NONE)).toBe(false);
  });

  it("is true when any one date is set", () => {
    expect(hasProgramme({ ...NONE, specsAgreedBy: "2026-04-01" })).toBe(true);
  });
});

describe("daysUntilSpecsAgreed", () => {
  it("counts forward and back", () => {
    expect(daysUntilSpecsAgreed("2026-06-10", "2026-06-01")).toBe(9);
    expect(daysUntilSpecsAgreed("2026-05-25", "2026-06-01")).toBe(-7);
    expect(daysUntilSpecsAgreed("2026-06-01", "2026-06-01")).toBe(0);
  });

  // The UK clocks change between these two dates; a naive millisecond division
  // on local Dates would give 30.958 days and floor to the wrong answer.
  it("is unaffected by a daylight-saving change", () => {
    expect(daysUntilSpecsAgreed("2026-04-25", "2026-03-25")).toBe(31);
  });

  it("is null without a date", () => {
    expect(daysUntilSpecsAgreed(null, "2026-06-01")).toBeNull();
    expect(daysUntilSpecsAgreed("not a date", "2026-06-01")).toBeNull();
  });
});

describe("todayLocal", () => {
  it("formats the local day, not the UTC one", () => {
    // 23:30 on 30 June in a UTC+1 zone is still 30 June locally; a UTC read
    // would say 1 July and mark a project overdue a day early.
    const local = new Date(2026, 5, 30, 23, 30, 0);
    expect(todayLocal(local)).toBe("2026-06-30");
  });

  it("pads single digits", () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
