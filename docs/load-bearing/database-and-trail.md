# The database, the change trail and migrations

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### A change is a change set; a version is composed, never copied

`db/migrations/0012_change_sets_and_snapshots.sql`, `src/lib/change-sets.ts`,
`src/lib/record-atoms.ts`, `src/lib/record-snapshot.ts`,
`src/lib/snapshot-diff.ts`

A record had no history anybody could read. `audit_log` has held whole-row
before/after since 0001 and `status_history` was written by six confirm paths,
and **nothing ever read either**.

A **change set** is who, when, why, and a link to the document or email that
caused it. A **record snapshot** is the composed state of one record after a
change, numbered per record — the user-facing "version". Both are side tables:
recording that something happened still never touches the row it happened to,
because `bump_version` would invalidate every extraction snapshot and chase
coverage row taken against it.

Five things here are load-bearing.

- **The link is a GUC, not a transaction id.** `openChangeSet` inserts the row
  and then `set_config('app.change_set_id', …, true)`; `write_audit()` reads it,
  so every audit row that follows carries its change without a call site
  remembering. `pg_current_xact_id()` was the obvious choice and is wrong:
  xid8 values do not survive `db:restore` into a fresh Neon project, so the
  join would start lying after a recovery. It only works inside
  `withTransaction`, which is why `PATCH /api/answers/[id]` moved onto it —
  one autocommitted statement cannot carry a GUC, and a person's edit would
  have been the one change with no version and no why.
- **Snapshots hold the EXPORT's own shapes.** `loadRecordAtoms` is the single
  loader for the export, the check sheet and a version, so `composeRowCells`
  runs over a snapshot unchanged. A history that described a record differently
  from the file would be worse than none, because it would be believed.
- **A diff runs over atoms, never over the stored cells.** The cells are kept
  for one question — "what did the file say on that date" — and
  `composeRowCells` changes, so a diff across two rule sets reports edits on
  records nobody touched. `diffSnapshots` recomposes both ends with today's
  rules instead. Everything is keyed by a stable id, so a value corrected in
  place is one changed line rather than a delete beside an add.
- **A baseline materialises its members** (`baseline_members`, 0013), written
  under the project row lock. "The newest version as at that date" is wrong:
  `created_at` is transaction START time, and two overlapping guarded
  transactions can commit in the opposite order, putting a version on the wrong
  side of a line somebody signed off.
- **A reason is asked for only when an edit OVERRIDES a settled answer.**
  `save()` fires on every blur, so a box beside every field asks twenty times
  and collects twenty rows reading "update". A reviewer instead OPENS a change
  ("Hayley's email of the 14th"), attaches the email, and every edit after that
  attaches to it — at most one open change per actor per project, by partial
  unique index.
- **One version per TRANSACTION, not per change** (0052, audit B1, Max
  2026-11-06). `snapshotRecords` inserted `on conflict (record_id,
  change_set_id) do nothing`, written for a confirm (one change, one
  transaction), and an open change spans many: the first edit kept the
  change's version and every later one took none, so D surfaced in the NEXT
  change's diff under that change's reason and evidence, and a baseline
  between them froze a state the record had left. The unique is gone;
  `snapshotRecords` remembers the records it versioned in a
  transaction-local setting (`app.snapshotted_records`, `set_config(…, true)`,
  undone by a savepoint rollback) and skips them on a second call, so one act
  is still one version. The first call in a transaction wins, which is why
  fan-outs pass `snapshot: false`. The trail names a record once per change
  at its newest version; the open-change count is `distinct record_id`; and
  the coverage assertion in `tests/db/change-history.test.ts` is per RECORD —
  every record a change wrote spec content to has a version under that
  change (121 change sets, 1,537 pairs, 0 gaps on the local stack).
- **The diff pairs supersessions** (atoms schema 9, audit E6). Since 0033
  nothing is corrected in place, so keying on the row id read every
  correction as removed + added. Each attribute in a version carries
  `supersedes`, its retired lineage — on the SUCCESSOR, because the older
  version never knew — and `pairSupersessions` re-keys a retired row onto its
  single successor: one changed line, the page kept, across a skipped middle
  correction too. One-to-one only (a Dia that replaced W and D stays one add
  and two removes). `qualifier` is named on `AtomAnswer` and diffed on both
  lists; Zod strips what it does not name, which is how an answer's placement
  vanished from every diff. Versions before schema 9 carry no lineage.

**Append-only means refuse the rewrite, allow the cascade.** 0013, 0014 and
0015 each correct the same misreading: a version could not be deleted with its
record, a change set could not be deleted with its project, and — the one that
would have bitten a real database — a document that had caused a change could
never be deleted at all, because the FK's own `ON DELETE SET NULL` was refused
as a rewrite. Apply that rule to the next immutable table rather than
rediscovering it.

There is **no trigger refusing a write made outside a change set**, and that is
deliberate: every db-tier fixture and every hand fix with `psql` writes rows
directly, and a trigger refusing them turns a safety net into a wall across the
maintenance path. The guarantee is the coverage assertion in
`tests/db/change-history.test.ts`, which reads the WHOLE database: any change
set with spec-content audit rows and no version fails it. It has already earned
itself twice.

### A single-row edit locks its record first

`src/lib/record-lock.ts`, `src/lib/db-transaction.ts`, `tests/db/lock-order.test.ts`

Audit B6 and E8, 2026-11-06. The acquisition order is project → draft or
intake row → RECORDS (by id) → requirements → answers and attributes. Every
confirm and `editCommonSpec` kept it; the single-row edits did not:
`editAnswer`, the apply-to-many route, `correctAttribute`, `retireAttribute`,
`restoreAttribute`, `setAttributeFinish` and `resolveDisagreement` locked their
row and reached the record only in `snapshotRecords`. That deadlocked (40P01,
reported as "someone else was changing this") against any records-first
writer, and left the occupancy check unguarded, so two moves into one slot
both passed and the second died on the slot index as a 500. Each now calls
`record-lock.ts` before it reads its row, and batch callers
(`applyProjectWide`, the apply route) lock every record in id order first.
The lock is `for update`, which fires no trigger, so `spec_records.version`
never moves. The test forces each interleaving with `pg_blocking_pids`, never
a sleep. `attribute-standard.ts` (`setAttributeStandard`) is the one writer
locks the record too since 5.4 (2026-11-07), and an agreement made inside an
open change joins that change but points only at evidence given WITH the
agreement (`agreementEvidenceId`, shared by the item and the finish
agreement), never at the change's own, because the change's evidence may be
an unrelated email.

**The migration ledger and the scripts, since 5.4:** `requireScriptEnvironment`
refuses a host the declaration does not own (`hostRefusal`, `KNOWN_HOSTS`:
this machine may only ever be sandbox; a host another environment owns is
refused; a host not on its own environment's list is refused where that list
has entries). **The sandbox and pilot lists are EMPTY until Max pastes the two
Neon hosts in**, because `docs/environments.md` records none; until then
those two print "[host unchecked …]". `db:backfill-ref-norm` re-folds
`ref_value_norm` with the one `normaliseRef` (the `boq-import` copy is
retired; a revision deletes an old boq_code by its words, not its fold, or
`S.201` re-spelt `S-201` would keep the old spelling) and reports a pair that
now collides, never merging it (local: 1,279 refs, 1,255 to re-fold, 0
collisions). `tools/orphan-blobs.ts` is a read-only list of stored files
nothing names — `attachments`, `email_messages` or staged
`intake_runs.parsed`, where bill row pictures live until confirm (local: 684
files, 151 unnamed, 26 under deleted projects); deletion is a later decision.

**Changing a record's category** deletes its old category's answers, so two
things are refused in words BEFORE anything is written (`record-category.ts`,
audit B3): a PERSON's answer (`manual`, `email`, `document`, not `missing`),
named by prompt — `attribute` answers are projections, go with the old rows
and are recomposed under the new category by the same `recomposeAnswers` E5
added, so a bill line with sizes moves freely (counting them refused every
such record on the Stage 1 walk); and an answer any chase coverage row points
at (`category_chased`, naming the chase, which used to be a 23503 → "Nothing
was written"). Coverage is history and survives void and supersede, so a
chased record can NEVER change category today; the sentence promises no way
round it, and allowing it is a migration (retirable answers, or coverage that
outlives its answer) and Max's decision.

**One library loader.** `bill-fabric-load.ts`'s `loadFinishLibrary` is the only
query carrying `zonesOnItems`; `drawing-resolution.ts`, `confirm-drawings.ts`
and `loadScheduleLibrary` call it (audit E7: the schedule loader had none, so
`GR-MTL-01` and `PL-MTL-01` on one schedule both folded onto a bare `MTL-01`,
or two fills on one row 409'd the whole confirm). A finishes schedule also
counts the zones it prints itself when reading a bare row, and keys
"repeated" on the resolved finish. Also from the same pass: a common answer
`na` with a value is refused 400 before any transaction; restoring a retired
finish onto a live code, or renaming onto one, is `code_exists` naming the
live row (it was the unique index's 500); `parseEnvelope` never throws on a
bad `Date:` header (null date, `dateRaw` kept, the worker names the header);
a typed reason on a project-wide override always gets its own change set.

### A CHECK is re-listed in full, so copying a stale list DELETES values

`db/migrations/0032_restore_email_confirm.sql`, `tests/db/vocabulary-sync.test.ts`

A Postgres `check (x in (...))` cannot be extended: adding a value means
dropping the constraint and recreating it with the whole list. The whole list
then gets copied from whichever migration most recently re-listed it — and that
copy is stale the moment any migration since added a value.

**0028 copied 0019's list of change-set kinds and silently deleted
`email_confirm`, which 0021 had added in between.** Every email confirm began
failing with a constraint violation that reached the reviewer as a 500 and
"Nothing was written", and four db-tier tests went red for a value nobody had
typed.

Two things are worth more than the fix:

- **The misdiagnosis.** It was first blamed on another agent's commit, on the
  evidence that it still failed with the TypeScript changes stashed. It failed
  because **the constraint lives in the database**: a migration already applied
  to the sandbox is not undone by stashing a `.ts` file. When a db-tier test
  fails, the thing to revert is the SCHEMA, not the source — and the way to
  check a clean baseline is `git worktree add --detach <dir> HEAD`, which leaves
  the working tree alone.
- **The guard.** `tests/db/vocabulary-sync.test.ts` asserts all twelve
  controlled vocabularies in `spec-vocab.ts`, `change-sets.ts` and `finishes.ts`
  against their own CHECK, and reports drift the other way. It fails in a second
  on the next drop-and-recreate that loses a value, which is the only version of
  this that scales. Read the LIVE constraint when re-listing one, never a
  migration. **The same rule holds for a foreign key's delete action and a
  trigger's arguments**: 0055 rebuilds seven foreign keys from
  `pg_get_constraintdef`, and 0054's audit triggers carry the columns they
  leave out as ARGUMENTS, so re-running 0001's trigger block would re-create
  them without the arguments — read `pg_get_triggerdef` first. Twelve more
  vocabularies joined `vocabulary-sync` on 2026-11-06 (intake statuses and
  source kinds; record, run, attribute, note, project and draft statuses;
  attribute states; contact roles; gate value types; question tiers).

### A project is deleted by one statement and one script, and the trail keeps only what it should

`db/migrations/0054_audit_excludes_document_columns.sql`,
`0055_project_deletable.sql`, `0058_project_delete_order.sql`, `db/project-delete.mjs`, `db/delete-project.mjs`,
`tools/qa-clean.mjs`, `tests/db/project-delete.test.ts`,
`tests/db/audit-excluded-columns.test.ts`

Audit B4 and B5, 2026-11-06. The audit trigger copied whole documents, email
bodies and password hashes into the one table nothing can delete from: every
review autosave wrote two copies of the staged JSON (hundreds of KB per click
on the AMB read), every triage duplicated an NDA email body, and a scrypt hash
sat in the log for ever — the likely cause of "the sandbox database is full",
and the reason no retention decision could ever be kept. And a project could
not be deleted at all: `email_messages.project_id on delete set null`
conflicted with its own CHECK, two draft keys were RESTRICT, and the rest of
the cascade depended on RI trigger order, which `db/restore.mjs` can change.
Max, 2026-11-06: stop auditing those columns; a project is deletable by
SCRIPT, never from the app.

- **The audit trail leaves documents out.** `write_audit()` drops the columns
  named in its trigger's arguments: `intake_runs` (`parsed`, `raw_response`),
  `email_messages` (`body_text`, `headers_raw`), `users` (`password_hash`).
  Every other table is audited whole; the actor fallback and the change-set
  GUC are unchanged. Rows already written are not rewritten (append-only), so
  pilot's existing space is not reclaimed — that is its own migration and
  decision.
- **Mail outlives its project.** An assigned message whose project is deleted
  becomes unassigned with the reason "Its project was deleted.", by a trigger
  that recognises only the foreign key's own set-null; an `.eml` stored only
  under the project's prefix goes with the project, a mailbox arrival stays.
- **Every key between two tables a project delete empties is RESTRICT-free
  AND deferred** (0055, then 0058 the same day). RESTRICT is checked the
  moment a row goes; a plain NO ACTION is checked at the end of the cascade
  QUERY that deleted it, and cascades run in trigger-NAME order —
  `RI_ConstraintTrigger_a_<oid>` compared as text, so creation order, which a
  restore re-rolls. 0055 believed NO ACTION waited for the end of the
  statement: the delete passed on the shared local database (the re-created
  drafts key's oid 157631 sorts before 25394) and failed on the first FRESH
  one (171979 after 170797), which is how CI's first rehearsal found it. 0058
  makes the six keys (batch, run-same-project, finish, contact-same-project,
  the draft item's record and answer) `DEFERRABLE INITIALLY DEFERRED` by
  `alter constraint` (no re-listing, no oid change): checked at COMMIT, after
  every cascade. A lone delete is still refused by the same constraint, now at
  commit inside a transaction — and so is an insert naming a missing batch,
  run or finish; nothing in the app catches those mid-transaction.
  `email_drafts.project_id` cascades; the version guard allows a delete once
  the record's project is gone. `deleteProjectRows` also deletes in
  foreign-key order itself (`DELETE_ORDER`, house §12), so it is safe under
  `set constraints all immediate`. Tests read the catalog and fail on a
  seventh non-deferred key or an order the list does not satisfy, and one
  re-creates the project's keys in the worst order inside a rolled-back
  transaction (tables taken with `LOCK … NOWAIT`, so it cannot deadlock a
  parallel test) and proves both paths pass it.
- **One deletion path.** `deleteProjectRows` is the only one: polymorphic rows
  by prefix or entity, mail whose only copy is under the prefix, then the
  project; it counts every table again before commit, refuses to commit if
  anything is left, returns the file paths to delete after commit, and leaves
  `audit_log` alone. Its table list is held equal to `copy-project-core.ts`'s
  `TABLE_HANDLING`, so a new table fails a test before it is a row left
  behind. `qa-clean` calls it. 0013's header ("nothing deletes an attachment")
  is now false for a deleted project's attachments, by this decision.

### The requirement seeds match on a key, and an answered question keeps its meaning

`db/migrations/0057_requirements_seed_key.sql`, `db/seed/0003`, `0007`,
`0009`, `tests/db/requirements-seed-key.test.ts`

Audit B7, 2026-11-06. The three requirement seeds upserted on
`(category_id, sort_order)`, so inserting one question into a revised cheat
sheet rewrote the prompt of every row below it and every answer on those rows
changed meaning silently (the composite field FK caught a FIELD change loudly;
a prompt change was silent). `requirements.seed_key` is `field:<json_id>` for
a question that fills a BWS field, `key:<local_key>` for a matrix readiness
question, otherwise `q:<slug of the prompt>`, unique per category; the 797
seeded rows got theirs in the migration and the seed files carry them
literally, upserting on `(category_id, seed_key)` and moving `sort_order`. The
position constraint stays unique but DEFERRABLE, checked at statement end so a
revised sheet reorders in one pass — nothing may use it as an ON CONFLICT
arbiter. A trigger refuses to change `kind`, `spec_field_id`, `local_key` or
`prompt` on a question with a non-missing answer or a chase line, with the
counts: a reworded question is a NEW row with a new key, and the old one waits
to be retired. **Pilot: apply 0057, THEN re-seed with this branch's seed
files** — the old seeds fail against 0057 and the new ones fail without it;
afterwards `select count(*) from requirements where created_by = 'seed'` is
still 797.

### The migration ledger is written by the file's own transaction

`db/migration-runner.mjs` (the core; `run-migrations.mjs` is the CLI),
`tests/db/migration-runner.test.ts`

Audit B9, 2026-11-06. The runner wrote the ledger row AFTER the file's own
`commit;`, outside it, with no lock against two runners: a crash between the
two re-applied the file next time, and a failed file left the connection in
an aborted transaction. Now each file must be `begin;` first and `commit;`
last, each on its own line, and the ledger insert goes before the commit;
anything else is refused before it runs — so `create index concurrently`
cannot be a migration file as things stand (0056's two indexes are plain
`create index`, a short SHARE lock). A session advisory lock serialises two
runners; a failed file is rolled back. From 0056 the ledger records each
file's sha256 (`schema_migrations.checksum`): an applied file whose checksum
no longer matches is a WARNING, never a failure, because the house rule is to
never edit an applied migration and the warning is how that is noticed.
`db/restore.mjs` runs `--single-transaction` (a dump that fails half way
leaves 0 tables, not half); `backup.mjs` and `restore.mjs` pass the password
through `PGPASSWORD`, never on the command line; every `db/backfill-*.ts`
imports `requireScriptEnvironment` instead of its own copy of the guard; the
500 path in `db-transaction.ts` logs the error code, constraint, table and a
reference, never the driver's `detail`, which echoes stored values into the
logs.

### A backtick inside a `sql` template closes it

Twice on 2026-09-17, in `promote-answers.ts` and in the quote route: a SQL
comment written in this repo's usual prose style — naming a column in
backticks — ends the tagged template literal, and esbuild reports a syntax
error thirty lines away pointing at a word in the comment. The queries are
tagged templates, so **no backtick may appear inside one**, including in a
`--` comment. Name the column in plain words there.
