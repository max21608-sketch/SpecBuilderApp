// ============================================================================
// THE PROJECT'S NUMBERS AS A SCREEN READS THEM: shapes, empty readings, the
// state pill's label and tone, and the sentence under it. No database.
//
// Moved out of `project-summary.ts` and `project-completion.ts` on 2026-11-06
// (audit G5). The projects list and the project page imported these VALUES
// from those two files, which import `@/lib/db` and through it the Neon
// driver, plus the TGQ and gate loaders, into the browser bundle. Lazy
// initialisation was all that kept that from crashing. The two loaders
// re-export everything here, so this is still the one definition, and
// `db.ts` can refuse a client import outright.
// ============================================================================

export type ProjectSummary = {
  /** Records in the export's scope. */
  records: number;
  /** Of those, how many nobody has categorised. Each has NO questions at all. */
  uncategorised: number;
  /** Of those, how many have no level — so none of their questions is tiered. */
  noLevel: number;
  /** How many of THOSE carry a suggestion waiting to be accepted. */
  levelSuggested: number;
  /**
   * THE ITEMS' OWN TGQ, by `itemTgq` (Max, 2026-10-12 and 2026-10-13): the sum
   * of every item's TGQ as the phase table shows it. Two halves added here:
   *
   *   placeholder  outstanding to_quote questions of any kind, minus the
   *                project-wide section — `inItemTgq` re-expressed in the SQL
   *                below, on records whose category is NOT on his matrix;
   *   matrix       each record's TGQ GATE rows still to answer, computed in
   *                TypeScript by `loadMatrixItemTgq`, because a gate is never
   *                judged in SQL.
   *
   * The db test holds the total equal to the sum of the lines.
   */
  toQuote: number;
  /**
   * The same items' outstanding to_quote QUESTIONS (minus project-wide), for
   * both models — the unit that partitions with `missing`, `tbc`, `settled`
   * and `projectWideRows`. Not a screen's TGQ: on the matrix the gate counts
   * slots and record columns no question asks.
   */
  toQuoteQuestions: number;
  /**
   * PROJECT-LEVEL TGQ: distinct project-wide questions still blocking a quote
   * on any item in scope — "Access", once, not once per item. Keyed the way
   * `groupByQuestion` keys a question. What the screens print beside TGQ.
   */
  projectWide: number;
  /** The same project-wide TGQ counted per item, so the question counts still partition. */
  projectWideRows: number;
  /** Outstanding, not blocking a quote. Split, because they are different jobs. */
  missing: number;
  tbc: number;
  /** Confirmed or not-applicable. */
  settled: number;
  /**
   * THE SAME THREE THINGS IN LINE ITEMS, WHICH IS THE UNIT A PERSON THINKS IN.
   *
   * Asked for on 2026-09-21 on a 503-line project, where the tiles read TGQ
   * 8,769 and Also outstanding 10,841: "these numbers are so high, they're
   * just meaningless." The question counts stay, because a sub-line saying how
   * many questions are behind an item count is worth having; what changed is
   * which number is the big one.
   *
   * TWO THINGS ABOUT THEM A SCREEN MUST SAY OUT LOUD.
   *
   * They do NOT sum. Every answer is exactly one of to-quote /
   * also-outstanding / settled, so `toQuote + missing + tbc + settled` is the
   * whole of the work; an ITEM can be clear at TGQ and still carry other
   * questions, so it is counted by two tiles at once. `settledItems` is
   * therefore "nothing outstanding at all" and is much smaller than `settled`
   * suggests.
   *
   * They are over a DIFFERENT POPULATION from `records`. An uncategorised
   * record has no questions at all, so it appears in none of them:
   * `itemsWithQuestions` is that population, and `records - uncategorised` is
   * what it is short of. Printing an item count beside `records` without
   * naming which is how somebody subtracts one from the other.
   */
  itemsWithQuestions: number;
  toQuoteItems: number;
  alsoOutstandingItems: number;
  settledItems: number;
  /** Finish codes in the project's library. */
  finishes: number;
  /** Of those, how many nobody has filed under a kind. */
  finishesNoKind: number;
  /** Documents still being read, and documents whose read failed. */
  documentsReading: number;
  documentsFailed: number;
  /**
   * How many records in scope get their TGQ from MATTHEW'S MATRIX, and how many
   * fall back to the 0019 placeholder.
   *
   * The two models are both called TGQ and only one of them is a measurement.
   * Where his matrix covers the category, `toQuote` counts the fields he
   * actually named. Where it does not — the eight cabinetry sheets, until he
   * writes that half — it falls back to `tgq_levels`, which is still seeded
   * with all three levels on all 728 questions, so every outstanding question
   * on those records counts as blocking.
   *
   * The screen has to be able to say which. A project whose items are all in
   * his matrix has a real number; one with cabinetry in it has a real number
   * for part of itself and a placeholder for the rest, and printing the total
   * in red without saying so is the confidently-wrong figure this app exists to
   * avoid. Both of these go to zero effort when the cabinetry matrix arrives:
   * it is a seed, and nothing here changes.
   */
  tgqFromMatrix: number;
  tgqFromFallback: number;
  /**
   * OPEN DISAGREEMENTS BETWEEN DOCUMENTS (0046), on live items on live phases:
   * a later document said something different from a value the record holds,
   * and nobody has decided which stands. Counted by `src/lib/disagreements.ts`,
   * the loader the phase table and the record screen read, never here in SQL —
   * a second expression is how a red tile comes to say four over three rows.
   */
  disagreements: number;
  /** The first live phase holding one, so the overview's tile lands on it. Null at zero. */
  disagreementRunId: string | null;
};

export const EMPTY_SUMMARY: ProjectSummary = {
  records: 0,
  uncategorised: 0,
  noLevel: 0,
  levelSuggested: 0,
  toQuote: 0,
  toQuoteQuestions: 0,
  projectWide: 0,
  projectWideRows: 0,
  missing: 0,
  tbc: 0,
  settled: 0,
  itemsWithQuestions: 0,
  toQuoteItems: 0,
  alsoOutstandingItems: 0,
  settledItems: 0,
  finishes: 0,
  finishesNoKind: 0,
  documentsReading: 0,
  documentsFailed: 0,
  tgqFromMatrix: 0,
  tgqFromFallback: 0,
  disagreements: 0,
  disagreementRunId: null,
};

export type ProjectCompletion = {
  /** Records in the export's scope. */
  records: number;
  /** Of those, how many nobody has categorised. Each one blocks completion. */
  uncategorised: number;
  /** Questions still missing or TBC across those records. */
  outstanding: number;
  complete: boolean;
};

export const EMPTY_COMPLETION: ProjectCompletion = {
  records: 0,
  uncategorised: 0,
  outstanding: 0,
  complete: false,
};

/** Archived is a separate axis from finished, but one pill has to say both. */
export type ProjectState = "archived" | "completed" | "active";

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  archived: "ARCHIVED",
  completed: "COMPLETED",
  active: "ACTIVE",
};

/**
 * Which colour each state wears, decided ONCE beside the labels.
 *
 * Green is SETTLED in this app's colour language, everywhere — a confirmed
 * answer, a satisfied gate, a finished review — so it belongs to COMPLETED.
 * ACTIVE is merely where most projects live, and gets the working-state sky.
 * The list and the project page each held their own copy of this map and had
 * them the other way round from each other, under a comment claiming parity.
 * A `Tone` name rather than a class string, so the pill component owns the
 * shades and this file owns only the meaning.
 */
export const PROJECT_STATE_TONE: Record<ProjectState, "live" | "good" | "plain"> = {
  active: "live",
  completed: "good",
  archived: "plain",
};

export function projectState(status: string | null | undefined, completion: ProjectCompletion | null): ProjectState {
  // Archived wins: a project put away is put away whether or not its
  // specifications were ever finished, and saying COMPLETED over it would
  // claim something nobody checked.
  if (status === "archived") return "archived";
  return completion?.complete ? "completed" : "active";
}

/**
 * Why a project is not complete, in words a person can act on.
 *
 * Null when it IS complete. A pill with no explanation is a pill nobody
 * trusts, and "active" is the state that needs the explaining.
 */
export function completionSentence(completion: ProjectCompletion | null): string | null {
  if (!completion) return null;
  if (completion.complete) return null;
  if (completion.records === 0) return "No records yet — nothing has been imported.";
  const parts: string[] = [];
  if (completion.outstanding > 0) {
    parts.push(
      `${completion.outstanding} question${completion.outstanding === 1 ? "" : "s"} still missing or TBC`,
    );
  }
  if (completion.uncategorised > 0) {
    parts.push(
      `${completion.uncategorised} record${completion.uncategorised === 1 ? "" : "s"} with no category, so nobody has decided what to ask`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(", and ")}.`;
}
