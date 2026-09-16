// Walk what actually changed in the app mailbox.
//
// The webhook is a speed optimisation; THIS is the guarantee. Graph drops
// notifications, a deploy can be mid-flight, a subscription can lapse — and
// every one of those failures is silent. The delta query asks what changed
// since the last token, so a message that never produced a notification is
// still ingested on the next quarter-hour.
//
// It enqueues; it never reads a message itself. Anything already ingested is
// recognised by the unique key on (mailbox, graph_message_id) and costs
// nothing.
import { json } from "@/lib/db";
import { mailIngestionEnabled } from "@/lib/graph-client";
import { runDeltaCatchUp } from "@/lib/graph-subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTOR = "system:microsoft-graph";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return json({ ok: false, error: "unauthorised" }, 401);
  if (!mailIngestionEnabled()) return json({ ok: true, skipped: "disabled" }, 200);

  return json({ ok: true, ...(await runDeltaCatchUp(ACTOR)) });
}
