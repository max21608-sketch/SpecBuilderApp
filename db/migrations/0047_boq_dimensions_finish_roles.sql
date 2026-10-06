-- ==========================================================================
-- 0047_boq_dimensions_finish_roles.sql -- a bill's own Dims and Finish
-- columns are roles the reader knows; so are a Prototype Quantity and a
-- column somebody wants kept in notes.
--
-- WHAT WAS FOUND (2026-10-06, Matthew's new bills run through the real
-- reader). Both Butler Arms bills (specifier Creation Luxury) print each
-- item's size and finish in COLUMNS of their own beside a one-line
-- description -- `Description | Qty | Dims | Finish | PRICE PER UNIT` on the
-- bedrooms bill, `ITEM | ... | DESCRIPTION | DIMENSIONS` on the public areas
-- one. The reader had no role for either, so the model's structure read
-- mapped every other column correctly and left these two null, and every
-- size and finish on both bills was lost at confirm.
--
-- So two roles, `dimensions` and `finish` (src/lib/boq-roles.ts). A cell is
-- staged verbatim (`dimensionsRaw`, `finishRaw`) and read at review and
-- confirm by src/lib/bill-description.ts -- the reader a description cell's
-- own "Sizes:" and "Finish:" lines already go through -- so nothing here
-- adds a second size parser and nothing infers a unit from a figure.
--
-- AND TWO MORE, the same day, Max's decisions on the same bills (brief C):
--
--   `mockupQty`  a bill's "Prototype Quantity" beside its "Rollout Quantity".
--                The items it names are ALSO put on the project's mock-up
--                phase at confirm (src/lib/bill-sheet-notices.ts,
--                addToMockupPhase). Seeded synonym: "prototype quantity".
--   `keep`       "kept in notes": a column no other role fits that a person
--                wants kept (the Butler Arms public areas bill's client
--                `PHASE`). Each cell goes into the new record's internal
--                notes as `<heading>: <value>`. The ONE role several columns
--                may share -- in the staged JSON, a person's mapping and a
--                saved layout it is a LIST beside the one-column roles
--                (`boq_layouts.mapping.keep` is an array of folded headings),
--                which the jsonb shape check below already allows.
--
-- 0047 WAS EXTENDED IN PLACE, not followed by a 0048, because on 2026-10-06
-- it had been applied to LOCAL databases only. A database that already holds
-- the first version of this file needs its ledger row removed and the file
-- run again (it drops and re-adds the one constraint, so it is safe to):
--   delete from schema_migrations where filename = '0047_boq_dimensions_finish_roles.sql';
-- The sandbox has never had it; applying it there is Max's step.
--
-- WHY THIS IS A MIGRATION AT ALL: the role list is a CHECK on
-- boq_column_aliases, and the seed's three new synonyms (db/seed/0012:
-- "dims", "dimensions", "finish") are refused without it. It is the only
-- place the list is held in the database: `boq_layouts.mapping` is a jsonb
-- object checked for shape only, and the staged JSON is validated in code
-- (`isBoqReadRole`, the structure tool's zod enum), both of which read
-- BOQ_READ_ROLES.
--
-- RE-LISTED FROM THE LIVE CONSTRAINT, never from 0040's text -- 0032 is why
-- (0028 copied a stale list and silently deleted a value). Read on the local
-- stack on 2026-10-06 with pg_get_constraintdef on
-- boq_column_aliases_role_check:
--   code, itemDescription, qty, qtyUnit, area, subArea, designer,
--   boqCategory, productReference, sourceLine, notes, ignore
-- and again for the extension, after the first version of this file:
--   ... the same twelve, then dimensions, finish
-- Re-check it on the sandbox before applying there: a value added since on
-- that database and missing below would be deleted by this file.
-- tests/db/vocabulary-sync.test.ts asserts BOQ_ROLES against the result.
-- ==========================================================================
begin;

alter table boq_column_aliases drop constraint boq_column_aliases_role_check;

alter table boq_column_aliases add constraint boq_column_aliases_role_check check (role in (
  'code', 'itemDescription', 'qty', 'qtyUnit', 'area', 'subArea', 'designer',
  'boqCategory', 'productReference', 'sourceLine', 'notes', 'ignore',
  'dimensions', 'finish', 'mockupQty', 'keep'
));

commit;
