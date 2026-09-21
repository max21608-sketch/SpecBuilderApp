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
//                    `pending` or `failed`. CAPPED: see below.
//   retry-dispatch   the same attempt, still queued, never claimed. Costs
//                    nothing new and must NOT reset a worker that already has it.
//   restart-expired  a new attempt over an abandoned one. SAYS PLAINLY that
//                    another model call may be charged, because it may.
//
// ============================================================================
// `start` TAKES A READ SLOT, AND OVER THE CAP IT DEFERS RATHER THAN REFUSES.
//
// At most MAX_IN_FLIGHT_READS_PER_PACK charged reads of one pack run at once
// (src/lib/extraction-slots.ts). Registration has honoured that since it
// started reading automatically; this route did not, and *Read all* on the
// pack screen is one press over every unread document — usually the eleven a
// rate-limit storm has just failed. Eleven concurrent calls to recover from
// eleven rate-limited calls is the case the cap exists for.
//
// Over the cap the answer is 202 AND `ok: true`, never an error. The press was
// correct and the document WILL be read: it is marked as a read that has been
// promised, and the worker that frees a slot starts it. A red failure there
// would be the app reporting its own queueing as the reviewer's problem, and
// they would press again.
//
// `retry-dispatch` and `restart-expired` stay uncapped, on purpose.
// `retry-dispatch` re-publishes an attempt that already holds a slot, so it
// starts no new read. `restart-expired` is one deliberate press on one
// document whose attempt is past its deadline — and an expired attempt has
// already stopped counting as in flight, so capping it would let three stuck
// documents refuse the only control that clears them.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { takeReadSlot, deferRead, WAITING_FOR_SLOT_MESSAGE } from "@/lib/extraction-slots";
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

  let attempt: { attemptId: string | null; alreadyDispatched: boolean };
  try {
    attempt = await withTransaction(async (txn) => {
      // ======================================================================
      // THE SLOT IS TAKEN BEFORE THE ROW IS LOCKED, AND THAT ORDER IS THE
      // WHOLE REASON THIS IS TWO STATEMENTS.
      //
      // `takeReadSlot` opens with an advisory lock on the pack. `handOffReadSlot`
      // takes that same advisory lock and THEN locks the waiting run it is
      // about to dispatch — so a press on the very run a finishing worker has
      // just picked would hold the row and wait for the advisory lock while the
      // worker held the advisory lock and waited for the row. Postgres would
      // break that by aborting one of them, and the reviewer's correct press
      // would come back a 500. Same order on both sides costs one extra read
      // and cannot deadlock.
      //
      // The scope read takes NO lock, which is what makes it safe to do first:
      // a run's project and pack never change once it is inserted.
      // ======================================================================
      let hasSlot = true;
      if (action === "start") {
        const scope = await txn`select project_id, batch_id from intake_runs where id = ${id}`;
        if (!scope[0]) throw new DomainConflictError("not_found", "No such import.", { status: 404 });
        hasSlot = await takeReadSlot(txn, {
          projectId: String(scope[0].project_id),
          batchId: scope[0].batch_id ? String(scope[0].batch_id) : null,
        });
      }

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
      // At the cap. The document is marked as a read that has been promised
      // and not started, and nothing is published — the worker that frees a
      // slot opens the attempt. A `failed` run is put back to `pending` by
      // `deferRead`, so the screens stop offering a Retry for a read that is
      // already queued behind the three in flight.
      if (!hasSlot) {
        await deferRead(txn, id, user.email);
        return { attemptId: null, alreadyDispatched: false };
      }
      return { attemptId: await opened(txn, id, requestId, user.email), alreadyDispatched: false };
    });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }

  // Deferred by the cap. 202 and `ok: true`, because the press was correct and
  // the read will happen; `waiting` is what the screens read to say so in
  // words rather than painting a working pack red.
  if (!attempt.attemptId) {
    return json(
      { ok: true, importId: id, attemptId: null, status: "waiting", waiting: true, note: WAITING_FOR_SLOT_MESSAGE },
      202,
    );
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
