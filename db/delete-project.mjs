#!/usr/bin/env node
// Deletes ONE project: its rows in one transaction, then its files.
//
//   node --env-file=.env.local db/delete-project.mjs --project=<id or number>            # dry run
//   node --env-file=.env.local db/delete-project.mjs --project=<id or number> --apply
//   npm run db:delete-project:local -- --project=<id or number> [--apply]               # the local stack
//
// Max, 2026-11-06: a project is deletable BY SCRIPT, never from the app. This
// is that script. What goes and what stays, and why, is at the head of
// `db/project-delete.mjs`; the schema half is 0055.
//
// THE GUARDS, in the order they run:
//   * `requireScriptEnvironment`: the resolved host is printed first, and
//     pilot needs --yes-pilot, production --yes-production (script-env.mjs).
//   * The project is named EXACTLY, by its id or its BWS project number.
//     Nothing is matched loosely, and a number two projects share is refused.
//   * A `TEST` project is kept on purpose (CLAUDE.md, "SharePoint is an
//     authorised source"): named for what it exercised and left in a state
//     worth demonstrating, and never matched by a sweep. Deleting one takes
//     --yes-test as well, so it is never the accidental result of a typed
//     number.
//   * Dry run is the default and prints what --apply would delete: every
//     table's row count, every file, and the mail that survives.
//
// FILES GO AFTER THE COMMIT, never inside it: blob I/O inside a transaction
// holds the project's locks across a network call, and a file deleted for a
// transaction that then rolls back leaves a row pointing at nothing. A file
// whose delete fails is an orphan under the project's prefix, named here, and
// a second run (or the store's own console) can remove it.
import pg from "pg";
import { del, list } from "@vercel/blob";
import { requireScriptEnvironment } from "./script-env.mjs";
import { deleteProjectRows, planProjectDeletion, projectPrefix } from "./project-delete.mjs";

const { databaseUrl, environment } = requireScriptEnvironment("delete-project.mjs");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowTest = args.includes("--yes-test");
const ref = args.find((arg) => arg.startsWith("--project="))?.slice("--project=".length).trim();
if (!ref) {
  console.error("Name the project: --project=<id or BWS project number>.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let plan;
try {
  const { rows } = await client.query(
    `select id, bws_project_number, name from projects where id::text = $1 or bws_project_number = $1`,
    [ref],
  );
  if (rows.length === 0) {
    console.error(`No project has the id or number "${ref}".`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`"${ref}" names ${rows.length} projects; name one by its id:`);
    for (const row of rows) console.error(`  ${row.id}  ${row.bws_project_number}  ${row.name}`);
    process.exit(1);
  }
  const project = rows[0];
  const isTest = [project.bws_project_number, project.name].some((text) => String(text ?? "").startsWith("TEST"));
  if (isTest && !allowTest) {
    console.error(`${project.bws_project_number} (${project.name}) is a TEST project, kept on purpose. Add --yes-test to delete it.`);
    process.exit(1);
  }

  plan = await planProjectDeletion(client, project.id);
  console.log(`\n${environment}: ${project.bws_project_number} -- ${project.name} (${project.id})\n`);
  for (const entry of plan.counts.filter((count) => count.rows > 0)) {
    console.log(`  ${entry.table.padEnd(24)} ${entry.rows}`);
  }
  console.log(`  ${"audit_log".padEnd(24)} kept (append-only by design)`);
  if (plan.messagesKept > 0) {
    console.log(`\n  ${plan.messagesKept} message(s) arrived through the mailbox and stay, taken off the project (unassigned).`);
  }
  console.log(`\n  ${plan.blobPaths.length} file(s) the database records under ${projectPrefix(project.id)}:`);
  for (const pathname of plan.blobPaths) console.log(`    ${pathname}`);

  // What the STORE holds under the prefix that no row names: a failed
  // confirm's upload, an earlier crop. Listed where the store can list; the
  // local stack's store does not, and says so.
  const orphans = await storeOnly(project.id, plan.blobPaths);
  if (orphans.listed) {
    console.log(`  ${orphans.paths.length} more file(s) in the store under the prefix that no row names:`);
    for (const pathname of orphans.paths) console.log(`    ${pathname}`);
    plan.blobPaths = [...plan.blobPaths, ...orphans.paths];
  } else {
    console.log(`  (The store could not be listed: ${orphans.reason}. Only the files above will be deleted.)`);
  }

  if (!apply) {
    console.log("\nDry run. Nothing was deleted. Add --apply to delete all of the above.");
    process.exit(0);
  }

  await deleteProjectRows(client, project.id);
  console.log(`\nDeleted ${project.bws_project_number}'s rows in one transaction.`);
} finally {
  await client.end();
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (plan.blobPaths.length === 0) {
  console.log("No files to delete.");
} else if (!token) {
  console.error(`BLOB_READ_WRITE_TOKEN is not set, so ${plan.blobPaths.length} file(s) were NOT deleted:`);
  for (const pathname of plan.blobPaths) console.error(`  ${pathname}`);
  process.exit(1);
} else {
  let deleted = 0;
  const failed = [];
  for (let start = 0; start < plan.blobPaths.length; start += 100) {
    const batch = plan.blobPaths.slice(start, start + 100);
    try {
      await del(batch, { token });
      deleted += batch.length;
    } catch (error) {
      failed.push(...batch.map((pathname) => `${pathname} (${error instanceof Error ? error.message : String(error)})`));
    }
  }
  console.log(`Deleted ${deleted} of ${plan.blobPaths.length} file(s).`);
  if (failed.length > 0) {
    console.error("These were NOT deleted, and are orphans under the project's prefix now:");
    for (const line of failed) console.error(`  ${line}`);
    process.exit(1);
  }
}

/** Pathnames under the project's prefix that the store holds and no row names. */
async function storeOnly(projectId, known) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { listed: false, reason: "BLOB_READ_WRITE_TOKEN is not set" };
  const seen = new Set(known);
  const paths = [];
  try {
    let cursor;
    do {
      const page = await list({ prefix: projectPrefix(projectId), cursor, token });
      for (const blob of page.blobs) if (!seen.has(blob.pathname)) paths.push(blob.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    return { listed: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { listed: true, paths: paths.sort() };
}
