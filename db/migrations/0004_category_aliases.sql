-- ==========================================================================
-- 0004_category_aliases.sql — the words a BOQ actually uses for a category.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. The cheat sheet categories are named as lists ("Armchairs, Benches,
-- Stools, Sofas"; "Side / Coffee / Bedside Tables"). A BOQ says "Sofa",
-- "Console", "Footstool", "Bar stools". Matching the first against the second
-- by word overlap fails almost completely: on the pilot BOQ only 5 of 59 lines
-- matched, because "sofa" and "sofas" share no word and a four-word category
-- name dilutes every score.
--
-- The fix is a vocabulary, not a lower confidence cutoff. Dropping the cutoff
-- would turn "no match" into "confidently wrong", and a wrong category means a
-- record measured against the wrong checklist — which looks complete while
-- asking none of the right questions.
--
-- These terms belong to the business and will grow as new BOQs arrive, which
-- is why they are seeded rows rather than a constant in the matcher.
-- ==========================================================================

begin;

create table item_category_aliases (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references item_categories(id) on delete cascade,
  term        text not null,
  term_norm   text not null,
  created_at  timestamptz not null default now(),
  created_by  text,
  constraint item_category_aliases_term_key unique (term_norm)
);

create index item_category_aliases_category_idx on item_category_aliases (category_id);

do $$
declare t text;
begin
  foreach t in array array['item_category_aliases'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
  end loop;
end $$;

commit;
