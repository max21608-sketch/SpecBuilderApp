-- ==========================================================================
-- 0030_spec_palettes.sql -- the closed lists a spec field offers, and an
-- honest empty row for the five this app does not hold.
--
-- WHY. Matthew's decision matrix gives eleven of its 35 fields a palette.
-- Answering a spec question in this app is a bare <input placeholder="Value">
-- (src/app/dashboard/records/[id]/page.tsx) and always has been; the only
-- <select> beside it picks the STATE. So "Indoor | Outdoor | Humid indoor
-- (spa/pool)" is typed by hand, eleven ways, and nothing downstream can tell
-- "Outdoor" from "outdoor" from "External".
--
-- ---- WHY NOT `pick_lists` -----------------------------------------------
--
-- It exists, from 0001, and it is completely dead: no seed, no query, no UI,
-- and the only reference anywhere is an existence assertion in
-- tests/db/foundation.test.ts. Its shape is (category, value, sort_order,
-- active) -- no stable key, no link to a spec field, no free-text flag, no
-- default, no sync provenance. Reviving the wrong shape to save one CREATE
-- TABLE is how a schema ends up with two overlapping registers and a rule
-- about which one wins. It stays dead and goes in the cleanup migration.
--
-- ---- THE TWO OWNERS ARE THE SAME TABLE ----------------------------------
--
-- `owner = 'app'` is a list this app holds outright, because Matthew wrote it
-- out: Indoor/Outdoor, site access, assembly guide, swivel, FR interliner,
-- stitching, yes/no.
--
-- `owner = 'bws'` is a list BWS owns and THIS APP DOES NOT HAVE: timber
-- finish, metal finish, seat build, back cushion, stud. They are seeded as
-- rows with ZERO options and a null `synced_at`, which is the honest
-- representation -- the app knows the vocabulary exists and knows it does not
-- hold it. The field renders as free text with the gap stated in words. That
-- is FMT-GEN-01: a BWS-owned vocabulary this app does not know is left blank,
-- never guessed. Inventing five plausible finish lists is the single most
-- confidently-wrong thing available here.
--
-- ---- `allows_free_text` IS NOT A WEAKENING ------------------------------
--
-- A closed list with no escape LOSES a real value: the moment a document says
-- something the list does not hold, the reviewer either picks the nearest
-- wrong option or records nothing. `house/conventions.md` §5 -- "anything
-- unresolvable becomes a visible flag, never a plausible-looking wrong
-- answer". An "Other..." answer is stored verbatim and is visibly not a
-- palette value.
--
-- ---- `is_default` PRESELECTS A CONTROL AND NEVER WRITES AN ANSWER --------
--
-- His sheet says Assembly guide is "No (default)". `spec_answers.state` has
-- four values and `missing` means NOBODY HAS LOOKED; a gate passed by a
-- default is a gate passed by nobody. So the flag is read by the screen to
-- highlight an option and by nothing else. This is assumption 5 in
-- docs/plans/matrix-assumptions.md and is still to be confirmed with him.
--
-- ---- AND `requirements.local_key` ---------------------------------------
--
-- Ten of Matthew's 35 rows carry no BWS id. Two already have a home on
-- `spec_records` (the item name, the designer reference) and two are fields
-- this app now has (`spec_description`). The remaining six are real questions
-- with no BWS column -- Headboard fitted, Fitted banquette, and the four
-- CONDITIONAL rows they reveal -- and `requirements.kind = 'readiness'` has
-- meant exactly "must be known, BWS has no column for it" since 0002.
--
-- So they become readiness requirements, and `local_key` is what ties one to
-- its row in the gate overlay. That buys answers, states, versions, change
-- sets, the checklist UI, the chase coverage and the gate for nothing. The
-- alternative -- a seventh bespoke store for six questions -- is six more
-- things that can disagree with the checklist.
-- ==========================================================================
begin;

create table spec_palettes (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,
  name             text not null,
  owner            text not null,
  -- Whether a value outside the list may be recorded. See the header: a closed
  -- list with no escape loses a real value.
  allows_free_text boolean not null default false,
  -- Where the list came from, in words. For a BWS-owned one this is the ask.
  source_note      text,
  -- Null means NEVER SYNCED, which for an owner = 'bws' row is the point:
  -- "is this current?" has to be answerable, and for these the answer today is
  -- "we have never had it".
  synced_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  constraint spec_palettes_owner_check check (owner in ('app', 'bws')),
  constraint spec_palettes_bws_never_claims_a_sync
    check (owner = 'app' or synced_at is null or source_note is not null)
);

create table spec_palette_options (
  id          uuid primary key default gen_random_uuid(),
  palette_key text not null references spec_palettes(key) on delete restrict,
  value       text not null,
  label       text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  -- What a CONTROL preselects. NOT an answer. See the header.
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text,
  constraint spec_palette_options_value_not_blank check (btrim(value) <> ''),
  constraint spec_palette_options_key unique (palette_key, value)
);

create index spec_palette_options_palette_idx on spec_palette_options (palette_key, sort_order);

-- At most one default per palette. Two defaults is a screen picking one, which
-- is the app answering a question a person has not been asked.
create unique index spec_palette_options_one_default
  on spec_palette_options (palette_key) where is_default;

-- ---- the id-less gate rows get somewhere to be answered ------------------
alter table requirements add column local_key text;

comment on column requirements.local_key is
  'Ties a readiness question to a row of spec_field_gates that carries no BWS field: headboard_fitted, socket_spec, and the rest of Matthew matrix''s ten id-less rows.';

-- One question per key per category, and only on a readiness row: a local key
-- on a spec_field requirement would be two homes for one answer.
create unique index requirements_category_local_key
  on requirements (category_id, local_key) where local_key is not null;

alter table requirements add constraint requirements_local_key_is_readiness
  check (local_key is null or kind = 'readiness');

-- ---- triggers -----------------------------------------------------------
-- Seed tables: audit and updated_at, no bump_version, like spec_fields and
-- item_categories in 0002.
do $$
declare t text;
begin
  foreach t in array array['spec_palettes', 'spec_palette_options'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

commit;
