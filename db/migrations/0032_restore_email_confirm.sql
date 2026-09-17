-- ==========================================================================
-- 0032_restore_email_confirm.sql -- putting back the change-set kind 0028
-- deleted by re-listing a constraint from a stale copy.
--
-- WHAT HAPPENED. 0028 added three kinds (run_create, record_create,
-- attribute_create). A CHECK cannot be extended, so it has to be dropped and
-- recreated with the whole list -- and the whole list was copied from 0019,
-- which was the most recent migration that happened to re-list it.
--
-- 0021 had added `email_confirm` in between. Copying 0019's list therefore
-- SILENTLY REMOVED IT, and every email confirm began failing:
--
--   new row for relation "change_sets" violates check constraint
--   "change_sets_kind_check"
--
-- reaching the reviewer as a 500 and "Nothing was written." Four db-tier tests
-- went red and, because the whole-database COVERAGE assertion in
-- change-history.test.ts sees the wreckage those four leave behind, a fifth
-- did too.
--
-- ---- THE MISREADING IS WORTH MORE THAN THE FIX -------------------------
--
-- The failure was first attributed to somebody else's commit, on the evidence
-- that it survived stashing the TypeScript changes. It survived because THE
-- CONSTRAINT LIVES IN THE DATABASE: a migration applied to the sandbox is not
-- undone by stashing a .ts file, so "it fails with my changes stashed" proves
-- nothing about a migration. When a db-tier test fails, the thing to revert is
-- the SCHEMA, not the source.
--
-- ---- AND WHY A LIST IN A MIGRATION IS THE WRONG SOURCE -----------------
--
-- 0019's header already says it "re-lists change_sets_kind_check in full to
-- add 'level_set'", which reads as a warning and is not one: the next author
-- copies the most recent full list they can find, and it is stale the moment
-- any migration between it and them added a value.
--
-- So the list below is read from the LIVE constraint plus the missing value,
-- and `tests/db/vocabulary-sync.test.ts` now asserts every controlled
-- vocabulary in src/lib/spec-vocab.ts and src/lib/change-sets.ts against its
-- own CHECK. That guard fails in one second on the next drop-and-recreate that
-- loses a value, which is the only version of this that scales -- there are
-- twelve such vocabularies and this one was the first to be pruned by accident.
-- ==========================================================================
begin;

alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins',
  -- Added by 0021 and lost by 0028. An email confirm is the only way a value
  -- reaches an answer with the message attached as evidence.
  'email_confirm',
  -- Added by 0028.
  'run_create', 'record_create', 'attribute_create'
));

commit;
