#!/usr/bin/env tsx
// A ONE-OFF pass: put the client's words back where a BWS palette pick on the
// drawings card wrote the option over them, and keep the pick beside them as
// a proposed BW standard (0041).
//
//   npm run db:backfill-standards                      dry run
//   npm run db:backfill-standards -- --apply           writes
//   npm run db:backfill-standards -- --project=<uuid>
//
// ============================================================================
// The rules are in src/lib/standards-backfill.ts, so the db tier can prove
// them; this file is the guard around them, copied from backfill-finishes.ts:
// it prints the resolved host before acting, refuses production without
// --yes-production and pilot without --yes-pilot (separate flags on purpose),
// and writes nothing without --apply.
//
// SAFE TO RE-RUN: a row that already carries a standard, or whose value is no
// longer the option, is not touched, and a project with nothing left to do
// opens no change set.
//
// Local stack first, always. On the sandbox only by Max.
// ============================================================================
import pg from "pg";
import type { TxnSql } from "../src/lib/db-transaction";
import { applyStandardBackfill, planStandardBackfill } from "../src/lib/standards-backfill";

const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  npm run db:backfill-standards           (reads .env.local)");
  console.error("Add -- --apply to write; without it this is a dry run.");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (!DATABASE_ENVIRONMENTS.includes(environment)) {
  console.error(`DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}.`);
  process.exit(1);
}
let host = "unknown host";
try {
  host = new URL(databaseUrl).host;
} catch {
  /* connect will report it better */
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})`);

const apply = process.argv.includes("--apply");
if (environment === "production" && !process.argv.includes("--yes-production")) {
  console.error("Refusing to run against the production database without --yes-production.");
  process.exit(1);
}
// Pilot is Matthew's own data, guarded by its OWN flag (db/script-env.mjs
// carries the reasoning): one flag for "any protected environment" would let
// somebody who meant one reach the other.
if (environment === "pilot" && !process.argv.includes("--yes-pilot")) {
  console.error("Refusing to run against the pilot database without --yes-pilot.");
  process.exit(1);
}
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-standards";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

// The same tagged-template shape the library expects, over this client.
const txn: TxnSql = async (strings, ...values) => {
  let text = "";
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i] ?? "";
    if (i < values.length) text += `$${i + 1}`;
  }
  const result = await client.query(text, values);
  return result.rows as Record<string, unknown>[];
};

try {
  const plan = await planStandardBackfill(txn, projectArg);

  if (plan.rows.length === 0 && plan.ambiguous.length === 0) {
    console.log("No confirmed spec carries a palette pick over the client's words. Nothing to do.");
    process.exit(0);
  }

  for (const row of plan.rows) {
    console.log(
      `  ${row.projectNumber}-${String(row.recordNo).padStart(3, "0")} ${row.label} (${row.fieldName})\n` +
        `      client said: ${row.clientWords}\n` +
        `      BW standard: ${row.option} (proposed)`,
    );
  }
  for (const row of plan.ambiguous) {
    console.log(`  ⚠ ${row.projectNumber}-${String(row.recordNo).padStart(3, "0")} ${row.label}: ${row.why}`);
  }

  if (!apply) {
    console.log(
      `\nDRY RUN — nothing was written. ${plan.rows.length} spec(s) would be restored` +
        (plan.ambiguous.length ? `, ${plan.ambiguous.length} left for a person` : "") +
        ". Re-run with -- --apply",
    );
    process.exit(0);
  }

  let changed = 0;
  for (const projectId of [...new Set(plan.rows.map((row) => row.projectId))]) {
    await client.query("begin");
    try {
      const result = await applyStandardBackfill(txn, projectId, plan.rows, actor);
      await client.query("commit");
      changed += result.changed;
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }
  console.log(
    `\nDone. ${changed} spec(s) restored to the client's words, each with its BW standard proposed beside it.` +
      (plan.ambiguous.length ? ` ${plan.ambiguous.length} left for a person.` : ""),
  );
} finally {
  await client.end();
}
