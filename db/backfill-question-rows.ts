#!/usr/bin/env tsx
// A ONE-OFF pass after seed 0014: give every live record the checklist rows
// its category's newer questions need, and fill them from its own specs.
//
//   npm run db:backfill-question-rows                      dry run
//   npm run db:backfill-question-rows -- --apply           writes
//   npm run db:backfill-question-rows -- --project=<uuid>
//   npm run db:backfill-question-rows:local                the local stack
//
// ============================================================================
// The rules are in src/lib/question-rows-backfill.ts, so the db tier can prove
// them; this file is the guard around them, copied from
// backfill-answer-provenance.ts: it prints the resolved host before acting,
// refuses production without --yes-production and pilot without --yes-pilot
// (separate flags on purpose), and writes nothing without --apply.
//
// ORDER: migrate (0061, 0062) -> deploy -> seed (0014-0016) -> THIS. Before the
// seed there is nothing for it to add on the cabinetry sheets; before the
// deploy the app that reads the rows is not there. Local stack first, always.
// On the sandbox and pilot only by Max.
//
// SAFE TO RE-RUN: a second run finds no row to add and opens no change set.
// ============================================================================
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import type { TxnSql } from "../src/lib/db-transaction";
import { applyQuestionRows, planQuestionRows } from "../src/lib/question-rows-backfill";

const { databaseUrl } = requireScriptEnvironment("backfill-question-rows.ts", [
  "npm run db:backfill-question-rows           (reads .env.local)",
  "npm run db:backfill-question-rows:local     (the local stack)",
  "Add -- --apply to write; without it this is a dry run.",
]);
const apply = process.argv.includes("--apply");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-question-rows";

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
  const plan = await planQuestionRows(txn, projectArg);

  let rows = 0;
  let records = 0;
  let fills = 0;
  let also = 0;
  let undecided = 0;
  for (const project of plan) {
    if (project.rowsToAdd === 0) continue;
    const projectFills = project.records.reduce((n, record) => n + record.fills.length, 0);
    const projectAlso = project.records.reduce((n, record) => n + record.alsoRecomposed.length, 0);
    rows += project.rowsToAdd;
    records += project.records.length;
    fills += projectFills;
    also += projectAlso;
    undecided += project.undecided.length;
    console.log(`\n${project.projectNumber} ${project.projectName}`);
    console.log(
      `  rows to add: ${project.rowsToAdd} on ${project.records.length} record(s), each re-versioned` +
        ` · filled from the item's specs: ${projectFills} · rows already there that the recompose changes: ${projectAlso}` +
        ` · left for a person: ${project.undecided.length}`,
    );
    for (const record of project.records) {
      for (const fill of record.fills) console.log(`  ${record.recordLabel} ${fill.prompt}: missing → “${fill.value}” (${fill.state})`);
      for (const line of record.alsoRecomposed) console.log(`  ${record.recordLabel} ${line.prompt}: ${line.from} → ${line.to} (already there)`);
    }
    for (const line of project.undecided) {
      console.log(
        `  ! ${line.recordLabel} “${line.prompt}”: left missing. A spec on this item speaks to its field ` +
          `(${line.specs.join("; ")}) but says nothing the checklist can take. A person answers it.`,
      );
    }
  }

  console.log(
    `\nAll projects: ${rows} row(s) to add on ${records} record(s) · ${fills} filled from specs · ` +
      `${also} existing row(s) recomposed · ${undecided} left for a person.`,
  );

  if (!apply) {
    console.log("DRY RUN: nothing was written. Re-run with -- --apply");
    process.exit(0);
  }

  let added = 0;
  let versioned = 0;
  for (const project of plan) {
    if (project.rowsToAdd === 0) continue;
    await client.query("begin");
    try {
      const result = await applyQuestionRows(txn, project, actor);
      await client.query("commit");
      added += result.rowsAdded;
      versioned += result.recordsVersioned;
      if (result.rowsAdded > 0) {
        console.log(`  ${project.projectNumber}: ${result.rowsAdded} row(s) added, ${result.recordsVersioned} record(s) re-versioned.`);
      }
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }
  console.log(`\nDone. ${added} row(s) added, ${versioned} record(s) re-versioned.`);
} finally {
  await client.end();
}
