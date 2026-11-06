-- ==========================================================================
-- 0058_project_delete_order.sql -- the six keys a project delete crosses are
-- checked at COMMIT, because "the end of the statement" was not when 0055
-- thought it was.
--
-- WHAT WENT WRONG (audit 4.6, 2026-11-06). 0055 turned six RESTRICT keys into
-- NO ACTION so that one `delete from projects` would pass whatever order its
-- cascades fired in, on the reasoning that NO ACTION is checked "at the END of
-- the statement, after every cascade has run". It passed on the shared local
-- database. On the first FRESH database (the CI rehearsal: `createdb`, every
-- migration, every seed) it failed:
--
--   update or delete on table "spec_records" violates foreign key constraint
--   "email_draft_items_record_id_fkey" on table "email_draft_items"
--
-- with the constraint definitions identical on both. A non-deferrable NO
-- ACTION check runs at the end of the QUERY that deleted the referenced row,
-- and every cascade is a query of its own, run inside the parent's AFTER
-- triggers, depth first. The project's cascades fire in the order of their
-- trigger NAMES, `RI_ConstraintTrigger_a_<oid>`, compared as TEXT. 0055
-- re-created `email_drafts_project_id_fkey`, so its trigger took a new oid:
-- 157631 on the shared database, which sorts BEFORE 25394 ("1" < "2"), so the
-- drafts and their coverage went first and the records' check found nothing;
-- 171979 on the fresh one, which sorts AFTER 170797, so the records went
-- first, their check ran at the end of that cascade's own query, and the
-- coverage rows were still there. The order dependence 0055 set out to remove
-- was still there, and the test meant to catch it ran only on the lucky
-- order. A restore (`db/restore.mjs`) re-creates every constraint and so
-- rolls the dice again.
--
-- ---- WHAT THIS CHANGES ---------------------------------------------------
--
-- The six keys become DEFERRABLE INITIALLY DEFERRED. A deferred check runs at
-- COMMIT, after every cascade of every statement, whatever order they fired
-- in. That is the only point in a transaction that is after all of them.
--
--   email_draft_items_record_id_fkey   email_draft_items -> spec_records
--   email_draft_items_answer_id_fkey   email_draft_items -> spec_answers
--   email_drafts_contact_same_project  email_drafts -> project_contacts
--   intake_runs_batch_id_fkey          intake_runs -> intake_batches
--   record_attributes_finish_id_fkey   record_attributes -> project_finishes
--   spec_records_run_same_project      spec_records -> spec_runs
--
-- A lone delete is still refused, by the same constraint with the same
-- SQLSTATE (23503): a finish in use, a chased record or answer, a batch with
-- runs, a contact with drafts. What moves is WHEN. Inside a transaction the
-- DELETE statement now succeeds and the COMMIT is refused, which rolls the
-- whole transaction back; an autocommitted statement is refused as before,
-- because its commit is the end of the statement. The same holds for an
-- insert that names a row that does not exist, which is refused at commit.
-- Nothing in the app catches one of these errors mid-transaction and carries
-- on (they reach the reviewer as a failed write either way), and the guards
-- that matter (`assertCategoryMayChange` naming a chase) check first.
-- `set constraints all immediate` restores statement-time checks for a
-- transaction that wants them.
--
-- `db/project-delete.mjs` no longer relies on this alone: it deletes the
-- referencing tables first, in foreign-key order (house §12), so even under
-- `set constraints all immediate` it does not depend on trigger order. This
-- migration is what makes the bare `delete from projects` safe as well.
--
-- HOW. `alter table ... alter constraint ... deferrable initially deferred`,
-- not a drop and re-add. It changes only the timing, so there are no clauses
-- to re-list and none to lose (the "A CHECK is re-listed in full" trap cannot
-- arise), no oid changes, and nothing is re-validated. Each key's LIVE
-- definition is read first and the block refuses, naming it, if any is not
-- the plain NO ACTION, non-deferrable key 0055 left; afterwards each must read
-- exactly as before with " DEFERRABLE INITIALLY DEFERRED" on the end.
--
-- LOCKS. Each alter takes a brief lock on its table and its referenced table
-- and scans nothing; expect well under a second in all.
-- ==========================================================================

begin;

do $$
declare
  wanted constant text[] := array[
    'email_draft_items_record_id_fkey',
    'email_draft_items_answer_id_fkey',
    'email_drafts_contact_same_project',
    'intake_runs_batch_id_fkey',
    'record_attributes_finish_id_fkey',
    'spec_records_run_same_project'
  ];
  fk record;
  seen integer := 0;
  after text;
begin
  for fk in
    select c.oid, c.conname, c.conrelid::regclass as tbl, c.confdeltype, c.condeferrable,
           pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.contype = 'f' and c.conname = any(wanted)
  loop
    if fk.confdeltype <> 'a' or fk.condeferrable or fk.def like '%ON DELETE%' or fk.def like '%DEFERRABLE%' then
      raise exception '0058: % is not the plain NO ACTION key 0055 left (%); read it before changing it', fk.conname, fk.def;
    end if;
    execute format('alter table %s alter constraint %I deferrable initially deferred', fk.tbl, fk.conname);
    after := pg_get_constraintdef(fk.oid);
    if after <> fk.def || ' DEFERRABLE INITIALLY DEFERRED' then
      raise exception '0058: % now reads % (was %)', fk.conname, after, fk.def;
    end if;
    seen := seen + 1;
  end loop;
  if seen <> array_length(wanted, 1) then
    raise exception '0058: expected % foreign keys, found %', array_length(wanted, 1), seen;
  end if;
end $$;

commit;
