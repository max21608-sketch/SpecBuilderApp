// The migration runner's core, apart from its CLI (`db/run-migrations.mjs`) so
// a test can drive it against a directory of scratch files.
//
// ============================================================================
// THE LEDGER ROW IS WRITTEN BY THE FILE'S OWN TRANSACTION (audit B9).
//
// Every migration wraps itself in `begin; ... commit;` (conventions §4), and
// this runner used to send the file, then insert its ledger row as a second
// statement. A crash, a dropped connection or a Ctrl-C between the two left
// the schema changed and the ledger silent, and the next run applied the file
// AGAIN: on a forward-only file with no `if not exists`, a failure in the
// middle of a promotion; on one that inserts rows, a duplicate. Now the ledger
// insert is put INTO the file's text, immediately before its closing
// `commit;`, so the change and the record of it commit or roll back together.
//
// That needs the file to have the shape the house rule says it has: `begin;`
// first and `commit;` last, each on its own line. A file without it is
// refused BEFORE anything runs, in words, rather than run without its ledger
// row. (Every file 0001-0057 has it; a `create index concurrently`, which
// cannot run inside a transaction, would have to be its own deliberate change
// to this runner.)
//
// TWO RUNNERS APPLY A FILE ONCE. A session advisory lock is held for the whole
// run, and the ledger is read AFTER it is taken, so a second runner waits and
// then finds the first one's rows. Two terminals during a promotion is exactly
// when that matters.
//
// AN EDITED APPLIED FILE IS REPORTED, NEVER REFUSED. 0056 gives the ledger a
// `checksum` (sha256 of the file's bytes), written with the row from then on.
// A file whose text no longer matches is a WARNING: the house rule is never to
// edit an applied migration, and failing the run would stop every promotion
// over a comment fix somebody already made. Files applied before 0056 have no
// checksum and are counted, not compared -- recording today's text as if it
// were what ran would be a guess presented as a record.
//
// A FAILED FILE IS ROLLED BACK HERE. Postgres stops a multi-statement string at
// its first error and leaves the session inside the aborted transaction; the
// CLI exits anyway, but a caller that goes on using the connection would see
// "current transaction is aborted" on everything after.
// ============================================================================
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One constant for this app's runner, so two runners serialise on it. */
const RUNNER_LOCK = 8_414_952_033;

/** What a migration may be called. Also what makes it safe to quote below. */
const FILENAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

export function checksumOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The file's text with its ledger insert placed before its closing `commit;`.
 * Throws, naming the file, when it is not `begin; ... commit;`.
 */
export function withLedgerInsert(sqlText, filename, checksum) {
  if (!FILENAME.test(filename)) {
    throw new Error(`${filename}: a migration is named 0000_snake_case.sql.`);
  }
  if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error(`${filename}: not a sha256 checksum.`);
  // Comments and blank lines aside, the first statement is `begin;` and the
  // last is `commit;`, each on a line of its own.
  const meaningful = sqlText
    .split("\n")
    .map((line, index) => ({ index, text: line.trim() }))
    .filter((line) => line.text !== "" && !line.text.startsWith("--"));
  const first = meaningful[0];
  const last = meaningful.at(-1);
  if (!first || !last || !/^begin\s*;$/i.test(first.text) || !/^commit\s*;$/i.test(last.text)) {
    throw new Error(
      `${filename} is not wrapped in begin; ... commit; (each on its own line), so its ledger row cannot be written inside it. Nothing was run.`,
    );
  }
  // The column exists from 0056 on; a run that applies 0054 and 0056 together
  // writes 0054's row without it and 0056's with it. Planned only when its
  // branch runs, so the insert naming the column is never planned without it.
  const ledger = `
do $ledger$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = current_schema() and table_name = 'schema_migrations' and column_name = 'checksum') then
    insert into schema_migrations (filename, checksum) values ('${filename}', '${checksum}');
  else
    insert into schema_migrations (filename) values ('${filename}');
  end if;
end $ledger$;
`;
  const lines = sqlText.split("\n");
  lines.splice(last.index, 0, ledger);
  return lines.join("\n");
}

export async function runMigrations({ client, dir, log = console.log }) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await client.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  await client.query("select pg_advisory_lock($1)", [RUNNER_LOCK]);
  try {
    const { rows: hasChecksum } = await client.query(
      `select 1 from information_schema.columns
        where table_schema = current_schema() and table_name = 'schema_migrations' and column_name = 'checksum'`,
    );
    const { rows: applied } = await client.query(
      hasChecksum.length > 0
        ? "select filename, checksum from schema_migrations"
        : "select filename, null::text as checksum from schema_migrations",
    );
    const recorded = new Map(applied.map((row) => [row.filename, row.checksum]));

    const result = { applied: [], skipped: [], warnings: [] };
    let unchecked = 0;
    for (const file of files) {
      const sqlText = readFileSync(path.join(dir, file), "utf8");
      const checksum = checksumOf(sqlText);
      if (recorded.has(file)) {
        log(`Skipping ${file} (already applied).`);
        result.skipped.push(file);
        const was = recorded.get(file);
        if (was == null) {
          unchecked += 1;
        } else if (was !== checksum) {
          const warning = `WARNING: ${file} has changed since it was applied. Never edit an applied migration; add another one (conventions §4).`;
          console.warn(warning);
          result.warnings.push(warning);
        }
        continue;
      }
      const text = withLedgerInsert(sqlText, file, checksum);
      log(`Applying ${file}...`);
      try {
        await client.query(text);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
      log(`  done.`);
      result.applied.push(file);
    }
    if (unchecked > 0) log(`(${unchecked} applied file(s) predate the ledger's checksum and were not compared.)`);
    return result;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [RUNNER_LOCK]).catch(() => undefined);
  }
}
