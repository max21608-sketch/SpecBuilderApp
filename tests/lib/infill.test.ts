// Pure tier — the infill screen's summary, and which control a gap gets.
//
// The grouping itself is `groupIntoLines` and is tested in
// `chase-grouping.test.ts`. What is tested here is the part that is this
// screen's own: the summary a collapsed line carries, and the decision that
// keeps a dimension out of the answer box.
import { describe, expect, it } from "vitest";
import { countStates, rowKind, summariseLines } from "@/lib/infill";
import type { GroupableQuestion } from "@/lib/chase-grouping";
import type { Palette } from "@/lib/palettes";

type Q = GroupableQuestion & { requirementId: string; area: string | null; state: string };

function question(over: Partial<Q>): Q {
  return {
    recordId: "r1",
    requirementId: "q1",
    requirementKind: "spec_field",
    tier: "to_quote",
    state: "missing",
    waiting: null,
    refs: "S-301",
    itemDescription: "Desk chair",
    level: "hero",
    qty: 45,
    runId: "run1",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    parentRefs: "",
    parentQty: null,
    groupNo: 11,
    groupLabel: "AP364c-011",
    variantCount: 0,
    area: "Signature Suite",
    ...over,
  };
}

function palette(over: Partial<Palette> = {}): Palette {
  return {
    key: "outdoor",
    name: "Indoor / outdoor",
    owner: "app",
    allowsFreeText: true,
    sourceNote: null,
    syncedAt: null,
    options: [
      { value: "Indoor", label: "Indoor", sortOrder: 1, isDefault: false, code: null },
      { value: "Outdoor", label: "Outdoor", sortOrder: 2, isDefault: false, code: null },
    ],
    ...over,
  };
}

describe("summariseLines", () => {
  it("carries the line's identity, its two counts and its area", () => {
    const lines = summariseLines([
      question({ requirementId: "a" }),
      question({ requirementId: "b", tier: "later" }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineId: "r1",
      code: "S-301",
      qty: 45,
      area: "Signature Suite",
      counts: { toQuote: 1, later: 1, waiting: 0 },
    });
  });

  it("keeps the TRUE finish-option count, including options with nothing outstanding", () => {
    const lines = summariseLines([
      question({ recordId: "line", variantCount: 3 }),
      question({ recordId: "a", parentId: "line", variantLabel: "A", requirementId: "q2", parentRefs: "S-301" }),
    ]);
    expect(lines[0]!.optionCount).toBe(3);
    expect(lines[0]!.options).toHaveLength(1);
    expect(lines[0]!.options[0]!.name).toBe("S-301 A");
  });

  it("never apportions a quantity across finish options", () => {
    const lines = summariseLines([
      question({ recordId: "line", variantCount: 2, qty: 45 }),
      question({ recordId: "a", parentId: "line", variantLabel: "A", qty: null, parentQty: 45, requirementId: "q2" }),
    ]);
    expect(lines[0]!.qty).toBe(45);
    expect(lines[0]!.options[0]).not.toHaveProperty("qty");
  });

  it("lists a line with no area rather than dropping it", () => {
    const lines = summariseLines([question({ area: null })]);
    expect(lines[0]!.area).toBeNull();
  });

  it("counts each state, so the state filter can narrow the list before a line is opened", () => {
    const lines = summariseLines([
      question({ requirementId: "a", state: "missing" }),
      question({ requirementId: "b", state: "tbc" }),
      question({ requirementId: "c", state: "tbc" }),
    ]);
    expect(lines[0]!.states).toEqual({ missing: 1, tbc: 2 });
  });
});

describe("countStates", () => {
  it("treats anything that is not TBC as missing — the loader returns only the two", () => {
    expect(countStates([{ state: "missing" }, { state: "tbc" }])).toEqual({ missing: 1, tbc: 1 });
  });
});

describe("rowKind", () => {
  it("sends the composed Dimensions cell to the attribute writer, never to an answer box", () => {
    // BWS json_id 3. The cell is a projection of the record's dimension
    // attributes, so a value typed into the answer survives until the next
    // recomposition and no further.
    expect(rowKind({ jsonId: 3 }, null)).toBe("dimension");
    expect(rowKind({ jsonId: 3 }, palette())).toBe("dimension");
  });

  it("offers a palette this app actually holds", () => {
    expect(rowKind({ jsonId: 41 }, palette())).toBe("palette");
  });

  it("falls back to text where BWS owns the list and we have never had it", () => {
    // Five of Matthew's palettes are seeded with ZERO options on purpose. An
    // empty dropdown reads as broken; `AnswerValue` says so in a sentence and
    // keeps the box free text.
    expect(rowKind({ jsonId: 55 }, palette({ options: [] }))).toBe("text");
    expect(rowKind({ jsonId: 55 }, null)).toBe("text");
  });
});
