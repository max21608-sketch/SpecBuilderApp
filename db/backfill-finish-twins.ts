#!/usr/bin/env tsx
// A ONE-OFF pass: merge the finishes library's twins a project already holds
// (Max, 2026-10-13) — a bare `MTL-01` beside its one zoned `GR-MTL-01`, and a
// `GR-FAB-13 PL-FUR-04` filed with its item's code still on the end beside
// `GR-FAB-13`.
//
//   npm run db:backfill-finish-twins                       dry run
//   npm run db:backfill-finish-twins -- --apply            writes
//   npm run db:backfill-finish-twins -- --project=<uuid>
//   npm run db:backfill-finish-twins:local                 the local stack
//
// ============================================================================
// The rules are in src/lib/finish-twin-backfill.ts; this file is the guard
// around them, copied from backfill-bill-swatches.ts: it prints the resolved
// host before acting, refuses production without --yes-production and pilot
// without --yes-pilot (separate flags on purpose), and writes nothing without
// --apply. One change set per project, under system:backfill-finish-twins.
//
// A twin whose description, swatch or BW standard differs from its canonical
// row's is SKIPPED and named: a person decides. A twin left empty is retired
// (reversible); one that still holds something is left and reported.
//
// SAFE TO RE-RUN. Local stack first, always. On pilot only by Max.
// ============================================================================
import pg from "pg";
import { requireScriptEnvironment } from "./script-env.mjs";
import type { TxnSql } from "../src/lib/db-transaction";
import { applyFinishTwins, planFinishTwins } from "../src/lib/finish-twin-backfill";

// The environment guard is db/script-env.mjs's, the one every db script uses:
// the resolved host printed first, pilot behind --yes-pilot and production
// behind --yes-production, separate flags on purpose.
const { databaseUrl } = requireScriptEnvironment("backfill-finish-twins.ts", [
  "npm run db:backfill-finish-twins           (reads .env.local)",
  "npm run db:backfill-finish-twins:local     (the local stack)",
  "Add -- --apply to write; without it this is a dry run.",
]);
const apply = process.argv.includes("--apply");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-finish-twins";

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
  const plan = await planFinishTwins(txn, projectArg);
  if (plan.length === 0) {
    console.log("No project's library holds a twin. Nothing to do.");
    process.exit(0);
  }

  for (const project of plan) {
    console.log(`\n${project.projectNumber} ${project.projectName} — ${project.libraryCount} finishes in the library`);
    for (const merge of project.merges) {
      console.log(
        `  merge ${merge.twin.code} (${merge.twin.uses} spec${merge.twin.uses === 1 ? "" : "s"}) into ${merge.canonical.code}` +
          `${merge.why === "zone" ? " — the same code without its zone" : " — its item's code taken off"}` +
          `${merge.retire ? "; the empty twin is retired" : ""}`,
      );
    }
    for (const note of project.leftInPlace) console.log(`  · ${note}`);
    for (const note of project.skipped) console.log(`  ⚠ skipped: ${note}`);
  }

  if (!apply) {
    const count = plan.reduce((total, project) => total + project.merges.length, 0);
    console.log(`\nDRY RUN — nothing was written. ${count} merge(s) planned. Re-run with -- --apply`);
    process.exit(0);
  }

  let relinked = 0;
  let retired = 0;
  let records = 0;
  for (const project of plan) {
    await client.query("begin");
    try {
      const result = await applyFinishTwins(txn, project, actor);
      await client.query("commit");
      relinked += result.relinked;
      retired += result.retired;
      records += result.records;
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }
  console.log(`\nDone. ${relinked} spec(s) re-linked on ${records} record(s), ${retired} empty twin(s) retired.`);
} finally {
  await client.end();
}
