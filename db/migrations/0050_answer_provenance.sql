-- ==========================================================================
-- 0050_answer_provenance.sql -- an answer says, in a column, that it is a
-- PROJECTION of the record's attributes.
--
-- WHAT WENT WRONG (audit E1, 2026-11-06). `spec_answers` has two kinds of
-- row that look alike. One is a PERSON'S answer: typed on the checklist
-- (`manual`), confirmed off an email (`email`), or confirmed by a reviewer
-- off a specification document straight onto a question (`document`). The
-- other is the CHECKLIST'S COPY OF THE ATTRIBUTES: `promote-answers.ts`
-- composes it from whatever `record_attributes` hold, and every correction,
-- retire, finish edit or BW standard recomposes it. Both were written
-- `source_kind = 'document'`.
--
-- So which rows the recompose was allowed to touch was INFERRED from the
-- document that last wrote them: `applyAnswerFills` admitted a `document`
-- answer only where its `source_id` was an intake run with
-- `document_kind = 'shop_drawings'`, and `applyAnswerRetractions` only that.
-- That was right in 2026-09, when a shop drawing was the only document that
-- wrote attributes. It stopped being right one feature at a time: the bill
-- (2026-09-30, `document_kind` NULL by 0021's CHECK), the FF&E schedule, the
-- tracker and the email all write attributes and recompose with THEIR run as
-- the source. From that moment their answers were neither shop drawings nor
-- hand-typed, so nothing could reach them again. A correction, a retire,
-- "use the drawing's over the bill's", a library edit, a BW standard: the
-- Specs tab and the BWS file moved, and the checklist, the gates, TGQ, the
-- chase and completion went on reading the bill. And because the export
-- falls back to the answer where no attribute holds a field, a RETIRED bill
-- fabric still shipped.
--
-- THE FIX IS TO RECORD IT, NOT TO INFER IT BETTER (Max, 2026-11-06).
-- `'attribute'` means: composed by this code from the record's active
-- attributes, whatever document produced them. The recompose writes it on
-- every fill and touches only `missing` or `attribute` rows; `manual`,
-- `email` and `document` (now only a reviewer's own answer) are out of reach.
-- `source_id` keeps its meaning: the run of the last contributing attribute,
-- or null for a typed one.
--
-- RE-LISTED FROM THE LIVE CONSTRAINT, never from 0002's text (0032 is why).
-- Read on the local stack on 2026-11-06 with pg_get_constraintdef on
-- spec_answers_source_kind_check:
--   source_kind = any (array['manual', 'document', 'email'])
-- Re-check it on the sandbox and pilot before applying there: a value added
-- since on that database and missing below would be deleted by this file.
-- tests/db/vocabulary-sync.test.ts asserts ANSWER_SOURCES against the result.
--
-- ORDER ON A DATABASE WITH DATA. Apply this file, deploy the code, then run
-- `db:backfill-answer-provenance --apply`. Until the backfill runs, every
-- projected answer written before it is still `document` and therefore out of
-- the recompose's reach (it was out of reach before this file too, for every
-- answer not written by a shop drawing). The backfill relabels them and gives
-- the frozen ones their current value back.
-- ==========================================================================
begin;

alter table spec_answers drop constraint spec_answers_source_kind_check;

alter table spec_answers add constraint spec_answers_source_kind_check check (
  source_kind in ('manual', 'document', 'email', 'attribute')
);

commit;
