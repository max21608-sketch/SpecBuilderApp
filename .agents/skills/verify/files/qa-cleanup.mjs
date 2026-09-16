#!/usr/bin/env node
// Delete everything a QA run created, in foreign-key-safe order.
//
//   node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs
//   node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs --apply
//   ... --prefix='__QA 2026-09-16'      narrow it to one run
//
// DRY RUN IS THE DEFAULT. It prints what it would delete, per table, and
// touches nothing.
//
// ============================================================================
// WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN THE SKILL.
//
// The skill used to say "delete in foreign-key-safe order, children first".
// Working that order out by hand at the end of a verification run — tired,
// with a half-broken sandbox — is how a QA sweep either misses rows or hits a
// restrict and gets abandoned half-done. The order is knowledge; knowledge
// belongs in a file that runs.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH.
//
//   * audit_log  — append-only by trigger, and a QA sweep that deletes from it
//                  has broken the thing it was testing. The rows are orphaned
//                  and harmless: row_id is text and carries no FK.
//   * notes      — append-only for the same reason. A note is somebody's
//                  stated reason at the time, which is evidence.
//   * Vercel Blob — an attachment ROW goes; the uploaded file does not. This
//                  script has no blob credentials and should never be given
//                  any. Clear the store from the Vercel dashboard.
//
// It refuses production without --yes-production, and prints the resolved host
// before acting, the same as every db/ script. DATABASE_ENVIRONMENT is a
// declaration, not a probe: reading that line is what catches a mismatch.
// ============================================================================
import pg from "pg";

const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  node --env-file=.env.local .claude/skills/verify/files/qa-cleanup.mjs");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (!DATABASE_ENVIRONMENTS.includes(environment)) {
  console.error(`DATABASE_ENVIRONMENT must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}.`);
  console.error("Set it in the same env file as DATABASE_URL, so this script knows which database it is about to touch.");
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
// The prefix is the whole safety mechanism: nothing here is scoped by date or
// by "recent". Name QA data `__QA ...` at creation time or this cannot find it.
const prefix = process.argv.find((arg) => arg.startsWith("--prefix="))?.split("=")[1] ?? "__QA";
const like = `${prefix}%`;
// Throwaway logins are matched SEPARATELY, on their own convention, because a
// QA user is not scoped to a project and deriving one prefix from the other
// was how a narrowed run still proposed deleting somebody else's login.
// `--user-prefix=none` skips them.
const userPrefix = process.argv.find((arg) => arg.startsWith("--user-prefix="))?.split("=")[1] ?? "qa-";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows: projects } = await client.query("select id, name from projects where name like $1 order by name", [like]);
  const projectIds = projects.map((row) => row.id);
  const { rows: users } =
    userPrefix === "none"
      ? { rows: [] }
      : await client.query("select id, email from users where email like $1 order by email", [`${userPrefix}%`]);

  console.log(`\nProjects matching ${like}: ${projects.length}`);
  for (const project of projects) console.log(`  ${project.name}`);
  if (users.length) {
    console.log(`Throwaway users matching ${userPrefix}%: ${users.length}`);
    for (const user of users) console.log(`  ${user.email}`);
  }

  if (!projectIds.length && !users.length) {
    console.log("\nNothing to clean up.");
    process.exit(0);
  }

  // Gathered first, because several of these tables are scoped by their parent
  // and not by the project: spec_answers and record_attributes hang off a
  // record, and the polymorphic tables hang off an id with no foreign key at
  // all.
  const idsOf = async (statement) => (await client.query(statement, [projectIds])).rows.map((row) => row.id);
  const recordIds = await idsOf("select id from spec_records where project_id = any($1::uuid[])");
  const intakeRunIds = await idsOf("select id from intake_runs where project_id = any($1::uuid[])");
  const draftIds = await idsOf("select id from email_drafts where project_id = any($1::uuid[])");
  // Ingested email. Its project FK is ON DELETE SET NULL, so deleting the
  // project would leave the message orphaned in the Inbox rather than removing
  // it — it has to be swept explicitly, before the runs it points at.
  const messageIds = await idsOf("select id from email_messages where project_id = any($1::uuid[])");
  // Every id this sweep is about to remove. The polymorphic tables are matched
  // on entity_id ALONE: entity_type is written both ways in this database
  // ('spec_record' and 'spec_records', 'intake_run' and 'intake_runs'), so a
  // cleanup that filtered on one spelling would silently leave the other
  // behind.
  const everyId = [...projectIds, ...recordIds, ...intakeRunIds, ...draftIds, ...messageIds];

  // Foreign-key-safe order, children first. Several of these would cascade from
  // `projects`, but spec_records, spec_runs and email_draft_items are RESTRICT,
  // so the delete has to walk down anyway — and a list that only deletes what
  // would not cascade is a list nobody can check against the schema.
  const steps = [
    // Before intake_runs and email_drafts, which it references.
    ["email_messages", "delete from email_messages where id = any($1::uuid[])", messageIds],
    ["email_draft_items", "delete from email_draft_items where draft_id = any($1::uuid[])", draftIds],
    ["email_drafts", "delete from email_drafts where project_id = any($1::uuid[])", projectIds],
    ["spec_answers", "delete from spec_answers where record_id = any($1::uuid[])", recordIds],
    ["record_attributes", "delete from record_attributes where record_id = any($1::uuid[])", recordIds],
    ["spec_record_refs", "delete from spec_record_refs where project_id = any($1::uuid[])", projectIds],
    // Children before parents: a split record points at its parent with a
    // RESTRICT, and splits are capped at one level.
    ["spec_records (splits)", "delete from spec_records where project_id = any($1::uuid[]) and parent_id is not null", projectIds],
    ["spec_records", "delete from spec_records where project_id = any($1::uuid[])", projectIds],
    ["intake_runs", "delete from intake_runs where project_id = any($1::uuid[])", projectIds],
    ["intake_batches", "delete from intake_batches where project_id = any($1::uuid[])", projectIds],
    ["spec_runs", "delete from spec_runs where project_id = any($1::uuid[])", projectIds],
    ["project_notes", "delete from project_notes where project_id = any($1::uuid[])", projectIds],
    ["project_contacts", "delete from project_contacts where project_id = any($1::uuid[])", projectIds],
    // Polymorphic, no foreign key — scoped by the ids we are about to remove.
    ["attachments", "delete from attachments where entity_id = any($1::uuid[])", everyId],
    ["status_history", "delete from status_history where entity_id = any($1::uuid[])", everyId],
    ["messages", "delete from messages where entity_id = any($1::uuid[])", everyId],
    ["projects", "delete from projects where id = any($1::uuid[])", projectIds],
  ];

  console.log(apply ? "\nDeleting:" : "\nWould delete (dry run):");

  if (!apply) {
    for (const [label, statement, params] of steps) {
      const counted = statement.replace(/^delete from ([a-z_]+)/, "select count(*)::int as n from $1");
      const { rows } = await client.query(counted, [params]);
      const n = rows[0]?.n ?? 0;
      if (n) console.log(`  ${String(n).padStart(6)}  ${label}`);
    }
    for (const user of users) console.log(`       1  users (${user.email})`);
    console.log("\nNothing was deleted. Re-run with --apply.");
    console.log("audit_log and notes are left alone by design; Vercel Blob is not covered.");
    process.exit(0);
  }

  await client.query("begin");
  for (const [label, statement, params] of steps) {
    const result = await client.query(statement, [params]);
    if (result.rowCount) console.log(`  ${String(result.rowCount).padStart(6)}  ${label}`);
  }
  for (const user of users) {
    await client.query("delete from users where id = $1", [user.id]);
    console.log(`       1  users (${user.email})`);
  }
  await client.query("commit");
  console.log("\nDone. audit_log and notes were left alone by design.");
  console.log("Uploaded blobs are NOT deleted — clear them from the Vercel Blob dashboard.");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
