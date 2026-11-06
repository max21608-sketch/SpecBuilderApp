#!/usr/bin/env node
// Manual backup: runs `pg_dump` against DATABASE_URL and writes a timestamped
// dump. Run it before any schema change and periodically (a daily
// cron/launchd job once this is deployed).
//   node --env-file=.env.local db/backup.mjs
//
// Dumps land OUTSIDE the repository by default. The fabric-ordering app writes
// them into db/backups/ inside a working directory that is iCloud-synced,
// which quietly uploads NDA-covered client data to a personal cloud account.
// Set BACKUP_DIR to override; the default is ~/bw-backups/<app>.
//
// This is NOT a complete recovery copy: the Blob store is not covered. See
// db/README.md.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pgToolConnection, requireScriptEnvironment } from "./script-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir =
  process.env.BACKUP_DIR ?? path.join(process.env.HOME ?? __dirname, "bw-backups", "spec-builder");
mkdirSync(backupsDir, { recursive: true });

const { databaseUrl, environment } = requireScriptEnvironment("backup.mjs");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
// The environment is in the filename because dumps from the two Neon projects
// were otherwise indistinguishable on disk -- a restore could be pointed at
// the wrong target with no signal.
const outFile = path.join(backupsDir, `spec-builder-${environment}-${stamp}.sql`);

// The password travels in the child's environment, never on its command line,
// where `ps` shows it to anybody for as long as the dump runs (script-env.mjs).
const connection = pgToolConnection(databaseUrl);
execFileSync("pg_dump", ["--no-owner", "--no-privileges", connection.url, "-f", outFile], {
  stdio: "inherit",
  env: connection.env,
});
console.log(`Backup written to ${outFile}`);
