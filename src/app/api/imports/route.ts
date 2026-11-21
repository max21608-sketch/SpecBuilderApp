// Registering a document. Nothing operational is written here — a BOQ is parsed
// into staged rows, a specification document is not even read — until a human
// confirms at /api/imports/[id]/confirm.
//
// ============================================================================
// THE IMPORT TYPE IS DECLARED, NEVER INFERRED.
//
// A BOQ and an FF&E schedule are both .xlsx. A file extension identifies bytes,
// not a workflow, so the upload UI asks which one this is and the server takes
// it as given. Inferring would eventually route an FF&E schedule into the BOQ
// parser, which would read its columns as bill lines and create a project's
// worth of wrong spec records from a document that was never a bill.
//
// TWO UPLOAD PATHS for a BOQ, and the difference matters.
//
//   multipart/form-data  the file is posted straight to this route. Works with
//                        no blob store, which is what makes the import usable
//                        today. But the SOURCE ARTIFACT IS NOT KEPT: there is
//                        nowhere to put it, so no attachments row is written
//                        and the import is flagged `source_preserved: false`
//                        for the reviewer to see. house/data-safety.md says
//                        preserve the original; this path cannot, so it says so
//                        rather than pretending.
//   application/json     the browser has already uploaded to Vercel Blob and
//                        sends the PATHNAME. We re-read it server-side through
//                        the trusted helper, so the client cannot fake the
//                        contents.
//
// A SPECIFICATION DOCUMENT HAS ONLY THE SECOND PATH. It is read by a model,
// minutes later, in a queue worker that has no request body to fall back on —
// and a proposal a reviewer cannot check against the original page is a
// proposal they have to take on faith. No preserved source, no extraction.
//
// ============================================================================
// REGISTERING A SPECIFICATION DOCUMENT NOW SPENDS MONEY.
//
// It did not used to. Registration read no body and cost nothing, and pressing
// Read on the review screen was a separate, deliberate act -- one press, one
// document, with the charge stated on the button.
//
// A real pack broke that. Panther is eleven documents and packs of thirty are
// expected, so "a deliberate act per document" is thirty presses across
// eleven screens before anybody can begin reviewing, and the state a reviewer
// actually wants -- everything read -- was reached only by remembering to
// click thirty times. Every document in a tender pack is going to be read.
// Asking about each one separately was ceremony, not consent.
//
// So an attempt is opened and published HERE, per document, as it registers.
// The upload screen states the count and the charge before anything is
// uploaded; that statement is where the human decision now lives.
//
// Two consequences worth being plain about:
//
//   A registration SUCCEEDS even when its dispatch fails. The file is stored
//   and the row exists either way, so the failure is recorded on the run --
//   where the review screens already render it with a Retry -- and reported as
//   a footnote on the 201, never as a failed upload.
//
//   Nothing is retro-active. A document already sitting at `pending` from
//   before this change is not read by anything here; the pack screen's
//   "Read all" is what clears those.
//
// The BOQ path is unaffected: a bill is parsed synchronously, by code, and no
// model has ever been involved in it. Since 0040 a bill is also never REFUSED
// for its headings: one whose columns nobody recognised stages as needing a
// person to map them (src/lib/boq-import.ts), and only a file with no sheets,
// or one that is not a spreadsheet, fails.
// ============================================================================
//
// Why not @vercel/blob's onUploadCompleted callback: it is an inbound webhook
// from Vercel, so it never fires against localhost. Building the only write
// path on something that cannot run in development would mean the import could
// not be tested end to end without a tunnel.
import { z } from "zod";
import { readSpreadsheetSheets, pdfHasTextLayer, countPdfPages } from "@/lib/intake-source";
import { blobPictureStore, stageBillRowImages, type PictureStore } from "@/lib/bill-images";
import { sql, json, type Row } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind, outlookMsgAdvice, spreadsheetRefusal } from "@/lib/intake-source-types";
import { scannedPdfRefusal } from "@/lib/document-classify";
import { parseBoqSheets, proposePhaseNames, BOQ_SCHEMA_VERSION, type BoqDocument } from "@/lib/boq-import";
import { isTranscribable, transcriptionReason, type PdfTranscription, type TranscribableReason } from "@/lib/pdf-bill-checks";
import { loadBoqReadingRegisters, loadLineSuggester, stageSheet } from "@/lib/boq-stage";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/spec-vocab";
import { headTrustedBlob, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { WAITING_FOR_SLOT_MESSAGE } from "@/lib/extraction-slots";
import { dispatchRegisteredRead, insertSpecDocumentRun } from "@/lib/spec-registration";
import { describeDuplicate, recordMessageUnlessKnown } from "@/lib/email-ingest";
import { assignMessage } from "@/lib/email-registration";
import { withTransaction, transactionErrorResponse, type TxnSql } from "@/lib/db-transaction";
import { MAX_MODEL_PDF_BYTES } from "@/lib/upload-limits";
import { SourcePartSchema, normalisePart, partLabel, partPageCount, partRefusal, type SourcePart } from "@/lib/source-part";
import {
  PDF_BILL_SHEET,
  pdfBillRefusal,
  pdfBillWorkbook,
  pdfBillWorkbookFilename,
  pdfBillWorkbookPathname,
  readPdfBill,
  type PdfBillSource,
} from "@/lib/pdf-bill";
import { requireWriter } from "@/lib/route-guards";
import { explainFailure } from "@/lib/error-detail";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const maxDuration = 60;

const MAX_DIRECT_BYTES = 4 * 1024 * 1024; // below the serverless request-body ceiling
const MAX_BOQ_BYTES = 30 * 1024 * 1024;

// `MAX_MODEL_PDF_BYTES` (upload-limits.ts) is below the 30MB storage cap on
// purpose — base64 and the 32MB request ceiling. The upload screen refuses a
// larger PDF before a byte is stored; this is the backstop, and rejecting it
// here, at registration, still costs nothing where the worker would cost an
// attempt.

const UUID = z.string().uuid();

const Registration = z
  .object({
    projectId: UUID,
    importType: z.enum(["boq", "spec_document"]),
    documentKind: z.enum(DOCUMENT_KINDS).nullable().optional(),
    pathname: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(400),
    contentType: z.string().trim().max(200).optional().default(""),
    size: z.number().int().nonnegative().optional(),
    // Generated once per user action by the browser and reused across retries,
    // so a lost response cannot create a second run for one upload.
    registrationRequestId: UUID.optional(),
    // The delivery this file arrived in. Optional: a single file uploaded on
    // its own is still a perfectly good import.
    batchId: UUID.optional(),
    // The part of the file this read is for (open intake): some pages of a
    // PDF or some sheets of a workbook. Absent for the whole file, which is
    // every registration before parts and every file with one kind in it.
    part: SourcePartSchema.optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) return registerDirectBoq(request, user.email);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = Registration.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That upload is not valid.", field: issue?.path.join(".") }, 400);
  }
  const input = parsed.data;

  // A part is refused in words before anything is read or recorded: what it
  // may name depends only on the file's kind and the reader, and the page
  // count is checked where the PDF's bytes are read (`registerSpecDocument`).
  if (input.part) {
    const normal = normalisePart(input.part);
    if (!normal.ok) return json({ ok: false, error: normal.error, field: "part" }, 400);
    const refused = partRefusal(normal.part, {
      sourceKind: intakeSourceKind(input.filename, input.contentType),
      documentKind: input.importType === "spec_document" ? input.documentKind : null,
      pageCount: null,
    });
    if (refused) return json({ ok: false, error: refused, field: "part" }, 400);
    input.part = normal.part;
  }

  const project = await sql`select id from projects where id = ${input.projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  // Checked against the project, not taken on trust: a batch id from another
  // project would file this document under a pack it does not belong to.
  if (input.batchId) {
    const batch = await sql`select id from intake_batches where id = ${input.batchId} and project_id = ${input.projectId}`;
    if (!batch[0]) return json({ ok: false, error: "No such intake batch on this project.", field: "batchId" }, 404);
  }

  if (input.importType === "spec_document") {
    // An email registers differently: it becomes an `email_messages` row
    // first, because the message is a thing in its own right — held, routed,
    // and openable in Outlook — and only then an intake run.
    if (input.documentKind === "email") return registerEmail(input, user.email);
    return registerSpecDocument(input, user.email);
  }
  return registerBlobBoq(input, user.email);
}

type Registered = z.infer<typeof Registration>;

// ---- an email ---------------------------------------------------------------
// A saved .eml, uploaded against a project by a person. The Graph path (Phase 2)
// reaches the same two functions with the same arguments; what differs is only
// who decided the project.
const MAX_EMAIL_BYTES = 30 * 1024 * 1024;

async function registerEmail(input: Registered, actor: string): Promise<Response> {
  // ======================================================================
  // AN OUTLOOK .msg IS REFUSED HERE, BEFORE ANY OF IT IS BELIEVED.
  //
  // `registerSpecDocument` has always refused one — `intakeSourceKind` returns
  // `unsupported` and says so — and THIS branch never asked. So a `.msg`
  // declared as an email walked straight past it: `parseEnvelope` reads binary
  // OLE as a message with no sender, no subject and no body, routing holds it
  // as unplaced, and `assignMessage` then dispatches a CHARGED read of
  // gibberish. Failing four minutes later in the worker would at least be
  // visible; succeeding at full price on nothing is worse.
  //
  // Nothing is recorded and nothing is dispatched. The blob itself is already
  // in the store — every intake upload is client-direct and registration is
  // the step after it — so "before storing" is not available on this
  // architecture, and the sweep that removes an unregistered upload is the
  // same one it has always been.
  //
  // NO PARSER IS ADDED. `package.json` carries none, and a .msg reader is a
  // dependency taken on to read a format the sender can re-save in one menu.
  // It stays accepted as EVIDENCE on a change set, which only ever downloads.
  // ======================================================================
  if (intakeSourceKind(input.filename, input.contentType) !== "eml") {
    return json(
      {
        ok: false,
        // The SAME sentence the upload screen prints when it refuses a dropped
        // `.msg` before storing it — `outlookMsgAdvice` in intake-source-types,
        // beside the spreadsheet one, so the two cannot drift. Anything else
        // declared as an email gets the general form.
        error:
          outlookMsgAdvice(input.filename) ??
          `"${input.filename}" is not an email this app can read. Save it as .eml and upload that.`,
        field: "filename",
      },
      400,
    );
  }

  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_EMAIL_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  try {
    // THE SAME EMAIL TWICE IS ONE MESSAGE (audit B8). Uploaded again, or
    // already arrived through the mailbox, it is OFFERED rather than recorded
    // and read a second time. 200, not 201: nothing was created, and the
    // sentence says where the one that exists is.
    const known = await recordMessageUnlessKnown({
      mailbox: "upload",
      origin: "upload",
      bytes: blob.bytes,
      storagePath: blob.pathname,
      mimeSize: blob.size,
      actor,
      intendedProjectId: input.projectId,
    });
    if (known.duplicateOf) {
      return json(
        { ok: true, duplicateOf: known.duplicateOf, note: describeDuplicate(known.duplicateOf) },
        200,
      );
    }
    const recorded = known.recorded;

    // Assigning is what starts the read and spends the money, and the upload
    // screen has already said so.
    const assigned = await assignMessage({
      messageId: recorded.id,
      projectId: input.projectId,
      kind: "manual",
      actor,
    });

    return json(
      {
        ok: true,
        importId: assigned.runId,
        messageId: recorded.id,
        sourcePreserved: true,
        // Reported rather than thrown: the file is stored and the rows exist
        // either way, and the review screen renders the failure with a Retry.
        // A read the cap deferred is `waiting`, never `error` — it needs
        // nobody, where a dispatch failure needs a Retry.
        autoRead: assigned.dispatchError
          ? { dispatched: false, error: assigned.dispatchError }
          : assigned.waitingForSlot
            ? { dispatched: false, waiting: true, note: WAITING_FOR_SLOT_MESSAGE }
            : { dispatched: true },
        // What the HEADERS would have decided, so a message uploaded against
        // the wrong project is visible rather than silent.
        routing: {
          status: recorded.routing.status,
          matchesThisProject:
            recorded.routing.status === "assigned" && recorded.routing.projectId === input.projectId,
        },
      },
      201,
    );
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- specification document ------------------------------------------------
// Register the document, then dispatch the read. No body is read HERE -- the
// worker does that, minutes later -- but a paid model call is scheduled.
async function registerSpecDocument(input: Registered, actor: string): Promise<Response> {
  if (!input.documentKind) {
    return json({ ok: false, error: "Say what kind of specification document this is.", field: "documentKind" }, 400);
  }

  const kind = intakeSourceKind(input.filename, input.contentType);
  if (kind === "unsupported") {
    return json({ ok: false, error: `"${input.filename}" is not a supported document. Upload a PDF, .xlsx, .csv or .tsv file.` }, 400);
  }

  // The store's own metadata, not the client's claim about it. This is also
  // what proves the upload actually happened.
  let meta;
  try {
    meta = await headTrustedBlob(input.pathname, input.projectId);
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  if (kind === "pdf" && meta.size > MAX_MODEL_PDF_BYTES) {
    return json(
      {
        ok: false,
        error: `That PDF is ${(meta.size / 1024 / 1024).toFixed(1)}MB. The limit for a document read by the model is ${MAX_MODEL_PDF_BYTES / 1024 / 1024}MB — split it and upload the parts separately.`,
      },
      413,
    );
  }

  // ======================================================================
  // A SCANNED PDF IS REFUSED HERE TOO, NOT ONLY AT CLASSIFY (FIU 2026-09-21).
  //
  // `pdfHasTextLayer` and `scannedPdfRefusal` have existed since 91360b6 and
  // the CLASSIFY route asks them before the model. This one never did — and
  // classify is not on the path when somebody DECLARES the kind, which is the
  // held row's dropdown, a second press after an unclear answer, and anything
  // registering without the screen. So a hand-declared kind on an image-only
  // PDF opened an attempt and SPENT THE READ: about four minutes of the model
  // looking at pictures of pages, at full price, for a review screen with
  // nothing on it.
  //
  // REFUSED OUTRIGHT (400), rather than registered and left undispatched. A
  // `pending` run with no attempt is exactly the shape *Read all* picks up, so
  // a scanned PDF parked that way would be one press from the charge it was
  // just refused for — and that button's own sentence says each is charged. A
  // row nobody may ever read is a row that only ever renders as a problem.
  // This is what `.msg` above and the classify route both already do.
  //
  // "Before storage" is not available on this architecture: every intake
  // upload is client-direct and registration is the step AFTER it. So the blob
  // stays, unregistered, swept as an unregistered upload always has been — and
  // the screen refuses this file in the browser where it can (see
  // `IntakeBatchUpload`), which is the half that stops the byte being stored.
  //
  // CERTAIN OR PROCEED, the same rule as classify and the harder half: a
  // filter chain it cannot decode, an unimplemented codec, or no visible page
  // all answer NULL, and null PROCEEDS. The naive test (no `Tj` in the raw
  // bytes) calls every compressed real drawing scanned and would refuse the
  // whole pilot pack. Only a measured `false` refuses.
  //
  // The bytes are read only AFTER the size check above, so an oversize PDF is
  // still refused on the store's own metadata without downloading it.
  // ======================================================================
  if (kind === "pdf") {
    let pdf;
    try {
      pdf = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_MODEL_PDF_BYTES });
    } catch (cause) {
      if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
      throw cause;
    }
    const scanned = scannedPdfRefusal("pdf", pdfHasTextLayer(pdf.bytes));
    if (scanned) return json({ ok: false, error: scanned, field: "filename" }, 400);
    // Pages past the end are refused here, where the bytes are already in
    // hand. An uncountable PDF proceeds (`countPdfPages`' abstention), and the
    // read refuses then if the file really is shorter.
    if (input.part) {
      const refused = partRefusal(input.part, { sourceKind: kind, documentKind: input.documentKind, pageCount: countPdfPages(pdf.bytes) });
      if (refused) return json({ ok: false, error: refused, field: "part" }, 400);
    }
  }

  try {
    // The idempotency check, the insert, the per-pack read cap and the attempt,
    // in one transaction — `src/lib/spec-registration.ts`, which a confirmed
    // bill's "Read the specifications in this bill" registers through too, so
    // the rules about when a paid call may be claimed exist once.
    const result = await withTransaction((txn) =>
      insertSpecDocumentRun(txn, {
        projectId: input.projectId,
        batchId: input.batchId ?? null,
        documentKind: input.documentKind as DocumentKind,
        registrationRequestId: input.registrationRequestId ?? null,
        actor,
        sourcePart: input.part ?? null,
        attach: async () => {
          const attachment = await txn`
            insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
            values ('project', ${input.projectId}, 'spec_document', ${meta.pathname}, ${input.filename},
                    ${meta.contentType || input.contentType || null}, ${meta.size}, ${actor})
            returning id
          `;
          if (!attachment[0]) throw new Error("the attachment was not recorded");
          return String(attachment[0].id);
        },
      }),
    );

    // A REPLAYED registration must not open a second attempt. It returns the
    // run it already made, whose read was dispatched the first time round;
    // publishing again here would be a duplicate whose only effect is to spend
    // one of four deliveries.
    if (result.reused) {
      return json({ ok: true, importId: result.importId, reused: true, sourcePreserved: true }, 200);
    }

    // 201 EITHER WAY. The document is stored and registered; whether its read
    // reached the queue — or is waiting behind the pack's three in flight — is
    // a separate fact about the run, recorded on the run, and the screens
    // already offer the retry it needs. Failing the upload over it would tell
    // somebody their file did not arrive when it did.
    return json(
      {
        ok: true,
        importId: result.importId,
        reused: false,
        sourcePreserved: true,
        autoRead: await dispatchRegisteredRead(result, actor),
      },
      201,
    );
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- BOQ, uploaded to the blob store ---------------------------------------
async function registerBlobBoq(input: Registered, actor: string): Promise<Response> {
  // A REPLAYED REGISTRATION IS ANSWERED BEFORE ANYTHING IS READ OR STORED
  // (open intake, the design's trap 4). Until 2026-11-20 no bill path wrote
  // `registration_request_id`, so a retried request — a lost response, a part
  // registered again — made a second bill: a second attachment, a second
  // stored workbook, a second set of lines to confirm. Asked here, first, so a
  // replay of a PDF bill does not even rebuild its workbook; asked again inside
  // each insert's transaction, where the unique index settles a race.
  const replayed = await replayedBill(input.registrationRequestId);
  if (replayed) return replayed;

  // A BOQ is a grid, and a client exports that grid as .xlsx or as .csv. The
  // DECLARED import type is what says this file is a bill; the extension only
  // says how to read its bytes. A PDF is one too when it was printed from a
  // spreadsheet: its cells are text, and `registerPdfBoq` puts them back.
  const kind = intakeSourceKind(input.filename, input.contentType);
  if (kind === "pdf") return registerPdfBoq(input, actor);
  if (kind !== "xlsx" && kind !== "csv" && kind !== "tsv") {
    // `.xls` and its relations get the way out rather than only the refusal —
    // see `spreadsheetRefusal`. Nothing is parsed and nothing is staged.
    return json({ ok: false, error: spreadsheetRefusal(input.filename, kind) }, 400);
  }

  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_BOQ_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  // A PART OF A WORKBOOK names its sheets, and one the workbook does not hold
  // is refused HERE, in words, with nothing recorded: a bill staged without the
  // sheet a person filed is a bill with a hole nobody asked for. The sheets
  // read for the check are the ones parsed, so the file is read once. A file
  // that is not a workbook at all is left to the parse, which records the
  // failed run exactly as it does for a whole file.
  let sheets: Awaited<ReturnType<typeof readSpreadsheetSheets>> | undefined;
  if (input.part?.kind === "sheets") {
    try {
      sheets = await readSpreadsheetSheets(blob.bytes, input.filename, blob.contentType || input.contentType || "");
    } catch {
      sheets = undefined;
    }
    const held = sheets;
    const missing = held ? input.part.sheets.filter((name) => !held.some((sheet) => sheet.sheet === name)) : [];
    if (missing.length > 0) {
      return json(
        {
          ok: false,
          error: `This bill is filed as ${partLabel({ kind: "sheets", sheets: missing })}, which this workbook does not hold. A sheet may have been renamed since the file was surveyed — upload it again.`,
          field: "part",
        },
        400,
      );
    }
  }

  return parseBoqInto(input.projectId, input.filename, blob.bytes, actor, true, {
    attach: async (txn) => {
      const attachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${input.projectId}, 'boq', ${blob.pathname}, ${input.filename},
                ${blob.contentType || input.contentType || null}, ${blob.size}, ${actor})
        returning id
      `;
      return { attachmentId: recordedId(attachment) };
    },
    batchId: input.batchId ?? null,
    contentType: blob.contentType || input.contentType || "",
    registrationRequestId: input.registrationRequestId ?? null,
    part: input.part ?? null,
    sheets,
  });
}

/**
 * The bill a registration request already made, answered as a replayed
 * specification document is (`reused: true`, 200), or null. Nothing is read,
 * stored or recorded for a replay.
 */
async function replayedBill(requestId: string | null | undefined, exec: TxnSql = sql): Promise<Response | null> {
  const earlier = await billRegisteredBefore(requestId, exec);
  return earlier ? replayAnswer(earlier) : null;
}

type EarlierBill = { id: string; status: string; error: string | null };

async function billRegisteredBefore(requestId: string | null | undefined, exec: TxnSql): Promise<EarlierBill | null> {
  if (!requestId) return null;
  const rows = await exec`select id, status, error from intake_runs where registration_request_id = ${requestId}`;
  if (!rows[0]) return null;
  return { id: String(rows[0].id), status: String(rows[0].status), error: rows[0].error == null ? null : String(rows[0].error) };
}

/**
 * A REPLAY ANSWERS AS THE FIRST REQUEST ENDED, failure included. A bill whose
 * parse FAILED is a run with `status = 'failed'`, and answering its replay
 * `ok: true` told the screen a bill that never read had been added — a lost
 * response, retried, turned a failure into "Added". So a failed run is
 * answered as the failure it was, with its sentence, and the screen mints a
 * fresh request id for the next try (`nextRequestId`: the server answered).
 * A run still parsing, or parsed, is the success it is or will be.
 */
function replayAnswer(earlier: EarlierBill): Response {
  if (earlier.status === "failed") {
    return json({ ok: false, error: earlier.error ?? "This bill could not be read.", importId: earlier.id, reused: true }, 422);
  }
  return json({ ok: true, importId: earlier.id, reused: true, sourcePreserved: true }, 200);
}

/**
 * A transaction that lost the race on `intake_runs_registration_request_key`
 * to a concurrent copy of itself: the other one's run, or the ordinary failure.
 */
async function replayOrFailure(requestId: string | null | undefined, cause: unknown): Promise<Response> {
  return (await replayedBill(requestId).catch(() => null)) ?? transactionErrorResponse(cause);
}

// ---- BOQ, uploaded as a PDF -------------------------------------------------
// ============================================================================
// A BILL THAT ARRIVED AS A PDF, READ BY ITS TEXT (workstream C1, 2026-10-15).
//
// The PDF's text layer is put back into a grid by CODE (`pdf-bill.ts`): no
// model reads a cell, so the rule that a bill's cells are copied exactly holds.
// The workbook that builds is STORED BESIDE THE PDF, under the same project
// prefix, by pathname — and it, not the PDF, is the run's source. That is the
// whole design: from here every step is the ordinary bill path, unchanged —
// the Columns panel, the model's structure read, a person's columns, the
// review and the confirm all re-read "the stored spreadsheet", and there is
// one. The PDF is kept as its own attachment, which the review links to, and
// each staged line remembers its page (`pdfSource` on the staged document).
//
// REFUSED IN ONE SENTENCE where the text is not a table: a scan, a laid-out
// sheet, a page with no quantity column. Nothing is recorded then.
//
// THE SEAM FOR C2. A PDF with no usable text layer is, once Max's approved
// exception is built, transcribed by the model in page windows — every line
// marked transcribed, with its page. It enters HERE, where `scanned` and
// `!read.ok` refuse today, and produces the same `{ header, rows }` shape, so
// everything below the read is shared.
// ============================================================================
async function registerPdfBoq(input: Registered, actor: string, store: PictureStore = blobPictureStore): Promise<Response> {
  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_BOQ_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  // A SCAN, OR TEXT THAT IS NOT A TABLE, IS TRANSCRIBED BY THE MODEL (C2).
  // Max, 2026-10-15, in writing: "a PDF bill with no usable text layer may be
  // transcribed by the model, every line marked transcribed with its page and
  // checked by a person." Registered here as WAITING — nothing is read or
  // charged yet — and the review starts the transcription
  // (`/api/imports/[id]/transcribe`), because it takes minutes and this route
  // has one. A PDF that could not be opened at all is still refused.
  // A PART'S PAGES PAST THE END are refused here, where the bytes are in hand,
  // before a workbook is built or a transcription registered. An uncountable
  // PDF proceeds (`countPdfPages`' abstention), as it does for a document.
  const part = input.part ?? null;
  if (part) {
    const refused = partRefusal(part, { sourceKind: "pdf", documentKind: null, pageCount: countPdfPages(blob.bytes) });
    if (refused) return json({ ok: false, error: refused, field: "part" }, 400);
  }

  const scanned = scannedPdfRefusal("pdf", pdfHasTextLayer(blob.bytes));
  if (scanned) return registerPdfForTranscription(input, actor, blob, "scanned");

  // A PART IS READ BY ITS PAGES ONLY (the design's trap 6): another document
  // in the same PDF printing a table of its own is not this bill's columns
  // changing. Each row keeps its page in the whole file.
  const registers = await loadBoqReadingRegisters(sql);
  const read = await readPdfBill(blob.bytes, { aliases: registers.aliases, part });
  if (!read.ok) {
    if (isTranscribable(read.code)) return registerPdfForTranscription(input, actor, blob, read.code);
    return json({ ok: false, error: pdfBillRefusal(read.code), detail: read.detail, code: read.code, field: "filename" }, 400);
  }

  const workbook = await pdfBillWorkbook(read, PDF_BILL_SHEET);
  const workbookPathname = pdfBillWorkbookPathname(blob.pathname, part);
  const workbookFilename = pdfBillWorkbookFilename(input.filename);
  try {
    await store(workbookPathname, workbook.bytes, XLSX_CONTENT_TYPE);
  } catch (cause) {
    // The store's own text is for the log, not the screen (audit A12).
    return json(
      {
        ok: false,
        error: explainFailure("The bill was read, but its spreadsheet could not be stored.", cause, "pdf-bill-store", {
          ownMessages: false,
        }),
      },
      502,
    );
  }

  return parseBoqInto(input.projectId, workbookFilename, workbook.bytes, actor, true, {
    attach: async (txn) => {
      const pdfAttachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${input.projectId}, 'boq_pdf', ${blob.pathname}, ${input.filename},
                ${blob.contentType || input.contentType || "application/pdf"}, ${blob.size}, ${actor})
        returning id
      `;
      const workbookAttachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${input.projectId}, 'boq', ${workbookPathname}, ${workbookFilename},
                ${XLSX_CONTENT_TYPE}, ${workbook.bytes.length}, ${actor})
        returning id
      `;
      return {
        attachmentId: recordedId(workbookAttachment),
        pdfSource: {
          attachmentId: recordedId(pdfAttachment),
          filename: input.filename,
          sheet: PDF_BILL_SHEET,
          firstRow: workbook.firstRow,
          pages: workbook.rowPages,
          // What the reader doubts per line (C10), only where it doubts something.
          ...(workbook.rowFlags ? { flags: workbook.rowFlags } : {}),
          // Only where the bill is part of the PDF, so a whole PDF stages as before.
          ...(part ? { part } : {}),
        },
      };
    },
    batchId: input.batchId ?? null,
    contentType: XLSX_CONTENT_TYPE,
    // The phase is named after the PDF, not after "… (read from PDF)".
    phaseFilename: input.filename,
    registrationRequestId: input.registrationRequestId ?? null,
    part,
  });
}

/**
 * A PDF BILL CODE COULD NOT READ, REGISTERED TO BE TRANSCRIBED (C2). The run
 * is a bill with no sheets yet: its only attachment is the PDF, `pdfSource`
 * names it, and `pdfTranscription` says it is waiting and why. The transcribe
 * route stores the workbook beside the PDF and makes it the run's source, and
 * from then on it is an ordinary bill. Nothing is charged here.
 */
async function registerPdfForTranscription(
  input: Registered,
  actor: string,
  blob: { pathname: string; contentType: string; size: number; bytes: Buffer },
  code: TranscribableReason,
): Promise<Response> {
  const pageCount = countPdfPages(blob.bytes);
  const part: SourcePart | null = input.part ?? null;
  const pdfTranscription: PdfTranscription = { state: "waiting", reason: transcriptionReason(code), pageCount };
  const requestId = input.registrationRequestId ?? null;
  // The PDF's attachment and the run that names it stand or fall together: an
  // attachment with no run is a stored bill nobody can open from any screen.
  let importId: string;
  let reused: EarlierBill | null = null;
  try {
    importId = await withTransaction(async (txn) => {
      const earlier = await billRegisteredBefore(requestId, txn);
      if (earlier) {
        reused = earlier;
        return earlier.id;
      }
      const pdfAttachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${input.projectId}, 'boq_pdf', ${blob.pathname}, ${input.filename},
                ${blob.contentType || input.contentType || "application/pdf"}, ${blob.size}, ${actor})
        returning id
      `;
      const attachmentId = recordedId(pdfAttachment);
      const staged: BoqDocument = {
        schemaVersion: BOQ_SCHEMA_VERSION,
        filename: input.filename,
        sourcePreserved: true,
        sheets: [],
        pdfSource: {
          attachmentId,
          filename: input.filename,
          sheet: PDF_BILL_SHEET,
          firstRow: 0,
          pages: [],
          // The transcription windows over these pages only (the transcribe route).
          ...(part ? { part } : {}),
        },
        pdfTranscription,
      };
      const run = await txn`
        insert into intake_runs
          (project_id, attachment_id, batch_id, source_kind, status, parsed,
           registration_request_id, source_part, created_by, updated_by)
        values (${input.projectId}, ${attachmentId}, ${input.batchId ?? null}, 'boq_xlsx', 'parsed', ${JSON.stringify(staged)}::jsonb,
                ${requestId}, ${part ? JSON.stringify(part) : null}::jsonb, ${actor}, ${actor})
        returning id
      `;
      return recordedId(run);
    });
  } catch (cause) {
    return replayOrFailure(requestId, cause);
  }
  if (reused) return replayAnswer(reused);
  return json(
    {
      ok: true,
      importId,
      lines: 0,
      sheets: 0,
      skippedRows: 0,
      sourcePreserved: true,
      needsColumns: 0,
      // The review starts the model's transcription, one charged read; the upload row has said so.
      // A part is transcribed by its own pages, so those are the pages it costs.
      transcribe: { reason: pdfTranscription.reason, pages: part ? partPageCount(part) : pageCount },
    },
    201,
  );
}

// ---- BOQ, posted straight to this route ------------------------------------
async function registerDirectBoq(request: Request, actor: string): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const importType = String(form.get("importType") ?? "boq");
  const batchId = String(form.get("batchId") ?? "");

  if (batchId) {
    // This path keeps no original (there is no attachments row), and a document
    // in a pack is one a reviewer will want to open against a drawing later.
    return json(
      { ok: false, error: "A document in an intake pack must be uploaded to the document store, so its original is kept." },
      400,
    );
  }

  if (importType !== "boq") {
    // A specification document has no fallback path: it is read by a model
    // minutes later, in a worker with no request body, and a reviewer must be
    // able to check a proposal against the original page.
    return json(
      { ok: false, error: "A specification document must be uploaded to the document store — its original has to be kept for review." },
      400,
    );
  }
  if (!(file instanceof File)) return json({ ok: false, error: "No file was attached." }, 400);
  if (file.size > MAX_DIRECT_BYTES) {
    return json(
      { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. Direct upload is capped at 4MB; a blob store is needed for anything larger.` },
      413,
    );
  }
  if (!projectId) return json({ ok: false, error: "projectId and a file are required." }, 400);

  const kind = intakeSourceKind(file.name, file.type);
  if (kind !== "xlsx" && kind !== "csv" && kind !== "tsv") {
    return json({ ok: false, error: spreadsheetRefusal(file.name, kind) }, 400);
  }

  const project = await sql`select id from projects where id = ${projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const bytes = Buffer.from(await file.arrayBuffer());
  return parseBoqInto(projectId, file.name, bytes, actor, false);
}

// ---- the shared BOQ parse --------------------------------------------------
async function parseBoqInto(
  projectId: string,
  filename: string,
  bytes: Buffer,
  actor: string,
  sourcePreserved: boolean,
  options: {
    /**
     * Records the stored original(s), inside the transaction that opens the
     * run. Absent for a bill posted straight here, which keeps no original.
     */
    attach?: (txn: TxnSql) => Promise<{ attachmentId: string; pdfSource?: PdfBillSource }>;
    batchId?: string | null;
    contentType?: string;
    /** The name a phase is proposed from, where it is not `filename` (a PDF bill). */
    phaseFilename?: string;
    /** The browser's id for this press, so a retried request returns this run (trap 4). */
    registrationRequestId?: string | null;
    /** The part of the file this bill is (open intake), stored on the run; null for the whole file. */
    part?: SourcePart | null;
    /** The workbook's sheets, where the caller has already read them to check the part. */
    sheets?: Awaited<ReturnType<typeof readSpreadsheetSheets>>;
  } = {},
): Promise<Response> {
  const requestId = options.registrationRequestId ?? null;
  const part = options.part ?? null;
  // THE ATTACHMENTS AND THE RUN ARE ONE WRITE. They were separate statements,
  // so a failure between them left an attachment row no run named — a stored
  // bill no screen can reach — and the next upload of the same file made a
  // second one. Only the inserts are inside: the parse and the row pictures
  // (Blob I/O) run after the commit, and a failure there marks THIS run
  // failed, which is a state the Documents tab shows.
  let runId: string;
  let pdfSource: PdfBillSource | undefined;
  let reused: EarlierBill | null = null;
  try {
    ({ runId, pdfSource, reused } = await withTransaction(async (txn) => {
      const earlier = await billRegisteredBefore(requestId, txn);
      if (earlier) return { runId: earlier.id, pdfSource: undefined, reused: earlier };
      const attached = options.attach ? await options.attach(txn) : null;
      const run = await txn`
        insert into intake_runs
          (project_id, attachment_id, batch_id, source_kind, status,
           registration_request_id, source_part, created_by, updated_by)
        values (${projectId}, ${attached?.attachmentId ?? null}, ${options.batchId ?? null}, 'boq_xlsx', 'parsing',
                ${requestId}, ${part ? JSON.stringify(part) : null}::jsonb, ${actor}, ${actor})
        returning id
      `;
      return { runId: recordedId(run), pdfSource: attached?.pdfSource, reused: null as EarlierBill | null };
    }));
  } catch (cause) {
    return replayOrFailure(requestId, cause);
  }
  if (reused) return replayAnswer(reused);

  // Terminal vs retryable is decided per step, not by one outer try/catch. A
  // file that is not a spreadsheet never becomes one, so it is terminal and
  // says why. A spreadsheet whose COLUMNS nobody recognised is not: since 0040
  // it stages `needsColumns` and the review asks a person to map it.
  try {
    const sheets = options.sheets ?? (await readSpreadsheetSheets(bytes, filename, options.contentType ?? ""));
    const parsed = parseBoqSheets(sheets, await loadBoqReadingRegisters(sql), { part });
    // ONLY AN EMPTY WORKBOOK IS REFUSED NOW. A workbook no heading could be
    // read on comes back `ok: false` with every sheet staged as needing its
    // columns, and is PARSED, not failed: the refusal was a dead end — the
    // Documents tab's Try again posted to /extract, which refuses a bill — and
    // the sentence it carried is now the Columns panel's explanation.
    if (!parsed.sheets || parsed.sheets.length === 0) {
      const error = parsed.ok ? "The file has no sheets." : parsed.error;
      await fail(runId, actor, error);
      return json({ ok: false, error, importId: runId }, 422);
    }

    // Suggest a category, a level and the not-furniture question now, at parse
    // time, and STORE them — see src/lib/boq-stage.ts for why, and for why the
    // re-read from the stored source runs the same function.
    const suggest = await loadLineSuggester(sql);
    const stagedSheets = proposePhaseNames(
      parsed.sheets.map((sheet) => stageSheet(sheet, suggest)),
      options.phaseFilename ?? filename,
    );
    const lineCount = stagedSheets.reduce((total, sheet) => total + (sheet.ignored ? 0 : sheet.lines.length), 0);
    const skippedRows = parsed.sheets.reduce((total, sheet) => total + sheet.skippedRows, 0);
    const needsColumns = stagedSheets.filter((sheet) => sheet.needsColumns && !sheet.ignored).length;

    // THE PICTURES ON ITS ROWS, read and stored now so the review can show
    // each line's and the confirm can give a record with none this one
    // (`bill-images.ts`). Only from a workbook whose original is KEPT — a bill
    // posted straight here has no stored source for a picture to sit beside —
    // and never at the cost of the bill: a failure is a sentence, not a refusal.
    // A workbook built from a PDF's text holds no pictures — they are not
    // cells — and the review says so beside the PDF link.
    const pictures =
      sourcePreserved && !pdfSource && intakeSourceKind(filename, options.contentType ?? "") === "xlsx"
        ? await stageBillRowImages(bytes, { projectId, runId })
        : null;

    await sql`
      update intake_runs
      set status = 'parsed',
          parsed = ${JSON.stringify({
            schemaVersion: BOQ_SCHEMA_VERSION,
            filename,
            sourcePreserved,
            sheets: stagedSheets,
            ...(pictures ? { rowImages: pictures.rowImages, rowImagesNote: pictures.rowImagesNote } : {}),
            ...(pdfSource ? { pdfSource } : {}),
          })}::jsonb,
          updated_by = ${actor}
      where id = ${runId}
    `;
    return json(
      {
        ok: true,
        importId: runId,
        lines: lineCount,
        sheets: stagedSheets.length,
        skippedRows,
        sourcePreserved,
        // How many live sheets are waiting for a person to say which column is
        // which. Not an error: the upload screen links to the review either way.
        needsColumns,
      },
      201,
    );
  } catch (cause) {
    // A sentence the reader wrote ("That file is not a spreadsheet…") is the
    // answer and passes through; a driver's or a library's text does not reach
    // the screen or `intake_runs.error` (audit A12), only the log.
    const message = explainFailure("This bill could not be read.", cause, "bill-parse");
    await fail(runId, actor, message);
    return json({ ok: false, error: message, importId: runId }, 500);
  }
}

/** The id an insert's `returning id` gave back; a missing row rolls the transaction back. */
function recordedId(rows: Row[]): string {
  if (!rows[0]) throw new Error("the row was not recorded");
  return String(rows[0].id);
}

async function fail(runId: string, actor: string, error: string): Promise<void> {
  await sql`update intake_runs set status = 'failed', error = ${error}, updated_by = ${actor} where id = ${runId}`;
}
