-- ==========================================================================
-- 0007_intake_batches_runs_attributes.sql — the intake stage, rebuilt around
-- what a tender pack actually is.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. M1 assumed one BOQ and one sheet; M2 assumed every extracted value
-- answers a cheat-sheet question. The AP364 pilot pack breaks both:
--
--  * THE BOQ HAS TABS, AND EACH TAB IS A SUB-QUOTE. `MUR` is the mock-up run,
--    `MAIN RUN` the real one, and a value-engineered run sits beside them. The
--    SAME item code appears in all three with DIFFERENT quantities. They are
--    not revisions of one another -- all three can be live, quoted and ordered
--    -- so they cannot be `spec_answers.revision_no` (that is for a VE
--    ALTERNATIVE to one answer, M6) and they cannot be separate projects (they
--    share a client, a programme and a document set). They are `spec_runs`,
--    and the app shows one tab each. parseBoqSheets read only the FIRST sheet
--    with a header and dropped the rest silently; that is the bug this table
--    exists to make impossible.
--
--  * A SHOP DRAWING DOES NOT ANSWER A QUESTION. Page 1 of the AP364 seating
--    drawings gives S-100 four dimensions, a fabric with a supplier reference,
--    and a wood finish. `spec_answers` cannot hold them: it is keyed on
--    (record, requirement, revision), one row per cheat-sheet question, the
--    question must belong to the record's category, and an item with no
--    category has no questions at all. Two fabrics on one page would collide
--    on the unique key; a dimension has a UNIT, which no answer column can
--    carry. Hence `record_attributes` -- multi-valued, requirement-free,
--    unit-carrying, pointing straight at a BWS spec field.
--
--  * THE PREAMBLE IS PROJECT-LEVEL, NOT ITEM-LEVEL. It states flameproofing
--    standards, tagging rules, tolerance and finish procedures that apply to
--    everything. `project_notes` holds them so the overview can show them.
--    NOT the chassis `notes` table: that one is append-only by trigger, and a
--    mis-extracted note would then be uncorrectable forever.
--
--  * DOCUMENTS ARRIVE AS A SET. A preamble, a BOQ and a drawing pack are one
--    delivery and are read in that order. `intake_batches` groups the runs so
--    the screen can say "this pack" rather than three unrelated uploads.
--
-- WHAT THIS REVERSES. 0002's header says the export must refuse a record with
-- no category. It no longer does, and confirm no longer blocks on one. Intake
-- must not stall behind a classification decision that belongs to a later
-- stage: an uncategorised record simply has no checklist yet and says so.
-- 0002 cannot be edited, so the reversal is recorded here.
--
-- NEW DOCUMENT KINDS GO UNDER source_kind = 'spec_document', NOT beside it.
-- The whole claim protocol -- the fenced worker UPDATE, intake_runs_attempt_
-- shape_check, the extract route -- is keyed on that value. A new source_kind
-- would silently opt drawings out of every one of those guards.
--
-- boq_revision / boq_date ARE TEXT. A BOQ header says "Revision: 0" and
-- "Date: 14-Sep-26" in whatever format the client's template used. Parsing
-- that into a `date` would hit the same trap as the TOE dates (both drivers
-- read a `date` as LOCAL midnight and toISOString() then renders the day
-- before it in British Summer Time) for a value nothing computes with.
-- ==========================================================================

begin;

-- ---- spec_runs: a sub-quote, normally one BOQ tab -------------------------
create table spec_runs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  -- The reviewer's name for it, defaulted from the sheet name and editable at
  -- review: a tab called "Sheet1" or "MUR" is not what anyone calls the run.
  name              text not null,
  source_sheet      text,
  source_import_id  uuid references intake_runs(id) on delete set null,
  boq_revision      text,
  boq_date          text,
  -- The rows above the header: "Revision: 0", "*All fabrics are COM and should
  -- not be included in the unit costs". Retained verbatim as an array of
  -- strings -- they are the run's terms, and nobody can re-check a value whose
  -- source caveats were thrown away at parse time.
  header_notes      jsonb not null default '[]'::jsonb,
  sort_order        integer not null default 0,
  status            text not null default 'active',
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,
  updated_by        text,

  constraint spec_runs_name_not_blank check (btrim(name) <> ''),
  constraint spec_runs_status_check check (status in ('active', 'retired')),
  constraint spec_runs_header_notes_is_array check (jsonb_typeof(header_notes) = 'array'),
  -- The target of spec_records' composite FK below, which is what stops a
  -- record being filed under another project's run.
  constraint spec_runs_id_project_key unique (id, project_id)
);

create index spec_runs_project_idx on spec_runs (project_id, sort_order, created_at);

-- NO unique on (project_id, name). Re-uploading a revised BOQ legitimately
-- produces a second "MAIN RUN"; retiring the old one is how it leaves the
-- tabs. A unique name would force a destructive edit at exactly the moment
-- the two versions need to be comparable.

-- ---- spec_records: which run a line belongs to ----------------------------
alter table spec_records add column run_id       uuid;
-- The BOQ's own grouping word ("Seating", "Furniture"). M1 wrote it into
-- `area` because there was no Area column in the pilot BOQ; AP364 has both, so
-- they stop sharing a column and the grouping word keeps its own.
alter table spec_records add column boq_category text;

-- Backfill: one run per confirmed import, not one per project. The SharePoint
-- survey found TWO BOQs on the pilot (TA and LCS); records from two imports are
-- two runs, and merging them would produce an export that claims to be one
-- complete dataset while being two half ones.
insert into spec_runs (project_id, name, source_sheet, source_import_id, sort_order, created_by, updated_by)
select
  r.project_id,
  'Run ' || row_number() over (partition by r.project_id order by min(r.record_no)),
  max(i.parsed->>'sheet'),
  r.source_import_id,
  row_number() over (partition by r.project_id order by min(r.record_no)),
  'migration:0007',
  'migration:0007'
from spec_records r
left join intake_runs i on i.id = r.source_import_id
group by r.project_id, r.source_import_id;

update spec_records r
set run_id = run.id
from spec_runs run
where run.project_id = r.project_id
  and run.source_import_id is not distinct from r.source_import_id
  and r.run_id is null;

do $$
declare orphan text;
begin
  select string_agg(id::text, ', ') into orphan from spec_records where run_id is null;
  if orphan is not null then
    raise exception 'spec_records with no run after backfill: %', orphan;
  end if;
end $$;

alter table spec_records alter column run_id set not null;

-- A record with no run is on no tab and in no export scope -- invisible in
-- exactly the way the `unclassified` proposal diagnostic exists to prevent.
alter table spec_records add constraint spec_records_run_same_project
  foreign key (run_id, project_id) references spec_runs (id, project_id) on delete restrict;

create index spec_records_run_idx on spec_records (project_id, run_id, record_no);

-- ---- intake_batches: one delivery of documents ----------------------------
create table intake_batches (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  label       text,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text
);

create index intake_batches_project_idx on intake_batches (project_id, created_at desc);

-- NO status column. A batch's state is whatever its runs are, and those move
-- independently (a preamble can be confirmed while drawings are still queued).
-- A stored batch status would be a second copy of that truth, wrong from the
-- first transition nobody remembered to mirror.

alter table intake_runs add column batch_id uuid references intake_batches(id) on delete restrict;
create index intake_runs_batch_idx on intake_runs (batch_id) where batch_id is not null;

-- ---- the two new document kinds -------------------------------------------
-- `preamble` and `shop_drawings` read as different documents entirely: one is
-- project-level prose, the other is per-item geometry and finishes. Each gets
-- its own static prompt and its own tool schema, which is why the kind is a
-- vocabulary value rather than a flag.
alter table intake_runs drop constraint if exists intake_runs_document_kind_check;
alter table intake_runs add constraint intake_runs_document_kind_check check (
  case source_kind
    when 'spec_document' then document_kind in
      ('ffe_schedule', 'spec_bible', 'finishes_schedule', 'fabric_schedule',
       'preamble', 'shop_drawings', 'other')
    else document_kind is null
  end
);

-- ---- record_attributes: what a drawing actually says about an item --------
create table record_attributes (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references spec_records(id) on delete cascade,
  attr_group     text not null,
  -- The drawing's own word: "SOFA", "SOFA FEET", "Width", "PIPING". Kept
  -- because it is how the reviewer recognises the line on the page.
  label          text not null,
  value          text,
  -- Dimensions only. The AP364 drawings print 190/79/72 for a sofa (cm) and
  -- 550/735 for a chair (mm) and state the unit on NEITHER page, so this is a
  -- human decision presented as a choice, never a guess written into a value.
  unit           text,
  -- The client's own finish code: CH-01.1, WD-01, MT-01, UPH-07. Held as text
  -- on purpose: resolving these to a materials register is a later milestone,
  -- and a code nobody has resolved yet is still worth keeping verbatim.
  material_code  text,
  -- Where this lands in a BWS export. The COM slot IS this column: fabric 1 ->
  -- 'COM 1', fabric 2 -> 'COM 2'. Nullable, because an observation with no BWS
  -- home is still worth recording against the item.
  spec_field_id  uuid references spec_fields(id) on delete restrict,
  state          text not null default 'confirmed',
  source_run_id  uuid references intake_runs(id) on delete set null,
  source_page    integer,
  sort_order     integer not null default 0,
  status         text not null default 'active',
  retired_at     timestamptz,
  retired_by     text,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,

  constraint record_attributes_group_check
    check (attr_group in ('dimension', 'material', 'finish', 'hardware', 'note', 'other')),
  constraint record_attributes_label_not_blank check (btrim(label) <> ''),
  -- 'tbc' means a human read "PIPING  TBC" on the drawing and recorded that the
  -- client has not decided. It is an observation, not an empty cell, and it
  -- must survive to the export as TBC rather than as a blank.
  constraint record_attributes_state_check check (state in ('confirmed', 'tbc')),
  constraint record_attributes_confirmed_has_value
    check (state <> 'confirmed' or value is not null),
  constraint record_attributes_status_check check (status in ('active', 'retired')),
  constraint record_attributes_retired_has_actor
    check (status <> 'retired' or (retired_at is not null and retired_by is not null)),
  constraint record_attributes_unit_is_dimension
    check (unit is null or attr_group = 'dimension'),
  constraint record_attributes_unit_check
    check (unit is null or unit in ('mm', 'cm', 'm', 'in'))
);

-- One BWS field, one value. Two fabrics on a page must BOTH survive -- so
-- nothing here is unique on `label` -- but they cannot both be COM 1, and a
-- second attribute quietly claiming an occupied slot is how an export loses a
-- value with no error anywhere. Dimensions are exempt: many of them compose
-- into the single `Dimensions` field by design.
create unique index record_attributes_field_slot_key
  on record_attributes (record_id, spec_field_id)
  where spec_field_id is not null and attr_group <> 'dimension' and status = 'active';

create index record_attributes_record_idx on record_attributes (record_id, status, sort_order);
create index record_attributes_source_idx on record_attributes (source_run_id) where source_run_id is not null;

-- ---- project_notes: the preamble, kept where it can be read ---------------
create table project_notes (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  topic          text,
  title          text,
  body           text not null,
  source_run_id  uuid references intake_runs(id) on delete set null,
  source_page    integer,
  sort_order     integer not null default 0,
  status         text not null default 'active',
  retired_at     timestamptz,
  retired_by     text,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,

  constraint project_notes_body_not_blank check (btrim(body) <> ''),
  constraint project_notes_status_check check (status in ('active', 'retired')),
  constraint project_notes_retired_has_actor
    check (status <> 'retired' or (retired_at is not null and retired_by is not null))
);

create index project_notes_project_idx on project_notes (project_id, status, sort_order, created_at);

-- ---- BOQ staged JSON: v1 -> v2 --------------------------------------------
-- v1 staged one sheet as `{sheet, headerRow, lines, …}`. v2 stages a LIST of
-- sheets. Upgrading in place rather than teaching the code both shapes: a
-- reader that supports two staged formats is a reader whose second format is
-- exercised once a year and is wrong when it is.
--
-- Rewriting a CONFIRMED run's `parsed` is safe -- after confirm it is display
-- only, the records are the record of what happened, and audit_log holds the
-- previous value. A run still awaiting review keeps every line and its
-- reviewer's category choices, at the same index, so an open tab's PATCH
-- addresses still resolve.
update intake_runs
set parsed = jsonb_build_object(
      'schemaVersion', 2,
      'filename', parsed->'filename',
      'sourcePreserved', coalesce(parsed->'sourcePreserved', 'true'::jsonb),
      'sheets', jsonb_build_array(jsonb_build_object(
        'sheetName', parsed->>'sheet',
        'proposedRunName', coalesce(parsed->>'sheet', 'Main run'),
        'headerRow', parsed->'headerRow',
        'skippedRows', coalesce(parsed->'skippedRows', '0'::jsonb),
        'ignored', false,
        'metadata', jsonb_build_object('revision', null, 'date', null, 'notes', '[]'::jsonb),
        'lines', coalesce(parsed->'lines', '[]'::jsonb)
      ))
    )
where source_kind = 'boq_xlsx'
  and parsed is not null
  and parsed ? 'lines';

-- ---- triggers -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['spec_runs', 'intake_batches', 'record_attributes', 'project_notes'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);

    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);

    execute format('drop trigger if exists %I_bump_version on %I', t, t);
    execute format('create trigger %I_bump_version before update on %I
                    for each row execute function bump_version()', t, t);
  end loop;
end $$;

commit;
