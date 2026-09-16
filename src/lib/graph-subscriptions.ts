// Keeping the app mailbox's change subscription alive, and catching what it
// misses.
//
// ============================================================================
// THE WEBHOOK IS THE SPEED; THE DELTA POLL IS THE GUARANTEE
//
// A Graph subscription expires in under three days, drops notifications, and
// fails silently: mail simply stops arriving and the person waiting for a
// specification finds out days later. So there are two mechanisms and they are
// not redundant —
//
//   * the subscription, renewed by cron well before expiry, which makes a
//     message appear in seconds;
//   * the delta query, walked by cron every quarter hour, which asks what
//     ACTUALLY changed since the last token and therefore catches anything the
//     notification path lost.
//
// The delta link only ever moves forward (`delta_synced_at`), because two
// overlapping polls can finish out of order and an older link would re-walk
// mail that has already been ingested.
// ============================================================================
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import {
  GraphError,
  GraphNotConfiguredError,
  assertGraphId,
  graphJson,
  graphMailbox,
  mailIngestionEnabled,
  mailboxPath,
} from "@/lib/graph-client";
import { enqueueExtractionJob, mailIngestIdempotencyKey } from "@/lib/extraction-queue";

/** Messages cap out at 4230 minutes. 4000 leaves room for a late renewal. */
export const SUBSCRIPTION_LIFETIME_MINUTES = 4000;
/** Renew with a day in hand, so one failed cron run is not an outage. */
export const RENEW_WHEN_UNDER_MINUTES = 24 * 60;

export const SUBSCRIPTION_RESOURCE = "/mailFolders/inbox/messages";

export function clientStateHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time, because a shared secret compared with `===` leaks its prefix. */
export function clientStateMatches(candidate: unknown, storedHash: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const a = Buffer.from(clientStateHash(candidate), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function notificationUrl(): string {
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new GraphNotConfiguredError();
  return `${base}/api/graph/notifications`;
}

function clientState(): string {
  const secret = process.env.GRAPH_CLIENT_STATE;
  if (!secret) throw new GraphNotConfiguredError();
  return secret;
}

type SubscriptionRow = {
  id: string;
  mailbox: string;
  subscription_id: string | null;
  client_state_hash: string;
  status: string;
  expires_at: string | null;
  delta_link: string | null;
  delta_synced_at: string | null;
};

export async function loadSubscription(mailbox: string): Promise<SubscriptionRow | null> {
  const rows = await sql`
    select id, mailbox, subscription_id, client_state_hash, status, expires_at, delta_link, delta_synced_at
    from graph_subscriptions where mailbox = ${mailbox} and resource = ${SUBSCRIPTION_RESOURCE}
  `;
  return (rows[0] as SubscriptionRow | undefined) ?? null;
}

/** The row the webhook validates against, by the id Graph sends. */
export async function loadSubscriptionByGraphId(subscriptionId: string): Promise<SubscriptionRow | null> {
  const rows = await sql`
    select id, mailbox, subscription_id, client_state_hash, status, expires_at, delta_link, delta_synced_at
    from graph_subscriptions where subscription_id = ${subscriptionId}
  `;
  return (rows[0] as SubscriptionRow | undefined) ?? null;
}

function expiry(): string {
  return new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000).toISOString();
}

export type EnsureResult = {
  action: "created" | "renewed" | "unchanged" | "disabled" | "failed";
  expiresAt: string | null;
  error?: string;
};

/**
 * Create the subscription, or renew it when it is close to expiring.
 *
 * Idempotent and safe to run on every cron tick: `unchanged` is the normal
 * answer.
 */
export async function ensureSubscription(actor: string): Promise<EnsureResult> {
  if (!mailIngestionEnabled()) return { action: "disabled", expiresAt: null };

  const mailbox = graphMailbox();
  const existing = await loadSubscription(mailbox);
  const secretHash = clientStateHash(clientState());

  const create = async (): Promise<EnsureResult> => {
    const body = await graphJson<{ id: string; expirationDateTime: string }>("/subscriptions", {
      method: "POST",
      body: {
        changeType: "created",
        notificationUrl: notificationUrl(),
        lifecycleNotificationUrl: notificationUrl(),
        resource: `users/${graphMailbox()}${SUBSCRIPTION_RESOURCE}`,
        expirationDateTime: expiry(),
        clientState: clientState(),
      },
    });
    await sql`
      insert into graph_subscriptions
        (mailbox, resource, subscription_id, client_state_hash, notification_url, status,
         expires_at, last_renewed_at, last_error, created_by, updated_by)
      values (${mailbox}, ${SUBSCRIPTION_RESOURCE}, ${body.id}, ${secretHash}, ${notificationUrl()},
              'active', ${body.expirationDateTime}, now(), null, ${actor}, ${actor})
      on conflict (mailbox, resource) do update
        set subscription_id = excluded.subscription_id,
            client_state_hash = excluded.client_state_hash,
            notification_url = excluded.notification_url,
            status = 'active',
            expires_at = excluded.expires_at,
            last_renewed_at = now(),
            last_error = null,
            updated_by = ${actor}
    `;
    return { action: "created", expiresAt: body.expirationDateTime };
  };

  if (!existing || !existing.subscription_id || existing.status === "removed") {
    return create();
  }

  const expiresAt = existing.expires_at ? new Date(existing.expires_at).getTime() : 0;
  const minutesLeft = (expiresAt - Date.now()) / 60_000;
  if (existing.status === "active" && minutesLeft > RENEW_WHEN_UNDER_MINUTES) {
    return { action: "unchanged", expiresAt: existing.expires_at };
  }

  try {
    const body = await graphJson<{ expirationDateTime: string }>(
      `/subscriptions/${encodeURIComponent(existing.subscription_id)}`,
      { method: "PATCH", body: { expirationDateTime: expiry() } },
    );
    await sql`
      update graph_subscriptions
      set status = 'active', expires_at = ${body.expirationDateTime}, last_renewed_at = now(),
          last_error = null, updated_by = ${actor}
      where id = ${existing.id}
    `;
    return { action: "renewed", expiresAt: body.expirationDateTime };
  } catch (cause) {
    // Graph forgets a subscription it has expired. Recreating is the remedy,
    // and it is the same call as the first time.
    if (cause instanceof GraphError && (cause.status === 404 || cause.status === 410)) {
      await sql`
        update graph_subscriptions set status = 'removed', last_error = ${cause.message}, updated_by = ${actor}
        where id = ${existing.id}
      `;
      return create();
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    await sql`
      update graph_subscriptions set status = 'error', last_error = ${message}, updated_by = ${actor}
      where id = ${existing.id}
    `;
    return { action: "failed", expiresAt: existing.expires_at, error: message };
  }
}

export type LifecycleEvent = {
  lifecycleEvent: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
  subscriptionId: string;
};

/**
 * What to do when Graph says the subscription needs attention.
 *
 * All three end in the same two actions — make sure a live subscription exists,
 * and walk the delta so nothing that happened in the gap is lost.
 */
export async function handleLifecycleEvent(event: LifecycleEvent, actor: string): Promise<void> {
  if (!mailIngestionEnabled()) return;

  if (event.lifecycleEvent === "subscriptionRemoved") {
    await sql`
      update graph_subscriptions set status = 'removed', last_error = 'Microsoft removed the subscription.',
          updated_by = ${actor}
      where subscription_id = ${event.subscriptionId}
    `;
  }
  if (event.lifecycleEvent === "reauthorizationRequired") {
    await sql`
      update graph_subscriptions set status = 'reauth_required', updated_by = ${actor}
      where subscription_id = ${event.subscriptionId}
    `;
  }

  await ensureSubscription(actor);
  await runDeltaCatchUp(actor);
}

type DeltaPage = {
  value: { id?: string; "@removed"?: unknown }[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

/**
 * Walk what actually changed, and enqueue anything new.
 *
 * The first run has no token, so it starts from NOW rather than from the
 * mailbox's whole history: turning ingestion on must not read and bill for
 * every message the inbox has ever held.
 */
export async function runDeltaCatchUp(actor: string): Promise<{ enqueued: number; pages: number }> {
  if (!mailIngestionEnabled()) return { enqueued: 0, pages: 0 };

  const mailbox = graphMailbox();
  const row = await loadSubscription(mailbox);
  const startedAt = new Date().toISOString();

  let next: string | null =
    row?.delta_link ??
    `${mailboxPath(SUBSCRIPTION_RESOURCE)}/delta?$select=id,receivedDateTime`;

  let enqueued = 0;
  let pages = 0;
  let deltaLink: string | null = null;

  // Bounded: a runaway backlog must not hold a cron function open to its
  // timeout. What is left is picked up by the next tick.
  while (next && pages < 20) {
    const page: DeltaPage = await graphJson<DeltaPage>(next);
    pages += 1;
    for (const item of page.value ?? []) {
      if (item["@removed"] !== undefined) continue;
      let id: string;
      try {
        id = assertGraphId(item.id);
      } catch {
        continue;
      }
      await enqueueExtractionJob(
        { kind: "mail-ingest", mailbox, graphMessageId: id, source: "delta", requestedBy: actor },
        mailIngestIdempotencyKey(mailbox, id),
      );
      enqueued += 1;
    }
    deltaLink = page["@odata.deltaLink"] ?? null;
    next = page["@odata.nextLink"] ?? null;
  }

  if (deltaLink) {
    // Monotonic: an older poll finishing last must not rewind the token.
    await sql`
      insert into graph_subscriptions
        (mailbox, resource, client_state_hash, notification_url, status, delta_link, delta_synced_at,
         created_by, updated_by)
      values (${mailbox}, ${SUBSCRIPTION_RESOURCE}, ${row?.client_state_hash ?? ""},
              ${row ? "" : ""}, ${row?.status ?? "disabled"}, ${deltaLink}, ${startedAt}, ${actor}, ${actor})
      on conflict (mailbox, resource) do update
        set delta_link = excluded.delta_link,
            delta_synced_at = excluded.delta_synced_at,
            updated_by = ${actor}
        where graph_subscriptions.delta_synced_at is null
           or graph_subscriptions.delta_synced_at < excluded.delta_synced_at
    `;
  }

  return { enqueued, pages };
}
