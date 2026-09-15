-- ==========================================================================
-- 0008_project_defaults_and_archive.sql — a per-project dimension unit, and
-- somewhere for a finished project to go.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY (1): THE UNIT QUESTION WAS ASKED ONCE PER DIMENSION, AND THAT IS
-- UNUSABLE AT REAL VOLUME.
--
-- 0007 made `record_attributes.unit` a human decision presented as a choice,
-- never a guess, because the AP364 pages print 190/79/72 for a sofa (cm) and
-- 550/735 for a chair (mm) and name the unit on NEITHER. `suggestUnit` fills
-- it in when every figure on a page agrees, and otherwise leaves it blank --
-- and a blank unit blocks the card.
--
-- On the real Panther pack that third branch is the common case, not the rare
-- one. A page carrying both 110 and 550 agrees with neither range, so EVERY
-- dimension on it arrives blank and every one of them blocks. A reviewer
-- facing a 40-page set is then asked the same question a few hundred times,
-- and the honest outcome of asking a question that often is that it stops
-- being read.
--
-- So the question moves up a level. `default_dimension_unit` is what this
-- project's drawings are drawn in, answered ONCE by the person who knows.
-- It is still a human decision -- it is not the model, and it is not a guess
-- from the figures -- it has just stopped being asked per row.
--
-- WHAT THIS COSTS, stated plainly because it is a real loss. A page genuinely
-- printed in mm, inside a project defaulted to cm, will now commit a 10x-wrong
-- figure where before it would have stopped. Three things are kept against
-- that, in order of how much they are worth:
--
--   * A unit PRINTED on the page beats the project default. Most of what this
--     column is for turns out to be documents that state nothing at all.
--   * `suggestUnit`'s page-level agreement still beats the default too. A
--     project is not more authoritative about a page than the page is.
--   * A plausibility check flags any dimension that, under the chosen unit,
--     implies furniture that does not exist. A unit error of 10x always moves
--     a real object out of range, which is exactly the error this trades for.
--     It does NOT catch cm/inch (2.54x), and it cannot catch a genuinely small
--     component. Neither is solved here; both are written down.
--
-- Nullable, with no default. A project that has not answered behaves exactly
-- as it did before this migration, blocking on a blank unit. Defaulting the
-- column to 'mm' would silently apply an answer nobody gave to every project
-- that already exists, which is the whole failure this column is supposed to
-- avoid.
--
-- WHY (2): A FINISHED PROJECT HAS NOWHERE TO GO, SO THE LIST ONLY GROWS.
--
-- Every project ever created is on the projects screen forever. There is no
-- delete and there should not be one -- a delivered project is the record of
-- what was specified and quoted, and the client ref -> job number mapping it
-- holds exists nowhere else in the business.
--
-- So: archived, never deleted, the same shape `project_notes` and
-- `record_attributes` already use. Archiving hides a project from the default
-- list. It does NOT make it read-only: nothing here revokes a write, and the
-- screen says so, because a control that looks like a lock and is not one is
-- worse than no lock.
--
-- `archived_at`/`archived_by` are constrained together rather than left to
-- convention. `spec_runs` has the status column WITHOUT the actor columns and
-- has no route that sets it; the fuller `project_notes` pattern is the one
-- copied here, because it is the only retire chain in this app that runs end
-- to end.
--
-- No new triggers. `projects` has carried write_audit, set_updated_at and
-- bump_version since 0002, so archiving is audited and version-checked by the
-- machinery that is already attached.
-- ==========================================================================

begin;

-- ---- the project's own dimension unit --------------------------------------
alter table projects add column default_dimension_unit text;

-- Same four values as record_attributes_unit_check in 0007 and ATTRIBUTE_UNITS
-- in src/lib/spec-vocab.ts. One vocabulary, three places that must agree --
-- see the external-vocabulary-sync skill before changing any of them.
alter table projects add constraint projects_default_unit_check
  check (default_dimension_unit is null or default_dimension_unit in ('mm', 'cm', 'm', 'in'));

-- ---- archived, never deleted ----------------------------------------------
alter table projects add column status      text not null default 'active';
alter table projects add column archived_at timestamptz;
alter table projects add column archived_by text;

alter table projects add constraint projects_status_check
  check (status in ('active', 'archived'));

-- "Who archived this, and when" is not optional. A project that left the list
-- with nobody's name on it is an unanswerable question later.
alter table projects add constraint projects_archived_has_actor
  check (status <> 'archived' or (archived_at is not null and archived_by is not null));

-- The list is ordered by project number and filtered by status, which is the
-- only query this column has.
create index projects_status_idx on projects (status, bws_project_number);

commit;
