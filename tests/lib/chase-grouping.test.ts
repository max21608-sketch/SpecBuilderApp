import { describe, expect, it } from "vitest";
import { allQuestions, countOutstanding, groupIntoLines, type GroupableQuestion } from "@/lib/chase-grouping";

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
