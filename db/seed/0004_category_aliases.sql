-- ==========================================================================
-- 0004_category_aliases.sql -- BOQ vocabulary for each cheat sheet category.
--
-- Taken from the words the pilot BOQ actually uses. A term maps to exactly one
-- category (unique on term_norm), because a term that could mean two
-- categories must stay ambiguous for a human rather than resolve to whichever
-- row sorted first.
--
-- Deliberately conservative. "Chair" alone is NOT here: a BOQ "Chair" might be
-- a dining chair, a desk chair or an armchair, and the matcher showing
-- candidates is the correct outcome. Add a term when the business decides what
-- it means, not to make a number go up.
-- ==========================================================================

insert into item_category_aliases (category_id, term, term_norm, created_by)
select c.id, t.term, lower(t.term), 'seed'
from (values
  ('armchairs-benches-stools-sofas', 'Sofa'),
  ('armchairs-benches-stools-sofas', 'Armchair'),
  ('armchairs-benches-stools-sofas', 'Bench'),
  ('armchairs-benches-stools-sofas', 'Stool'),
  ('armchairs-benches-stools-sofas', 'Footstool'),
  ('armchairs-benches-stools-sofas', 'Dressing Stool'),
  ('armchairs-benches-stools-sofas', 'Bed Bench'),
  ('armchairs-benches-stools-sofas', 'Entrance Stool'),
  ('armchairs-benches-stools-sofas', 'Bathroom Stool'),
  ('sofas-bed-daybeds', 'Sofa bed'),
  ('sofas-bed-daybeds', 'Daybed'),
  ('banquettes', 'Banquette'),
  ('bar-counter-stools', 'Bar stool'),
  ('bar-counter-stools', 'Bar stools'),
  ('bar-counter-stools', 'Counter stool'),
  ('beds-bedbases', 'Bed'),
  ('beds-bedbases', 'Bedbase'),
  ('headboards-wall-fixed', 'Headboard'),
  ('dining-chair', 'Dining chair'),
  ('desk-chair-cinema-chair', 'Desk chair'),
  ('desk-chair-cinema-chair', 'Cinema chair'),
  ('ottomans-storage-boxes', 'Ottoman'),
  ('ottomans-storage-boxes', 'Storage box'),
  ('consoles-desks-dressing-tables', 'Console'),
  ('consoles-desks-dressing-tables', 'Desk'),
  ('consoles-desks-dressing-tables', 'Dressing table'),
  ('dining-tables', 'Dining table'),
  ('drinks-cabinets-service-stations', 'Drinks cabinet'),
  ('drinks-cabinets-service-stations', 'Service station'),
  ('mirrors', 'Mirror'),
  ('shelves-bookcase', 'Shelf'),
  ('shelves-bookcase', 'Bookcase'),
  ('side-coffee-bedside-tables', 'Side table'),
  ('side-coffee-bedside-tables', 'Coffee table'),
  ('side-coffee-bedside-tables', 'Bedside table'),
  ('side-coffee-bedside-tables', 'Low table'),
  ('side-coffee-bedside-tables', 'Bathroom side table'),
  ('sideboards-dressers', 'Sideboard'),
  ('sideboards-dressers', 'Dresser'),
  ('wardrobes', 'Wardrobe')
) as t(slug, term)
join item_categories c on c.slug = t.slug
on conflict (term_norm) do update set
  category_id = excluded.category_id,
  term        = excluded.term;
