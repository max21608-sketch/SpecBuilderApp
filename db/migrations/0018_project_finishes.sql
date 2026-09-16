-- ==========================================================================
-- 0018_project_finishes.sql
--
-- WHY, AND WHY THE EXCLUSION IS BEING REVERSED.
--
-- CLAUDE.md lists `project_materials` under "Not built, deliberately": the
-- client's own CH-01.1 codes are "kept verbatim on the attribute until there
-- is a register worth resolving them against". docs/stack.md gives the
-- unblocking condition in its own words: "Resolving codes is deferred until
-- extraction is producing them."
--
-- Extraction IS producing them. `record_attributes.material_code` has been
-- filled from the Panther shop drawings since M2, and it is a dead column: no
-- index, no uniqueness, no edit path at any stage (the staged review cannot
-- correct a mis-read code, and there is no update statement against the table
-- at all), and no way to ask which items carry a given code. Ten items sharing
-- a fabric are ten unrelated strings.
--
-- And the thing that makes it urgent rather than tidy: the finishes schedule
-- for the pilot is CONFIRMED ABSENT (docs/plans/README.md open item 5). The
-- codes exist only on the drawings, so edit-once-and-propagate is the ONLY
-- correction mechanism available, not a convenience.
--
-- ---- THE NAME -----------------------------------------------------------
--
-- Called `project_finishes`, not `project_materials`. "Finishes" is the word
-- the KAM uses and the screen is the finishes library. The invariant
-- CLAUDE.md attached to the old name carries over unchanged and is the reason
-- for the unique index below: PROJECT-SCOPED, because the same client code
-- (MOR005) means different things on different projects, and a register that
-- was not scoped would be silently wrong.
--
-- ---- WHAT IS DELIBERATELY WEAK -----------------------------------------
--
-- `code_norm` folds case and whitespace and NOTHING ELSE. CH-01.1 and CH-01-1
-- stay two finishes. A normaliser clever enough to merge them is clever enough
-- to merge two codes a client meant to keep apart, and merging is a human
-- action with a button.
--
-- `kind` is NULLABLE and is not inferred at backfill. classifyGroup already
-- guesses an attr_group from words in the label, and stacking a second guess
-- on top of it would produce a register full of confident mistakes. Blank
-- until a person says.
--
-- `supplier_raw` keeps the source's own wording, `TO BID` included.
-- CLAUDE.md's "suppliers by modelled Capsule ID, never free-text name" is NOT
-- satisfied by this and is not claimed to be: there is no supplier register in
-- this app and no Capsule data in this repo. The `_raw` suffix is the marker
-- that this is what a document said rather than something resolved.
-- ==========================================================================

begin;

create table project_finishes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,

  -- The client's code exactly as their document writes it.
  code         text not null,
  -- Upper-cased, trimmed, internal whitespace collapsed. Nothing else.
  code_norm    text not null,

  kind         text,
  description  text,
  supplier_raw text,
  reference    text,
  colour       text,
  notes        text,

  -- `tbc` is the honest default for a backfilled code: the drawings named it,
  -- nobody has confirmed what it is. It reaches the export as TBC, and a
  -- checklist answer promoted from it can never be `confirmed`.
  state        text not null default 'tbc',

  status       text not null default 'active',
  retired_at   timestamptz,
  retired_by   text,

  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  updated_by   text,

  constraint project_finishes_code_not_blank check (btrim(code) <> ''),
  constraint project_finishes_norm_not_blank check (btrim(code_norm) <> ''),
  constraint project_finishes_kind_check check (
    kind is null or kind in ('fabric', 'leather', 'timber', 'metal', 'stone', 'glass', 'paint', 'other')
  ),
  constraint project_finishes_state_check check (state in ('confirmed', 'tbc')),
  constraint project_finishes_status_check check (status in ('active', 'retired')),
  constraint project_finishes_retired_has_actor
    check (status <> 'retired' or (retired_at is not null and retired_by is not null)),
  -- A confirmed finish has to say what it IS. A confirmed row with no
  -- description is the "confidently wrong" state this register exists to avoid.
  constraint project_finishes_confirmed_has_description
    check (state <> 'confirmed' or (description is not null and btrim(description) <> ''))
);

-- PROJECT-SCOPED, and only among active rows, so a retired code can be
-- re-created without first deleting history.
create unique index project_finishes_code_key
  on project_finishes (project_id, code_norm) where status = 'active';
create index project_finishes_project_idx on project_finishes (project_id, code_norm);

-- ---- the link -----------------------------------------------------------
-- `restrict`, not `cascade` or `set null`: a finish with items on it cannot be
-- deleted out from under them. Retiring is the way out, and it is refused
-- while anything is still linked.
alter table record_attributes
  add column finish_id uuid references project_finishes(id) on delete restrict;

create index record_attributes_finish_idx
  on record_attributes (finish_id) where finish_id is not null;

-- ---- triggers -----------------------------------------------------------
create trigger project_finishes_audit after insert or update or delete on project_finishes
  for each row execute function write_audit();
create trigger project_finishes_updated_at before update on project_finishes
  for each row execute function set_updated_at();
create trigger project_finishes_version before update on project_finishes
  for each row execute function bump_version();

commit;
