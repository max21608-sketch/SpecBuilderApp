-- ==========================================================================
-- 0052_snapshots_per_transaction.sql -- a record takes one version per
-- TRANSACTION while a change is open, not one per change.
--
-- WHAT WENT WRONG (audit B1, 2026-11-06). 0012 made (record_id,
-- change_set_id) unique, with the comment "a transaction that touched a
-- record twice still produces one version of it", and `snapshotRecords`
-- inserted `on conflict (record_id, change_set_id) do nothing` to honour it.
-- That was right for the change it was written for: a document confirm opens
-- a change and closes it in one transaction. It was wrong for the change that
-- arrived the same day: a person OPENS a change ("Hayley's email of the 14th")
-- and every edit after it attaches to it through `changeSetForEdit`, one
-- transaction per edit, for as long as the change stays open.
--
-- So the first edit to a record inside an open change took the version and
-- every later edit to it in that change took none. Measured on the local
-- stack with `tests/db/change-history.test.ts`: a width typed, then a depth
-- typed, both under one open change, left ONE version holding the width. The
-- version list said v1 was the whole of what that change did; the depth
-- surfaced in the diff of whatever change touched the record next, under that
-- change's reason and evidence; and a baseline taken between the two edits
-- froze a version the record had already moved past, with nothing newer to
-- compare it to.
--
-- THE RULE NOW (Max, 2026-11-06): one version per TRANSACTION. The property
-- 0012 wanted -- one act that touches a record twice is one version -- is
-- about a transaction, so it is kept where a transaction can be seen: in
-- `snapshotRecords`, which remembers the records it has versioned in a
-- transaction-local setting (`app.snapshotted_records`) and skips them on a
-- second call. The database no longer enforces it, the code does, and the
-- coverage assertion in `tests/db/change-history.test.ts` is what proves the
-- code still takes the versions it should.
--
-- WHAT STILL HOLDS. `record_snapshots_record_no_key` (record_id, snapshot_no)
-- is untouched: the user-facing number is still unique per record, and
-- `snapshotRecords` still takes it under the record lock. The change index
-- (`record_snapshots_change_idx`) still serves every lookup by change.
--
-- Nothing is back-filled. A change that lost versions before this file did
-- not record the states it skipped, and inventing them now would be a history
-- nobody saw.
--
-- Read off the live local database before writing this (pg_constraint):
--   record_snapshots_record_change_key | UNIQUE (record_id, change_set_id)
-- ==========================================================================
begin;

alter table record_snapshots drop constraint record_snapshots_record_change_key;

comment on table record_snapshots is
  'A version of one record: one per transaction that changed it, numbered per record (0012, 0052). '
  'An open change may hold several versions of one record; snapshot_no is the order.';

commit;
