-- ==========================================================================
-- 0020_draft_item_tier.sql -- which half of the email a question was in.
--
-- WHY. A chase email now says two different things: "we cannot price this item
-- until you tell us X" and "Y is also outstanding". The coverage rows are what
-- the body is rendered from (0005: the question table is generated, never
-- authored), so the tier has to be stored beside them or the two halves cannot
-- be rebuilt.
--
-- ---- WHY IT IS A COLUMN AND NOT PART OF `context_snapshot` ---------------
--
-- `context_snapshot` is compared with `canonicalJson` to decide whether a sent
-- draft still describes reality. Adding a field to it changes the comparison
-- for every row ever written, so every existing sent draft would read
-- `contextChanged` the moment this deployed and drop out of Waiting.
--
-- Worse, it would keep happening. A tier is a reading of `requirements.tgq_levels`
-- and `spec_records.level`, and applying Matthew's TGQ workbook re-tiers
-- hundreds of questions in one re-seed. Inside the snapshot that is a mass
-- staleness event -- every unsent draft 409s and every sent one stops counting
-- as awaited -- for a reason that has nothing to do with any answer. That is
-- the same trap as the `chased_at` column 0005's header rejects.
--
-- So: staleness still means "what this email SAID about the question no longer
-- matches", and a question moving between the two halves is reported on screen
-- as an advisory, not as a conflict.
--
-- NULLABLE because rows written before this exist and nothing may invent a
-- tier for them: their level may never have been set. New rows always carry
-- one, because a record with no level cannot enter a draft at all.
-- ==========================================================================

begin;

alter table email_draft_items add column tier text;

alter table email_draft_items
  add constraint email_draft_items_tier_check
  check (tier is null or tier in ('to_quote', 'later'));

comment on column email_draft_items.tier is
  'to_quote | later at generation time. Advisory once stored: see src/lib/tgq.ts.';

-- The email renders in record order within each half, and an edit rebuilds the
-- body from these rows. Without a stored order the table re-sorted itself
-- alphabetically on every edit, which reads as the email having changed.
alter table email_draft_items add column record_no integer;
alter table email_draft_items add column requirement_sort integer;

commit;
