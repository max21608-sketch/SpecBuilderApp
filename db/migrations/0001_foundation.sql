-- ==========================================================================
-- 0001_foundation.sql — shared foundation for a Ben Whistler app.
-- Target: PostgreSQL 13+. Forward-only.
--
-- This is the chassis every app in this company starts from: identity, the
-- append-only audit trail, optimistic locking, polymorphic attachments, and
-- the controlled-vocabulary table. It contains NO domain tables. Add those in
-- 0002 onward.
--
-- Conventions this establishes, and which later migrations must keep:
--   * UUID primary keys (gen_random_uuid()).
--   * Every business table has created_at/updated_at + created_by/updated_by.
--   * updated_at is maintained by a trigger, never by a call site.
--   * Mutations on business tables are written to audit_log by a trigger.
--   * `version` + bump_version() is the optimistic lock. A client sends the
--     version it read; a non-matching update writes zero rows and the route
--     returns 409 rather than overwriting a newer change.
-- ==========================================================================

begin;

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- shared helper: keep updated_at current -------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- ---- optimistic locking ---------------------------------------------------
-- Attach this to any user-editable table that also has a `version` column.
-- A trigger rather than call-site increments, so correctness does not depend
-- on every write path remembering.
create or replace function bump_version() returns trigger as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$ language plpgsql;

-- ---- audit log (append-only) ---------------------------------------------
create table audit_log (
  id          bigserial primary key,
  table_name  text        not null,
  row_id      text        not null,        -- text so it works for any PK type
  action      text        not null,        -- insert | update | delete
  old_values  jsonb,
  new_values  jsonb,
  changed_by  text,
  changed_at  timestamptz not null default now()
);
create index audit_log_table_row_idx on audit_log (table_name, row_id);

-- Generic audit trigger.
--
-- TWO things here are load-bearing and were both learned by getting them wrong:
--
-- 1. The actor falls back to the row's own updated_by/created_by columns.
--    The obvious design is a session-scoped `SET LOCAL app.user` GUC, but
--    Neon's HTTP driver issues ONE query per call, so a prior SET LOCAL never
--    survives to reach the mutation and changed_by silently lands null on
--    every row. NULLIF is there because Postgres can retain the GUC as an
--    empty string after a rollback, which would mask the fallback.
--
-- 2. Fields are read via to_jsonb(new)->>'...' rather than new.updated_by.
--    NEW and OLD are polymorphic RECORDs: a table WITHOUT those columns (the
--    users table, a join table) would raise at trigger-fire time on direct
--    field access, i.e. the first time anyone touched that table.
create or replace function write_audit() returns trigger as $$
declare who text;
begin
  begin who := nullif(current_setting('app.user'), ''); exception when others then who := null; end;
  if tg_op = 'DELETE' then
    who := coalesce(who, to_jsonb(old)->>'updated_by', to_jsonb(old)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,changed_by)
      values (tg_table_name, old.id::text, 'delete', to_jsonb(old), who);
    return old;
  elsif tg_op = 'UPDATE' then
    who := coalesce(who, to_jsonb(new)->>'updated_by', to_jsonb(new)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,new_values,changed_by)
      values (tg_table_name, new.id::text, 'update', to_jsonb(old), to_jsonb(new), who);
    return new;
  else
    who := coalesce(who, to_jsonb(new)->>'created_by', to_jsonb(new)->>'updated_by');
    insert into audit_log(table_name,row_id,action,new_values,changed_by)
      values (tg_table_name, new.id::text, 'insert', to_jsonb(new), who);
    return new;
  end if;
end;
$$ language plpgsql;

-- "Append-only" enforced, not merely intended. On the fabric-ordering app this
-- was a comment for eighteen migrations before it became a constraint.
create or replace function prevent_audit_log_change() returns trigger as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger audit_log_no_update before update on audit_log
  for each row execute function prevent_audit_log_change();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function prevent_audit_log_change();

-- ---- users ----------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text not null,
  password_hash text not null,               -- format: scrypt$<saltHex>$<hashHex>
  role          text not null default 'editor',
  active        boolean not null default true,
  last_login    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The role set. Must stay in sync with WRITER_ROLES in
-- src/middleware.ts -- changing roles means a new migration, not just a code
-- edit. Constrained here rather than left free-text because a mis-cased or
-- mistyped role used to grant write rights by accident.
alter table users add constraint users_role_check
  check (role in ('admin', 'editor', 'viewer'));

-- ---- attachments (files) --------------------------------------------------
-- Polymorphic on purpose: one table serves uploaded source documents,
-- generated exports, extracted images and preserved .eml files, for any
-- entity. storage_path holds the blob URL; the blob store is PRIVATE, so a
-- server-side read still needs the bearer token.
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,
  entity_id    uuid not null,
  kind         text,
  storage_path text not null,
  filename     text,
  content_type text,
  size         bigint,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index attachments_entity_idx on attachments (entity_type, entity_id);

-- ---- messages (email / correspondence log) --------------------------------
create table messages (
  id               uuid primary key default gen_random_uuid(),
  entity_type      text not null,
  entity_id        uuid not null,
  direction        text not null,       -- in | out | draft
  from_addr        text,
  to_addr          text,
  subject          text,
  body             text,
  graph_message_id text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index messages_entity_idx on messages (entity_type, entity_id);

-- ---- status history -------------------------------------------------------
-- Deliberately separate from audit_log: audit_log is a forensic record of
-- every column change, this is a queryable lifecycle timeline you can render.
-- Polymorphic so it is not tied to one domain table.
create table status_history (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  from_status text,
  to_status   text not null,
  changed_by  text,
  changed_at  timestamptz not null default now(),
  note        text
);
create index status_history_entity_idx on status_history (entity_type, entity_id, changed_at desc);

-- ---- notes (append-only) --------------------------------------------------
-- Notes explain WHY. They are optional, append-only and immutable by trigger,
-- because the reason someone gave at the time is evidence -- a correction is
-- another note, never an edit. They live in their own table so that writing
-- one cannot bump the optimistic-lock version of the row it explains.
create table notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index notes_entity_idx on notes (entity_type, entity_id, created_at desc, id desc);

create or replace function prevent_note_change() returns trigger as $$
begin
  raise exception 'notes are append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger notes_no_update before update on notes
  for each row execute function prevent_note_change();

-- ---- pick lists (controlled vocabulary) -----------------------------------
-- The editable half of a controlled vocabulary. The authoritative list lives
-- in TypeScript next to the code that uses it; this table is what the UI
-- offers. Keep them in sync deliberately -- see the external-vocabulary-sync
-- skill.
create table pick_lists (
  id         serial primary key,
  category   text not null,
  value      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  unique (category, value)
);

-- ---- attach updated_at + audit triggers -----------------------------------
-- Re-run this block (as its own migration) after adding business tables.
-- `users` gets audit but not bump_version: it has no `version` column.
do $$
declare t text;
begin
  foreach t in array array['users', 'attachments', 'messages', 'pick_lists'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
  end loop;

  foreach t in array array['users'] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

commit;
