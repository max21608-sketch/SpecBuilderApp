-- ==========================================================================
-- 0049_finish_kind_trim.sql -- a finish in the library can be a TRIM.
--
-- WHAT WAS FOUND (2026-10-15, the Ronnie Scott's COM list, LBPCo, P16717).
-- The project's COM list files its trims beside its fabrics -- `TR_01`,
-- `TR_02`: cords, gimps and braids, each with a code of its own -- and the
-- bill's finish lines name them under the items they trim. The finishes
-- library had eight kinds and no trim, so a trim could be filed only as
-- "Other", which is the kind for a finish nobody can name. Max, the same
-- evening (Q6): "add a trim kind, which was missing".
--
-- WHAT DOES NOT CHANGE: a trim still fills no BWS field. `billFinishLineKind`
-- has written a bill's trim line with no field since 2026-10-06, and nothing
-- here touches that. `kind` is still never written by the app on its own:
-- `suggestFinishKind` (src/lib/finish-kind-guess.ts) OFFERS trim on a `TR`
-- or `F-TR` code or the word "trim", and a person's click files it.
--
-- RE-LISTED FROM THE LIVE CONSTRAINT, never from 0018's text (0032 is why).
-- Read on the local stack on 2026-10-15 with pg_get_constraintdef on
-- project_finishes_kind_check:
--   kind is null or kind in (fabric, leather, timber, metal, stone, glass,
--   paint, other)
-- Re-check it on the sandbox and pilot before applying there: a value added
-- since on that database and missing below would be deleted by this file.
-- tests/db/vocabulary-sync.test.ts asserts FINISH_KINDS against the result.
--
-- Additive: no row holds `trim` today, so nothing is backfilled, and the code
-- that offers it may deploy after this file. Before it, filing a trim is refused
-- by this CHECK, so apply this file first.
-- ==========================================================================
begin;

alter table project_finishes drop constraint project_finishes_kind_check;

alter table project_finishes add constraint project_finishes_kind_check check (
  kind is null or kind in (
    'fabric', 'leather', 'timber', 'metal', 'stone', 'glass', 'paint', 'other', 'trim'
  )
);

commit;
