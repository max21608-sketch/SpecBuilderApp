#!/usr/bin/env tsx
// A ONE-OFF pass: give every record that predates 0012 a version 1.
//
//   npm run db:backfill-snapshots                      dry run
//   npm run db:backfill-snapshots -- --apply           writes
//   npm run db:backfill-snapshots -- --project=<uuid>
//
// Like every db/ script it loads `.env.local` when present, prints the
// resolved host before acting, and refuses production without
// --yes-production.
//
// ============================================================================
// WHY IT EXISTS, AND WHY IT IS HONEST RATHER THAN CLEVER.
//
// 0012 made every change produce a version. Records imported before it have
// none, so a history screen would show them as having appeared from nowhere.
//
// The tempting alternative is to reconstruct their past from audit_log, which
// HAS held whole-row before/after for every table since 0001. It is rejected:
// audit_log.row_id is text with no record_id, the rows are spread over four
// tables, and replaying them means inferring an order across tables that the
// log does not record. A reconstructed history that is subtly wrong is worse
// than one that starts today, because it will be believed.
//
// So this writes ONE version per record, under a change set called
// `history_begins`, whose reason says exactly that. What it holds is what the
// record is NOW — which is true, and which is the only thing anybody can
// check.
//
// NOT A MIGRATION, for the reason db/backfill-answers.ts gives: composing the
// version means running composeRowCells, and rebuilding that in SQL is the
// second composer the export design exists to prevent.
//
// SAFE TO RE-RUN. A record that already has a version is skipped, so a second
// pass writes nothing.
// ============================================================================
import pg from "pg";
import { loadRecordAtoms } from "../src/lib/record-atoms";
import { composeStoredCells } from "../src/lib/record-snapshot";
import { RECORD_ATOMS_SCHEMA_VERSION } from "../src/lib/record-atoms";
import { COMPOSER_VERSION } from "../src/lib/bws-export";

const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  npm run db:backfill-snapshots          (reads .env.local)");
  console.error("Add -- --apply to write; without it this is a dry run.");
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
  /* connect will report it better */
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})`);

const apply = process.argv.includes("--apply");
if (environment === "production" && !process.argv.includes("--yes-production")) {
  console.error("Refusing to run against the production database without --yes-production.");
  process.exit(1);
}
const projectArg = process.argv.find((arg) => arg.startsWith("--project="))?.split("=")[1] ?? null;

const actor = "system:backfill-snapshots";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

// The same tagged-template shape loadRecordAtoms expects, over this client.
const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  let text = "";
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i] ?? "";
    if (i < values.length) text += `$${i + 1}`;
  }
  const result = await client.query(text, values);
  return result.rows as Record<string, unknown>[];
};

try {
  const projects = await client.query(
    `select p.id, p.bws_project_number, p.name,
            (select count(*)::int from spec_records r
              where r.project_id = p.id
                and not exists (select 1 from record_snapshots s where s.record_id = r.id)) as without_history
       from projects p
      where ($1::uuid is null or p.id = $1::uuid)
      order by p.bws_project_number`,
    [projectArg],
  );

  const todo = projects.rows.filter((row) => Number(row.without_history) > 0);
  if (todo.length === 0) {
    console.log("Every record already has a version. Nothing to do.");
    process.exit(0);
  }

  let total = 0;
  for (const project of todo) {
    const count = Number(project.without_history);
    total += count;
    console.log(`${String(project.bws_project_number)} ${String(project.name)}: ${count} record(s) with no version`);

    if (!apply) continue;

    await client.query("begin");
    try {
      const change = await client.query(
        `insert into change_sets (project_id, kind, reason, closed_at, actor)
         values ($1, 'history_begins', $2, now(), $3) returning id`,
        [
          project.id,
          "Version history starts here. What each record held before this point was not recorded version by version; the audit trail still holds every column change.",
          actor,
        ],
      );
      const changeSetId = String(change.rows[0].id);
      // Published so write_audit() stamps the snapshot inserts with it too.
      await client.query(`select set_config('app.change_set_id', $1, true)`, [changeSetId]);

      const records = await client.query(
        `select r.id from spec_records r
          where r.project_id = $1
            and not exists (select 1 from record_snapshots s where s.record_id = r.id)
          order by r.record_no`,
        [project.id],
      );
      const ids = records.rows.map((row) => String(row.id));
      const atoms = await loadRecordAtoms(sql, ids);

      let written = 0;
      for (const id of ids) {
        const record = atoms.get(id);
        if (!record) continue;
        await client.query(
          `insert into record_snapshots
             (record_id, change_set_id, snapshot_no, schema_version, composer_version, atoms, cells)
           values ($1, $2, 1, $3, $4, $5::jsonb, $6::jsonb)
           on conflict (record_id, snapshot_no) do nothing`,
          [id, changeSetId, RECORD_ATOMS_SCHEMA_VERSION, COMPOSER_VERSION, JSON.stringify(record), JSON.stringify(composeStoredCells(record))],
        );
        written += 1;
      }
      await client.query("commit");
      console.log(`  wrote ${written} version(s).`);
    } catch (cause) {
      await client.query("rollback").catch(() => undefined);
      throw cause;
    }
  }

  console.log(
    apply
      ? `\nDone. ${total} record(s) now start at v1.`
      : `\nDRY RUN — nothing was written. ${total} record(s) would start at v1. Re-run with -- --apply`,
  );
} finally {
  await client.end();
}
