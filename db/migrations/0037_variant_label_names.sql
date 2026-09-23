-- 0037 — a configuration is named the way the document names it
--
-- ===========================================================================
-- WHY.
--
-- 0024 gave a variant a NAME, and the only names it anticipated were our own
-- page letters: S-201 A, S-201 B. Its CHECK allows eight characters and no
-- ampersand, which is right for a letter and wrong for what a document says.
--
-- Panther's S-301 desk chair is specified "as per room type": Type 1 & 5 in one
-- cloth, Type 2, Type 3 and Type 4 in three others, one bill line. That is five
-- chairs to make, and Max decided on 2026-09-23 that each is named as the
-- document names it — S-301 TYPE 2, not S-301 B — because the room type is
-- what the client, the designer and the email all call it, and a letter would
-- be one more mapping somebody has to hold in their head. The drawings review
-- (schemaVersion 3) now reads those names off the page.
--
-- TYPE 1 fits the old shape. A room type the next document names — a suite
-- name, "TYPE 1 & 5 GUEST", an option with a word in it — does not, and the
-- card refuses it in words until this is applied. The refusal is the point of
-- the order: code stays at 0024's shape until the database is at 0037's, so
-- the card can never pass a name the constraint then rejects with a 500.
--
-- WHAT CHANGES: up to 24 characters, and `&` allowed. Still upper case only,
-- still starting with a letter or a digit — these are read aloud and typed
-- into emails, and 0024's reason for refusing lower case stands.
--
-- WHAT DOES NOT: every existing label (A–D in the sandbox) already satisfies
-- the wider shape, so no row needs normalising first and nothing is renamed.
--
-- THE SAME REGEX IS `VARIANT_LABEL_SHAPE` in src/lib/record-variants.ts. It is
-- deliberately still 0024's there; widen it to exactly the pattern below IN
-- THE SAME COMMIT that records this migration as applied. Two copies of a CHECK
-- that drift is the 0028/0032 lesson.
--
-- Re-listed from 0024's own text, the only place this constraint has ever been
-- written (grep spec_records_variant_shape db/ — 2026-09-23).
-- ===========================================================================
begin;

alter table spec_records drop constraint spec_records_variant_shape;

alter table spec_records
  add constraint spec_records_variant_shape
  check (variant_label is null or variant_label ~ '^[A-Z0-9][A-Z0-9 ./&-]{0,23}$');

comment on column spec_records.variant_label is
  'What a person calls this configuration: our page letter (S-201 A) or the name '
  'the document gives it (S-301 TYPE 2). Ours or the document''s, never the '
  'client ref — that stays in spec_record_refs and is the same on every variant.';

commit;
