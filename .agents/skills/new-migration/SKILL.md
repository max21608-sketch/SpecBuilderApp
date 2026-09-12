---
name: new-migration
description: Add and apply a database migration safely, sandbox first.
---

# Adding a migration

## Before writing anything

1. `node --env-file=.env.local db/backup.mjs` — and **read the printed host**.
   `DATABASE_ENVIRONMENT` is a declaration, not a probe.
2. Check what is already applied: `select * from schema_migrations order by filename;`

## Writing it

- Filename `000N_snake_case_description.sql`, next number in sequence.
- Wrap the whole file in `begin; … commit;` so it is atomic on its own.
- **Open with a comment saying WHY.** Not what the SQL does — the reader can
  see that. What went wrong, or what became possible, that made this necessary.
  The best migrations in this company read as post-mortems.
- Forward-only. There is no down migration. If you need to reverse something,
  that is another migration.
- **Never edit a migration that has been applied anywhere.** Not even a typo in
  a comment: the runner keys on filename, so an edited file is not re-applied
  and the two databases silently diverge.

### Things that need care

- Adding a `not null` column to a populated table needs a default or a
  backfill, in that order, in one file.
- A new `check` constraint will fail on existing bad rows. Normalise first, and
  **name the offending rows in a `raise exception`** rather than letting the
  bare constraint violation be the error message.
- New business tables need their `updated_at` and `write_audit` triggers
  attached — re-run the `do $$ … $$` block pattern from
  `0001_foundation.sql` for the new table names.
- A user-editable table needs `version integer not null default 1` and a
  `bump_version` trigger.
- Changing a controlled vocabulary means changing the TypeScript constant, the
  check constraint or pick-list seed, AND writing a backfill. See the
  `external-vocabulary-sync` skill.

## Applying it

```bash
node --env-file=.env.local db/run-migrations.mjs
```

Idempotent — it applies only what is missing and records each file. Run it
twice; the second run should report zero applied.

Then: verify the schema is what you intended, run the database-tier tests with
`DATABASE_URL` set, and only then deploy the dependent code.

**A migration and a deploy are two operations.** Additive migrations go before
the code that uses them; destructive ones go after the code that stopped using
the column. Production needs explicit authorization for each, separately.
