// Reading an uploaded document. Runs on the queue, not in the request.
//
// This body belongs here rather than in the route because the model call takes
// minutes: the route only enqueues, and this runs in the queue consumer where
// nothing is holding a connection open.
//
// Nothing operational is written -- the result is STAGED for review.
//
// ============================================================================
// WHAT THROWS AND WHAT DOES NOT is the load-bearing distinction in this file,
// because the caller is a queue that retries on a throw:
//
//   - a model refusal or a schema failure is TERMINAL. It writes 'failed' and
//     returns. Retrying buys the same refusal at full price.
//   - a wrong file type is terminal too: retrying cannot make it a spreadsheet.
//   - an infrastructure fault (blob 5xx, DB error) RELEASES the claim and
//     throws, so the delivery is retried. Releasing matters: the retry backoff
//     is far shorter than STALE_CLAIM_MINUTES, so a row left at 'processing'
//     would make every retry a silent no-op.
//
// Do NOT wrap this function in one outer try/catch. A release has to throw
// past the step that raised it; an outer catch converts it back into a
// terminal failure and deletes the retry, invisibly.
// ============================================================================
import { sql } from "@/lib/db";
import { prepareDocumentSource } from "@/lib/intake-source";
import { STALE_CLAIM_MINUTES, type ExtractionRunOutcome } from "@/lib/extraction-claim";

// M2: `document_extractions` is the table holding staged extractions.
// Rename it throughout this file if the app calls it something else -- it is
// written out literally in each statement because a tagged template cannot
// parameterise an identifier. The table needs at least:
//   id, attachment_id, status, processing_started_at, error,
//   model, raw_response jsonb, extracted jsonb, updated_by

export async function runDocumentExtraction(
  { extractionId, actor }: { extractionId: string; actor: string },
): Promise<ExtractionRunOutcome> {
  // Claim it in ONE predicated statement: `returning` proves this invocation,
  // and only this one, owns the run. A read-then-write let two deliveries both
  // believe they had it, and both billed a full model run.
  const claimed = await sql`
    update document_extractions
    set status = 'processing', processing_started_at = now(), error = null, updated_by = ${actor}
    where id = ${extractionId}
      and (
        status in ('queued', 'pending', 'failed')
        or (status = 'processing' and processing_started_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
      )
    returning id, attachment_id
  `;
  if (!claimed[0]) {
    const existing = await sql`select status from document_extractions where id = ${extractionId}`;
    if (!existing[0]) return { outcome: "skipped", reason: "extraction not found" };
    return { outcome: "skipped", reason: `already ${String(existing[0].status)}` };
  }

  let attachment: Record<string, unknown> | undefined;
  try {
    const attachments = await sql`
      select storage_path, filename, content_type from attachments where id = ${claimed[0].attachment_id}
    `;
    attachment = attachments[0];
  } catch (cause) {
    return await releaseAndThrow(extractionId, actor, message(cause));
  }
  if (!attachment) return await fail(extractionId, actor, "the uploaded document could not be found");

  // The blob store is PRIVATE: a server-side read needs the token as a bearer
  // header. Possession of the URL is not access.
  let blob: Response;
  try {
    blob = await fetch(String(attachment.storage_path), {
      headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
  } catch (cause) {
    return await releaseAndThrow(extractionId, actor, message(cause));
  }
  if (!blob.ok) {
    const detail = `could not read the uploaded document (${blob.status})`;
    // A 5xx is the blob store having a bad moment; a 4xx will say the same
    // thing on every retry.
    if (blob.status >= 500) return await releaseAndThrow(extractionId, actor, detail);
    return await fail(extractionId, actor, detail);
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  // Parsing is deterministic: a file that will not parse parses no better on
  // the fourth attempt.
  let source: Awaited<ReturnType<typeof prepareDocumentSource>>;
  try {
    source = await prepareDocumentSource(bytes, String(attachment.filename), String(attachment.content_type ?? ""));
  } catch (cause) {
    return await fail(extractionId, actor, message(cause));
  }

  // M2: the model call. It must return a discriminated result
  // ({ ok: true, output, model, rawResponse } | { ok: false, error }) rather
  // than throwing on a refusal, so this function can tell a refusal (terminal)
  // from a socket error (retryable).
  //
  //   let result: Awaited<ReturnType<typeof extractSomething>>;
  //   try {
  //     result = await extractSomething(source);
  //   } catch (cause) {
  //     // The call itself fell over -- a socket, a 5xx, a timeout. Retry.
  //     return await releaseAndThrow(extractionId, actor, message(cause));
  //   }
  //   if (!result.ok) return await fail(extractionId, actor, result.error);
  //
  // M2: then resolve against this app's OWN registers and vocabularies
  // here -- deterministically, in code, not in the prompt. The model reads;
  // it does not decide. Anything unresolvable becomes a visible flag, never a
  // plausible-looking guess.
  void source;
  return await fail(extractionId, actor, "extraction is not implemented yet");

  // The staging write, once the above is filled in:
  //
  //   try {
  //     await sql`
  //       update document_extractions
  //       set status = 'extracted', model = ${result.model}, error = null,
  //           processing_started_at = null,
  //           raw_response = ${JSON.stringify(result.rawResponse)}::jsonb,
  //           extracted = ${JSON.stringify(resolved)}::jsonb,
  //           updated_by = ${actor}
  //       where id = ${extractionId}
  //     `;
  //     return { outcome: "extracted" };
  //   } catch (cause) {
  //     // The model run is already paid for, so releasing re-runs it. That is
  //     // still the right trade against leaving a stuck row: everything here
  //     // is a DB fault, which means nothing was written either.
  //     return await releaseAndThrow(extractionId, actor, message(cause));
  //   }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// Terminal: this will not come out differently on another attempt.
async function fail(extractionId: string, actor: string, error: string): Promise<ExtractionRunOutcome> {
  await sql`
    update document_extractions
    set status = 'failed', error = ${error}, processing_started_at = null, updated_by = ${actor}
    where id = ${extractionId}
  `;
  return { outcome: "failed", error };
}

// Retryable: hand the row back so the next delivery can claim it, THEN let the
// queue see the failure. The order matters — throwing first leaves the row
// claimed and every retry becomes a no-op.
async function releaseAndThrow(extractionId: string, actor: string, error: string): Promise<never> {
  await sql`
    update document_extractions
    set status = 'queued', error = ${error}, processing_started_at = null, updated_by = ${actor}
    where id = ${extractionId}
  `;
  throw new Error(error);
}

// Called by the queue consumer once a message has exhausted its deliveries.
// Predicated on the non-terminal statuses so it cannot overwrite a result that
// landed in the meantime.
export async function recordExtractionFailure(extractionId: string, error: string, actor: string): Promise<void> {
  await sql`
    update document_extractions
    set status = 'failed', error = ${error}, processing_started_at = null, updated_by = ${actor}
    where id = ${extractionId} and status in ('queued', 'pending', 'processing')
  `;
}
