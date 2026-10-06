// What a bill's sheet says about itself that a reviewer must read BEFORE the
// confirm: which items will also go on the mock-up phase, and that a sheet
// with no codes will be hard to revise. A leaf, and pure, so the review GET,
// the review screen and the confirm read one answer (the `proposalBlockers`
// rule).
//
// ============================================================================
// "PROTOTYPE QUANTITY" PUTS AN ITEM ON THE MOCK-UP PHASE (Max, 2026-10-06).
//
// A specifier's bill carries two quantity columns: `Rollout Quantity`, the
// order, read as `qty`; and `Prototype Quantity`, how many go in the mock-up
// — `1`, `PARTIAL`, `N/A`, or blank. Max: "make it a mock-up phase". So an ITEM
// line whose mock-up cell says it is in the mock-up is ALSO put on the
// project's mock-up phase at confirm, through `addToMockupPhase` — the one
// implementation — with the bill's figure as that record's quantity.
//
//   * A NUMBER IS THE BILL SAYING HOW MANY. `1` is a quantity of 1 on the
//     mock-up record. Only a plain positive WHOLE number is read as one: `1 nr`,
//     `2 (TBC)`, `1.5` and `PARTIAL` are words, and the record gets NO quantity and an
//     internal note quoting the cell. Never 1 by default, never apportioned.
//   * "NOT IN THE MOCK-UP" IS A SHORT CLOSED LIST: `N/A`, `NA`, `-` (any dash),
//     `0`, `none`, and blank. Anything else a person typed in that column is
//     read as "in the mock-up, in these words", because a word nobody planned
//     for is more likely to be `PARTIAL` than a refusal, and a mock-up item a
//     person can retire is a smaller mistake than one silently not made.
//   * A FINISH LINE IS NEVER PUT ON THE MOCK-UP PHASE. It is not a record; it
//     is written onto its item, and its item carries it.
//
// ============================================================================
// A SHEET WITH NO CODES (Max, 2026-10-06: "load now, flag it").
//
// Both Butler Arms bills print no item codes ("CODES TO FOLLOW"). They load —
// a code was never required — but a record with no client ref is a record a
// revised bill cannot pair (`boq-reconcile.ts`: a codeless line pairs
// nothing), so the revision's reviewer pairs every line by hand. Said before
// the confirm, on the review; and after it, on the phase, once.
// ============================================================================

/** The cells that say "not in the mock-up", folded (case, whitespace). */
export const MOCKUP_NOT_APPLICABLE: readonly string[] = ["n/a", "na", "-", "0", "none"];

/** What one line's mock-up cell means. */
export type MockupQtyReading =
  | { on: false }
  /** In the mock-up, and the bill says how many. */
  | { on: true; qty: number; note: null }
  /** In the mock-up, in words: no quantity, and the cell quoted in a note. */
  | { on: true; qty: null; note: string };

/** The internal note a mock-up record carries where the bill's figure is words. */
export function mockupQtyNote(raw: string): string {
  return `Prototype quantity on the bill: ${raw}`;
}

/**
 * THE ONE READING of a bill's mock-up cell. Blank and the not-applicable
 * tokens are off; a plain positive number is that many; any other text is on,
 * with no quantity and the cell quoted.
 */
export function readMockupQty(raw: string | null | undefined): MockupQtyReading {
  const cell = (raw ?? "").replace(/\s+/g, " ").trim();
  if (cell === "") return { on: false };
  // Every dash is a dash: a bill typed in Word writes "–" for "-".
  const folded = cell.toLowerCase().replace(/[‐-―−]/g, "-");
  if (MOCKUP_NOT_APPLICABLE.includes(folded)) return { on: false };
  // A WHOLE number only: `spec_records.qty` is an integer, and "1.5" in a
  // prototype column is a statement to quote, not a count to round.
  if (/^\d{1,6}$/.test(cell)) {
    const qty = Number(cell);
    if (qty === 0) return { on: false };
    return { on: true, qty, note: null };
  }
  return { on: true, qty: null, note: mockupQtyNote(cell) };
}

type NoticeLine = {
  code: string | null;
  ignored: boolean;
  rowKind?: string;
  mockupQtyRaw?: string | null;
};

type NoticeSheet = {
  ignored: boolean;
  lines: readonly NoticeLine[];
  columns?: { mockupQty?: { heading: string } } & Record<string, unknown>;
};

/** The lines a confirm makes a record of: live, and not a finish line. */
function itemLines<T extends NoticeLine>(sheet: { ignored: boolean; lines: readonly T[] }): T[] {
  if (sheet.ignored) return [];
  return sheet.lines.filter((line) => !line.ignored && line.rowKind !== "finish_for");
}

/** The ITEM lines of a live sheet whose mock-up cell puts them on the mock-up phase. */
export function mockupLines<T extends NoticeLine>(sheet: { ignored: boolean; lines: readonly T[] }): T[] {
  return itemLines(sheet).filter((line) => readMockupQty(line.mockupQtyRaw).on);
}

/** Said on the review before the confirm: how many, and from which column. */
export function mockupReviewSentence(count: number, heading: string | null | undefined): string {
  const column = heading?.trim() || "Prototype Quantity";
  return `${count} item${count === 1 ? "" : "s"} will also be added to the Mock-up phase (from the bill's ${column}).`;
}

/**
 * A LIVE SHEET WITH ITEM LINES, NONE OF THEM CODED. A sheet with no item line
 * at all says nothing — there is nothing to pair later.
 */
export function sheetHasNoCodes(sheet: { ignored: boolean; lines: readonly NoticeLine[] }): boolean {
  const items = itemLines(sheet);
  return items.length > 0 && items.every((line) => !line.code?.trim());
}

/** On the review, before the confirm. */
export const NO_CODES_REVIEW_SENTENCE =
  "No item line on this sheet carries a code. The items will be created without client refs, and when a revised " +
  "bill with codes arrives its lines cannot be paired automatically — each will have to be paired by hand on the " +
  "revision's review.";

/** On the phase, after the confirm, once. */
export const NO_CODES_PHASE_SENTENCE =
  "The bill gave this phase's items no codes, so they carry no client refs. When a revised bill with codes " +
  "arrives, its lines cannot be paired automatically — each will have to be paired by hand on the revision's review.";

/** What the review shows above one sheet's lines. */
export type BillSheetNotice = {
  noCodes: boolean;
  /** Null where no item line goes on the mock-up phase. */
  mockup: { count: number; sentence: string } | null;
};

/** Every sheet's notices, by sheet index — what the review GET sends. */
export function billSheetNotices(sheets: readonly NoticeSheet[]): Record<number, BillSheetNotice> {
  const out: Record<number, BillSheetNotice> = {};
  sheets.forEach((sheet, index) => {
    const count = mockupLines(sheet).length;
    out[index] = {
      noCodes: sheetHasNoCodes(sheet),
      mockup: count > 0 ? { count, sentence: mockupReviewSentence(count, sheet.columns?.mockupQty?.heading) } : null,
    };
  });
  return out;
}
