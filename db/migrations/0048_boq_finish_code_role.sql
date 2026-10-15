-- ==========================================================================
-- 0048_boq_finish_code_role.sql -- a bill's own finish-code column (COM CODE)
-- is a role the reader knows.
--
-- WHAT WAS FOUND (2026-10-15, the Ronnie Scott's procurement schedule, LBPCo,
-- P16717). Every COM, leather and trim line on it carries TWO codes: the
-- FF&E CODE (`FB-CH-02A`, a position on an item type -- the same code is
-- Plushy cognac on one floor's armchairs and Velours Aldo on another's) and
-- the COM CODE (`FB_06`, the code the project's COM LIST describes the cloth
-- under -- `FB_04` is one velvet on three items). The reader had no role for
-- the second, so the model's structure read put it in `productReference` on
-- one sheet and left it unmapped on another, and the confirm filed each cloth
-- under its FF&E code: nothing linked to the COM list, and the second cloth
-- under each shared FF&E code conflicted with the first.
--
-- So a role, `finishCode` (src/lib/boq-roles.ts). A finish line is filed in
-- the library under it and writes its Finish column's cloth as its value
-- (src/lib/bill-fabric-filing.ts); an item line keeps the cell in its notes.
-- Seeded synonym: "com code" (db/seed/0012).
--
-- WHY THIS IS A MIGRATION AT ALL: the role list is a CHECK on
-- boq_column_aliases, and the seed's new synonym is refused without it. The
-- code reads a `finishCode` column without this file -- `boq_layouts.mapping`
-- is checked for shape only and the staged JSON is validated in code -- so it
-- is the SEED that needs 0048 first, not the deployment.
--
-- RE-LISTED FROM THE LIVE CONSTRAINT, never from 0047's text (0032 is why).
-- Read on the local stack on 2026-10-15 with pg_get_constraintdef on
-- boq_column_aliases_role_check:
--   code, itemDescription, qty, qtyUnit, area, subArea, designer,
--   boqCategory, productReference, sourceLine, notes, ignore, dimensions,
--   finish, mockupQty, keep
-- Re-check it on the sandbox and pilot before applying there: a value added
-- since on that database and missing below would be deleted by this file.
-- tests/db/vocabulary-sync.test.ts asserts BOQ_ROLES against the result.
-- ==========================================================================
begin;

alter table boq_column_aliases drop constraint boq_column_aliases_role_check;

alter table boq_column_aliases add constraint boq_column_aliases_role_check check (role in (
  'code', 'itemDescription', 'qty', 'qtyUnit', 'area', 'subArea', 'designer',
  'boqCategory', 'productReference', 'sourceLine', 'notes', 'ignore',
  'dimensions', 'finish', 'mockupQty', 'keep', 'finishCode'
));

commit;
