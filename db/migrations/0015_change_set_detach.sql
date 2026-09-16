-- ==========================================================================
-- 0015_change_set_detach.sql
--
-- The third and last consequence of "append-only" being written as a blanket
-- refusal, and the one that would have bitten a real database rather than a
-- test.
--
-- `change_sets.source_intake_run_id` is `references intake_runs(id) on delete
-- set null`. Deleting an intake run therefore issues an UPDATE on change_sets
-- — and 0012's trigger refused it, because the update touches a column other
-- than closed_at. The effect: ONCE A DOCUMENT HAS CAUSED A CHANGE IT CAN
-- NEVER BE DELETED. Not by a cleanup, not by a person removing a file
-- uploaded to the wrong project, not by the project cascade — which also
-- deletes intake_runs, in an order Postgres does not promise.
--
-- Caught by tools/qa-clean.mjs, which is the only thing in the repo that
-- deletes an intake run at all.
--
-- The rule, stated properly: a change set is never REWRITTEN BY A PERSON. The
-- database detaching a row that no longer exists is not a rewrite — it is the
-- referential integrity that column was declared with, and the change set's
-- own audit_log row still holds the id that was there.
--
-- So the trigger now allows exactly two updates and nothing else:
--   * closing an open change, once;
--   * nulling source_intake_run_id, and only from non-null to null, and only
--     when no intake run with that id exists any more.
--
-- Everything else still raises. In particular this cannot be used to re-point
-- a change at a different document, or to blank the reason.
-- ==========================================================================

begin;

create or replace function prevent_change_set_rewrite() returns trigger as $$
declare detaching boolean := false;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from projects where id = old.project_id) then
      raise exception 'change_sets is append-only: a change cannot be deleted while its project exists';
    end if;
    return old;
  end if;

  -- The FK's own ON DELETE SET NULL, recognised by its exact shape: the old
  -- value was set, the new one is null, and the run it named is gone.
  if old.source_intake_run_id is not null
     and new.source_intake_run_id is null
     and not exists (select 1 from intake_runs where id = old.source_intake_run_id) then
    detaching := true;
  end if;

  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.kind is distinct from old.kind
     or new.reason is distinct from old.reason
     or new.label is distinct from old.label
     or (not detaching and new.source_intake_run_id is distinct from old.source_intake_run_id)
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

commit;
