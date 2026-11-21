-- ==========================================================================
-- 0062_question_audience.sql -- who a question is FOR, how a client reads it,
-- and whether it is answered once for an area; the customer's own material on
-- a finish; and a project's "ask the client" for one question.
--
-- WHY. Max, 2026-11-20 (docs/plans/chase-decisions-2026-11-20.md D, E, C, F):
-- the first chase on the test tender sent a designer "Project sold with metal
-- finish or metal paint effect?", BWS field names beside every question, and
-- "Indoor / Outdoor" once per item. Four things the schema could not say:
--
-- 1. WHO A QUESTION GOES TO. "Chaseable" was `kind = 'spec_field'` (decision
--    19), which is a statement about BWS -- does the answer have a column --
--    and not about the person. The TOE agreement is a readiness question for
--    the CAM; "Floor plans" is a readiness question for the client; "Assembly
--    guide" fills a BWS field and is ours. `requirements.audience` is
--    in_house | cam | client, seed data like the rest of the cheat sheet
--    (db/seed/0015). THIS FILE SETS IT FROM `kind`, so between this migration
--    and that seed every reading of "chaseable" is exactly what it was:
--    readiness is in-house, a spec field is the client's. Order: migrate,
--    deploy, seed.
--
-- 2. HOW A CLIENT READS IT. "COM 1" is the prompt on fifteen sheets and is the
--    BWS name itself; "Main metal finish" is ours. `client_prompt` is the
--    wording an external recipient sees. It is NOT the prompt: rewording a
--    prompt would stale every unsent chase draft (the snapshot froze it) and
--    is refused by 0057's trigger on an answered question.
--
-- 3. ONCE PER AREA. `answer_scope` = item | area. Project scope is not here:
--    it is the cheat sheet's "Project / commercial" SECTION, read by the
--    project-wide mechanism since 2026-10-12, and a second spelling of it is
--    how TGQ came to mean four numbers.
--
-- 4. WHAT THE EMAIL ASKED IN WORDS. `email_draft_items.asked_as` and
--    `.answer_scope` are columns BESIDE the coverage snapshot, null on every
--    existing row (the 0020 tier pattern): a field added to `context_snapshot`
--    makes every unsent draft read as stale the moment it ships -- the
--    chased_at trap.
--
-- And two that are the same trap from the other side:
--
-- 5. `project_question_routes`: a CAM who does not know an answer marks the
--    question "ask the client" for THIS project. A side table, never a column
--    on `spec_answers` (bump_version would fire and stale every snapshot
--    taken against the answer) and never a write to `requirements` (one
--    project's decision is not the cheat sheet's). No version: a row is a
--    decision that exists or does not, and moving it back DELETES it, which
--    the audit trigger records.
--
-- 6. `project_finishes.customer_supplied`: whether a fabric is the customer's
--    own material. The quote prints COM: for it and FABRIC: otherwise. The BWS
--    file is unchanged -- its column is called COM 1 and stays that.
--
-- Additive. Apply BEFORE the code that reads it.
-- ==========================================================================
begin;

alter table requirements add column audience text not null default 'client';
alter table requirements add constraint requirements_audience_check
  check (audience in ('in_house', 'cam', 'client'));
-- Today's reading, exactly: a readiness question was never chased.
update requirements set audience = 'in_house' where kind = 'readiness';

alter table requirements add column client_prompt text;
alter table requirements add constraint requirements_client_prompt_not_blank
  check (client_prompt is null or btrim(client_prompt) <> '');

alter table requirements add column answer_scope text not null default 'item';
alter table requirements add constraint requirements_answer_scope_check
  check (answer_scope in ('item', 'area'));

comment on column requirements.audience is
  'Who this question is for (0062): in_house (ours, never sent), cam (the CAM''s fill-in), client (may be put in a chase). Seed data (db/seed/0015).';
comment on column requirements.client_prompt is
  'The wording an EXTERNAL chase prints instead of the prompt (0062). Null prints the prompt. Never the prompt itself: rewording that stales every unsent draft.';
comment on column requirements.answer_scope is
  'item, or area: answered once for every item in one area (0062). Project-wide is the section, not this.';

alter table email_draft_items add column asked_as text;
alter table email_draft_items add column answer_scope text;
alter table email_draft_items add constraint email_draft_items_answer_scope_check
  check (answer_scope is null or answer_scope in ('item', 'area'));
comment on column email_draft_items.asked_as is
  'The client wording this line was asked in, frozen at generation (0062). Null on a line asked by its prompt, and on every line written before 0062. Outside context_snapshot on purpose.';

alter table project_finishes add column customer_supplied boolean not null default false;
comment on column project_finishes.customer_supplied is
  'The customer''s own material (0062): the quote prints COM: for a fabric linked here, FABRIC: otherwise. The BWS file is not affected.';

create table project_question_routes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- `questionGroupKey` (src/lib/chase-grouping.ts): field:<json_id>,
  -- local:<key> or prompt:<folded words>. Per project, across categories --
  -- "TOE agreement" is seventeen requirement rows and one question.
  question_key text not null,
  audience text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  constraint project_question_routes_audience_check check (audience in ('in_house', 'cam', 'client')),
  constraint project_question_routes_key_not_blank check (btrim(question_key) <> ''),
  constraint project_question_routes_project_key unique (project_id, question_key)
);

comment on table project_question_routes is
  'One question moved to another audience for one project (0062): a CAM''s "ask the client". Deleted to move it back; the audit trigger keeps both.';

create trigger project_question_routes_audit after insert or update or delete on project_question_routes
  for each row execute function write_audit();
create trigger project_question_routes_updated_at before update on project_question_routes
  for each row execute function set_updated_at();

commit;
