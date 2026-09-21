// ONE FOLD, EVERYWHERE A CODE IS MATCHED — variance matrix §6.10.a row 4.
//
// ============================================================================
// WHAT THIS FILE IS FOR
//
// A client writes the same item code three ways in one pack: `S 201` on the
// bill, `s-201` in an email, `S.201` on a drawing's title block. Every matcher
// in the app has to reach the same answer, and the `groupItemsByCode` lesson is
// that they drift apart silently: `configurationGroup` compared `itemCodeRaw`
// RAW while `variantLettersByItem` folded it, so one code was lettered A and B
// and then printed under two headings.
//
// So this is deliberately ONE test file feeding ONE set of spellings through
// EVERY matcher entry point, rather than a case hidden in each matcher's own
// suite. A new matcher that folds differently fails here, in a file whose name
// says what it is about.
//
// IT FOUND ONE. `boq-reconcile.ts` used `boq-import`'s fold, which keeps dots
// and dashes: `S 201` became `S201` while `S.201` stayed `S.201`, so a revised
// bill writing a code with a dot where the record held a dash read as a NEW
// line beside a record NO LONGER LISTED — and confirming that retires the
// record, taking its drawings, its specs and its picture off the phase.
//
// AND ONE FOLD IS DELIBERATELY DIFFERENT. `boq-import`'s `normaliseRef` writes
// the stored `ref_value_norm` column, which has a unique constraint behind it
// and rows already in it. It is asserted here as a SEPARATE job so that nobody
// reading this file "fixes" it into the matching one.
// ============================================================================
import { describe, expect, it } from "vitest";
import { findRecordsByRef, normaliseRef, type RecordEntry } from "@/lib/record-refs";
import { normaliseRef as normaliseForStorage } from "@/lib/boq-import";
import { groupItemsByCode, variantLettersByItem, type DrawingItem } from "@/lib/drawing-document";
import { reconcileSheet, type ExistingRecord, type RevisedLine } from "@/lib/boq-reconcile";

/** One code, as three documents of one pack spell it. */
const SPELLINGS = ["S 201", "s-201", "S.201"] as const;

/** What the bill itself said, and what every matcher has to fold onto it. */
const CANONICAL = "S-201";

function record(over: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: "r-1",
    recordNo: 9,
    label: "ZZ001-009",
    itemDescription: "Armchair",
    categoryId: null,
    categoryName: null,
    refs: [CANONICAL],
    boqCodes: [CANONICAL],
    runId: "run-main",
    runName: "MAIN",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...over,
  };
}

function item(id: string, code: string | null, page: number | null): DrawingItem {
  return {
    id,
    version: 1,
    page,
    itemCodeRaw: code,
    itemNameRaw: null,
    confidence: null,
    targets: null,
    observations: [],
  };
}

function existing(over: Partial<ExistingRecord> = {}): ExistingRecord {
  return {
    id: "rec-1",
    version: 1,
    recordNo: 9,
    label: "ZZ001-009",
    itemDescription: "Armchair",
    productReference: null,
    qty: 45,
    designer: null,
    area: "Example lounge",
    boqCategory: null,
    codes: [CANONICAL],
    attributeCount: 14,
    hasImage: true,
    settledAnswers: 3,
    ...over,
  };
}

function revised(code: string): RevisedLine {
  return {
    index: 0,
    lineNo: 5,
    code,
    itemDescription: "Armchair",
    productReference: null,
    qty: 45,
    designer: null,
    area: "Example lounge",
    boqCategory: null,
    ignored: false,
    replaces: null,
  };
}

describe("the fold itself", () => {
  it("folds all three spellings onto one key", () => {
    expect(SPELLINGS.map(normaliseRef)).toEqual(["S201", "S201", "S201"]);
    expect(normaliseRef(CANONICAL)).toBe("S201");
  });

  it("keeps genuinely different codes apart", () => {
    expect(normaliseRef("S-201")).not.toBe(normaliseRef("S-202"));
    expect(normaliseRef("S-2011")).not.toBe(normaliseRef("S-201"));
  });
});

describe("every matcher reaches the same record", () => {
  it("findRecordsByRef — the spec document and email pipelines", () => {
    for (const spelling of SPELLINGS) {
      expect(findRecordsByRef(spelling, [record()]).map((entry) => entry.id)).toEqual(["r-1"]);
    }
  });

  it("groupItemsByCode — one card per code on the drawings review", () => {
    // Three pages, three spellings, ONE card. Grouping raw is what printed the
    // same item under two headings.
    const grouped = groupItemsByCode(SPELLINGS.map((spelling, index) => item(`i${index}`, spelling, index + 1)));
    expect(grouped.size).toBe(1);
    expect([...grouped.values()][0]).toHaveLength(3);
  });

  it("variantLettersByItem — which pages are configurations of one item", () => {
    // A version 1 run letters a code drawn more than once; the point here is
    // that all three spellings are ONE code, so the letters run A, B, C rather
    // than three separate items each getting no letter at all.
    const letters = variantLettersByItem(SPELLINGS.map((spelling, index) => item(`i${index}`, spelling, index + 1)));
    expect([letters.get("i0"), letters.get("i1"), letters.get("i2")]).toEqual(["A", "B", "C"]);
  });

  it("reconcileSheet — pairing a revised bill with the phase it revises", () => {
    for (const spelling of SPELLINGS) {
      const result = reconcileSheet([revised(spelling)], [existing()]);
      expect(result.lines[0]?.status).toBe("paired");
      expect(result.lines[0]?.suggestedRecordId).toBe("rec-1");
      // AND NOTHING IS RETIRED. This is the consequence that made the drift
      // worth finding: a record read as no longer listed is retired at confirm,
      // and it carries 14 specs and a picture.
      expect(result.missing).toEqual([]);
      expect(result.counts.new).toBe(0);
    }
  });
});

describe("the STORAGE fold is a different job, and stays different", () => {
  it("keeps dots and dashes, because a stored column and its unique key hold it", () => {
    // `spec_record_refs.ref_value_norm`, written by confirm-boq and
    // manual-capture, with `unique (record_id, ref_system, ref_value_norm)`
    // behind it and rows already in it. Folding it further is a migration, not
    // an edit — and it is not what any matcher reads.
    expect(normaliseForStorage("S.201")).toBe("S.201");
    expect(normaliseForStorage("s-201")).toBe("S-201");
    expect(normaliseForStorage("S 201")).toBe("S201");
  });

  it("is looser than the matching fold, never tighter", () => {
    // Whatever the storage fold makes equal, the matching fold must too — or a
    // matcher would be blind to a distinction the database has already merged.
    const pairs: [string, string][] = [
      ["FU06C - CG27.2", "fu06c-cg27.2"],
      ["S 201", "s201"],
    ];
    for (const [a, b] of pairs) {
      if (normaliseForStorage(a) === normaliseForStorage(b)) expect(normaliseRef(a)).toBe(normaliseRef(b));
    }
  });
});
