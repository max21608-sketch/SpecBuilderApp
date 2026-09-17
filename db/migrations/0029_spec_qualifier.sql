-- ==========================================================================
-- 0029_spec_qualifier.sql -- the second line of a spec value: where it goes on
-- the item.
--
-- WHY. Matthew, 2026-09-17: "I realise that the spec fields are structured
-- with the top line as the spec and the return line as the qualifier. So COM 1
-- might be 14m of T&G Pink velvet, then the returned line will be the
-- placement 'Main & Self Pipe'. I don't think BWS currently captures that on
-- the export / import but i can get Tim to build the import to suit."
--
-- His decision matrix says the same thing eight times over: rows 15-22 are
-- "COM 1 + location", "Timber finish 1 + location", "Metal finish 1 +
-- location", "Stud spec + location". And his quote example writes it on one
-- line after a dash -- "...30% sheen - Recessed plinth", "...per unit (based
-- on standard 140cm width) - Main".
--
-- This app has never had anywhere to put it. `composeFinishCell` renders the
-- code, description, supplier, reference and colour and carries NO location,
-- and the fabric_schedule prompt tells the model to fold the position INTO the
-- attribute value -- so today a placement is either lost or buried in prose.
--
-- ---- WHY A COLUMN AND NOT A SECOND ROW ----------------------------------
--
-- `record_attributes_field_slot_key` (0007) already says one BWS field, one
-- value per record. A qualifier is NOT a second statement about the item: it
-- is the second line of the same one. A satellite row would re-open "which
-- line wins", which that partial unique index closed, and a second attribute
-- claiming an occupied slot is how an export loses a value with no error.
--
-- ---- AND WHY NOT INSIDE `value` -----------------------------------------
--
-- Because that is the TBC bug in a new place. `renderAttributeValue` exists in
-- the shape it does because a marker composed into a string that may already
-- hold it is not idempotent -- the real pack produced `TBC - ... - 01 TBC` and
-- `TBC TBC` before FMT-GEN-03 was written. Keeping the qualifier apart means
-- the composer always composes from atoms and never parses a string back.
--
-- No `qualifier_raw`. `value_raw` covers what the document said; a second raw
-- column with no writer is the empty promise an unused table makes.
--
-- No constraint tying it to state. "TBC - Yarn Collective" placed on the
-- "Main body and self pipe" is a real and useful combination: the placement
-- can be settled while the fabric is not.
--
-- ---- WHAT THE EXPORT DOES WITH IT, TODAY --------------------------------
--
-- ONE LINE. `EXPORT_QUALIFIER_MODE` in src/lib/bws-export.ts is "inline" and
-- writes `<value> - <qualifier>`, which is the shape Matthew's own quote sheet
-- already uses. It is a TypeScript constant and not an environment variable
-- because a newline inside an export cell is a file-format change to the most
-- dangerous file in the product, and it deserves a deliberate commit and a
-- fresh check-sheet pass rather than a toggle. A test asserts no exported cell
-- contains a newline, so flipping it means seeing that test fail on purpose.
--
-- His file mixes an ASCII hyphen and an en dash. We emit one, always, and
-- parse neither.
-- ==========================================================================
begin;

alter table record_attributes add column qualifier text;
alter table record_attributes add constraint record_attributes_qualifier_not_blank
  check (qualifier is null or btrim(qualifier) <> '');

alter table spec_answers add column qualifier text;
alter table spec_answers add constraint spec_answers_qualifier_not_blank
  check (qualifier is null or btrim(qualifier) <> '');

comment on column record_attributes.qualifier is
  'Where on the item this spec goes: "Main body & self pipe", "Recessed plinth". The second line of one statement, never a second statement.';
comment on column spec_answers.qualifier is
  'The placement the answer carries, promoted from the attribute that filled it. Null for a composed cell, which has no single one.';

commit;
