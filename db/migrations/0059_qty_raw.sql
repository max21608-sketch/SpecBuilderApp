-- ==========================================================================
-- 0059_qty_raw.sql -- the bill's quantity cell as printed, where it gave no
-- count.
--
-- Since 2026-11-06 (audit C3) a quantity cell that is not a whole number
-- (`TBC`, `As req'd`, `1,200`, `1.5`) stages `qty: null` with the cell's text
-- as `qtyRaw`, and the BILL REVIEW prints `quantityNotGiven(qtyRaw)`:
-- "quantity not given (the bill says "TBC")". Once confirmed, the record held
-- no copy of that text, so the phase table and the record screen could only
-- say "quantity not given" -- the same words for a blank cell and for a bill
-- that wrote "1,200", which is a question a person can answer by looking.
--
-- `qty_raw` is that text, verbatim, and only where the bill gave no count:
-- null where it printed a count (then `qty` is the bill) and null where the
-- cell was blank. The reason is COMPUTED from it on every read
-- (`quantityNotGiven`), never stored, because a stored reason goes stale the
-- day the reader learns a new shape. Written by the BOQ confirm, and by a
-- revision as `qty_unit` is: the bill's own column, written over.
--
-- No CHECK ties it to `qty`. A row written before this file carries neither,
-- and the confirm is the one writer.
-- ==========================================================================
begin;

alter table spec_records add column qty_raw text;

comment on column spec_records.qty_raw is
  'The bill''s quantity cell as printed, where it gave no count (qty is null): "TBC", "1,200". Null where it printed a count or nothing. Written by the BOQ confirm; read through quantityNotGiven.';

commit;
