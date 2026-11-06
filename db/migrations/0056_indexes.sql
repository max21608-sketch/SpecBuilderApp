-- ==========================================================================
-- 0056_indexes.sql -- two lookups that read a whole table per row, and a
-- checksum on the migration ledger.
--
-- ---- 1. A change set by its evidence (audit B9) ---------------------------
--
-- The record screen asks, for EVERY spec on the record, which change carries
-- the email that agreed its BW standard; the finishes page asks the same for
-- every finish (`records/[id]/route.ts`, `finishes/route.ts`): "the first
-- change set whose evidence_attachment_id is this attachment". Nothing indexed
-- that column, so each row of each screen scanned every change set in the
-- database -- every project's, not this one's. Keyed (evidence, created_at)
-- because the query orders by created_at and takes one; partial, because
-- nearly every change set carries no evidence and those rows are never asked
-- for.
--
-- ---- 2. An answer by its requirement (audit B9) ----------------------------
--
-- `spec_answers.requirement_id` references requirements with RESTRICT, so a
-- requirement delete or key update checks every answer for it -- with no
-- index, a scan of the largest table in the app. It is also the by-question
-- key the fill-in screen groups on. The existing indexes all lead with
-- record_id.
--
-- ---- 3. The ledger's checksum (audit B9) -----------------------------------
--
-- `db/migration-runner.mjs` now writes each file's ledger row inside the
-- file's own transaction, and from this migration on it records the file's
-- sha256 beside it and WARNS when an applied file no longer matches. Nullable:
-- the files applied before this one have no recorded checksum, and recording
-- today's text for them would be a guess dressed as a record. The column is
-- here rather than in the runner's own `create table if not exists`, so that
-- "which databases have it" is answered by the ledger like every other schema
-- change.
--
-- LOCKS. `create index concurrently` cannot run inside a transaction, and the
-- runner applies every file inside its own `begin; ... commit;` -- it has to,
-- to write the ledger row atomically with the change. So these are plain
-- `create index`, which hold a SHARE lock on the table while they build:
-- writes to change_sets and spec_answers wait, reads do not. On pilot both
-- tables are small (tens of thousands of answers) and the build is a second
-- or two. On a table large enough for that to matter, build the index
-- concurrently by hand first; the `if not exists` makes this file a no-op over
-- it.
-- ==========================================================================

begin;

create index if not exists change_sets_evidence_idx
  on change_sets (evidence_attachment_id, created_at)
  where evidence_attachment_id is not null;

create index if not exists spec_answers_requirement_idx
  on spec_answers (requirement_id);

alter table schema_migrations add column if not exists checksum text;

commit;
