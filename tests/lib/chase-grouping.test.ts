import { describe, expect, it } from "vitest";
import {
  allQuestions,
  countOutstanding,
  groupByQuestion,
  groupIntoLines,
  type GroupableQuestion,
} from "@/lib/chase-grouping";

type Q = GroupableQuestion & { requirementId: string };

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
    ...over,
  };
}

describe("groupIntoLines", () => {
  it("puts a bill line's own questions on the line, with no finish options", () => {
    const lines = groupIntoLines([question({ requirementId: "a" }), question({ requirementId: "b" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.lineId).toBe("r1");
    expect(lines[0]!.code).toBe("S-301");
    expect(lines[0]!.qty).toBe(45);
    expect(lines[0]!.own).toHaveLength(2);
    expect(lines[0]!.options).toEqual([]);
    expect(lines[0]!.optionCount).toBe(0);
  });

  it("gathers finish options under their bill line, in letter order", () => {
    const opt = (recordId: string, label: string) =>
      question({
        recordId,
        variantLabel: label,
        parentId: "r1",
        refs: "",
        parentRefs: "S-301",
        // A finish option is never apportioned a quantity.
        qty: null,
        parentQty: 45,
      });
    const lines = groupIntoLines([opt("v2", "B"), opt("v1", "A")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.options.map((option) => option.label)).toEqual(["A", "B"]);
    expect(lines[0]!.options.map((option) => option.name)).toEqual(["S-301 A", "S-301 B"]);
    // The client's ref is unchanged by a split, and the bill's quantity is the
    // line's, never divided between its options.
    expect(lines[0]!.code).toBe("S-301");
    expect(lines[0]!.qty).toBe(45);
    expect(lines[0]!.recordLabel).toBe("AP364c-011");
  });

  it("keeps a heading's own questions beside its finish options", () => {
    const lines = groupIntoLines([
      question({ requirementId: "own", variantCount: 2 }),
      question({ recordId: "v1", variantLabel: "A", parentId: "r1", refs: "", parentRefs: "S-301", parentQty: 45 }),
    ]);
    expect(lines[0]!.own).toHaveLength(1);
    expect(lines[0]!.options).toHaveLength(1);
    expect(allQuestions(lines[0]!)).toHaveLength(2);
  });

  it("prints the TRUE number of finish options, not the number with questions left", () => {
    // B has nothing outstanding, so it contributes no question and no row. The
    // count still has to say 2: "1" would be a claim that B does not exist.
    const lines = groupIntoLines([
      question({ requirementId: "own", variantCount: 2 }),
      question({ recordId: "v1", variantLabel: "A", parentId: "r1", refs: "", parentRefs: "S-301", parentQty: 45 }),
    ]);
    expect(lines[0]!.optionCount).toBe(2);
    expect(lines[0]!.options).toHaveLength(1);
  });

  it("holds one line per record, in the order the rows arrived", () => {
    const lines = groupIntoLines([
      question({ recordId: "r1", groupNo: 11, groupLabel: "AP364c-011", refs: "S-301" }),
      question({ recordId: "r2", groupNo: 14, groupLabel: "AP364c-014", refs: "S-402" }),
      question({ recordId: "r1", requirementId: "q2", groupNo: 11, groupLabel: "AP364c-011", refs: "S-301" }),
    ]);
    expect(lines.map((line) => line.code)).toEqual(["S-301", "S-402"]);
    expect(lines[0]!.own).toHaveLength(2);
  });

  it("collects every contact a line's questions would be asked of", () => {
    const withContact = (contactId: string, recordId: string) =>
      ({ ...question({ recordId }), contactId }) as Q & { contactId: string };
    const lines = groupIntoLines([withContact("c1", "r1"), withContact("c1", "r1")]);
    expect(lines[0]!.contactIds).toEqual(["c1"]);
  });
});

describe("countOutstanding", () => {
  it("counts a readiness question as outstanding but never as blocking a quote", () => {
    const counts = countOutstanding([
      question({ tier: "to_quote" }),
      question({ tier: "to_quote", requirementKind: "readiness" }),
      question({ tier: "later" }),
    ]);
    expect(counts).toEqual({ toQuote: 1, later: 2, waiting: 0 });
  });

  it("counts a question with no tier as outstanding rather than as blocking", () => {
    // A record with no level has no tier. tgq.ts refuses to read one, and a
    // count that guessed would make a levelless record look quotable.
    expect(countOutstanding([question({ tier: null })])).toEqual({ toQuote: 0, later: 1, waiting: 0 });
  });

  it("counts what is awaiting a reply alongside, not instead", () => {
    const counts = countOutstanding([question({ waiting: { draftId: "d1" } }), question({})]);
    expect(counts).toEqual({ toQuote: 2, later: 0, waiting: 1 });
  });
});

// ---------------------------------------------------------------------------
// The second grouping: by question.
// ---------------------------------------------------------------------------
type QG = Q & { prompt: string; fieldLabel: string | null; jsonId?: number | null; localKey?: string | null; area: string | null };

function asked(over: Partial<QG>): QG {
  return {
    ...question({}),
    prompt: "Dimensions",
    fieldLabel: "Dimensions",
    jsonId: 3,
    localKey: null,
    area: "Signature Suite",
    ...over,
  };
}

describe("groupByQuestion", () => {
  it("FOLDS THE SAME QUESTION ACROSS CATEGORIES INTO ONE HEADING", () => {
    // `requirements` is seeded per category, so "Dimensions" is seventeen rows.
    // Measured on the sandbox 300-line project: nine of them, 401 items. Four
    // separate "Dimensions" headings would let somebody clear one and believe
    // they had done dimensions.
    const groups = groupByQuestion([
      asked({ recordId: "r1", requirementId: "req-armchairs" }),
      asked({ recordId: "r2", requirementId: "req-sofas" }),
      asked({ recordId: "r3", requirementId: "req-desks" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.heading).toBe("Dimensions");
    expect(groups[0]!.requirementIds).toEqual(["req-armchairs", "req-sofas", "req-desks"]);
    expect(groups[0]!.rows).toHaveLength(3);
  });

  it("keys on the BWS field, then the local key, then the prompt", () => {
    const groups = groupByQuestion([
      asked({ requirementId: "a", jsonId: 3 }),
      asked({ requirementId: "b", jsonId: null, localKey: "headboard_fitted", prompt: "Headboard fitted?", fieldLabel: null }),
      asked({ requirementId: "c", jsonId: null, localKey: null, prompt: "  Stitching  SPEC ", fieldLabel: null }),
      asked({ requirementId: "d", jsonId: null, localKey: null, prompt: "Stitching spec", fieldLabel: null }),
    ]);
    expect(groups.map((g) => g.key).sort()).toEqual([
      "field:3",
      "local:headboard_fitted",
      "prompt:stitching spec",
    ]);
  });

  it("keeps a question with one record under its own heading", () => {
    const groups = groupByQuestion([asked({ requirementId: "only" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(1);
  });

  it("counts to-quote PER ROW, because a level can differ between items", () => {
    const groups = groupByQuestion([
      asked({ recordId: "r1", tier: "to_quote", level: "hero" }),
      asked({ recordId: "r2", tier: "later", level: "simple" }),
    ]);
    expect(groups[0]!.toQuote).toBe(1);
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it("a readiness question never counts as blocking a quote", () => {
    const groups = groupByQuestion([
      asked({ requirementKind: "readiness", tier: "to_quote", jsonId: null, localKey: "toe", fieldLabel: null }),
    ]);
    expect(groups[0]!.toQuote).toBe(0);
  });

  it("sorts what blocks a quote first, then by heading, stably", () => {
    const groups = groupByQuestion([
      asked({ requirementId: "a", jsonId: 90, fieldLabel: "Zebra finish", tier: "later" }),
      asked({ requirementId: "b", jsonId: 3, fieldLabel: "Dimensions", tier: "to_quote" }),
      asked({ requirementId: "c", jsonId: 91, fieldLabel: "Alpha finish", tier: "later" }),
    ]);
    expect(groups.map((g) => g.heading)).toEqual(["Dimensions", "Alpha finish", "Zebra finish"]);
  });

  it("every question lands in exactly one group, whichever way it is grouped", () => {
    const rows = [
      asked({ recordId: "r1", requirementId: "a" }),
      asked({ recordId: "r1", requirementId: "b", jsonId: 1, fieldLabel: "COM 1" }),
      asked({ recordId: "r2", requirementId: "a" }),
    ];
    const byQuestion = groupByQuestion(rows).reduce((n, g) => n + g.rows.length, 0);
    const byLine = groupIntoLines(rows).reduce((n, line) => n + allQuestions(line).length, 0);
    expect(byQuestion).toBe(rows.length);
    expect(byLine).toBe(rows.length);
  });
});
