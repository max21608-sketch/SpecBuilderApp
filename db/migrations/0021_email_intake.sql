-- ==========================================================================
-- 0021_email_intake.sql -- an email is a specification document.
--
-- WHY. Specification information arrives by email constantly: a designer
-- answers a chase, a client changes a fabric, somebody confirms a dimension
-- that was TBC. Today none of it reaches the record except by a person reading
-- the message and retyping the value, and the record then says a value exists
-- without saying anything about where it came from.
--
-- ---- WHY THIS IS NOT A NEW PIPELINE --------------------------------------
--
-- An email is read by the model into PROPOSED changes, staged, reviewed by a
-- human, and confirmed — which is exactly what `intake_runs` already does for
-- an FF&E schedule. So `document_kind` gains `'email'` and nothing else about
-- the claim protocol, the review screen or the confirm boundary changes.
-- 0007's header rule holds: a new kind goes under `source_kind =
-- 'spec_document'`, never beside it, or it opts out of every guard at once.
--
-- The confirm writes `spec_answers.source_kind = 'email'`, a value 0002's
-- CHECK has allowed since the beginning and nothing has ever written, and opens
-- a change set of kind `email_confirm` carrying the message as evidence. "This
-- spec changed on the 16th because of this email, and here is the email" is
-- then a query rather than a memory.
--
-- ---- WHY A NEW TABLE AND NOT `messages` ----------------------------------
--
-- 0001's `messages` is a polymorphic chassis table: `entity_type`/`entity_id`
-- are NOT NULL, and an email that has just arrived belongs to nothing — which
-- project it concerns is the first thing that has to be worked out and
-- sometimes cannot be. It also has no routing state, no fetch state, no
-- pointer to the stored MIME, and one Graph id where several are needed.
-- Bending it would mean every read filtering on a convention. It stays unused.
--
-- ---- WHAT IS DELIBERATELY NULLABLE ---------------------------------------
--
-- `project_id` and everything about assignment: a message whose project cannot
-- be determined from its headers is HELD, listed, and assigned by a person.
-- Never guessed. `routing_candidates` keeps what the guess would have been so
-- the screen can show its working.
--
-- `email_messages` is correspondence, not spec content: it is not in the four
-- tables the change-set coverage assertion watches, and writing one changes no
-- record.
-- ==========================================================================

begin;

create table email_messages (
  id                    uuid primary key default gen_random_uuid(),

  -- Which mailbox it arrived in, and how. 'upload' is a person attaching a
  -- saved .eml; 'graph' is the app mailbox subscription.
  mailbox               text not null,
  origin                text not null,
  fetch_status          text not null default 'fetched',
  fetch_error           text,

  -- Identity. `graph_message_id` is per mailbox and is the idempotency key for
  -- ingestion; `internet_message_id` is the RFC 5322 Message-ID and survives
  -- forwarding, so it is how the same mail arriving twice by two routes is
  -- recognised.
  graph_message_id      text,
  internet_message_id   text,
  conversation_id       text,
  in_reply_to           text,
  references_raw        text,

  -- The envelope, as the message stated it.
  from_addr             text,
  from_name             text,
  to_addrs              jsonb not null default '[]'::jsonb,
  cc_addrs              jsonb not null default '[]'::jsonb,
  reply_to_addrs        jsonb not null default '[]'::jsonb,
  subject               text,
  received_at           timestamptz,
  has_attachments       boolean not null default false,
  attachments_meta      jsonb not null default '[]'::jsonb,
  -- Every header, verbatim. The routing evidence points into this: "assigned
  -- because X-MS-Exchange-Inbox-Rules-Loop named this project's inbox" is only
  -- checkable if the header is still here.
  headers_raw           jsonb,

  body_text             text,
  body_truncated        boolean not null default false,
  parse_error           text,

  -- The message itself, kept whole. A parsed body is a reading of the email;
  -- the .eml is the email, and it is what a reviewer opens in Outlook when
  -- somebody says they never asked for this.
  mime_attachment_id    uuid,          -- attachments row; no FK, that table is polymorphic
  mailbox_storage_path  text,          -- pre-assignment location, outside any project prefix
  mime_size             bigint,
  mime_sha256           text,
  mime_stored           boolean not null default true,
  mime_error            text,

  -- Which project, and how we decided.
  routing_status        text not null,
  routing_reason        text,
  routing_candidates    jsonb not null default '[]'::jsonb,
  project_id            uuid references projects(id) on delete set null,
  assigned_by           text,
  assigned_at           timestamptz,
  assignment_kind       text,

  intake_run_id         uuid references intake_runs(id) on delete set null,

  -- The chase this reads as a reply to, where it does. A hint on the review
  -- screen and a register of preferred targets for the resolver; never a claim.
  chase_draft_id        uuid references email_drafts(id) on delete set null,
  chase_match           text,

  -- A message a reviewer has ruled on without it changing anything. Kept, not
  -- dropped: dismissing is a decision, taken once, and every dismissal in this
  -- app is reversible.
  triage                text not null default 'open',
  triaged_by            text,
  triaged_at            timestamptz,

  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            text,
  updated_by            text,

  constraint email_messages_origin_check check (origin in ('graph', 'upload')),
  constraint email_messages_fetch_check check (fetch_status in ('pending', 'fetched', 'gone', 'failed')),
  constraint email_messages_routing_check check (routing_status in ('assigned', 'ambiguous', 'unassigned')),

  -- Assigned means assigned: a project, an actor, a time, and how.
  constraint email_messages_assigned_has_project
    check ((routing_status = 'assigned') = (project_id is not null)),
  constraint email_messages_assigned_has_actor
    check (routing_status <> 'assigned'
           or (assigned_by is not null and assigned_at is not null and assignment_kind in ('auto', 'manual'))),
  constraint email_messages_graph_has_id
    check (origin <> 'graph' or graph_message_id is not null),
  constraint email_messages_triage_check
    check (triage in ('open', 'nothing_to_record', 'not_specification')),
  constraint email_messages_triaged_has_actor
    check (triage = 'open' or (triaged_by is not null and triaged_at is not null)),
  constraint email_messages_chase_match_check
    check (chase_match is null or chase_match in ('confident', 'sender_only', 'subject_only'))
);

-- The ingestion idempotency key. Graph redelivers, a notification and a delta
-- poll can both name the same message, and neither may produce a second row.
create unique index email_messages_graph_key
  on email_messages (mailbox, graph_message_id) where graph_message_id is not null;

create index email_messages_project_idx
  on email_messages (project_id, received_at desc) where project_id is not null;
-- The Unassigned list: what a person still has to place.
create index email_messages_held_idx
  on email_messages (routing_status, received_at desc) where routing_status <> 'assigned';
create index email_messages_internet_id_idx
  on email_messages (internet_message_id) where internet_message_id is not null;
create index email_messages_run_idx
  on email_messages (intake_run_id) where intake_run_id is not null;

-- ---- the new document kind ------------------------------------------------
alter table intake_runs drop constraint intake_runs_document_kind_check;
alter table intake_runs add constraint intake_runs_document_kind_check check (
  case source_kind
    when 'spec_document' then document_kind in
      ('ffe_schedule', 'finishes_schedule', 'fabric_schedule', 'spec_bible',
       'preamble', 'shop_drawings', 'email', 'other')
    else document_kind is null
  end
);

-- ---- the change a confirmed email makes -----------------------------------
-- Re-listed in full: the CHECK is the vocabulary, and a partial ALTER would
-- leave src/lib/change-sets.ts describing a different set.
alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins', 'email_confirm'
));

create trigger email_messages_audit
  after insert or update or delete on email_messages
  for each row execute function write_audit();
create trigger email_messages_updated_at before update on email_messages
  for each row execute function set_updated_at();
create trigger email_messages_version before update on email_messages
  for each row execute function bump_version();

commit;
