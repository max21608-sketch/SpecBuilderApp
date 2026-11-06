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
import { extractSpecDocument, type ExtractionResult } from "@/lib/anthropic";
import { readSpecDocument, type WindowCall } from "@/lib/extraction-windows";
import { resolveProposals, PROPOSAL_SCHEMA_VERSION, type StagedSpecDocument } from "@/lib/spec-document";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import {
  CLAIM_EXPIRY_SECONDS,
  MAX_CLAIMS_PER_ATTEMPT,
  RUN_ABORT_MS,
  type ExtractionRunOutcome,
} from "@/lib/extraction-claim";
import { handOffReadSlot } from "@/lib/extraction-slots";
import { isRegisterFreeKind, normaliseUnit, type AttributeUnit, type DocumentKind } from "@/lib/spec-vocab";
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { stagePreamble, type StagedPreamble } from "@/lib/preamble-document";
import { stageFinishSchedule, type StagedFinishSchedule } from "@/lib/finish-schedule";

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
  // What this project says its drawings are drawn in. Read here with the other
  // registers rather than at staging, for the same reason they are: a read
  // failure before the model call costs nothing, and after it costs the call.
  let projectDefaultUnit: AttributeUnit | null = null;
  try {
    if (isRegisterFreeKind(claim.documentKind)) {
      // The BWS register, for suggesting which field a callout fills. Small,
      // fixed, and owned by BWS rather than by the project.
      if (claim.documentKind === "shop_drawings") {
        const fieldRows = await sql`select id, json_id, name from spec_fields order by sort_order`;
        fields = fieldRows.map((row) => ({ id: String(row.id), jsonId: Number(row.json_id), name: String(row.name) }));
        const projectRows = await sql`
          select default_dimension_unit from projects where id = ${claim.projectId}
        `;
        // Through `normaliseUnit` rather than cast: the column's check
        // constraint and ATTRIBUTE_UNITS are two copies of one vocabulary, and
        // this is the seam where a future drift would otherwise go unnoticed.
        projectDefaultUnit = normaliseUnit(projectRows[0]?.default_dimension_unit);
      }
    } else {
      // With this run's id, so a bill's OWN specification read also loads the
      // bill's row → record map and resolves every proposal by its row.
      registers = await loadExtractionRegisters(claim.projectId, { intakeRunId: claim.runId });
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

  // An OBSERVATION kind reads a long spreadsheet in row windows, inside this
  // one attempt (`extraction-windows.ts`); everything else is one call.
  let result: ExtractionResult;
  let windows: WindowCall[] | null = null;
  if (isRegisterFreeKind(claim.documentKind)) {
    result = await extractSpecDocument(source, claim.documentKind, { signal: abort });
  } else {
    ({ result, windows } = await readSpecDocument(source, claim.documentKind, {
      signal: abort,
      billRows: registers?.billRows ?? null,
    }));
  }

  if (!result.ok) {
    // The wrapper, not an exception, is what tells a refusal from a socket
    // error. raw_response is persisted either way: it is the only evidence of
    // why an extraction was wrong.
    if (result.retryable) return await releaseAndThrow(claim, actor, result.error, result);
    return await fail(claim, actor, result.error, result);
  }

  // ---- staging ------------------------------------------------------------
  // One staged shape per output shape (`stageOutput`, below).
  //
  // ==========================================================================
  // A THROW HERE COMES AFTER THE MONEY. Audit D8, 2026-11-06. Staging is code
  // over a read already paid for, and it used to run unguarded: a throw went
  // past every catch, so raw_response was never written and the row stayed
  // `parsing` under its own live claim. The redeliveries at 30, 60 and 120 s
  // all found that claim live (busy), the last one's failure could not land
  // over it either, and fifteen minutes later the screen offered a Restart
  // that charged for the same read again.
  //
  // Terminal, not released: staging is deterministic over the model's output,
  // so a retry would pay for a second read to fail the same way. The paid
  // answer is written with the failure, which is what a person (or a fix to
  // the stager) needs, and the row is red with Retry at once.
  //
  // ONLY `stageOutput` is inside this try. The rule in the header still holds:
  // a release has to throw past the step that raised it, so nothing that
  // releases is wrapped here.
  // ==========================================================================
  if (result.output.outputKind === "observations" && !registers) {
    return await releaseAndThrow(claim, actor, "The registers were not loaded for this document.");
  }
  const filename = String(attachment.filename ?? "");
  let staged: StagedOutput["staged"];
  let stagedCount: number;
  try {
    ({ staged, stagedCount } = stageOutput(result.output, { fields, filename, projectDefaultUnit, registers }));
  } catch (cause) {
    return await fail(
      claim,
      actor,
      `The document was read, but what came back could not be staged: ${message(cause)}. Nothing was staged; the model's answer is kept with this document.`,
      result,
    );
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
            // One line per call where the read was made in row windows.
            ...(windows ? { windows } : {}),
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
    // A slot has just freed. Start the next document of this pack the cap
    // deferred, if there is one — after the write, never before, so a read
    // that never landed cannot start another.
    await handOffReadSlot(claim.runId, actor);
    return { outcome: "parsed" };
  } catch (cause) {
    // The model run is already paid for, so releasing re-runs it. That is still
    // the right trade against leaving a stuck row: this is a DB fault, which
    // means nothing was staged either.
    return await releaseAndThrow(claim, actor, message(cause));
  }
}

type StagedOutput = {
  staged: StagedSpecDocument | StagedDrawings | StagedPreamble | StagedFinishSchedule;
  stagedCount: number;
};

/**
 * The model's output as the staged shape its kind reviews in. The kind chose
 * the prompt, the tool and the schema together; it chooses the staging too, so
 * a drawing can never be staged as a list of proposals no reviewer can display.
 *
 * Pure apart from minting ids, and the only thing the worker's staging
 * try/catch wraps (audit D8): it may throw, and it never releases.
 */
function stageOutput(
  output: Extract<ExtractionResult, { ok: true }>["output"],
  context: {
    fields: SpecFieldEntry[];
    filename: string;
    projectDefaultUnit: AttributeUnit | null;
    registers: Awaited<ReturnType<typeof loadExtractionRegisters>> | null;
  },
): StagedOutput {
  const { fields, filename, projectDefaultUnit, registers } = context;
  if (output.outputKind === "drawing_items_v4") {
    // EVERY NEW SHOP-DRAWINGS READ (2026-10-04): the item-centric read, staged
    // as schemaVersion 4. The page-centric branch below stays for the v3 tool,
    // which nothing in the app asks for any more but a harness re-read can.
    const drawings = stageDrawingsV4(output.data, fields, filename, projectDefaultUnit);
    return { staged: drawings, stagedCount: drawings.items.reduce((total, item) => total + item.observations.length, 0) };
  }
  if (output.outputKind === "drawing_items") {
    const drawings = stageDrawings(
      output.data.items,
      fields,
      filename,
      output.data.documentNotes,
      projectDefaultUnit,
      output.data.codeGroups ?? [],
    );
    return { staged: drawings, stagedCount: drawings.items.reduce((total, item) => total + item.observations.length, 0) };
  }
  if (output.outputKind === "preamble_notes") {
    const preamble = stagePreamble(output.data.notes, filename, output.data.documentNotes);
    return { staged: preamble, stagedCount: preamble.notes.length };
  }
  if (output.outputKind === "finish_entries") {
    // A finishes schedule: a list of finishes under the client's codes. The
    // verdict against the library is read at review time (finish-schedule.ts).
    const schedule = stageFinishSchedule(output.data.entries, filename, output.data.documentNotes);
    return { staged: schedule, stagedCount: schedule.entries.length };
  }
  // The caller has refused this branch without registers, before the try.
  if (!registers) throw new Error("The registers were not loaded for this document.");
  const document: StagedSpecDocument = {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    lines: resolveProposals(output.data.proposals, registers, randomUUID),
    documentNotes: output.data.documentNotes,
    filename,
  };
  return { staged: document, stagedCount: document.lines.length };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why a claim did not land. Never guesses — reads the row and says. */
async function explainFailedClaim(extractionId: string, attemptId: string): Promise<ExtractionRunOutcome> {
  const rows = await sql`
    select status, attempt_id, claim_count, attempt_deadline_at, processing_started_at,
           (processing_started_at > now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})) as claim_live,
           extract(epoch from (processing_started_at + make_interval(secs => ${CLAIM_EXPIRY_SECONDS}) - now()))::float8
             as claim_expires_in_seconds,
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
    return {
      outcome: "busy",
      reason: "another worker is reading this document",
      claimExpiresInSeconds: Math.max(0, Number(row.claim_expires_in_seconds) || 0),
    };
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
  // A FAILED READ ALSO FREES A SLOT, and this is the branch that keeps a pack
  // moving: eleven documents whose reads all fail must not leave eight of them
  // waiting for a slot that nothing will ever free.
  await handOffReadSlot(claim.runId, actor);
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
  const rows = await sql`
    update intake_runs
    set status = 'failed', error = ${error}, processing_started_at = null, claim_token = null, updated_by = ${actor}
    where id = ${extractionId}
      and attempt_id = ${attemptId}
      and status in ('queued', 'parsing')
      and (
        status = 'queued'
        or processing_started_at < now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})
      )
    returning id
  `;
  // Out of deliveries is the other way an attempt settles, and a pack whose
  // documents die here has to go on. Only where this invocation is the one
  // that wrote the failure: a live claim means the work is still running and
  // its slot is still taken.
  if (rows[0]) await handOffReadSlot(extractionId, actor);
}
