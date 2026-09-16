-- ==========================================================================
-- 0016_attribute_supersession.sql
--
-- WHY. `record_attributes` has carried `status`, `retired_at` and `retired_by`
-- since 0007, and NOTHING HAS EVER SET THEM. There is no update statement
-- against that table anywhere in src/ — the row is written once by a drawing
-- confirm and is then permanent.
--
-- That is a dead end with a signpost pointing at it. Three blocker messages in
-- drawing-document.ts tell a reviewer to "retire that one" or "retire the old
-- value" when a second document gives the same slot, and the reviewer has no
-- way to do it. A revised drawing for one item therefore CANNOT LAND: the
-- partial unique indexes on (record_id, spec_field_id) and (record_id,
-- dimension_slot) refuse the insert, and the remedy does not exist.
--
-- One column, and it is the one that makes a replacement legible:
-- `superseded_by_id` says WHICH row took over. Without it a retired attribute
-- and a replaced one look the same, and "why did the width change on the 14th"
-- is answered by guessing which of two rows came next.
--
-- The uniqueness indexes are already `where status = 'active'`, so a
-- replacement is retire-then-insert inside one transaction. The reverse order
-- cannot commit, which is a useful thing for the constraint to be deciding
-- rather than the code.
-- ==========================================================================

begin;

alter table record_attributes
  add column superseded_by_id uuid references record_attributes(id) on delete set null;

-- Only a retired row can have been superseded. An active row pointing at its
-- successor would mean two rows are current, which is the state the partial
-- unique indexes exist to prevent.
alter table record_attributes
  add constraint record_attributes_superseded_is_retired
  check (superseded_by_id is null or status = 'retired');

create index record_attributes_superseded_idx
  on record_attributes (superseded_by_id) where superseded_by_id is not null;

commit;
