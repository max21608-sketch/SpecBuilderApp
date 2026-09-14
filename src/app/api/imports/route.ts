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
// REGISTRATION READS NO DOCUMENT BODY and spends nothing. Pressing Extract on
// the review screen is the click that costs money, and it is a separate,
// deliberate act.
//
// Why not @vercel/blob's onUploadCompleted callback: it is an inbound webhook
// from Vercel, so it never fires against localhost. Building the only write
// path on something that cannot run in development would mean the import could
// not be tested end to end without a tunnel.
import { z } from "zod";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind } from "@/lib/intake-source-types";
import { parseBoqSheets } from "@/lib/boq-import";
import { matchName, type MatchCandidate } from "@/lib/matching";
import { DOCUMENT_KINDS } from "@/lib/spec-vocab";
import { headTrustedBlob, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
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

  if (input.importType === "spec_document") return registerSpecDocument(input, user.email);
  return registerBlobBoq(input, user.email);
}

type Registered = z.infer<typeof Registration>;

// ---- specification document ------------------------------------------------
// Registration only. No body is read, no model is called, no money is spent.
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

  try {
    const result = await withTransaction(async (txn) => {
      // The idempotency check and the insert in one transaction, so two
      // deliveries of the same retried request cannot both insert.
      if (input.registrationRequestId) {
        const existing = await txn`
          select id, status from intake_runs where registration_request_id = ${input.registrationRequestId}
        `;
        if (existing[0]) return { importId: String(existing[0].id), reused: true };
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
      return { importId: String(run[0].id), reused: false };
    });

    return json({ ok: true, importId: result.importId, reused: result.reused, sourcePreserved: true }, result.reused ? 200 : 201);
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
    return json(
      { ok: false, error: `A bill of quantities is read from a spreadsheet. "${input.filename}" is ${kind === "unsupported" ? "not a supported file" : `a .${kind} file`}.` },
      400,
    );
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
    return json(
      { ok: false, error: `A bill of quantities is read from a spreadsheet. "${file.name}" is ${kind === "unsupported" ? "not a supported file" : `a .${kind} file`}.` },
      400,
    );
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

    const suggest = (line: { itemDescription: string }, index: number) => {
      const match = matchName(line.itemDescription, candidates);
      if (match.status === "confident") {
        return { index, ...line, categoryId: match.id, categoryStatus: "suggested", ignored: false };
      }
      if (match.status === "ambiguous") {
        // Several terms pointing at ONE category is agreement, not ambiguity.
        const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
        if (ids.length === 1) {
          return { index, ...line, categoryId: ids[0] ?? null, categoryStatus: "suggested", ignored: false };
        }
        return {
          index, ...line, categoryId: null, categoryStatus: "ambiguous", ignored: false,
          categoryCandidates: ids.map((id) => ({
            id, name: String(categories.find((c) => String(c.id) === id)?.name ?? id),
          })),
        };
      }
      return { index, ...line, categoryId: null, categoryStatus: "none", ignored: false };
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
            schemaVersion: 2,
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
