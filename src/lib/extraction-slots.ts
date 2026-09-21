// How many charged reads of one pack may run at once, and who starts the next.
//
// ============================================================================
// REFUSING THE REGISTRATION IS THE WRONG SHAPE, AND IT IS THE OBVIOUS ONE.
//
// The simplest cap is a counter in `/api/imports` that answers the fourth
// upload with an error. It breaks two rules at once: the file IS stored and
// the row IS created, so telling somebody their upload did not arrive is a
// lie (the 201 rule); and a person uploading thirty documents would have to
// come back later and press Read on twenty-seven. Asking per document was
// already found to be ceremony rather than consent, which is why registration
// dispatches at all.
//
// So a document over the cap registers exactly as before — 201, stored, its
// row at `pending` — and is DISPATCHED LATER, by the worker that frees the
// slot. The hand-off goes through the same `openAttempt` + `publishAttempt`
// protocol as everything else, in that order: commit, then publish. Publishing
// from inside the worker's own write would let a claim exist against state
// that could still roll back, which is a paid model call against a run that
// never happened.
//
// ---- WHICH PENDING RUNS THE HAND-OFF MAY TOUCH ----------------------------
//
// NOT ALL OF THEM, and this is the part that would quietly spend money. A run
// has sat at `pending` since long before registration read anything
// automatically — CLAUDE.md is explicit that those are read by the pack
// screen's *Read all* and by nothing else. A hand-off that took the oldest
// `pending` run of the batch would turn one person pressing Read on one
// document into a charged read of every other document in that pack.
//
// A run the cap defers is therefore MARKED, by giving it the
// `attempt_deadline_at` its attempt would have had while leaving `attempt_id`
// null. Nothing else in the app writes that pair — `openAttempt` is the only
// writer of `attempt_id` and it always writes both — so it reads as "a read
// was promised for this document and has not started". A column would say it
// more plainly and a column is a migration; this is the same fact, written in
// the fields that already carry it.
//
// ---- WHAT HAPPENS WHEN A DEFERRED READ IS NEVER STARTED -------------------
//
// The marker expires with the deadline, and after it the run is an ordinary
// `pending` document again: no hand-off will touch it, the screens say *Not
// read yet*, and the pack screen's *Read all* starts it. That is the resting
// state on purpose. The hand-off chain can break — a worker cut off at
// `maxDuration` after its write, a publish that never landed — and the
// alternative to degrading is a document that starts reading itself a week
// after anybody was watching.
//
// ---- AN EXPIRED ATTEMPT IS NOT IN FLIGHT ----------------------------------
//
// `inFlight` counts only attempts still inside their deadline, because the
// claim predicate in `extraction-run.ts` refuses one that is past it: such a
// run can never progress on its own. Counting it would let a single stuck
// document shrink a pack's capacity for good, and three of them would stop
// the pack for ever — including for *Read all*, which is the recovery path,
// and which would then defer every document it was pressed for.
//
// IT IS NOT A SWEEPER, AND THE HOLE IT LEAVES IS REAL. Nothing settles an
// attempt that passes its deadline: the row stays `queued` with no worker
// coming, which is a pre-existing hole (the screens offer *Restart*, and
// `explainFailedClaim` names it). What this clause fixes is only that such a
// row stops holding a slot. Nothing HANDS the slot on at the moment it
// expires, so a pack whose three in-flight attempts all expire sits still
// until somebody presses Read all or another of its documents settles.
//
// ---- THE SCOPE IS THE PACK, AND AN EMAIL HAS NO PACK ----------------------
//
// `intake_batches` is the unit somebody uploads, so it is the unit capped.
// An email has no batch: `assignMessage` inserts its run with `batch_id` null,
// and assignment is one person's click on one message. Those count against a
// per-PROJECT cap of the same size, over batch-less runs only — holding an
// email behind a pack's eleven documents would read as the app ignoring the
// click, and a person cannot assign three messages at once by accident. It is
// built now rather than with 2.11 because auto-assigned mail is this same
// problem with no upload step to stagger it.
// ============================================================================
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openAttempt, publishAttempt } from "@/lib/extraction-dispatch";
import { ATTEMPT_DEADLINE_HOURS, MAX_IN_FLIGHT_READS_PER_PACK } from "@/lib/extraction-claim";

/**
 * What a read's slots are counted against: its pack, or — with no pack — the
 * project's batch-less reads, which is where an email lands.
 */
export type ReadScope = { projectId: string; batchId: string | null };

/**
 * Serialise every decision about one scope's slots.
 *
 * An ADVISORY lock rather than a row lock, and that is deliberate: locking the
 * project row here would put every registration and every email assignment
 * behind the confirm paths, which hold that row for the length of a bill
 * confirm. A registration would then fail on `lock_timeout` for a reason that
 * has nothing to do with it. The advisory lock is held only by this decision
 * and released by the commit.
 *
 * `hashtext` can collide, which costs two unrelated packs a few milliseconds
 * of queueing and nothing else.
 */
async function lockScope(txn: TxnSql, scope: ReadScope): Promise<void> {
  const key = scope.batchId ? `batch:${scope.batchId}` : `project:${scope.projectId}`;
  await txn`select pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * How many of this scope's specification documents are being read right now.
 *
 * The scope predicate is written out here and again in `dispatchNextWaiting`,
 * because the driver cannot share a SQL fragment — the `loadExportScope`
 * situation. Two copies of one predicate, in one file, is the price.
 */
async function inFlight(txn: TxnSql, scope: ReadScope): Promise<number> {
  const rows = await txn`
    select count(*)::int as n
    from intake_runs
    where source_kind = 'spec_document'
      and status in ('queued', 'parsing')
      and attempt_deadline_at > now()
      and (
        (${scope.batchId}::uuid is not null and batch_id = ${scope.batchId}::uuid)
        or (${scope.batchId}::uuid is null and batch_id is null and project_id = ${scope.projectId}::uuid)
      )
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Take a slot for a read about to start, inside the caller's transaction.
 * False means the pack is already reading as many as it may, and the caller
 * calls `deferRead` on the run instead of opening an attempt.
 */
export async function takeReadSlot(txn: TxnSql, scope: ReadScope): Promise<boolean> {
  await lockScope(txn, scope);
  return (await inFlight(txn, scope)) < MAX_IN_FLIGHT_READS_PER_PACK;
}

/**
 * Mark a run as one the cap deferred: a read was promised and has not started.
 *
 * `attempt_id` stays null, so nothing can claim it and no delivery exists for
 * it. The deadline is what tells `dispatchNextWaiting` this run is one of ours
 * rather than one of the `pending` rows that predate automatic reading.
 *
 * Only a run still `pending` with no attempt: the two callers have both just
 * inserted one. A `failed` run is not deferred here because nothing defers a
 * retry — the extract route is uncapped, which is recorded as an observation
 * rather than fixed in this item.
 */
export async function deferRead(txn: TxnSql, runId: string, actor: string): Promise<void> {
  await txn`
    update intake_runs
    set attempt_deadline_at = now() + make_interval(hours => ${ATTEMPT_DEADLINE_HOURS}),
        updated_by = ${actor}
    where id = ${runId} and status = 'pending' and attempt_id is null
  `;
}

/** What a screen says about a document that is waiting for a slot. */
export const WAITING_FOR_SLOT_MESSAGE =
  `Waiting — ${MAX_IN_FLIGHT_READS_PER_PACK} documents of this pack are being read. ` +
  `This one starts on its own when one of them finishes.`;

/**
 * Start the next deferred read of a scope, if there is one and there is room.
 *
 * Called by the worker as an attempt SETTLES — parsed, failed, or out of
 * deliveries. Never from a screen: a screen that dispatched a read on its own
 * would be a charged model call nobody pressed anything for.
 *
 * It never throws. A hand-off that fails leaves the run deferred and the pack
 * a document short, which the pack screens say in words and *Read all*
 * recovers; letting it escape would turn a finished read into a failed one and
 * cost the document that just succeeded.
 */
export async function dispatchNextWaiting(scope: ReadScope, actor: string): Promise<string | null> {
  try {
    const opened = await withTransaction(async (txn) => {
      await lockScope(txn, scope);
      if ((await inFlight(txn, scope)) >= MAX_IN_FLIGHT_READS_PER_PACK) return null;

      // Oldest first, so a pack is read in the order it was uploaded. `for
      // update` on top of the advisory lock because the row is about to be
      // updated and a stray writer must not slip between the two statements.
      const waiting = await txn`
        select id from intake_runs
        where source_kind = 'spec_document'
          and status = 'pending'
          and attempt_id is null
          and attempt_deadline_at > now()
          and (
            (${scope.batchId}::uuid is not null and batch_id = ${scope.batchId}::uuid)
            or (${scope.batchId}::uuid is null and batch_id is null and project_id = ${scope.projectId}::uuid)
          )
        order by created_at, id
        limit 1
        for update
      `;
      const runId = waiting[0] ? String(waiting[0].id) : null;
      if (!runId) return null;

      const attemptId = await openAttempt(txn, runId, randomUUID(), actor, "pending");
      return attemptId ? { runId, attemptId } : null;
    });

    if (!opened) return null;
    // Committed. The publish is outside it, for the reason it always is.
    await publishAttempt(opened.runId, opened.attemptId, actor);
    return opened.runId;
  } catch {
    return null;
  }
}

/**
 * Hand the slot on, whatever the outcome was. Never throws, and its value is
 * never what a read's own outcome depends on.
 *
 * The worker holds a `Claim`, which carries the project but not the batch, so
 * the scope is read back off the row; a run that no longer exists hands back
 * nothing rather than failing the outcome of a read that succeeded.
 */
export async function handOffReadSlot(runId: string, actor: string): Promise<void> {
  try {
    const rows = await sql`select project_id, batch_id from intake_runs where id = ${runId}`;
    const row = rows[0];
    if (!row) return;
    await dispatchNextWaiting(
      { projectId: String(row.project_id), batchId: row.batch_id ? String(row.batch_id) : null },
      actor,
    );
  } catch {
    // A read that landed must not be reported as failed because the pack's
    // next document could not be started.
  }
}
