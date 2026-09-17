-- ==========================================================================
-- 0031_bws_boilerplates.sql -- the BWS product-code register, so a quote line
-- can name the boilerplate it is priced against.
--
-- WHY. Matthew's quote example carries `Product code` and `Product code id`
-- on every line -- `.BW-Sofa,Simple-BOILERPLATE` and `847` -- and this app has
-- never held either, so two of the twelve columns were blank for want of a
-- lookup table. His matrix row 1 gives the rule: "Boilerplate derived
-- automatically: if MF1 or MF2 is populated -> with-Metalwork variant;
-- otherwise Simple."
--
-- Measured before building it: of the 25 distinct product-code ids in his real
-- quote, EIGHTEEN match the captured register exactly. The seven that do not
-- are the companion billing lines -- mattresses, delivery, stone, interliner,
-- one Blue Label product -- which this app cannot generate anyway, because it
-- holds no price and no fabric metreage.
--
-- ---- WHY THIS IS COMMITTABLE AND THE PILOT PACK IS NOT ------------------
--
-- CLAUDE.md: "Real client material -- the BOQ, the BWS job export, the
-- SharePoint cheat sheets -- never enters this repo ... The schema is what
-- gets committed, never a row." These are not client material. They are BEN
-- WHISTLER'S OWN product codes, the same class of thing as `spec_fields`,
-- which has seeded 56 BWS-owned rows since 0002. A boilerplate carries no
-- client, no project and no price: the capture of 2026-09-14 found its entire
-- payload is WHICH FIELDS IT LISTS, and five placeholder values.
--
-- It is still a judgement call rather than an obvious one, and it is written
-- down as such in docs/plans/matrix-assumptions.md for Matthew to confirm.
--
-- ---- WHAT THE REGISTER DOES NOT DO --------------------------------------
--
-- It never FORBIDS a value. docs/plans/boilerplate-grouping.md is emphatic:
-- "use it to EXPLAIN a blank; never to FORBID a value", because the capture
-- found real authoring gaps -- `.BW-Bar-Stools,-with-Metalwork` carries no
-- metal fields at all, and is filed under the wrong category. Nothing here
-- reads a boilerplate's field list; this table is a code and an id.
--
-- `matrix_code` is null on the 27 rows outside Matthew's nine seating
-- categories. His cabinetry matrix does not exist yet, so a cabinetry item
-- gets no derived product code and the column is blank -- the same honest
-- degradation as its gate view.
--
-- ---- AND HERO HAS NO SEATING BOILERPLATE -------------------------------
--
-- Six cabinetry families have a Hero variant. NONE of the nine seating
-- families does: every one is a Simple / with-Metalwork pair. So his rule
-- covers what exists and says nothing about a hero sofa because there is no
-- hero sofa code to say anything about. That is question 6 in the reply to
-- him, and until he answers it a hero seating item takes the metalwork rule
-- like any other.
-- ==========================================================================
begin;

create table bws_boilerplates (
  id          uuid primary key default gen_random_uuid(),
  -- BWS's own numeric id, which is what the quote file's `Product code id`
  -- column carries. Unique, because it addresses a product_codes row.
  bws_id      integer not null unique,
  code        text not null unique,
  -- Which of Matthew's nine seating categories this is the boilerplate for.
  -- Null for the 27 outside them: cabinetry, panelling, recoveries, scatters.
  matrix_code text references spec_matrix_categories(code) on delete restrict,
  variant     text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text,
  constraint bws_boilerplates_variant_check
    check (variant in ('simple', 'metalwork', 'hero', 'other'))
);

-- One boilerplate per (category, variant), or the derivation has no rule for
-- which to pick and a screen would choose silently.
create unique index bws_boilerplates_category_variant
  on bws_boilerplates (matrix_code, variant) where matrix_code is not null and active;

do $$
declare t text;
begin
  foreach t in array array['bws_boilerplates'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

commit;
