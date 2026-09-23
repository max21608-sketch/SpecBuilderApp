// How a message reads in the inbox, and which queue it is in.
//
// ============================================================================
// ONE READING, TWO SCREENS (plan any-bill, step 7). The inbox's tabs and the
// project header's "Inbox n" are the same count — messages on this project
// still to review — and they must not disagree. The rule was the inbox page's
// own function; it moved here so the project page calls it over the same
// payload the inbox loads (`/api/email-messages?projectId=`) instead of a
// second count re-expressed in SQL, which is how two screens came to disagree
// about TGQ.
//
// A leaf: both callers are client components.
// ============================================================================

/** The fields of an inbox row that decide its outcome. */
export type InboxOutcomeFields = {
  routing_status: string;
  run_status: string | null;
  /** `pending` because the project is already reading as many as it may. */
  waiting_for_slot: boolean | null;
  /** Null until the run has been read: "not read yet" is not "found nothing". */
  found: { nothingToRecord: boolean } | null;
  triage: string;
};

export type InboxOutcome = "held" | "waiting" | "reading" | "failed" | "nothing" | "review";

/**
 * How a message reads on this screen.
 *
 * `reading` and `failed` are deliberately NOT folded into `review`: an email
 * the queue has not got to is not an email waiting for a person, and saying so
 * is the difference between a queue somebody watches and a queue somebody
 * believes is stuck.
 */
export function outcome(message: InboxOutcomeFields): InboxOutcome {
  if (message.routing_status !== "assigned") return "held";
  if (message.run_status === "failed") return "failed";
  // WAITING FOR A SLOT IS NOT READING. The cap defers a read rather than
  // refusing it, so this row needs nobody and will start on its own — and a
  // message the app auto-assigned on a busy morning is the normal way to reach
  // this state, which is why it earns a word of its own rather than an error.
  if (message.run_status === "pending" && message.waiting_for_slot) return "waiting";
  if (!message.found) return "reading";
  if (message.found.nothingToRecord) return "nothing";
  return "review";
}

/** The inbox's queues, over whatever messages were loaded. */
export function inboxBuckets<T extends InboxOutcomeFields>(all: T[]) {
  const open = all.filter((message) => message.triage === "open");
  return {
    all,
    held: open.filter((message) => outcome(message) === "held"),
    nothing: open.filter((message) => outcome(message) === "nothing"),
    // A FAILED READ IS ITS OWN QUEUE, and it came out of "to review" when
    // assignment stopped being something a person always did. Since 2.11 the
    // app places mail on a project by itself and starts the charged read, so
    // a read that failed is work nobody asked for, that nobody is waiting
    // on, and that only a person pressing Retry will move. Left inside the
    // review bucket it was one row among a morning's post, and the only
    // thing saying it had happened was that row.
    failed: open.filter((message) => outcome(message) === "failed"),
    review: open.filter((message) => ["review", "waiting", "reading"].includes(outcome(message))),
  };
}
