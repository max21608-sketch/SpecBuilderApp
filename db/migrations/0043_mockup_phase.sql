-- ==========================================================================
-- 0043_mockup_phase.sql
--
-- WHY.
--
-- Max, 2026-10-04: "if everything's loaded in and it's not obvious, someone
-- needs to be able to just assign certain items to the mockup ... without
-- taking them away from the main run, but assign them also to a mock-up run."
--
-- The Aman bill has NO mock-up room lines. Every MUR drawing's code matches a
-- GR line (Guest Suites) and a PL line (Ambassador and Presidential Suites),
-- and a mock-up drawing can be a different design from both: the mock-up
-- dresser stool has a handle the PL one does not. So a mock-up item is not the
-- bill line moved, and it is not the bill line's specs copied -- it is the
-- bill line's IDENTITY on a phase of its own, which takes its own specs from
-- the mock-up drawings.
--
-- Two columns and nothing else:
--
--   spec_runs.is_mockup      this phase is the project's mock-up phase. A
--                            drawing the PAGE marks as mock-up resolves only
--                            among records on such a phase
--                            (`resolveDrawingItem`), and a phase table offers
--                            "Also in a mock-up phase" on every other phase.
--                            At most one LIVE one per project, by a partial
--                            unique index: two would make "the mock-up phase"
--                            a choice the action has no way to make.
--
--   spec_records.mockup_of   the record a mock-up record was added from, so
--                            each names the other on screen and the action is
--                            idempotent. ON DELETE SET NULL, not cascade: a
--                            mock-up record somebody has specced from its own
--                            drawings is not made meaningless by the bill line
--                            it was copied from going away.
--
-- ---- THE KIND CHECK IS RE-LISTED IN FULL, FROM THE LIVE TEXT --------------
--
-- 0032's post-mortem: a `check (x in (...))` cannot be extended, and 0028
-- copied a stale list and silently deleted `email_confirm`. THE LIST BELOW WAS
-- READ FROM THE LIVE CONSTRAINT (`pg_get_constraintdef` on
-- `change_sets_kind_check`) on the LOCAL stack at 0042 on 2026-10-04, and it
-- equals 0041's list exactly; 0042 does not re-list it. The only addition is
-- the one marked. `change_sets_reason_required` is NOT touched. Re-read the
-- live text before applying this anywhere a later migration may have
-- re-listed it. `tests/db/vocabulary-sync.test.ts` holds CHANGE_SET_KINDS and
-- REASON_REQUIRED_KINDS to these constraints.
--
-- `mockup_add` needs NO reason. It adds; it overrides nothing a document said
-- or a person decided, and it is undone by retiring the record it made --
-- which DOES need a reason (`record_retire`, 0038).
-- ==========================================================================
begin;

alter table spec_runs add column is_mockup boolean not null default false;

comment on column spec_runs.is_mockup is
  'The project''s mock-up phase (0043). A drawing the page marks as mock-up resolves only among records on such a phase. At most one live per project.';

create unique index spec_runs_one_live_mockup
  on spec_runs (project_id) where is_mockup and status = 'active';

alter table spec_records add column mockup_of uuid references spec_records(id) on delete set null;

comment on column spec_records.mockup_of is
  'The record this mock-up record was added from (0043). Identity only was copied: description, category, level, refs. Never its specs, never its quantity.';

-- A mock-up record is an item of its own, never a configuration of one, and
-- never a mock-up of itself.
alter table spec_records add constraint spec_records_mockup_not_self
  check (mockup_of is null or mockup_of <> id);
alter table spec_records add constraint spec_records_mockup_is_a_line
  check (mockup_of is null or parent_id is null);

create index spec_records_mockup_of_idx on spec_records (mockup_of) where mockup_of is not null;

alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins', 'email_confirm',
  'run_create', 'record_create', 'attribute_create', 'attribute_correct',
  'record_retire', 'record_restore',
  'standard_set', 'standard_agreed', 'standard_change',
  -- Added here. Items added to the mock-up phase from another phase.
  'mockup_add'
));

commit;
