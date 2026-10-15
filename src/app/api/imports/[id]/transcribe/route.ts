// The model TRANSCRIBES a PDF bill that code could not read (workstream C2).
//
// ============================================================================
// THE ONE EXCEPTION, APPROVED IN WRITING. Max, 2026-10-15: "a PDF bill with
// no usable text layer may be transcribed by the model, every line marked
// transcribed with its page and checked by a person." Registration
// (`registerPdfBoq`) lands a bill here only where C1's code reader could not
// put the PDF's text back into a grid — a scan, a laid-out sheet — and stages
// it as WAITING. Nothing else in the app sends a bill's cells to a model.
//
// CALLED AUTOMATICALLY ONCE, the first time the review opens a waiting bill,
// and again only when a person presses "Transcribe again" after a failure: the
// upload row already said this read is charged, the way registering a
// specification document is. A pass over the whole PDF in page windows
// (`pdf-bill-transcribe.ts`), so this route's ceiling is the worker's, 800 s.
//
// THE REPLAY GUARD IS `suggest-columns`' own: the run's version, claimed
// before the call, and a request id, so a second tab or a retried request is
// answered from the record and never read twice. A claim older than the
// model's deadline is taken to be dead.
//
// WHAT LANDS is an ordinary staged bill: the transcription is written into a
// workbook STORED BESIDE THE PDF, which becomes the run's source, and the
// sheet is read back out of it by the same reader as any uploaded .xlsx —
// synonyms, a layout, the Columns panel, the model's structure read. The PDF
// stays its own attachment (`pdfSource`), each line keeps its page, and
// `pdfTranscription` says every line was transcribed and holds what the
// cross-checks need. The confirm is unchanged.
//
// The PDF is read, and the model called, OUTSIDE any transaction.
// ============================================================================
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { assertBoqDocument, BOQ_SCHEMA_VERSION, type BoqDocument } from "@/lib/boq-import";
import { loadBoqRun } from "@/lib/boq-run-source";
import { loadBoqReadingRegisters, loadLineSuggester } from "@/lib/boq-stage";
import { blobPathname, readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { blobPictureStore } from "@/lib/bill-images";
import { countPdfPages } from "@/lib/intake-source";
import { PDF_BILL_SHEET, pdfTextItems } from "@/lib/pdf-bill";
import {
  stageTranscribedBill,
  transcribePdfBill,
  TRANSCRIBE_MODEL,
} from "@/lib/pdf-bill-transcribe";
import { TRANSCRIPTION_CLAIM_MS, type PdfTranscription, type TranscriptionRecord } from "@/lib/pdf-bill-checks";

export const maxDuration = 800;

const MAX_PDF_BYTES = 30 * 1024 * 1024;
/** Per page, the text kept for the code check. A table page is a few thousand characters. */
const MAX_PAGE_TEXT = 20_000;
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Beside the PDF's own name, the way C1's `(read from PDF).xlsx` is: every list naming the run says where it came from. */
const TRANSCRIBED_WORKBOOK_SUFFIX = " (transcribed from PDF).xlsx";

const Body = z
  .object({
    version: z.number().int().nonnegative(),
    /** Generated once per press by the browser, so a retried request is answered, not re-read. */
    requestId: z.string().uuid(),
  })
  .strict();

/** A claim older than this is a request that died. The leaf's literal is held to it by a test. */
const CLAIM_EXPIRES_MS = TRANSCRIPTION_CLAIM_MS;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const body = Body.safeParse(raw);
  if (!body.success) return json({ ok: false, error: body.error.issues[0]?.message ?? "That request is not valid." }, 400);

  const run = await loadBoqRun(id);
  if (!run) return json({ ok: false, error: "No such import." }, 404);
  if (run.sourceKind !== "boq_xlsx") return json({ ok: false, code: "wrong_kind", error: "Only a bill can be transcribed." }, 400);
  if (run.status !== "parsed") return json({ ok: false, error: `This bill is ${run.status}; it can no longer be transcribed.` }, 409);

  const staged = assertBoqDocument(run.parsed);
  const waiting = staged.pdfTranscription;
  if (!waiting || !staged.pdfSource) {
    return json({ ok: false, code: "not_transcribable", error: "This bill was not held for transcription: it was read by code." }, 400);
  }

  const metaRows = await sql`select model_metadata from intake_runs where id = ${id}`;
  const record = ((metaRows[0]?.model_metadata as { transcription?: TranscriptionRecord } | null)?.transcription ?? {}) as TranscriptionRecord;
  if (record.lastRequestId === body.data.requestId) {
    return json({ ok: true, replayed: true, version: run.version, outcome: record.outcome ?? null });
  }
  // Transcribed already: the automatic call lands here on every later visit, and it costs nothing.
  if (waiting.state === "done") return json({ ok: true, nothing: true, version: run.version, outcome: record.outcome ?? null });
  const pendingFresh = record.pending && Date.now() - new Date(record.pending.at).getTime() < CLAIM_EXPIRES_MS ? record.pending : null;
  if (pendingFresh) {
    return json(
      {
        ok: false,
        code: "transcription_running",
        error: "This PDF is being transcribed already — in another tab, or a moment ago. This screen shows the result when it lands; nothing more is charged.",
      },
      409,
    );
  }
  if (run.version !== body.data.version) {
    return json({ ok: false, code: "import_version_stale", error: "This bill changed since the screen loaded. Reload before transcribing it." }, 409);
  }

  // THE CLAIM, under the version the screen saw.
  const claimAt = new Date().toISOString();
  const claimed = await sql`
    update intake_runs
    set model_metadata = jsonb_set(
          coalesce(model_metadata, '{}'::jsonb),
          array['transcription'],
          coalesce(model_metadata->'transcription', '{}'::jsonb)
            || jsonb_build_object('pending', ${JSON.stringify({ requestId: body.data.requestId, at: claimAt })}::jsonb)
        ),
        updated_by = ${user.email}
    where id = ${id} and version = ${body.data.version} and status = 'parsed'
    returning version
  `;
  if (!claimed[0]) {
    return json({ ok: false, code: "transcription_running", error: "Someone else started transcribing this PDF a moment ago. Reload to see the result; nothing more is charged." }, 409);
  }
  const claimVersion = Number(claimed[0].version);

  // The PDF, by the run's OWN attachment row — never by anything the request names.
  let pdf: { bytes: Buffer; pathname: string };
  try {
    const rows = await sql`select storage_path from attachments where id = ${staged.pdfSource.attachmentId}`;
    const path = rows[0]?.storage_path;
    if (!path) throw new DomainConflictError("source_not_kept", "The PDF of this bill is no longer stored. Upload it again.", { status: 409 });
    const blob = await readTrustedBlob(blobPathname(String(path)), run.projectId, { maxBytes: MAX_PDF_BYTES });
    pdf = { bytes: blob.bytes, pathname: blob.pathname };
  } catch (cause) {
    await release(id, user.email, {});
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 409);
    return transactionErrorResponse(cause);
  }

  // The PDF's own text, page by page, for the code check — and its page count.
  let pageText: (string | null)[] = [];
  let pageCount = countPdfPages(pdf.bytes);
  try {
    const pages = await pdfTextItems(new Uint8Array(pdf.bytes));
    pageCount = pages.length;
    pageText = pages.map((items) => {
      const text = items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();
      return text ? text.slice(0, MAX_PAGE_TEXT) : null;
    });
  } catch {
    // A PDF pdfjs cannot open still has pages the model can read; the code check says it could not run.
  }

  const result = await transcribePdfBill({ base64: pdf.bytes.toString("base64"), pageCount: pageCount ?? 0 });
  const at = new Date().toISOString();
  const calls = result.calls.map((call) => ({ ...call, at }));

  if (!result.ok) {
    await release(id, user.email, {
      calls,
      outcome: { at, ok: false, text: result.error, charged: result.charged },
    });
    return json({ ok: false, error: result.error, charged: result.charged, retryable: result.retryable }, 502);
  }

  const transcription = result.transcription;
  const model = calls.find((call) => call.model)?.model ?? TRANSCRIBE_MODEL;
  try {
    const registers = await loadBoqReadingRegisters(sql);
    const suggest = await loadLineSuggester(sql);
    const stagedBill = await stageTranscribedBill({
      transcription,
      sheetName: PDF_BILL_SHEET,
      pdfFilename: staged.pdfSource.filename,
      registers,
      suggest,
    });
    const lineCount = stagedBill.sheets.reduce((total, sheet) => total + (sheet.ignored ? 0 : sheet.lines.length), 0);

    // THE WORKBOOK, BESIDE THE PDF. Stored before the run points at it.
    const workbookPathname = `${pdf.pathname.replace(/\.pdf$/i, "")}${TRANSCRIBED_WORKBOOK_SUFFIX}`;
    const workbookFilename = `${staged.pdfSource.filename.replace(/\.pdf$/i, "")}${TRANSCRIBED_WORKBOOK_SUFFIX}`;
    await blobPictureStore(workbookPathname, stagedBill.workbook, XLSX_CONTENT_TYPE);

    const done: PdfTranscription = {
      state: "done",
      reason: waiting.reason,
      pageCount: pageCount ?? null,
      model,
      at,
      totals: transcription.totals,
      pageText,
      rowUnclear: stagedBill.sheet.rowUnclear,
      notes: [...(transcription.notABill ? [`The model read this as not a bill: ${transcription.notABill}`] : []), ...transcription.notes],
    };
    const fresh: BoqDocument = {
      ...staged,
      schemaVersion: BOQ_SCHEMA_VERSION,
      filename: workbookFilename,
      sourcePreserved: true,
      sheets: stagedBill.sheets,
      pdfSource: { ...staged.pdfSource, sheet: PDF_BILL_SHEET, firstRow: stagedBill.sheet.firstRow, pages: stagedBill.sheet.pages },
      pdfTranscription: done,
    };
    const outcomeText = transcription.notABill && lineCount === 0
      ? `The model read this PDF as not a bill: ${transcription.notABill}`
      : `Transcribed by the model: ${lineCount} line${lineCount === 1 ? "" : "s"} over ${pageCount ?? "?"} page${pageCount === 1 ? "" : "s"}. Check every line against its page.`;

    const applied = await withTransaction(async (txn) => {
      const attachment = await txn`
        insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values ('project', ${run.projectId}, 'boq', ${workbookPathname}, ${workbookFilename}, ${XLSX_CONTENT_TYPE}, ${stagedBill.workbook.length}, ${user.email})
        returning id
      `;
      const nextRecord: TranscriptionRecord = {
        ...record,
        pending: null,
        lastRequestId: body.data.requestId,
        model,
        outcome: { at, ok: true, text: outcomeText, charged: true },
        calls: [...(record.calls ?? []), ...calls],
      };
      // FENCED ON THE CLAIM: nothing else may have written the staged bill since.
      const rows = await txn`
        update intake_runs
        set parsed = ${JSON.stringify(fresh)}::jsonb,
            attachment_id = ${String(attachment[0]?.id)},
            model = ${model},
            raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('transcription', ${JSON.stringify(result.raw)}::jsonb),
            model_metadata = jsonb_set(coalesce(model_metadata, '{}'::jsonb), array['transcription'], ${JSON.stringify(nextRecord)}::jsonb),
            updated_by = ${user.email}
        where id = ${id} and version = ${claimVersion} and status = 'parsed'
        returning version
      `;
      if (!rows[0]) throw new DomainConflictError("import_version_stale", "The bill changed while the PDF was being transcribed, so the transcription was not applied over that change. Reload, and transcribe again if you still want it.", { status: 409 });
      return { version: Number(rows[0].version) };
    });
    return json({ ok: true, version: applied.version, lines: lineCount, outcome: outcomeText, charged: calls.length });
  } catch (cause) {
    await release(id, user.email, { calls, outcome: { at, ok: false, text: cause instanceof Error ? cause.message : String(cause), charged: true } });
    return transactionErrorResponse(cause);
  }
}

/** Clear a claim that will not complete, keeping the record of any call that was paid for. */
async function release(
  id: string,
  actor: string,
  extra: { calls?: TranscriptionRecord["calls"]; outcome?: TranscriptionRecord["outcome"] },
): Promise<void> {
  await sql`
    update intake_runs
    set model_metadata = jsonb_set(
          coalesce(model_metadata, '{}'::jsonb),
          array['transcription'],
          coalesce(model_metadata->'transcription', '{}'::jsonb)
            || jsonb_build_object('pending', null)
            || ${JSON.stringify(extra.outcome !== undefined ? { outcome: extra.outcome } : {})}::jsonb
            || jsonb_build_object('calls', coalesce(model_metadata->'transcription'->'calls', '[]'::jsonb) || ${JSON.stringify(extra.calls ?? [])}::jsonb)
        ),
        updated_by = ${actor}
    where id = ${id}
  `;
}
