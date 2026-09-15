-- ==========================================================================
-- 0009_project_note_flags.sql — marking the preamble notes that actually bind.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. A preamble confirm writes one `project_notes` row per requirement the
-- document states, and a real furnishings preamble states a lot of them: fire
-- and safety codes, tagging, tolerances, finish procedures, submittal rules.
-- They are all worth keeping and they are not all worth the same.
--
-- A handful of them change what gets quoted -- a flameproofing standard, a
-- tolerance, a "shop drawings take precedence over the spec sheets" clause --
-- and the rest are boilerplate that appears on every project this designer
-- touches. The screen renders them as one undifferentiated list, longest
-- first, with every body expanded, so the three that matter are read at the
-- same weight as the thirty that do not.
--
-- `flagged` is the reviewer saying "this one is load-bearing". Deliberately a
-- plain boolean and not a priority scale: a scale invites a middle value, and
-- a middle value is what a person picks when they do not want to decide.
--
-- NOT `status`. A note is active or retired -- retired meaning the document
-- was mis-read -- and that is orthogonal to whether an accurate note is
-- important. Overloading status would make "this matters" and "this is wrong"
-- the same field.
--
-- `not null default false` is safe on a populated table: false is what every
-- existing row means today, so there is nothing to backfill and no window in
-- which the column is null.
--
-- The index gains `flagged desc` ahead of the existing sort so flagged notes
-- come first without a second query or a sort in the client. It is dropped and
-- recreated rather than added beside, because two indexes on overlapping
-- leading columns is a write cost for a table whose reads are already one
-- small ordered scan per project.
--
-- No new triggers. `project_notes` has carried write_audit, set_updated_at and
-- bump_version since 0007, so flagging is audited and the notes PATCH route's
-- existing `version` predicate keeps working unchanged.
-- ==========================================================================

begin;

alter table project_notes add column flagged boolean not null default false;

drop index if exists project_notes_project_idx;
create index project_notes_project_idx
  on project_notes (project_id, status, flagged desc, sort_order, created_at);

commit;
