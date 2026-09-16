-- ==========================================================================
-- 0023_graph_subscriptions.sql -- the app mailbox's subscription, and where
-- the delta got to.
--
-- WHY. Microsoft Graph tells us about new mail by calling a webhook, and that
-- subscription EXPIRES — messages cap out around 4230 minutes, under three
-- days. A renewal that does not happen is not an error anybody sees: mail
-- simply stops arriving, and the person waiting for a specification notices
-- days later. So the subscription's state is a row, with its expiry, its last
-- notification and its last error, and a cron reads it.
--
-- ---- WHY THE DELTA LINK IS HERE TOO --------------------------------------
--
-- A webhook is a speed optimisation, not a guarantee. Graph drops
-- notifications (it says so, and sends a `missed` lifecycle event when it
-- notices), a deploy can be mid-flight, and a subscription can lapse. The
-- delta query is the guarantee: it walks what actually changed since the last
-- token, so a message that never produced a notification is still ingested on
-- the next poll. Belt and braces, and the braces are the cheap one.
--
-- `delta_synced_at` exists so the link can only move FORWARD. Two overlapping
-- polls can finish out of order, and an older link overwriting a newer one
-- would re-walk mail that has already been ingested.
--
-- ---- THE CLIENT STATE IS HASHED ------------------------------------------
--
-- `clientState` is the shared secret Graph echoes back in every notification,
-- and it is how the webhook knows a request is really Graph's. The SECRET
-- lives in the environment; this column holds a SHA-256 of it, so a database
-- dump does not hand somebody the ability to post convincing notifications.
-- ==========================================================================

begin;

create table graph_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  mailbox               text not null,
  resource              text not null,
  subscription_id       text unique,
  client_state_hash     text not null,
  notification_url      text not null,
  status                text not null,
  expires_at            timestamptz,
  last_renewed_at       timestamptz,
  last_notification_at  timestamptz,
  last_error            text,
  delta_link            text,
  delta_synced_at       timestamptz,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            text,
  updated_by            text,

  constraint graph_subscriptions_status_check
    check (status in ('active', 'expired', 'removed', 'reauth_required', 'error', 'disabled')),
  -- One subscription per mailbox per resource. A second would deliver every
  -- message twice, which the ingestion idempotency key survives but which
  -- doubles the notification traffic for no gain.
  constraint graph_subscriptions_mailbox_resource_key unique (mailbox, resource)
);

create trigger graph_subscriptions_audit
  after insert or update or delete on graph_subscriptions
  for each row execute function write_audit();
create trigger graph_subscriptions_updated_at before update on graph_subscriptions
  for each row execute function set_updated_at();
create trigger graph_subscriptions_version before update on graph_subscriptions
  for each row execute function bump_version();

commit;
