-- ==========================================================================
-- 0046_attribute_disagreements.sql -- a second document that DISAGREES with
-- the bill is kept beside it, not instead of it, and flagged until a person
-- decides.
--
-- WHY (Max, 2026-10-05, reading the Aman pack). The pack's OMS & FF&E Tracker
-- lists the furniture again, dated 24 Aug, and in places says something
-- different from the bill: the bill's GR-FUR-04 desk chair is bespoke at
-- W21" x D24" x SH16" in smoked oak, the tracker's is a WEWOOD Caravela at
-- W540 x D610 x SH430 mm in TAELAMADEUS 0855. His instruction: "it needs to
-- take in both ... keep them separate ... highlight them in red ... flag it up
-- somewhere ... keep whatever's in the BOQ to begin with."
--
-- Until now a spec document's value over a held one had two outcomes: tick
-- "replace" (the bill's value is retired) or ignore the row (the document's
-- statement is lost). Neither keeps both. The bill's value staying live while
-- the other document's statement is recorded beside it is a third outcome,
-- and it needs somewhere to live.
--
-- ---- A SIDE TABLE, NOT A THIRD STATUS ON record_attributes ----------------
--
-- `record_attributes` is read by some fifty files, and every one of them
-- assumes that a row which is not retired is the value: the export, the
-- composed cells, the gates, the checklist promotion, the finishes library.
-- A third status would have to be excluded in each of them, and the one that
-- forgot would ship the tracker's width to BWS beside the bill's. A side table
-- is invisible to all of them by construction. The disagreeing statement is
-- copied in the attribute's own shape (group, slot, field, label, value, unit,
-- code, state) so that USING it later is an ordinary supersession that keeps
-- the document and page it came from.
--
-- ---- WHAT IT IS NOT -------------------------------------------------------
--
-- Not spec content. Recording a disagreement changes no value, so it takes no
-- record version and `tests/db/change-history.test.ts` does not list it as a
-- spec-content table. RESOLVING one by using the other document's value DOES
-- change the value: that writes `record_attributes` through the existing
-- supersession and takes a version as every correction does.
--
-- ---- RESOLUTION -----------------------------------------------------------
--
--   open        recorded, the held value stands, the screens show it in red.
--   kept_held   a person decided the held value is right. Reason required.
--   used_this   a person put this value in place of the held one. Reason
--               required; `resolved_attribute_id` is the new active row.
--
-- One OPEN disagreement per (held value, document): re-confirming the same
-- card, or re-matching it, must not stack copies of one statement.
-- ==========================================================================
begin;

create table attribute_disagreements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  record_id uuid not null references spec_records(id) on delete cascade,
  -- The live value this statement disagrees with. Cascade: if the held row
  -- is ever deleted (only by a project or record delete) the comparison has
  -- nothing left to compare.
  held_attribute_id uuid not null references record_attributes(id) on delete cascade,
  source_run_id uuid references intake_runs(id) on delete set null,
  source_page integer,
  -- The statement, in record_attributes' own shape.
  attr_group text not null,
  label text not null,
  value text,
  unit text,
  dimension_slot text,
  spec_field_id uuid references spec_fields(id) on delete restrict,
  material_code text,
  state text not null default 'confirmed',
  status text not null default 'open',
  resolved_at timestamptz,
  resolved_by text,
  resolved_attribute_id uuid references record_attributes(id) on delete set null,
  change_set_id uuid references change_sets(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  constraint attribute_disagreements_group_check
    check (attr_group in ('dimension', 'material', 'finish', 'hardware', 'note', 'other')),
  constraint attribute_disagreements_label_not_blank check (btrim(label) <> ''),
  constraint attribute_disagreements_state_check check (state in ('confirmed', 'tbc')),
  constraint attribute_disagreements_unit_check
    check (unit is null or unit in ('mm', 'cm', 'm', 'in')),
  constraint attribute_disagreements_dimension_slot_check
    check (dimension_slot is null or dimension_slot in ('W', 'D', 'H', 'SH', 'DIA')),
  constraint attribute_disagreements_dimension_has_slot
    check ((attr_group = 'dimension') = (dimension_slot is not null)),
  constraint attribute_disagreements_status_check
    check (status in ('open', 'kept_held', 'used_this')),
  constraint attribute_disagreements_resolved_has_actor
    check ((status = 'open') = (resolved_at is null and resolved_by is null)),
  constraint attribute_disagreements_used_has_attribute
    check (status <> 'used_this' or resolved_attribute_id is not null)
);

create unique index attribute_disagreements_one_open
  on attribute_disagreements (held_attribute_id, source_run_id)
  where status = 'open';
create index attribute_disagreements_record_idx on attribute_disagreements (record_id);
create index attribute_disagreements_project_open_idx
  on attribute_disagreements (project_id) where status = 'open';

create trigger attribute_disagreements_audit after insert or update or delete on attribute_disagreements
  for each row execute function write_audit();
create trigger attribute_disagreements_updated_at before update on attribute_disagreements
  for each row execute function set_updated_at();
create trigger attribute_disagreements_version before update on attribute_disagreements
  for each row execute function bump_version();

-- ---- change-set kinds ------------------------------------------------------
-- Re-listed IN FULL from the LIVE constraints of 2026-10-05 (the 0032 lesson:
-- a stale copy deletes values), adding one kind. `disagreement_resolve` is a
-- person settling a disagreement either way, and it always says why.
alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check
  check (kind in (
    'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
    'spec_document_confirm', 'preamble_confirm', 'manual_edit',
    'attribute_retire', 'category_set', 'level_set', 'finish_edit',
    'finish_link', 'finish_unlink', 'baseline', 'history_begins',
    'email_confirm', 'run_create', 'record_create', 'attribute_create',
    'attribute_correct', 'record_retire', 'record_restore', 'standard_set',
    'standard_agreed', 'standard_change', 'mockup_add', 'disagreement_resolve'
  ));

alter table change_sets drop constraint change_sets_reason_required;
alter table change_sets add constraint change_sets_reason_required
  check (
    kind not in (
      'attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink',
      'baseline', 'attribute_correct', 'record_retire', 'standard_change',
      'disagreement_resolve'
    )
    or (reason is not null and btrim(reason) <> '')
  );

commit;
