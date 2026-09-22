-- ==========================================================================
-- 0008_spec_palettes.sql
--
-- The eleven palettes Matthew's decision matrix names. SIX are his own words
-- and are seeded here in full. FIVE are BWS-owned; this file declares the ROW
-- and db/seed/0011 carries their options, which were captured from BWS on
-- 2026-09-22.
--
-- The five were seeded EMPTY here for four months, and the reason is worth
-- keeping: a palette row with no options and a null `synced_at` says, in the
-- schema, "there is a controlled list here, BWS owns it, and we have never had
-- it" -- which is a question somebody can answer. Five plausible finish lists
-- invented from nowhere is the confidently-wrong failure FMT-GEN-01 exists to
-- prevent, and nothing downstream would ever question one. The guard at the
-- foot of this file is what is left of that rule, and it still holds: options
-- on a BWS palette need a sync behind them.
--
-- The SIX are not off the hook. Every one of them turned out to have a real
-- BWS palette behind it whose wording differs -- `stitching` shares only
-- "Plain Stitch" with BWS, which offers Top Stitch and Saddle Stitch where
-- this file has Channelling and Fluting. They stay as Matthew wrote them
-- until he says otherwise, because he wrote the matrix. See the capture note
-- and docs/plans/matrix-assumptions.md.
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
   'Matthew names it on rows 18, 19 and 20 ("From BWS timber finish palette"). Captured from BWS 2026-09-22: Timber Finish 1 (id 4), 2 (31) and 3 (143) print the SAME 35 options, byte for byte, so one palette serves all three.', 'seed', 'seed'),
  ('bws_metal_finish', 'BWS metal finish palette','bws', true,
   'Rows 21 and 22. Captured from BWS 2026-09-22: Metal Finish 1 (id 5) and 2 (35) print the same 15 options, byte for byte.', 'seed', 'seed'),
  ('bws_seat_build',   'BWS seat build palette','bws', true,
   'Row 23. Captured from BWS 2026-09-22, field 11 Seat Upholstery Build. NOTE: BWS also has a separate field 18 "Seat Cushion build" (4" / 4.5" / 5" / 6") which is the true parallel of row 24''s field 25, and this row may be pointing at the wrong one. One for Matthew -- see docs/plans/matrix-assumptions.md.', 'seed', 'seed'),
  ('bws_back_cushion', 'BWS back cushion palette','bws', true,
   'Row 24. Captured from BWS 2026-09-22, field 25 Back Cushion Build.', 'seed', 'seed'),
  ('bws_stud',         'BWS stud palette','bws', true,
   'Row 26. Captured from BWS 2026-09-22, field 16 Stud spec. Eight of the thirteen carry a BWE code inside the label; it is parsed into spec_palette_options.code as well (0035).', 'seed', 'seed')
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

-- A BWS-owned palette that carries options MUST have a sync behind it.
--
-- This guard used to refuse options on a BWS palette outright, because the app
-- had never been given one and anything there was invented. The lists were
-- captured on 2026-09-22 (db/seed/0011), so the rule is now the weaker and
-- more durable half of the same thing: options are allowed, a claim that they
-- came from BWS is not optional. An invented list still has no `synced_at` to
-- point at and still fails here, at seed time, rather than on a screen.
do $$
declare bad text;
begin
  select string_agg(p.key, ', ') into bad
    from spec_palettes p
   where p.owner = 'bws'
     and p.synced_at is null
     and exists (select 1 from spec_palette_options o where o.palette_key = p.key);
  if bad is not null then
    raise exception '0008 seed: BWS-owned palette(s) % carry options with no sync behind them', bad;
  end if;
end $$;
