-- ==========================================================================
-- 0003_requirements_section.sql — group requirements the way the sheet does.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. The cheat sheets are not flat lists: each one is divided into sections
-- (Project / commercial, Design intent, Dimensions, Material finish and
-- substrate, Glass and mirror, Stone, Metalwork, Build details) and the people
-- who use them navigate by those headings. A record screen that lists 43
-- questions in one column is a worse tool than the spreadsheet it replaces.
--
-- This belongs in 0002 and is a separate file only because 0002 was already
-- applied when the omission was found. Editing an applied migration is how two
-- databases silently diverge: the runner keys on filename, so an edited file
-- is never re-applied.
-- ==========================================================================

begin;

alter table requirements add column section text;

commit;
