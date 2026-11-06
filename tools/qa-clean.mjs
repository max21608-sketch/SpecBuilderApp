#!/usr/bin/env node
// Removes every row a database-tier test run left behind.
//
// house/conventions.md §12: QA data is prefixed `__QA ` so cleanup is one
// sweep. A suite that fails partway through leaves its project in place, and
// the NEXT run then fails on the unique project number rather than on whatever
// was actually wrong — which is how a real failure gets mistaken for a flake.
//
// audit_log is deliberately untouched: it is append-only by design and a
// cleanup that deletes from it has broken the thing under test.
//
// A PROJECT GOES THROUGH `db/project-delete.mjs`, the one deletion path
// `npm run db:delete-project` uses too (0055, audit B5). This file used to
// delete thirteen tables by hand in an order it hoped was FK-safe, and never
// deleted `email_messages` -- so any `__QA` project that had received fake mail
// failed the sweep on the message's own CHECK, and the next run inherited it.
// Two copies of "how a project is deleted" is how one of them misses a table.
//
// Rows only. The files a swept project named stay in the store: this sweep
// runs against the sandbox store, which holds company data, and deleting from
// it is `db:delete-project`'s job, one named project at a time, with its dry
// run in front of it.
import pg from "pg";
import { deleteProjectRows } from "../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  node --env-file=.env.local tools/qa-clean.mjs");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
// A DENYLIST WOULD HAVE MISSED PILOT. This read `=== "production"` when pilot
// arrived (2026-09-19), so the one script whose whole job is to DELETE rows
// would have swept Matthew's database on a mistyped --env-file — and there is
// no --yes-pilot escape hatch here, because a sweep has no reason to run
// anywhere but sandbox. `src/middleware.ts` learned the same lesson: an
// allowlist fails closed, a denylist fails open on the value nobody added.
if (environment !== "sandbox") {
  console.error(`DATABASE_ENVIRONMENT is "${environment}". This sweep only ever runs against sandbox.`);
  process.exit(1);
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${new URL(databaseUrl).host})`);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  // `left(..., 5)`, never `like '__QA%'`: in LIKE an underscore is a
  // single-character wildcard, so that pattern matches anything with QA in
  // the third and fourth places. The category sweep below learned it first.
  const projects = await client.query(
    `select id, bws_project_number from projects
      where left(bws_project_number, 5) = '__QA ' or left(name, 5) = '__QA '`,
  );
  if (projects.rows.length === 0) {
    console.log("No leftover projects.");
  }
  const failed = [];
  for (const project of projects.rows) {
    try {
      await deleteProjectRows(client, project.id, { actor: "script:qa-clean" });
      console.log(`  swept ${project.bws_project_number}`);
    } catch (error) {
      failed.push(project.bws_project_number);
      console.error(`  could not sweep ${project.bws_project_number}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (projects.rows.length > 0) {
    console.log(`Swept ${projects.rows.length - failed.length} of ${projects.rows.length} leftover project(s).`);
  }
  if (failed.length > 0) process.exitCode = 1;

  // ==========================================================================
  // A `__QA ` CATEGORY IS NOT REACHABLE FROM A PROJECT, AND THAT IS WHY THIS
  // IS HERE.
  //
  // Everything above is keyed on a project id. `tests/db/chase-drafts.test.ts`
  // creates its own `item_categories` row and three `requirements` against it,
  // and a run whose teardown fails under concurrent-run contention leaves them
  // behind — where nothing could ever sweep them, because they hang off no
  // project.
  //
  // That is worse than an orphan row. `requirements` is SEED data every
  // category reads, so three leftovers moved a project-wide count and failed
  // `tests/db/spec-field-gates.test.ts` on every later run, in every worktree,
  // for every agent — reading as a seed regression in whatever commit happened
  // to be under test. It cost three separate coders time on 2026-09-23 before
  // the cause was found.
  //
  // MATCHED ON `left(name, 5)`, NOT ON `like '__QA%'`. In SQL LIKE an
  // underscore is a single-character wildcard, so `'__QA%'` matches anything
  // with QA in the third and fourth places. The project sweep above was
  // written that way until 2026-11-06 (audit B9) and matches on `left` now
  // too; here it matters most, because the seventeen cheat sheets are the
  // requirement matrix this whole app reads. A sweep that could reach one would
  // be a script capable of emptying that register.
  // ==========================================================================
  const categories = await client.query(`select id, name from item_categories where left(name, 5) = '__QA '`);
  for (const category of categories.rows) {
    const id = category.id;
    // Answers before requirements before the category: the FK chain, deepest
    // first, so a failure names the row it could not delete rather than a
    // constraint two tables away.
    await client.query(
      `delete from spec_answers where requirement_id in (select id from requirements where category_id = $1)`,
      [id],
    );
    await client.query(`delete from requirements where category_id = $1`, [id]);
    await client.query(`delete from item_category_aliases where category_id = $1`, [id]).catch(() => undefined);
    await client.query(`delete from spec_matrix_category_map where item_category_id = $1`, [id]);
    await client.query(`delete from item_categories where id = $1`, [id]);
    console.log(`  swept category ${category.name}`);
  }
  if (categories.rows.length > 0) {
    console.log(`Swept ${categories.rows.length} leftover categor${categories.rows.length === 1 ? "y" : "ies"}.`);
  }

  if (projects.rows.length === 0 && categories.rows.length === 0) console.log("Nothing left behind.");
} finally {
  await client.end();
}
