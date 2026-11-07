-- ==========================================================================
-- 0060_spec_record_twins.sql -- one item on two bill lines, linked so a spec
-- recorded on one is OFFERED to the other.
--
-- WHY (Max, 2026-10-12). "GR-FUR-13 and PL-FUR-13 are the same item on two
-- lines (Guest Suites and Ambassador Suite). Keep them as separate lines in
-- case one changes, but link them better, so a spec is added to both at
-- once." The spec-change audit (2026-10-23, finding 9) found the cost of not
-- having it: every fix to one of the two is made twice, or missed once. The
-- plan is docs/plans/twin-lines-2026-11-06.md.
--
-- ---- WHAT A TWIN IS NOT ----------------------------------------------------
--
-- Not a configuration (0024: one line split into things that differ by a
-- cloth), not a pairing (0017: a revised line continuing an old record), and
-- not a merge. The two lines stay two records with their own quantity, area,
-- client ref, export row and specs. The link carries NO value: every spec is
-- still one row per record with its own provenance, which is why nothing that
-- reads specs (the export, the gates, TGQ, the chase, the history) reads this
-- table. It only decides which records one person's act is OFFERED on.
--
-- ---- THE SHAPE -------------------------------------------------------------
--
-- One row per UNORDERED pair, so "are A and B twins" is one lookup either
-- way: the expression unique index on (least, greatest) is what makes (A, B)
-- and (B, A) the same row. Three stools in three suites are three pairs, not
-- a group: a group would need a name nobody has, and a person can retire one
-- pair without the other two.
--
-- The index covers RETIRED rows too. A wrong link is retired with a reason
-- and linking the same two again RESTORES that row (`linkTwins`), so the
-- history of one pair is one row rather than a stack of them.
--
-- Both records are BILL LINES of the link's project (`parent_id is null`).
-- A configuration reaches its parent's twins through `parent_id`, as it
-- reaches its client ref and its quantity. That is cross-row, so it is a
-- trigger and not a CHECK.
--
-- Retired, never deleted (house/data-safety.md). The cascades are only for a
-- project or record delete, which takes the link with what it links.
--
-- ---- THE KIND CHECK IS RE-LISTED IN FULL, FROM THE LIVE TEXT ---------------
--
-- Read with pg_get_constraintdef on the LOCAL stack at 0059 on 2026-11-07; it
-- equals 0046's list exactly (0047 to 0059 do not re-list it). The 0032
-- lesson: a stale copy deletes values. Two kinds are added, both reason
-- required: a link is a statement that two lines are ONE item, and an unlink
-- says they are not, and each overrides how the bill listed them.
-- tests/db/vocabulary-sync.test.ts holds CHANGE_SET_KINDS,
-- REASON_REQUIRED_KINDS and TWIN_STATUSES to these constraints.
-- ==========================================================================
begin;

create table spec_record_twins (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  record_a uuid not null references spec_records(id) on delete cascade,
  record_b uuid not null references spec_records(id) on delete cascade,
  -- Why a person (or an accepted bill-review suggestion) says these are one
  -- item: "same stool, Guest Suites and Ambassador Suite".
  reason text not null,
  status text not null default 'active',
  retired_at timestamptz,
  retired_by text,
  retire_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  constraint spec_record_twins_not_self check (record_a <> record_b),
  constraint spec_record_twins_reason_not_blank check (btrim(reason) <> ''),
  constraint spec_record_twins_status_check check (status in ('active', 'retired')),
  constraint spec_record_twins_retired_has_actor
    check ((status = 'retired') = (retired_at is not null and retired_by is not null)),
  constraint spec_record_twins_retired_has_reason
    check (status <> 'retired' or (retire_reason is not null and btrim(retire_reason) <> ''))
);

create unique index spec_record_twins_pair_key
  on spec_record_twins (least(record_a, record_b), greatest(record_a, record_b));
create index spec_record_twins_record_a_idx on spec_record_twins (record_a);
create index spec_record_twins_record_b_idx on spec_record_twins (record_b);
create index spec_record_twins_project_idx on spec_record_twins (project_id);

comment on table spec_record_twins is
  'Two bill lines that are one item to make (0060). Carries no value: it only decides which records one act is offered on. Symmetric, one row per unordered pair; retired, never deleted.';

-- BOTH ENDS ARE BILL LINES OF THE LINK'S PROJECT. A configuration carries its
-- parent's twins, so a link onto one would be a second, contradicting route
-- to the same item; a link across projects is a link between two different
-- finishes libraries' worth of meaning.
create or replace function spec_record_twins_check_ends() returns trigger
language plpgsql as $$
declare
  bad integer;
begin
  select count(*) into bad
    from spec_records r
   where r.id in (new.record_a, new.record_b)
     and (r.project_id <> new.project_id or r.parent_id is not null);
  if bad > 0 then
    raise exception 'A twin links two bill lines of one project (configurations carry their bill line''s twins).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger spec_record_twins_ends before insert or update of record_a, record_b, project_id on spec_record_twins
  for each row execute function spec_record_twins_check_ends();
create trigger spec_record_twins_audit after insert or update or delete on spec_record_twins
  for each row execute function write_audit();
create trigger spec_record_twins_updated_at before update on spec_record_twins
  for each row execute function set_updated_at();
create trigger spec_record_twins_version before update on spec_record_twins
  for each row execute function bump_version();

-- ---- change-set kinds ------------------------------------------------------
alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check
  check (kind in (
    'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
    'spec_document_confirm', 'preamble_confirm', 'manual_edit',
    'attribute_retire', 'category_set', 'level_set', 'finish_edit',
    'finish_link', 'finish_unlink', 'baseline', 'history_begins',
    'email_confirm', 'run_create', 'record_create', 'attribute_create',
    'attribute_correct', 'record_retire', 'record_restore', 'standard_set',
    'standard_agreed', 'standard_change', 'mockup_add', 'disagreement_resolve',
    'twin_link', 'twin_unlink'
  ));

alter table change_sets drop constraint change_sets_reason_required;
alter table change_sets add constraint change_sets_reason_required
  check (
    kind not in (
      'attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink',
      'baseline', 'attribute_correct', 'record_retire', 'standard_change',
      'disagreement_resolve', 'twin_link', 'twin_unlink'
    )
    or (reason is not null and btrim(reason) <> '')
  );

commit;
