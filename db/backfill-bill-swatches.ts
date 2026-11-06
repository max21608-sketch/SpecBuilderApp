#!/usr/bin/env tsx
// A ONE-OFF pass: file the fabric lines of bills confirmed before 2026-10-05
// in each project's finishes library, as a confirm now does — an uncoded
// fabric as an in-house finish (`BW-AMB-001`), and each fabric line's picture
// as its code's swatch.
//
//   npm run db:backfill-bill-swatches                      dry run
//   npm run db:backfill-bill-swatches -- --apply           writes
//   npm run db:backfill-bill-swatches -- --project=<uuid>
//   npm run db:backfill-bill-swatches:local                the local stack
//
// ============================================================================
// The rules are in src/lib/bill-swatch-backfill.ts, so the db tier can prove
// them; this file is the guard around them, copied from backfill-standards.ts:
// it prints the resolved host before acting, refuses production without
// --yes-production and pilot without --yes-pilot (separate flags on purpose),
// and writes nothing without --apply.
//
// SAFE TO RE-RUN: an attribute already linked is not touched, a finish with a
// swatch keeps it, and a project with nothing left to do opens no change set.
//
// Set the project's short code FIRST if its in-house codes should read
// BW-<short code>-001: this pass mints in whatever series the project has.
//
// Local stack first, always. On the sandbox and pilot only by Max.
// ============================================================================
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import type { TxnSql } from "../src/lib/db-transaction";
import { applyBillSwatchBackfill, planBillSwatchBackfill } from "../src/lib/bill-swatch-backfill";

// The environment guard is db/script-env.mjs's, the one every db script uses:
// the resolved host printed first, pilot behind --yes-pilot and production
// behind --yes-production, separate flags on purpose.
const { databaseUrl } = requireScriptEnvironment("backfill-bill-swatches.ts", [
  "npm run db:backfill-bill-swatches           (reads .env.local)",
  "npm run db:backfill-bill-swatches:local     (the local stack)",
  "Add -- --apply to write; without it this is a dry run.",
]);
const apply = process.argv.includes("--apply");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-bill-swatches";

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
  const plan = await planBillSwatchBackfill(txn, projectArg);
  if (plan.length === 0) {
    console.log("No confirmed bill has a fabric line left to file. Nothing to do.");
    process.exit(0);
  }

  for (const project of plan) {
    console.log(`\n${project.projectNumber} ${project.projectName} — in-house codes mint as ${project.series}…`);
    for (const action of project.actions) {
      const at = `row ${action.rowNo} (${action.sheetName})`;
      if (action.kind === "link") console.log(`  ${at}: link to ${action.code} (same words)`);
      else if (action.kind === "mint") {
        console.log(
          action.firstRow === action.rowNo
            ? `  ${at}: new in-house fabric — “${action.says}”`
            : `  ${at}: same words as row ${action.firstRow} — one in-house code`,
        );
      } else console.log(`  ${at}: its picture becomes ${action.code}'s swatch`);
    }
    for (const note of project.notes) console.log(`  ⚠ ${note}`);
  }

  if (!apply) {
    const count = plan.reduce((total, project) => total + project.actions.length, 0);
    console.log(`\nDRY RUN — nothing was written. ${count} action(s) planned. Re-run with -- --apply`);
    process.exit(0);
  }

  let minted = 0;
  let linked = 0;
  let swatches = 0;
  for (const project of plan) {
    await client.query("begin");
    try {
      const result = await applyBillSwatchBackfill(txn, project, actor);
      await client.query("commit");
      minted += result.minted;
      linked += result.linked;
      swatches += result.swatches;
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }
  console.log(
    `\nDone. ${minted} in-house code(s) minted, ${linked} fabric spec(s) linked, ${swatches} swatch(es) given.` +
      " Every finish created is TBC until somebody confirms it.",
  );
} finally {
  await client.end();
}
