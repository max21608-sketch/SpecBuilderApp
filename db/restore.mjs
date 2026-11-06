#!/usr/bin/env node
// Restores a db/backup.mjs dump into the database DATABASE_URL points at.
// An untested restore path is not a backup, which is why this exists as a
// script rather than a paragraph.
//
// This is DESTRUCTIVE: pg_dump output from backup.mjs recreates the objects it
// contains, so it must be run against an EMPTY database (a fresh Neon branch or
// project), never on top of a live one. It therefore refuses to run unless the
// target has no public tables.
//   node --env-file=.env.restore-target db/restore.mjs db/backups/<file>.sql
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import pg from "pg";
import { pgToolConnection, requireScriptEnvironment } from "./script-env.mjs";

const dumpFile = process.argv[2];
if (!dumpFile || dumpFile.startsWith("--")) {
  console.error("Usage: node --env-file=<target env file> db/restore.mjs <path to dump.sql> [--yes-production]");
  process.exit(1);
}
if (!existsSync(dumpFile)) {
  console.error(`Dump file not found: ${dumpFile}`);
  process.exit(1);
}

const { databaseUrl, environment } = requireScriptEnvironment("restore.mjs");
console.log(`Restoring ${dumpFile} into the ${environment} database.`);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const { rows } = await client.query(
    "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
  );
  if (rows[0].count > 0) {
    console.error(
      `Refusing to restore: the target database already has ${rows[0].count} table(s) in public. ` +
        "Restore into an empty database (a new Neon branch or project), then repoint the app at it.",
    );
    process.exit(1);
  }
} finally {
  await client.end();
}

// ONE TRANSACTION (audit B9). Without --single-transaction a dump that fails
// half way -- a role it names that this project lacks, an extension, a full
// disk -- leaves the target holding the first half of the schema and the
// rows that loaded before the error, and the empty-database check above then
// refuses every retry. With it, a failure leaves the target empty, as it was.
// The password goes in the environment, not on the command line (script-env.mjs).
const connection = pgToolConnection(databaseUrl);
execFileSync(
  "psql",
  ["--set", "ON_ERROR_STOP=on", "--single-transaction", "-d", connection.url, "-f", dumpFile],
  { stdio: "inherit", env: connection.env },
);
console.log("Restore complete.");
console.log("Blob is NOT covered by this restore -- see db/README.md; every stored PDF/.eml link");
console.log("in the restored rows still points at the Blob store, which has its own lifecycle.");
