-- ==========================================================================
-- 0014_change_set_cascade.sql
--
-- The same mistake 0013 fixed on record_snapshots, in the other half of it.
--
-- 0012 made change_sets refuse DELETE outright. `project_id` cascades from
-- projects, and a row-level BEFORE DELETE trigger fires on a cascade too, so
-- deleting a project raised instead of taking its trail with it. The QA
-- cleanup in tests/db/change-history.test.ts hit it; so would anybody removing
-- a project created by mistake.
--
-- Append-only means A CHANGE IS NEVER REWRITTEN. It does not mean the trail
-- outlives the project it describes: a change set records something that
-- happened to a project's records, and with the project gone there is nothing
-- left for it to be a record OF. audit_log is the layer that genuinely
-- survives everything, and it is untouched here.
--
-- Two migrations in a row correcting the same misreading of "append-only" is
-- worth writing down rather than tidying away: the rule to apply to the next
-- immutable table is "refuse the rewrite, allow the cascade".
-- ==========================================================================

begin;

create or replace function prevent_change_set_rewrite() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    -- Allowed only as part of the project going: on a cascade from projects
    -- the parent row is already gone by the time this fires.
    if exists (select 1 from projects where id = old.project_id) then
      raise exception 'change_sets is append-only: a change cannot be deleted while its project exists';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.kind is distinct from old.kind
     or new.reason is distinct from old.reason
     or new.label is distinct from old.label
     or new.source_intake_run_id is distinct from old.source_intake_run_id
     or new.evidence_attachment_id is distinct from old.evidence_attachment_id
     or new.actor is distinct from old.actor
     or new.created_at is distinct from old.created_at then
    raise exception 'change_sets is append-only: only closed_at may be set';
  end if;
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'this change is already closed';
  end if;
  return new;
end;
$$ language plpgsql;

-- A version references the change that produced it with `on delete restrict`,
-- which would block the project cascade before the trigger above ever ran.
-- The record cascade removes the versions first, but Postgres does not order
-- cascades, so this has to be a cascade too for a project delete to complete.
alter table record_snapshots drop constraint record_snapshots_change_set_id_fkey;
alter table record_snapshots
  add constraint record_snapshots_change_set_id_fkey
  foreign key (change_set_id) references change_sets(id) on delete cascade;

commit;
