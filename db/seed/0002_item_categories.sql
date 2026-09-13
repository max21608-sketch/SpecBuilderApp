-- ==========================================================================
-- 0002_item_categories.sql -- the 17 cheat sheet categories.
--
-- Nine upholstery, eight cabinetry, taken from the category workbooks in
-- SharePoint (CHEATSHEET LISTS). The names are the sheets' own.
--
-- requirements_authored is true for all seventeen because 0003 seeds a real
-- requirement set for every one. It exists for the category that gets added
-- later without a sheet behind it: an empty requirement set scores
-- answered/required = 0/0, which a completion view renders as 100% complete.
-- Any category created without requirements must leave this false.
-- ==========================================================================

insert into item_categories (slug, family, name, requirements_authored, sort_order, created_by, updated_by)
values
  ('consoles-desks-dressing-tables', 'cabinetry', 'Consoles Desks Dressing Tables', true, 1, 'seed', 'seed'),
  ('dining-tables', 'cabinetry', 'Dining tables', true, 2, 'seed', 'seed'),
  ('drinks-cabinets-service-stations', 'cabinetry', 'Drinks Cabinets Service Stations', true, 3, 'seed', 'seed'),
  ('mirrors', 'cabinetry', 'Mirrors', true, 4, 'seed', 'seed'),
  ('shelves-bookcase', 'cabinetry', 'Shelves Bookcase', true, 5, 'seed', 'seed'),
  ('side-coffee-bedside-tables', 'cabinetry', 'Side Coffee Bedside Tables', true, 6, 'seed', 'seed'),
  ('sideboards-dressers', 'cabinetry', 'Sideboards Dressers', true, 7, 'seed', 'seed'),
  ('wardrobes', 'cabinetry', 'Wardrobes', true, 8, 'seed', 'seed'),
  ('armchairs-benches-stools-sofas', 'upholstery', 'Armchairs Benches Stools Sofas', true, 9, 'seed', 'seed'),
  ('banquettes', 'upholstery', 'Banquettes', true, 10, 'seed', 'seed'),
  ('bar-counter-stools', 'upholstery', 'Bar Counter Stools', true, 11, 'seed', 'seed'),
  ('beds-bedbases', 'upholstery', 'Beds Bedbases', true, 12, 'seed', 'seed'),
  ('desk-chair-cinema-chair', 'upholstery', 'Desk chair Cinema chair', true, 13, 'seed', 'seed'),
  ('dining-chair', 'upholstery', 'Dining chair', true, 14, 'seed', 'seed'),
  ('headboards-wall-fixed', 'upholstery', 'Headboards wall fixed', true, 15, 'seed', 'seed'),
  ('ottomans-storage-boxes', 'upholstery', 'Ottomans Storage boxes', true, 16, 'seed', 'seed'),
  ('sofas-bed-daybeds', 'upholstery', 'Sofas bed Daybeds', true, 17, 'seed', 'seed')
on conflict (slug) do update set
  family     = excluded.family,
  name       = excluded.name,
  sort_order = excluded.sort_order,
  updated_by = 'seed';
