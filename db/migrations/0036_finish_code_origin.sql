-- ==========================================================================
-- 0036_finish_code_origin.sql
--
-- WHY.
--
-- The S-203 sheet states `Fabric reference: Aissa Dione, ref. Losange raphia
-- beige et écru` and prints no code. `project_finishes` is keyed on the
-- CLIENT'S OWN code — unique on (project_id, code_norm) — so `resolveFinishCode`
-- returned `none`, the confirm wrote the attribute with a null `finish_id`, and
-- the project's finishes library stayed empty while the fabric sat on the
-- record. Max, 2026-09-22: *"there's a finish in the item's specs captured
-- page, but it doesn't appear in the project finishes. Why is this? It
-- should."* The swatch control, keyed the same way, could not be offered at
-- all.
--
-- It was never a broken link. There was no key to file it under.
--
-- MAX'S DECISION, 2026-09-22: the reviewer supplies a code at confirm, and
-- where the client gave none the app MINTS one — `BW-F-001` upward, per
-- project — so the same fabric on a later item can be linked to the same row.
--
-- ---- WHY A COLUMN AND NOT A PREFIX CONVENTION --------------------------
--
-- A code the app minted and a code the client issued are DIFFERENT FACTS, and
-- exactly one thing turns on telling them apart: an internal code must never
-- reach the BWS export, the quote or the costing sheet. `composeFinishCell`
-- emits `<code>; <body>` with the code FIRST, so `BW-F-001` would arrive in
-- the file looking like something the client issued — a plausible-looking
-- wrong answer nothing downstream questions, which is house/conventions.md §5.
--
-- Reading the origin off the code's own spelling would put that rule at the
-- mercy of a client who happens to write `BW-F-…` on their own schedule, and
-- of anybody editing a code on the library screen. The column says it.
--
-- ---- THE DEFAULT IS `client`, AND THAT IS CORRECT FOR EVERY EXISTING ROW --
--
-- Nothing has ever minted a code, so every row on record today is a code a
-- document carried. The default is what the backfill would have written.
-- ==========================================================================

begin;

alter table project_finishes
  add column code_origin text not null default 'client';

-- A NEW constraint over one new column: nothing here re-lists an existing
-- CHECK, which is the 0032 trap (a stale copy of a drop-and-recreate list
-- silently deleted `email_confirm`). Read the LIVE constraint text before ever
-- re-listing one.
alter table project_finishes
  add constraint project_finishes_code_origin_check
  check (code_origin in ('client', 'internal'));

comment on column project_finishes.code_origin is
  'client = the code the client''s own document carried. internal = BW-F-nnn, minted by this app for a finish the client gave no code for. An internal code never reaches the BWS export, the quote or the costing sheet: composeFinishCell emits the description alone for one.';

commit;
