// Pure tier — what `npm run measure:outstanding` counts.
//
// The tool itself is I/O: it loads, times and prints. Everything that decides
// a number is here, so the figure four screens are supposed to agree on can be
// checked without a database.
import { describe, expect, it } from "vitest";
import { measureOutstanding, type MeasurableQuestion } from "@/lib/outstanding-measure";

function question(overrides: Partial<MeasurableQuestion> = {}): MeasurableQuestion {
  return {
    recordId: "rec-1",
    recordLabel: "P17231-007",
    itemDescription: "Armchair",
    categoryId: "cat-mapped",
    requirementId: "req-1",
    requirementKind: "spec_field",
    prompt: "Dimensions",
    fieldLabel: "Dimensions",
    state: "missing",
    tier: "to_quote",
    level: "complex",
    parentId: null,
    area: "Signature Suite",
    ...overrides,
  };
}

const MATRIX = new Set(["cat-mapped"]);

describe("measureOutstanding", () => {
  it("counts the whole and each half", () => {
    const result = measureOutstanding(
      [
        question(),
        question({ requirementId: "req-2", tier: "later" }),
        question({ requirementId: "req-3", requirementKind: "readiness", tier: "later", state: "tbc" }),
      ],
      MATRIX,
    );
    expect(result.questions).toBe(3);
    expect(result.specField).toBe(2);
    expect(result.readiness).toBe(1);
    expect(result.missing).toBe(2);
    expect(result.tbc).toBe(1);
    expect(result.toQuote).toBe(1);
    expect(result.later).toBe(2);
  });

  it("splits to-quote by WHICH model answered, because the fallback is a ceiling", () => {
    // A category Matthew's matrix covers, and one it does not: the second
    // still has all three levels seeded on every question, so its to-quote
    // figure is "everything" rather than a decision. Reporting them as one
    // number hides that half the total is a placeholder.
    const result = measureOutstanding(
      [
        question(),
        question({ recordId: "rec-2", categoryId: "cat-unmapped", requirementId: "req-9" }),
        question({ recordId: "rec-2", categoryId: "cat-unmapped", requirementId: "req-10" }),
      ],
      MATRIX,
    );
    expect(result.toQuoteFromMatrix).toBe(1);
    expect(result.toQuoteFromFallback).toBe(2);
    expect(result.recordsOnMatrix).toBe(1);
    expect(result.recordsOnFallback).toBe(1);
  });

  it("counts a question with NO tier apart — its record has no level, so neither model can answer", () => {
    const result = measureOutstanding([question({ tier: null, level: null })], MATRIX);
    expect(result.toQuote).toBe(0);
    expect(result.later).toBe(0);
    expect(result.noTier).toBe(1);
  });

  it("counts a finish option under its bill line, the way the chase screen groups", () => {
    const result = measureOutstanding(
      [
        question({ recordId: "line-1" }),
        question({ recordId: "opt-a", parentId: "line-1", requirementId: "req-2" }),
        question({ recordId: "opt-b", parentId: "line-1", requirementId: "req-3" }),
      ],
      MATRIX,
    );
    expect(result.records).toBe(3);
    expect(result.lines).toBe(1);
  });

  it("reports a record with no area rather than dropping it", () => {
    const result = measureOutstanding([question(), question({ requirementId: "req-2", area: null })], MATRIX);
    expect(result.areas).toBe(1);
    expect(result.questionsWithNoArea).toBe(1);
  });

  it("orders both tables worst first, and stably, so two runs can be diffed", () => {
    const result = measureOutstanding(
      [
        question({ recordId: "rec-a", recordLabel: "P-001", requirementId: "req-1" }),
        question({ recordId: "rec-b", recordLabel: "P-002", requirementId: "req-1" }),
        question({ recordId: "rec-b", recordLabel: "P-002", requirementId: "req-2" }),
      ],
      MATRIX,
    );
    expect(result.byRecord.map((row) => row.recordLabel)).toEqual(["P-002", "P-001"]);
    expect(result.byQuestion[0]).toMatchObject({ requirementId: "req-1", toQuote: 2, records: 2 });
    expect(result.byQuestion[1]).toMatchObject({ requirementId: "req-2", toQuote: 1, records: 1 });
  });
});
