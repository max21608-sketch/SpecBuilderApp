-- ==========================================================================
-- 0012_change_sets_and_snapshots.sql
--
-- WHY. A spec record had no memory. `audit_log` has captured whole-row
-- before/after for every business table since 0001 and `status_history` has
-- been written by six confirm paths, and NOTHING HAS EVER READ EITHER. So
-- "what changed between the version we issued on the 3rd and the one we issued
-- on the 16th, and why" had no answer, and "the client says they never asked
-- for this" had nowhere to point.
--
-- Two tables, and one column on audit_log.
--
--   change_sets      — one entry in the trail: who, when, why, what kind, and
--                      a link to the EVIDENCE that caused it (the intake run,
--                      or an uploaded email).
--   record_snapshots — the composed state of one record after a change,
--                      numbered per record. This is the user-facing "version".
--
-- ---- WHY SNAPSHOTS RATHER THAN REPLAYING audit_log ----------------------
--
-- A record's state is spread over four tables and audit_log.row_id is text
-- with no record_id, so reconstructing "S-100 as at the 3rd" means a jsonb
-- replay across four tables in the right order. A snapshot makes it one row
-- and makes a diff one pure function. The cost of a snapshot is that a write
-- path can forget to take one -- which is what change_set_id below is for.
--
-- ---- WHY change_set_id AND NOT A TRANSACTION ID -------------------------
--
-- The obvious way to prove "every audited write belongs to a change" is
-- pg_current_xact_id(). It is available (PG13+) and stable inside
-- withTransaction, and it is still wrong here: db/restore.mjs into a fresh
-- Neon project restores historical xid8 values while the new cluster's
-- counter restarts low, so a future transaction can collide with a historical
-- id and the join silently starts lying.
--
-- So the id travels the way write_audit() already reads an actor: a GUC.
-- `set local app.change_set_id = '<uuid>'` is issued by openChangeSet as the
-- statement after the insert. 0001's header warns that SET LOCAL never
-- survives on the Neon HTTP driver -- true, and irrelevant here, because
-- every path that writes spec content runs in withTransaction, which holds
-- ONE `pg` client across a real BEGIN/COMMIT. That is also why
-- PATCH /api/answers/[id] moves onto that helper in this change: it was the
-- last mutating route still issuing a bare autocommitted statement.
--
-- The column is NULLABLE and nothing is back-filled. Rows written before this
-- migration belong to no change set, and stamping them with one would be a
-- lie about a record nobody can now reconstruct. `db/backfill-snapshots.ts`
-- gives every existing record a v1 under a 'history_begins' change instead,
-- which is an honest statement that history starts here.
-- ==========================================================================

begin;

-- ---- change_sets ---------------------------------------------------------
create table change_sets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null,

  -- WHY this happened. Required only where a change destroys or overrides
  -- something a person decided; see the CHECK below. Asking for one on every
  -- edit produces twenty prompts for twenty answers and teaches people to type
  -- "update" twenty times, which is worse than nothing.
  reason      text,

  -- A human name, on a baseline and nowhere else: "Issued to client 16 Sep".
  label       text,

  -- The document that caused it. A model-read pack, a bill of quantities.
  source_intake_run_id uuid references intake_runs(id) on delete set null,

  -- An uploaded .eml/.msg/.pdf: the email that asked for the change.
  --
  -- NO FOREIGN KEY, and deliberately. `attachments` is polymorphic and 0002
  -- already documents intake_runs.attachment_id as FK-less for exactly this
  -- reason: the row it points at is identified by (entity_type, entity_id)
  -- and the table serves four unrelated owners.
  evidence_attachment_id uuid,

  -- An OPEN change accepts further transactions from the same actor on the
  -- same project, so one stated reason covers a batch of edits. Closed by the
  -- reviewer, by opening another, or by inactivity. Null = still open.
  closed_at   timestamptz,

  actor       text not null,
  created_at  timestamptz not null default now(),

  constraint change_sets_kind_check check (kind in (
    'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
    'spec_document_confirm', 'preamble_confirm', 'manual_edit',
    'attribute_retire', 'category_set', 'finish_edit', 'finish_link',
    'finish_unlink', 'baseline', 'history_begins'
  )),

  -- A reason is REQUIRED where the change overrides or removes a human
  -- decision, and optional where it records one being made.
  constraint change_sets_reason_required check (
    kind not in ('attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink', 'baseline')
    or (reason is not null and btrim(reason) <> '')
  ),

  -- A baseline is named, and nothing else is.
  constraint change_sets_label_is_baseline check (
    (kind = 'baseline') = (label is not null and btrim(label) <> '')
  ),

  constraint change_sets_actor_not_blank check (btrim(actor) <> '')
);

create index change_sets_project_idx on change_sets (project_id, created_at desc);
-- At most one open change per actor per project. Partial, so closed ones do
-- not collide; this is what makes "attach to the open change" unambiguous
-- rather than a pick from several.
create unique index change_sets_one_open_per_actor
  on change_sets (project_id, actor) where closed_at is null;

-- An event is never edited. A correction is another change set. Same rule and
-- same shape as audit_log's own immutability triggers, with one exception:
-- closed_at is the change being SETTLED, not rewritten, so the trigger allows
-- an update that touches nothing else.
create or replace function prevent_change_set_rewrite() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'change_sets is append-only: a change cannot be deleted';
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

create trigger change_sets_append_only before update or delete on change_sets
  for each row execute function prevent_change_set_rewrite();

-- ---- record_snapshots ----------------------------------------------------
--
-- `atoms` holds the record exactly as the EXPORT LOADER shapes it
-- (ExportRecord + ExportAttribute[] + ExportAnswer[], plus refs, category and
-- the item image), so composeRowCells runs over a snapshot unchanged and there
-- is no second description of what a record is.
--
-- `cells` holds what that composer produced ON THE DAY. It is kept for one
-- question only -- "what did the file we sent actually say" -- and a DIFF IS
-- NEVER TAKEN OVER IT. The composer's rules change (the Timber Finish naming
-- question is open right now), and a diff over stored cells would then show
-- phantom edits on records nobody touched. Diffs run over `atoms`, and the
-- screen recomposes both ends with today's composer when it wants cells.
--
-- composer_version is bumped by hand when composeRowCells changes in a way
-- that alters output, so a reader can tell a real edit from a rule change.
create table record_snapshots (
  id               uuid primary key default gen_random_uuid(),
  record_id        uuid not null references spec_records(id) on delete cascade,
  change_set_id    uuid not null references change_sets(id) on delete restrict,
  snapshot_no      integer not null,
  schema_version   integer not null default 1,
  composer_version integer not null default 1,
  atoms            jsonb not null,
  cells            jsonb not null,
  created_at       timestamptz not null default now(),

  constraint record_snapshots_no_positive check (snapshot_no > 0),
  constraint record_snapshots_atoms_object check (jsonb_typeof(atoms) = 'object'),
  constraint record_snapshots_cells_array check (jsonb_typeof(cells) = 'array'),
  -- The user-facing version number: v1, v2, v3 of this record.
  constraint record_snapshots_record_no_key unique (record_id, snapshot_no),
  -- One snapshot per record per change. A transaction that touched a record
  -- twice still produces one version of it, which is what a reader expects.
  constraint record_snapshots_record_change_key unique (record_id, change_set_id)
);

create index record_snapshots_change_idx on record_snapshots (change_set_id);
create index record_snapshots_record_idx on record_snapshots (record_id, snapshot_no desc);

create or replace function prevent_record_snapshot_change() returns trigger as $$
begin
  raise exception 'record_snapshots is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger record_snapshots_no_update before update on record_snapshots
  for each row execute function prevent_record_snapshot_change();
create trigger record_snapshots_no_delete before delete on record_snapshots
  for each row execute function prevent_record_snapshot_change();

-- ---- audit_log gains the link -------------------------------------------
alter table audit_log add column change_set_id uuid;
create index audit_log_change_set_idx on audit_log (change_set_id) where change_set_id is not null;

-- write_audit() rewritten to read the second GUC. Everything else in it is
-- unchanged, including both load-bearing behaviours 0001 documents: the
-- actor's fallback to the row's own columns, and reading fields through
-- to_jsonb() so the trigger is safe on a table without them.
--
-- `current_setting(..., true)` -- the missing_ok form -- so a write outside a
-- change set records a null rather than raising. Phase 2 adds a trigger that
-- refuses those; it is not this migration's job, because at this moment the
-- write paths have not been converted yet and a hard refusal here would break
-- the app between two migrations.
create or replace function write_audit() returns trigger as $$
declare
  who text;
  change_set uuid;
begin
  begin who := nullif(current_setting('app.user'), ''); exception when others then who := null; end;
  begin change_set := nullif(current_setting('app.change_set_id', true), '')::uuid; exception when others then change_set := null; end;
  if tg_op = 'DELETE' then
    who := coalesce(who, to_jsonb(old)->>'updated_by', to_jsonb(old)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,changed_by,change_set_id)
      values (tg_table_name, old.id::text, 'delete', to_jsonb(old), who, change_set);
    return old;
  elsif tg_op = 'UPDATE' then
    who := coalesce(who, to_jsonb(new)->>'updated_by', to_jsonb(new)->>'created_by');
    insert into audit_log(table_name,row_id,action,old_values,new_values,changed_by,change_set_id)
      values (tg_table_name, new.id::text, 'update', to_jsonb(old), to_jsonb(new), who, change_set);
    return new;
  else
    who := coalesce(who, to_jsonb(new)->>'created_by', to_jsonb(new)->>'updated_by');
    insert into audit_log(table_name,row_id,action,new_values,changed_by,change_set_id)
      values (tg_table_name, new.id::text, 'insert', to_jsonb(new), who, change_set);
    return new;
  end if;
end;
$$ language plpgsql;

-- change_sets carries no version column and no updated_at: it is not editable,
-- so there is no lock to take and nothing for set_updated_at to maintain. It
-- IS audited, because "who closed this change" is worth knowing.
create trigger change_sets_audit after insert or update or delete on change_sets
  for each row execute function write_audit();

commit;
