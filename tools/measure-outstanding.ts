#!/usr/bin/env tsx
// What a project still owes, and how long it takes to ask.
//
//   npm run measure:outstanding -- --project=<projects.id>
//   npm run measure:outstanding                              every active project
//   npm run measure:outstanding -- --project=<id> --top=20   longer tables
//
// READ ONLY. No UPDATE, no INSERT, no DELETE, so there is no --apply and no
// --yes-production. It still prints the resolved host first, because
// `house/conventions.md` §3 is about knowing which database answered.
//
// ============================================================================
// WHY THIS EXISTS
//
// Four things print the to-quote figure — the phase table's TGQ column, the
// project overview's tiles, the chase button, and the infill screen (2.3) —
// and they are supposed to be one number arrived at once. They have already
// disagreed twice: 167 against 202 on the sandbox Panther project when
// `loadProjectSummary` carried a predicate `loadOutstanding` did not, and 48
// against 6 when two gate models both answered to the name TGQ.
//
// So this runs the loader the screens run, counts what comes back, and prints
// the number. If it moves when a screen changes, a screen has grown a second
// implementation. A sentence in a document cannot be re-run.
//
// It also times the loader and weighs the payload, because 2.3 and 2.7 are
// list screens over it and "it renders in under two seconds" is a row of their
// definition of done. 19,582 questions is a real answer for a 300-line
// project, and shipping all of them to a browser to draw 300 collapsed rows is
// a decision somebody has to take with the number in front of them.
//
// THE COUNTING IS `src/lib/outstanding-measure.ts`, which is pure and tested.
// Everything here is I/O and printing.
// ============================================================================
import { sql } from "@/lib/db";
import { loadOutstanding, loadUncategorisedRecords } from "@/lib/chase-drafts";
import { loadTgqMatrices } from "@/lib/gate-load";
import { measureOutstanding } from "@/lib/outstanding-measure";

// Kept in step with tools/vocab-gap.ts, which declares it the same way.
const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with: npm run measure:outstanding   (reads .env.local)");
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
  // A malformed URL fails at connect time with a better message than this one.
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})  [read only]\n`);

const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length) ?? null;
const topArg = Number(process.argv.find((arg) => arg.startsWith("--top="))?.slice("--top=".length) ?? 10);
const top = Number.isFinite(topArg) && topArg > 0 ? Math.floor(topArg) : 10;

const projects = projectArg
  ? await sql`select id, bws_project_number, name, status from projects where id = ${projectArg}`
  : await sql`select id, bws_project_number, name, status from projects order by bws_project_number`;

if (projects.length === 0) {
  console.error(projectArg ? "No such project." : "No projects.");
  process.exit(1);
}

// ONE load of the gate overlay for the whole run. `loadOutstanding` loads its
// own per call, which is what the screens do; loading a second copy here would
// not change the tier it already decided — this set is only used to say WHICH
// model decided it.
const matrices = await loadTgqMatrices(sql);
const matrixCategories = new Set(matrices.keys());

const n = (value: number) => value.toLocaleString("en-GB");

for (const project of projects) {
  const projectId = String(project.id);
  const started = Date.now();
  const outstanding = await loadOutstanding(projectId);
  const elapsed = Date.now() - started;

  const uncategorised = await loadUncategorisedRecords(projectId);
  const measurement = measureOutstanding(outstanding, matrixCategories);

  // WHAT SHIPPING IT WOULD COST. The question rows as the drafts route sends
  // them — every field of every row, which is what `GET /api/drafts` does
  // today. Measured rather than estimated, because the decision the infill
  // route has to take is whether a collapsed line can carry its questions.
  const payloadBytes = Buffer.byteLength(JSON.stringify(outstanding), "utf8");

  console.log(`${String(project.bws_project_number)} — ${String(project.name)}  (${projectId})`);
  console.log(`  status ${String(project.status)}`);
  console.log(`  loadOutstanding                 ${n(elapsed)} ms`);
  console.log(`  outstanding questions           ${n(measurement.questions)}`);
  console.log(`    spec field                    ${n(measurement.specField)}`);
  console.log(`    readiness                     ${n(measurement.readiness)}`);
  console.log(`    missing / TBC                 ${n(measurement.missing)} / ${n(measurement.tbc)}`);
  console.log(`  TO QUOTE                        ${n(measurement.toQuote)}`);
  console.log(
    `    from Matthew's matrix         ${n(measurement.toQuoteFromMatrix)}  (${n(measurement.recordsOnMatrix)} records)`,
  );
  console.log(
    `    from the 0019 fallback        ${n(measurement.toQuoteFromFallback)}  (${n(measurement.recordsOnFallback)} records)`,
  );
  console.log(`  also outstanding                ${n(measurement.later)}`);
  // A QUESTION WITH NO TIER IS NOT A QUESTION THAT DOES NOT BLOCK A QUOTE.
  // Its record has no level, so neither model can answer, and the screens say
  // "Set level" rather than counting it either way.
  console.log(`  no tier (record has no level)   ${n(measurement.noTier)}`);
  console.log(`  records with something open     ${n(measurement.records)}`);
  console.log(`  furniture lines                 ${n(measurement.lines)}`);
  console.log(`  uncategorised records           ${n(uncategorised.length)}  (no questions at all)`);
  console.log(
    `  areas                           ${n(measurement.areas)}  (${n(measurement.questionsWithNoArea)} questions with none)`,
  );
  console.log(
    `  payload if shipped whole        ${n(Math.round(payloadBytes / 1024))} KB  (${
      measurement.questions ? Math.round(payloadBytes / measurement.questions) : 0
    } bytes a question)`,
  );

  if (measurement.byRecord.length > 0) {
    console.log(`\n  PER RECORD — worst ${Math.min(top, measurement.byRecord.length)} by to-quote`);
    for (const row of measurement.byRecord.slice(0, top)) {
      console.log(
        `    ${row.recordLabel.padEnd(14)} ${String(row.toQuote).padStart(4)} TGQ  ${String(row.total).padStart(4)} total  ${row.itemDescription.slice(0, 44)}`,
      );
    }
  }

  if (measurement.byQuestion.length > 0) {
    console.log(`\n  PER QUESTION — worst ${Math.min(top, measurement.byQuestion.length)} by to-quote`);
    for (const row of measurement.byQuestion.slice(0, top)) {
      console.log(
        `    ${String(row.toQuote).padStart(4)} TGQ  ${String(row.records).padStart(4)} items  ${row.prompt.slice(0, 50)}${
          row.fieldLabel ? `  [BWS: ${row.fieldLabel.trim()}]` : ""
        }`,
      );
    }
  }
  console.log("");
}

process.exit(0);
