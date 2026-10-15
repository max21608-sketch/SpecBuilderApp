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
--
-- 2026-09-30, THE AMAN MIAMI BEACH BILL (P18181). Four item words on that
-- bill matched no sheet, verified against the bill itself, each put on the
-- sheet whose questions fit the item. Each is this repo's judgement, for
-- Matthew to confirm: the category is his call, not this file's.
--
--   * "Drawers" -> Sideboards Dressers: a free-standing casegood with stone,
--     metal and timber; that sheet asks drawer liner, runners, handles and
--     stone. Wardrobes asks the same, but a wardrobe is a hanging carcass.
--   * "Pouf" was first put on Ottomans Storage boxes ("upholstered, no back"),
--     and MOVED to Armchairs Benches Stools Sofas on 2026-10-15 -- see below.
--   * "Bench Ottoman" -> Ottomans Storage boxes, for the same reason: it is an
--     OTTOMAN in bench form (the head noun is the last word), a seat and a
--     COM with no back. The two-word term is an EXACT match for the item's
--     name, which is what lets it beat "Bench" and "Ottoman" pointing at two
--     different sheets; a name carrying more words than it stays a question.
--   * "Chaise Lounge" -> Sofas bed Daybeds: an outdoor reclining lounger with
--     a cushion; that sheet asks the mattress or cushion type, the storm
--     covers and indoor or outdoor. The bill's own spelling, "Lounge" -- the
--     matcher compares WHOLE words, so neither "Chair" nor "Lounge" alone
--     reaches it (one word of two is under the cutoff).
--
-- Two misses on that bill are deliberately NOT given a term. "Desk Chair"
-- already has one; it missed because the item's name was the whole
-- description cell, whose other words include "Desk" -- which is a second
-- sheet at the same score. "Bedframe & Headboard - TWIN (X18 = BED BASES -
-- X1 HEADBOARD PER X2 BED BASES)" names BOTH a bed base and a headboard,
-- whole words each, so two sheets tie and a person is asked: that is the
-- matcher refusing to guess, not failing to read.
--
-- 2026-10-15, THE RONNIE SCOTT'S PROCUREMENT SCHEDULE (LBPCo, P16717). On
-- pilot Matthew set the category of every line the matcher left blank, and Max
-- confirmed that evening that what pilot holds is right and should happen by
-- itself next time. These terms are those lines' own names, as the bill
-- writes them, onto the sheet a person chose:
--
--   * "Pouffe" and "Poufee" -> Armchairs Benches Stools Sofas. "Poufee" is the
--     bill's own misspelling, on three lines; it is kept because it is the
--     word a real bill used, and nothing else is spelt that way.
--   * "Pouf" MOVED here from Ottomans Storage boxes, the same day (Max). It
--     was this file's own judgement for the Aman bill and nobody at BW had
--     confirmed it; Matthew's placing of a pouffe is the only answer a person
--     has given. A term maps to ONE category, so a pouf and a pouffe on two
--     sheets would contradict each other. Records already confirmed are not
--     touched: a category is staged with the line and the seed re-runs nothing.
--   * "Lounge table" and "Bar height table" -> Dining tables, as placed.
--     FLAGGED (Q4 of docs/plans/catchup-2026-10-15.md, "leave it, but flag
--     it"): this bill's lounge table is 710 high, which is dining height. A
--     LOW lounge table on another bill will now be suggested Dining tables
--     rather than Side Coffee Bedside Tables. It is a suggestion the reviewer
--     sees on the line, so the cost is one correction, not a wrong record.
--   * "Greeter" and "DJ table" -> Drinks Cabinets Service Stations, as placed:
--     a casegood a person stands behind to serve from.
--   * "Greeter station" and "DJ booth" -> the same sheet. The bill's OWN
--     category column says "CASEGOOD - GREETER STATION" and "CASEGOOD - DJ
--     BOOTH", so these are verified wording too, for a bill that names its
--     lines that way. Nothing reads that column yet (plan A1b, undecided).
--
-- Not given a term: the line named only "TABLE". It ties Dining tables, Side
-- Coffee Bedside Tables and Consoles Desks Dressing Tables, and a person is
-- asked; only the bill's category column ("TABLE - LOUNGE") says which.
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
  ('armchairs-benches-stools-sofas', 'Pouf'),
  ('armchairs-benches-stools-sofas', 'Pouffe'),
  ('armchairs-benches-stools-sofas', 'Poufee'),
  ('sofas-bed-daybeds', 'Sofa bed'),
  ('sofas-bed-daybeds', 'Daybed'),
  ('sofas-bed-daybeds', 'Chaise Lounge'),
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
  ('ottomans-storage-boxes', 'Bench Ottoman'),
  ('consoles-desks-dressing-tables', 'Console'),
  ('consoles-desks-dressing-tables', 'Desk'),
  ('consoles-desks-dressing-tables', 'Dressing table'),
  ('dining-tables', 'Dining table'),
  ('dining-tables', 'Lounge table'),
  ('dining-tables', 'Bar height table'),
  ('drinks-cabinets-service-stations', 'Drinks cabinet'),
  ('drinks-cabinets-service-stations', 'Service station'),
  ('drinks-cabinets-service-stations', 'Greeter'),
  ('drinks-cabinets-service-stations', 'Greeter station'),
  ('drinks-cabinets-service-stations', 'DJ table'),
  ('drinks-cabinets-service-stations', 'DJ booth'),
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
  ('sideboards-dressers', 'Drawers'),
  ('wardrobes', 'Wardrobe')
) as t(slug, term)
join item_categories c on c.slug = t.slug
on conflict (term_norm) do update set
  category_id = excluded.category_id,
  term        = excluded.term;
