-- ==========================================================================
-- 0012_boq_column_aliases.sql -- the bill reader's header synonyms, as data.
--
-- EXACTLY the list that was `COLUMNS` in src/lib/boq-import.ts until 0040, and
-- nothing more. `tests/db/boq-columns.test.ts` compares these rows with that
-- constant (kept there as `REFERENCE_BOQ_ALIASES`), so the day the reader
-- started loading its vocabulary from the database every bill read exactly as
-- it did the day before.
--
-- Two rules carried over, and both are traps:
--
--   * `L1`..`L6` are NOT here. A per-level quantity is not the total, and a
--     bill that read `L1` where `qty` belonged would order 3 sofas instead of
--     14.
--   * A WHOLE heading, after folding case and whitespace -- never a substring.
--     "Category Code" is not the code column and "Unit Price" is not the unit.
--
-- Add a term only from VERIFIED wording on a real bill, and never "spec code"
-- on the strength of one bill: a person maps an unknown layout on the review
-- screen and can save it (`boq_layouts`), which is how one specifier's words
-- are remembered without teaching the reader a word that means something else
-- on the next specifier's bill.
-- ==========================================================================

insert into boq_column_aliases (role, term, term_norm, created_by)
select t.role, t.term, lower(btrim(regexp_replace(t.term, '\s+', ' ', 'g'))), 'seed'
from (values
  ('designer', 'designer'),
  ('boqCategory', 'category'),
  ('area', 'area'),
  ('area', 'zone'),
  ('area', 'location'),
  ('code', 'code'),
  ('code', 'ff&e code'),
  ('code', 'ffe code'),
  ('code', 'ff&e ref'),
  ('code', 'client ref'),
  ('code', 'client reference'),
  ('code', 'ref'),
  ('itemDescription', 'item description'),
  ('itemDescription', 'description'),
  ('itemDescription', 'item'),
  ('productReference', 'product reference'),
  ('productReference', 'product ref'),
  ('productReference', 'reference'),
  ('qty', 'total q-ty'),
  ('qty', 'total qty updated'),
  ('qty', 'total qty'),
  ('qty', 'total quantity'),
  ('qty', 'qty'),
  ('qty', 'quantity'),
  ('qtyUnit', 'unit'),
  ('qtyUnit', 'uom'),
  ('qtyUnit', 'unit of measure')
) as t(role, term)
on conflict (term_norm) do update set
  role = excluded.role,
  term = excluded.term;
