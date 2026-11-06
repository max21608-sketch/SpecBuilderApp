// ============================================================================
// WHAT A FAILURE TELLS THE PERSON, AND WHAT IT TELLS THE LOG (audit A12).
//
// Three routes put a raw exception's text in their response: the sign-in
// route whenever APP_ENV was not production (and PILOT holds real data), the
// upload token route, and the bill upload. A driver's message can name a host,
// a table, a column, and a fragment of the value that broke a constraint;
// none of that is for a browser on any deployment but a developer's own.
//
// So a failure is answered in three ways at once:
//   - a message THIS APP WROTE FOR PEOPLE (a plain `Error`, or one of the
//     app's own refusal classes, carrying no SQLSTATE) is passed through,
//     because "That file is not a spreadsheet. Upload an .xlsx…" is the
//     answer and hiding it would leave a person stuck;
//   - anything else (a driver error, a TypeError out of a library, an SDK's
//     own error class) becomes the caller's sentence plus a short REFERENCE;
//   - the whole cause goes to the log under that reference, so the sentence a
//     person reads out is enough to find it.
// The cause's own text is appended to the sentence only when
// APP_ENV === "development", the one deployment where the reader is the
// person who can act on it.
// ============================================================================
import { randomBytes } from "node:crypto";

const OWN_ERROR_NAMES = new Set(["Error", "UntrustedBlobError", "DomainConflictError"]);

/** The cause's message when this app wrote it for a person to read; otherwise null. */
export function peopleMessage(cause: unknown): string | null {
  if (!(cause instanceof Error) || !OWN_ERROR_NAMES.has(cause.name)) return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return null;
  return cause.message.trim() || null;
}

export function showsErrorDetail(appEnv: string | undefined = process.env.APP_ENV): boolean {
  return appEnv === "development";
}

/** Logs the cause under a fresh reference and returns the reference. */
export function reportFailure(scope: string, cause: unknown): string {
  const reference = randomBytes(4).toString("hex");
  console.error(`[${scope}] failure ${reference}`, cause);
  return reference;
}

/**
 * The sentence to send for a failure: the app's own message where it wrote
 * one, otherwise `sentence` with the reference the log holds the cause under.
 * `ownMessages: false` where every cause is somebody else's (a database call),
 * so even a plain `Error` is not passed through.
 */
export function explainFailure(
  sentence: string,
  cause: unknown,
  scope: string,
  options: { ownMessages?: boolean } = {},
): string {
  const own = options.ownMessages === false ? null : peopleMessage(cause);
  if (own) return own;
  const reference = reportFailure(scope, cause);
  const detail = showsErrorDetail() ? ` (${cause instanceof Error ? cause.message : String(cause)})` : "";
  return `${sentence} Reference ${reference}.${detail}`;
}
