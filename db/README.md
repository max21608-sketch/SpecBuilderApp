# Database

Neon Postgres. Sandbox is the project **`SpecBuilder`** (`dark-pond-59463734`),
branch **`sandbox`**, region `aws-eu-west-2` (London). Production will be a
**separate Neon project**, not a branch of this one, and does not exist yet.

That project's default branch is named **`root`**, not `production`. It is
`sandbox`'s parent and nothing should ever connect to it. It was renamed
deliberately: a branch called `production` sitting inside the non-production
project would let `DATABASE_ENVIRONMENT=production --yes-production` succeed
against the wrong database, with every guard in this directory reporting
exactly what it was designed to report.

Region-pin both to UK/EU: this data is NDA-covered client material.

## Sandbox vs production

Two separate projects, separate connection strings, separate credentials. Every
script here requires `DATABASE_ENVIRONMENT` as well as `DATABASE_URL`, prints
the resolved host before acting, and refuses production without
`--yes-production`.

`DATABASE_ENVIRONMENT` is a **declaration, not a probe** — it says which
database you believe you are pointed at. It cannot verify that. The printed
host is what catches a mismatch, so read it.

**Which env file a script reads.** The `npm run db:*` scripts load
`.env.local` if it is there (`--env-file-if-exists`), so the everyday local
case is just `npm run db:migrate`. Two properties make that safe rather than
convenient:

- **An exported variable still wins.** Node does not let an env file overwrite
  something already in the environment, so `.env.local` cannot quietly pull a
  deliberately-set target back to sandbox.
- **Nothing about the guards moved.** The host is still printed,
  `DATABASE_ENVIRONMENT` is still required, and production is still refused
  without `--yes-production`. The env file was never the safety mechanism; the
  script is.

**Production is the explicit form**, and naming its env file is the point —
that is the line that says which database this is about to touch:

```bash
node --env-file=.env.production db/run-migrations.mjs --yes-production
```

## Setup

1. The Neon project and its `sandbox` branch already exist (see above). For a
   fresh environment, create a new **project** — never a branch called
   `production` inside an existing one.
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm run db:migrate`
4. `npm run db:seed`
5. `npm run create-user -- <email> "<name>" admin '<password>'`

## Migrations

`000N_snake_case_description.sql`, forward-only, no down migrations. Each file
wraps itself in `begin; … commit;` so it is atomic on its own.

```bash
npm run db:migrate
```

The runner records each applied file in `schema_migrations`, so it is
idempotent — re-running is a no-op, and "which migrations does production
have?" is a query, not a guess.

Three things about the runner (`db/migration-runner.mjs`, audit B9,
2026-11-06) that a new migration has to fit:

- **The ledger row is written inside the file's own transaction.** The runner
  puts its insert immediately before the file's closing `commit;`, so the
  change and the record of it commit or roll back together. It used to insert
  the row after the file committed, and a crash between the two left a schema
  change with no ledger row, which the next run applied again. So a file MUST
  be `begin;` first and `commit;` last, each on a line of its own; anything
  else is refused before a byte of it runs. `create index concurrently`
  cannot run inside a transaction and therefore cannot be a migration file as
  things stand (0056 says what to do instead).
- **Two runners apply a file once.** The run holds a session advisory lock and
  reads the ledger after taking it.
- **An applied file that has been edited is reported, never refused.** From
  `0056` the ledger carries each file's sha256 (`checksum`); a file whose text
  no longer matches prints a WARNING. Files applied before `0056` have no
  checksum and are counted, not compared.

**Never edit a migration after it has been applied anywhere.** Add another one.
The checksum warning is how an edit is noticed.

Open each file with a comment saying *why*. The most useful migrations in this
company read as post-mortems.

## Seed data

```bash
npm run db:seed
```

Seeds are reference data, never transactional data.

**The trap:** `run-seed.mjs` runs every file every time, and idempotency
usually rests on `on conflict (lower(name))`. Once someone renames a row by
hand, that conflict key no longer recognises it — so the seed quietly
re-inserts the original as a duplicate, and a later cleanup migration then
fails on a unique constraint. The suite is only safe to re-run *before* any
manual edits to the same records.

**The requirement seeds match on a KEY, never on a position** (`0057`, audit
B7). `0003`, `0007` and `0009` upsert on `(category_id, seed_key)`: a BWS
field question is `field:<json_id>`, a matrix readiness question
`key:<local_key>`, any other `q:<the prompt, lower case, hyphenated>`. They
used to upsert on `(category_id, sort_order)`, so adding one question in the
middle of a revised cheat sheet wrote every prompt below it over its
neighbour, and every answer on those rows silently answered a different
question. Now a revised sheet may reorder freely (the position constraint is
deferrable, so one statement can move every row); a reworded readiness
question is a NEW question, and the old one waits to be retired; and changing
what an ANSWERED question asks (its kind, field, local key or prompt) is
refused by a trigger, which fails the seed naming the question and its counts.
A new question takes a new key; never re-use one.

## One-off maintenance passes

```bash
npm run db:backfill-answer-provenance                # dry run
npm run db:backfill-answer-provenance -- --apply
npm run db:backfill-answer-provenance -- --project=<uuid>
npm run db:backfill-answer-provenance:local          # the local stack
```

Run once after `0050`. Marks every checklist answer that is the record's
specs composed (`spec_answers.source_kind = 'attribute'`), and recomposes the
ones that had stopped following them: before 0050 an answer a bill, a
schedule, the tracker or an email filled could never be updated again, and a
retired bill fabric's answer went on shipping in the BWS file (audit E1).
The dry run prints, per project, how many answers were confirmed over no spec
before the pass, every answer whose value changes, and every one it cannot
decide, which it leaves for a person. The decision table is in
`src/lib/answer-provenance-backfill.ts`.

Three things about it are deliberate:

- **Dry run is the default**, and it prints what `--apply` writes: both read
  the same plan, built with the same `planAnswerFills` the confirm calls.
- **It is safe to re-run.** Only an answer still `document` is relabelled,
  so a second pass finds nothing and opens no change set.
- **It is not a numbered migration.** The composition is
  `composeDimensionCell` and `composeAttributeStatement`, and rebuilding them
  in SQL is the second composer the dimension design exists to prevent. This
  is also why `tsx` is a devDependency: a maintenance script has to be able to
  call the app's own TypeScript.

It replaces `db:backfill-answers` (retired 2026-11-06, audit B2), which
predated qualifiers, the finishes library and BW standards and wrote outside
any change set: a re-run would have overwritten the library's words with a
drawing's, dropped qualifiers, and confirmed an answer over a TBC finish.

## Backups

```bash
npm run db:backup
```

Writes a timestamped dump to `~/bw-backups/<app>/` — deliberately **outside**
the repository. Override with `BACKUP_DIR`. The password reaches `pg_dump`
through `PGPASSWORD`, never its command line, where `ps` would show it to
every user on the machine for as long as the dump runs.

Take one before any schema change.

## Restore

```bash
node --env-file=.env.restore-target db/restore.mjs <path to dump.sql>
```

This is destructive, and it **refuses to run against a database that already
has tables**. It runs the dump as ONE transaction (`--single-transaction`), so
a dump that fails half way leaves the target empty rather than half built
(which the table check would then refuse to retry over). A restore belongs in an empty database (a fresh branch or
project) which the app is then repointed at — never on top of a live one. That
refusal is deliberate: it makes "restore over the live database" something you
cannot do by accident.

Restore is the one script whose env file is always named explicitly: the
target is a *different*, empty database, which is the whole point. `npm run
db:restore` would pick up `.env.local` and then refuse on the table check,
which is the right outcome but not a useful one.

An untested restore path is not a backup, which is why this is a script rather
than a paragraph.

## What backups do NOT cover — read before relying on them

1. **Blob storage is not backed up at all.** A restore gives you rows pointing
   at documents that may no longer exist.
2. **Nothing is scheduled.** A backup nobody runs is not a backup. As of
   2026-09-12 this is still true: no automated backup exists, so the real
   recovery point is whenever a human last remembered.
3. **Dumps contain real client data.** Keep them out of git and out of any
   cloud-synced folder.
4. **Blob retention: nothing deletes uploaded documents, ever.** `del` from
   `@vercel/blob` is called nowhere in this codebase and uploads use
   `addRandomSuffix`, so every version of every BOQ, FF&E schedule and spec
   bible accumulates indefinitely — NDA-covered client material, in no backup
   and on no retention schedule. That is a data-protection exposure in its own
   right, not merely a housekeeping gap. Inherited from `bw-app-kit`.

**Observed 2026-09-12: (1), (2) and (4) are open items, not solved problems.**
(3) is enforced — `.gitignore` covers `db/backups/`, and `db/backup.mjs`
defaults outside the repository and outside iCloud. The others are written
down so nobody mistakes this section for a safety net.

## One-off backfills

Each is dry-run by default, prints the resolved host before acting, refuses
production without `--yes-production`, and is safe to re-run. None is a
numbered migration, for the reason `db/backfill-answer-provenance.ts` gives:
what they compute is `composeRowCells` and `composeDimensionCell`, and
rebuilding those in SQL is the second composer the export design exists to
prevent.

| Script | What it does |
|---|---|
| `npm run db:backfill-answer-provenance` | After `0050`: marks the answers composed from a record's specs as `attribute`, recomposes the ones that had stopped following them, and leaves a reviewer's own answer off a schedule alone. Prints what it cannot decide |
| `npm run db:backfill-snapshots` | Gives every record that predates `0012` a version 1, under a `history_begins` change. It does NOT reconstruct the past from `audit_log` — see decision 58 |
| `npm run db:backfill-finishes` | **Historical** (audit B9). Builds each project's finishes library from the codes its drawings carry, links every attribute, and takes a version of each record it changed; a code whose items disagree is left blank and NAMED. Kept because the finishes page names it as the way to bring unlinked codes in. It predates the zone-twin lookup (run `db:backfill-finish-twins` after it) and recomposes no checklist answer; its header says what that leaves |

## Deleting a project

```bash
npm run db:delete-project -- --project=<id or BWS number>            # dry run
npm run db:delete-project -- --project=<id or BWS number> --apply
npm run db:delete-project:local -- --project=<...>                    # the local stack
```

A project is deletable BY SCRIPT, never from the app (Max, 2026-11-06, audit
B5). The dry run prints every table's row count, every file the database
records under `projects/<id>/` (and, where the store can be listed, files
under it that no row names), and how many messages survive. `--apply` deletes
the rows in ONE transaction, counts again before committing and refuses if
anything of the project is left, then deletes the files after the commit.
Pilot needs `--yes-pilot` and production `--yes-production`, as everywhere; a
`TEST` project (kept on purpose) also needs `--yes-test`.

What goes and what stays (`db/project-delete.mjs` has the reasons):

- **Every row of the project**: one `delete from projects` cascades through
  every table that hangs off it (`0055` made that order-proof), and the
  attachments, notes, status history and messages no foreign key reaches are
  deleted around it.
- **Mail that arrived through the mailbox stays**, taken off the project
  (unassigned, "Its project was deleted."), because its arrival record under
  `mailbox/` is the record that it arrived at all. Mail whose only copy is under
  the project's prefix (an `.eml` uploaded to it) goes.
- **`audit_log` stays**, by design. Since `0054` it no longer holds the staged
  documents, the email bodies or the password hashes.

## Sweeping after a failed test run

`npm run db:qa-clean` removes every `__QA` project a database-tier run left
behind, through the same `db/project-delete.mjs` the script above uses. A
suite that fails partway leaves its project in place, and the NEXT run then
fails on the unique project number rather than on whatever was actually
wrong — which is how a real failure gets mistaken for a flake.

It matches `left(name, 5) = '__QA '`, never `like '__QA%'`, where an
underscore is a wildcard. It deletes rows only: the files a swept project
named stay in the store. It leaves `audit_log` alone, by design. It sweeps
EVERY `__QA` project, including one a concurrent test run is using right now,
so do not run it while another run is in progress.
