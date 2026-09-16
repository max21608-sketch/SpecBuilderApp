-- ==========================================================================
-- 0017_boq_revision.sql
--
-- WHY. A client sends a revised bill. Today confirming it creates a SECOND
-- spec_runs row and a full second set of spec_records with new record numbers,
-- sitting beside the originals — both appear as tabs, both export, and the
-- drawings, attributes and checklist answers gathered against the first set do
-- not move. 0007's own header called retiring the old run "how it leaves the
-- tabs", and no code in this repo can retire one: there is no `update
-- spec_runs` anywhere in src/.
--
-- So a revised BOQ is currently a duplicate of the project, and the work done
-- on the first copy is stranded.
--
-- ---- WHAT A REVISION ACTUALLY IS ----------------------------------------
--
-- A run keeps its identity. Lines that persist keep THEIR record — and
-- therefore their drawings, their specs, their picture and their answers —
-- with the bill's new quantity and description written over the top. Lines
-- that are new become new records. Lines that are gone RETIRE, and are not
-- deleted: a record is the only place a client ref maps to a BWS job, and
-- deleting one loses that mapping for a job that may already exist.
--
-- ---- THE PAIRING IS STAGED, NOT RE-MATCHED AT CONFIRM -------------------
--
-- house/data-safety.md: the confirm route "re-runs no matching — it writes
-- what the reviewer submitted", and confirm-boq.ts says the same in its own
-- comment. Matching a revised line to an existing record IS matching, so it
-- happens at REVIEW time and the reviewer's decision is stored on the staged
-- line. v3 adds exactly that:
--
--   * per sheet, `replacesRunId`: null for a new run, or the run this sheet
--     is a revision of;
--   * per line, `replaces`: null, or {recordId, recordVersion} — the record
--     this line continues, at the version the reviewer was shown.
--
-- Upgraded in place rather than teaching the reader two shapes, exactly as
-- 0007 upgraded v1 to v2, and for the reason it gives: a reader that supports
-- two staged formats has a second format that is exercised once a year and is
-- wrong when it is.
--
-- ---- RETIRING -----------------------------------------------------------
--
-- spec_records and spec_runs both already have a `retired` status in their
-- CHECK constraints and neither records WHO or WHEN. record_attributes and
-- project_notes both do (0007), with a constraint making the pair mandatory.
-- Same shape here, so a retired row can always name the person who retired it.
--
-- `replaced_by_run_id` is the run-level equivalent of
-- record_attributes.superseded_by_id: it says which run took over, so a
-- retired tab is a step in a history rather than a dead end.
-- ==========================================================================

begin;

-- ---- who retired it, and when -------------------------------------------
alter table spec_records add column retired_at timestamptz;
alter table spec_records add column retired_by text;
alter table spec_records
  add constraint spec_records_retired_has_actor
  check (status <> 'retired' or (retired_at is not null and retired_by is not null));

alter table spec_runs add column retired_at timestamptz;
alter table spec_runs add column retired_by text;
alter table spec_runs add column replaced_by_run_id uuid references spec_runs(id) on delete set null;
alter table spec_runs
  add constraint spec_runs_retired_has_actor
  check (status <> 'retired' or (retired_at is not null and retired_by is not null));
-- Only a retired run can have been replaced, for the same reason an active
-- attribute cannot carry superseded_by_id: two current versions of one tab.
alter table spec_runs
  add constraint spec_runs_replaced_is_retired
  check (replaced_by_run_id is null or status = 'retired');
-- And a run cannot be its own successor.
alter table spec_runs
  add constraint spec_runs_replacement_is_another
  check (replaced_by_run_id is null or replaced_by_run_id <> id);

create index spec_records_retired_idx on spec_records (project_id, status);

-- ---- BOQ staged JSON: v2 -> v3 ------------------------------------------
-- Every sheet gains `replacesRunId: null` (a new run, which is what every
-- existing staged sheet is) and every line gains `replaces: null`. Adding the
-- keys now rather than treating absence as null: the reviewer's PATCH sets
-- them, and a shape where "not yet decided" and "decided: new" are the same
-- value cannot tell a reviewed sheet from an untouched one.
--
-- Rewriting a CONFIRMED run's `parsed` is safe for the reason 0007 gives:
-- after confirm it is display only, the records are the record of what
-- happened, and audit_log holds the previous value.
update intake_runs
set parsed = jsonb_set(
      jsonb_set(parsed, '{schemaVersion}', '3'::jsonb),
      '{sheets}',
      (
        select coalesce(jsonb_agg(
          sheet
          || jsonb_build_object('replacesRunId', null)
          || jsonb_build_object('lines', (
               select coalesce(jsonb_agg(line || jsonb_build_object('replaces', null)), '[]'::jsonb)
               from jsonb_array_elements(coalesce(sheet->'lines', '[]'::jsonb)) as line
             ))
        ), '[]'::jsonb)
        from jsonb_array_elements(parsed->'sheets') as sheet
      )
    )
where source_kind = 'boq_xlsx'
  and parsed is not null
  and parsed ? 'sheets'
  and coalesce((parsed->>'schemaVersion')::int, 0) = 2;

commit;
