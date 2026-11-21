-- ==========================================================================
-- 0015_question_audience.sql -- who each seeded question is FOR, how a client
-- reads it, and which ones are answered once per area.
--
-- Claude's judgment at Max's instruction, 2026-11-20
-- (docs/plans/chase-decisions-2026-11-20.md D, E, C). Matthew can overrule
-- any line; his answer is a change to the lists below and a re-seed.
--
-- AUDIENCE (0062): every seeded question is the CLIENT's, except:
--   * D's table for the project-wide section -- what the CAM answers, and
--     what is ours (in-house);
--   * E's list of questions worded for BW, which are in-house and never sent.
--     "Project sold with metal finish or metal paint effect?" (field:5) is
--     NOT on it, deliberately: it is the only question for BWS field 5 on all
--     seventeen sheets, and TG0 rows 21 and 109 require that field, so marking
--     it in-house would take metal finish out of every chase. It stays the
--     client's and gets a client wording instead (the orchestrator's decision
--     on the design, finding 10).
--   0062 set the column from `kind` (readiness in-house) so that nothing read
--   differently between the migration and this seed. From here a readiness
--   question nobody listed -- "Fabric with pattern? Direction?", "Storm
--   covers needed?", the cabinetry controllers -- is the client's.
--
-- CLIENT WORDING: "COM 1" is the prompt on fifteen sheets and is itself the
-- BWS name; "Main timber finish" is ours. A designer reads these instead. The
-- prompt is never reworded: that would stale every unsent chase draft, and
-- 0057's trigger refuses it on an answered question.
--
-- ANSWER SCOPE: four questions are answered once for an area ("Restaurant"),
-- with an item allowed to be the exception (decision C). The three answered
-- once per PROJECT move by their section, in 0003, not here.
--
-- Matched on `seed_key`, across every category, and never on the four columns
-- 0057 guards. One UPDATE per column, writing only a row whose value differs,
-- so a re-seed writes nothing and the audit log stays quiet. A listed key
-- that matches no row FAILS the seed by name: a typo here would otherwise be
-- a question silently left with the wrong audience.
-- ==========================================================================

drop table if exists seed_0015_audience;
create temp table seed_0015_audience (seed_key text primary key, audience text not null, why text not null);
insert into seed_0015_audience (seed_key, audience, why) values
  -- D: the project-wide section.
  ('q:toe-agreement',                                         'cam',      'D'),
  ('q:expedited-project-confirmed-by-jason',                  'in_house', 'D'),
  ('q:sales-folder-folder-selection',                         'in_house', 'D'),
  ('q:client-sign-off-visit-required-bg-or-pt-what-type',     'cam',      'D'),
  ('q:client-contact-list',                                   'cam',      'D'),
  ('q:prototype-required-raw-or-with-finish',                 'client',   'D'),
  ('q:project-client-context',                                'cam',      'D'),
  ('q:floor-plans',                                           'client',   'D'),
  ('field:7',                                                 'in_house', 'D: Have you allowed for Access Check and Site Survey?'),
  ('field:6',                                                 'client',   'D: Is access ok?'),
  ('q:delivery-direct-to-the-client-from-pt-or-bg',           'in_house', 'D'),
  ('q:counter-samples-from-client-required',                  'client',   'D'),
  ('q:special-finish-required',                               'client',   'D'),
  ('q:fsc-required',                                          'client',   'D'),
  ('q:can-design-and-projects-proced-without-deposit-confirmed', 'in_house', 'D'),
  ('q:bws-project-page-folder-set-up',                        'in_house', 'D'),
  ('q:com-payment-plan',                                      'cam',      'D'),
  ('field:191',                                               'in_house', 'D: Assembly guide required'),
  ('field:24',                                                'in_house', 'D: Purchasing notes'),
  -- E: worded for BW.
  ('q:needs-split-where',                                     'in_house', 'E'),
  ('q:bw-standard-felt-or-com-bom',                           'in_house', 'E'),
  ('q:has-the-client-provided-details-heights-sh-etc-of-the-chairs', 'in_house', 'E'),
  ('q:has-the-client-provided-details-heights-top-thickness-base-design-of-the-tables', 'in_house', 'E'),
  ('q:the-client-is-expecting-exact-copy-from-their-drawing-or-there-is-possibility-of-sugestion-bw-standards-sabos-metal-bars-curved-back-leg-thickness-etc', 'in_house', 'E'),
  ('q:has-client-been-advised-of-bw-standards',               'in_house', 'E'),
  ('q:make-client-aware-of-bw-standard-lid-stays',            'in_house', 'E'),
  ('q:is-it-sitting-alongside-sofa-s-tables-bw-need-to-be-aware-of', 'in_house', 'E'),
  ('q:fabric-quantities',                                     'in_house', 'E'),
  ('q:image-drawing-repeat-reference',                        'in_house', 'E');

drop table if exists seed_0015_client_prompt;
create temp table seed_0015_client_prompt (seed_key text primary key, client_prompt text not null);
insert into seed_0015_client_prompt (seed_key, client_prompt) values
  ('field:1',  'Fabric 1'),
  ('field:2',  'Fabric 2'),
  ('field:14', 'Fabric 3'),
  ('field:4',  'Timber finish 1'),
  ('field:5',  'Metal finish 1, and where on the item');

drop table if exists seed_0015_area;
create temp table seed_0015_area (seed_key text primary key);
insert into seed_0015_area (seed_key) values
  ('field:130'),                                  -- Indoor / Outdoor / Humid environment
  ('field:39'),                                   -- Floor type
  ('field:73'),                                   -- Wall build
  ('q:is-fully-outdoor-or-partially-protected');

do $$
declare missing text;
begin
  select string_agg(k.seed_key, ', ' order by k.seed_key) into missing
    from (select seed_key from seed_0015_audience
          union select seed_key from seed_0015_client_prompt
          union select seed_key from seed_0015_area) k
   where not exists (select 1 from requirements r where r.created_by = 'seed' and r.seed_key = k.seed_key);
  if missing is not null then
    raise exception '0015 seed: listed key(s) % match no seeded question', missing;
  end if;
end $$;

update requirements r
   set audience = coalesce(a.audience, 'client'), updated_by = 'seed'
  from requirements x
  left join seed_0015_audience a on a.seed_key = x.seed_key
 where x.id = r.id and r.created_by = 'seed'
   and r.audience is distinct from coalesce(a.audience, 'client');

update requirements r
   set client_prompt = p.client_prompt, updated_by = 'seed'
  from requirements x
  left join seed_0015_client_prompt p on p.seed_key = x.seed_key
 where x.id = r.id and r.created_by = 'seed'
   and r.client_prompt is distinct from p.client_prompt;

update requirements r
   set answer_scope = case when s.seed_key is null then 'item' else 'area' end, updated_by = 'seed'
  from requirements x
  left join seed_0015_area s on s.seed_key = x.seed_key
 where x.id = r.id and r.created_by = 'seed'
   and r.answer_scope is distinct from case when s.seed_key is null then 'item' else 'area' end;

drop table seed_0015_audience;
drop table seed_0015_client_prompt;
drop table seed_0015_area;
