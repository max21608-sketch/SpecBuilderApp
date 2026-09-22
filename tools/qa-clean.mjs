#!/usr/bin/env node
// Removes every row a database-tier test run left behind.
//
// house/conventions.md §12: QA data is prefixed `__QA ` so cleanup is one
// sweep. A suite that fails partway through leaves its project in place, and
// the NEXT run then fails on the unique project number rather than on whatever
// was actually wrong — which is how a real failure gets mistaken for a flake.
//
// audit_log is deliberately untouched: it is append-only by design and a
// cleanup that deletes from it has broken the thing under test. change_sets
// and record_snapshots go with the project by cascade (0013, 0014), which is
// why the project is deleted LAST.
import pg from "pg";

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
  const projects = await client.query(
    `select id, bws_project_number from projects where bws_project_number like '__QA%' or name like '__QA%'`,
  );
  if (projects.rows.length === 0) {
    console.log("No leftover projects.");
  }
  for (const project of projects.rows) {
    const id = project.id;
    await client.query(`delete from email_draft_items where draft_id in (select id from email_drafts where project_id = $1)`, [id]).catch(() => undefined);
    await client.query(`delete from email_drafts where project_id = $1`, [id]).catch(() => undefined);
    await client.query(`delete from project_contacts where project_id = $1`, [id]).catch(() => undefined);
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [id]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [id]);
    await client.query(`delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`, [id]);
    await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in (select id from spec_records where project_id = $1)`, [id]);
    await client.query(`delete from spec_records where project_id = $1`, [id]);
    await client.query(`delete from project_notes where project_id = $1`, [id]).catch(() => undefined);
    await client.query(`delete from spec_runs where project_id = $1`, [id]);
    await client.query(`delete from intake_runs where project_id = $1`, [id]);
    await client.query(`delete from intake_batches where project_id = $1`, [id]).catch(() => undefined);
    await client.query(`delete from projects where id = $1`, [id]);
    console.log(`  swept ${project.bws_project_number}`);
  }
  if (projects.rows.length > 0) console.log(`Swept ${projects.rows.length} leftover project(s).`);

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
  // with QA in the third and fourth places. The queries above have always been
  // written that way and are safe because they also key on a project; a DELETE
  // against `item_categories` is not, and the seventeen cheat sheets are the
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
    await client.query(`delete from spec_matrix_category_map where category_id = $1`, [id]).catch(() => undefined);
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
