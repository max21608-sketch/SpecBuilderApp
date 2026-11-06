#!/usr/bin/env node
// Applies every not-yet-applied db/migrations/*.sql file in order, via a
// single Postgres session (not the Neon HTTP driver, since these scripts use
// `begin`/`commit` blocks and DO blocks that are easiest to run through a real
// connection). Each file records itself in schema_migrations, so this runner is
// idempotent: re-running it is a no-op, and "which migrations does production
// have?" is answerable by querying that table rather than reading the schema by
// eye. Requires the `pg` client, DATABASE_URL and DATABASE_ENVIRONMENT:
//   node --env-file=.env.local db/run-migrations.mjs
//
// The work is in `migration-runner.mjs` (audit B9, 2026-11-06): the ledger row
// is written INSIDE each file's own transaction, two runners serialise on an
// advisory lock, and an applied file that has since been edited is reported
// by its checksum. That file's header says why each one matters.
//
// This app has had the ledger since 0001, so there is no baseline backfill.
// If you ever adopt this runner on a database whose schema was built BEFORE
// the ledger existed, an empty ledger against an existing schema means
// "already applied by hand", not "apply 0001 again" -- and you need a BASELINE
// constant naming the last pre-ledger migration, plus a backfill that inserts
// every file up to it. See db/run-migrations.mjs in the fabric-ordering app.
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import { runMigrations } from "./migration-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

const { databaseUrl } = requireScriptEnvironment("run-migrations.mjs");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const result = await runMigrations({ client, dir: migrationsDir });
  console.log(`Applied ${result.applied.length} migration(s); ${result.skipped.length} already present.`);
} finally {
  await client.end();
}
