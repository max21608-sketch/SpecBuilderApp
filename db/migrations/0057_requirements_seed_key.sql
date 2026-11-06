-- ==========================================================================
-- 0057_requirements_seed_key.sql -- a requirement is matched by what it is,
-- not by where it sits, and an answered question cannot be made to ask
-- something else.
--
-- WHAT WENT WRONG (audit B7, 2026-11-06). The three requirement seeds
-- (db/seed/0003, 0007, 0009) upserted on `(category_id, sort_order)`. A
-- position is not an identity. Revise a cheat sheet by adding one question at
-- position 21 and the next `db:seed` writes the new question's prompt over the
-- row that WAS 21, that row's prompt over 22, and so on to the end of the
-- sheet -- every answer on every one of those rows now answers a different
-- question, with nothing said. The composite FK `spec_answers_requirement_
-- field_fk` (0002) makes a moved BWS FIELD fail loudly; a moved PROMPT on a
-- readiness question, or a reworded one, was silent. copy-project already
-- refused to trust the position for the same reason (copy-project-core.ts,
-- "Requirement identity").
--
-- ---- 1. A STABLE KEY ------------------------------------------------------
--
-- `requirements.seed_key`, unique within a category, derived ONCE here for the
-- rows the seeds wrote, and written literally into the three seed files in
-- the same change so the next seed matches on it:
--
--   field:<json_id>    a question that fills a BWS field. One per field per
--                      category already (`requirements_category_field_idx`),
--                      so the field IS the question's identity. Rewording its
--                      prompt updates the row in place -- and is refused by
--                      (3) once anybody has answered it.
--   key:<local_key>    a readiness question tied to Matthew's matrix (0009).
--   q:<slug of prompt> every other readiness question. Its words are all it
--                      has, so rewording one is a NEW question: the seed adds
--                      it, and the old one stays, with its answers, until a
--                      person retires it. That is the seeds' standing rule --
--                      "It never deletes" (0003's header) -- applied to a
--                      reword, which used to be an overwrite.
--
-- The slug is lower case, every run of anything that is not a-z or 0-9 a
-- single hyphen, no hyphen at either end. Measured on the local stack the day
-- this was written: 797 seeded rows, 797 distinct keys per category.
--
-- Rows nobody seeded (a test's own category, created_by 'qa') get no key and
-- are untouched by any seed; NULLs never collide in the unique constraint.
--
-- ---- 2. THE POSITION IS NO LONGER A KEY, BUT STILL UNIQUE ------------------
--
-- A revised sheet moves rows down, so the seed now writes `sort_order` on
-- conflict. Within one INSERT the rows are written one by one, and with a
-- plain unique constraint the first row moved to an occupied position fails
-- before the row holding it has moved away. The constraint is re-made
-- DEFERRABLE (initially immediate): Postgres then checks it at the END of the
-- statement, when every row has its new place. It is still checked; it is no
-- longer checked half way. (A deferrable constraint cannot be an ON CONFLICT
-- arbiter, which is fine: nothing uses it as one any more.)
--
-- ---- 3. AN ANSWERED QUESTION KEEPS ITS MEANING ------------------------------
--
-- A trigger refuses to change `kind`, `spec_field_id`, `local_key` or
-- `prompt` on a requirement that has any answer other than `missing`, or that
-- any chase has asked (`email_draft_items`), and says how many. Those four are
-- what the question IS; section, help text, order and the TGQ levels are how
-- it is shown and are free to change. The way out is the seed's own: add the
-- new wording as a new question and retire the old one with its answers
-- dealt with. A re-seed that would do it fails whole, naming the question,
-- which is the point: it used to succeed silently.
--
-- LOCKS. The column add is instant; the backfill rewrites the 797 seeded rows
-- once; the two constraints build unique indexes on requirements (under a
-- thousand rows). Writes to requirements -- only seeds make them -- wait for
-- a moment.
-- ==========================================================================

begin;

alter table requirements add column seed_key text;

update requirements r
   set seed_key = case
         when r.spec_field_id is not null then 'field:' || (select f.json_id from spec_fields f where f.id = r.spec_field_id)
         when r.local_key is not null then 'key:' || r.local_key
         else 'q:' || trim(both '-' from regexp_replace(lower(r.prompt), '[^a-z0-9]+', '-', 'g'))
       end
 where r.created_by = 'seed';

do $$
declare n integer;
begin
  select count(*) into n from requirements where created_by = 'seed' and (seed_key is null or seed_key in ('q:', 'field:', 'key:'));
  if n > 0 then
    raise exception '0057: % seeded requirement(s) got no usable key', n;
  end if;
end $$;

-- Fails here, naming the pair, if two seeded questions of one category derive
-- one key -- better than a seed that cannot tell them apart.
alter table requirements
  add constraint requirements_category_seed_key unique (category_id, seed_key);

alter table requirements drop constraint requirements_category_sort_key;
alter table requirements
  add constraint requirements_category_sort_key unique (category_id, sort_order)
  deferrable initially immediate;

create or replace function refuse_answered_requirement_change() returns trigger as $$
declare
  answers integer;
  asked integer;
begin
  if new.kind is not distinct from old.kind
     and new.spec_field_id is not distinct from old.spec_field_id
     and new.local_key is not distinct from old.local_key
     and new.prompt is not distinct from old.prompt then
    return new;
  end if;
  select count(*) into answers from spec_answers where requirement_id = old.id and state <> 'missing';
  select count(*) into asked from email_draft_items where requirement_id = old.id;
  if answers > 0 or asked > 0 then
    raise exception 'The question "%" has % answer(s) and has been asked in % chase line(s), so it cannot be changed to ask something else. Add the new wording as a new question and retire this one.',
      old.prompt, answers, asked
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger requirements_keep_answered_meaning
  before update of kind, spec_field_id, local_key, prompt on requirements
  for each row execute function refuse_answered_requirement_change();

commit;
