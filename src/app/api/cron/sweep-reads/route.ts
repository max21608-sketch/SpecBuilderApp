// Close extraction attempts nobody will finish, and let the packs behind them
// move on.
//
// THE TRIGGER, AND NOTHING ELSE. The whole of the decision is in
// `src/lib/extraction-sweep.ts`; this route authenticates the caller and
// reports what the sweep did. It starts no read of its own — the only reads it
// can cause are the ones the cap already deferred and promised, started through
// `dispatchNextWaiting` in the usual commit-then-publish order.
//
// WHY HOURLY, AND NOT EVERY QUARTER-HOUR LIKE THE MAIL DELTA. What it settles
// is already a day old, so nothing is gained by finding it fifteen minutes
// sooner; and it runs against every pack in the database, where the delta walks
// one mailbox. The offset minute keeps it off the hour, where `graph-renew`
// runs.
//
// It is safe to run at any time and safe to run twice: everything it writes is
// fenced on the attempt it read, so a second concurrent sweep settles nothing
// the first one already took.
import { json } from "@/lib/db";
import { sweepExpiredReads } from "@/lib/extraction-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Who the trail says closed these. Not a person: nobody pressed anything, and
 * an actor naming one would put a decision on somebody who did not take it.
 */
const ACTOR = "system:read-sweeper";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return json({ ok: false, error: "unauthorised" }, 401);
  return json({ ok: true, ...(await sweepExpiredReads(ACTOR)) });
}
