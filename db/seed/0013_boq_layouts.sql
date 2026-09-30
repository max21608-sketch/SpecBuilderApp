-- ==========================================================================
-- 0013_boq_layouts.sql -- the bill layouts this app KNOWS, as seed data.
--
-- WHAT HAPPENED (2026-09-30, pilot). The Aman Miami Beach pricing document
-- was uploaded on a database with no saved layout for it, so the bill sheet
-- was read by the model -- a charged structure read -- and the confirm then
-- waited for a person to tick "the columns are right". Max: "I don't have to
-- assign columns." A person had already mapped this exact document on the
-- local stack on 2026-09-23 and saved it as a layout; a person-saved layout
-- lives in one database, and pilot had never seen it.
--
-- So the layout is SEED DATA: the same row, reproduced from that save, re-
-- derived from the real file's header row (row 8 of the original, row 1 of
-- the copy with its title rows deleted -- both copies match it exactly), and
-- written as `created_by = 'seed'`. That actor is what makes a layout SEEDED
-- (`SEED_ACTOR`, src/lib/boq-roles.ts), and a seeded layout reads like a
-- known heading: no columns check, the panel shut, and the sheet still says
-- which layout read it with "Change columns" beside it, because a wrong match
-- must stay visible and correctable.
--
-- THE TRAP IS A SEEDED LAYOUT SILENTLY READING ANOTHER SPECIFIER'S BILL. The
-- guard is unchanged and is the reader's, not this file's: a layout applies
-- only where EVERY heading in its mapping sits, exactly after folding case and
-- whitespace, on one header row (`layoutAt`). Nine headings here, "Spec Code"
-- and "Category Code" among them, so a bill that renames or drops one of them
-- is not this document and is not read as it.
--
-- WHAT IS READ, and what is deliberately not: Line is the bill's own line
-- number (`sourceLine`, staged, never written); Area and Sub-Area compose into
-- the record's area; Category Code is the bill's grouping word, not our
-- category; Spec Code is the client ref; Unit and Total QTY are the quantity
-- and its unit; Notes is where the bill writes OPTION 1 / OPTION 2. Image,
-- Target Unit Cost, Unit Price and Total Price are NOT in the mapping, so they
-- are never read -- there is no pricing anywhere in this app.
--
-- ITS ROW RULE (0042, 2026-09-30): a line whose Category Code begins `FBX-`
-- is a fabric line for the nearest item line above it. The bill writes
-- `FBX-SEA-IN` on every fabric line and prints each under its item -- 34 of
-- them, checked against both copies of the real file -- where only five name
-- their item in brackets. Without it the seeded read staged 96 records and 5
-- fabric specs; with it, 67 and 34, the reading pilot's model made. The
-- bracket still wins where it names one item line. This file REQUIRES 0042.
--
-- `headings` is the whole folded header, blanks included (three headings are
-- merged across two columns), as the person-saved row carried it: it records
-- what the layout was saved against; the match reads `mapping` only.
--
-- IDEMPOTENT, and the seed is the one version of this NAME. A row of the same
-- name -- the person's own save it was copied from -- is taken over: its
-- mapping is set to this one, it becomes the seed's, and a retired copy is
-- brought back. Re-running this file restores the layout exactly. Retire it by
-- removing it from this file, never by hand on one database.
-- ==========================================================================

insert into boq_layouts (name, headings, mapping, header_rows, row_rules, created_by)
values (
  'Aman Interiors — AMB pricing document',
  array[
    'line', 'area', 'sub-area', 'category code', 'spec code', '', 'image', 'item description', '',
    'target unit cost', '', 'unit', 'total qty', 'unit price usd $', 'total price usd $', '', 'notes'
  ],
  jsonb_build_object(
    'sourceLine', 'line',
    'area', 'area',
    'subArea', 'sub-area',
    'boqCategory', 'category code',
    'code', 'spec code',
    'itemDescription', 'item description',
    'qtyUnit', 'unit',
    'qty', 'total qty',
    'notes', 'notes'
  ),
  1,
  jsonb_build_object('finishForCategoryPrefix', 'FBX-'),
  'seed'
)
on conflict (name) do update set
  headings = excluded.headings,
  mapping = excluded.mapping,
  header_rows = excluded.header_rows,
  row_rules = excluded.row_rules,
  created_by = excluded.created_by,
  retired_at = null;
