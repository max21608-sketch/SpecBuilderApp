// Asking for a document to be read, by hand.
//
// This route is no longer the only way an attempt starts: registering a
// specification document dispatches one automatically (see /api/imports).
// It is what remains for the cases automation cannot cover — a document that
// FAILED, an attempt the queue never accepted, and an attempt abandoned by a
// worker that died mid-run. Each of those costs money, which is why each is a
// deliberate press with the cost stated on the button.
//
// COMMIT, THEN PUBLISH — and the handling of a publish failure — live in
// src/lib/extraction-dispatch.ts, because registration needs exactly the same
// protocol and a second copy of it would be a second set of rules about when a
// paid call may be claimed twice.
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
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { CLAIM_EXPIRY_SECONDS, MAX_CLAIMS_PER_ATTEMPT } from "@/lib/extraction-claim";

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
        return { attemptId: await opened(txn, id, requestId, user.email), alreadyDispatched: false };
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
      return { attemptId: await opened(txn, id, requestId, user.email), alreadyDispatched: false };
    });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }

  if (attempt.alreadyDispatched) {
    return json({ ok: true, attemptId: attempt.attemptId, status: "queued", reused: true });
  }

  // Committed. Now publish — outside the transaction, because a queue publish
  // is network I/O and a transaction must never be held across it.
  const failure = await publishAttempt(id, attempt.attemptId, user.email);
  if (failure) {
    return json(
      failure.code === "dispatch_uncertain"
        ? { ok: false, code: failure.code, attemptId: attempt.attemptId, error: failure.error }
        : { ok: false, code: failure.code, error: failure.error },
      failure.status,
    );
  }

  return json({ ok: true, attemptId: attempt.attemptId, status: "queued" });
}

/**
 * openAttempt, with this route's reading of "no row matched": it decided from
 * a locked row a moment ago, so the only way to match nothing is the row
 * having gone.
 */
async function opened(txn: Txn, runId: string, attemptId: string, actor: string): Promise<string> {
  const id = await openAttempt(txn, runId, attemptId, actor);
  if (!id) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
  return id;
}

type Txn = Parameters<Parameters<typeof withTransaction>[0]>[0];
