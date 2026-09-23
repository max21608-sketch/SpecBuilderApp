-- ==========================================================================
-- 0040_boq_columns_and_layouts.sql -- a bill is never refused; it is mapped.
--
-- WHAT BROKE (2026-09-23, the Miami Beach session). An Aman Interiors pricing
-- document headed its code column "Spec Code", and beside it "Line",
-- "Sub-Area" and "Category Code". None of the four was in the reader's fixed
-- synonym list, no row on either sheet read as a header, and the run went
-- `failed` with a sentence and no next step: the Documents tab's Try again
-- posted to /extract, which refuses a bill, and nothing on any screen let a
-- person say which column was which. A bill whose columns are plainly there
-- was a dead end because of the words above them.
--
-- Three things here, each the smallest shape that closes it.
--
-- ---- 1. THE SYNONYMS BECOME SEED DATA -------------------------------------
--
-- `COLUMNS` in src/lib/boq-import.ts was code, so adding a word was a commit
-- and a release. CLAUDE.md has said for weeks that "the header synonym list is
-- still CODE, not seed". `boq_column_aliases` holds it now, one row per term,
-- seeded by db/seed/0012 with EXACTLY today's list -- a db-tier test compares
-- the seeded rows with the old constant, so the day this lands every bill
-- reads exactly as it did the day before.
--
-- `term_norm` is UNIQUE, and that is the rule rather than an index: a heading
-- that could mean two roles must not resolve to whichever row sorted first.
-- It is still a WHOLE-HEADING match after folding case and whitespace, never a
-- substring -- a substring rule makes "Category Code" the code column and
-- "Unit Price" the unit, and both headings are printed beside the columns they
-- would destroy. No new term is added here: the next ones come from verified
-- wording, not from one bill seen once.
--
-- `ignore` is a role on purpose. No price, cost or picture is ever read into
-- this app (there is no pricing anywhere in it, and a generated number would
-- be the first figure nothing downstream could question); a person or a later
-- alias saying "this column is deliberately not read" is a different
-- statement from "nobody said what this column is".
--
-- ---- 2. A LAYOUT IS A PERSON'S MAPPING, REMEMBERED -------------------------
--
-- "Nail the major specifiers" is data, not code: a reviewer who has set a
-- bill's columns once can save them under a name ("Aman Interiors -- AMB
-- pricing document"), and the next bill in that layout reads on its own.
--
-- THE TRAP IS A LAYOUT THAT SILENTLY APPLIES TO A BILL WHOSE COLUMNS MOVED.
-- So a layout applies to a sheet only when EVERY heading in its mapping is
-- present, exactly (folded), on one header row -- or one pair, for a
-- two-row header. `headings` keeps the whole folded header it was saved from,
-- in order, so a later reader can see what it was saved against; the match
-- reads `mapping`, role to heading, and nothing looser. And the review screen
-- keeps the Columns panel OPEN on any sheet a layout read, until the reviewer
-- closes it once: a remembered layout must never apply unseen.
--
-- A layout is not specification content, so it opens no change set -- the
-- same argument as an email's automatic assignment. It is audited like any
-- other row (`write_audit`, `created_by`), and it is retired, never deleted,
-- because a staged bill may still name the layout it was read with.
--
-- ---- 3. THE UNIT IS WRITTEN --------------------------------------------------
--
-- `qtyUnit` has been staged since the first bill ("pcs", "m", "ea") and never
-- written: a fabric row at 12 m and a chair at 12 ea reached the record as the
-- same 12. `spec_records.qty_unit` is the bill's own word, verbatim, text --
-- nothing computes with it and nothing converts it.
--
-- NOTE FOR THE NEXT MIGRATION THAT TOUCHES A CHECK: the role CHECK below is
-- NEW, so nothing is re-listed here. When a role is added, re-list it from the
-- LIVE constraint (`pg_get_constraintdef` on boq_column_aliases_role_check),
-- never from this file -- 0032's header is why. `tests/db/vocabulary-sync`
-- asserts BOQ_ROLES against it.
-- ==========================================================================
begin;

alter table spec_records add column qty_unit text;

comment on column spec_records.qty_unit is
  'The bill''s own unit of measure for qty, verbatim ("pcs", "ea", "m"). Written by the BOQ confirm; never converted or inferred.';

create table boq_column_aliases (
  id          uuid primary key default gen_random_uuid(),
  role        text not null,
  term        text not null,
  term_norm   text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  constraint boq_column_aliases_term_norm_key unique (term_norm),
  constraint boq_column_aliases_role_check check (role in (
    'code', 'itemDescription', 'qty', 'qtyUnit', 'area', 'subArea', 'designer',
    'boqCategory', 'productReference', 'sourceLine', 'notes', 'ignore'
  )),
  -- The fold the reader applies: lower case, whitespace collapsed and trimmed.
  -- A row whose term_norm is not that fold of its term would be a heading the
  -- reader can never match, so it is refused rather than seeded.
  constraint boq_column_aliases_term_norm_folded check (
    term_norm = lower(btrim(regexp_replace(term, '\s+', ' ', 'g'))) and term_norm <> ''
  )
);

comment on table boq_column_aliases is
  'Which bill heading means which column role. WHOLE-heading match after folding case and whitespace, never a substring. Seeded by db/seed/0012 with the reader''s original list.';

create table boq_layouts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  headings     text[] not null,
  mapping      jsonb not null,
  header_rows  int not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz,
  constraint boq_layouts_name_key unique (name),
  constraint boq_layouts_name_present check (btrim(name) <> '' and char_length(name) <= 200),
  constraint boq_layouts_header_rows_check check (header_rows in (1, 2)),
  -- role -> folded heading. An empty mapping would apply to every sheet in
  -- existence, which is the silent-layout trap in its purest form.
  constraint boq_layouts_mapping_is_object check (
    jsonb_typeof(mapping) = 'object' and mapping <> '{}'::jsonb
  )
);

comment on table boq_layouts is
  'A person''s column mapping for a bill layout, saved under a name. Applies to a sheet only when every heading in mapping is present exactly (folded) on one header row or pair. Retired, never deleted.';

create trigger boq_layouts_audit after insert or update or delete on boq_layouts
  for each row execute function write_audit();

commit;
