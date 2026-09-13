// Asking for a document to be read. THIS IS THE CLICK THAT SPENDS MONEY.
//
// Registration is free and reads nothing; this route starts an attempt, and an
// attempt is up to MAX_CLAIMS_PER_ATTEMPT paid model calls. That is why it is a
// separate, deliberate act by a human rather than something registration does
// on its own.
//
// ============================================================================
// COMMIT, THEN PUBLISH. Never the other way round.
//
// Publishing inside the transaction would let a worker claim an attempt that
// the transaction then rolled back — a message pointing at state that never
// existed. So the attempt is committed first, and the publish is a separate
// step whose failure is handled explicitly:
//
//   DEFINITE rejection   the queue said no. Mark the attempt failed, but only
//                        if it is still queued and unclaimed — a worker may
//                        have picked up a message the publisher never saw
//                        acknowledged.
//   AMBIGUOUS failure    a socket died with the message possibly sent. STAY
//                        QUEUED, record a dispatch error, and offer Retry
//                        dispatch. Marking this failed would kill a run that is
//                        about to start; retrying blind would double-publish.
//                        Idempotency on (run, attempt) makes the retry safe.
//
// THREE ACTIONS, and the difference between them is what a human is agreeing to:
//
//   start            a first read, or a retry after a terminal failure. Only
//                    `pending` or `failed`.
//   retry-dispatch   the same attempt, still queued, never claimed. Costs
//                    nothing new and must NOT reset a worker that already has it.
//   restart-expired  a new attempt over an abandoned one. SAYS PLAINLY that
//                    another model call may be charged, because it may.
// ============================================================================
import { z } from "zod";
import { json, sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { enqueueExtractionJob, extractionIdempotencyKey } from "@/lib/extraction-queue";
import {
  ATTEMPT_DEADLINE_HOURS,
  CLAIM_EXPIRY_SECONDS,
  MAX_CLAIMS_PER_ATTEMPT,
} from "@/lib/extraction-claim";

export const dynamic = "force-dynamic";

const ExtractRequest = z
  .object({
    expectedVersion: z.number().int(),
    // Generated once per user action and reused across retries of THAT action,
    // so a lost response cannot start a second logical attempt.
    requestId: z.string().uuid(),
    action: z.enum(["start", "retry-dispatch", "restart-expired"]).default("start"),
  })
  .strict();

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
  const parsed = ExtractRequest.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That request is not valid." }, 400);
  }
  const { expectedVersion, requestId, action } = parsed.data;

  let attempt: { attemptId: string; alreadyDispatched: boolean };
  try {
    attempt = await withTransaction(async (txn) => {
      // Only this run's row. A worker-facing operation never takes a project
      // lock, and neither does the thing that schedules it.
      const rows = await txn`
        select id, source_kind, status, version, attempt_id, claim_token, claim_count,
               (attempt_deadline_at > now()) as within_deadline,
               (status = 'parsing' and processing_started_at > now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})) as claim_live
        from intake_runs
        where id = ${id}
        for update
      `;
      const run = rows[0];
      if (!run) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
      if (run.source_kind !== "spec_document") {
        throw new DomainConflictError("wrong_kind", "Only a specification document is read by the model.", { status: 400 });
      }
      if (Number(run.version) !== expectedVersion) {
        throw new DomainConflictError(
          "import_version_stale",
          "This import changed while the page was open. Reload before starting an extraction.",
        );
      }

      const status = String(run.status);
      const currentAttempt = run.attempt_id ? String(run.attempt_id) : null;

      if (action === "retry-dispatch") {
        if (status !== "queued" || !currentAttempt) {
          throw new DomainConflictError("not_dispatchable", "This import is not waiting to be dispatched.");
        }
        if (!run.within_deadline) {
          throw new DomainConflictError("attempt_expired", "That attempt has passed its deadline. Start a new one.");
        }
        if (Number(run.claim_count) > 0) {
          // A worker already has it. Republishing would be a duplicate that can
          // only burn a delivery.
          throw new DomainConflictError("already_claimed", "A worker has already picked this up. Wait for it to finish.");
        }
        return { attemptId: currentAttempt, alreadyDispatched: false };
      }

      if (action === "restart-expired") {
        const expiredParsing = status === "parsing" && !run.claim_live;
        const deadAttempt = status === "queued" && !run.within_deadline;
        const exhausted = Number(run.claim_count) >= MAX_CLAIMS_PER_ATTEMPT && status !== "parsed" && status !== "confirmed";
        if (!expiredParsing && !deadAttempt && !exhausted) {
          throw new DomainConflictError(
            "not_restartable",
            "This attempt has not been abandoned. Wait for it, or reload to see where it got to.",
          );
        }
        return { attemptId: await openAttempt(txn, id, requestId, user.email), alreadyDispatched: false };
      }

      // action === 'start'
      // The idempotent case: the same user action, retried after a lost
      // response. Return the SAME attempt rather than opening a second one.
      if (currentAttempt === requestId && status !== "pending" && status !== "failed") {
        return { attemptId: currentAttempt, alreadyDispatched: true };
      }
      if (status !== "pending" && status !== "failed") {
        throw new DomainConflictError(
          "already_started",
          status === "parsed" || status === "confirmed"
            ? "This document has already been read. Reload to see the result."
            : "This document is already being read.",
        );
      }
      return { attemptId: await openAttempt(txn, id, requestId, user.email), alreadyDispatched: false };
    });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }

  if (attempt.alreadyDispatched) {
    return json({ ok: true, attemptId: attempt.attemptId, status: "queued", reused: true });
  }

  // Committed. Now publish — outside the transaction, because a queue publish
  // is network I/O and a transaction must never be held across it.
  try {
    await enqueueExtractionJob(
      { kind: "document-intake", extractionId: id, attemptId: attempt.attemptId, requestedBy: user.email },
      extractionIdempotencyKey(id, attempt.attemptId),
    );
  } catch (cause) {
    return await handlePublishFailure(id, attempt.attemptId, user.email, cause);
  }

  return json({ ok: true, attemptId: attempt.attemptId, status: "queued" });
}

type Txn = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function openAttempt(txn: Txn, runId: string, attemptId: string, actor: string): Promise<string> {
  const rows = await txn`
    update intake_runs
    set status = 'queued',
        attempt_id = ${attemptId},
        claim_token = null,
        claim_count = 0,
        queued_at = now(),
        attempt_deadline_at = now() + make_interval(hours => ${ATTEMPT_DEADLINE_HOURS}),
        processing_started_at = null,
        error = null,
        updated_by = ${actor}
    where id = ${runId}
    returning attempt_id
  `;
  if (!rows[0]) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  return String(rows[0].attempt_id);
}

/**
 * A definite rejection carries an HTTP status the queue chose. Anything else —
 * a socket hang-up, a DNS failure, a timeout — may or may not have been
 * delivered, and the difference decides whether it is safe to say the attempt
 * failed.
 */
function isDefiniteRejection(cause: unknown): boolean {
  const status = (cause as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

async function handlePublishFailure(
  runId: string,
  attemptId: string,
  actor: string,
  cause: unknown,
): Promise<Response> {
  const detail = cause instanceof Error ? cause.message : String(cause);

  if (isDefiniteRejection(cause)) {
    // Safe to close: the queue refused it outright. Still fenced on "no worker
    // has claimed it", because the refusal we saw may have followed a delivery
    // we did not.
    await sql`
      update intake_runs
      set status = 'failed', error = ${`The extraction could not be queued: ${detail}`}, updated_by = ${actor}
      where id = ${runId} and attempt_id = ${attemptId} and status = 'queued' and claim_count = 0
    `;
    return json(
      { ok: false, code: "dispatch_rejected", error: `The extraction could not be queued: ${detail}` },
      502,
    );
  }

  // Ambiguous. Leave it queued and let a human retry the dispatch of this same
  // attempt — idempotency makes that safe, and it will not disturb a worker
  // that already has the message.
  await sql`
    update intake_runs
    set error = ${`The extraction may not have been queued: ${detail}`}, updated_by = ${actor}
    where id = ${runId} and attempt_id = ${attemptId} and status = 'queued'
  `;
  return json(
    {
      ok: false,
      code: "dispatch_uncertain",
      attemptId,
      error:
        "The request may or may not have reached the queue. Nothing has been charged yet. Wait a moment — if it does not start, use Retry dispatch.",
    },
    503,
  );
}
