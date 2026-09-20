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

/** What a set of intake runs adds up to. Four states, and they total the set. */
export type PackTally = {
  total: number;
  reviewed: number;
  toReview: number;
  reading: number;
  failed: number;
  /** `pending`: registered, never read. Rare, and it is not progress. */
  notRead: number;
};

/**
 * A pack's runs, counted once.
 *
 * ONE reading behind the tiles, the summary line and the drawings step — the
 * `composeDimensionCell` rule in a small place. The pack screen had this inline
 * and the drawings step already calls it with a subset, so a second copy is how
 * the line comes to say something the tiles beside it contradict.
 *
 * `confirmed` counts as REVIEWED, never "complete": it means no pending
 * proposals remain, applied or explicitly ignored. Whether the answers it
 * produced are settled is a different question, asked on the record screen.
 *
 * A status this does not know counts toward `total` and toward none of the
 * five, which is deliberate: an unknown state is not evidence of progress, and
 * a SUMMARY LINE has to be able to say so — four labelled tiles never implied
 * they added up, and one sentence does.
 */
export function packTally(runs: { status: string }[]): PackTally {
  return runs.reduce<PackTally>(
    (acc, run) => {
      acc.total += 1;
      if (run.status === "confirmed") acc.reviewed += 1;
      else if (run.status === "parsed") acc.toReview += 1;
      else if (run.status === "failed") acc.failed += 1;
      else if (run.status === "pending") acc.notRead += 1;
      else if (isIntakeRunWorking(run.status)) acc.reading += 1;
      return acc;
    },
    { total: 0, reviewed: 0, toReview: 0, reading: 0, failed: 0, notRead: 0 },
  );
}
