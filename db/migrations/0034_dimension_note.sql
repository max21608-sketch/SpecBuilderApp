-- ==========================================================================
-- 0034_dimension_note.sql -- the one qualifier a PERSON types beside the five
-- structured slots.
--
-- WHAT MATTHEW ASKED FOR (2026-09-18, catchup section 3.23). He endorsed the
-- structured dimensions outright -- "much more powerful having it as numbers"
-- -- and then named the thing they cannot hold: "you could say L, 1250 bracket
-- L-shaped return ... a text box for qualifying stuff, or for adding in stuff
-- that doesn't quite fit into the structured boxes". So the five slots stay
-- exactly as they are, and this is the sentence that goes after them.
--
-- ---- WHY IT IS A COLUMN ON THE RECORD -----------------------------------
--
-- Not a `record_attributes` row. That table is WHAT A DOCUMENT SAID, every row
-- carrying the run and page it was read from. This is the opposite: it is
-- typed by a person, about the composed cell as a whole, and it has no page to
-- turn to. Filing it as an attribute would put a hand-typed sentence in the
-- one table whose whole promise is that every row can be re-checked against a
-- page -- and it would then need a slot, because 0011 makes `attr_group =
-- 'dimension'` MEAN one of the five.
--
-- Not 0029's `record_attributes.qualifier` either, and that one is worth
-- stating plainly because it is the obvious place to look. 0029's qualifier is
-- PER ATTRIBUTE -- the placement half of one spec value, "Main body and self
-- pipe" on COM 1. A dimension cell is composed from up to five attributes off
-- as many as three pages, so there are up to five of those and picking one to
-- stand for the cell would invent a fact. That is exactly why
-- `composeRowCells` sets the Dimensions cell's qualifier to null today. This
-- note is ONE statement about the WHOLE cell, so it belongs to the record.
--
-- ---- ONE LINE, 200 CHARACTERS, ENFORCED HERE ----------------------------
--
-- The composed cell goes into BWS field 3, and a newline inside a BWS cell is
-- a change to the format of the file that OVERWRITES rather than fails -- the
-- same reason `EXPORT_QUALIFIER_MODE` is a TypeScript constant and a test
-- asserts no exported cell contains one. The route refuses a newline in words
-- before it gets here; this is the guarantee behind that, because a constraint
-- the app forgets is a constraint the database keeps.
--
-- 200 characters because it is a qualifier, not a spec: `spec_description`
-- (0028) is where prose about the item goes, and a paragraph pasted into a
-- dimension cell reaches BWS as the dimension.
--
-- NOTE FOR THE NEXT MIGRATION THAT TOUCHES A CHECK: nothing here drops and
-- recreates an existing constraint, so nothing is re-listed and the 0028/0032
-- trap is not in play. Editing the record's details is already `manual_edit`,
-- a change-set kind that has existed since 0028 -- this adds no vocabulary.
-- ==========================================================================
begin;

alter table spec_records add column dimension_note text;

alter table spec_records add constraint spec_records_dimension_note_one_line check (
  dimension_note is null
  or (
    char_length(dimension_note) <= 200
    and position(chr(10) in dimension_note) = 0
    and position(chr(13) in dimension_note) = 0
  )
);

comment on column spec_records.dimension_note is
  'Typed by a person, one per record: the qualifier that goes after the composed dimension cell -- "1250 L-shaped return". Never read off a page, never parsed, one line. Composed into BWS field 3 by composeDimensionCell, which is the only place the bracket is written.';

commit;
