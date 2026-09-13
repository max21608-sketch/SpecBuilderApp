-- ==========================================================================
-- 0006_model_backed_intake.sql — M2: reading a specification document with a
-- model, and owning the attempt that does it.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY. Every answer in this app is typed by hand, while the FF&E schedules and
-- spec bibles that contain many of them sit in SharePoint. M2 reads one of
-- those documents and STAGES what it found; a human confirms each proposal into
-- spec_answers, exactly as the BOQ review already works.
--
-- ONE STAGING TABLE, NOT TWO. This extends intake_runs rather than adding a
-- `document_extractions` table beside it. Two staging tables mean two confirm
-- routes, and the review-and-confirm skill forbids that outright: the second
-- one is always the one that forgets a guard. intake_runs was written generic
-- for exactly this (`parsed jsonb`, `model`, `raw_response`), and 0002 says so.
--
-- ONE NEW STATUS, NOT THREE. The lifecycle becomes
--   pending -> queued -> parsing -> parsed -> confirmed,  plus failed
-- `parsing` is already the in-flight value and `parsed` the staged one. Adding
-- `processing`/`extracted` alongside them would give one table two vocabularies
-- for one lifecycle, and every query would have to know both.
--
-- WHY attempt_id AND claim_token, WHICH LOOK REDUNDANT. They are not.
--
--   attempt_id  identifies a logical attempt. The producer sets it, the queue
--               message carries it, and it is what stops an old delivery from
--               clobbering a newer attempt's row.
--   claim_token identifies ONE WORKER INVOCATION inside that attempt. A worker
--               that is hard-killed leaves a claim that eventually expires; a
--               later delivery reclaims the same attempt_id with a NEW token.
--               If the killed invocation was not actually dead — just slow, its
--               request still in flight — its writes would otherwise land on
--               top of the live worker's. Fencing every write on BOTH is what
--               makes those writes affect zero rows.
--
-- There is NO exactly-once billing guarantee here and nothing in this schema
-- pretends otherwise: an ambiguous failure can cost a second model call. See
-- docs/stack.md.
-- ==========================================================================

begin;

-- ---- intake_runs: the vocabulary -----------------------------------------
alter table intake_runs drop constraint if exists intake_runs_source_kind_check;
alter table intake_runs add constraint intake_runs_source_kind_check
  check (source_kind in ('boq_xlsx', 'spec_document'));

alter table intake_runs drop constraint if exists intake_runs_status_check;
alter table intake_runs add constraint intake_runs_status_check
  check (status in ('pending', 'queued', 'parsing', 'parsed', 'confirmed', 'failed'));

-- What KIND of specification document this is. Required for spec_document and
-- forbidden for a BOQ, because it selects the prompt: an FF&E schedule and a
-- spec bible are read for different things, and a BOQ is not read by a model at
-- all. DECLARED at upload, never inferred from the file extension — an XLSX
-- FF&E schedule must not reach the BOQ parser because both end in .xlsx.
alter table intake_runs add column if not exists document_kind text;

alter table intake_runs drop constraint if exists intake_runs_document_kind_check;
alter table intake_runs add constraint intake_runs_document_kind_check check (
  case source_kind
    when 'spec_document' then document_kind in
      ('ffe_schedule', 'spec_bible', 'finishes_schedule', 'fabric_schedule', 'other')
    else document_kind is null
  end
);

-- ---- intake_runs: attempt ownership --------------------------------------
alter table intake_runs add column if not exists attempt_id           uuid;
alter table intake_runs add column if not exists claim_token          uuid;
alter table intake_runs add column if not exists queued_at            timestamptz;
alter table intake_runs add column if not exists attempt_deadline_at  timestamptz;
alter table intake_runs add column if not exists claim_count          integer not null default 0;
alter table intake_runs add column if not exists model_metadata       jsonb;

-- The producer's idempotency key. A client generates it once per user action
-- and reuses it across retries, so a lost response cannot create a second
-- logical attempt (and therefore a second paid model call). Unique where
-- present; null for every BOQ run and for runs created before this migration.
alter table intake_runs add column if not exists registration_request_id text;
create unique index if not exists intake_runs_registration_request_key
  on intake_runs (registration_request_id) where registration_request_id is not null;

-- Status shape, scoped to spec_document ONLY. A BOQ import goes straight to
-- `parsing` inline in its own request and has no queue fields at all; a
-- constraint that demanded an attempt id for every `parsing` row would break
-- the M1 import on the next upload.
alter table intake_runs drop constraint if exists intake_runs_attempt_shape_check;
alter table intake_runs add constraint intake_runs_attempt_shape_check check (
  source_kind <> 'spec_document'
  or (
    case status
      when 'queued'  then attempt_id is not null and queued_at is not null
      when 'parsing' then attempt_id is not null and claim_token is not null
                          and processing_started_at is not null
      else true
    end
  )
);

create index if not exists intake_runs_attempt_idx on intake_runs (attempt_id) where attempt_id is not null;

-- ---- requirement_aliases --------------------------------------------------
-- The words a real document uses for a cheat-sheet question, mirroring
-- item_category_aliases.
--
-- The precedent is decision 10 in docs/plans/README.md: category aliases took
-- BOQ matching from 5/59 to 56/59, where LOWERING THE CUTOFF would instead have
-- turned "no match" into "confidently wrong". The same rule applies here. A
-- document says "Leg finish"; the cheat sheet asks "What is the frame/leg
-- finish?". Those share one word. Add the alias; do not weaken matchName.
--
-- Unique per REQUIREMENT, not globally: "Finish" legitimately means different
-- questions on different categories, and a global unique term would let the
-- first category that claimed the word own it everywhere.
--
-- Seed only from verified pilot wording. An invented alias is a confident wrong
-- match wearing a seed file's authority.
create table if not exists requirement_aliases (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements(id) on delete cascade,
  term           text not null,
  term_norm      text not null,
  created_at     timestamptz not null default now(),
  created_by     text,
  constraint requirement_aliases_term_key unique (requirement_id, term_norm)
);

create index if not exists requirement_aliases_term_idx on requirement_aliases (term_norm);

do $$
declare t text;
begin
  foreach t in array array['requirement_aliases'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function write_audit()', t, t);
  end loop;
end $$;

commit;
