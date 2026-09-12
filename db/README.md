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
node --env-file=.env.local db/run-migrations.mjs
```

The runner records each applied file in `schema_migrations`, so it is
idempotent — re-running is a no-op, and "which migrations does production
have?" is a query, not a guess.

**Never edit a migration after it has been applied anywhere.** Add another one.

Open each file with a comment saying *why*. The most useful migrations in this
company read as post-mortems.

## Seed data

```bash
node --env-file=.env.local db/run-seed.mjs
```

Seeds are reference data, never transactional data.

**The trap:** `run-seed.mjs` runs every file every time, and idempotency
usually rests on `on conflict (lower(name))`. Once someone renames a row by
hand, that conflict key no longer recognises it — so the seed quietly
re-inserts the original as a duplicate, and a later cleanup migration then
fails on a unique constraint. The suite is only safe to re-run *before* any
manual edits to the same records.

## Backups

```bash
node --env-file=.env.local db/backup.mjs
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
