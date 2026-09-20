-- ==========================================================================
-- 0033_attribute_correct.sql -- the verb that was missing: correcting a spec
-- without losing the page it was read from.
--
-- WHAT WENT WRONG. Matthew went looking for confirm-or-update on a confirmed
-- record and neither he nor Max could find it, because there was nothing to
-- find. A confirmed `record_attributes` row could be RETIRED (reason required)
-- or a new one TYPED by hand, and nothing else. So correcting a misread width
-- -- the page says 1090 and the card recorded 1900 -- meant two separate acts,
-- two change sets, and a replacement row carrying NO source run and NO page,
-- because a hand-typed spec deliberately carries neither.
--
-- The result was worse than the defect: the record ends up holding a value
-- that is right, with nothing saying where anybody could check it, sitting
-- beside a retired row that still cites the page. A reader a month later
-- cannot tell a corrected misread from a number somebody made up.
--
-- ---- WHY THIS IS NOT A COLUMN, AND NOT AN UPDATE IN PLACE ----------------
--
-- `record_attributes` is WHAT A DOCUMENT SAID. Editing `value` in place makes
-- the row say something the page does not while still naming that page as its
-- source -- a false provenance, and a history that cannot answer "what did the
-- card say before Max fixed it". So a correction is a SUPERSESSION BY A
-- PERSON: the old row is retired with `superseded_by_id` pointing at a new row
-- that keeps the old row's source run and page, because the page is still
-- where to go and check the corrected figure.
--
-- 0016 already built every piece of that for a revised DRAWING. Nothing in the
-- schema changes here. What was missing was a way to say WHO did it and WHY,
-- and that is a change-set kind.
--
-- ---- SO THIS FILE IS TWO CHECK CONSTRAINTS, AND BOTH ARE RE-LISTED -------
--
-- A Postgres `check (x in (...))` cannot be extended: adding one value means
-- dropping the constraint and recreating it with the whole list. 0032's header
-- is the post-mortem of what happens when that list is copied from a
-- migration -- 0028 copied 0019's, which was stale, and silently deleted
-- `email_confirm`, breaking every email confirm in the app.
--
-- BOTH LISTS BELOW WERE READ FROM THE LIVE CONSTRAINTS on the sandbox on
-- 2026-09-19 (`select pg_get_constraintdef(oid) from pg_constraint where
-- conname in ('change_sets_kind_check', 'change_sets_reason_required')`), not
-- from any migration's text, and `attribute_correct` is the only addition to
-- either. `tests/db/vocabulary-sync.test.ts` asserts the kind list against
-- `CHANGE_SET_KINDS` in both directions, so the next accidental pruning fails
-- in a second.
--
-- ---- AND WHY IT NEEDS A REASON ------------------------------------------
--
-- Same test `attribute_retire` applies: a correction OVERRIDES something a
-- document said. It is more than a retire, in fact -- it retires a statement
-- AND asserts a replacement under the same page reference. An OPEN change set
-- satisfies the requirement, as everywhere else: a reviewer working through a
-- call opens one change and every correction after it attaches to that.
-- ==========================================================================
begin;

alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins', 'email_confirm',
  'run_create', 'record_create', 'attribute_create',
  -- Added here. A person superseding a spec with a corrected value, keeping
  -- the source run and page of the row it replaces.
  'attribute_correct'
));

alter table change_sets drop constraint change_sets_reason_required;
alter table change_sets add constraint change_sets_reason_required check (
  kind <> all (array[
    'attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink', 'baseline',
    -- Added here, for the reason attribute_retire is on this list: it
    -- overrides something a document said, and "why" is what makes that
    -- readable by somebody who was not in the room.
    'attribute_correct'
  ])
  or (reason is not null and btrim(reason) <> '')
);

commit;
