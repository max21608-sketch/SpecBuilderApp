-- ==========================================================================
-- 0054_audit_excludes_document_columns.sql -- the audit trail stops copying
-- staged documents, email bodies and password hashes.
--
-- WHAT WENT WRONG (audit B4, 2026-11-06). `write_audit()` (0001, 0012) writes
-- `to_jsonb(old)` and `to_jsonb(new)` whole, and `audit_log` refuses delete
-- (0001). Three tables carry a column nobody meant the trail to keep:
--
--   intake_runs     parsed, raw_response   the staged document and the
--                                          model's reply. Every review
--                                          autosave rewrites `parsed`, so
--                                          every click wrote TWO copies of
--                                          it (hundreds of KB on the Aman
--                                          bill's read). Measured on the
--                                          local stack the day this was
--                                          written: 484 MB of audit rows
--                                          against intake_runs alone.
--   email_messages  body_text, headers_raw the text of an NDA-covered email,
--                                          duplicated on every triage and
--                                          every assignment.
--   users           password_hash          a scrypt hash, kept for ever in
--                                          a table that cannot be pruned.
--
-- An undeletable copy defeats any retention decision about the source row:
-- deleting a project (0055) or a user would leave its document, its mail and
-- its hash in audit_log regardless. Max, 2026-11-06: stop auditing those
-- columns.
--
-- THE SHAPE. One function, still. `write_audit()` now reads the trigger's own
-- arguments as the column names to leave out (`TG_ARGV`), and strips them
-- from old and new with jsonb's minus. A trigger created with no arguments --
-- every other audited table -- behaves exactly as before, byte for byte. A
-- second function (`write_audit_excluding`) was the alternative and would have
-- been a second copy of the actor fallback and the change-set GUC, which is
-- how two audit rules start to drift. Both load-bearing behaviours are kept
-- as they were:
--
--   * the actor falls back to the row's own updated_by / created_by, because
--     the Neon HTTP driver kills SET LOCAL (0001); it is read from the WHOLE
--     row, before anything is stripped, so stripping cannot lose it;
--   * the change set comes from the `app.change_set_id` GUC, missing_ok (0012).
--
-- An update that changes ONLY an excluded column (an autosave of `parsed`)
-- still writes its audit row. That is deliberate: the trail still says the
-- run changed, when, by whom and in which change; it no longer says into
-- what. The run itself holds what it says now.
--
-- WHAT THIS DOES NOT DO. Rows already written are NOT rewritten. `audit_log`
-- is append-only (0001's trigger refuses update and delete) and this
-- migration does not lift that, for any reason: the history that exists stays
-- what it is. Reclaiming that space is a separate decision, with its own
-- migration that names what it deletes and why.
--
-- A new column that should never be audited is added to the trigger's
-- argument list below in its own migration. Read `pg_get_triggerdef` on the
-- live trigger first, the same rule as re-listing a CHECK: the list is the
-- whole list.
-- ==========================================================================

begin;

create or replace function write_audit() returns trigger as $$
declare
  who text;
  change_set uuid;
  -- The columns this trigger leaves out, from its own CREATE TRIGGER
  -- arguments. Empty for every table that names none.
  excluded text[] := case when tg_nargs > 0 then tg_argv else '{}'::text[] end;
begin
  begin who := nullif(current_setting('app.user'), ''); exception when others then who := null; end;
  begin change_set := nullif(current_setting('app.change_set_id', true), '')::uuid; exception when others then change_set := null; end;
  if tg_op = 'DELETE' then
    who := coalesce(who, to_jsonb(old)->>'updated_by', to_jsonb(old)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,changed_by,change_set_id)
      values (tg_table_name, old.id::text, 'delete', to_jsonb(old) - excluded, who, change_set);
    return old;
  elsif tg_op = 'UPDATE' then
    who := coalesce(who, to_jsonb(new)->>'updated_by', to_jsonb(new)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,new_values,changed_by,change_set_id)
      values (tg_table_name, new.id::text, 'update', to_jsonb(old) - excluded, to_jsonb(new) - excluded, who, change_set);
    return new;
  else
    who := coalesce(who, to_jsonb(new)->>'created_by', to_jsonb(new)->>'updated_by');
    insert into audit_log(table_name,row_id,action,new_values,changed_by,change_set_id)
      values (tg_table_name, new.id::text, 'insert', to_jsonb(new) - excluded, who, change_set);
    return new;
  end if;
end;
$$ language plpgsql;

-- The three triggers, re-created under their existing names with the columns
-- they leave out. Names unchanged so `drop trigger if exists %I_audit` in any
-- later re-run of the 0001 block still finds them -- and such a block would
-- re-create them WITHOUT the arguments, which is the trap to read for before
-- writing one.
drop trigger if exists intake_runs_audit on intake_runs;
create trigger intake_runs_audit after insert or update or delete on intake_runs
  for each row execute function write_audit('parsed', 'raw_response');

drop trigger if exists email_messages_audit on email_messages;
create trigger email_messages_audit after insert or update or delete on email_messages
  for each row execute function write_audit('body_text', 'headers_raw');

drop trigger if exists users_audit on users;
create trigger users_audit after insert or update or delete on users
  for each row execute function write_audit('password_hash');

commit;
