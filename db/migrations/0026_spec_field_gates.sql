-- ==========================================================================
-- 0026_spec_field_gates.sql -- the gate model, as an overlay on the BWS field
-- register rather than on the cheat-sheet checklist.
--
-- WHY. `requirements.required_at_gate` has existed since 0002 with the comment
-- "null until a human authors the gate model". Nobody ever did: it is null on
-- all 728 rows and NOTHING IN THE REPO HAS EVER WRITTEN IT. On 2026-09-17
-- Matthew sent the first written gate model this project has had -- 35 spec
-- fields assigned across TGQ / TG0 / TG1 for nine seating categories, with
-- palettes and two conditional branches.
--
-- ---- WHY NOT `required_at_gate` -----------------------------------------
--
-- Because his matrix puts the SAME FIELD AT TWO GATES, and a single text
-- column cannot hold that:
--
--   Assembly guide (191)  is TGQ -- Question  AND  TG1 ("final confirmation")
--   Dimensions   (3)      is TGQ -- Auto      AND  TG1 ("confirmed against
--                                                       approved drawings")
--
-- That is 0019's argument, arrived at from the other end. 0019 chose
-- `tgq_levels text[]` over `required_at_gate` because Matthew answers per
-- question AND per level and one value cannot hold two. Writing a gate into a
-- single column here would be re-learning it, and the first item to break it
-- would be the one that is checked twice on purpose.
--
-- `required_at_gate` therefore stays null, is never written, and is dropped in
-- a later destructive migration -- the `tracking_eligible` precedent.
--
-- ---- WHY KEYED ON THE BWS FIELD, NOT ON A REQUIREMENT -------------------
--
-- His matrix is keyed on the BWS field. Every id in it matches
-- db/seed/0001_spec_fields.sql exactly -- dimensions 3, COM 1/2/3, timber
-- 4/31/143, metal 5/35, seat build 11, back cushion 25, FR 74, stud 16,
-- stitching 37, swivel 232, outdoor 130, access 6, site info 7, assembly guide
-- 191, purchasing notes 24 -- so the field half of the model needs no
-- translation at all.
--
-- His CATEGORIES do not line up: nine seating categories against our
-- seventeen cheat sheets. Keying the overlay on the field means the gate model
-- can be seeded, read and rendered while that mapping is still being settled,
-- instead of blocking the highest-value half of the work on the
-- lowest-confidence half.
--
-- ---- THIS IS STILL SEED DATA --------------------------------------------
--
-- CLAUDE.md: "the requirement matrix is seed data, not code ... a re-seed plus
-- a migration must be the whole change. If category rules become `if`
-- statements, every cheat-sheet revision becomes a code release." A seeded
-- overlay honours that exactly. Cabinetry arriving is a re-seed of
-- db/seed/0006_spec_field_gates.sql and nothing else.
--
-- `matrix_row` carries Matthew's own `#`, so a re-issued workbook DIFFS
-- against what we hold rather than being re-read by eye.
--
-- ---- FOUR THINGS THAT LOOK LIKE OVER-MODELLING AND ARE NOT --------------
--
-- 1. `dimension_slot`. Rows 4-7 of his matrix are FOUR rows carrying ONE BWS
--    id (3): W, D, H and SH. They are not interchangeable -- SH applies to
--    six of his nine categories and W/D/H to all nine ("Not applicable:
--    Daybeds, Ottomans, Beds"). Collapsing them to one row for field 3 would
--    silently lose that exception, and a seat height asked of a daybed is the
--    kind of wrong question that teaches somebody to tick without reading.
--    Reuses 0011's slot vocabulary, minus DIA, which his matrix does not use.
--
-- 2. `applies_to` AND `applies_to_raw`. He writes "All categories" on some
--    rows and "All UPY seating" on others, and in a seating-only workbook
--    those expand to the same nine. THEY ARE NOT THE SAME STATEMENT. When the
--    cabinetry matrix arrives, "All categories" widens and "All UPY seating"
--    must not. Storing only the expansion would freeze that difference out of
--    existence; storing only the raw would put the expansion in code. Both,
--    and the re-seed re-expands.
--
-- 3. `local_key`. Ten of his 35 rows carry no BWS id -- Product code, Item
--    name, Spec notes, Designer reference, Headboard fitted, Fitted banquette,
--    Socket spec, Lighting spec, Infill panel, Integrated hardware. They are
--    recorded from day one because a gate model that silently dropped the
--    four CONDITIONAL rows would report a fitted headboard TG0-ready with no
--    socket spec. Where their ANSWERS eventually live is a later question
--    (`requirements` rows with kind = 'readiness' is the likely home, and that
--    needs the category mapping first); recording that they exist costs
--    nothing and omitting them would be a lie.
--
-- 4. `palette_key` pointing at a register that does not exist yet. Five of his
--    palettes are BWS-owned and THIS APP HOLDS NONE OF THEM (timber finish,
--    metal finish, seat build, back cushion, stud). The key is recorded and
--    `palette_raw` keeps his exact words, so the gap is a visible unanswered
--    question rather than a forgotten one. Nothing is invented: FMT-GEN-01
--    says a BWS-owned vocabulary this app does not know is left blank.
--
-- ---- WHAT THIS MIGRATION DOES NOT DO ------------------------------------
--
-- No `gates` / `gate_status` tables. CLAUDE.md lists them as deliberately not
-- built because there is "nothing to read until the assignments exist". With
-- the overlay plus a pure function (src/lib/gates.ts) they would still hold
-- nothing a computed answer does not, and a STORED gate status would bump the
-- version every M2 extraction snapshot and chase coverage row is taken
-- against -- the `chased_at` trap, for the third time. Gate status is
-- computed, never stored, for the same reason Waiting and Overdue are.
-- ==========================================================================
begin;

-- ---- Matthew's nine categories, and what they are ours ------------------
--
-- Two tables and not one column, because the mapping is many-to-many in BOTH
-- directions and a single FK cannot hold it: his Sofas lands on two of our
-- sheets, and our "Armchairs Benches Stools Sofas" is one sheet receiving
-- three of his codes. A nullable FK on a single table would force a pick.
create table spec_matrix_categories (
  code        text primary key,
  name        text not null,
  family      text not null,
  sort_order  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text,
  constraint spec_matrix_categories_family_check check (family in ('upholstery', 'cabinetry'))
);

-- A row here is a DECISION that one of his categories is one of our cheat
-- sheets. Absence is not a decision: a cheat sheet with no row gets no gate
-- view, and the screen says so in words. That is the honest degradation, and
-- it is why nothing infers this mapping -- the same rule as
-- project_finishes.kind, where a second guess stacked on the first produces a
-- register full of confident mistakes.
create table spec_matrix_category_map (
  matrix_code      text not null references spec_matrix_categories(code) on delete cascade,
  item_category_id uuid not null references item_categories(id) on delete cascade,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  primary key (matrix_code, item_category_id)
);

create index spec_matrix_category_map_category_idx
  on spec_matrix_category_map (item_category_id);

-- ---- the overlay --------------------------------------------------------
create table spec_field_gates (
  id                   uuid primary key default gen_random_uuid(),
  -- Matthew's own '#'. The natural key of a row in his workbook, so a
  -- re-issued version diffs instead of being re-read.
  matrix_row           integer not null unique,
  gate                 text not null,
  -- How the answer is expected to arrive, from his Gate/Source columns.
  -- Advisory: it tells a screen whether to say "we will fill this in" or "you
  -- answer this". It is NOT a rule and nothing gates on it.
  capture              text not null,
  -- His own wording for the field, which is not always ours: he writes
  -- "Timber finish 1" where the export header says "Main timber finish", and
  -- "Seat cushion type" where the register says "Seat Upholstery Build".
  -- Kept so his workbook can be read against this table without a decoder.
  field_name           text not null,
  spec_field_id        uuid references spec_fields(id) on delete restrict,
  local_key            text,
  dimension_slot       text,
  applies_to           text[] not null,
  applies_to_raw       text not null,
  value_type           text not null,
  palette_key          text,
  palette_raw          text,
  conditional_on_key   text,
  conditional_on_value text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           text,
  updated_by           text,

  constraint spec_field_gates_gate_check check (gate in ('TGQ', 'TG0', 'TG1')),
  constraint spec_field_gates_capture_check check (capture in ('auto', 'question', 'input', 'confirm')),
  constraint spec_field_gates_value_type_check
    check (value_type in ('palette', 'palette_free_text', 'free_text', 'number', 'boolean')),
  -- Exactly one home. A row with both would be a BWS field pretending to be
  -- app-local; a row with neither is a gate on nothing.
  constraint spec_field_gates_field_or_local
    check ((spec_field_id is null) <> (local_key is null)),
  -- A slot only means something against a BWS field, and only against the
  -- dimensions field in practice. Four of the five 0011 slots; DIA does not
  -- appear in his matrix and inventing a gate for it would be inventing a
  -- rule.
  constraint spec_field_gates_slot_check
    check (dimension_slot is null or (spec_field_id is not null and dimension_slot in ('W', 'D', 'H', 'SH'))),
  -- Both halves of a conditional, or neither. A condition naming no value
  -- cannot be evaluated, and a value naming no condition is never read.
  constraint spec_field_gates_conditional_pair
    check ((conditional_on_key is null) = (conditional_on_value is null)),
  constraint spec_field_gates_applies_to_not_empty
    check (cardinality(applies_to) > 0)
);

-- One statement per (gate, field, slot). Two rows saying different things
-- about the same field at the same gate is a workbook transcription error, and
-- it should fail at seed time rather than make a screen pick one.
create unique index spec_field_gates_identity_key
  on spec_field_gates (gate, coalesce(spec_field_id::text, local_key), coalesce(dimension_slot, ''));

create index spec_field_gates_gate_idx on spec_field_gates (gate, matrix_row);
create index spec_field_gates_field_idx on spec_field_gates (spec_field_id) where spec_field_id is not null;
create index spec_field_gates_applies_to_idx on spec_field_gates using gin (applies_to);

-- ---- triggers -----------------------------------------------------------
-- Audit and updated_at, like every other externally-owned register in 0002
-- (spec_fields, item_categories, requirements). NO bump_version: these are
-- seed tables, not user-editable rows, and there is no optimistic lock to
-- hold because nothing in the app writes them.
do $$
declare t text;
begin
  foreach t in array array['spec_matrix_categories', 'spec_matrix_category_map', 'spec_field_gates'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

commit;
