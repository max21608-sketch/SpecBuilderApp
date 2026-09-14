// Reading an uploaded specification document. Runs on the queue, not in the
// request that asked for it.
//
// Nothing operational is written — the result is STAGED for review, and a human
// confirms each proposal into spec_answers at /api/imports/[id]/confirm.
//
// ============================================================================
// WHAT THROWS AND WHAT DOES NOT is the load-bearing distinction in this file,
// because the caller is a queue that retries on a throw:
//
//   - a model refusal, a schema failure, a truncation or an auth error is
//     TERMINAL. It writes 'failed' and RETURNS. Retrying buys the same refusal
//     at full price.
//   - an unparseable, encrypted or oversized source is terminal too: retrying
//     cannot make it a different file.
//   - an infrastructure fault (blob 5xx, transient model fault, DB error)
//     RELEASES the claim and THROWS, so the delivery is retried. Releasing
//     matters and the ORDER matters: retry backoff is far shorter than
//     CLAIM_EXPIRY_SECONDS, so a row left claimed makes every retry a silent
//     no-op until the claim ages out.
//
// Do NOT wrap this function in one outer try/catch. A release has to throw past
// the step that raised it; an outer catch converts it back into a terminal
// failure and deletes the retry, invisibly.
//
// EVERY write here is fenced on (runId, attemptId, claimToken) plus the status
// it expects. Zero rows means ownership was lost — stop, do not retry the
// write, do not escalate it to a terminal failure. An old worker must not be
// able to clear a newer attempt.
//
// This worker locks NOTHING but its own row, and holds no transaction across
// the blob read or the model call. A worker that took a project or record lock
// and then spent four minutes in a model call would block every other writer on
// that project for the duration.
// ============================================================================
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { prepareDocumentSource } from "@/lib/intake-source";
import { readTrustedBlob, UntrustedBlobError, blobPathname } from "@/lib/blob-source";
import { extractSpecDocument } from "@/lib/anthropic";
import { resolveProposals, PROPOSAL_SCHEMA_VERSION, type StagedSpecDocument } from "@/lib/spec-document";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  CLAIM_EXPIRY_SECONDS,
  MAX_CLAIMS_PER_ATTEMPT,
  RUN_ABORT_MS,
  type ExtractionRunOutcome,
} from "@/lib/extraction-claim";
import { isRegisterFreeKind, type DocumentKind } from "@/lib/spec-vocab";
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
import { stagePreamble, type StagedPreamble } from "@/lib/preamble-document";

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

type Claim = {
  runId: string;
  attemptId: string;
  claimToken: string;
  projectId: string;
  attachmentId: string | null;
  documentKind: DocumentKind;
};

export async function runDocumentExtraction({
  extractionId,
  attemptId,
  actor,
}: {
  extractionId: string;
  attemptId: string;
  actor: string;
}): Promise<ExtractionRunOutcome> {
  const startedAt = Date.now();

  // ONE predicated statement. `returning` proves this invocation — and only
  // this one — owns the attempt. A read-then-write let two deliveries both
  // believe they had it, and both billed a full model run.
  //
  // Never claims 'pending' (nobody has asked for this to be read) and never
  // claims a terminal 'failed' (a human decides whether to pay again).
  const claimToken = randomUUID();
  const claimed = await sql`
    update intake_runs
    set status = 'parsing',
        claim_token = ${claimToken},
        claim_count = claim_count + 1,
        processing_started_at = now(),
        updated_by = ${actor}
    where id = ${extractionId}
      and source_kind = 'spec_document'
      and attempt_id = ${attemptId}
      and attempt_deadline_at > now()
      and claim_count < ${MAX_CLAIMS_PER_ATTEMPT}
      and (
        status = 'queued'
        or (status = 'parsing'
            and processing_started_at < now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS}))
      )
    returning id, attempt_id, claim_token, project_id, attachment_id, document_kind
  `;

  if (!claimed[0]) return await explainFailedClaim(extractionId, attemptId);

  const claim: Claim = {
    runId: String(claimed[0].id),
    attemptId: String(claimed[0].attempt_id),
    claimToken: String(claimed[0].claim_token),
    projectId: String(claimed[0].project_id),
    attachmentId: claimed[0].attachment_id ? String(claimed[0].attachment_id) : null,
    documentKind: String(claimed[0].document_kind) as DocumentKind,
  };

  if (!claim.attachmentId) {
    return await fail(claim, actor, "The uploaded document is no longer attached to this import.");
  }

  // ---- the source ---------------------------------------------------------
  let attachment: Record<string, unknown> | undefined;
  try {
    const rows = await sql`
      select storage_path, filename, content_type from attachments where id = ${claim.attachmentId}
    `;
    attachment = rows[0];
  } catch (cause) {
    return await releaseAndThrow(claim, actor, message(cause));
  }
  if (!attachment) return await fail(claim, actor, "The uploaded document could not be found.");

  let blob: Awaited<ReturnType<typeof readTrustedBlob>>;
  try {
    // Includes reading the body, not just opening it: catching the request and
    // letting the stream read throw uncaught is the classic version of this bug.
    blob = await readTrustedBlob(blobPathname(String(attachment.storage_path)), claim.projectId, {
      maxBytes: MAX_SOURCE_BYTES,
    });
  } catch (cause) {
    // A refusal by the trust boundary is about THIS file and will say the same
    // thing every time. A transport fault will not.
    if (cause instanceof UntrustedBlobError) return await fail(claim, actor, cause.message);
    return await releaseAndThrow(claim, actor, message(cause));
  }

  // Parsing is deterministic: a file that will not parse parses no better on
  // the fourth attempt. Encrypted and oversized land here too.
  let source: Awaited<ReturnType<typeof prepareDocumentSource>>;
  try {
    source = await prepareDocumentSource(blob.bytes, String(attachment.filename), String(attachment.content_type ?? ""));
  } catch (cause) {
    return await fail(claim, actor, message(cause));
  }

  // ---- the registers, loaded BEFORE the model call ------------------------
  // Deterministic resolution happens in code against these, never in the
  // prompt. Loading them first also means a register read failure costs
  // nothing — at this point no model has been called.
  //
  // SKIPPED for the register-free kinds. A drawing observation and a preamble
  // note both become NEW rows, so there is no existing value to snapshot and
  // nothing to resolve against: those two resolve at review time instead, which
  // is what lets a drawing set be extracted before its BOQ is confirmed. See
  // the header of drawing-document.ts.
  let registers: Awaited<ReturnType<typeof loadExtractionRegisters>> | null = null;
  let fields: SpecFieldEntry[] = [];
  try {
    if (isRegisterFreeKind(claim.documentKind)) {
      // The BWS register, for suggesting which field a callout fills. Small,
      // fixed, and owned by BWS rather than by the project.
      if (claim.documentKind === "shop_drawings") {
        const fieldRows = await sql`select id, json_id, name from spec_fields order by sort_order`;
        fields = fieldRows.map((row) => ({ id: String(row.id), jsonId: Number(row.json_id), name: String(row.name) }));
      }
    } else {
      registers = await loadExtractionRegisters(claim.projectId);
    }
  } catch (cause) {
    return await releaseAndThrow(claim, actor, message(cause));
  }

  // ---- the model ----------------------------------------------------------
  const remaining = RUN_ABORT_MS - (Date.now() - startedAt);
  if (remaining <= 0) {
    return await releaseAndThrow(claim, actor, "Preparing the document used the whole time budget.");
  }
  const abort = AbortSignal.timeout(remaining);

  const result = await extractSpecDocument(source, claim.documentKind, { signal: abort });

  if (!result.ok) {
    // The wrapper, not an exception, is what tells a refusal from a socket
    // error. raw_response is persisted either way: it is the only evidence of
    // why an extraction was wrong.
    if (result.retryable) return await releaseAndThrow(claim, actor, result.error, result);
    return await fail(claim, actor, result.error, result);
  }

  // ---- staging ------------------------------------------------------------
  // One staged shape per output shape. The kind chose the prompt, the tool and
  // the schema together; it chooses the staging too, so a drawing can never be
  // staged as a list of proposals no reviewer can display.
  const filename = String(attachment.filename ?? "");
  let staged: StagedSpecDocument | StagedDrawings | StagedPreamble;
  let stagedCount: number;

  if (result.output.outputKind === "drawing_items") {
    const drawings = stageDrawings(result.output.data.items, fields, filename, result.output.data.documentNotes);
    staged = drawings;
    stagedCount = drawings.items.reduce((total, item) => total + item.observations.length, 0);
  } else if (result.output.outputKind === "preamble_notes") {
    const preamble = stagePreamble(result.output.data.notes, filename, result.output.data.documentNotes);
    staged = preamble;
    stagedCount = preamble.notes.length;
  } else {
    if (!registers) return await releaseAndThrow(claim, actor, "The registers were not loaded for this document.");
    const document: StagedSpecDocument = {
      schemaVersion: PROPOSAL_SCHEMA_VERSION,
      lines: resolveProposals(result.output.data.proposals, registers, randomUUID),
      documentNotes: result.output.data.documentNotes,
      filename,
    };
    staged = document;
    stagedCount = document.lines.length;
  }

  try {
    const written = await sql`
      update intake_runs
      set status = 'parsed',
          parsed = ${JSON.stringify(staged)}::jsonb,
          model = ${result.model},
          raw_response = ${JSON.stringify(result.rawResponse)}::jsonb,
          model_metadata = ${JSON.stringify({
            requestId: result.requestId,
            usage: result.usage,
            elapsedMs: result.elapsedMs,
            proposals: stagedCount,
          })}::jsonb,
          error = null,
          processing_started_at = null,
          updated_by = ${actor}
      where id = ${claim.runId}
        and attempt_id = ${claim.attemptId}
        and claim_token = ${claim.claimToken}
        and status = 'parsing'
      returning id
    `;
    if (!written[0]) {
      // Ownership was lost while the model was running. Someone else owns this
      // attempt now; writing anything further would clobber their result.
      return { outcome: "skipped", reason: "the claim was taken over while the document was being read" };
    }
    return { outcome: "parsed" };
  } catch (cause) {
    // The model run is already paid for, so releasing re-runs it. That is still
    // the right trade against leaving a stuck row: this is a DB fault, which
    // means nothing was staged either.
    return await releaseAndThrow(claim, actor, message(cause));
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why a claim did not land. Never guesses — reads the row and says. */
async function explainFailedClaim(extractionId: string, attemptId: string): Promise<ExtractionRunOutcome> {
  const rows = await sql`
    select status, attempt_id, claim_count, attempt_deadline_at, processing_started_at,
           (processing_started_at > now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})) as claim_live,
           (attempt_deadline_at > now()) as within_deadline
    from intake_runs where id = ${extractionId}
  `;
  const row = rows[0];
  if (!row) return { outcome: "skipped", reason: "that import no longer exists" };
  if (String(row.attempt_id ?? "") !== attemptId) {
    return { outcome: "skipped", reason: "this message belongs to a superseded attempt" };
  }
  if (row.status === "parsing" && row.claim_live) {
    // NOT a success. See the note on `busy` in extraction-claim.ts.
    return { outcome: "busy", reason: "another worker is reading this document" };
  }
  if (!row.within_deadline) return { outcome: "skipped", reason: "this attempt passed its deadline" };
  if (Number(row.claim_count) >= MAX_CLAIMS_PER_ATTEMPT) {
    return { outcome: "skipped", reason: "this attempt has used all of its attempts" };
  }
  return { outcome: "skipped", reason: `already ${String(row.status)}` };
}

/** Terminal for this attempt: this will not come out differently on another one. */
async function fail(
  claim: Claim,
  actor: string,
  error: string,
  result?: { rawResponse?: unknown; usage?: unknown; requestId?: string | null; elapsedMs?: number },
): Promise<ExtractionRunOutcome> {
  const rows = await sql`
    update intake_runs
    set status = 'failed',
        error = ${error},
        processing_started_at = null,
        claim_token = null,
        raw_response = coalesce(${result?.rawResponse ? JSON.stringify(result.rawResponse) : null}::jsonb, raw_response),
        model_metadata = coalesce(${result ? JSON.stringify({ requestId: result.requestId ?? null, usage: result.usage ?? null, elapsedMs: result.elapsedMs ?? null }) : null}::jsonb, model_metadata),
        updated_by = ${actor}
    where id = ${claim.runId}
      and attempt_id = ${claim.attemptId}
      and claim_token = ${claim.claimToken}
      and status = 'parsing'
    returning id
  `;
  if (!rows[0]) return { outcome: "skipped", reason: "the claim was taken over before the failure could be recorded" };
  return { outcome: "failed", error };
}

/**
 * Retryable: hand the row back so the next delivery can claim it, THEN let the
 * queue see the failure. The order is the point — throwing first leaves the row
 * claimed and every retry becomes a no-op.
 *
 * The error is recorded while the row returns to `queued`, so the screen has to
 * render a lingering error on a queued row NEUTRALLY ("Last attempt reported:")
 * rather than as a failure.
 */
async function releaseAndThrow(
  claim: Claim,
  actor: string,
  error: string,
  result?: { rawResponse?: unknown },
): Promise<never> {
  await sql`
    update intake_runs
    set status = 'queued',
        error = ${error},
        claim_token = null,
        processing_started_at = null,
        raw_response = coalesce(${result?.rawResponse ? JSON.stringify(result.rawResponse) : null}::jsonb, raw_response),
        updated_by = ${actor}
    where id = ${claim.runId}
      and attempt_id = ${claim.attemptId}
      and claim_token = ${claim.claimToken}
      and status = 'parsing'
  `;
  throw new Error(error);
}

/**
 * Called by the consumer once a message has exhausted its deliveries.
 *
 * Fenced on the attempt AND on there being no live claim: if another invocation
 * is legitimately reading the document right now, marking the run failed would
 * kill work that is about to succeed and has already been paid for.
 */
export async function recordExtractionFailure(
  extractionId: string,
  attemptId: string,
  error: string,
  actor: string,
): Promise<void> {
  await sql`
    update intake_runs
    set status = 'failed', error = ${error}, processing_started_at = null, claim_token = null, updated_by = ${actor}
    where id = ${extractionId}
      and attempt_id = ${attemptId}
      and status in ('queued', 'parsing')
      and (
        status = 'queued'
        or processing_started_at < now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})
      )
  `;
}
