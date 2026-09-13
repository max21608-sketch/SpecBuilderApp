-- ==========================================================================
-- 0001_spec_fields.sql -- the 56 BWS specification fields (columns AF-CI).
--
-- This register is OWNED BY BWS, not by this app. It is seeded from the BWS
-- job spec CSV export, whose two header rows carry the field names (row 1) and
-- the JSON field ids (row 2). Verified against BWS-spec-system-reference.md:
-- 56 fields, ids unique, no blanks.
--
-- Columns CJ-DE of that export are website/style fields and are deliberately
-- excluded; A-AE are job metadata.
--
-- json_id is the key. column_letter is positional and shifts if BWS ever
-- inserts a column -- never join on it.
--
-- `name` is verbatim from the export, INCLUDING the trailing space on
-- 'Stone ' (id 147). name_norm is what lookups use, so a re-sync cannot
-- produce 'Stone' and 'Stone ' as two separate fields.
--
-- Re-running this updates names and ordering in place. It never deletes: a
-- field that disappears from BWS may still be referenced by live answers, so
-- removal is a deliberate migration with a diff report, per the
-- external-vocabulary-sync skill.
-- ==========================================================================

insert into spec_fields (json_id, column_letter, name, name_norm, field_category, sort_order, created_by, updated_by)
values
  (34, 'AF', 'Routing', 'routing', 'Generic', 1, 'seed', 'seed'),
  (230, 'AG', 'Ex VAT RRP', 'ex vat rrp', 'Generic', 2, 'seed', 'seed'),
  (3, 'AH', 'Dimensions', 'dimensions', 'Generic', 3, 'seed', 'seed'),
  (36, 'AI', 'Mattress setting', 'mattress setting', 'Bed', 4, 'seed', 'seed'),
  (1, 'AJ', 'COM 1', 'com 1', 'Generic', 5, 'seed', 'seed'),
  (2, 'AK', 'COM 2', 'com 2', 'Generic', 6, 'seed', 'seed'),
  (14, 'AL', 'COM 3', 'com 3', 'Generic', 7, 'seed', 'seed'),
  (74, 'AM', 'FR Interliner', 'fr interliner', 'Upholstery Build', 8, 'seed', 'seed'),
  (9, 'AN', 'Hinges', 'hinges', 'Hardware', 9, 'seed', 'seed'),
  (16, 'AO', 'Stud spec', 'stud spec', 'Upholstery Build', 10, 'seed', 'seed'),
  (267, 'AP', 'Upholstery free text', 'upholstery free text', 'Upholstery Build', 11, 'seed', 'seed'),
  (10, 'AQ', 'Runners', 'runners', 'Hardware', 12, 'seed', 'seed'),
  (37, 'AR', 'Stitching spec', 'stitching spec', 'Upholstery Build', 13, 'seed', 'seed'),
  (11, 'AS', 'Seat Upholstery Build', 'seat upholstery build', 'Upholstery Build', 14, 'seed', 'seed'),
  (232, 'AT', 'Swivel Mechs', 'swivel mechs', 'Hardware', 15, 'seed', 'seed'),
  (12, 'AU', 'Back Upholstery Build', 'back upholstery build', 'Upholstery Build', 16, 'seed', 'seed'),
  (8, 'AV', 'COM Hardware', 'com hardware', 'Hardware', 17, 'seed', 'seed'),
  (13, 'AW', 'Arm Upholstery Build', 'arm upholstery build', 'Upholstery Build', 18, 'seed', 'seed'),
  (25, 'AX', 'Back Cushion Build', 'back cushion build', 'Upholstery Build', 19, 'seed', 'seed'),
  (4, 'AY', 'Main timber finish', 'main timber finish', 'Finishing', 20, 'seed', 'seed'),
  (31, 'AZ', 'Timber Finish 2', 'timber finish 2', 'Finishing', 21, 'seed', 'seed'),
  (143, 'BA', 'Timber Finish 3', 'timber finish 3', 'Finishing', 22, 'seed', 'seed'),
  (5, 'BB', 'Main metal finish', 'main metal finish', 'Finishing', 23, 'seed', 'seed'),
  (35, 'BC', 'Metal Finish 2', 'metal finish 2', 'Finishing', 24, 'seed', 'seed'),
  (15, 'BD', 'Glass & Mirror Spec', 'glass & mirror spec', 'Finishing', 25, 'seed', 'seed'),
  (39, 'BE', 'Floor type', 'floor type', 'Generic', 26, 'seed', 'seed'),
  (147, 'BF', 'Stone ', 'stone', 'Generic', 27, 'seed', 'seed'),
  (72, 'BG', 'Skirting', 'skirting', 'Generic', 28, 'seed', 'seed'),
  (73, 'BH', 'Wall build', 'wall build', 'Generic', 29, 'seed', 'seed'),
  (130, 'BI', 'Outdoor', 'outdoor', 'Generic', 30, 'seed', 'seed'),
  (6, 'BJ', 'Access - Select option', 'access - select option', 'Generic', 31, 'seed', 'seed'),
  (7, 'BK', 'Site Info - survey + dry fit', 'site info - survey + dry fit', 'Generic', 32, 'seed', 'seed'),
  (191, 'BL', 'Assy guide required', 'assy guide required', 'Generic', 33, 'seed', 'seed'),
  (186, 'BM', 'Blue Label Stock?', 'blue label stock?', 'Generic', 34, 'seed', 'seed'),
  (189, 'BN', 'Dimensions checked', 'dimensions checked', 'Generic', 35, 'seed', 'seed'),
  (75, 'BO', 'BW Supplied Hardware', 'bw supplied hardware', 'Hardware', 36, 'seed', 'seed'),
  (190, 'BP', 'Drawer liner', 'drawer liner', 'Generic', 37, 'seed', 'seed'),
  (110, 'BQ', 'BOM 1', 'bom 1', 'BOM', 38, 'seed', 'seed'),
  (111, 'BR', 'BOM 2', 'bom 2', 'BOM', 39, 'seed', 'seed'),
  (112, 'BS', 'BOM 3', 'bom 3', 'BOM', 40, 'seed', 'seed'),
  (228, 'BT', 'BOM Hardware 1', 'bom hardware 1', 'BOM', 41, 'seed', 'seed'),
  (21, 'BU', 'Finishing - Colour of sample', 'finishing - colour of sample', 'Finishing', 42, 'seed', 'seed'),
  (187, 'BV', 'Upholstery pictures & Wash-up', 'upholstery pictures & wash-up', 'Generic', 43, 'seed', 'seed'),
  (229, 'BW', 'BOM Hardware 2', 'bom hardware 2', 'BOM', 44, 'seed', 'seed'),
  (137, 'BX', 'Bed - 4 Poster', 'bed - 4 poster', 'Bed', 45, 'seed', 'seed'),
  (138, 'BY', 'Bed - Fitted Headboard', 'bed - fitted headboard', 'Bed', 46, 'seed', 'seed'),
  (139, 'BZ', 'Bed - Underbed storage', 'bed - underbed storage', 'Bed', 47, 'seed', 'seed'),
  (140, 'CA', 'Bed - Headboard only', 'bed - headboard only', 'Bed', 48, 'seed', 'seed'),
  (188, 'CB', 'BL Pictures Job', 'bl pictures job', 'Generic', 49, 'seed', 'seed'),
  (195, 'CC', 'Job Budget', 'job budget', 'Generic', 50, 'seed', 'seed'),
  (153, 'CD', 'Blue Label Product Washed Up?', 'blue label product washed up?', 'Generic', 51, 'seed', 'seed'),
  (22, 'CE', 'Finishing Sheen', 'finishing sheen', 'Finishing', 52, 'seed', 'seed'),
  (192, 'CF', 'Substrate', 'substrate', 'Finishing', 53, 'seed', 'seed'),
  (23, 'CG', 'Timber Cut', 'timber cut', 'Finishing', 54, 'seed', 'seed'),
  (150, 'CH', 'Finishing Recipe', 'finishing recipe', 'Finishing', 55, 'seed', 'seed'),
  (24, 'CI', 'Purchasing Notes', 'purchasing notes', 'Generic', 56, 'seed', 'seed')
on conflict (json_id) do update set
  column_letter  = excluded.column_letter,
  name           = excluded.name,
  name_norm      = excluded.name_norm,
  field_category = excluded.field_category,
  sort_order     = excluded.sort_order,
  synced_at      = now(),
  updated_by     = 'seed';
