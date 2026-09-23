// How large a document one read can take, and what the upload screen says
// about one that is larger.
//
// ============================================================================
// A LEAF, ON PURPOSE. It imports nothing. The upload components run in the
// browser and must be able to read these numbers; `intake-source.ts` imports
// `node:zlib` and `read-excel-file`, so a client component importing it would
// pull a server module into the bundle. So the numbers live HERE, once, and the
// server checks import them from here — two copies of a limit is how the
// screen starts promising what the server refuses.
//
// Max, 2026-09-23: "Is it worth having a 'this document is too large to
// upload'?" It was: 20 MB was refused at registration, AFTER the bytes were
// stored, and 600 pages only when the charged read started. The browser now
// refuses both before a byte is stored. The server checks stay as the
// backstop, because a screen is never the guarantee.
// ============================================================================

/**
 * The largest PDF one read can take.
 *
 * Below the store's 30MB upload cap on purpose. Base64 expands a PDF by about
 * a third and Anthropic's total request ceiling is 32MB, so a 24MB PDF blows
 * the request before a single page of it is read. The upload token route's
 * 30MB is the STORE's ceiling, not this one, and a spreadsheet can be large.
 */
export const MAX_MODEL_PDF_BYTES = 20 * 1024 * 1024;

/**
 * The most pages one extraction can carry.
 *
 * THE MODEL'S OWN DOCUMENTED CEILING, NOT A NUMBER THIS APP CHOSE, and it is
 * tied to the model: 600 for a 1M-context model, which the extraction model
 * is, and 100 for a 200k-context one. If the extraction model is ever changed
 * to a 200k-context model this has to come down with it, which is the reason
 * the figure is a named constant with this sentence beside it rather than a
 * literal in a message.
 */
export const MAX_MODEL_PDF_PAGES = 600;

/**
 * Over this many pages, the upload row WARNS and the upload still proceeds.
 *
 * PROVISIONAL until a 100-page set has been read. Measured 2026-09-23 on the
 * real Panther pack merged into one 44-page PDF, read at effort high: 358 s
 * (about 8 s a page) against a 740 s model deadline, and 43,095 output tokens
 * (about 980 a page) against 128,000. TIME binds first, at about 90 pages; 70
 * leaves room for denser pages. It is a warning and never a refusal, because
 * how much a page costs depends on the drawing, and a refusal set too low is
 * the one error with no way round it.
 */
export const WARN_PDF_PAGES = 70;

export type UploadVerdict =
  | { kind: "proceed" }
  | { kind: "warn"; message: string }
  | { kind: "refuse"; message: string };

/** A PDF by its name or its declared type. Nothing else is ever counted. */
export function isPdfUpload(name: string, type?: string | null): boolean {
  return /\.pdf$/i.test(name.trim()) || type === "application/pdf";
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * What the upload row does with a PDF of this size and page count.
 *
 * `pages` is NULL where the browser could not count them, and NULL MEANS
 * PROCEED: refusing a document on an uncertain count leaves somebody with a
 * file they cannot get in and nothing to do about it. The server still
 * refuses it at the read if it really is over.
 */
export function pdfUploadVerdict({ bytes, pages }: { bytes: number; pages: number | null }): UploadVerdict {
  if (bytes > MAX_MODEL_PDF_BYTES) {
    return {
      kind: "refuse",
      message: `This PDF is ${megabytes(bytes)}; one read takes at most ${MAX_MODEL_PDF_BYTES / 1024 / 1024} MB — split it into smaller documents.`,
    };
  }
  if (pages === null || !Number.isFinite(pages) || pages < 1) return { kind: "proceed" };
  if (pages > MAX_MODEL_PDF_PAGES) {
    return {
      kind: "refuse",
      message: `This PDF has ${pages} pages; one read takes at most ${MAX_MODEL_PDF_PAGES} — split it into smaller documents.`,
    };
  }
  if (pages > WARN_PDF_PAGES) {
    return {
      kind: "warn",
      message: `${pages} pages — this may be too large to read in one go; if the read fails, split it.`,
    };
  }
  return { kind: "proceed" };
}
