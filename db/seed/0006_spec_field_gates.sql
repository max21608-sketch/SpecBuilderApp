-- ==========================================================================
-- 0006_spec_field_gates.sql
--
-- Matthew's BWS Spec Decision Matrix, 2026-09-17, transcribed row for row.
-- 35 rows, his `#` kept as `matrix_row` so a re-issued workbook diffs against
-- this rather than being re-read by eye.
--
-- Nothing here is interpreted except two things, both of which are mechanical:
--
--   * "All categories" and "All UPY seating" both expand to his nine, because
--     the workbook is seating-only. `applies_to_raw` keeps which phrase he
--     used, so when the cabinetry matrix arrives "All categories" widens and
--     "All UPY seating" does not. See 0026's header.
--
--   * His four dimension rows (4-7) carry one BWS id and four slots. They are
--     seeded as four rows with `dimension_slot` set, because SH applies to six
--     of his nine and W/D/H to all nine.
--
-- FIVE PALETTES ARE BWS-OWNED AND THIS APP HOLDS NONE OF THEM: timber finish,
-- metal finish, seat build, back cushion, stud. `palette_key` names them and
-- `palette_raw` keeps his wording, so the gap is recorded rather than
-- forgotten. They are NOT invented -- FMT-GEN-01, a BWS-owned vocabulary this
-- app does not know is left blank.
--
-- Six palettes he states outright are ours to seed (environment, site_access,
-- assembly_guide, swivel, fr_interliner, stitching, yes_no).
--
-- Re-seeding is safe: keyed on `matrix_row`, updates in place, deletes
-- nothing.
-- ==========================================================================

insert into spec_field_gates (
  matrix_row, gate, capture, field_name, spec_field_id, local_key, dimension_slot,
  applies_to, applies_to_raw, value_type, palette_key, palette_raw,
  conditional_on_key, conditional_on_value, notes, created_by, updated_by
)
select v.matrix_row, v.gate, v.capture, v.field_name, f.id, v.local_key, v.dimension_slot,
       v.applies_to, v.applies_to_raw, v.value_type, v.palette_key, v.palette_raw,
       v.conditional_on_key, v.conditional_on_value, v.notes, 'seed', 'seed'
from (values
  -- ---- TGQ, pre-filled by the document scan ------------------------------
  (1::integer, 'TGQ'::text, 'auto'::text, 'Product code'::text, null::integer, 'product_code'::text, null::text,
   array['S','A','DC','BS','B','D','O','BH','BQ']::text[], 'All categories'::text, 'palette'::text,
   'boilerplate'::text, $q$Selected from boilerplate list (BW-Sofa,Simple / BW-Sofa,w-Metalwork / etc.)$q$::text,
   null::text, null::text,
   $q$Boilerplate derived automatically: if MF1 or MF2 is populated -> with-Metalwork variant; otherwise Simple$q$::text),

  (2, 'TGQ', 'auto', 'Item name / description', null, 'item_name', null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'free_text', null, null, null, null,
   $q$Product name as stated in client doc (e.g. 'Lounge Chair, Type A')$q$),

  (3, 'TGQ', 'auto', 'Spec notes', null, 'spec_notes', null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'free_text', null, null, null, null,
   $q$Any item-specific notes not captured by structured fields. App-internal; no direct BWS mapping. Source column says "User (post-scan review)", not the scan.$q$),

  (4, 'TGQ', 'auto', 'Width - W', 3, null, 'W',
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'number', null, null, null, null,
   $q$Extracted from dimensions in client doc. Concatenated to BWS ID 3 as W x D x H [, SH]$q$),

  (5, 'TGQ', 'auto', 'Depth - D', 3, null, 'D',
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'number', null, null, null, null,
   'As above'),

  (6, 'TGQ', 'auto', 'Height - H', 3, null, 'H',
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'number', null, null, null, null,
   'Overall height. For daybeds = platform height.'),

  (7, 'TGQ', 'auto', 'Seat height - SH', 3, null, 'SH',
   array['S','A','DC','BS','B','BQ'], 'S, A, DC, BS, B, BQ', 'number', null, null, null, null,
   $q$Required for all UPY seating. Not applicable: Daybeds, Ottomans, Beds. Standard bar ~750mm, counter ~650mm.$q$),

  (8, 'TGQ', 'auto', 'Designer reference', null, 'designer_reference', null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'free_text', null, null, null, null,
   $q$Designer/brand reference code from client spec (e.g. 'Minotti code XYZ')$q$),

  -- ---- TGQ, answered by a person ----------------------------------------
  (9, 'TGQ', 'question', 'Indoor / Outdoor', 130, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'palette',
   'environment', 'Indoor | Outdoor | Humid indoor (spa/pool)', null, null,
   'Sets FR requirements and finish constraints downstream'),

  (10, 'TGQ', 'question', 'Site access check', 6, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'palette',
   'site_access',
   $q$Yes - survey required | Yes - already confirmed clear | No - standard access | No - direct delivery from PT or BG$q$,
   null, null, null),

  (11, 'TGQ', 'question', $q$Assembly guide req'd$q$, 191, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'palette',
   'assembly_guide', 'No (default) | Yes', null, null,
   'Default No. Only changes for flat-pack or multi-module items.'),

  (12, 'TGQ', 'question', 'Swivel mechanism', 232, null, null,
   array['A','BS'], 'A, BS', 'palette',
   'swivel', $q$None | 360 non-return | 180 return$q$, null, null,
   'Armchairs & Occasional Chairs + Bar Stools only'),

  (13, 'TGQ', 'question', 'Headboard fitted', null, 'headboard_fitted', null,
   array['BH'], 'BH', 'boolean', 'yes_no', 'Yes | No', null, null,
   'If Yes -> socket spec and lighting spec fields appear at TG0'),

  (14, 'TGQ', 'question', 'Fitted banquette', null, 'fitted_banquette', null,
   array['BQ'], 'BQ', 'boolean', 'yes_no', 'Yes | No', null, null,
   'If Yes -> infill panel spec and integrated hardware fields appear at TG0'),

  -- ---- TG0, the design-intent lock --------------------------------------
  (15, 'TG0', 'input', 'COM 1 + location', 1, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'free_text', null, null, null, null,
   $q$Fabric/COM code + location description. Piping captured here as a qualifier (e.g. 'Main body & self pipe').$q$),

  (16, 'TG0', 'input', 'COM 2 + location', 2, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'free_text', null, null, null, null,
   'If contrast fabric / secondary COM required'),

  (17, 'TG0', 'input', 'COM 3 + location', 14, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'free_text', null, null, null, null,
   'If third COM required'),

  (18, 'TG0', 'input', 'Timber finish 1 + location', 4, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_timber_finish', 'From BWS timber finish palette', null, null,
   'Main frame timber. Palette value + location description'),

  (19, 'TG0', 'input', 'Timber finish 2 + location', 31, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_timber_finish', 'From BWS timber finish palette', null, null,
   'If required (e.g. contrast inner frame)'),

  (20, 'TG0', 'input', 'Timber finish 3 + location', 143, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_timber_finish', 'From BWS timber finish palette', null, null,
   'If required'),

  (21, 'TG0', 'input', 'Metal finish 1 + location', 5, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_metal_finish', 'From BWS metal finish palette', null, null,
   'Main metalwork. Presence of MF1 or MF2 triggers with-Metalwork boilerplate.'),

  (22, 'TG0', 'input', 'Metal finish 2 + location', 35, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_metal_finish', 'From BWS metal finish palette', null, null,
   'If second metal finish required'),

  (23, 'TG0', 'input', 'Seat cushion type', 11, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette',
   'bws_seat_build', 'From BWS seat build palette', null, null,
   'Used for design drawings and build spec'),

  (24, 'TG0', 'input', 'Back cushion type', 25, null, null,
   array['S','A','DC','BS','B','D','BH','BQ'], 'S, A, DC, BS, B, D, BH, BQ', 'palette',
   'bws_back_cushion', 'From BWS back cushion palette', null, null,
   'Not applicable: Ottomans (no back)'),

  (25, 'TG0', 'input', 'FR Interliner', 74, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette',
   'fr_interliner', 'Required | Not required', null, null,
   'Fire retardant interliner requirement'),

  (26, 'TG0', 'input', 'Stud spec + location', 16, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette_free_text',
   'bws_stud', 'From BWS stud palette', null, null,
   'Only if studs are specified on the design'),

  (27, 'TG0', 'input', 'Stitching spec', 37, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All UPY seating', 'palette',
   'stitching', 'Plain stitch | Channelling | Fluting', null, null, null),

  (28, 'TG0', 'input', 'Socket spec + positions', null, 'socket_spec', null,
   array['BH'], 'BH', 'free_text', null, null, 'headboard_fitted', 'Yes',
   'Electrical socket specification and layout positions in the headboard'),

  (29, 'TG0', 'input', 'Lighting spec + positions', null, 'lighting_spec', null,
   array['BH'], 'BH', 'free_text', null, null, 'headboard_fitted', 'Yes',
   'Lighting specification and positions integrated into the headboard'),

  (30, 'TG0', 'input', 'Infill panel spec', null, 'infill_panel_spec', null,
   array['BQ'], 'BQ', 'free_text', null, null, 'fitted_banquette', 'Yes',
   'Specification for infill panels (e.g. material, colour, fixing method)'),

  (31, 'TG0', 'input', 'Integrated hardware', null, 'integrated_hardware', null,
   array['BQ'], 'BQ', 'free_text', null, null, 'fitted_banquette', 'Yes',
   'Hardware to coordinate with other trades (AirCon grilles, speaker grilles, etc.)'),

  -- ---- TG1, the production lock -----------------------------------------
  (32, 'TG1', 'confirm', 'Dimensions confirmed', 3, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'number', null, null, null, null,
   $q$W x D x H [, SH] confirmed against approved drawings. Overwrites TGQ auto-extract if changed. No slot: this is the whole cell re-checked, not one figure.$q$),

  (33, 'TG1', 'confirm', 'Assembly guide required', 191, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'palette',
   'assembly_guide', 'No (default) | Yes', null, null,
   'Final confirmation; typically unchanged from TGQ answer.'),

  (34, 'TG1', 'input', 'Site info', 7, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'free_text', null, null, null, null,
   'Site installation details (floor, access route, delivery method, fixings required, etc.)'),

  (35, 'TG1', 'input', 'Purchasing notes', 24, null, null,
   array['S','A','DC','BS','B','D','O','BH','BQ'], 'All categories', 'free_text', null, null, null, null,
   'Any procurement or buying notes (lead times, supplier contacts, order refs)')
) as v(matrix_row, gate, capture, field_name, json_id, local_key, dimension_slot,
       applies_to, applies_to_raw, value_type, palette_key, palette_raw,
       conditional_on_key, conditional_on_value, notes)
left join spec_fields f on f.json_id = v.json_id
on conflict (matrix_row) do update set
  gate                 = excluded.gate,
  capture              = excluded.capture,
  field_name           = excluded.field_name,
  spec_field_id        = excluded.spec_field_id,
  local_key            = excluded.local_key,
  dimension_slot       = excluded.dimension_slot,
  applies_to           = excluded.applies_to,
  applies_to_raw       = excluded.applies_to_raw,
  value_type           = excluded.value_type,
  palette_key          = excluded.palette_key,
  palette_raw          = excluded.palette_raw,
  conditional_on_key   = excluded.conditional_on_key,
  conditional_on_value = excluded.conditional_on_value,
  notes                = excluded.notes,
  updated_by           = 'seed';

-- A row naming a BWS id that is not in the register would silently become an
-- app-local row and fail the field_or_local check, which is a confusing error
-- for a transcription typo. Say what actually happened.
do $$
declare bad integer;
begin
  select count(*) into bad from spec_field_gates where spec_field_id is null and local_key is null;
  if bad > 0 then
    raise exception '0006 seed: % gate row(s) name a BWS id that spec_fields does not hold', bad;
  end if;
end $$;
