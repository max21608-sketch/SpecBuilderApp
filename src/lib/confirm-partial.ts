// What to say when a card confirmed SOME of its configurations.
//
// ============================================================================
// A PARTIAL IS NOT A FAILURE, AND IT WAS PAINTED AS ONE.
//
// The configuration card issues ONE CONFIRM PER CONFIGURATION, because the
// confirm route names one staged item and its whole pending set and the record
// is the unit of commit. Confirming A can change what B resolves to — A's
// variant record is created by that confirm — so B's next request legitimately
// comes back 409 and the reviewer presses again. That is the design working:
// "a refusal on B leaves A applied", and the reloaded card shows exactly that.
//
// What was wrong is only the WORDS. Both drawings screens put the whole
// sentence into the red banner, so a press that wrote A's specs and asked for
// one more click read as an error — every run, on the verifier's first-session
// walk, and to a person in front of the screen (found-in-use 2026-09-20,
// observation 2).
//
// So: nothing confirmed is still a FAILURE and still red. Something confirmed
// is a NOTICE that names what was written, what was refused, what was never
// attempted, and the one thing left to do. The confirm route is untouched.
// ============================================================================

/** The two channels both drawings screens already have: a red banner and an
 *  informational one. Exactly one is ever set. */
export type PartialConfirm = { failure: string | null; notice: string | null };

export function describePartialConfirm(input: {
  /** Configurations already confirmed by this press, in letter order. */
  done: string[];
  /** The one that was refused, and the server's own sentence for why. */
  refused: { label: string; reason: string };
  /** The ones after it, which were never sent. */
  notAttempted: string[];
}): PartialConfirm {
  const { done, refused, notAttempted } = input;

  const refusal = `${refused.label} refused: ${refused.reason} Nothing was written for it.`;
  const untouched =
    notAttempted.length > 0
      ? `${notAttempted.join(" and ")} ${notAttempted.length === 1 ? "was" : "were"} not attempted.`
      : null;

  if (done.length === 0) {
    // Nothing was written at all. That is the red banner's own case.
    return { failure: [refusal, untouched].filter(Boolean).join(" "), notice: null };
  }

  // The reload has already happened by the time this is shown, so the versions
  // on screen are the live ones and pressing again is the whole remedy. Saying
  // so is the difference between a screen that looks broken and one that is
  // waiting for a click.
  const remaining = [refused.label, ...notAttempted];
  const again =
    `The card has been reloaded, so ${remaining.join(" and ")} can be confirmed again from here.`;

  return {
    failure: null,
    notice: [`${done.join(" and ")} confirmed.`, refusal, untouched, again].filter(Boolean).join(" "),
  };
}
