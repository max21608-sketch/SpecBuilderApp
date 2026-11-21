-- ==========================================================================
-- 0016_requirement_aliases.sql -- the drawing labels that answer a question
-- (decision G of 2026-11-20, Claude's judgment at Max's instruction).
--
-- `requirement_aliases` is read by `spec-document.ts` (emails and
-- register-backed documents) through `matchName`, which scores the overlap
-- over the SMALLER word set. Every word of an alias therefore attracts any
-- one-word label containing it, so the forms below were chosen by running the
-- local corpus (`vocab:gap`, 613 labels) through the resolver with and without
-- each candidate, and keeping only those that moved nothing but what they
-- were meant to (design finding 14):
--
--   SWIVEL           -> Swivel mechanism (field 232)   "Swivel"
--                    One word, kept: a label naming a swivel is about the
--                    swivel, and no corpus label changed but "Swivel base".
--                    "SWIVEL" alone already landed, by the prompt and the BWS
--                    name agreeing; the alias makes it an exact match.
--   STUDS / NAILING  -> Stud spec (16)                  "Studs / nailing"
--                    "STUDS/NAILING" with NO spaces is a known MISS:
--                    `normaliseName` does not split "/", so it is one word and
--                    reaches nothing. A miss is a row a person places; it is
--                    left alone rather than widened into a wrong landing.
--
-- REMOVED (review of the chase build, 2026-11-21):
--   SEAT (build) -> Seat upholstery build (11), "Seat build". The score is the
--     overlap over the SMALLER word set, so it scored 1.0 on "Seat & back
--     build" and landed a label naming TWO builds on the seat's alone. It
--     added nothing else: "SEAT BUILD" and "SEAT - BUILD" already land on
--     field 11 through the prompt "Seat upholstery build". The delete below
--     takes it off a database that ran the first version of this file; it
--     touches only that seeded row.
--
-- NOT SEEDED, and why, so the next person does not "complete" the table:
--   BACK CUSHIONS -> Back cushion build (25): any alias holding "cushions"
--     lands the corpus's own "cushions (seat, back, bolster)" -- a fabric
--     callout -- and a bare "cushions" (value "double stitching") on the back
--     cushion question. Confidently wrong; left unplaced.
--   STITCHING -> Stitching spec (37): already lands, by the prompt and the
--     BWS name agreeing. A one-word alias would attract "Cushion (Double
--     stitching)", which a tie happens to hold off today.
--   FIRE / FR and GLIDES / FEET answer nothing and are kept as notes. A fire
--     standard is the reason somebody decides an interliner, not the answer.
--     NOTE: "FR" ALREADY lands on "Interliner required?" through the BWS
--     field's own name; a seed cannot stop that (it is the matcher), and it is
--     reported rather than fixed here.
--
-- Shop drawings do not read this table (`drawing-document.ts`); that is a
-- separate read-time step not in this build (finding 13).
--
-- On every sheet that asks the question, by `seed_key`. Deletes only the one
-- retired seeded alias named above.
-- ==========================================================================
insert into requirement_aliases (requirement_id, term, term_norm, created_by)
select q.id, v.term, lower(regexp_replace(btrim(v.term), '\s+', ' ', 'g')), 'seed'
  from (values
    ('field:232', 'Swivel'),
    ('field:16', 'Studs / nailing')
  ) as v(seed_key, term)
  join requirements q on q.seed_key = v.seed_key and q.created_by = 'seed'
on conflict (requirement_id, term_norm) do nothing;

delete from requirement_aliases a
 using requirements q
 where q.id = a.requirement_id and q.seed_key = 'field:11' and q.created_by = 'seed'
   and a.term_norm = 'seat build' and a.created_by = 'seed';

do $$
declare missing text;
begin
  select string_agg(v.seed_key, ', ') into missing
    from (values ('field:232'), ('field:16')) as v(seed_key)
   where not exists (select 1 from requirements q where q.seed_key = v.seed_key and q.created_by = 'seed');
  if missing is not null then
    raise exception '0016 seed: listed key(s) % match no seeded question', missing;
  end if;
end $$;
