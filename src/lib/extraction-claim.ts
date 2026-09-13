// Who owns an extraction attempt, and for how long.
//
// ============================================================================
// TWO IDENTIFIERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS
//
//   attempt_id   a LOGICAL attempt. The producer mints it, the queue message
//                carries it, and every worker write is fenced on it — so a
//                delivery belonging to a superseded attempt writes zero rows
//                instead of clobbering the live one.
//   claim_token  ONE WORKER INVOCATION inside that attempt. A hard-killed
//                worker leaves a claim behind; after CLAIM_EXPIRY_SECONDS a
//                later delivery reclaims the SAME attempt with a NEW token. If
//                the "dead" worker was only slow — its request still in flight —
//                its writes now match no token and affect nothing.
//
// A claim alone cannot give exactly-once BILLING. It bounds the damage: at most
// MAX_CLAIMS_PER_ATTEMPT model calls per attempt, and a duplicate delivery
// cannot bill concurrently with a live claim. An ambiguous failure can still
// cost a second call. docs/stack.md says so plainly rather than implying the
// claim prevents it.
//
// ============================================================================
// THE TIMING INEQUALITIES ARE THE CONTRACT, not tuning:
//
//   MODEL_DEADLINE (240s)  <  RUN_ABORT (270s)  <  MAX_DURATION (300s)
//     the model gives up in time for the run to persist WHY, and the run gives
//     up in time for the platform not to kill it mid-write.
//
//   CLAIM_EXPIRY (360s)  >  MAX_DURATION (300s)
//     a claim cannot expire while its own invocation is legitimately still
//     running, or two workers race for one attempt and both pay.
//
//   VISIBILITY_TIMEOUT (600s)  >  CLAIM_EXPIRY (360s)
//     the message does not come back before the claim it left behind can be
//     taken, or every redelivery is a guaranteed busy no-op.
//
// tests/lib/extraction-timing.test.ts asserts each of these. Change one number
// and that test tells you which of the others it just broke.
// ============================================================================

/** Must equal `maxDuration` on the queue route and in vercel.json. */
export const MAX_DURATION_SECONDS = 300;

/** The run's own abort target, leaving room to write the failure down. */
export const RUN_ABORT_MS = 270_000;

/** Passed to the model call. Preflight is subtracted from it by the caller. */
export const MODEL_DEADLINE_MS = 240_000;

/** After this, a `parsing` row is presumed abandoned and can be reclaimed. */
export const CLAIM_EXPIRY_SECONDS = 360;

/** Must equal `visibilityTimeoutSeconds` on the consumer. */
export const VISIBILITY_TIMEOUT_SECONDS = 600;

/**
 * How many times ONE attempt may be claimed. Equal to the delivery cap, because
 * each delivery is a potential paid call and this is the ceiling on what a
 * single press of Extract can cost.
 */
export const MAX_CLAIMS_PER_ATTEMPT = 4;

/** Must equal `maxDeliveries` on the trigger in vercel.json. */
export const MAX_DELIVERIES = 4;

/** An attempt nobody completed in a day is not going to be completed. */
export const ATTEMPT_DEADLINE_HOURS = 24;

/**
 * What a worker did with the run it was handed.
 *
 *   parsed   staged a result
 *   failed   terminal for this attempt; written down
 *   busy     SOMEONE ELSE HOLDS A LIVE CLAIM. Not a success: the caller throws
 *            so the message is redelivered, because by the next delivery either
 *            the work is done (and that delivery skips) or the claim has
 *            expired (and that delivery is the recovery). Acking it here would
 *            spend the delivery that recovery depends on and leave a killed
 *            worker's run stuck until a human noticed.
 *   skipped  nothing to do — superseded attempt, already terminal, already
 *            staged, deadline passed, or claim budget spent.
 */
export type ExtractionRunOutcome =
  | { outcome: "parsed" }
  | { outcome: "failed"; error: string }
  | { outcome: "busy"; reason: string }
  | { outcome: "skipped"; reason: string };
