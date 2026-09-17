-- ==========================================================================
-- 0027_gate_tables_need_an_id.sql -- write_audit() addresses a row by `id`,
-- so every audited table must have one whatever its primary key is.
--
-- WHY. 0026 gave `spec_matrix_categories` a natural primary key (`code`) and
-- `spec_matrix_category_map` a composite one, and attached the standard audit
-- trigger to both. The first insert failed:
--
--   42703: record "new" has no field "id"
--   ... PL/pgSQL function write_audit() line 20
--
-- `write_audit()` (0001) writes `new.id::text` into `audit_log.row_id`. It is
-- not a generic row-identity function and never was -- every table in the
-- schema before this one happened to have a uuid `id`, so the requirement was
-- invisible until a table chose a natural key instead.
--
-- Two ways out, and the choice matters for the next person who adds a
-- register table:
--
--   * Teach write_audit() to fall back to the primary key. Rejected. It is
--     attached to eighteen tables and is the enforcement behind an
--     append-only audit trail; rewriting it to serve one new table's
--     convenience risks every other table's history, and `row_id` would stop
--     meaning one thing.
--
--   * Give the new tables an `id`. Taken. It is what the rest of the schema
--     does, and it makes the rule "an audited table has a uuid id" true
--     without exception rather than true by coincidence.
--
-- The primary keys are deliberately NOT moved onto `id`. `code` genuinely is
-- the identity of one of Matthew's categories and the map's composite key
-- genuinely is the identity of a mapping; swapping them would mean dropping
-- and recreating the map's foreign key to buy nothing but a uniform look.
-- `id` is here for the audit trail and is unique so it can be relied on.
--
-- 0026 is NOT edited. It was applied to the sandbox, which local development
-- and staging share, and house/conventions.md is explicit: never edit a
-- migration after it has been applied anywhere, not even a comment, because
-- the runner keys on filename and an edited file is not re-applied.
-- ==========================================================================
begin;

alter table spec_matrix_categories
  add column if not exists id uuid not null default gen_random_uuid();
alter table spec_matrix_category_map
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists spec_matrix_categories_id_key
  on spec_matrix_categories (id);
create unique index if not exists spec_matrix_category_map_id_key
  on spec_matrix_category_map (id);

commit;
