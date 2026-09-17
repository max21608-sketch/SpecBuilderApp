-- ==========================================================================
-- 0008_spec_palettes.sql
--
-- The eleven palettes Matthew's decision matrix names. SIX are his own words
-- and are seeded in full. FIVE are BWS-owned and are seeded EMPTY, because
-- this app does not hold them and will not invent them.
--
-- The empty five are the point of this file as much as the six. A palette row
-- with no options and a null `synced_at` says, in the schema, "there is a
-- controlled list here, BWS owns it, and we have never had it" -- which is a
-- question somebody can answer. Five plausible finish lists invented from
-- nowhere is the confidently-wrong failure FMT-GEN-01 exists to prevent, and
-- nothing downstream would ever question one.
--
-- `is_default` marks what a CONTROL preselects. It writes no answer: `missing`
-- means nobody has looked, and a gate passed by a default is a gate passed by
-- nobody. See docs/plans/matrix-assumptions.md, assumption 5.
-- ==========================================================================

insert into spec_palettes (key, name, owner, allows_free_text, source_note, created_by, updated_by)
values
  ('environment',      'Indoor / Outdoor',   'app', false,
   'Matthew''s decision matrix, 2026-09-17, row 9. His own three options.', 'seed', 'seed'),
  ('site_access',      'Site access check',  'app', true,
   'Matthew''s decision matrix, row 10. Free text allowed: an access answer routinely needs a sentence his four options do not hold.', 'seed', 'seed'),
  ('assembly_guide',   'Assembly guide',     'app', false,
   'Matthew''s decision matrix, rows 11 and 33. "No" is the default he states.', 'seed', 'seed'),
  ('swivel',           'Swivel mechanism',   'app', false,
   'Matthew''s decision matrix, row 12. Armchairs and bar stools only.', 'seed', 'seed'),
  ('fr_interliner',    'FR Interliner',      'app', false,
   'Matthew''s decision matrix, row 25.', 'seed', 'seed'),
  ('stitching',        'Stitching spec',     'app', false,
   'Matthew''s decision matrix, row 27.', 'seed', 'seed'),
  ('yes_no',           'Yes / No',           'app', false,
   'Matthew''s decision matrix, rows 13 and 14 (Headboard fitted, Fitted banquette).', 'seed', 'seed'),

  -- ---- the five this app does not hold ----------------------------------
  ('bws_timber_finish','BWS timber finish palette','bws', true,
   'NOT HELD. Matthew names it on rows 18, 19 and 20 ("From BWS timber finish palette"). Ask him for the list, or confirm the field stays free text. Until then the field is free text and the screen says so.', 'seed', 'seed'),
  ('bws_metal_finish', 'BWS metal finish palette','bws', true,
   'NOT HELD. Rows 21 and 22. Same ask.', 'seed', 'seed'),
  ('bws_seat_build',   'BWS seat build palette','bws', true,
   'NOT HELD. Row 23. Same ask.', 'seed', 'seed'),
  ('bws_back_cushion', 'BWS back cushion palette','bws', true,
   'NOT HELD. Row 24. Same ask.', 'seed', 'seed'),
  ('bws_stud',         'BWS stud palette','bws', true,
   'NOT HELD. Row 26. Same ask.', 'seed', 'seed')
on conflict (key) do update set
  name             = excluded.name,
  owner            = excluded.owner,
  allows_free_text = excluded.allows_free_text,
  source_note      = excluded.source_note,
  updated_by       = 'seed';

insert into spec_palette_options (palette_key, value, label, sort_order, is_default, created_by, updated_by)
values
  ('environment', 'Indoor',            'Indoor',                      1, false, 'seed', 'seed'),
  ('environment', 'Outdoor',           'Outdoor',                     2, false, 'seed', 'seed'),
  ('environment', 'Humid indoor',      'Humid indoor (spa/pool)',     3, false, 'seed', 'seed'),

  ('site_access', 'Yes - survey required',             'Yes — survey required',              1, false, 'seed', 'seed'),
  ('site_access', 'Yes - already confirmed clear',     'Yes — already confirmed clear',      2, false, 'seed', 'seed'),
  ('site_access', 'No - standard access',              'No — standard access',               3, false, 'seed', 'seed'),
  ('site_access', 'No - direct delivery from PT or BG','No — direct delivery from PT or BG', 4, false, 'seed', 'seed'),

  -- `is_default` on "No" is his stated default. It preselects the control and
  -- writes nothing; the answer stays `missing` until a person saves.
  ('assembly_guide', 'No',  'No',  1, true,  'seed', 'seed'),
  ('assembly_guide', 'Yes', 'Yes', 2, false, 'seed', 'seed'),

  ('swivel', 'None',              'None',                 1, false, 'seed', 'seed'),
  ('swivel', '360 non-return',    '360° non-return',      2, false, 'seed', 'seed'),
  ('swivel', '180 return',        '180° return',          3, false, 'seed', 'seed'),

  ('fr_interliner', 'Required',     'Required',     1, false, 'seed', 'seed'),
  ('fr_interliner', 'Not required', 'Not required', 2, false, 'seed', 'seed'),

  ('stitching', 'Plain stitch', 'Plain stitch', 1, false, 'seed', 'seed'),
  ('stitching', 'Channelling',  'Channelling',  2, false, 'seed', 'seed'),
  ('stitching', 'Fluting',      'Fluting',      3, false, 'seed', 'seed'),

  ('yes_no', 'Yes', 'Yes', 1, false, 'seed', 'seed'),
  ('yes_no', 'No',  'No',  2, false, 'seed', 'seed')
on conflict (palette_key, value) do update set
  label      = excluded.label,
  sort_order = excluded.sort_order,
  is_default = excluded.is_default,
  active     = true,
  updated_by = 'seed';

-- A BWS-owned palette that has quietly acquired options is a list somebody
-- invented. Say so at seed time rather than letting it reach a screen.
do $$
declare bad text;
begin
  select string_agg(p.key, ', ') into bad
    from spec_palettes p
   where p.owner = 'bws'
     and exists (select 1 from spec_palette_options o where o.palette_key = p.key);
  if bad is not null then
    raise exception '0008 seed: BWS-owned palette(s) % carry options this app was never given', bad;
  end if;
end $$;
