#!/usr/bin/env tsx
// A ONE-OFF pass after 0050: mark every answer composed from a record's specs
// as `attribute`, and recompose the ones that stopped following them.
//
//   npm run db:backfill-answer-provenance                      dry run
//   npm run db:backfill-answer-provenance -- --apply           writes
//   npm run db:backfill-answer-provenance -- --project=<uuid>
//   npm run db:backfill-answer-provenance:local                the local stack
//
// ============================================================================
// The rules are in src/lib/answer-provenance-backfill.ts, so the pure tier and
// the db tier can prove them; this file is the guard around them, copied from
// backfill-bill-swatches.ts: it prints the resolved host before acting,
// refuses production without --yes-production and pilot without --yes-pilot
// (separate flags on purpose), and writes nothing without --apply.
//
// It REPLACES `db:backfill-answers` (retired with this file, audit B2), which
// predated qualifiers, the finishes library and BW standards and wrote outside
// any change set. This pass composes through `recomposeAnswers`, the path every
// writer uses, inside one change set per project, with a version of every
// record it writes.
//
// SAFE TO RE-RUN: only an answer still `document` is relabelled, so a second
// run finds nothing to do and opens no change set.
//
// Apply 0050 first, then deploy the code, then run this. Local stack first,
// always. On the sandbox and pilot only by Max.
// ============================================================================
import pg from "pg";
import type { TxnSql } from "../src/lib/db-transaction";
import { applyAnswerProvenance, planAnswerProvenance, type AnswerStatement } from "../src/lib/answer-provenance-backfill";

const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  npm run db:backfill-answer-provenance           (reads .env.local)");
  console.error("  npm run db:backfill-answer-provenance:local     (the local stack)");
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
// carries the reasoning).
if (environment === "pilot" && !process.argv.includes("--yes-pilot")) {
  console.error("Refusing to run against the pilot database without --yes-pilot.");
  process.exit(1);
}
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-answer-provenance";

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

const said = (statement: AnswerStatement) =>
  statement.state === "missing"
    ? "missing"
    : `“${statement.value ?? ""}${statement.qualifier ? ` - ${statement.qualifier}` : ""}” (${statement.state})`;

try {
  const plan = await planAnswerProvenance(txn, projectArg);

  let relabelled = 0;
  let changed = 0;
  let left = 0;
  let person = 0;
  let nothing = 0;
  for (const project of plan) {
    relabelled += project.relabelled;
    changed += project.changed.length;
    left += project.leftAsDocument;
    person += project.needsPerson.length;
    nothing += project.standingOnNothing;
    if (project.relabelled + project.leftAsDocument + project.needsPerson.length + project.standingOnNothing === 0) continue;
    console.log(`\n${project.projectNumber} ${project.projectName}`);
    console.log(
      `  confirmed over no spec, not a person's own (before this pass): ${project.standingOnNothing}` +
        ` · relabelled: ${project.relabelled} (value changes: ${project.changed.length})` +
        ` · left as document: ${project.leftAsDocument} · needs a person: ${project.needsPerson.length}`,
    );
    for (const line of project.changed) {
      console.log(`  ${line.recordLabel} ${line.field}: ${said(line.from)} → ${said(line.to)}`);
    }
    for (const line of project.needsPerson) {
      console.log(`  ! ${line.recordLabel} ${line.field}: holds ${said(line.held)}, its specs say ${said(line.composed)}. Left as it is.`);
    }
  }

  console.log(
    `\nAll projects: ${nothing} answer(s) confirmed over no spec before this pass · ${relabelled} relabelled ` +
      `(${changed} change value) · ${left} left as a reviewer's own · ${person} need a person.`,
  );

  if (!apply) {
    console.log("DRY RUN: nothing was written. Re-run with -- --apply");
    process.exit(0);
  }

  let written = 0;
  let recomposed = 0;
  for (const project of plan) {
    await client.query("begin");
    try {
      const result = await applyAnswerProvenance(txn, project, actor);
      await client.query("commit");
      written += result.relabelled;
      recomposed += result.recomposed;
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }
  console.log(`\nDone. ${written} answer(s) relabelled, ${recomposed} record(s) recomposed.`);
} finally {
  await client.end();
}
