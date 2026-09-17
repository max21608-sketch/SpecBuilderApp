-- ==========================================================================
-- 0028_manual_capture.sql -- a person can start a project, add an item, type a
-- spec, and write down what the fields cannot hold.
--
-- WHY. Matthew's workflow of 2026-09-17 reads: "Info capture, ai scanning docs
-- & adding to the structured fields + freetext description ... Specs checked
-- and added to manually and developed with Q&A with client through your app
-- tools, up to TGQ." Three of those verbs had no route.
--
-- `find src/app/api -name route.ts` had NO POST for records, runs, attributes
-- or answers. Concretely:
--
--   * A record could only be created by confirming a BOQ (confirm-boq.ts). A
--     project whose documents are drawings and emails could not be STARTED.
--   * A spec value could only be created by confirming a document: the single
--     `insert into record_attributes` in the repo is confirm-drawings.ts:611.
--     A person could edit an existing answer and could not add a value the
--     checklist has no question for -- which is the whole reason
--     `record_attributes` is requirement-free.
--   * A bill's own words could not be corrected. PATCH /api/records/[id]
--     accepted `categoryId` and `level` and nothing else, so a typo in an item
--     description was permanent.
--
-- He says there are "a large number of new projects ... coming into the TG0
-- stage". None of them can be typed in.
--
-- ---- TWO FREE-TEXT COLUMNS, NOT ONE -------------------------------------
--
-- His matrix row 3 says "Spec notes ... Any item-specific notes not captured
-- by structured fields. App-internal; no direct BWS mapping." His email says
-- "we'll need a free text field always to capture info and descriptions that
-- fall outside of the spec fields." And his quote example carries BOTH a
-- prose opening inside the quoted Specification block --
--
--     As per details supplied
--     Curved sofa with fixed back and seat
--     Recessed timber plinth
--     DIMS: W2860 x D860 x H800 x SH420mm
--
-- -- and a separate `Internal notes` column holding things like "**updated
-- item** previous price GBP 9,200".
--
-- One column cannot be both. A description the CLIENT reads and a note the
-- client must never read are different things, and collapsing them means
-- either quoting an internal price note to a client or losing the description
-- from the quote. So:
--
--   spec_description   quote-facing prose. Goes in the quote's Specification
--                      block and the costing sheet's "Quote description".
--                      NEVER in the 109-column BWS grid: his matrix is
--                      explicit that Spec notes has no BWS mapping.
--   internal_notes     never leaves this app except as the quote CSV's own
--                      `Internal notes` column.
--
-- Which of the two his "Spec notes" row means is question 3 of the reply to
-- him. Building both is the reversible choice: merging two columns later is
-- easy and splitting one is not. See docs/plans/matrix-assumptions.md.
--
-- ---- WHY NOT THE `notes` TABLE ------------------------------------------
--
-- The chassis `notes` table is append-only by trigger, which is right for "why
-- did this change" and wrong for a description somebody edits: every correction
-- would be another row and the current text would have to be derived. And
-- `project_notes` is the PREAMBLE -- per project, per requirement, from a
-- document. Neither is an item's own description.
--
-- These bump `spec_records.version` through the existing trigger, which is
-- already the norm for a person's edit: setRecordCategory and setRecordLevel
-- both do (src/lib/record-category.ts). It is confirm-drawings that
-- deliberately does not, because an attribute is its own row.
--
-- ---- record_attributes NEEDS NO CHANGE ----------------------------------
--
-- `source_run_id` and `source_page` have been nullable since 0007, so a
-- hand-typed value already fits: it simply names no document and no page, and
-- every screen that prints provenance already handles a value with none. That
-- is the honest shape -- a spec somebody typed IS a spec with no page to turn
-- to, and inventing a source for it would be worse than the blank.
-- ==========================================================================
begin;

alter table spec_records add column spec_description text;
alter table spec_records add column internal_notes   text;

comment on column spec_records.spec_description is
  'Quote-facing prose: what this item is, in words. Reaches the quote CSV Specification block. Never the BWS grid.';
comment on column spec_records.internal_notes is
  'Never leaves this app except as the quote CSV Internal notes column. Not a spec value.';

-- Three more kinds of change. Creating a record, a run or a spec value is not
-- a `manual_edit` of something that existed: the history screen has to be able
-- to say "this item was added by hand on the 17th", which is exactly the
-- question somebody asks when an item appears in an export nobody recognises.
alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins',
  'run_create', 'record_create', 'attribute_create'
));

commit;
