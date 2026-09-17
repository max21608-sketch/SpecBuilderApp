-- ==========================================================================
-- 0009_requirements_local_keys.sql
--
-- The six questions on Matthew's matrix that have no BWS column, given
-- somewhere to be answered.
--
-- Two are CONTROLLERS -- "Headboard fitted", "Fitted banquette" -- and four
-- are what they reveal at TG0: socket spec, lighting spec, infill panel spec,
-- integrated hardware. Until now `gateStatus` reported all six `unanswerable`,
-- which was true and useless: a fitted headboard could never satisfy TG0
-- because there was nowhere to say whether it was fitted.
--
-- `requirements.kind = 'readiness'` has meant "must be known, BWS has no
-- column for it" since 0002, so this is the existing shape and not a new one.
-- `local_key` (0030) is what ties each to its row in spec_field_gates.
--
-- CATEGORIES COME FROM THE MAPPING, NOT FROM A GUESS. His BH maps to two of
-- our cheat sheets (`beds-bedbases` and `headboards-wall-fixed`) and his BQ to
-- one (`banquettes`) -- see db/seed/0005. Nine rows.
--
-- sort_order is 900 + his matrix row, the same band 0007 uses and disjoint
-- from it, so both files can be re-seeded independently.
-- ==========================================================================

insert into requirements (category_id, kind, spec_field_id, local_key, prompt, help_text, section, sort_order, tgq_levels, created_by, updated_by)
select c.id, 'readiness', null, v.local_key, v.prompt, v.help_text, v.section, v.sort_order,
       '{simple,complex,hero}', 'seed', 'seed'
from (values
  ('beds-bedbases',        'headboard_fitted',    'Headboard fitted?',
   'Yes reveals the socket and lighting specs at TG0. From Matthew''s decision matrix, 2026-09-17, row 13.',
   'Build details', 913),
  ('headboards-wall-fixed','headboard_fitted',    'Headboard fitted?',
   'Yes reveals the socket and lighting specs at TG0. From Matthew''s decision matrix, 2026-09-17, row 13.',
   'Build details', 913),
  ('beds-bedbases',        'socket_spec',         'Socket spec and positions',
   'Electrical socket specification and layout positions in the headboard. Only applies when the headboard is fitted. Matrix row 28.',
   'Build details', 928),
  ('headboards-wall-fixed','socket_spec',         'Socket spec and positions',
   'Electrical socket specification and layout positions in the headboard. Only applies when the headboard is fitted. Matrix row 28.',
   'Build details', 928),
  ('beds-bedbases',        'lighting_spec',       'Lighting spec and positions',
   'Lighting specification and positions integrated into the headboard. Only applies when the headboard is fitted. Matrix row 29.',
   'Build details', 929),
  ('headboards-wall-fixed','lighting_spec',       'Lighting spec and positions',
   'Lighting specification and positions integrated into the headboard. Only applies when the headboard is fitted. Matrix row 29.',
   'Build details', 929),
  ('banquettes',           'fitted_banquette',    'Fitted banquette?',
   'Yes reveals the infill panel spec and integrated hardware at TG0. From Matthew''s decision matrix, row 14.',
   'Build details', 914),
  ('banquettes',           'infill_panel_spec',   'Infill panel spec',
   'Material, colour and fixing method for the infill panels. Only applies to a fitted banquette. Matrix row 30.',
   'Build details', 930),
  ('banquettes',           'integrated_hardware', 'Integrated hardware',
   'Hardware to coordinate with other trades — air-conditioning grilles, speaker grilles. Only applies to a fitted banquette. Matrix row 31.',
   'Build details', 931)
) as v(slug, local_key, prompt, help_text, section, sort_order)
join item_categories c on c.slug = v.slug
on conflict (category_id, sort_order) do update set
  kind       = excluded.kind,
  local_key  = excluded.local_key,
  prompt     = excluded.prompt,
  help_text  = excluded.help_text,
  section    = excluded.section,
  tgq_levels = excluded.tgq_levels,
  updated_by = 'seed';

-- A local key the gate overlay does not know is a question nothing will ever
-- read. Fail here rather than let it sit in the checklist forever.
do $$
declare orphan text;
begin
  select string_agg(distinct r.local_key, ', ') into orphan
    from requirements r
   where r.local_key is not null
     and not exists (select 1 from spec_field_gates g where g.local_key = r.local_key);
  if orphan is not null then
    raise exception '0009 seed: local key(s) % are on no row of the gate matrix', orphan;
  end if;
end $$;
