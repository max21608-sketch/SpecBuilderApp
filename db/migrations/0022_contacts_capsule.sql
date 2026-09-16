-- ==========================================================================
-- 0022_contacts_capsule.sql -- a contact is a person in Capsule.
--
-- WHY. `project_contacts` holds a name and an email typed into a form. Two
-- people typing the same designer produce two spellings, a corrected address
-- in Capsule never reaches this app, and nothing ties the person we chase to
-- the person the business already knows. CLAUDE.md's invariant is
-- "SUPPLIERS BY MODELLED CAPSULE ID, never free-text name"; the same reasoning
-- applies to people, and Capsule is where the company's contacts live.
--
-- ---- READ-ONLY, BY CONSTRUCTION AND BY POLICY ----------------------------
--
-- This app SEARCHES and READS Capsule. It never creates or updates a party.
-- `src/lib/capsule.ts` has exactly one HTTP helper and it hard-codes GET;
-- there is no write verb in the module and a test asserts the export surface,
-- because "we only call GET" is a habit and an absent function is a fact.
--
-- ---- WHY THE LINK IS OPTIONAL --------------------------------------------
--
-- A contact with no Capsule party is FLAGGED, not refused. A designer whose
-- practice Capsule has never heard of still has to be chaseable today, and a
-- tool that refuses to record them just moves the record into somebody's head.
-- The screen counts the unlinked ones so the gap is visible rather than
-- comfortable.
--
-- ---- WHY THE CACHED FIELDS STAY ------------------------------------------
--
-- `name`, `email` and `organisation` remain on the row and are what the app
-- reads. Capsule is not a runtime dependency of the chase screen: an outage
-- there must not stop somebody sending an email. `capsule_synced_at` says how
-- old the copy is, and refreshing is a deliberate read.
--
-- `recipient_capsule_party_id` on a draft is a SNAPSHOT, like
-- `recipient_email` beside it: it records who the email was addressed to, and
-- correcting the contact afterwards must not rewrite what was sent.
-- ==========================================================================

begin;

alter table project_contacts
  add column capsule_party_id   bigint,
  add column capsule_party_type text,
  add column capsule_synced_at  timestamptz;

alter table project_contacts
  add constraint project_contacts_capsule_type_check
  check (capsule_party_type is null or capsule_party_type in ('person', 'organisation'));

-- All three together or none. A party id with no sync time is a link nobody
-- can date, and a sync time with no id is a read of nothing.
alter table project_contacts
  add constraint project_contacts_capsule_pair
  check (
    (capsule_party_id is null) = (capsule_synced_at is null)
    and (capsule_party_id is null) = (capsule_party_type is null)
  );

-- PROJECT-SCOPED, like the contact itself: the same Capsule person is
-- legitimately a contact on many projects, and each of those rows carries its
-- own designer code and role.
create unique index project_contacts_capsule_idx
  on project_contacts (project_id, capsule_party_id) where capsule_party_id is not null;

-- Inbound mail matches a sender to a contact, case-insensitively: an address
-- is not case-sensitive in its domain and rarely in practice in its local part.
create index project_contacts_email_idx
  on project_contacts (project_id, lower(email)) where email is not null;

alter table email_drafts add column recipient_capsule_party_id bigint;

comment on column project_contacts.capsule_party_id is
  'Capsule party id. Read-only: this app never creates or updates a party.';

commit;
