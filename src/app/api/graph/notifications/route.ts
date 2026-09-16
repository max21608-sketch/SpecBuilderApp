// Microsoft Graph telling us a message arrived.
//
// ============================================================================
// THE ONLY PUBLIC ROUTE IN THIS APP, AND THE ONLY THING IT TRUSTS IS AN ID
//
// Graph cannot carry a session cookie, so this path is excluded from the
// middleware — a deliberate act, named exactly, and documented there. What
// replaces the session is:
//
//   * `clientState`, a shared secret Graph echoes in every notification,
//     compared in constant time against a HASH held in the database;
//   * the subscription id having to match a row we created;
//   * and then NOTHING ELSE from the body being believed. `resourceData.id` is
//     validated by shape and used to FETCH the message from Graph. Every fact
//     about the mail comes from that fetch, so a forged notification can at
//     worst ask us to re-read a message id that does not exist.
//
// Disabled deployments answer 404. There is no subscription, so anything
// arriving here is noise, and 404 tells a prober less than 403 does.
//
// ---- IT MUST ANSWER FAST -------------------------------------------------
//
// Graph's validation handshake times out in 10 seconds and it drops a
// subscription that answers slowly. So this enqueues and returns 202; nothing
// is fetched, parsed or read inside the request.
// ============================================================================
import { z } from "zod";
import { sql } from "@/lib/db";
import { assertGraphId, mailIngestionEnabled } from "@/lib/graph-client";
import {
  clientStateMatches,
  handleLifecycleEvent,
  loadSubscriptionByGraphId,
} from "@/lib/graph-subscriptions";
import { enqueueExtractionJob, mailIngestIdempotencyKey } from "@/lib/extraction-queue";

export const dynamic = "force-dynamic";
// Graph's handshake budget is 10s. Nothing here may approach it.
export const maxDuration = 10;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_NOTIFICATIONS = 100;

const Notification = z.object({
  subscriptionId: z.string().max(200).optional(),
  clientState: z.string().max(500).optional(),
  lifecycleEvent: z.enum(["reauthorizationRequired", "subscriptionRemoved", "missed"]).optional(),
  resourceData: z.object({ id: z.string().max(512).optional() }).nullish(),
});

const Body = z.object({ value: z.array(Notification).max(MAX_NOTIFICATIONS) });

const ACTOR = "system:microsoft-graph";

export async function POST(request: Request): Promise<Response> {
  if (!mailIngestionEnabled()) return new Response("Not found", { status: 404 });

  // The handshake. Graph sends this once when a subscription is created and
  // expects the token echoed as text/plain, with no body of its own.
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(raw));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const notifications = parsed.data.value;
  if (notifications.length === 0) return new Response(null, { status: 202 });

  // EVERY notification must authenticate. One bad entry fails the request:
  // a batch mixing real and forged entries is not a batch worth half-trusting.
  const subscriptions = new Map<string, Awaited<ReturnType<typeof loadSubscriptionByGraphId>>>();
  for (const notification of notifications) {
    const subscriptionId = notification.subscriptionId;
    if (!subscriptionId) return new Response("Unauthorized", { status: 401 });
    if (!subscriptions.has(subscriptionId)) {
      subscriptions.set(subscriptionId, await loadSubscriptionByGraphId(subscriptionId));
    }
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) return new Response("Unauthorized", { status: 401 });
    if (!clientStateMatches(notification.clientState, subscription.client_state_hash)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  for (const notification of notifications) {
    const subscription = subscriptions.get(notification.subscriptionId!);
    if (!subscription) continue;

    if (notification.lifecycleEvent) {
      await handleLifecycleEvent(
        { lifecycleEvent: notification.lifecycleEvent, subscriptionId: notification.subscriptionId! },
        ACTOR,
      );
      continue;
    }

    // The ONLY value taken from the payload, and it is validated by shape and
    // then used to fetch the message rather than to describe it.
    let graphMessageId: string;
    try {
      graphMessageId = assertGraphId(notification.resourceData?.id);
    } catch {
      continue;
    }

    await enqueueExtractionJob(
      {
        kind: "mail-ingest",
        mailbox: subscription.mailbox,
        graphMessageId,
        source: "notification",
        requestedBy: ACTOR,
      },
      mailIngestIdempotencyKey(subscription.mailbox, graphMessageId),
    );
  }

  // Not awaited before responding: Graph's clock is the constraint, and a
  // missed timestamp is cosmetic.
  void sql`
    update graph_subscriptions set last_notification_at = now()
    where subscription_id = any(${[...subscriptions.keys()]}::text[])
  `.catch(() => {});

  return new Response(null, { status: 202 });
}
