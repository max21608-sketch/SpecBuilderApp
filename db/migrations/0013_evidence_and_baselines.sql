-- ==========================================================================
-- 0013_evidence_and_baselines.sql
--
-- Three things 0012 needed and one it got wrong.
--
-- ---- 1. A VERSION CANNOT BE DELETED, EVEN WITH ITS RECORD ---------------
--
-- 0012 made record_snapshots append-only with a blanket refusal on DELETE.
-- That is right for a rewrite and wrong for a cascade: `record_id` cascades
-- from spec_records, and a row-level BEFORE DELETE trigger fires on a cascade
-- too, so deleting a record raised instead of taking its versions with it.
-- Caught by the QA cleanup in tests/db/change-history.test.ts, which is
-- exactly the kind of thing house/conventions.md §12 exists to surface.
--
-- The rule it should have been: a version may not be REWRITTEN, ever, and may
-- not be deleted while the record it describes still exists. A version is
-- evidence ABOUT a record; once the record is gone there is no subject for it
-- to be evidence of. Nothing in the app deletes a record — retiring is a
-- status — so in practice this only ever fires for a test tidying up after
-- itself.
--
-- Not an edit to 0012: it is applied to sandbox, and conventions §4 says add
-- another one.
--
-- ---- 2. EVIDENCE FILES --------------------------------------------------
--
-- A change caused by an email needs the email. It goes in `attachments` under
-- entity_type 'change_sets', which is what that table's own 0001 header says
-- it is for. `superseded_at` is added there for a different reason: an item
-- image is currently DELETED when a newer crop replaces it, and a version
-- pointing at that row would dangle. From here nothing deletes an attachment.
--
-- ---- 3. BASELINES -------------------------------------------------------
--
-- "What changed between the version we issued on the 3rd and the one on the
-- 16th" needs the two ends to be exact sets, not "the newest version as at a
-- timestamp". created_at is transaction START time, so two overlapping guarded
-- transactions can commit in the opposite order to their timestamps and a
-- version would land on the wrong side of a baseline. So a baseline
-- MATERIALISES its members, written while holding the project row lock.
--
-- ---- WHAT IS DELIBERATELY NOT HERE --------------------------------------
--
-- A trigger refusing any spec-content write made outside a change set. It was
-- planned for this migration and is not built, because every db-tier test
-- fixture and every hand fix with psql writes rows directly, and a trigger
-- that refuses them turns a safety net into a wall across the maintenance
-- path. The guarantee is kept by the coverage assertion in
-- tests/db/change-history.test.ts instead, which reads the WHOLE database:
-- any change set with spec-content audit rows and no version fails it. That
-- catches a forgotten call in an app path, which is the thing worth catching.
-- Revisit if a path is ever found to have skipped one in production.
-- ==========================================================================

begin;

-- ---- 1. versions go with their record, and never otherwise ---------------
create or replace function prevent_record_snapshot_change() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'record_snapshots is append-only: a version cannot be rewritten';
  end if;
  -- DELETE. Allowed only as part of the record going: on a cascade from
  -- spec_records the parent row is already gone by the time this fires.
  if exists (select 1 from spec_records where id = old.record_id) then
    raise exception 'record_snapshots is append-only: a version cannot be deleted while its record exists';
  end if;
  return old;
end;
$$ language plpgsql;

-- ---- 2. evidence ---------------------------------------------------------
-- An attachment is never deleted from here on. `superseded_at` is how a
-- replaced item image stops being current without taking a version's picture
-- with it.
alter table attachments add column superseded_at timestamptz;
create index attachments_current_idx
  on attachments (entity_type, entity_id, kind) where superseded_at is null;

-- ---- 3. baselines --------------------------------------------------------
-- The exact set of versions a named point refers to. Written under the
-- project row lock, so no record write can interleave and leave the set
-- describing a moment that never existed.
create table baseline_members (
  change_set_id uuid not null references change_sets(id) on delete cascade,
  record_id     uuid not null references spec_records(id) on delete cascade,
  snapshot_id   uuid not null references record_snapshots(id) on delete cascade,
  primary key (change_set_id, record_id)
);

create index baseline_members_record_idx on baseline_members (record_id);

-- A member set is a photograph. Correcting one would change what a signed-off
-- comparison referred to, which is the one thing a baseline exists to stop.
create or replace function prevent_baseline_member_change() returns trigger as $$
begin
  raise exception 'a baseline cannot be edited: take another one';
end;
$$ language plpgsql;

create trigger baseline_members_no_update before update on baseline_members
  for each row execute function prevent_baseline_member_change();

commit;
