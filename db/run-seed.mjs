#!/usr/bin/env node
// Applies every db/seed/*.sql file in order. Seeds are idempotent
// (on conflict do nothing/update), safe to re-run.
//   node --env-file=.env.local db/run-seed.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(__dirname, "seed");

const { databaseUrl } = requireScriptEnvironment("run-seed.mjs");

const files = readdirSync(seedDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (const file of files) {
    console.log(`Seeding ${file}...`);
    const sqlText = readFileSync(path.join(seedDir, file), "utf8");
    await client.query(sqlText);
    console.log(`  done.`);
  }
  console.log(`Applied ${files.length} seed file(s).`);
} finally {
  await client.end();
}
