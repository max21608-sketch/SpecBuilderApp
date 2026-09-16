-- ==========================================================================
-- 0019_item_level_and_tgq_levels.sql -- what has to be known before we quote.
--
-- WHY. The completion view reports confirmed / TBC / missing across all 728
-- cheat-sheet questions. That tells a KAM how full the form is. It does not
-- tell them whether they can send a quotation, and at tender stage only the
-- second question is worth anything: if we have enough to price the item,
-- everything else can wait.
--
-- TGQ is that gate -- "enough to quote", below the handover's TG0/TG1/TG2.
-- Matthew is answering it per QUESTION and per LEVEL: the 728 rows are 62
-- distinct questions (tools/lib/requirement-seed.mjs), each asked at three
-- levels a simple / complex / hero item. "Dimensions" may be needed to price a
-- hero sofa and not a simple one.
--
-- ---- WHY AN ARRAY, NOT `required_at_gate` -------------------------------
--
-- `required_at_gate` is a single text column and stays NULL and reserved for
-- TG0/TG1/TG2, which are single-valued. It cannot say "needed for hero but not
-- simple", and overloading it with 'TGQ' would lose exactly the distinction
-- the workbook is being filled in to capture.
--
-- A satellite table (requirement_id, gate, level) would hold the same three
-- booleans in 2,184 rows, add a join to every read, and need a fifth seed file
-- with its own shape for requirement-seed.mjs to learn. The array is the
-- direct encoding of what the workbook answers.
--
-- ---- WHY IT DEFAULTS TO EVERYTHING --------------------------------------
--
-- Today every requirement is required of every item. The default therefore
-- names all three levels, and the seed writes that literal on all 728 rows, so
-- the workbook's only job is to TAKE ENTRIES AWAY. An empty array means the
-- question is needed at no level: outstanding, but never holding up a quote.
-- Starting empty would have this migration inventing a gate model nobody has
-- authored, which is the thing 0002's header refused to do.
--
-- ---- WHY A LEVEL IS A COLUMN ON THE RECORD ------------------------------
--
-- A rule saying "for a hero sofa, dimensions are required to quote" needs to
-- know that this BOQ line IS a hero sofa, and nothing in a bill says so. It is
-- a person's decision, taken beside the category, and it is NULLABLE because
-- it is not known at import. `questionTier` in src/lib/tgq.ts refuses to read
-- a null level rather than defaulting one: a record with no level shows "Set
-- level", and a chase for it is blocked with that reason. Guessing here would
-- put the whole gate on a guess.
--
-- `level_set` joins the change-set vocabulary rather than reusing
-- `category_set`, because CHANGE_SET_KIND_LABELS is what the history screen
-- prints and a level change filed under "Category set" is a lie by label.
-- ==========================================================================

begin;

-- ---- the item's level ----------------------------------------------------
alter table spec_records add column level text;

alter table spec_records
  add constraint spec_records_level_check
  check (level is null or level in ('simple', 'complex', 'hero'));

-- ---- which levels must answer a question before it can be quoted ---------
alter table requirements
  add column tgq_levels text[] not null default array['simple', 'complex', 'hero']::text[];

alter table requirements
  add constraint requirements_tgq_levels_check
  check (tgq_levels <@ array['simple', 'complex', 'hero']::text[]);

comment on column requirements.tgq_levels is
  'Levels at which this question must be answered before the item can be QUOTED. Seed data, revised by re-seed: see docs/plans/tgq-for-matthew.md.';

comment on column spec_records.level is
  'simple | complex | hero. A person''s decision, set beside the category. Null means nobody has decided, and no tier is computed for the record.';

-- ---- the change-set kind a level decision is recorded under --------------
-- Re-listed in full: the CHECK is the vocabulary, and a partial ALTER would
-- leave the constant in src/lib/change-sets.ts describing a different set.
alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins'
));

commit;
