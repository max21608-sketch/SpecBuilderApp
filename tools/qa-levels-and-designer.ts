#!/usr/bin/env tsx
// Puts a level on every line item and a designer behind every one of them, so
// the chase screen can be walked before anybody has decided either for real.
//
//   npm run qa:levels -- --project=AP364c                 dry run
//   npm run qa:levels -- --project=AP364c --apply         writes
//   npm run qa:levels -- --project=AP364c --clear --apply puts it all back
//
// Sandbox only, no escape hatch: both things it writes are decisions a person
// is supposed to make, and this script makes them up.
//
// ============================================================================
// WHAT WAS BLOCKING, AND WHICH HALF OF IT THIS ANSWERS
//
// `groupByContact` refuses to chase a record for two separate reasons, and the
// drafts screen was reporting both at once:
//
//   "no designer on the record"  — spec_records.designer is free text off the
//                                  BOQ, and this bill carried none, so nothing
//                                  resolves to a contact to address.
//   "no level on the record"     — without simple/complex/hero, `questionTier`
//                                  cannot say which questions hold up a QUOTE,
//                                  and that is the whole message of the email.
//
// Both are deliberate refusals rather than defaults (CLAUDE.md, "A level is
// REQUIRED before anything is tiered"), so the only way past them is to decide.
// This decides arbitrarily, which is fine for looking at a screen and is NOT
// fine for anything else — hence the marker below and `--clear`.
//
// ---- HOW EACH IS WRITTEN --------------------------------------------------
//
// The LEVEL goes through `setRecordLevel`, the same function the record screen
// and the drafts screen's inline picker call: it takes the project lock, checks
// the version, opens a `level_set` change and snapshots the record. A level
// written straight into the column would be the one change in the project with
// no version and no why.
//
// The DESIGNER is a plain update, because there is no other path: the column is
// what a BOQ said, and nothing in the app edits it. It bumps the row version
// (audit trigger), and the level change that follows snapshots the record, so
// the value is not invisible.
// ============================================================================
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { setRecordLevel } from "@/lib/record-category";
import type { ItemLevel } from "@/lib/spec-vocab";

// The invented designer. example.com is IANA-reserved, so this address can
// never reach a person however far the data travels.
const DESIGNER_CODE = "PDS";
const DESIGNER_NAME = "Claire Beaumont";
const DESIGNER_EMAIL = "claire.beaumont@example.com";
const DESIGNER_ORG = "Panther Design Studio";

const ACTOR = "qa-seed";

const apply = process.argv.includes("--apply");
const clear = process.argv.includes("--clear");
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  npm run qa:levels -- --project=AP364c        (reads .env.local)");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (environment !== "sandbox") {
  console.error(`DATABASE_ENVIRONMENT is "${environment}". This script only ever runs against sandbox.`);
  process.exit(1);
}
if (!projectArg) {
  console.error("Name the project: --project=AP364c (its BWS project number, or its uuid).");
  process.exit(1);
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${new URL(databaseUrl).host})`);

// ---------------------------------------------------------------------------
// "Random" levels, from a hash of the record id.
//
// Deterministic on purpose: re-running must not reshuffle what somebody is
// half way through reading, and a level that changed every run would make the
// chase screen's tiering look unstable when it is not. Weighted so the mix
// resembles a real bill — most items ordinary, a few hero pieces — rather than
// a third each, which reads as obviously generated.
// ---------------------------------------------------------------------------
function levelFor(recordId: string): ItemLevel {
  let hash = 0;
  for (const char of recordId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const bucket = hash % 100;
  if (bucket < 45) return "simple";
  if (bucket < 82) return "complex";
  return "hero";
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const projects = await client.query(
    `select id, bws_project_number, name, status from projects
      where bws_project_number = $1 or name = $1 or id::text = $1`,
    [projectArg],
  );
  if (projects.rows.length !== 1) {
    console.error(
      projects.rows.length === 0
        ? `No project matches "${projectArg}".`
        : `"${projectArg}" matches ${projects.rows.length} projects. Name it by uuid.`,
    );
    process.exit(1);
  }
  const project = projects.rows[0];
  console.log(`Project: ${project.bws_project_number} ${project.name} (${project.status})\n`);

  // Active records on active runs — the same scope the drafts screen reads.
  const records = await client.query(
    `select r.id, r.record_no, r.item_description, r.level, r.designer, r.version, r.variant_label
       from spec_records r
       join spec_runs run on run.id = r.run_id
      where r.project_id = $1 and r.status = 'active' and run.status = 'active'
      order by r.record_no`,
    [project.id],
  );

  if (clear) {
    const withLevel = records.rows.filter((row) => row.level !== null);
    const withDesigner = records.rows.filter((row) => String(row.designer ?? "") === DESIGNER_CODE);
    console.log(`${withLevel.length} record(s) carry a level; ${withDesigner.length} carry designer ${DESIGNER_CODE}.`);
    if (!apply) {
      console.log("\nDry run. Add --apply to clear them and remove the contact.");
      process.exit(0);
    }
    for (const row of withLevel) {
      // Through the same function, so clearing is recorded the way setting was.
      // A level going back to null IS a decision ("I do not know yet") and the
      // history should say who unmade it.
      const current = await client.query(`select version from spec_records where id = $1`, [row.id]);
      await withTransaction((txn) =>
        setRecordLevel(txn, {
          recordId: String(row.id),
          level: null,
          expectedVersion: Number(current.rows[0].version),
          actor: ACTOR,
        }),
      );
    }
    const cleared = await client.query(
      `update spec_records set designer = null, updated_by = $2
        where project_id = $1 and designer = $3 returning id`,
      [project.id, ACTOR, DESIGNER_CODE],
    );
    const contact = await client.query(
      `delete from project_contacts where project_id = $1 and email = $2 returning id`,
      [project.id, DESIGNER_EMAIL],
    );
    console.log(
      `\nCleared ${withLevel.length} level(s), ${cleared.rows.length} designer code(s), ${contact.rows.length} contact(s).`,
    );
    process.exit(0);
  }

  // ---- the plan ------------------------------------------------------------
  const contactRows = await client.query(`select id, name, designer_code from project_contacts where project_id = $1 and email = $2`, [
    project.id,
    DESIGNER_EMAIL,
  ]);
  const needsContact = contactRows.rows.length === 0;

  const needsDesigner = records.rows.filter((row) => (row.designer ?? null) === null);
  const needsLevel = records.rows.filter((row) => row.level === null);
  const plan = needsLevel.map((row) => ({ row, level: levelFor(String(row.id)) }));
  const tally = { simple: 0, complex: 0, hero: 0 } as Record<ItemLevel, number>;
  for (const entry of plan) tally[entry.level] += 1;

  console.log(`${records.rows.length} active record(s) on active runs.`);
  console.log(`  contact:  ${needsContact ? `create ${DESIGNER_NAME} <${DESIGNER_EMAIL}>, code ${DESIGNER_CODE}` : "already there"}`);
  console.log(`  designer: ${needsDesigner.length} record(s) to stamp with ${DESIGNER_CODE}`);
  console.log(`  levels:   ${plan.length} to set — ${tally.simple} simple, ${tally.complex} complex, ${tally.hero} hero`);
  console.log(
    `  (records that already carry a level or a designer are left exactly as they are)\n`,
  );
  for (const entry of plan.slice(0, 8)) {
    const label = `${project.bws_project_number}-${String(entry.row.record_no).padStart(3, "0")}`;
    console.log(`    ${label}  ${entry.row.item_description}${entry.row.variant_label ? ` (${entry.row.variant_label})` : ""} → ${entry.level}`);
  }
  if (plan.length > 8) console.log(`    … and ${plan.length - 8} more`);

  if (!apply) {
    console.log("\nDry run. Nothing was written. Add --apply.");
    process.exit(0);
  }

  // ---- 1. the contact ------------------------------------------------------
  if (needsContact) {
    await client.query(
      `insert into project_contacts (project_id, name, email, organisation, role, designer_code, created_by, updated_by)
       values ($1, $2, $3, $4, 'designer', $5, $6, $6)`,
      [project.id, DESIGNER_NAME, DESIGNER_EMAIL, DESIGNER_ORG, DESIGNER_CODE, ACTOR],
    );
    console.log(`\nCreated the contact: ${DESIGNER_NAME} <${DESIGNER_EMAIL}>, designer code ${DESIGNER_CODE}.`);
  }

  // ---- 2. the designer code on the records --------------------------------
  // Before the levels, so the snapshot each level change takes already holds it.
  const stamped = await client.query(
    `update spec_records set designer = $3, updated_by = $2
      where project_id = $1 and status = 'active' and designer is null returning id`,
    [project.id, ACTOR, DESIGNER_CODE],
  );
  console.log(`Stamped ${stamped.rows.length} record(s) with designer ${DESIGNER_CODE}.`);

  // ---- 3. the levels -------------------------------------------------------
  let set = 0;
  for (const entry of plan) {
    // Re-read the version: the designer update above bumped every row it
    // touched, so the version read at planning time is already stale.
    const current = await client.query(`select version from spec_records where id = $1`, [entry.row.id]);
    await withTransaction((txn) =>
      setRecordLevel(txn, {
        recordId: String(entry.row.id),
        level: entry.level,
        expectedVersion: Number(current.rows[0].version),
        actor: ACTOR,
      }),
    );
    set += 1;
  }
  console.log(`Set ${set} level(s) — ${tally.simple} simple, ${tally.complex} complex, ${tally.hero} hero.`);
  console.log(`\nEvery one of these is invented. \`--clear --apply\` puts it back.`);
} finally {
  await client.end();
}
