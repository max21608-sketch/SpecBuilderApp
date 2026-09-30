-- ==========================================================================
-- 0042_boq_layout_row_rules.sql -- a seeded layout may say which lines are
-- fabric, where the bill's own words say so.
--
-- WHAT WENT WRONG (2026-09-30, the local stack). Once the seeded Aman layout
-- (db/seed/0013) read the pricing document with no model call, only the five
-- fabric lines whose code names its item in brackets -- `GR-FAB-13
-- (GR-FUR-10)` -- became fabric specs. The other 29 staged as ITEMS, and the
-- confirm offered 96 records and 5 fabric specs where pilot's charged model
-- read had made 67 records and 34. The bracket rule is the only row-kind rule
-- code applies on its own, and on this bill it is not the only thing the
-- document says: every fabric line's Category Code begins `FBX-` (`FBX-SEA-IN`
-- under a `SEA-IN` item, `FBX-CAS-IN` under a headboard), and every one of the 34 sits
-- under an item line, with only other fabric lines between -- checked line by
-- line against both copies of the real file on that date. Seven of them NAME a
-- different item in their own words than the one they sit under ("Fabric @
-- Stool" under a sofa, "Option 1" under Option 2); position is what the bill
-- is laid out by, and those seven were reported, not guessed at.
--
-- So a layout may carry a ROW RULE, as data: `row_rules`, a JSON object, null
-- for none. The one rule there is today is
--
--   { "finishForCategoryPrefix": "FBX-" }
--
-- -- a line whose category column begins with that prefix is a fabric line for
-- the nearest item line above it (src/lib/boq-row-kinds.ts,
-- `applyCategoryFinishRule`). Three things about it are traps:
--
--   * IT IS PER LAYOUT, never global. `FBX-` means fabric on ONE specifier's
--     bill because that bill says so in its own category column; on another
--     bill it is a code somebody else chose. A person-saved layout carries no
--     rule -- `/api/boq-layouts` never writes this column.
--   * THE BRACKET STILL WINS where it names exactly one item line, and where
--     it names a line that is not the one above, both are named on the row in
--     amber. A fabric line with no item above it gets no parent and a flag,
--     never a silent record.
--   * AN EMPTY OBJECT IS REFUSED, like 0040's empty mapping: a rule column
--     that says nothing should be null, so "has a rule" is one test.
--
-- Not specification content, so no change set; audited through 0040's
-- trigger like every other write to the table.
-- ==========================================================================
begin;

alter table boq_layouts add column row_rules jsonb;

alter table boq_layouts add constraint boq_layouts_row_rules_is_object check (
  row_rules is null or (jsonb_typeof(row_rules) = 'object' and row_rules <> '{}'::jsonb)
);

comment on column boq_layouts.row_rules is
  'Row-kind rules the bill''s own words license for this layout, e.g. {"finishForCategoryPrefix": "FBX-"}: a line whose category begins with the prefix is a fabric line for the nearest item line above it. Null for none. Written by seeds only.';

commit;
