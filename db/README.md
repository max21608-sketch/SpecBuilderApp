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

**Never edit a migration after it has been applied anywhere.** Add another one.

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

## One-off maintenance passes

```bash
npm run db:backfill-answers                          # dry run
npm run db:backfill-answers -- --apply
npm run db:backfill-answers -- --project=<uuid>
```

Fills checklist answers from `record_attributes` that were confirmed before
`confirm-drawings` started carrying them through. Ran on sandbox 2026-09-15:
11 answers across five records.

Three things about it are deliberate:

- **Dry run is the default.** It writes to real spec records in bulk, and the
  useful thing to see first is which ones and what to. The dry run counts with
  the SAME predicate the writer uses, so it cannot promise more than `--apply`
  delivers.
- **It is safe to re-run.** It calls the same `planAnswerFills` /
  `applyAnswerFills` the confirm route calls, which only touch an answer still
  `missing` or one a shop-drawings run wrote. A person's answer is never in
  scope, so a second pass cannot lose work.
- **It is not a numbered migration.** The composition is
  `composeDimensionCell`, and rebuilding that in SQL — slot order, a diameter
  replacing width and depth, the millimetre conversion, the verbatim fallback
  for a figure it could not derive — is the second composer the dimension
  design exists to prevent. This is also why `tsx` is a devDependency: a
  maintenance script has to be able to call the app's own TypeScript.

## Backups

```bash
npm run db:backup
```

Writes a timestamped dump to `~/bw-backups/<app>/` — deliberately **outside**
the repository. Override with `BACKUP_DIR`.

Take one before any schema change.

## Restore

```bash
node --env-file=.env.restore-target db/restore.mjs <path to dump.sql>
```

This is destructive, and it **refuses to run against a database that already
has tables**. A restore belongs in an empty database (a fresh branch or
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
