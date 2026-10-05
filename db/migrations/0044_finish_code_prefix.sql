-- ==========================================================================
-- 0044_finish_code_prefix.sql
--
-- WHY.
--
-- Max, 2026-10-05: a fabric the bill states in words and gives no code is
-- filed in the project's finishes library BY DEFAULT, under an in-house code,
-- and the code reads `BW-AMB-001` -- "BW-", a short code set once per project
-- (AMB for the Miami Beach job), and a three-digit number. Until today the
-- app minted `BW-F-001` on every project, which says nothing about which
-- project a code belongs to when somebody reads it in an email.
--
-- One column and nothing else:
--
--   projects.finish_code_prefix   the short code, stored UPPER-CASE, two to
--                                 six letters or digits. Null keeps minting
--                                 `BW-F-nnn` exactly as before.
--
-- ---- WHAT IT IS NOT ---------------------------------------------------------
--
--   * NOT the origin of a code. `project_finishes.code_origin` (0036) stays
--     the ONLY thing that says a code is ours, and so the only thing that
--     keeps it out of the BWS export, the quote and the costing sheet. A
--     client schedule that prints `BW-AMB-002` is still a client code.
--   * NOT a rename. Changing the short code later starts a new series at 001
--     and leaves every code already minted as it is: a code somebody wrote
--     down keeps its meaning (the variant-letter rule). Existing `BW-F-nnn`
--     codes are never renamed either.
--
-- ---- NO CHECK IS RE-LISTED ---------------------------------------------------
--
-- A NEW constraint over one new column. Nothing here drops and recreates an
-- existing CHECK, which is the 0032 trap. No change-set kind is added: setting
-- the short code is a project PATCH like the drawing unit, and minting happens
-- inside the confirm that files the finish.
-- ==========================================================================
begin;

alter table projects add column finish_code_prefix text;

alter table projects add constraint projects_finish_code_prefix_check
  check (finish_code_prefix is null or finish_code_prefix ~ '^[A-Z0-9]{2,6}$');

comment on column projects.finish_code_prefix is
  'The short code in this project''s in-house finish codes (0044): AMB mints BW-AMB-001 upward. Upper-case, 2-6 letters or digits. Null mints BW-F-nnn. Changing it starts a new series and renames nothing. Never the origin of a code: project_finishes.code_origin is.';

commit;
