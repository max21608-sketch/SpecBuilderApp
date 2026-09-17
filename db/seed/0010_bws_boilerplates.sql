-- ==========================================================================
-- 0010_bws_boilerplates.sql
--
-- The 45 BWS boilerplate product codes, captured read-only on 2026-09-14 by
-- GET of /product_codes/<id>/specifications. Nothing was written to BWS.
--
-- BEN WHISTLER'S OWN product codes, not client material: the same class of
-- thing as db/seed/0001_spec_fields.sql, which has seeded 56 BWS-owned rows
-- since the beginning. A boilerplate carries no client, no project and no
-- price. See 0031's header for why that distinction matters.
--
-- `matrix_code` is set on the EIGHTEEN that are one of Matthew's nine seating
-- categories -- a Simple and a with-Metalwork for each, which is exactly what
-- his derivation rule needs. The other 27 are recorded with a null code:
-- cabinetry (his matrix does not cover it yet), panelling, recoveries,
-- scatters, lighting, and the three oddities the capture flagged.
--
-- NONE of the nine seating families has a Hero variant; six cabinetry families
-- do. So `variant = 'hero'` appears only on rows with no matrix code, and a
-- hero sofa has no code of its own to be derived to. Question 6 for Matthew.
--
-- The two Planning stub codes (3555, 3556) are not here: the capture recorded
-- them as carrying no fields at all.
-- ==========================================================================

insert into bws_boilerplates (bws_id, code, matrix_code, variant, created_by, updated_by)
values
  (929, '.BW-Armchair-and-Occasional-Chairs,-Simple-BOILERPLATE', 'A', 'simple', 'seed', 'seed'),
  (930, '.BW-Armchair-and-Occasional-Chairs,-with-Metalwork-BOILERPLATE', 'A', 'metalwork', 'seed', 'seed'),
  (1312, '.BW-Banquettes,-Simple-BOILERPLATE', 'BQ', 'simple', 'seed', 'seed'),
  (1313, '.BW-Banquettes,-with-Metalwork--BOILERPLATE', 'BQ', 'metalwork', 'seed', 'seed'),
  (941, '.BW-Bar-Stools,-Simple-BOILERPLATE', 'BS', 'simple', 'seed', 'seed'),
  (940, '.BW-Bar-Stools,-with-Metalwork-BOILERPLATE', 'BS', 'metalwork', 'seed', 'seed'),
  (861, '.BW-Beds-and-Headboards,Simple-BOILERPLATE', 'BH', 'simple', 'seed', 'seed'),
  (862, '.BW-Beds-and-Headboards,with-Metalwork-BOILERPLATE', 'BH', 'metalwork', 'seed', 'seed'),
  (858, '.BW-Benches,Simple-BOILERPLATE', 'B', 'simple', 'seed', 'seed'),
  (859, '.BW-Benches,with-Metalwork-BOILERPLATE', 'B', 'metalwork', 'seed', 'seed'),
  (950, '.BWCAB-Bedside-Tables-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (844, '.BWCAB-Bedside-Tables,Hero-BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (944, '.BWCAB-Coffee-Tables-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (943, '.BWCAB-Coffee-Tables,-Hero-BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (945, '.BWCAB-Consoles-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (947, '.BWCAB-Consoles,-Hero-BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (1534, '.BWCAB-Desks-and-Dressing-Tables-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (951, '.BWCAB-Desks-and-Dressing-Tables,-Hero-BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (845, '.BWCAB-Dining-Tables-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (1536, '.BWCAB-Drinks-Cabinets-and-Service-Stations-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (1533, '.BWCAB-Lighting-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (948, '.BWCAB-Mirrors-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (949, '.BWCAB-Mirrors,-Hero--BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (1535, '.BWCAB-Shelves-and-Wardrobes-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (842, '.BWCAB-Sideboards-and-Dressers,Hero-BOILERPLATE', null, 'hero', 'seed', 'seed'),
  (946, '.BWCAB-Sideboards-and-Dressers,-Simple-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (1537, '.BWCAB-Side-Tables-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (1540, '.BW-Cinema-Chairs-and-Sofas-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (935, '.BW-Daybed,-Simple-BOILERPLATE', 'D', 'simple', 'seed', 'seed'),
  (934, '.BW-Daybed,-with-Metal-BOILERPLATE', 'D', 'metalwork', 'seed', 'seed'),
  (852, '.BW-Dining-and-Desk-Chairs,Simple-BOILERPLATE', 'DC', 'simple', 'seed', 'seed'),
  (853, '.BW-Dining-and-Desk-Chairs,with-Metal-BOILERPLATE', 'DC', 'metalwork', 'seed', 'seed'),
  (855, '.BW-Ottomans-and-Storage-Boxes,Simple-BOILERPLATE', 'O', 'simple', 'seed', 'seed'),
  (856, '.BW-Ottomans-and-Storage-Boxes,with-Metalwork-BOILERPLATE', 'O', 'metalwork', 'seed', 'seed'),
  (863, '.BW-Panelling,Simple-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (865, '.BW-Panelling,Upholstery-only-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (864, '.BW-Panellling,with-Metalwork-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (932, '.BW-Recoveries,-All-Categories-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (954, '.BW-Scatters,-Throws-and-Covers-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (847, '.BW-Sofa,Simple-BOILERPLATE', 'S', 'simple', 'seed', 'seed'),
  (850, '.BW-Sofa,Simple,Fitted-on-site-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (851, '.BW-Sofa,with-Metalwork-BOILERPLATE', 'S', 'metalwork', 'seed', 'seed'),
  (848, '.BW-Sofa-with-non-critical--Metalwork-BOILERPLATE', null, 'other', 'seed', 'seed'),
  (1538, '.BW-Stools,-Simple-BOILERPLATE-COPY', null, 'other', 'seed', 'seed'),
  (1539, '.BW-Stools,-with-Metalwork-BOILERPLATE', null, 'other', 'seed', 'seed')
on conflict (bws_id) do update set
  code        = excluded.code,
  matrix_code = excluded.matrix_code,
  variant     = excluded.variant,
  active      = true,
  updated_by  = 'seed';

-- Every one of Matthew's nine needs BOTH variants, or his rule has no answer
-- for half its cases and a quote line would silently carry no product code.
do $$
declare missing text;
begin
  select string_agg(c.code || '/' || v.variant, ', ') into missing
    from spec_matrix_categories c
    cross join (values ('simple'), ('metalwork')) as v(variant)
   where not exists (
     select 1 from bws_boilerplates b
      where b.matrix_code = c.code and b.variant = v.variant and b.active);
  if missing is not null then
    raise exception '0010 seed: no boilerplate for %', missing;
  end if;
end $$;
