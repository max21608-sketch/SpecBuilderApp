-- ==========================================================================
-- 0002_spec_model.sql — the specification record. M1.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY THIS SHAPE. Every decision below was forced by the pilot project's real
-- documents (AP346 ISG Maybourne Paris, P17231), not chosen for tidiness.
--
--  * THE CLIENT REF IS NOT A KEY. The same physical item is `SX12A` in the
--    BOQ, `FU-220-07` as a design code, `FX17` as a COS code and
--    `FU06C-CG27.2` as a compound in the costing sheet -- and `SX11A` appears
--    TWICE in the pilot BOQ with different quantities. So refs live in their
--    own table, many per record, and uniqueness is per RECORD, never per
--    project. A `unique (project_id, client_ref)` would have failed on the
--    first real import.
--
--  * A RECORD THEREFORE NEEDS A HUMAN-FACING NAME. With no unique ref, a
--    reviewer looking at two `SX11A` rows could only tell them apart by uuid,
--    and the M3 export would have no stable sort. `record_no` is allocated per
--    project at confirm and displayed as `P17231-014`.
--
--  * ANSWERS ARE KEYED ON THE QUESTION, NOT THE BWS FIELD. A person answers a
--    cheat-sheet question; the BWS spec field is where that answer later goes.
--    About half the cheat-sheet rows (TOE agreement, deposit confirmed, folder
--    set up) map to no BWS field at all, so they simply have a null
--    spec_field_id -- which makes them structurally incapable of reaching a
--    BWS export.
--
--  * NO `bws_job_number` COLUMN, DELIBERATELY. A record is quoted (BWQ) and
--    later converted (BENO); both need dates, and one ref can produce several
--    jobs (SX10 -> 5, SX11 -> 5 in the pilot pro-forma). It arrives as a ref
--    system here, or as a proper link table at M3. Do not "helpfully" add a
--    text column.
--
--  * GATES ARE NOT SEEDED. No cheat sheet mentions TG0/TG1/TG2 anywhere;
--    the assignment is an authoring task nobody has done. `required_at_gate`
--    exists and stays null rather than inventing data and attributing it to
--    the person who will have to live with it.
-- ==========================================================================

begin;

-- ---- projects -------------------------------------------------------------
create table projects (
  id                  uuid primary key default gen_random_uuid(),
  bws_project_number  text not null unique,          -- 'P17231'
  name                text not null,
  client              text,
  shared_inbox        text,
  -- TOE key dates drive the overdue flagging that M1 does NOT build: the
  -- pilot's dates are in the past (order 17/02/2026, delivery 17-Jun) so there
  -- is nothing live to compute against. Nullable until a real programme exists.
  order_date          date,
  specs_agreed_by     date,
  delivery_date       date,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          text,
  updated_by          text
);

-- ---- spec_fields: the BWS register, owned externally ----------------------
-- Columns AF-CI of the BWS job spec CSV export -- exactly 56 fields, verified
-- against the live export. CJ-DE are website/style fields and are NOT spec
-- fields; A-AE are job metadata.
--
-- json_id is the ONLY stable key. `column_letter` is positional: if BWS ever
-- inserts a column, every letter after it shifts while the ids do not. It is
-- kept for reading the export by eye and must never be joined on.
--
-- `name` is stored verbatim (one real field is `'Stone '`, with a trailing
-- space) and `name_norm` is what lookups compare, so a re-sync cannot create
-- `Stone` and `Stone ` as two fields. See the external-vocabulary-sync skill.
create table spec_fields (
  id             uuid primary key default gen_random_uuid(),
  json_id        integer not null unique,
  column_letter  text,
  name           text not null,
  name_norm      text not null unique,
  field_category text not null,                      -- Generic | Finishing | Upholstery Build | Hardware | Bed | BOM
  sort_order     integer not null,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text
);

-- ---- item_categories: the cheat sheets ------------------------------------
-- 17 categories in two families (9 upholstery, 8 cabinetry).
--
-- requirements_authored exists because of a counting trap: a category with an
-- empty requirement set scores answered/required = 0/0, which renders as 100%
-- complete. Cabinetry categories are deliberately created before their
-- requirements are agreed, so without this flag every cabinetry record would
-- read green on day one.
create table item_categories (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  family                 text not null,
  name                   text not null,
  requirements_authored  boolean not null default false,
  sort_order             integer not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             text,
  updated_by             text,
  constraint item_categories_family_check check (family in ('upholstery', 'cabinetry'))
);

-- ---- requirements: the cheat sheet as a checklist -------------------------
-- kind = 'spec_field'  -> answers land in a BWS spec field
-- kind = 'readiness'   -> project readiness question with no BWS field
--
-- The check below is load-bearing: a 'spec_field' requirement with a null
-- spec_field_id would silently vanish from the M3 export rather than failing
-- loudly.
create table requirements (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid not null references item_categories(id) on delete cascade,
  kind             text not null,
  spec_field_id    uuid references spec_fields(id) on delete restrict,
  prompt           text not null,                    -- the cheat sheet's own wording
  help_text        text,
  required_at_gate text,                             -- null until a human authors the gate model
  sort_order       integer not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  constraint requirements_kind_check check (kind in ('spec_field', 'readiness')),
  constraint requirements_kind_field_agree check ((kind = 'spec_field') = (spec_field_id is not null)),
  constraint requirements_category_sort_key unique (category_id, sort_order),
  -- Referenced by the composite foreign key on spec_answers below.
  constraint requirements_id_field_key unique (id, spec_field_id)
);

-- One BWS field may be asked for only once per category, or the export has no
-- rule for which answer wins. Partial: readiness rows all have a null field.
create unique index requirements_category_field_idx
  on requirements (category_id, spec_field_id)
  where spec_field_id is not null;

create index requirements_category_gate_idx on requirements (category_id, required_at_gate);

-- ---- intake_runs: staging for any document intake -------------------------
-- Deliberately generic rather than BOQ-shaped. src/lib/extraction-run.ts and
-- extraction-claim.ts already exist in this repo with no table behind them; a
-- BOQ-only staging table now would mean a second, differently shaped one when
-- AI extraction arrives, and therefore two confirm routes -- which the
-- review-and-confirm skill forbids outright.
--
-- Nothing operational is written from here. `parsed` holds the staged rows as
-- jsonb until a human confirms.
create table intake_runs (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects(id) on delete cascade,
  attachment_id         uuid,                        -- attachments is polymorphic and has no FK by design
  source_kind           text not null,               -- 'boq_xlsx' now; model-backed kinds later
  status                text not null default 'pending',
  parsed                jsonb,
  error                 text,
  model                 text,                        -- null for deterministic runs
  raw_response          jsonb,
  processing_started_at timestamptz,
  confirmed_at          timestamptz,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            text,
  updated_by            text,
  constraint intake_runs_source_kind_check check (source_kind in ('boq_xlsx')),
  constraint intake_runs_status_check check (status in ('pending', 'parsing', 'parsed', 'confirmed', 'failed'))
);

create index intake_runs_project_idx on intake_runs (project_id, created_at desc);

-- ---- spec_records ---------------------------------------------------------
-- One per BOQ line. category_id is NULLABLE on purpose: matching returns
-- `none` for descriptions the register cannot resolve ("Bench @entrance",
-- "Chair @ desk") and a guess is worse than a blank. The M3 export must refuse
-- to run for any record whose category is still null.
--
-- depth is capped at 1. Nothing in the evidence supports a split of a split,
-- and depth > 1 turns the completeness query into a recursive CTE and makes
-- the export ambiguous.
create table spec_records (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  record_no          integer not null,
  status             text not null default 'draft',
  category_id        uuid references item_categories(id) on delete restrict,
  item_description   text not null,                  -- the BOQ's own words, preserved
  product_reference  text,
  qty                integer,
  designer           text,
  area               text,
  parent_id          uuid references spec_records(id) on delete restrict,
  depth              smallint not null default 0,
  split_reason       text,
  source_import_id   uuid references intake_runs(id) on delete set null,
  source_line_no     integer,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         text,
  updated_by         text,
  constraint spec_records_project_no_key unique (project_id, record_no),
  constraint spec_records_status_check check (status in ('draft', 'active', 'retired')),
  constraint spec_records_depth_check check (depth in (0, 1)),
  constraint spec_records_parent_depth_agree check ((parent_id is null) = (depth = 0)),
  constraint spec_records_split_reason_check
    check (split_reason is null or split_reason in ('fabric', 'configuration')),
  constraint spec_records_split_reason_requires_parent
    check ((parent_id is null) = (split_reason is null))
);

create index spec_records_project_idx on spec_records (project_id);
create index spec_records_parent_idx on spec_records (parent_id) where parent_id is not null;
create index spec_records_category_idx on spec_records (category_id);

-- ---- spec_record_refs -----------------------------------------------------
-- Uniqueness is per RECORD, not per project: `SX11A` legitimately appears on
-- two different records in the pilot BOQ. ref_value_norm exists because
-- `FU06C-CG27.2` and `FU06C - CG27.2` are the same reference written twice.
-- project_id is denormalised so "find me SX11A" is one index hit.
create table spec_record_refs (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references spec_records(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  ref_system     text not null,
  ref_value      text not null,                      -- verbatim, as the document wrote it
  ref_value_norm text not null,
  source         text,                               -- which document this ref came from
  created_at     timestamptz not null default now(),
  created_by     text,
  constraint spec_record_refs_system_check
    check (ref_system in ('boq_code', 'design_code', 'cos_code', 'compound', 'bws_job')),
  constraint spec_record_refs_record_value_key unique (record_id, ref_system, ref_value_norm)
);

create index spec_record_refs_lookup_idx on spec_record_refs (project_id, ref_value_norm);

-- ---- spec_answers ---------------------------------------------------------
-- One row per record x requirement x revision.
--
-- state is FOUR distinct things and gate rules must read this column, never
-- test a string for emptiness:
--   confirmed - a human has settled it
--   tbc       - a human has actively said "not yet decided". This is an
--               ANSWER and it blocks a gate. It is not the absence of one.
--   missing   - nobody has looked
--   na        - does not apply to this item
--
-- value_raw preserves what the source document actually said when `value` is a
-- normalised or resolved form. Added now because a column added later cannot
-- distinguish "no raw captured" from "raw equalled value".
--
-- revision_no is 0 for everything M1 writes. It exists so that VE rounds --
-- which must hold the original spec and the alternative side by side -- do not
-- require a primary-key migration on the busiest table in the app.
--
-- The composite foreign key to (requirement_id, spec_field_id) makes a
-- mismatched denormalised field unrepresentable rather than trigger-policed.
-- It is not checked when spec_field_id is null (MATCH SIMPLE), which is
-- exactly right for readiness answers.
create table spec_answers (
  id             uuid primary key default gen_random_uuid(),
  record_id      uuid not null references spec_records(id) on delete cascade,
  requirement_id uuid not null references requirements(id) on delete restrict,
  spec_field_id  uuid references spec_fields(id) on delete restrict,
  revision_no    smallint not null default 0,
  value          text,
  value_raw      text,
  state          text not null default 'missing',
  source_kind    text not null default 'manual',
  source_id      uuid,                               -- attachment / message / intake_run, per source_kind
  confirmed_by   text,
  confirmed_at   timestamptz,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,
  constraint spec_answers_state_check check (state in ('confirmed', 'tbc', 'missing', 'na')),
  constraint spec_answers_source_kind_check check (source_kind in ('manual', 'document', 'email')),
  constraint spec_answers_confirmed_needs_actor
    check (state <> 'confirmed' or (value is not null and confirmed_by is not null and confirmed_at is not null)),
  constraint spec_answers_na_has_no_value check (state <> 'na' or value is null),
  constraint spec_answers_record_requirement_key unique (record_id, requirement_id, revision_no),
  constraint spec_answers_requirement_field_fk
    foreign key (requirement_id, spec_field_id) references requirements (id, spec_field_id)
);

create index spec_answers_record_idx on spec_answers (record_id);
create index spec_answers_record_state_idx on spec_answers (record_id, state);
create index spec_answers_outstanding_idx on spec_answers (record_id) where state in ('tbc', 'missing');

-- ---- attach updated_at + audit + version triggers -------------------------
-- The same block as 0001, re-run for the new tables. Note that 0001 attaches
-- set_updated_at to `users` ALONE -- copying its loop verbatim would give
-- these tables an audit trail and a stale updated_at.
do $$
declare t text;
begin
  foreach t in array array['projects', 'spec_fields', 'item_categories', 'requirements',
                           'intake_runs', 'spec_records', 'spec_record_refs', 'spec_answers'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
  end loop;

  -- spec_record_refs has no updated_at: a ref is written once and deleted, never edited.
  foreach t in array array['projects', 'spec_fields', 'item_categories', 'requirements',
                           'intake_runs', 'spec_records', 'spec_answers'] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before update on %I
                    for each row execute function set_updated_at()', t, t);
  end loop;

  -- Only the user-editable tables carry the optimistic lock.
  foreach t in array array['projects', 'intake_runs', 'spec_records', 'spec_answers'] loop
    execute format('drop trigger if exists %I_bump_version on %I', t, t);
    execute format('create trigger %I_bump_version before update on %I
                    for each row execute function bump_version()', t, t);
  end loop;
end $$;

commit;
