-- ==========================================================================
-- 0055_project_deletable.sql -- one statement deletes a project, whatever
-- order Postgres fires its cascades in.
--
-- WHAT WENT WRONG (audit B5, 2026-11-06). There was no way to delete a
-- project, and the schema resisted adding one. Deleting a project that had
-- been through a normal week failed on any of three things:
--
--   1. `email_drafts.project_id` is ON DELETE RESTRICT (0005). Any project
--      anybody ever chased refused outright.
--   2. `email_messages.project_id` is ON DELETE SET NULL (0021), and the same
--      table's CHECK `email_messages_assigned_has_project` says an ASSIGNED
--      message has a project. Setting it null on an assigned message is
--      refused by its own row, so every project with assigned mail refused.
--   3. Six more RESTRICTs sit BETWEEN two tables the project cascade empties:
--
--        intake_runs.batch_id          -> intake_batches       (0007)
--        spec_records (run_id, project_id) -> spec_runs        (0007)
--        record_attributes.finish_id   -> project_finishes     (0018)
--        email_drafts (contact_id, project_id) -> project_contacts (0022)
--        email_draft_items.record_id   -> spec_records         (0005)
--        email_draft_items.answer_id   -> spec_answers         (0005)
--
--      RESTRICT is checked the moment the referenced row goes, so each of
--      these passed or failed on WHICH CASCADE FIRED FIRST: if the batches
--      went before their runs, the delete raised. Postgres fires a table's RI
--      triggers in name order, and the names carry the oid, so the order is
--      creation order -- which `db/restore.mjs` changes, because a dump
--      recreates constraints in its own order. A delete that worked on one
--      database could fail on its restored copy.
--
--      And the version guard (0013) refused to delete a version while its
--      record existed, which is exactly the state when `change_sets` cascades
--      to `record_snapshots` before `spec_records` does. The same race.
--
-- `qa-clean` never deleted `email_messages`, so its sweep failed on any
-- `__QA` project that had received fake mail; `qa-demo-project.ts` deletes
-- drafts, mail and finish links by hand first, because the trap was known
-- there and nowhere else.
--
-- Max, 2026-11-06: a project is deletable BY SCRIPT, with the production
-- flags, never from the app. `db/delete-project.mjs` is that script, and
-- `db/project-delete.mjs` the one implementation it and `qa-clean` share.
--
-- ---- WHAT THIS CHANGES ---------------------------------------------------
--
-- 1. `email_drafts.project_id` CASCADES. A chase is a record of something
--    sent about this project; with the project gone it is a record of
--    nothing. Its coverage rows already cascade from the draft.
--
-- 2. Mail is TAKEN OFF its project, never deleted with it, by a trigger
--    rather than a cascade. A message that arrived through the mailbox has
--    an arrival record outside any project (`mailbox/...`), and it is the
--    record that it arrived at all. So when the project goes, the message
--    goes back to unassigned in the same statement, exactly as Unassign
--    leaves it (`unassignMessage`), with the reason in words for the inbox.
--    The trigger recognises ONLY that shape -- the project id going from a
--    value to null because the project it named no longer exists, the FK's
--    own SET NULL -- so an application UPDATE that nulls `project_id` on an
--    assigned message is still refused by the CHECK, as before. (The 0015
--    "detaching" test on change_sets, in a second table.) Mail whose only copy
--    is under the project's own prefix -- an `.eml` uploaded to it -- has no
--    arrival record to survive on, and the delete script removes it first.
--
-- 3. The six order-sensitive RESTRICTs become NO ACTION. NO ACTION is checked
--    at the END of the statement, after every cascade has run, so the project
--    delete passes whatever the order. A delete of the referenced row ON ITS
--    OWN is refused exactly as before, with the same constraint name and the
--    same SQLSTATE (23503) -- a finish an attribute is linked to still cannot
--    be deleted, a chased answer still cannot be deleted (audit B3 is
--    unchanged by this). `email_draft_items.record_id` is NO ACTION rather
--    than CASCADE on purpose: a coverage row goes with its draft, and a record
--    deleted on its own (nothing in the app does that) must still be refused
--    rather than silently emptying a sent chase.
--
--    Each is re-created from its LIVE definition (`pg_get_constraintdef`),
--    with only the delete action changed -- the "A CHECK is re-listed in full"
--    rule, applied to a foreign key. The block refuses if any of them is not
--    RESTRICT today, rather than guessing what changed.
--
-- 4. The version guard allows a delete when the record OR ITS PROJECT is
--    gone. "Refuse the rewrite, allow the cascade" (0013, 0014, 0015) a
--    fourth time: a version still cannot be updated, and still cannot be
--    deleted while its record exists on a project that exists.
--
-- `audit_log` is untouched and keeps the deleted project's rows, by design.
--
-- LOCKS. Each re-created FK takes SHARE ROW EXCLUSIVE on both its tables and
-- scans the referencing table once to validate. These tables are small on
-- pilot; expect a few seconds at most, with writes to them waiting.
-- ==========================================================================

begin;

-- ---- 1 and 3: the foreign keys, from their live definitions ---------------
do $$
declare
  wanted constant text[] := array[
    'email_drafts_project_id_fkey',
    'intake_runs_batch_id_fkey',
    'spec_records_run_same_project',
    'record_attributes_finish_id_fkey',
    'email_drafts_contact_same_project',
    'email_draft_items_record_id_fkey',
    'email_draft_items_answer_id_fkey'
  ];
  fk record;
  seen integer := 0;
  rebuilt text;
begin
  for fk in
    select c.conname, c.conrelid::regclass as tbl, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.contype = 'f' and c.conname = any(wanted)
  loop
    if fk.def not like '% ON DELETE RESTRICT' then
      raise exception '0055: % is no longer ON DELETE RESTRICT (%); read it before changing it', fk.conname, fk.def;
    end if;
    rebuilt := case
      when fk.conname = 'email_drafts_project_id_fkey' then replace(fk.def, ' ON DELETE RESTRICT', ' ON DELETE CASCADE')
      else replace(fk.def, ' ON DELETE RESTRICT', '')
    end;
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute format('alter table %s add constraint %I %s', fk.tbl, fk.conname, rebuilt);
    seen := seen + 1;
  end loop;
  if seen <> array_length(wanted, 1) then
    raise exception '0055: expected % foreign keys, found %', array_length(wanted, 1), seen;
  end if;
end $$;

-- ---- 2: mail survives its project, taken off it -----------------------------
create or replace function release_message_from_deleted_project() returns trigger as $$
begin
  -- Only the FK's own SET NULL: a value going to null because the project it
  -- named is gone. Anything else falls through to the CHECK unchanged.
  if old.project_id is not null
     and new.project_id is null
     and new.routing_status = 'assigned'
     and not exists (select 1 from projects where id = old.project_id) then
    new.routing_status := 'unassigned';
    new.assigned_by := null;
    new.assigned_at := null;
    new.assignment_kind := null;
    new.routing_reason := 'Its project was deleted.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger email_messages_release_on_project_delete
  before update of project_id on email_messages
  for each row execute function release_message_from_deleted_project();

-- ---- 4: the version guard -------------------------------------------------
create or replace function prevent_record_snapshot_change() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'record_snapshots is append-only: a version cannot be rewritten';
  end if;
  -- DELETE. Allowed only as part of the record going (a cascade from
  -- spec_records) or of its project going (a cascade from change_sets, which
  -- can fire before the records' own). In both the parent is already gone by
  -- the time this fires.
  if exists (
    select 1 from spec_records r
      join projects p on p.id = r.project_id
     where r.id = old.record_id
  ) then
    raise exception 'record_snapshots is append-only: a version cannot be deleted while its record exists';
  end if;
  return old;
end;
$$ language plpgsql;

commit;
