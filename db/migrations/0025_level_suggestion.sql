-- ==========================================================================
-- 0025_level_suggestion.sql -- a level the app guessed, which is not a level.
--
-- WHY. 0019 gave a record a level and nothing to set it with except the record
-- screen and the drafts blocker, one record at a time. A 59-line bill
-- therefore arrived with 59 records reading "Set level", which is 59 visits
-- before a single chase can name what is blocking a quote. Asked for directly
-- on 2026-09-17: guess it at intake, per bill line, and always flag it for
-- review.
--
-- ---- WHY A SECOND COLUMN AND NOT A VALUE IN `level` ---------------------
--
-- 0019's header is explicit that guessing a level "would put the whole gate on
-- a guess", and that has not stopped being true. So `level` keeps its meaning
-- exactly -- a person's decision -- and a guess lives beside it, where every
-- existing reader ignores it for free: `questionTier`, `chase-drafts`,
-- `/api/records`, the spec table and the drafts screen all read `level` and go
-- on refusing a record that has none. Nothing about what blocks a quote can
-- move onto a guess by somebody forgetting a clause.
--
-- The precedent is `email_draft_items.tier` (0020): a stored reading that is
-- advisory by construction, kept out of the places that would make it
-- authoritative.
--
-- A record holds a decision or a suggestion, never both -- the CHECK below --
-- so accepting one is a single statement that fills `level` and clears the
-- suggestion, and there is no third state for a screen to misread.
--
-- ---- WHAT THE GUESS READS, AND WHY IT IS THIS REPO'S JUDGEMENT ----------
--
-- Nothing in the 17 cheat sheets defines simple / complex / hero; all of them
-- were searched on 2026-09-17 and none contains the words. The only written
-- basis anywhere is the BWS boilerplate names -- `Simple`, `with Metalwork`,
-- `Hero`, `non-critical Metalwork` -- which is the same distinction Matthew
-- described. src/lib/level-guess.ts encodes that and nothing cleverer, and it
-- belongs on the list of things to confirm with Matthew, beside the
-- question-to-BWS-field mapping.
--
-- No new change-set kind: accepting a suggestion IS setting a level, and it is
-- filed under 0019's `level_set` like any other. A guess arriving with a bill
-- is part of the `boq_confirm` that carried it.
-- ==========================================================================

begin;

alter table spec_records add column level_suggested text;
alter table spec_records add column level_suggested_reason text;

alter table spec_records
  add constraint spec_records_level_suggested_check
  check (level_suggested is null or level_suggested in ('simple', 'complex', 'hero'));

-- A decision ends the suggestion. Anything else leaves two answers on one row
-- and a screen free to show whichever it read first.
alter table spec_records
  add constraint spec_records_level_or_suggestion
  check (level is null or level_suggested is null);

-- A guess nobody can check is a guess nobody should act on.
alter table spec_records
  add constraint spec_records_level_suggested_has_reason
  check (level_suggested is null or level_suggested_reason is not null);

comment on column spec_records.level_suggested is
  'A level this app guessed from the bill or the drawings. ADVISORY ONLY: it never tiers a question and never satisfies a gate. A person accepts it, which writes `level` and clears this.';

comment on column spec_records.level_suggested_reason is
  'Why the guess was made, in the reviewer''s words -- "brass callout on S-200". Required whenever a suggestion is held.';

commit;
