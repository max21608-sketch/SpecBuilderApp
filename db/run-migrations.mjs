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
// This app has had the ledger since 0001, so there is no baseline backfill.
// If you ever adopt this runner on a database whose schema was built BEFORE
// the ledger existed, an empty ledger against an existing schema means
// "already applied by hand", not "apply 0001 again" -- and you need a BASELINE
// constant naming the last pre-ledger migration, plus a backfill that inserts
// every file up to it. See db/run-migrations.mjs in the fabric-ordering app.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

const { databaseUrl } = requireScriptEnvironment("run-migrations.mjs");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows: applied } = await client.query("select filename from schema_migrations");
  const alreadyApplied = new Set(applied.map((row) => row.filename));

  // Each migration file wraps itself in begin/commit, so it is atomic on its
  // own; the ledger insert follows as its own statement and is reached only if
  // the file committed (a failure throws out of this loop).
  let count = 0;
  for (const file of files) {
    if (alreadyApplied.has(file)) {
      console.log(`Skipping ${file} (already applied).`);
      continue;
    }
    console.log(`Applying ${file}...`);
    const sqlText = readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query(sqlText);
    await client.query("insert into schema_migrations (filename) values ($1) on conflict do nothing", [file]);
    console.log(`  done.`);
    count += 1;
  }
  console.log(`Applied ${count} migration(s); ${files.length - count} already present.`);
} finally {
  await client.end();
}
