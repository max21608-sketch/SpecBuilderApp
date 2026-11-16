// Database tier — `snapshotRecords` versions N records in a CONSTANT number of
// statements, and numbers each one exactly as the per-record loop did
// (review 4A, 2026-11-16).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/snapshot-batch.test.ts
//
// The writer used to run a `select max(snapshot_no)` and an `insert` per
// record: a 300-line bill confirm was 600 statements inside its transaction.
// It is one insert now. What must NOT have changed is the contract — one
// version per record per transaction, each record's own max + 1, sorted order,
// and the map of numbers returned — so this test counts the statements through
// the `TxnSql` seam and reads the numbers back from the table.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { deleteProjectRows } from "../../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;

/** The transaction's own sql, counting every statement sent through it. */
function counting(txn: TxnSql): { sql: TxnSql; count: () => number } {
  let n = 0;
  return {
    sql: (strings, ...values) => {
      n += 1;
      return txn(strings, ...values);
    },
    count: () => n,
  };
}

describeIfDb("snapshotRecords writes every record's version in one statement", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let recordNo = 9800;

  async function records(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      recordNo += 1;
      const rows = await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
         values ($1, $2, $3, 'active', $4, $5, 'qa', 'qa') returning id`,
        [projectId, runId, recordNo, categoryId, `__QA Snapshot ${recordNo}`],
      );
      ids.push(String(rows.rows[0].id));
    }
    return ids;
  }

  async function snapshotCounted(ids: string[]): Promise<{ written: Map<string, number>; statements: number }> {
    return withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa", reason: "__QA batch" });
      const counted = counting(txn);
      const written = await snapshotRecords(counted.sql, ids, changeSetId);
      return { written, statements: counted.count() };
    });
  }

  async function numbers(ids: string[]): Promise<Map<string, number[]>> {
    const rows = await client.query(
      `select record_id, snapshot_no from record_snapshots where record_id = any($1::uuid[]) order by record_id, snapshot_no`,
      [ids],
    );
    const out = new Map<string, number[]>();
    for (const row of rows.rows) {
      const list = out.get(String(row.record_id)) ?? [];
      list.push(Number(row.snapshot_no));
      out.set(String(row.record_id), list);
    }
    return out;
  }

  beforeAll(async () => {
    await client.connect();
    categoryId = String(
      (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)).rows[0].id,
    );
    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90171")}', '__QA Snapshot batch', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
    runId = String(
      (
        await client.query(
          `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("two records and twelve records cost the same number of statements", async () => {
    const two = await snapshotCounted(await records(2));
    const twelve = await snapshotCounted(await records(12));
    expect(two.written.size).toBe(2);
    expect(twelve.written.size).toBe(12);
    expect(twelve.statements).toBe(two.statements);
  });

  it("numbers each record from its OWN last version, in a mixed batch, and returns them sorted", async () => {
    const [old, fresh] = await records(2);
    await snapshotCounted([old!]);
    await snapshotCounted([old!]);
    // `old` is at v2, `fresh` has none: one batch must give v3 and v1.
    const { written } = await snapshotCounted([fresh!, old!, old!]);
    expect(written.get(old!)).toBe(3);
    expect(written.get(fresh!)).toBe(1);
    expect([...written.keys()]).toEqual([old!, fresh!].sort());
    const stored = await numbers([old!, fresh!]);
    expect(stored.get(old!)).toEqual([1, 2, 3]);
    expect(stored.get(fresh!)).toEqual([1]);
  });

  it("a second call in the same transaction writes nothing more, and an empty list writes nothing", async () => {
    const ids = await records(3);
    const result = await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa", reason: "__QA twice" });
      const first = await snapshotRecords(txn, ids, changeSetId);
      const second = await snapshotRecords(txn, ids, changeSetId);
      const none = await snapshotRecords(txn, [], changeSetId);
      return { first, second, none };
    });
    expect([...result.first.values()]).toEqual([1, 1, 1]);
    expect(result.second.size).toBe(0);
    expect(result.none.size).toBe(0);
    const stored = await numbers(ids);
    for (const id of ids) expect(stored.get(id)).toEqual([1]);
  });
});
