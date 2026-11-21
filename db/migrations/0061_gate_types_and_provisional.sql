-- ==========================================================================
-- 0061_gate_types_and_provisional.sql -- room in the gate model for a SECOND
-- author, and for the type of an item inside a cheat sheet that covers several.
--
-- WHY. Max, 2026-11-20 (docs/plans/chase-decisions-2026-11-20.md A and B):
-- the eight cabinetry cheat sheets had no gate model, so a blank side table
-- asked 30 questions before it could be priced, and a sofa was asked about a
-- swivel base because its sheet also covers armchairs. Claude drafted a
-- cabinetry model (rows 101-121, db/seed/0014) at his instruction, and a type
-- suggestion for the multi-type sheets. Seeding either against the 0026
-- schema fails or lies, in four places:
--
-- 1. `spec_field_gates_identity_key` was "one statement per (gate, field,
--    slot)". The cabinetry rows put Timber finish 1-3 and Metal finish 1-2 at
--    TG0 exactly where his rows 18-22 do, for different categories, and two
--    glass rows (112 mirrors, 113 conditional elsewhere) on one field at one
--    gate. The unique index refuses every one. The rule it was written for is
--    real -- two rows saying different things about one field at one gate is
--    a transcription error -- but it is true PER MATRIX TYPE, not globally:
--    his row 18 is about seating and row 106 about cabinetry, and nothing
--    reads both for one item. So the index goes and a constraint trigger
--    holds the real rule: no two rows for one (gate, field-or-key, slot) that
--    can reach one item -- their `applies_to` overlap, either applies to every
--    category, or a type of each is mapped to one cheat sheet (a sheet answers
--    for the union of its types).
--
-- 2. "All categories" does not widen. `applies_to` holds his nine codes
--    literally and every loader joins on it, so the cabinetry types would not
--    receive his TGQ rows 1-6 and 8-11 or his TG1 rows. Widening the array in
--    a seed would EDIT HIS ROWS and flip-flop on every re-seed of 0006. 0026
--    kept `applies_to_raw` for exactly this day ("when the cabinetry matrix
--    arrives the first widens and the second must not"), so the widening is a
--    column GENERATED from his own phrase. His 35 rows are not touched by any
--    seed; this migration rewrites the table to add the column, which fires
--    no trigger and moves no other value.
--
-- 3. Nothing said a model was AI-drafted. `spec_matrix_categories.provisional_note`
--    carries the sentence every screen prints wherever a gate view or a TGQ
--    count comes from a provisional type. The TEXT lives in the data so no
--    screen can print it from a constant or a row-number test, and so the day
--    Matthew confirms the cabinetry model is a re-seed setting it null.
--
-- 4. A sheet covering several of his types answers for their UNION. Our
--    `armchairs-benches-stools-sofas` receives his S, A and B, so a sofa is
--    asked about swivel because an armchair is (0005 recorded the widening as
--    a decision). `spec_records.matrix_type` is a person's accepted type within
--    the sheet; null keeps the union, which is today's behaviour for every
--    existing row. `suggest_words` and `suggest_default` are what the
--    suggestion is read from (src/lib/matrix-type.ts). The suggestion is
--    computed at read and never stored -- the `level_suggested` rule without
--    even a column, because it is a pure function of the item's name and the
--    seed.
--
-- `matrix_type` has NO foreign key. A code not mapped to the record's category
-- is ignored at read (the union applies), the copy tool has no precedent for
-- a text key into a seed table, and a re-seed that renames a type must not be
-- refused by an item somebody typed. It bumps the record's version (0051's
-- WHEN clause compares every column not on its list), which is right: it is a
-- person's decision about which questions the item is asked.
--
-- Additive. Apply BEFORE the code that reads it, and seed 0014 AFTER that
-- code is deployed: a seed ahead of the deploy shows the AI model unlabelled.
-- ==========================================================================
begin;

-- ---- 2. "All categories" widens, generated from his own phrase ------------
alter table spec_field_gates
  add column applies_to_all boolean generated always as (applies_to_raw = 'All categories') stored;

comment on column spec_field_gates.applies_to_all is
  'True where the row was written for "All categories" (applies_to_raw), so it reaches every mapped type, a type added after it included. Generated, so no seed can disagree with the phrase. "All UPY seating" is NOT all.';

-- ---- 1. the identity rule, per matrix type AND per sheet ------------------
--
-- WHAT THE OLD INDEX REFUSED IN EFFECT (review 1, finding 3, 2026-11-21; this
-- file was EDITED, not followed by another, because it had been applied to
-- local databases only). A sheet answers for the UNION of the types mapped to
-- it, so an untyped record on armchairs-benches-stools-sofas receives S's rows
-- AND A's rows. Two rows for one field at one gate, one for S and one for A,
-- have disjoint arrays and both reach that record: the screen picks one,
-- which is exactly the transcription error 0026's global index refused. So two
-- rows clash when their types overlap, when either is "All categories", OR
-- when a type of each is mapped to one cheat sheet. The map can make the
-- clash too (mapping DT onto the consoles sheet beside CD), so the map has the
-- same check, under the same constraint name.
--
-- Concurrent writers are out of scope: neither sees the other's uncommitted
-- row. The rows are seed data, written by one seed run at a time.
drop index if exists spec_field_gates_identity_key;

-- Whether two rows' types can reach ONE record: an overlap, an "All
-- categories" row, or two types mapped to one sheet.
create or replace function spec_field_gates_types_meet(a text[], a_all boolean, b text[], b_all boolean)
returns boolean
language sql stable as $$
  select a_all or b_all or a && b
      or exists (
        select 1
          from spec_matrix_category_map m1
          join spec_matrix_category_map m2 on m2.item_category_id = m1.item_category_id
         where m1.matrix_code = any(a) and m2.matrix_code = any(b)
      )
$$;

-- Every pair of rows that clashes, "18/106"-style, or null. One statement, so
-- the gate trigger, the map trigger and the closing check cannot disagree.
create or replace function spec_field_gates_clashes() returns text
language sql stable as $$
  select string_agg(format('%s/%s', a.matrix_row, b.matrix_row), ', ' order by a.matrix_row, b.matrix_row)
    from spec_field_gates a
    join spec_field_gates b
      on a.matrix_row < b.matrix_row and a.gate = b.gate
     and coalesce(a.spec_field_id::text, a.local_key) = coalesce(b.spec_field_id::text, b.local_key)
     and coalesce(a.dimension_slot, '') = coalesce(b.dimension_slot, '')
   where spec_field_gates_types_meet(a.applies_to, a.applies_to_all, b.applies_to, b.applies_to_all)
$$;

create or replace function spec_field_gates_refuse_overlap() returns trigger
language plpgsql as $$
declare
  clash integer;
begin
  select g.matrix_row into clash
    from spec_field_gates g
   where g.id <> new.id
     and g.gate = new.gate
     and coalesce(g.spec_field_id::text, g.local_key) = coalesce(new.spec_field_id::text, new.local_key)
     and coalesce(g.dimension_slot, '') = coalesce(new.dimension_slot, '')
     and spec_field_gates_types_meet(g.applies_to, g.applies_to_all, new.applies_to, new.applies_to_all)
   order by g.matrix_row
   limit 1;
  if clash is not null then
    raise exception
      'Gate rows % and % both say something about "%" at %, for items they can both reach (a type they share, or two types on one cheat sheet). Two rows for one field at one gate is a transcription error.',
      clash, new.matrix_row, new.field_name, new.gate
      using errcode = 'check_violation', constraint = 'spec_field_gates_identity_overlap';
  end if;
  return null;
end $$;

-- A CONSTRAINT trigger, checked at the end of each statement, so a re-seed
-- that moves a field between two rows in one upsert is judged on the result.
-- Deferrable for a hand fix that needs two statements.
drop trigger if exists spec_field_gates_identity_overlap on spec_field_gates;
create constraint trigger spec_field_gates_identity_overlap
  after insert or update on spec_field_gates
  deferrable initially immediate
  for each row execute function spec_field_gates_refuse_overlap();

-- THE MAP'S SIDE. A mapping that puts two rows' types on one sheet is the same
-- clash arriving the other way. The whole overlay is judged (56 rows), because
-- the pair need not name the new code: an "All categories" row already
-- reaches it, and a pair that only now shares a sheet is any two rows.
create or replace function spec_matrix_category_map_refuse_overlap() returns trigger
language plpgsql as $$
declare
  bad text;
begin
  bad := spec_field_gates_clashes();
  if bad is not null then
    raise exception
      'Mapping % onto this cheat sheet puts two gate rows for one field at one gate on the same items (%). Two rows for one field at one gate is a transcription error.',
      new.matrix_code, bad
      using errcode = 'check_violation', constraint = 'spec_field_gates_identity_overlap';
  end if;
  return null;
end $$;

drop trigger if exists spec_matrix_category_map_identity_overlap on spec_matrix_category_map;
create constraint trigger spec_matrix_category_map_identity_overlap
  after insert or update on spec_matrix_category_map
  deferrable initially immediate
  for each row execute function spec_matrix_category_map_refuse_overlap();

-- The rows already here held the stricter global rule, so none can break this
-- one. Checked anyway, naming any pair, because the triggers only judge rows
-- as they are written.
do $$
declare bad text;
begin
  bad := spec_field_gates_clashes();
  if bad is not null then
    raise exception '0061: gate rows already overlap for items they can both reach: %', bad;
  end if;
end $$;

-- ---- 3. a model somebody has not confirmed says so ------------------------
alter table spec_matrix_categories
  add column provisional_note text,
  add column suggest_words text[] not null default '{}';

comment on column spec_matrix_categories.provisional_note is
  'Null for a type Matthew wrote. Otherwise the sentence every screen prints wherever a gate view or a TGQ count comes from this type: who drafted it, when, and that he has not confirmed it.';
comment on column spec_matrix_categories.suggest_words is
  'Whole words or phrases in an item name that suggest this type within a cheat sheet covering several (src/lib/matrix-type.ts). A suggestion, never a decision.';

-- ---- 4. the type within a sheet ------------------------------------------
alter table spec_matrix_category_map
  add column suggest_default boolean not null default false;

comment on column spec_matrix_category_map.suggest_default is
  'The type suggested for an item on this sheet whose name names no type. At most one per sheet.';

create unique index spec_matrix_category_map_one_default
  on spec_matrix_category_map (item_category_id) where suggest_default;

alter table spec_records
  add column matrix_type text,
  add constraint spec_records_matrix_type_not_blank check (matrix_type is null or btrim(matrix_type) <> '');

comment on column spec_records.matrix_type is
  'A person''s accepted gate-model type (spec_matrix_categories.code) within a cheat sheet that covers several. Null keeps the union of the sheet''s types. A code not mapped to the record''s category is ignored. Only a person''s press writes it; the suggestion is computed and never stored.';

commit;
