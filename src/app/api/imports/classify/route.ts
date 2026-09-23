// What kind of document is this? — asked of the model, answered to a screen.
//
// ============================================================================
// NOTHING IS WRITTEN AND NOTHING IS STAGED HERE.
//
// This route creates no `intake_runs` row, opens no attempt and stages no
// proposals. It answers one question for the upload screen, which fills the
// dropdown in and flags it. The kind still arrives at `/api/imports` DECLARED,
// by a person's press — the `level_suggested` rule again: the app guesses and
// shows its evidence, a human's action is what files it.
//
// IT DOES SPEND MONEY, one small call per document, on the fast model rather
// than the extraction one. The upload screen says so before anything uploads.
//
// THE BLOB IS ADDRESSED BY PATHNAME, NEVER BY URL, and the pathname is checked
// against the project's own prefix before a byte is read — `blob-source.ts`,
// unchanged. A classification is a hint on a screen, but the READ that produces
// it is a store credential fetching a file, and that is the thing M1 got wrong.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind, legacySpreadsheetAdvice } from "@/lib/intake-source-types";
import { readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { countPdfPages, prepareDocumentSource, pdfHasTextLayer } from "@/lib/intake-source";
import {
  CLASSIFY_MODEL,
  classifyDocument,
  KIND_FROM_GENRE,
  scannedPdfRefusal,
} from "@/lib/document-classify";
import type { ClassifyFailureCode } from "@/lib/classify-failure";
import { MAX_MODEL_PDF_BYTES, MAX_MODEL_PDF_PAGES } from "@/lib/upload-limits";

// 300, not 60: a PDF over the fast model's page ceiling is identified by the
// READING model (`classifyModelFor`), which has to take in up to 600 pages
// before it answers. `LARGE_CLASSIFY_DEADLINE_MS` (270 s) sits under this, so
// the route answers a slow look in words rather than Vercel answering it with
// an HTML 504 the screen can only call "took too long".
export const maxDuration = 300;

/**
 * The HTTP status a failed look answers with. The body is what the screen
 * reads — `ok: false`, the code, the sentence and `charged` — and the status is
 * there so a log line says the same thing the row does.
 */
const FAILURE_STATUS: Record<ClassifyFailureCode, number> = {
  not_configured: 503,
  too_large: 413,
  rate_limited: 429,
  overloaded: 503,
  timeout: 504,
  auth: 502,
  failed: 502,
};

// The extraction ceiling (upload-limits.ts): a document larger than that
// cannot be read at all, so there is nothing to classify it FOR — and one
// copy of the number is what keeps this route and the upload screen agreeing.
const MAX_BYTES = MAX_MODEL_PDF_BYTES;

const Body = z
  .object({
    projectId: z.string().uuid(),
    pathname: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(400),
    contentType: z.string().trim().max(200).optional().default(""),
    /**
     * The page count the BROWSER read with pdfjs, where it could. Used only
     * when the server's own count (`countPdfPages`) cannot read the page tree,
     * which is most compressed PDFs, and it decides one thing: which model
     * looks. It is not a trust decision — the worst a wrong hint does is send a
     * short document to the dearer model, or a long one to the fast model,
     * which then refuses it in words.
     */
    pages: z.number().int().positive().max(100_000).nullable().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That request is not valid." }, 400);
  }
  const input = parsed.data;

  const project = await sql`select id from projects where id = ${input.projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const kind = intakeSourceKind(input.filename, input.contentType);
  if (kind === "unsupported") {
    // An `.xls` reaches this route before it reaches registration, so the way
    // out has to be here too — otherwise a pack containing one is refused
    // twice and told how to fix it neither time.
    return json(
      { ok: false, error: legacySpreadsheetAdvice(input.filename) ?? `“${input.filename}” is not a supported document.` },
      400,
    );
  }
  // AN .eml NEEDS NO MODEL CALL. A saved email is unambiguously an email, and
  // paying to be told so would be the filename hint with a bill attached.
  if (kind === "eml") {
    return json(
      {
        ok: true,
        genre: "email",
        decision: KIND_FROM_GENRE.email,
        unsupported: null,
        titleText: null,
        evidence: "a saved email file",
        certain: true,
        charged: false,
      },
      200,
    );
  }

  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  let source;
  try {
    source = await prepareDocumentSource(blob.bytes, input.filename, blob.contentType || input.contentType);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, 400);
  }

  // A SCANNED PDF COSTS NOTHING TO REFUSE AND FOUR MINUTES TO READ (§6.10.b).
  //
  // Before the call, not after it: the model would look at pictures of pages
  // for the whole deadline and come back with nothing to review, and the charge
  // would be for being told what one pass over the bytes already says. Only a
  // CERTAIN reading refuses — `pdfHasTextLayer` returns null for a stream it
  // cannot decode and null proceeds, because the naive test calls every
  // compressed PDF scanned and would refuse the whole pilot pack. Nothing is
  // registered either way: this route has never created a run.
  const scanned = scannedPdfRefusal(source.type, source.type === "pdf" ? pdfHasTextLayer(blob.bytes) : null);
  if (scanned) {
    return json(
      {
        ok: true,
        genre: "unclear",
        decision: null,
        unsupported: scanned,
        titleText: null,
        evidence: "the pages carry no text, only images",
        certain: true,
        charged: false,
      },
      200,
    );
  }

  const pages =
    source.type === "pdf" ? (countPdfPages(blob.bytes) ?? input.pages ?? null) : null;
  const result = await classifyDocument(source, { pages: pages !== null && pages <= MAX_MODEL_PDF_PAGES ? pages : null });

  // ============================================================================
  // THE MODEL ANSWERING "UNCLEAR" AND THE CALL FAILING ARE DIFFERENT ANSWERS.
  //
  // This used to answer `200 ok:true, genre: "unclear"` for both, with the
  // failure's reason in a field the upload screen never read. On pilot
  // (2026-09-23) that turned a deployment with no API key into thirty rows
  // reading "Say which", two empty packs, and a footer saying nothing had been
  // charged — the one failure mode that reads as "the app looked and could not
  // tell", which sends a person hunting the wrong cause.
  //
  // So a failed look is `ok: false` with a stable code, the sentence, and
  // whether it was charged. The row prints it red with "Try identifying
  // again"; the file is stored either way, and a person can still choose the
  // kind by hand, which is where this app was before any of this existed.
  // ============================================================================
  if (!result.ok) {
    return json(
      { ok: false, code: result.code, error: result.error, charged: result.charged, model: result.model },
      FAILURE_STATUS[result.code],
    );
  }

  return json(
    {
      ok: true,
      genre: result.genre,
      decision: result.decision,
      // A REFUSAL, not a gap. `decision: null` with nothing here means "you
      // decide"; with a sentence here it means the app knows what this is and
      // does not read it — a bill inside a PDF, today (§6.10.a row 8).
      unsupported: result.unsupported,
      titleText: result.titleText,
      evidence: result.evidence,
      certain: result.certain,
      charged: true,
      // Said on the row: a long document is identified by the reading model,
      // and somebody reading the cost of a pack is owed that.
      largeDocument: result.model !== CLASSIFY_MODEL,
    },
    200,
  );
}
