// The ONE TGQ rule (Max, 2026-10-12): an item's TGQ is its outstanding
// questions whose tier is `to_quote`, of ANY kind, MINUS the project-wide
// section. Pure tier: every screen counts through these functions, and the
// SQL re-expression in project-summary.ts is held equal to them by
// tests/db/project-summary.test.ts.
import { describe, expect, it } from "vitest";
import {
  inChaseAsk,
  inItemTgq,
  inProjectWideTgq,
  isProjectWideQuestion,
  itemTgqCounts,
  projectWideTgqKeys,
} from "@/lib/chase-grouping";
import { PROJECT_WIDE_SECTION } from "@/lib/checklist-sections";

type Q = Parameters<typeof itemTgqCounts>[0][number] & {
  requirementId: string;
  prompt: string;
  jsonId: number | null;
  localKey: string | null;
};

let n = 0;
const q = (over: Partial<Q> = {}): Q => {
  n += 1;
  return {
    requirementId: `req-${n}`,
    prompt: `Question ${n}`,
    jsonId: null,
    localKey: null,
    tier: "to_quote",
    section: "Build details",
    requirementKind: "spec_field",
    ...over,
  };
};

const pw = (over: Partial<Q> = {}) => q({ section: PROJECT_WIDE_SECTION, ...over });

describe("the item TGQ predicate", () => {
  it("counts a readiness question, and leaves the project-wide section out", () => {
    expect(inItemTgq(q({ requirementKind: "readiness" }))).toBe(true);
    expect(inItemTgq(pw())).toBe(false);
    expect(inProjectWideTgq(pw())).toBe(true);
    expect(inItemTgq(q({ tier: "later" }))).toBe(false);
    expect(inProjectWideTgq(pw({ tier: "later" }))).toBe(false);
    expect(isProjectWideQuestion({ section: null })).toBe(false);
  });

  it("a chase asks the item's specification questions only", () => {
    expect(inChaseAsk(q())).toBe(true);
    expect(inChaseAsk(q({ requirementKind: "readiness" }))).toBe(false);
    expect(inChaseAsk(pw())).toBe(false);
  });

  it("measured on the local copy: Drawers is 18 spec + 9 readiness of its own, 17 project-wide", () => {
    // v3-002 read 44 on the phase table and 20 on the fill-in screen. Its 44
    // to_quote questions are 18 spec fields and 9 readiness about the item,
    // and 17 in the project-wide section (15 readiness, plus Access and Site
    // survey, which are spec fields). One rule: 27 everywhere.
    const drawers = [
      ...Array.from({ length: 18 }, () => q()),
      ...Array.from({ length: 9 }, () => q({ requirementKind: "readiness" })),
      ...Array.from({ length: 15 }, () => pw({ requirementKind: "readiness" })),
      pw({ jsonId: 6 }),
      pw({ jsonId: 7 }),
      q({ tier: "later" }),
    ];
    expect(itemTgqCounts(drawers)).toEqual({ toQuote: 27, toChase: 18, projectWide: 17, later: 1 });
  });

  it("is null, never zero, where any question is untiered", () => {
    expect(itemTgqCounts([q(), q({ tier: null })])).toBeNull();
    expect(itemTgqCounts([])).toEqual({ toQuote: 0, toChase: 0, projectWide: 0, later: 0 });
  });

  it("counts project-level TGQ by QUESTION, not by row", () => {
    // `requirements` is per category: Access is seventeen rows and one
    // question. Two items asking it, through two categories, is ONE.
    const keys = projectWideTgqKeys([
      pw({ requirementId: "sofa-access", jsonId: 6 }),
      pw({ requirementId: "desk-access", jsonId: 6 }),
      pw({ requirementId: "toe-a", prompt: "TOE  agreement" }),
      pw({ requirementId: "toe-b", prompt: "toe agreement" }),
      pw({ requirementId: "later", jsonId: 191, tier: "later" }),
      q({ jsonId: 3 }),
    ]);
    expect([...keys].sort()).toEqual(["field:6", "prompt:toe agreement"]);
  });
});
