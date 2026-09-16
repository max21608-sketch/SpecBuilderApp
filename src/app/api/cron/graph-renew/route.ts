// Keep the app mailbox's subscription alive.
//
// A Graph subscription expires in under three days and fails SILENTLY: mail
// stops arriving and nobody is paged. This runs every twelve hours against a
// lifetime of roughly sixty-six, so one failed run is not an outage and a day
// of failed runs still is not.
//
// No session: crons are excluded from the middleware and authenticate with
// CRON_SECRET, the same protocol the queue consumer uses with its own.
import { json } from "@/lib/db";
import { mailIngestionEnabled } from "@/lib/graph-client";
import { ensureSubscription } from "@/lib/graph-subscriptions";

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
  // Not an error: this is the normal state of every deployment until somebody
  // deliberately turns ingestion on.
  if (!mailIngestionEnabled()) return json({ ok: true, skipped: "disabled" }, 200);

  const result = await ensureSubscription(ACTOR);
  return json({ ok: result.action !== "failed", ...result }, result.action === "failed" ? 502 : 200);
}
