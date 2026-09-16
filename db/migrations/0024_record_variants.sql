-- 0024 — a bill line that is one item in two fabrics
--
-- ===========================================================================
-- WHY.
--
-- The AP364 seating set draws S-201 twice, on pages 5 and 6. The geometry is
-- identical; the callouts are not — `Aissa Dione Kolda` over `Natural oak` on
-- one page and `Aissa Dione Gorée` over `Ceruse finish oak` on the other. The
-- bill has ONE line for it, 45 off. S-200 is the same story across two pages
-- and S-301 across four.
--
-- Nothing in the app could express that. Both drawing cards resolved to the
-- same `spec_records` row, so `duplicateTargets` flagged them as two documents
-- fighting over one record and confirming the second offered to RETIRE the
-- first one's fabric as a replacement. The second fabric is not a correction
-- of the first. They are both true, and they are two different things to make.
--
-- 0002 anticipated exactly this and stopped one step short. `spec_records` has
-- carried `parent_id`, `depth` (capped at 1) and
-- `split_reason in ('fabric','configuration')` since the foundation, with the
-- comment that "one ref legitimately becomes several jobs (a fabric split, a
-- configuration split)". No code has ever written any of the three: columns
-- are the same promise an empty table makes.
--
-- What was missing was a NAME. A split with its own `record_no` reads as an
-- unrelated line; what a person says out loud is "S-201 A" and "S-201 B". So
-- this adds the one column the model needed, and nothing else.
--
-- WHAT IT DELIBERATELY DOES NOT DO.
--
-- No quantity is apportioned. The bill says 45 and never says how many are
-- fabric A, so both variants carry `qty = null` and the screens say the 45 is
-- unallocated. Splitting it is a person's decision with a price attached, and
-- inferring it is the M8 failure this milestone exists to prove against.
--
-- The client ref is NOT changed. `S-201` stays the ref on both variants —
-- `spec_record_refs` is unique per RECORD for this reason — because the ref is
-- the client's own key and the variant letter is ours. One ref, two BWS jobs,
-- which is what the pre-sale key model has always said.
-- ===========================================================================
begin;

alter table spec_records add column variant_label text;

comment on column spec_records.variant_label is
  'The letter a person calls this variant by: S-201 A. Ours, not the client''s — '
  'the client ref stays in spec_record_refs and is the same on every variant.';

-- A variant label and a parent are the same fact stated twice, so they stand
-- or fall together. This mirrors `spec_records_split_reason_requires_parent`
-- from 0002 exactly; a split with no name would be a row nobody can refer to,
-- and a name with no parent would be a top-level record pretending to be a
-- variant of something.
alter table spec_records
  add constraint spec_records_variant_requires_parent
  check ((variant_label is null) = (parent_id is null));

-- Short, printable, and no lower case: these are read aloud and typed into
-- emails. A free-text label would become a second description field.
alter table spec_records
  add constraint spec_records_variant_shape
  check (variant_label is null or variant_label ~ '^[A-Z0-9][A-Z0-9 ./-]{0,7}$');

-- One A per parent. Without this the letters stop identifying anything, which
-- is the only job they have.
create unique index spec_records_parent_variant_key
  on spec_records (parent_id, variant_label)
  where parent_id is not null;

-- ---------------------------------------------------------------------------
-- AND THE LESSON 0013, 0014 AND 0015 EACH LEARNED SEPARATELY.
--
-- `parent_id` has been `on delete restrict` since 0002. `project_id` is
-- `on delete cascade`, so deleting a project deletes its records — and the
-- restrict would refuse that delete the moment any of them were a variant,
-- exactly as 0015's FK refused to delete a document that had caused a change.
-- Append-only means refuse the REWRITE and allow the CASCADE: a variant of a
-- deleted record is not history, it is an orphan with no meaning, and no
-- reachable screen would ever show it again.
--
-- Retiring is the operation that preserves a variant, and it is a status
-- change that never touches this constraint. Deleting is a maintenance path,
-- and this is the third time a restrict has been found across one.
-- ---------------------------------------------------------------------------
alter table spec_records drop constraint spec_records_parent_id_fkey;
alter table spec_records
  add constraint spec_records_parent_id_fkey
  foreign key (parent_id) references spec_records(id) on delete cascade;

commit;
