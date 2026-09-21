import type { Tone } from "@/components/ui/tone";

// What an intake run's status is called on screen.
//
// ONE PLACE, because there were two and they had already drifted: `parsing`
// read "Being read" on the project overview and "Reading" on the pack screen,
// for the same row, one click apart. A status is part of the app's vocabulary
// and a reader should not have to work out that two words mean one state.
//
// `parsed` is "Ready to review" and `confirmed` is "Review complete" -- never
// just "Complete". Review being finished says every proposal was applied or
// ignored; whether the ANSWERS are settled is a different question, asked on
// the record screen.
export const INTAKE_STATUS_LABELS: Record<string, string> = {
  pending: "Not read yet",
  queued: "Queued",
  parsing: "Reading",
  parsed: "Ready to review",
  confirmed: "Review complete",
  failed: "Failed",
};

/**
 * What each status WANTS from the reader, in the house colour language.
 *
 * Beside the labels rather than at the two screens that render them, for the
 * reason the labels are here: the pack screen and the project overview each had
 * their own ternary and the two disagreed — one painted `parsed` blue, the
 * other amber — so the same row changed colour one click apart.
 *
 * `parsed` is AMBER because it is the one state that needs a person; `failed`
 * is RED because the fix costs another charged model call; `queued`/`parsing`
 * are BLUE because the app is doing something and nobody is wanted; `pending`
 * is PLAIN, which is the honest reading of a document nobody has read and
 * nothing is waiting on.
 */
export const INTAKE_STATUS_TONE: Record<string, Tone> = {
  pending: "plain",
  queued: "info",
  parsing: "info",
  parsed: "warn",
  confirmed: "good",
  failed: "danger",
};

/** The tone, or `plain` for a status this does not know — never a colour. */
export function intakeStatusTone(status: string): Tone {
  return INTAKE_STATUS_TONE[status] ?? "plain";
}

/** The label, or the raw status if the database grows one this does not know. */
export function intakeStatusLabel(status: string): string {
  return INTAKE_STATUS_LABELS[status] ?? status;
}

/**
 * In flight: something is going to change without anybody clicking, so the
 * screen showing it must poll and must not offer a Read button.
 */
export function isIntakeRunWorking(status: string): boolean {
  return status === "queued" || status === "parsing";
}

/**
 * A document's REVIEW state, which is two states and a count — never a tick.
 *
 * ============================================================================
 * "SO IT'S TICKED BECAUSE YOU'VE OPENED IT." — Matthew, 2026-09-18 (FIU 4).
 *
 * He was reading the screen right and the screen was saying too little. Being
 * OPENED is recorded NOWHERE: the GET route writes nothing, and neither does
 * any review screen until somebody applies or ignores something. So there are
 * exactly TWO derivable states and the app must not pretend to a third —
 * inventing "in review" would mean storing a fact nobody has.
 *
 * What was missing is the COUNT. "Ready to review" over 12 outstanding
 * proposals and over 1 read identically, and a run somebody opened, ruled on
 * half of and walked away from reads the same as one nobody has touched. So a
 * document with anything pending SAYS HOW MANY, which is what the approved
 * mock-up's own chip says ("12 to review").
 *
 * AND THE COUNT WINS OVER THE STATUS. A run at `confirmed` cannot have pending
 * proposals — that is what confirmed MEANS — so if one ever does, the honest
 * answer is the count and not the tick. Structural, rather than a comment
 * asking a future caller to remember: the DoD for this item is that a
 * completion tick never appears beside a document with proposals outstanding.
 * ============================================================================
 */
export type ReviewProgress = {
  status: string;
  /** Null or absent where the payload does not carry one, which is not zero. */
  pendingReview?: number | null;
  /**
   * `pending` because the pack is already reading as many as it may, rather
   * than because nobody has asked for it. Two different sentences: the first
   * needs nobody, the second is a button somebody has to press.
   */
  waitingForSlot?: boolean | null;
};

/**
 * Is anything still waiting to be ruled on? Absent is NOT the same as none.
 *
 * A document being READ, or one whose read FAILED, answers no whatever its
 * staged JSON says: a re-read replaces that JSON, so a count left over from a
 * previous attempt describes proposals that are about to stop existing — and
 * "12 to review" beside a spinner is work nobody can start.
 */
export function hasPendingReview(run: ReviewProgress): boolean {
  if (isIntakeRunWorking(run.status) || run.status === "failed") return false;
  return typeof run.pendingReview === "number" && run.pendingReview > 0;
}

/**
 * A document the cap deferred. `pending` covers two states now and they read
 * differently: "Not read yet" is a document waiting for a person, and this one
 * is waiting for a slot and will start on its own.
 */
export const WAITING_FOR_SLOT_LABEL = "Waiting for a slot";

/** The label for a document's state, with its count where there is one. */
export function documentReviewLabel(run: ReviewProgress): string {
  if (hasPendingReview(run)) return `${run.pendingReview} to review`;
  if (run.status === "pending" && run.waitingForSlot) return WAITING_FOR_SLOT_LABEL;
  return intakeStatusLabel(run.status);
}

/** Its tone: anything outstanding needs a person, whatever the status says. */
export function documentReviewTone(run: ReviewProgress): Tone {
  if (hasPendingReview(run)) return "warn";
  // Blue, like `queued`: the app is going to do this one and nobody is wanted.
  if (run.status === "pending" && run.waitingForSlot) return "info";
  return intakeStatusTone(run.status);
}

/**
 * Finished: reviewed, with nothing left pending.
 *
 * Both halves, because either alone is a lie the screen would tell — the
 * status alone is the tick Matthew read, and an empty pending list alone is
 * true of a document nobody has read.
 */
export function isReviewComplete(run: ReviewProgress): boolean {
  return run.status === "confirmed" && !hasPendingReview(run);
}

/** What a set of intake runs adds up to. Four states, and they total the set. */
export type PackTally = {
  total: number;
  reviewed: number;
  toReview: number;
  reading: number;
  failed: number;
  /** `pending`: registered, never read. Rare, and it is not progress. */
  notRead: number;
  /** `pending` because the pack is at its in-flight cap. It starts on its own. */
  waitingForSlot: number;
};

/**
 * A pack's runs, counted once.
 *
 * ONE reading behind the tiles, the summary line and the drawings step — the
 * `composeDimensionCell` rule in a small place. The pack screen had this inline
 * and the drawings step already calls it with a subset, so a second copy is how
 * the line comes to say something the tiles beside it contradict.
 *
 * REVIEWED is `isReviewComplete`, never the status alone: `confirmed` means no
 * pending proposals remain, applied or explicitly ignored, so one that still
 * carries some is a contradiction and the honest reading is the count. It is
 * still never "complete" -- whether the ANSWERS it produced are settled is a
 * different question, asked on the record screen.
 *
 * The order of the branches is the model. A document the app is READING wants
 * nobody, whatever a previous staging left behind, so that is asked before the
 * pending count.
 *
 * A status this does not know counts toward `total` and toward none of the
 * five, which is deliberate: an unknown state is not evidence of progress, and
 * a SUMMARY LINE has to be able to say so — four labelled tiles never implied
 * they added up, and one sentence does.
 */
export function packTally(runs: ReviewProgress[]): PackTally {
  return runs.reduce<PackTally>(
    (acc, run) => {
      acc.total += 1;
      if (isReviewComplete(run)) acc.reviewed += 1;
      else if (isIntakeRunWorking(run.status)) acc.reading += 1;
      else if (run.status === "failed") acc.failed += 1;
      else if (hasPendingReview(run) || run.status === "parsed") acc.toReview += 1;
      // A document waiting for a slot is NOT "not read yet": the app is going
      // to read it and nobody is wanted. Counted apart rather than folded into
      // either neighbour, because "3 still being read · 8 not read yet" over a
      // pack that is working through itself sends somebody looking for a Read
      // button they must not press.
      else if (run.status === "pending" && run.waitingForSlot) acc.waitingForSlot += 1;
      else if (run.status === "pending") acc.notRead += 1;
      return acc;
    },
    { total: 0, reviewed: 0, toReview: 0, reading: 0, failed: 0, notRead: 0, waitingForSlot: 0 },
  );
}
