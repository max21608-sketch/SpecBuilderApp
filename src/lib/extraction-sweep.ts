// Settling an attempt nobody is ever going to finish, and handing its slot on.
//
// ============================================================================
// THE HOLE THIS CLOSES, AND WHY IT IS NOT A SCREEN'S JOB
//
// An attempt whose `attempt_deadline_at` passes stays `queued` with no worker
// coming: the claim predicate in `extraction-run.ts` refuses a delivery past
// the deadline, so the row cannot progress on its own and nothing settles it.
// The per-pack cap (`extraction-slots.ts`) steps around it — `inFlight` counts
// only attempts inside their deadline, or one stuck document would shrink a
// pack's capacity for good — but NOTHING HANDS THE SLOT ON at the moment of
// expiry. A pack whose three in-flight attempts all expire therefore sits
// still until somebody presses *Read all*.
//
// The screens already say something is wrong (they offer *Restart*), so the
// missing half is not a sentence: it is that no code runs at the moment the
// deadline passes. That belongs with the queue and with nothing else — a
// screen that settled attempts would only settle the ones somebody happened to
// be looking at, and a screen that dispatched a read would be a charged model
// call nobody pressed anything for.
//
// So: a sweeper, on a cron, running the same protocol every other hand-off
// runs.
//
// ---- WHAT IT MAY AND MAY NOT DO -------------------------------------------
//
// IT NEVER STARTS A SECOND READ OF THE ATTEMPT IT SETTLES. There is no
// exactly-once billing guarantee anywhere in this pipeline, and a sweeper that
// re-published an attempt to "get it moving" would be the one component able
// to charge for a document with nobody watching. It closes the attempt and
// stops; starting a new one is a person's press, with the cost on the button.
//
// THE 24-HOUR DEADLINE IS THE SAFETY MARGIN, and it is worth naming because it
// is the only thing making "nobody is still working on this" safe to assume. A
// worker invocation is bounded by MAX_DURATION_SECONDS (800) and a claim
// expires after CLAIM_EXPIRY_SECONDS (900); the deadline is 24 hours, which is
// 240 times the longest either can legitimately last. The fence below still
// re-checks for a live claim, because a free check is cheaper than reasoning
// about clock skew.
//
// ZERO ROWS MEANS OWNERSHIP MOVED — STOP. Every write here is fenced on the
// attempt id and the status it expects, the way every worker write is. A
// no-match means a person restarted the document, or a very slow worker landed
// after all, and the correct response is to leave it alone rather than force a
// terminal state over somebody else's live work.
//
// ---- WHY `failed` IS THE RESTING STATE ------------------------------------
//
// Not `pending`, which is what a deferred read looks like: a deferral is a
// PROMISE that something will start the read, and an expired attempt is the
// opposite of a promise. `failed` is what the pipeline already means by "this
// attempt is over and a person decides whether to pay again" — it is what
// `recordExtractionFailure` writes when the deliveries run out, the review
// screens render it with a Retry, and `unreadRuns` on the pack screen puts it
// back into *Read all*'s set. The error sentence says what happened and that
// pressing Read costs a new call.
// ============================================================================
import { sql } from "@/lib/db";
import { ATTEMPT_DEADLINE_HOURS, CLAIM_EXPIRY_SECONDS } from "@/lib/extraction-claim";
import { dispatchNextWaiting } from "@/lib/extraction-slots";

/** What the row says afterwards. One sentence, and it names the cost of the way out. */
export const EXPIRED_ATTEMPT_ERROR =
  `This read never finished: the attempt passed its ${ATTEMPT_DEADLINE_HOURS}-hour deadline and has been closed, ` +
  `so nothing is coming for it. Press Read to start a new one — that is a new charged call.`;

/**
 * How many expired attempts one sweep will settle.
 *
 * A bound rather than a page: more than this many at once is an incident — a
 * queue that stopped delivering, a deploy that lost its consumer — and the
 * next run of the cron takes the rest either way. An unbounded sweep would
 * turn that incident into one long-running function.
 */
export const SWEEP_LIMIT = 50;

export type ReadSweep = {
  /** Attempts closed by this sweep. */
  settled: number;
  /** Deferred documents this sweep started, because closing one freed its slot. */
  dispatched: number;
  /** Rows that were expired when selected and had moved on by the time they were fenced. */
  skipped: number;
};

/**
 * Close every extraction attempt past its deadline, and start whatever the
 * freed slots allow.
 *
 * Never throws: it is called from a cron, and a sweep that fails halfway has
 * still settled what it settled. What it could not do, the next run does.
 *
 * `projectId` narrows it to one project. The cron passes none — an expired
 * attempt is expired wherever it is. It exists because "settle this project's
 * dead attempts" is a real thing to want when somebody is looking at one stuck
 * pack, and because settling the whole database as a side effect of
 * investigating one job is not.
 */
export async function sweepExpiredReads(
  actor: string,
  options: { limit?: number; projectId?: string | null } = {},
): Promise<ReadSweep> {
  const limit = options.limit ?? SWEEP_LIMIT;
  const projectId = options.projectId ?? null;
  const result: ReadSweep = { settled: 0, dispatched: 0, skipped: 0 };

  // Read the candidates without a lock. Nothing is decided here — the fenced
  // update below is the decision — so a row that changes between the two
  // statements simply matches nothing and is counted as skipped.
  //
  // `parsing` is in the set as well as `queued`: a worker killed mid-run leaves
  // the row claimed, and once the deadline has passed no delivery can reclaim
  // it either.
  let candidates;
  try {
    candidates = await sql`
      select id, project_id, batch_id, attempt_id
      from intake_runs
      where source_kind = 'spec_document'
        and status in ('queued', 'parsing')
        and attempt_id is not null
        and attempt_deadline_at <= now()
        and (
          processing_started_at is null
          or processing_started_at < now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})
        )
        and (${projectId}::uuid is null or project_id = ${projectId}::uuid)
      order by attempt_deadline_at
      limit ${limit}
    `;
  } catch {
    return result;
  }

  for (const row of candidates) {
    const runId = String(row.id);
    const attemptId = String(row.attempt_id);
    try {
      // THE FENCE. Same shape as every worker write: the attempt id, the
      // statuses this is allowed to move, and the two conditions that made the
      // row a candidate — re-checked at the moment of writing, because the
      // select above holds nothing.
      const settled = await sql`
        update intake_runs
        set status = 'failed',
            error = ${EXPIRED_ATTEMPT_ERROR},
            claim_token = null,
            processing_started_at = null,
            updated_by = ${actor}
        where id = ${runId}
          and attempt_id = ${attemptId}
          and status in ('queued', 'parsing')
          and attempt_deadline_at <= now()
          and (
            processing_started_at is null
            or processing_started_at < now() - make_interval(secs => ${CLAIM_EXPIRY_SECONDS})
          )
        returning id
      `;
      if (!settled[0]) {
        // Somebody else owns this now — a restart, or a worker that landed
        // after all. NOT a failure to record: escalating a lost fence into a
        // terminal state is exactly what the claim protocol forbids.
        result.skipped += 1;
        continue;
      }
      result.settled += 1;

      // A slot has just freed, so the pack's next deferred document may start.
      // AFTER the settle, never before — and through the one function that
      // owns that decision, so the cap's arithmetic and the commit-then-publish
      // protocol are not restated here. It never throws and returns null when
      // there is nothing waiting or no room.
      const started = await dispatchNextWaiting(
        { projectId: String(row.project_id), batchId: row.batch_id ? String(row.batch_id) : null },
        actor,
      );
      if (started) result.dispatched += 1;
    } catch {
      // One row's failure is not the sweep's. The next run sees it again.
      result.skipped += 1;
    }
  }

  return result;
}
