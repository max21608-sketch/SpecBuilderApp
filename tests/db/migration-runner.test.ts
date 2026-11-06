// Database tier — db/migration-runner.mjs: the ledger is written in the same
// transaction as the file, two runners apply a file once, and an applied file
// that has since been edited is reported.
//
// ============================================================================
// THREE WAYS THE LEDGER COULD SAY SOMETHING THE DATABASE DID NOT DO (audit B9).
//
//   * The runner committed the file and THEN inserted its ledger row, as two
//     statements. A crash, a dropped connection or a Ctrl-C between them left
//     a schema change with no ledger row, and the next run applied the file
//     again -- on a forward-only migration with no `if not exists`, that is a
//     failure on the next promotion; on one that inserts rows, a duplicate.
//   * Nothing stopped two runners at once. Both read an empty ledger, both
//     applied the file. Two terminals during a promotion is exactly when.
//   * Nothing noticed an applied file being edited. The house rule is never
//     to (conventions §4), and a rule nobody can check is a hope.
//
// Each test runs the REAL runner over a directory of scratch migrations named
// for this process, against a scratch table named for this process, and
// removes its own ledger rows after. The ledger is shared; nothing else in it
// is touched.
// ============================================================================
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { describeIfDb, QA_RUN_SUFFIX } from "./db-tier";
import { runMigrations } from "../../db/migration-runner.mjs";

const databaseUrl = process.env.DATABASE_URL;
const PROBE = `qa_ledger_probe_${QA_RUN_SUFFIX}`;
const quiet = () => undefined;

describeIfDb("the migration runner", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const second = new pg.Client({ connectionString: databaseUrl });
  const dirs: string[] = [];
  const files: string[] = [];

  /** A directory holding the given scratch migrations, named for this process. */
  function scratch(entries: Record<string, string>): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "qa-ledger-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(entries)) {
      writeFileSync(path.join(dir, name), text);
      files.push(name);
    }
    return dir;
  }

  async function probeRows(): Promise<number> {
    const { rows } = await client.query<{ n: string }>(`select count(*) as n from ${PROBE}`);
    return Number(rows[0]!.n);
  }

  async function ledger(name: string): Promise<{ filename: string; checksum: string | null } | undefined> {
    const { rows } = await client.query<{ filename: string; checksum: string | null }>(
      `select filename, checksum from schema_migrations where filename = $1`,
      [name],
    );
    return rows[0];
  }

  beforeAll(async () => {
    await client.connect();
    await second.connect();
    await client.query(`create table ${PROBE} (n integer not null)`);
  });

  afterAll(async () => {
    await client.query(`delete from schema_migrations where filename = any($1::text[])`, [files]);
    await client.query(`drop table if exists ${PROBE}`);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    await client.end();
    await second.end();
  });

  it("writes the ledger row inside the file's own transaction", async () => {
    const good = `9990_qa_ledger_${QA_RUN_SUFFIX}.sql`;
    const bad = `9991_qa_ledger_${QA_RUN_SUFFIX}.sql`;
    const dir = scratch({
      [good]: `begin;\ninsert into ${PROBE} values (1);\ncommit;\n`,
      // Fails AFTER its insert: the insert and the ledger row must both be gone.
      [bad]: `begin;\ninsert into ${PROBE} values (2);\nselect 1 / 0;\ncommit;\n`,
    });
    await expect(runMigrations({ client, dir, log: quiet })).rejects.toThrow(/division by zero/);
    expect(await ledger(good)).toMatchObject({ filename: good });
    expect(await ledger(bad)).toBeUndefined();
    expect(await probeRows()).toBe(1);
    // And the transaction the failure left is gone with it: the connection is
    // usable, not stuck in an aborted transaction.
    await expect(client.query("select 1")).resolves.toBeTruthy();
  });

  it("records a checksum, and warns, never fails, when an applied file has changed", async () => {
    const name = `9992_qa_ledger_${QA_RUN_SUFFIX}.sql`;
    const dir = scratch({ [name]: `begin;\ninsert into ${PROBE} values (3);\ncommit;\n` });
    await runMigrations({ client, dir, log: quiet });
    expect((await ledger(name))?.checksum).toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(path.join(dir, name), `begin;\ninsert into ${PROBE} values (33);\ncommit;\n`);
    const again = await runMigrations({ client, dir, log: quiet });
    expect(again.applied).toEqual([]);
    expect(again.warnings.join("\n")).toContain(name);
  });

  it("applies a file once when two runners start together", async () => {
    const name = `9993_qa_ledger_${QA_RUN_SUFFIX}.sql`;
    // Slow enough that both runners have read the ledger before either commits.
    const dir = scratch({ [name]: `begin;\nselect pg_sleep(0.5);\ninsert into ${PROBE} values (4);\ncommit;\n` });
    const before = await probeRows();
    const results = await Promise.all([
      runMigrations({ client, dir, log: quiet }),
      runMigrations({ client: second, dir, log: quiet }),
    ]);
    expect(await probeRows()).toBe(before + 1);
    expect(results.map((result) => result.applied.length).sort()).toEqual([0, 1]);
  });

  it("refuses a file that does not end in its own commit, before running any of it", async () => {
    const name = `9994_qa_ledger_${QA_RUN_SUFFIX}.sql`;
    const dir = scratch({ [name]: `insert into ${PROBE} values (5);\n` });
    const before = await probeRows();
    await expect(runMigrations({ client, dir, log: quiet })).rejects.toThrow(/begin; \.\.\. commit;/);
    expect(await probeRows()).toBe(before);
    expect(await ledger(name)).toBeUndefined();
  });
});
