// Why the app could not work out what a document is — when the reason is the
// app's, not the document's.
//
// ============================================================================
// FOUND ON PILOT, 2026-09-23. A thirty-file upload onto P18181 left two intake
// batches holding nothing. The classify route answered `200 ok:true` whenever
// the model call itself FAILED, with the reason in a field the upload screen
// never read — so every row said "Say which", the footer said nothing had been
// charged, and the reason (almost certainly no API key on that deployment) was
// on no screen at all. A failure that reads as "the app looked and could not
// tell" sends a person hunting the wrong cause, thirty times.
//
// SO THERE ARE TWO ANSWERS AND THEY ARE NEVER THE SAME SHAPE:
//
//   The model LOOKED and said unclear. `ok: true`, a real answer, a person
//   decides. Nothing about the deployment is wrong.
//
//   The model was never asked, or the asking failed. `ok: false` with one of
//   the codes below, the sentence, and whether it was charged. The row prints
//   it red, and when several files fail for the same reason the screen says it
//   once above them.
//
// A LEAF, ON PURPOSE. The route and the upload screen both read these words,
// and the screen runs in the browser; importing `document-classify.ts` there
// would pull the Anthropic SDK into the bundle.
// ============================================================================

export const CLASSIFY_FAILURE_CODES = [
  "not_configured",
  "too_large",
  "rate_limited",
  "overloaded",
  "timeout",
  "auth",
  "failed",
] as const;
export type ClassifyFailureCode = (typeof CLASSIFY_FAILURE_CODES)[number];

export const isClassifyFailureCode = (value: unknown): value is ClassifyFailureCode =>
  typeof value === "string" && (CLASSIFY_FAILURE_CODES as readonly string[]).includes(value);

/**
 * What the banner above the rows says when two or more files failed for the
 * SAME reason. Each row still carries its own line; this is the one place the
 * reason is said once, so thirty red rows do not read as thirty problems.
 */
export const CLASSIFY_FAILURE_BANNER: Record<ClassifyFailureCode, string> = {
  not_configured:
    "Document reading is not configured on this deployment — nothing was read, and the files are stored. " +
    "Choose each kind by hand, or ask for the key to be set.",
  too_large:
    "These documents are too large to be identified in one request — nothing was read, and the files are stored. " +
    "Choose each kind by hand.",
  rate_limited:
    "The model is rate limited right now — these files were not identified, and they are stored. " +
    "Try identifying them again in a minute, or choose each kind by hand.",
  overloaded:
    "The model is overloaded right now — these files were not identified, and they are stored. " +
    "Try identifying them again in a minute, or choose each kind by hand.",
  timeout:
    "Identifying these files took too long and was stopped — they are stored. " +
    "Try identifying them again, or choose each kind by hand.",
  auth:
    "The model refused this deployment's credentials — nothing was read, and the files are stored. " +
    "Choose each kind by hand, or ask for the key to be checked.",
  failed:
    "The app could not identify these files — they are stored. Try identifying them again, or choose each kind by hand.",
};

export type ClassifyFailure = {
  code: ClassifyFailureCode;
  /** The row's own sentence. */
  message: string;
  /**
   * Whether the request reached the model. NOT whether it was billed to the
   * penny: a timeout may or may not have been, and the footer that says
   * "nothing has been charged" must only ever say it about files that were
   * never sent. So an unknown counts as sent.
   */
  sent: boolean;
};

/**
 * A failed classify response, as the upload screen reads it.
 *
 * The route's own `code` and `charged` where it sent them. Otherwise the
 * status decides: a 504 or 408 is a timeout, which is the Vercel ceiling
 * firing with an HTML page rather than the route answering — and the route
 * RAN, so the model may have been asked. A status of 0 is the browser failing
 * to reach the server at all, which sent nothing anywhere.
 */
export function classifyFailureFromResponse(
  status: number,
  body: Record<string, unknown> | null,
  message: string,
): ClassifyFailure {
  const code: ClassifyFailureCode = isClassifyFailureCode(body?.code)
    ? body.code
    : status === 504 || status === 408
      ? "timeout"
      : "failed";
  const sent = typeof body?.charged === "boolean" ? body.charged : status >= 500;
  return { code, message, sent };
}
