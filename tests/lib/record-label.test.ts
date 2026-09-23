// The one label helper (0039): what a record is called, in both forms, and the
// order every export lists records in.
import { describe, expect, it } from "vitest";
import {
  compareRecordOrder,
  numberingFromRow,
  recordLabel,
  recordNoLabel,
  recordShortLabel,
  type RecordNumbering,
} from "@/lib/record-label";
import { contextSnapshot, coverageStaleReasons, type CoverageSnapshot, type OutstandingQuestion } from "@/lib/chase-drafts";

describe("recordShortLabel", () => {
  it("prints a bill line by its own number", () => {
    expect(recordShortLabel({ recordNo: 12 })).toBe("12");
    expect(recordShortLabel(12)).toBe("12");
  });

  it("prints a configuration as its line's number and its own under it", () => {
    // S-301 on line 12, TYPE 3 — whose own record_no is the next free one.
    expect(recordShortLabel({ recordNo: 37, parentRecordNo: 12, variantOrdinal: 3 })).toBe("12.3");
  });

  it("does not print 12.undefined for a payload that predates 0039", () => {
    expect(recordShortLabel({ recordNo: 37, parentRecordNo: 12, variantOrdinal: null })).toBe("37");
    expect(recordShortLabel({ recordNo: 37, parentRecordNo: null, variantOrdinal: 3 })).toBe("37");
  });
});

describe("recordLabel", () => {
  it("pads the line to three digits and appends the ordinal unpadded", () => {
    expect(recordLabel("P18181", { recordNo: 12 })).toBe("P18181-012");
    expect(recordLabel("P18181", { recordNo: 37, parentRecordNo: 12, variantOrdinal: 3 })).toBe("P18181-012.3");
    expect(recordLabel("P18181", { recordNo: 140, parentRecordNo: 9, variantOrdinal: 11 })).toBe("P18181-009.11");
  });

  it("accepts a bare record_no, which is every caller before 0039", () => {
    expect(recordLabel("P17231", 7)).toBe("P17231-007");
    expect(recordLabel("P17231", 1234)).toBe("P17231-1234");
  });

  it("keeps the pre-0039 form available for the staleness comparison only", () => {
    expect(recordNoLabel("P18181", 37)).toBe("P18181-037");
  });
});

describe("numberingFromRow", () => {
  it("reads the three columns every labelling query selects", () => {
    expect(numberingFromRow({ record_no: "37", parent_record_no: 12, variant_ordinal: "3" })).toEqual({
      recordNo: 37,
      parentRecordNo: 12,
      variantOrdinal: 3,
    });
    expect(numberingFromRow({ record_no: 12, parent_record_no: null })).toEqual({
      recordNo: 12,
      parentRecordNo: null,
      variantOrdinal: null,
    });
  });
});

describe("compareRecordOrder", () => {
  it("lists a line, then its configurations by number, then the next line", () => {
    const rows: (RecordNumbering & { name: string })[] = [
      { name: "13", recordNo: 13 },
      { name: "12.2", recordNo: 36, parentRecordNo: 12, variantOrdinal: 2 },
      { name: "12.10", recordNo: 50, parentRecordNo: 12, variantOrdinal: 10 },
      { name: "12", recordNo: 12 },
      { name: "12.1", recordNo: 38, parentRecordNo: 12, variantOrdinal: 1 },
      { name: "1", recordNo: 1 },
    ];
    // record_no order would have put 12.1 (38) after 12.2 (36), and both
    // after line 13 — at the end of the file, beside the last new line.
    expect([...rows].sort(compareRecordOrder).map((row) => row.name)).toEqual(["1", "12", "12.1", "12.2", "12.10", "13"]);
  });
});

describe("the renumbering does not stale a sent draft", () => {
  function question(overrides: Partial<OutstandingQuestion> = {}): OutstandingQuestion {
    return {
      projectId: "p",
      recordId: "rec-conf",
      recordNo: 37,
      recordLabel: "P18181-012.3",
      recordShortLabel: "12.3",
      recordNoLabel: "P18181-037",
      recordStatus: "active",
      recordVersion: 2,
      itemDescription: "Desk chair",
      area: null,
      designer: null,
      refs: "",
      categoryId: "c",
      categoryName: "Chairs",
      level: "simple",
      tgqLevels: [],
      tier: "to_quote",
      requirementId: "req",
      requirementKind: "spec_field",
      prompt: "COM 1?",
      section: null,
      sortOrder: 1,
      fieldLabel: "COM 1",
      jsonId: 1,
      localKey: null,
      answerId: "ans",
      answerVersion: 1,
      state: "missing",
      currentValue: null,
      qty: null,
      runId: "run",
      runName: "MAIN",
      parentId: "rec-line",
      variantLabel: "TYPE 3",
      parentRefs: "S-301",
      parentQty: 45,
      groupNo: 12,
      groupLabel: "P18181-012",
      variantCount: 0,
      variantOrdinal: 3,
      ...overrides,
    };
  }

  function coverage(context: ReturnType<typeof contextSnapshot>): CoverageSnapshot {
    return {
      recordId: "rec-conf",
      requirementId: "req",
      revisionNo: 0,
      answerId: "ans",
      snapshotAnswerVersion: 1,
      recordVersion: 2,
      context,
    };
  }

  it("reads a draft frozen with the pre-0039 label as fresh", () => {
    const live = question();
    const frozen = { ...contextSnapshot(live), recordLabel: "P18181-037" };
    expect(coverageStaleReasons(coverage(frozen), live)).toEqual([]);
  });

  it("still reads any OTHER label as a change", () => {
    const live = question();
    const frozen = { ...contextSnapshot(live), recordLabel: "P18181-036" };
    expect(coverageStaleReasons(coverage(frozen), live)).toContain("contextChanged");
  });

  it("still reads a real change beside the renumbering as a change", () => {
    const live = question();
    const frozen = { ...contextSnapshot(live), recordLabel: "P18181-037", prompt: "COM 2?" };
    expect(coverageStaleReasons(coverage(frozen), live)).toContain("contextChanged");
  });
});

describe("a version taken before 0039", () => {
  it("keeps the label it was taken with, and reads with no numbering under a line", async () => {
    const { parseAtoms } = await import("@/lib/snapshot-diff");
    const { RECORD_ATOMS_SCHEMA_VERSION } = await import("@/lib/record-atoms");
    const older = {
      schemaVersion: RECORD_ATOMS_SCHEMA_VERSION - 1,
      project: { number: "P18181", name: "Miami", client: null },
      record: {
        id: "r",
        recordNo: 37,
        label: "P18181-037",
        itemDescription: "Desk chair",
        qty: null,
        area: null,
        runName: "MAIN",
        boqCodes: ["S-301"],
        variantLabel: "TYPE 3",
        dimensionNote: null,
      },
      runId: "run",
      runName: "MAIN",
      status: "active",
      categoryId: null,
      categoryName: null,
      level: null,
      productReference: null,
      designer: null,
      boqCategory: null,
      parentId: "line",
      splitReason: "configuration",
      refs: [],
      attributes: [],
      answers: [],
      itemImage: null,
    };
    const parsed = parseAtoms(older);
    // History is history: the label is not recomputed as 12.3.
    expect(parsed.record.label).toBe("P18181-037");
    expect(parsed.record.parentRecordNo).toBeNull();
    expect(parsed.record.variantOrdinal).toBeNull();
  });
});
