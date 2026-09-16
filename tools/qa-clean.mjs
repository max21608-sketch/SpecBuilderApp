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
if (environment === "production") {
  console.error("Refusing to sweep the production database.");
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
    console.log("Nothing left behind.");
    process.exit(0);
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
  console.log(`Swept ${projects.rows.length} leftover project(s).`);
} finally {
  await client.end();
}
