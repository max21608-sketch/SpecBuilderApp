// HOW AN EMAIL CAME TO BE ON ITS PROJECT, in words, for the review's header
// (prod-ready E2, 2026-11-20).
//
// The header printed `auto · <routing reason>` over every email, so an `.eml`
// a PERSON uploaded on the project's Documents tab read "auto · Nothing in
// this message names a project…" — the router's sentence about a decision it
// never took — while the Inbox said "assigned by hand" for the same message.
// The row says which of three things happened: uploaded here by somebody,
// assigned by the router on a signal, or assigned by somebody from the Inbox.
// A leaf: the screen imports it.

export type EmailArrivalFields = {
  origin?: string | null;
  assignment_kind?: string | null;
  assigned_by?: string | null;
  created_by?: string | null;
  routing_reason?: string | null;
};

/** The words for the header chip, and the router's whole sentence for its hover, or null with nothing to say. */
export function emailArrival(message: EmailArrivalFields): { words: string; title: string | null } | null {
  const reason = message.routing_reason?.trim() || null;
  // The FIRST clause, as the Inbox prints it; the whole sentence on hover.
  const clause = reason ? reason.split(" — ")[0] : null;
  if (message.origin === "upload") {
    const who = message.assigned_by ?? message.created_by ?? null;
    return { words: who ? `uploaded to this project by ${who}` : "uploaded to this project", title: null };
  }
  if (message.assignment_kind === "auto") {
    return { words: clause ? `assigned automatically · ${clause}` : "assigned automatically", title: reason };
  }
  if (message.assignment_kind === "manual") {
    return { words: message.assigned_by ? `assigned by hand by ${message.assigned_by}` : "assigned by hand", title: reason };
  }
  return null;
}

/** An uploaded message was reached from its project, not from the Inbox: the back link goes there. */
export function cameFromUpload(message: EmailArrivalFields | null | undefined): boolean {
  return message?.origin === "upload";
}
