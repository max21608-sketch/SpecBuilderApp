-- ==========================================================================
-- 0051_bump_version_ignores_suggestions.sql -- a suggested level is not a
-- change to the record, so it does not move the record's version.
--
-- WHAT WENT WRONG (audit D4, 2026-11-06). `spec_records_bump_version`
-- (0002) is a plain BEFORE UPDATE trigger: ANY update to the row moves
-- `version`. 0025 put the app's GUESS at a level beside the person's
-- decision, in `level_suggested` / `level_suggested_reason`, precisely so that
-- nothing reading `level` could be satisfied by a guess. But the drawings
-- confirm revises that guess when a page names brass
-- (`confirm-drawings.ts`, "guessLevelFromAttributes"), and the update fired
-- the trigger. The record's version moved for a reason no person took, and
-- everything keyed on that version moved with it: every open screen's
-- optimistic lock on the record, and (until audit F10 took the record version
-- out of the comparison) every unsent chase draft covering it, which then
-- read stale and was refused at confirm-sent. The file header and CLAUDE.md
-- both said the version was untouched. They described the intent, not the
-- trigger.
--
-- This is the `chased_at` trap one table over (0005): a write about
-- something other than the record's content bumping the record's lock. 0039
-- had to switch the trigger off for one statement for the same reason.
--
-- THE FIX IS IN THE TRIGGER, NOT IN THE CALLER. Disabling the trigger around
-- the confirm's statement needs the table owner and would have to be
-- remembered by every future writer of a suggestion (the bill confirm writes
-- one too). A WHEN clause says it once, for every writer: the version moves
-- when a column OTHER than these changes:
--
--   level_suggested, level_suggested_reason   the guess and its evidence
--   updated_by, updated_at                     bookkeeping; set_updated_at
--                                              fires AFTER this trigger
--                                              (triggers fire in name order)
--                                              and an actor alone is not a
--                                              change
--   version                                    the lock itself
--
-- Everything else, `level` included, still bumps: accepting a suggestion
-- writes `level` and so still moves the version, which is right, because a
-- person decided something. One consequence, wanted: an UPDATE that changes
-- nothing at all no longer bumps either. Nothing in this repo relied on a
-- no-op update moving the lock (every spec_records update was read for it on
-- 2026-11-06), and a lock that moves when nothing changed is a 409 nobody can
-- explain.
--
-- Re-created from the LIVE definition read off the local database on
-- 2026-11-06 (`pg_get_triggerdef`):
--   CREATE TRIGGER spec_records_bump_version BEFORE UPDATE ON
--   public.spec_records FOR EACH ROW EXECUTE FUNCTION bump_version()
-- Only spec_records changes. `bump_version()` itself is shared by every
-- versioned table and is not touched.
--
-- The comparison is jsonb, so a column added later is compared by default:
-- a new column BUMPS unless somebody adds it to this list on purpose, which
-- is the safe direction for an optimistic lock.
-- ==========================================================================
begin;

drop trigger if exists spec_records_bump_version on spec_records;

create trigger spec_records_bump_version
  before update on spec_records
  for each row
  when (
    (to_jsonb(old) - 'level_suggested' - 'level_suggested_reason' - 'updated_by' - 'updated_at' - 'version')
    is distinct from
    (to_jsonb(new) - 'level_suggested' - 'level_suggested_reason' - 'updated_by' - 'updated_at' - 'version')
  )
  execute function bump_version();

comment on trigger spec_records_bump_version on spec_records is
  'Optimistic lock. Fires only when a column other than level_suggested, '
  'level_suggested_reason, updated_by, updated_at or version changes (0051): '
  'a suggested level is not a change to the record.';

commit;
