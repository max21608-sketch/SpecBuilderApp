-- ==========================================================================
-- 0005_spec_matrix_categories.sql
--
-- Matthew's nine seating categories, from BWS_Spec_Decision_Matrix_for_Max.xlsx
-- (2026-09-17), and which of our seventeen cheat sheets each one is.
--
-- HIS NINE ARE NOT OUR SEVENTEEN. Ours come from the cheat sheets and carry
-- the sheets' own names; his look like the BWS boilerplate families
-- (.BW-Sofa, .BW-Armchair-and-Occasional-Chairs, .BW-Benches, .BW-Stools,
-- .BW-Ottomans-and-Storage-Boxes, .BW-Beds-and-Headboards, .BW-Banquettes).
-- The mapping below is MAX'S JUDGEMENT, standing in for Matthew pending his
-- confirmation, and every debatable row says so in its own `note` column so
-- the decision is visible in the data and not only in this file.
--
-- ---- THE THREE JUDGEMENT CALLS, AND WHAT EACH ONE WIDENS ----------------
--
-- 1. A -> `desk-chair-cinema-chair`. He has no category for desk or cinema
--    chairs at all. They are nearer "Armchairs & Occasional Chairs" than
--    "Dining Chairs", and the practical test agrees: swivel applies to his A,
--    and our seed already asks swivel of a desk chair. CONFIRM.
--
-- 2. S and B both -> `armchairs-benches-stools-sofas`, which is ONE sheet
--    covering armchairs, benches, stools and sofas. So that sheet receives
--    his S, A and B together, and SWIVEL WIDENS: he asks it of A and not of
--    S or B, and after this it is asked of all of them. CONFIRM.
--
-- 3. S and D both -> `sofas-bed-daybeds`. SEAT HEIGHT WIDENS: he asks it of
--    S and explicitly not of D ("Not applicable: Daybeds, Ottomans, Beds").
--    CONFIRM.
--
-- Union is the right direction for all three. `docs/bws-spec-grid.md`: "a
-- field nobody can select is a spec value nobody can record". A widened
-- question can be answered N/A, which is a real state; a missing one cannot be
-- answered at all. But widening is a decision, and a decision nobody was told
-- about is indistinguishable from a bug.
--
-- ---- THE EIGHT CABINETRY SHEETS GET NO ROW ------------------------------
--
-- His workbook says "Cabinetry categories (Dining Tables, Coffee Tables,
-- Sideboards, etc.) are in progress and will be added in the next version".
-- They are therefore ABSENT, not guessed. A cheat sheet with no mapping gets
-- no gate view and the screen says so; inventing gates for eight categories
-- from a workbook that does not cover them would be the confidently-wrong
-- failure this whole model exists to avoid.
-- ==========================================================================

insert into spec_matrix_categories (code, name, family, sort_order, created_by, updated_by)
values
  ('S',  'Sofas',                           'upholstery', 1, 'seed', 'seed'),
  ('A',  'Armchairs & Occasional Chairs',   'upholstery', 2, 'seed', 'seed'),
  ('DC', 'Dining Chairs',                   'upholstery', 3, 'seed', 'seed'),
  ('BS', 'Bar Stools',                      'upholstery', 4, 'seed', 'seed'),
  ('B',  'Benches',                         'upholstery', 5, 'seed', 'seed'),
  ('D',  'Daybeds',                         'upholstery', 6, 'seed', 'seed'),
  ('O',  'Ottomans',                        'upholstery', 7, 'seed', 'seed'),
  ('BH', 'Beds & Headboards',               'upholstery', 8, 'seed', 'seed'),
  ('BQ', 'Banquettes',                      'upholstery', 9, 'seed', 'seed')
on conflict (code) do update set
  name       = excluded.name,
  family     = excluded.family,
  sort_order = excluded.sort_order,
  updated_by = 'seed';

insert into spec_matrix_category_map (matrix_code, item_category_id, note, created_by, updated_by)
select v.matrix_code, c.id, v.note, 'seed', 'seed'
from (values
  ('S',  'armchairs-benches-stools-sofas',
   'The sheet that covers sofas. It also covers armchairs and benches, so this sheet receives S, A and B together.'),
  ('S',  'sofas-bed-daybeds',
   'The sheet that covers sofa beds. Shares this sheet with D, which is why seat height widens onto daybeds. CONFIRM WITH MATTHEW.'),
  ('A',  'armchairs-benches-stools-sofas',
   'The sheet that covers armchairs.'),
  ('A',  'desk-chair-cinema-chair',
   'JUDGEMENT: he has no category for desk or cinema chairs. Nearer occasional chairs than dining chairs, and swivel -- which he asks of A -- is already asked of a desk chair by our own seed. CONFIRM WITH MATTHEW.'),
  ('DC', 'dining-chair', null),
  ('BS', 'bar-counter-stools',
   'Stools filed under armchairs-benches-stools-sofas inherit A''s rules by that sheet''s other mappings, not by this row.'),
  ('B',  'armchairs-benches-stools-sofas',
   'Benches share a sheet with armchairs, which is why swivel widens onto benches. CONFIRM WITH MATTHEW.'),
  ('D',  'sofas-bed-daybeds', null),
  ('O',  'ottomans-storage-boxes',
   'Ours adds storage boxes, which his does not name.'),
  ('BH', 'beds-bedbases',
   'His one category is our two sheets; both get the same rules.'),
  ('BH', 'headboards-wall-fixed',
   'His one category is our two sheets; both get the same rules. Headboard fitted = Yes reveals socket and lighting spec on both.'),
  ('BQ', 'banquettes', null)
) as v(matrix_code, slug, note)
join item_categories c on c.slug = v.slug
on conflict (matrix_code, item_category_id) do update set
  note       = excluded.note,
  updated_by = 'seed';
