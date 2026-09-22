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
// model has ever been involved in it.
// ============================================================================
//
// Why not @vercel/blob's onUploadCompleted callback: it is an inbound webhook
// from Vercel, so it never fires against localhost. Building the only write
// path on something that cannot run in development would mean the import could
// not be tested end to end without a tunnel.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readSpreadsheetSheets, pdfHasTextLayer } from "@/lib/intake-source";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind, outlookMsgAdvice, spreadsheetRefusal } from "@/lib/intake-source-types";
import { scannedPdfRefusal } from "@/lib/document-classify";
import { parseBoqSheets, BOQ_SCHEMA_VERSION } from "@/lib/boq-import";
import { matchName, type MatchCandidate } from "@/lib/matching";
import { guessLevelFromBill } from "@/lib/level-guess";
import { guessNonFurniture } from "@/lib/non-furniture-guess";
import { DOCUMENT_KINDS } from "@/lib/spec-vocab";
import { headTrustedBlob, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { takeReadSlot, deferRead, WAITING_FOR_SLOT_MESSAGE } from "@/lib/extraction-slots";
import { recordMessage } from "@/lib/email-ingest";
import { assignMessage } from "@/lib/email-registration";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";

export const maxDuration = 60;

const MAX_DIRECT_BYTES = 4 * 1024 * 1024; // below the serverless request-body ceiling
const MAX_BOQ_BYTES = 30 * 1024 * 1024;

// Below the 30MB storage cap on purpose. Base64 expands a PDF by about a third
// and Anthropic's total request ceiling is 32MB, so a 24MB PDF blows the request
// before a single page of it is read. Rejecting it here, at registration, costs
// nothing; discovering it in the worker costs an attempt.
const MAX_MODEL_PDF_BYTES = 20 * 1024 * 1024;

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
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

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
    const recorded = await recordMessage({
      mailbox: "upload",
      origin: "upload",
      bytes: blob.bytes,
      storagePath: blob.pathname,
      mimeSize: blob.size,
      actor,
      intendedProjectId: input.projectId,
    });

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
  }

  try {
    const result = await withTransaction(async (txn) => {
      // The idempotency check and the insert in one transaction, so two
      // deliveries of the same retried request cannot both insert.
      if (input.registrationRequestId) {
        const existing = await txn`
          select id, status from intake_runs where registration_request_id = ${input.registrationRequestId}
        `;
        if (existing[0]) return { importId: String(existing[0].id), reused: true as const };
      }

      const attachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${input.projectId}, 'spec_document', ${meta.pathname}, ${input.filename},
                ${meta.contentType || input.contentType || null}, ${meta.size}, ${actor})
        returning id
      `;
      if (!attachment[0]) throw new Error("the attachment was not recorded");

      const run = await txn`
        insert into intake_runs
          (project_id, attachment_id, batch_id, source_kind, document_kind, status,
           registration_request_id, created_by, updated_by)
        values (${input.projectId}, ${attachment[0].id}, ${input.batchId ?? null}, 'spec_document',
                ${input.documentKind}, 'pending', ${input.registrationRequestId ?? null}, ${actor}, ${actor})
        returning id
      `;
      if (!run[0]) throw new Error("the import was not recorded");

      // AT MOST THREE OF ONE PACK ARE READ AT ONCE. Over the cap the document
      // is still stored and still registered — it is marked as a read that has
      // been promised and not started, and the worker that frees a slot starts
      // it. Refusing the upload instead would tell somebody their file did not
      // arrive when it did.
      const scope = { projectId: input.projectId, batchId: input.batchId ?? null };
      if (!(await takeReadSlot(txn, scope))) {
        await deferRead(txn, String(run[0].id), actor);
        return { importId: String(run[0].id), attemptId: null, reused: false as const };
      }

      // The attempt is opened in the SAME transaction as the insert, so a run
      // can never be committed at `pending` with a message already published
      // against it. The publish itself is below, after the commit.
      const attemptId = randomUUID();
      const opened = await openAttempt(txn, String(run[0].id), attemptId, actor, "pending");
      if (!opened) throw new Error("the import was recorded but could not be queued for reading");
      return { importId: String(run[0].id), attemptId: opened, reused: false as const };
    });

    // A REPLAYED registration must not open a second attempt. It returns the
    // run it already made, whose read was dispatched the first time round;
    // publishing again here would be a duplicate whose only effect is to spend
    // one of four deliveries.
    if (result.reused) {
      return json({ ok: true, importId: result.importId, reused: true, sourcePreserved: true }, 200);
    }

    // Deferred by the cap. Nothing to publish; the document is registered and
    // is read when one of the three in flight finishes.
    //
    // `waiting` and NOT `error`, though both mean "dispatched: false". The
    // upload screen paints an error red, and this is the ordinary outcome for
    // eight documents of an eleven-document pack — eight red rows for a pack
    // that is working correctly is the lesson about painting a blocked thing
    // red, applied to an upload.
    if (!result.attemptId) {
      return json(
        {
          ok: true,
          importId: result.importId,
          reused: false,
          sourcePreserved: true,
          autoRead: { dispatched: false, waiting: true, note: WAITING_FOR_SLOT_MESSAGE },
        },
        201,
      );
    }

    // Committed. Now publish — outside the transaction, because a queue publish
    // is network I/O and a transaction must never be held across it.
    const failure = await publishAttempt(result.importId, result.attemptId, actor);

    // 201 EITHER WAY. The document is stored and registered; whether its read
    // reached the queue is a separate fact about the run, recorded on the run,
    // and the screens already offer the retry it needs. Failing the upload over
    // it would tell somebody their file did not arrive when it did.
    return json(
      {
        ok: true,
        importId: result.importId,
        reused: false,
        sourcePreserved: true,
        autoRead: failure
          ? { dispatched: false, code: failure.code, error: failure.error }
          : { dispatched: true },
      },
      201,
    );
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}

// ---- BOQ, uploaded to the blob store ---------------------------------------
async function registerBlobBoq(input: Registered, actor: string): Promise<Response> {
  // A BOQ is a grid, and a client exports that grid as .xlsx or as .csv. The
  // DECLARED import type is what says this file is a bill; the extension only
  // says how to read its bytes. A PDF still cannot be one — it has no cells.
  const kind = intakeSourceKind(input.filename, input.contentType);
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

  const attachment = await sql`
    insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
    values ('project', ${input.projectId}, 'boq', ${blob.pathname}, ${input.filename},
            ${blob.contentType || input.contentType || null}, ${blob.size}, ${actor})
    returning id
  `;

  return parseBoqInto(input.projectId, String(attachment[0]?.id), input.filename, blob.bytes, actor, true, {
    batchId: input.batchId ?? null,
    contentType: blob.contentType || input.contentType || "",
  });
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
  return parseBoqInto(projectId, null, file.name, bytes, actor, false);
}

// ---- the shared BOQ parse --------------------------------------------------
async function parseBoqInto(
  projectId: string,
  attachmentId: string | null,
  filename: string,
  bytes: Buffer,
  actor: string,
  sourcePreserved: boolean,
  options: { batchId?: string | null; contentType?: string } = {},
): Promise<Response> {
  const run = await sql`
    insert into intake_runs (project_id, attachment_id, batch_id, source_kind, status, created_by, updated_by)
    values (${projectId}, ${attachmentId}, ${options.batchId ?? null}, 'boq_xlsx', 'parsing', ${actor}, ${actor})
    returning id
  `;
  const runId = String(run[0]?.id);

  // Terminal vs retryable is decided per step, not by one outer try/catch. A
  // spreadsheet that will not parse never becomes parseable, so it is terminal
  // and says why.
  try {
    const sheets = await readSpreadsheetSheets(bytes, filename, options.contentType ?? "");
    const parsed = parseBoqSheets(sheets);
    if (!parsed.ok) {
      await fail(runId, actor, parsed.error);
      return json({ ok: false, error: parsed.error, importId: runId }, 422);
    }

    // Suggest a category now, at parse time, and STORE the suggestion. It has
    // to be stored rather than recomputed on each read, because confirm writes
    // what is stored — and the rule is that what gets written is what the
    // reviewer approved, not what a fresh match would produce later.
    //
    // Candidates are the category names plus the BOQ vocabulary in
    // item_category_aliases: a BOQ says "Sofa" and the sheet is called
    // "Armchairs, Benches, Stools, Sofas", which share no word.
    const categories = await sql`select id, name from item_categories`;
    const aliases = await sql`select category_id, term from item_category_aliases`;
    const candidates: MatchCandidate[] = [
      ...categories.map((c) => ({ id: String(c.id), name: String(c.name) })),
      ...aliases.map((a) => ({ id: String(a.category_id), name: String(a.term) })),
    ];

    // The LEVEL, guessed the same way and for the same reason: stored at parse
    // time so the confirm writes what the reviewer saw. Unlike the category it
    // is never written straight into the column the gate reads — a guessed
    // level lands in `level_suggested` unless the reviewer picks one. See
    // src/lib/level-guess.ts for what it reads, and what it refuses to.
    type SuggestInput = { itemDescription: string; productReference?: string | null; code?: string | null };

    const levelOf = (line: SuggestInput, categoryStatus: string) => {
      const guess = guessLevelFromBill({ ...line, categoryStatus });
      return guess
        ? { level: guess.level, levelStatus: "suggested" as const, levelReason: guess.reason }
        : { level: null, levelStatus: "suggested" as const, levelReason: null };
    };

    // IS THIS A PIECE OF FURNITURE AT ALL? Asked at staging and STORED, like
    // the category and the level, so the reviewer reads one answer rather than
    // one per render. It is a question and nothing else: only the reviewer's
    // click writes `ignored`, which is the only field the confirm reads.
    //
    // The CATEGORY is worked out first, because "nothing matched a category
    // either" is supporting evidence the suggester is allowed to append — and
    // never to fire on. And the level is worked out LAST, because a line this
    // suggests is not furniture gets no level at all.
    const suggest = (line: SuggestInput, index: number) => {
      const match = matchName(line.itemDescription, candidates);
      const decided = (
        categoryId: string | null,
        categoryStatus: string,
        extra: Record<string, unknown> = {},
      ) => ({
        index,
        ...line,
        ...levelOf(line, categoryStatus),
        nonFurnitureSuggested: guessNonFurniture({ ...line, categoryStatus }),
        categoryId,
        categoryStatus,
        ignored: false,
        ...extra,
      });

      if (match.status === "confident") return decided(match.id, "suggested");
      if (match.status === "ambiguous") {
        // Several terms pointing at ONE category is agreement, not ambiguity.
        const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
        if (ids.length === 1) return decided(ids[0] ?? null, "suggested");
        return decided(null, "ambiguous", {
          categoryCandidates: ids.map((id) => ({
            id, name: String(categories.find((c) => String(c.id) === id)?.name ?? id),
          })),
        });
      }
      return decided(null, "none");
    };

    // v2: every sheet with a header, each becoming a run at confirm. The line
    // index is per sheet, so a PATCH addresses ['sheets', s, 'lines', i].
    const stagedSheets = parsed.sheets.map((sheet) => ({
      ...sheet,
      lines: sheet.lines.map(suggest),
    }));
    const lineCount = stagedSheets.reduce((total, sheet) => total + (sheet.ignored ? 0 : sheet.lines.length), 0);
    const skippedRows = parsed.sheets.reduce((total, sheet) => total + sheet.skippedRows, 0);

    await sql`
      update intake_runs
      set status = 'parsed',
          parsed = ${JSON.stringify({
            schemaVersion: BOQ_SCHEMA_VERSION,
            filename,
            sourcePreserved,
            sheets: stagedSheets,
          })}::jsonb,
          updated_by = ${actor}
      where id = ${runId}
    `;
    return json(
      { ok: true, importId: runId, lines: lineCount, sheets: stagedSheets.length, skippedRows, sourcePreserved },
      201,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await fail(runId, actor, message);
    return json({ ok: false, error: message, importId: runId }, 500);
  }
}

async function fail(runId: string, actor: string, error: string): Promise<void> {
  await sql`update intake_runs set status = 'failed', error = ${error}, updated_by = ${actor} where id = ${runId}`;
}
