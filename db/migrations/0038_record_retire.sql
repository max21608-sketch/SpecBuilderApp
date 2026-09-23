-- ==========================================================================
-- 0038_record_retire.sql
--
-- WHY.
--
-- A person can now add a configuration by hand (Max, 2026-09-23: "if someone
-- sees that something's wrong, they still need to work through, even if it
-- means they have to add it manually"). One added wrongly has to be able to
-- go again, and there was no way to take ONE record out of the export: a
-- record could only be retired as part of its whole phase (`run_retire`) or
-- by a revised bill that no longer lists it (`boq_revision`).
--
-- Retiring a configuration is consequential. It stops being exported, and if
-- it was the last live configuration of its bill line, the bill line becomes
-- an item again and ITS OWN specs are exported again (`parentIsSupersededBy`
-- reads a live child, never a stored flag). So it is a change-set kind of its
-- own, and it needs a reason — CLAUDE.md's hard approval gate: "Retiring a
-- spec, a record or a run ... requires a REASON".
--
-- Restoring it is its own kind too, so the trail can say "put back" rather
-- than "edited by hand". It does not need a reason: it undoes a retirement
-- whose reason is already on the trail, as `attribute_retire`'s restore does.
--
-- ---- BOTH CHECKS ARE RE-LISTED IN FULL, FROM THE LIVE TEXT --------------
--
-- A Postgres `check (x in (...))` cannot be extended, so each is dropped and
-- recreated with the whole list. 0032's header is the post-mortem of copying
-- that list from a migration: 0028 copied a stale one and silently deleted
-- `email_confirm`. BOTH LISTS BELOW WERE READ FROM THE LIVE CONSTRAINTS on the
-- sandbox on 2026-09-23 (`pg_get_constraintdef` on `change_sets_kind_check`
-- and `change_sets_reason_required`), read-only, and the only additions are
-- the ones marked. `tests/db/vocabulary-sync.test.ts` asserts the kind list
-- against `CHANGE_SET_KINDS` in both directions once this is applied.
-- ==========================================================================
begin;

alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins', 'email_confirm',
  'run_create', 'record_create', 'attribute_create', 'attribute_correct',
  -- Added here. Taking one record out of the export, and putting it back.
  'record_retire', 'record_restore'
));

alter table change_sets drop constraint change_sets_reason_required;
alter table change_sets add constraint change_sets_reason_required check (
  kind <> all (array[
    'attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink', 'baseline',
    'attribute_correct',
    -- Added here, for the reason run_retire is on this list: it changes what
    -- the export carries, and "why" is what makes that readable later.
    'record_retire'
  ])
  or (reason is not null and btrim(reason) <> '')
);

commit;
