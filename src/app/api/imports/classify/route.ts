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
import { pdfBillRefusal, readPdfBill } from "@/lib/pdf-bill";
import { isTranscribable, transcriptionReason, type TranscribableReason } from "@/lib/pdf-bill-checks";

/** What the upload row says of a PDF bill the model will transcribe. */
function transcribeNote(code: TranscribableReason, pages: number | null): { lines: number; pages: number; transcribe: true; reason: string } {
  return { lines: 0, pages: pages ?? 0, transcribe: true, reason: transcriptionReason(code) };
}
import { loadBoqReadingRegisters } from "@/lib/boq-stage";

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

/**
 * Genres whose PDF is never a bill printed from a spreadsheet, so their text is
 * not read as one: a drawing, a spec sheet, prose, a message. Everything else
 * — a schedule of any kind, `unclear`, `other` — is, where the model did not
 * already call it a bill.
 */
const NOT_A_BILL: ReadonlySet<string> = new Set(["shop_drawings", "specification_sheets", "preamble", "email"]);

/** What the model called it, in the held sentence. `unclear` names nothing. */
const GENRE_WORDS: Readonly<Record<string, string>> = {
  ffe_schedule: "an FF&E schedule",
  finishes_schedule: "a finishes schedule",
  fabric_schedule: "a fabric schedule",
  specification_bible: "a specification bible",
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
  // SINCE C2 (2026-10-15) A SCAN IS LOOKED AT, NOT REFUSED UNSEEN: a scanned
  // BILL is transcribed by the model, the one exception Max approved in
  // writing. So the small look happens, and only what it calls a bill,
  // certain, goes on; anything else is still refused with the same sentence,
  // now after one small charged look rather than none.
  const scanned = scannedPdfRefusal(source.type, source.type === "pdf" ? pdfHasTextLayer(blob.bytes) : null);

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

  // ============================================================================
  // A BILL IN A PDF IS READ BY ITS TEXT, BY CODE, BEFORE IT IS FILED (C1).
  //
  // The model said what the document IS; whether its cells can be put back is
  // code's to answer, from the bytes already in hand, and it costs nothing.
  // A table holds and the row is filed as a bill — registration reads it
  // again and builds the workbook (`/api/imports`). Anything else is HELD with
  // one short sentence and the detail beside it, before a byte is registered:
  // filing it as a bill would only fail one press later. Still nothing is
  // written here.
  // ============================================================================
  if (scanned) {
    if (result.decision?.importType === "boq") {
      return json(
        {
          ok: true,
          genre: result.genre,
          decision: result.decision,
          pdfBill: transcribeNote("scanned", countPdfPages(blob.bytes)),
          unsupported: null,
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
          largeDocument: result.model !== CLASSIFY_MODEL,
        },
        200,
      );
    }
    // A SCAN THE MODEL FILED AS SOME SCHEDULE, OR COULD NOT PLACE, may be the
    // bill — the fast model files a procurement schedule as an FF&E schedule
    // (C1, measured). Held, C1's way, with the next step in the sentence:
    // choosing Bill has it transcribed. A scanned drawing, spec sheet, preamble
    // or message is still refused: nothing here reads pictures of those.
    if (!NOT_A_BILL.has(result.genre)) {
      return json(
        {
          ok: true,
          genre: result.genre,
          decision: null,
          unsupported: null,
          held: `${GENRE_WORDS[result.genre] ? `Read as ${GENRE_WORDS[result.genre]}; its` : "Its"} pages are pictures, with no text a program can read. If it is the bill, choose Bill of quantities: the model will transcribe it (one charged read) and mark every line for you to check against its page.`,
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
          largeDocument: result.model !== CLASSIFY_MODEL,
        },
        200,
      );
    }
    return json(
      {
        ok: true,
        genre: result.genre,
        decision: null,
        unsupported: scanned,
        titleText: result.titleText,
        evidence: result.evidence || "the pages carry no text, only images",
        certain: result.certain,
        charged: true,
      },
      200,
    );
  }

  let pdfBill: { lines: number; pages: number; transcribe?: true; reason?: string } | null = null;
  if (result.decision?.importType === "boq" && source.type === "pdf") {
    const registers = await loadBoqReadingRegisters(sql).catch(() => null);
    const read = await readPdfBill(blob.bytes, registers ? { aliases: registers.aliases } : {});
    // CODE COULD NOT PUT ITS TEXT BACK INTO A TABLE: the model transcribes it
    // (C2), every line marked. Filed as a bill; the row says so and that the
    // transcription is one charged read.
    if (!read.ok && isTranscribable(read.code)) {
      pdfBill = transcribeNote(read.code, countPdfPages(blob.bytes));
    } else if (!read.ok) {
      return json(
        {
          ok: true,
          genre: result.genre,
          decision: null,
          unsupported: pdfBillRefusal(read.code),
          unsupportedDetail: read.detail,
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
          largeDocument: result.model !== CLASSIFY_MODEL,
        },
        200,
      );
    } else {
      pdfBill = { lines: read.rows.length, pages: read.pageCount };
    }
  } else if (source.type === "pdf" && !NOT_A_BILL.has(result.genre)) {
    // ==========================================================================
    // THE MODEL AND THE TEXT DISAGREE, SO A PERSON DECIDES.
    //
    // The real Ronnie Scott's "Procurement Schedule" PDFs (2026-10-15) carry an
    // ORDER QTY on every line and say "FF&E SPECIFICATION" at the top, and the
    // fast model filed all three as FF&E schedules, certain — three charged
    // reads and no records. Stating "a procurement schedule is a bill" in the
    // prompt did not move it (measured the same evening), and the word
    // "procurement" is only in the filenames. Code can see something the model
    // reading did not weigh: the text is a table with a quantity on every line.
    //
    // Neither reading wins (house §5, §6): filing it as a bill on code's say
    // would make an FF&E schedule with a Qty column a project's worth of
    // records, and filing it as a schedule spends a read that answers the
    // wrong question. So it is HELD with one sentence naming the next step,
    // the model's reading beside it, and nothing is registered or charged.
    // ==========================================================================
    const registers = await loadBoqReadingRegisters(sql).catch(() => null);
    const read = await readPdfBill(blob.bytes, registers ? { aliases: registers.aliases } : {});
    if (read.ok) {
      return json(
        {
          ok: true,
          genre: result.genre,
          decision: null,
          unsupported: null,
          held: `${GENRE_WORDS[result.genre] ? `Read as ${GENRE_WORDS[result.genre]}, but its` : "Its"} text is a table of ${read.rows.length} line${read.rows.length === 1 ? "" : "s"} with a quantity on each: if it is the bill, choose Bill of quantities.`,
          pdfBill: { lines: read.rows.length, pages: read.pageCount },
          titleText: result.titleText,
          evidence: result.evidence,
          certain: result.certain,
          charged: true,
          largeDocument: result.model !== CLASSIFY_MODEL,
        },
        200,
      );
    }
  }

  return json(
    {
      ok: true,
      genre: result.genre,
      decision: result.decision,
      // A bill in a PDF whose text reads as a table: how much of it, for the row.
      pdfBill,
      // A REFUSAL, not a gap. `decision: null` with nothing here means "you
      // decide"; with a sentence here it means the app knows what this is and
      // does not read it — a scan, today, or a PDF bill whose text is not a
      // table (set above).
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
