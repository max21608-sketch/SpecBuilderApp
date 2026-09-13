-- ==========================================================================
-- 0005_chase_drafts.sql — chase emails for outstanding specification info.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. The completion view can say 400 questions are outstanding and offers no
-- way to ask them. This adds the contacts to ask, the drafts that ask them, and
-- the record of which questions a given sent draft actually covered.
--
-- THE ONE DECISION THAT SHAPES EVERYTHING HERE: recording a send does NOT
-- write to spec_answers.
--
-- The obvious design is a `chased_at` column on spec_answers. It is wrong. Any
-- update to that table fires bump_version, so marking a question as chased
-- silently invalidates every extraction snapshot pointing at that answer (M2
-- stages a proposal against spec_answers.version and refuses to commit if it
-- moved) — for a reason that has nothing to do with the answer. It also writes
-- a communication event into a business record.
--
-- So "waiting for a reply" is DERIVED: a question is waiting when it is still
-- outstanding and some sent, tracking-eligible draft item still matches it.
-- That is what email_draft_items.snapshot_answer_version and context_snapshot
-- are for.
--
-- A consequence worth writing down, because the email-draft-and-send-gate
-- skill says otherwise: undo does NOT require `version = snapshot + 1`. That
-- rule exists in the fabric-ordering app because confirming a send there
-- mutates the covered business rows, so exactly one bump proves nothing else
-- touched them. Nothing is mutated here, so there is no bump to count. Undo
-- voids the draft and leaves every answer alone.
-- ==========================================================================

begin;

-- ---- project_contacts -----------------------------------------------------
-- Who gets chased. email is NULLABLE on purpose: a KAM should be able to model
-- "the LCS design team owe us these answers" before anyone has dug the address
-- out of Outlook, and then fill it in from the draft card. A draft with no
-- resolved address is blocked from being recorded as sent, which is the right
-- place to stop it — not at the point of naming the contact.
--
-- designer_code joins to spec_records.designer ('LCS', 'TA'), which is free
-- text copied from the BOQ. It is stored trimmed and uppercased so the join is
-- an equality test rather than a fuzzy match; the display name lives in `name`.
create table project_contacts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  name           text not null,
  email          text,
  organisation   text,
  role           text not null,
  designer_code  text,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,
  constraint project_contacts_role_check check (role in ('designer', 'client', 'internal')),
  constraint project_contacts_name_present check (btrim(name) <> ''),
  -- Uppercased and trimmed at the constraint, not just in application code, so
  -- a row inserted by a script cannot create a second 'lcs' that the join misses.
  constraint project_contacts_designer_code_normalised
    check (designer_code is null or designer_code = upper(btrim(designer_code))),
  constraint project_contacts_designer_code_present
    check (designer_code is null or btrim(designer_code) <> ''),
  -- A single mailbox, not a header fragment. eml.ts strips CR/LF from address
  -- headers as defence in depth; this stops the value being stored at all.
  constraint project_contacts_email_shape
    check (email is null or email ~ '^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$'),
  -- Referenced by the composite foreign key on email_drafts below, so a draft
  -- cannot point at a contact belonging to a different project.
  constraint project_contacts_id_project_key unique (id, project_id)
);

-- One default contact per designer code per project. Additional contacts for
-- the same organisation simply carry a null code and are chosen explicitly.
create unique index project_contacts_designer_code_idx
  on project_contacts (project_id, designer_code)
  where designer_code is not null;

create index project_contacts_project_idx on project_contacts (project_id);

-- ---- email_drafts ---------------------------------------------------------
-- status is four values, and 'superseded' is the interesting one.
--
-- Regenerating could delete the previous draft rows. It must not: deleting
-- destroys what a reviewer in another tab is currently looking at, and leaves
-- that tab with a 404 instead of a conflict it can explain. Superseding keeps
-- the row, keeps its coverage, and makes the stale tab's next write fail with
-- something a human can act on.
--
-- That is also why there is no generation_token here. The fabric-ordering app
-- needs one because its FR route UPSERTS a draft in place, so "version N+1
-- exists" cannot prove its own write won. Generation here only ever inserts new
-- rows, so there is no such ambiguity to resolve.
--
-- intro_text/closing_text are PLAIN TEXT and are the only editable prose. The
-- question table is generated from the coverage rows. That is what makes "the
-- email says exactly what the coverage table says" a structural property rather
-- than a convention — and it avoids accepting arbitrary HTML into a message a
-- human then sends from their own mailbox.
create table email_drafts (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete restrict,
  -- NOT NULL: a group of records whose designer has no contact is reported as
  -- blocked and produces no draft at all. A draft without a recipient would be
  -- a thing you can neither send nor explain.
  contact_id          uuid not null,
  kind                text not null default 'chase',
  status              text not null default 'draft',

  intro_text          text not null default '',
  closing_text        text not null default '',
  subject             text not null,
  body                text not null,
  body_format         text not null default 'html',
  template_version    integer not null default 1,

  -- Snapshots taken at generation. A draft must render the same way tomorrow
  -- as it did when it was reviewed, even if the contact is renamed after.
  recipient_name      text,
  recipient_email     text,
  cc_email            text,
  contact_version     integer,
  project_label       text not null,
  generated_at        timestamptz not null default now(),

  manually_edited_at  timestamptz,
  manually_edited_by  text,

  sent_at             timestamptz,
  sent_by             text,
  voided_at           timestamptz,
  voided_by           text,
  void_reason         text,
  -- False for a draft recorded as sent whose coverage was already stale. It
  -- keeps the evidence without ever letting those questions read as Waiting.
  tracking_eligible   boolean not null default true,

  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          text,
  updated_by          text,

  constraint email_drafts_kind_check check (kind in ('chase')),
  constraint email_drafts_status_check check (status in ('draft', 'sent', 'voided', 'superseded')),
  constraint email_drafts_body_format_check check (body_format in ('html')),
  constraint email_drafts_contact_same_project
    foreign key (contact_id, project_id) references project_contacts (id, project_id) on delete restrict,
  constraint email_drafts_sent_has_actor
    check (status <> 'sent' or (sent_at is not null and sent_by is not null)),
  constraint email_drafts_voided_has_actor
    check (voided_at is null or voided_by is not null),
  -- A voided draft keeps its send metadata: it is the record of what was sent,
  -- annotated with the fact that the confirmation was withdrawn.
  constraint email_drafts_voided_was_sent
    check (status <> 'voided' or sent_at is not null)
);

create index email_drafts_project_status_idx on email_drafts (project_id, status, generated_at desc);
create index email_drafts_contact_idx on email_drafts (contact_id);

-- Content of a draft that is no longer 'draft' is history. Enforced here as
-- well as in the routes, because the whole value of the coverage snapshot is
-- that the stored body and the stored coverage cannot drift apart after the
-- fact. Only the documented sent -> voided metadata transition is allowed.
create or replace function prevent_settled_draft_change() returns trigger as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if old.status = 'sent' and new.status = 'voided' then
    if new.subject is distinct from old.subject
       or new.body is distinct from old.body
       or new.intro_text is distinct from old.intro_text
       or new.closing_text is distinct from old.closing_text
       or new.recipient_email is distinct from old.recipient_email
       or new.cc_email is distinct from old.cc_email
       or new.sent_at is distinct from old.sent_at
       or new.sent_by is distinct from old.sent_by then
      raise exception 'A sent draft may be voided, but its content and send record cannot be changed';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'A % draft cannot be moved to %', old.status, new.status;
  end if;

  if new.subject is distinct from old.subject
     or new.body is distinct from old.body
     or new.intro_text is distinct from old.intro_text
     or new.closing_text is distinct from old.closing_text
     or new.recipient_email is distinct from old.recipient_email
     or new.cc_email is distinct from old.cc_email then
    raise exception 'A % draft is history and cannot be edited', old.status;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger email_drafts_settled_immutable before update on email_drafts
  for each row execute function prevent_settled_draft_change();

-- ---- email_draft_items ----------------------------------------------------
-- Which questions a draft covers, and everything needed to tell later whether
-- it still describes reality.
--
-- Question identity is (record_id, requirement_id, revision_no) — NOT the
-- answer id. A question with no answer row at all is `missing`, is the most
-- common thing worth chasing, and must be coverable. The completion queries
-- already drive from requirements and LEFT JOIN answers, so this matches.
--
-- answer_id and snapshot_answer_version are therefore nullable, together: a
-- null pair is a positive assertion that no answer row existed at generation
-- time. If one appears later, the coverage is stale, which is correct.
--
-- context_snapshot carries what the email actually SAID about the question —
-- category, designer code, record label/area/refs, the prompt, the field label.
-- spec_answers has a version; requirements and spec_record_refs do not, so an
-- edited prompt or a corrected client ref would otherwise be invisible to the
-- staleness check. Compare normalised structured values, never rendered HTML.
create table email_draft_items (
  id                     uuid primary key default gen_random_uuid(),
  draft_id               uuid not null references email_drafts(id) on delete cascade,
  record_id              uuid not null references spec_records(id) on delete restrict,
  requirement_id         uuid not null references requirements(id) on delete restrict,
  revision_no            smallint not null default 0,
  answer_id              uuid references spec_answers(id) on delete restrict,
  snapshot_answer_version integer,
  record_version         integer not null,
  context_snapshot       jsonb not null,
  prompt_text            text not null,
  field_label            text,
  current_value_text     text,
  sort_order             integer not null,
  created_at             timestamptz not null default now(),
  created_by             text,
  constraint email_draft_items_question_key unique (draft_id, record_id, requirement_id, revision_no),
  constraint email_draft_items_answer_pair
    check ((answer_id is null) = (snapshot_answer_version is null))
);

create index email_draft_items_draft_idx on email_draft_items (draft_id, sort_order);
-- The Waiting query walks from a question to the sent drafts covering it.
create index email_draft_items_question_idx
  on email_draft_items (record_id, requirement_id, revision_no);
create index email_draft_items_answer_idx on email_draft_items (answer_id) where answer_id is not null;

-- Coverage is written once, with its draft, and is never edited. An edit that
-- changes which questions are covered rewrites the whole draft.
create or replace function prevent_draft_item_change() returns trigger as $$
begin
  raise exception 'Draft coverage is written once with its draft and cannot be updated';
end;
$$ language plpgsql;

create trigger email_draft_items_immutable before update on email_draft_items
  for each row execute function prevent_draft_item_change();

-- ---- triggers -------------------------------------------------------------
-- email_draft_items gets audit only: it has no updated_at (written once) and no
-- version (it is not independently editable).
do $$
declare t text;
begin
  foreach t in array array['project_contacts', 'email_drafts', 'email_draft_items'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
  end loop;

  foreach t in array array['project_contacts', 'email_drafts'] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);

    execute format('drop trigger if exists %I_bump_version on %I', t, t);
    execute format('create trigger %I_bump_version before update on %I
                    for each row execute function bump_version()', t, t);
  end loop;
end $$;

commit;
