// Opening an extraction attempt, and publishing it. ONE copy of the protocol.
//
// Two callers reach it now, and the order of operations is the whole substance
// of both:
//
//   /api/imports/[id]/extract   a human pressing Read on a document that was
//                               registered earlier, or retrying one.
//   /api/imports (registration) every specification document, automatically,
//                               the moment it is registered.
//
// ============================================================================
// COMMIT, THEN PUBLISH. Never the other way round.
//
// `openAttempt` runs inside the caller's transaction and `publishAttempt` runs
// after it has committed. Publishing inside the transaction would let a worker
// claim an attempt the transaction then rolled back -- a paid model call
// against state that never existed.
//
// A publish failure is TWO situations and collapsing them breaks one of them:
//
//   DEFINITE rejection   the queue answered 4xx. Safe to close the attempt --
//                        but still fenced on nobody having claimed it, because
//                        the refusal we saw may have followed a delivery we
//                        did not.
//   AMBIGUOUS failure    a socket, a DNS failure, a timeout. The message may
//                        be in flight. STAY QUEUED, record a dispatch error,
//                        and let a human retry the dispatch of that SAME
//                        attempt -- idempotency on (run, attempt) makes that
//                        safe and it will not disturb a worker that already
//                        has the message. Marking this failed kills a run
//                        about to start; republishing blind double-charges.
// ============================================================================
import { sql } from "@/lib/db";
import type { withTransaction } from "@/lib/db-transaction";
import { enqueueExtractionJob, extractionIdempotencyKey } from "@/lib/extraction-queue";
import { ATTEMPT_DEADLINE_HOURS } from "@/lib/extraction-claim";

type Txn = Parameters<Parameters<typeof withTransaction>[0]>[0];

/**
 * Move a run to `queued` under `attemptId`, inside the caller's transaction.
 * Returns the attempt id, or null when no row matched — which the two callers
 * read differently, so neither decision is made here.
 *
 * `expectStatus` is how a caller that has NOT already inspected a locked row
 * fences itself: registration passes `"pending"`, because between its insert
 * and this update a human could conceivably have pressed Read, and opening a
 * second attempt over theirs would abandon a model call already being paid
 * for. The extract route passes nothing, having decided from a locked row.
 */
export async function openAttempt(
  txn: Txn,
  runId: string,
  attemptId: string,
  actor: string,
  expectStatus?: string,
): Promise<string | null> {
  const expected = expectStatus ?? null;
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
      and (${expected}::text is null or status = ${expected}::text)
    returning attempt_id
  `;
  if (!rows[0]) return null;
  return String(rows[0].attempt_id);
}

/**
 * A definite rejection carries an HTTP status the queue chose. Anything else —
 * a socket hang-up, a DNS failure, a timeout — may or may not have been
 * delivered, and the difference decides whether it is safe to say the attempt
 * failed.
 */
export function isDefiniteRejection(cause: unknown): boolean {
  const status = (cause as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

export type DispatchFailure = {
  code: "dispatch_rejected" | "dispatch_uncertain";
  /** What to tell whoever is looking at the screen. */
  error: string;
  /** The response status the extract route answers with. */
  status: 502 | 503;
};

/**
 * Record a publish failure on the run and say which of the two it was. Writes
 * only; the caller decides what to return, because the two callers answer
 * differently — a failed dispatch is the extract route's whole outcome, and
 * only a footnote on a registration that otherwise succeeded.
 */
export async function recordDispatchFailure(
  runId: string,
  attemptId: string,
  actor: string,
  cause: unknown,
): Promise<DispatchFailure> {
  const detail = cause instanceof Error ? cause.message : String(cause);

  if (isDefiniteRejection(cause)) {
    const error = `The extraction could not be queued: ${detail}`;
    await sql`
      update intake_runs
      set status = 'failed', error = ${error}, updated_by = ${actor}
      where id = ${runId} and attempt_id = ${attemptId} and status = 'queued' and claim_count = 0
    `;
    return { code: "dispatch_rejected", error, status: 502 };
  }

  await sql`
    update intake_runs
    set error = ${`The extraction may not have been queued: ${detail}`}, updated_by = ${actor}
    where id = ${runId} and attempt_id = ${attemptId} and status = 'queued'
  `;
  return {
    code: "dispatch_uncertain",
    error:
      "The request may or may not have reached the queue. Nothing has been charged yet. Wait a moment — if it does not start, use Retry dispatch.",
    status: 503,
  };
}

/**
 * Publish a committed attempt. Returns null on success, or what went wrong,
 * having already recorded it on the run.
 */
export async function publishAttempt(
  runId: string,
  attemptId: string,
  actor: string,
): Promise<DispatchFailure | null> {
  try {
    await enqueueExtractionJob(
      { kind: "document-intake", extractionId: runId, attemptId, requestedBy: actor },
      extractionIdempotencyKey(runId, attemptId),
    );
    return null;
  } catch (cause) {
    return await recordDispatchFailure(runId, attemptId, actor, cause);
  }
}
