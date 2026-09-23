-- ==========================================================================
-- 0039_variant_ordinal.sql
--
-- WHY.
--
-- S-301 is bill line 12 on the Miami Beach bill (P18181). Its five
-- configurations, TYPE 1 to TYPE 5, read 34, 36, 37, 38 and 35 on every
-- screen and in every file, because a configuration is given the next free
-- `record_no` in the PROJECT (0024) — which says nothing about the line it
-- belongs to, and nothing about which of the five it is. Max, 2026-09-23:
-- they must read 12.1 to 12.5.
--
-- So a configuration gets a number UNDER its bill line, and `record_no` stays
-- what it has always been: the project-wide surrogate every link, every chase
-- coverage row and every snapshot already points at. Renumbering `record_no`
-- itself would have been the obvious change and it is wrong: it is unique per
-- project (`spec_records_project_no_key`), a retired record keeps its number,
-- and "P18181-034" is already written into emails that went out.
--
-- ---- NEVER REUSED ---------------------------------------------------------
--
-- A retired 12.2 keeps 2 and the next configuration added is 12.6, for the
-- reason a letter is never reused (record-variants.ts): somebody quoted
-- "12.2" in an email, and it has to go on meaning the thing they quoted. So
-- the allocation is max + 1 over EVERY sibling, retired included, and this
-- backfill numbers retired configurations too.
--
-- ---- ONE ALLOCATOR, AND IT IS A TRIGGER ----------------------------------
--
-- `insertVariant` (variant-create.ts) is the app's only configuration insert,
-- and it already takes the PROJECT row lock before allocating `record_no`. The
-- trigger below runs inside that same insert, after that lock, so two
-- configurations added at once cannot both claim 12.4 — and the unique index
-- is the floor under it.
--
-- It is a trigger rather than a line in `insertVariant` because the app is
-- not the only thing that makes configurations. Fifteen database-tier
-- fixtures insert one directly, as does every maintenance fix with psql, and
-- a rule only the app kept would be a rule each of them broke — with the
-- CHECK below refusing the row. This trigger REFUSES nothing, which is the
-- distinction CLAUDE.md draws ("no trigger refusing a write made outside a
-- change set"): it fills in a number where none was given, and an insert that
-- names its own is left alone.
--
-- ---- THE BACKFILL IS HERE, IN SQL, AND WHY THAT IS FAITHFUL ---------------
--
-- The order is `naturalConfigurationOrder` (record-variants.ts): numbered
-- names first, numeric-aware (TYPE 2 before TYPE 10), then single letters
-- A to Z, then anything else in the order the document gave it. That is code,
-- and the brief allowed either a faithful SQL expression or a one-off script.
-- SQL was chosen, for one reason that decides it: this UPDATE must not bump
-- `spec_records.version`. Every chase coverage row compares the record's
-- version (`coverageStaleReasons`, "recordChanged"), so a backfill that
-- bumped it would make every unsent draft covering a configuration read as
-- stale for a reason that has nothing to do with it — the `chased_at` trap.
-- Only a migration, which runs as the table's owner inside one transaction,
-- can switch that one trigger off for the length of one statement. A script
-- would have needed a privilege the app role may not hold on pilot.
--
-- The expression below is the function's rule, clause for clause, over the
-- label shape 0037 allows (`^[A-Z0-9][A-Z0-9 ./&-]{0,23}$`):
--
--   * numbered: `/^(.*?)(\d+)(.*)$/` — HEAD is everything before the first
--     digit, N the first run of digits, TAIL the rest. Sorted by head, N as a
--     number, tail.
--   * a single letter: sorted A to Z.
--   * the rest: "the order the document gave it", which in the database is
--     the order the records were made in — `record_no`, because a confirm
--     writes a pack's configurations in page order.
--
-- The one place it can differ: `localeCompare` and the "C" collation order
-- the punctuation this shape allows (`&` `-` `.` `/`) differently among
-- themselves. Letters, digits and space order identically in both, so two
-- names under ONE bill line would have to differ only in which of those four
-- marks they carry for the order to come out otherwise. Nothing in any pack
-- does; it is written down rather than guessed at.
--
-- ---- THE CHECK IS TIGHT FROM THE START -----------------------------------
--
-- Because the backfill is in the same transaction, `variant_ordinal` is null
-- EXACTLY when `parent_id` is — the same biconditional 0024 states for
-- `variant_label`. A configuration with no number would be a row the label
-- helper has to fall back on, and a fallback is a second rule.
-- ==========================================================================
begin;

alter table spec_records add column variant_ordinal integer;

comment on column spec_records.variant_ordinal is
  'A configuration''s number under its bill line: the 1 in 12.1. Allocated '
  'max + 1 over every sibling, retired ones included, and never reused. Null on a '
  'bill line. record_no stays the project-wide surrogate.';

-- ONE STATEMENT WITH THE LOCK OFF. `bump_version` is the only trigger that
-- must not fire (see above); the audit trigger still records every row, under
-- the actor below, so the trail says who numbered them.
alter table spec_records disable trigger spec_records_bump_version;

with ordered as (
  select c.id,
         row_number() over (
           partition by c.parent_id
           order by
             -- numbered names, then single letters, then the rest
             case
               when c.variant_label ~ '[0-9]' then 0
               when c.variant_label ~ '^[A-Z]$' then 1
               else 2
             end,
             case when c.variant_label ~ '[0-9]'
                  then substring(c.variant_label from '^[^0-9]*') end collate "C",
             case when c.variant_label ~ '[0-9]'
                  then substring(c.variant_label from '[0-9]+')::numeric end,
             case when c.variant_label ~ '[0-9]'
                  then regexp_replace(c.variant_label, '^[^0-9]*[0-9]+', '') end collate "C",
             case when c.variant_label ~ '^[A-Z]$' then c.variant_label end collate "C",
             c.record_no
         ) as ordinal
    from spec_records c
   where c.parent_id is not null
)
update spec_records r
   set variant_ordinal = ordered.ordinal,
       updated_by = 'system:migration-0039'
  from ordered
 where ordered.id = r.id;

alter table spec_records enable trigger spec_records_bump_version;

create or replace function assign_variant_ordinal() returns trigger as $$
begin
  if new.parent_id is not null and new.variant_ordinal is null then
    -- Every sibling, retired included: a number is never reused. A
    -- multi-row insert sees the rows it has already inserted, so three
    -- children in one statement are 1, 2 and 3.
    select coalesce(max(s.variant_ordinal), 0) + 1
      into new.variant_ordinal
      from spec_records s
     where s.parent_id = new.parent_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger spec_records_assign_variant_ordinal
  before insert on spec_records
  for each row execute function assign_variant_ordinal();

alter table spec_records
  add constraint spec_records_variant_ordinal_requires_parent
  check ((variant_ordinal is null) = (parent_id is null));

alter table spec_records
  add constraint spec_records_variant_ordinal_positive
  check (variant_ordinal is null or variant_ordinal >= 1);

-- One number per bill line. Plain unique, not partial: a retired sibling
-- keeps its number and must go on blocking it.
create unique index spec_records_parent_ordinal_key
  on spec_records (parent_id, variant_ordinal)
  where parent_id is not null;

commit;
