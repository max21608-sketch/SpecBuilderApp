// Database tier — every single-row spec edit takes the RECORD's lock before
// the row it edits (audit B6, E8, 2026-11-06; `src/lib/record-lock.ts`).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/lock-order.test.ts
//
// ============================================================================
// HOW EACH CASE IS FORCED, NEVER RACED.
//
// Connection A plays a RECORDS-FIRST writer — `editCommonSpec`, a drawings or
// spec-document confirm, `applyProjectWide` — by taking the record's row lock
// and holding it. Connection B then runs the edit under test. We wait until B
// is genuinely blocked (`pg_blocking_pids`, never a sleep: change-history's
// race test passed with its lock deleted because a pause was slower than the
// race), and A then asks for the row B edits, as the records-first writer
// would next.
//
//   * Edit takes the ROW first (the defect): B holds the row and is waiting for
//     the record; A holds the record and now waits for the row. Postgres
//     breaks the cycle after `deadlock_timeout` and one side dies with 40P01,
//     which the reviewer read as "someone else was changing this".
//   * Edit takes the RECORD first (the fix): B is waiting on the record and
//     holds nothing, so A gets the row at once, commits, and B carries on.
//
// The slot races are the other half of E8: two edits moving two values into
// one slot both passed the occupancy check while neither held the record, and
// the second met `record_attributes_dimension_slot_key` as a 500. With the
// record locked first the second waits, then reads the first's value and is
// refused in words.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { DomainConflictError, withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers, restoreAttribute, retireAttribute } from "@/lib/attribute-retire";
import { correctAttribute } from "@/lib/attribute-correct";
import { editAnswer } from "@/lib/answer-edit";
import { resolveDisagreement } from "@/lib/disagreement-resolve";
import { setAttributeFinish } from "@/lib/finish-edit";
import { normaliseFinishCode } from "@/lib/finishes";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-lock@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

/** A tagged-sql shim over a raw client, so this test owns begin and commit. */
const asSql =
  (c: pg.Client): TxnSql =>
  async (strings, ...values) => {
    let text = "";
    for (let i = 0; i < strings.length; i += 1) {
      text += strings[i] ?? "";
      if (i < values.length) text += `$${i + 1}`;
    }
    return (await c.query(text, values)).rows;
  };

describeIfDb("the record is locked before the row an edit touches", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let recordNo = 9700;

  async function record(): Promise<string> {
    recordNo += 1;
    return withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "boq_confirm", actor: "qa" });
      const inserted = await txn`
        insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
        values (${projectId}, ${runId}, ${recordNo}, 'active', ${categoryId}, ${`__QA Lock ${recordNo}`}, 'qa', 'qa')
        returning id
      `;
      const recordId = String(inserted[0]!.id);
      await txn`
        insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
        select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
          from requirements q where q.category_id = ${categoryId}
      `;
      let order = 0;
      for (const [slot, value] of [
        ["W", "1900"],
        ["D", "790"],
        ["H", "720"],
      ] as const) {
        order += 1;
        await txn`
          insert into record_attributes
            (record_id, attr_group, label, value, unit, dimension_slot, state, sort_order, created_by, updated_by)
          values (${recordId}, 'dimension', ${slot}, ${value}, 'mm', ${slot}, 'confirmed', ${order}, 'qa', 'qa')
        `;
      }
      await recomposeAnswers(txn, recordId, null, "qa");
      await snapshotRecords(txn, [recordId], changeSetId);
      return recordId;
    });
  }

  async function attribute(recordId: string, slot: string): Promise<{ id: string; version: number }> {
    const rows = await client.query(
      `select id, version from record_attributes where record_id = $1 and dimension_slot = $2 and status = 'active'`,
      [recordId, slot],
    );
    return { id: String(rows.rows[0].id), version: Number(rows.rows[0].version) };
  }

  async function waitUntilBlocked(pid: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const blocked = await client.query(`select cardinality(pg_blocking_pids($1)) > 0 as blocked`, [pid]);
      if (blocked.rows[0].blocked) return;
      if (Date.now() > deadline) throw new Error("the edit never blocked on the held record");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Any backend this pid is blocking — for a route that opens its own connection. */
  async function waitUntilSomethingWaitsOn(pid: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const waiting = await client.query(
        `select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`,
        [pid],
      );
      if (waiting.rows[0].n > 0) return;
      if (Date.now() > deadline) throw new Error("nothing ever waited on the held record");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * A holds the record; B runs `edit`; once B waits, A asks for `rowSql` (the
   * row B edits) as a records-first writer would next. Resolves with B's
   * result, or rejects with whatever either side met.
   */
  async function againstRecordsFirstWriter<T>(
    recordId: string,
    rowSql: string,
    rowId: string,
    edit: (sql: TxnSql) => Promise<T>,
  ): Promise<T> {
    const a = new pg.Client({ connectionString: databaseUrl });
    const b = new pg.Client({ connectionString: databaseUrl });
    await a.connect();
    await b.connect();
    try {
      await a.query("begin");
      await a.query("set local lock_timeout = '8s'");
      await b.query("begin");
      await b.query("set local lock_timeout = '8s'");
      const pidB = (await b.query(`select pg_backend_pid() as pid`)).rows[0].pid;
      await a.query(`select id from spec_records where id = $1 for update`, [recordId]);

      const running = edit(asSql(b));
      // Never an unhandled rejection while A is still deciding.
      running.catch(() => undefined);
      await waitUntilBlocked(pidB);

      // The records-first writer's next step. With the defect this is the
      // half of a deadlock; with the fix B holds nothing and it returns.
      await a.query(rowSql, [rowId]);
      await a.query("commit");
      const result = await running;
      await b.query("commit");
      return result;
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  }

  const LOCK_ATTRIBUTE = `select id from record_attributes where id = $1 for update`;
  const LOCK_ANSWER = `select id from spec_answers where id = $1 for update`;

  beforeAll(async () => {
    await client.connect();
    categoryId = String(
      (
        await client.query(
          `select q.category_id from requirements q join spec_fields f on f.id = q.spec_field_id
            where f.json_id = 3 order by q.category_id limit 1`,
        )
      ).rows[0].category_id,
    );
    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90046")}', '__QA Lock order', 'qa', 'qa') returning id`,
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

  // ---- B6 / E8: no deadlock against a records-first writer -----------------

  it("correctAttribute waits for the record rather than deadlocking (the editCommonSpec inversion)", async () => {
    const recordId = await record();
    const width = await attribute(recordId, "W");
    const result = await againstRecordsFirstWriter(recordId, LOCK_ATTRIBUTE, width.id, (sql) =>
      correctAttribute(sql, {
        attributeId: width.id,
        expectedVersion: width.version,
        value: "1830",
        unit: "mm",
        state: "confirmed",
        reason: "__QA misread",
        actor: "__qa-b@example.test",
      }),
    );
    expect(result.supersededId).toBe(width.id);
  }, 30_000);

  it("retireAttribute waits for the record rather than deadlocking", async () => {
    const recordId = await record();
    const depth = await attribute(recordId, "D");
    const result = await againstRecordsFirstWriter(recordId, LOCK_ATTRIBUTE, depth.id, (sql) =>
      retireAttribute(sql, { attributeId: depth.id, expectedVersion: depth.version, reason: "__QA wrong", actor: "__qa-b@example.test" }),
    );
    expect(result.attributeId).toBe(depth.id);
  }, 30_000);

  it("restoreAttribute waits for the record rather than deadlocking", async () => {
    const recordId = await record();
    const height = await attribute(recordId, "H");
    await withTransaction((txn) =>
      retireAttribute(txn, { attributeId: height.id, expectedVersion: height.version, reason: "__QA off", actor: "qa" }),
    );
    const retired = Number((await client.query(`select version from record_attributes where id = $1`, [height.id])).rows[0].version);
    const result = await againstRecordsFirstWriter(recordId, LOCK_ATTRIBUTE, height.id, (sql) =>
      restoreAttribute(sql, { attributeId: height.id, expectedVersion: retired, reason: "__QA back", actor: "__qa-b@example.test" }),
    );
    expect(result.attributeId).toBe(height.id);
  }, 30_000);

  it("setAttributeFinish waits for the record rather than deadlocking", async () => {
    const recordId = await record();
    const code = `__QA-LK-${recordNo}`;
    const finish = await client.query(
      `insert into project_finishes (project_id, code, code_norm, state, created_by, updated_by)
       values ($1, $2, $3, 'tbc', 'qa', 'qa') returning id`,
      [projectId, code, normaliseFinishCode(code)],
    );
    const fabric = await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, material_code, state, sort_order, created_by, updated_by)
       values ($1, 'material', 'Fabric', '__QA Wool', $2, 'confirmed', 9, 'qa', 'qa') returning id, version`,
      [recordId, code],
    );
    const result = await againstRecordsFirstWriter(recordId, LOCK_ATTRIBUTE, String(fabric.rows[0].id), (sql) =>
      setAttributeFinish(sql, {
        attributeId: String(fabric.rows[0].id),
        finishId: String(finish.rows[0].id),
        expectedVersion: Number(fabric.rows[0].version),
        reason: "__QA link",
        actor: "__qa-b@example.test",
      }),
    );
    expect(result.recordId).toBe(recordId);
  }, 30_000);

  it("resolveDisagreement ('use this instead') waits for the record rather than deadlocking", async () => {
    const recordId = await record();
    const width = await attribute(recordId, "W");
    const disagreement = await client.query(
      `insert into attribute_disagreements
         (project_id, record_id, held_attribute_id, attr_group, label, value, unit, dimension_slot, state, status, created_by, updated_by)
       values ($1, $2, $3, 'dimension', 'W', '1950', 'mm', 'W', 'confirmed', 'open', 'qa', 'qa') returning id, version`,
      [projectId, recordId, width.id],
    );
    const result = await againstRecordsFirstWriter(recordId, LOCK_ATTRIBUTE, width.id, (sql) =>
      resolveDisagreement(sql, {
        disagreementId: String(disagreement.rows[0].id),
        decision: "used_this",
        expectedVersion: Number(disagreement.rows[0].version),
        heldVersion: width.version,
        reason: "__QA the tracker is newer",
        actor: "__qa-b@example.test",
      }),
    );
    expect(result.supersededId).toBe(width.id);
  }, 30_000);

  it("editAnswer waits for the record rather than deadlocking (B6)", async () => {
    const recordId = await record();
    const answer = await client.query(
      `select id, version from spec_answers where record_id = $1 and state = 'missing' order by id limit 1`,
      [recordId],
    );
    const result = await againstRecordsFirstWriter(recordId, LOCK_ANSWER, String(answer.rows[0].id), (sql) =>
      editAnswer(sql, {
        answerId: String(answer.rows[0].id),
        value: "__QA typed",
        state: "confirmed",
        expectedVersion: Number(answer.rows[0].version),
        actor: "__qa-b@example.test",
      }),
    );
    expect(result.answer.value).toBe("__QA typed");
  }, 30_000);

  it("the apply-to-many route locks the records before the answers (B6)", async () => {
    const recordId = await record();
    const answer = await client.query(
      `select a.id, a.version, a.requirement_id from spec_answers a
         join requirements q on q.id = a.requirement_id
         left join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and a.state = 'missing' and coalesce(f.json_id, 0) <> 3
        order by a.id limit 1`,
      [recordId],
    );
    const row = answer.rows[0];
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");

    const a = new pg.Client({ connectionString: databaseUrl });
    await a.connect();
    try {
      await a.query("begin");
      await a.query("set local lock_timeout = '8s'");
      const pidA = (await a.query(`select pg_backend_pid() as pid`)).rows[0].pid;
      await a.query(`select id from spec_records where id = $1 for update`, [recordId]);

      const pressed = POST(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: "__QA Approved",
            state: "confirmed",
            rows: [{ recordId, requirementId: String(row.requirement_id), answerId: String(row.id), version: Number(row.version) }],
          }),
        }),
        { params: Promise.resolve({ id: projectId }) },
      );
      await waitUntilSomethingWaitsOn(pidA);
      await a.query(LOCK_ANSWER, [String(row.id)]);
      await a.query("commit");

      const res = await pressed;
      const body = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.filed).toHaveLength(1);
    } finally {
      await a.query("rollback").catch(() => undefined);
      await a.end().catch(() => undefined);
    }
  }, 30_000);

  // ---- E8: one slot, two writers — refused in words, never a 500 -----------

  /**
   * B and C each move a value into the SAME slot. C must wait for B, then see
   * B's value there and be refused naming it.
   */
  async function secondIntoSlot(
    first: (sql: TxnSql) => Promise<unknown>,
    second: (sql: TxnSql) => Promise<unknown>,
  ): Promise<unknown> {
    const b = new pg.Client({ connectionString: databaseUrl });
    const c = new pg.Client({ connectionString: databaseUrl });
    await b.connect();
    await c.connect();
    try {
      await b.query("begin");
      await c.query("begin");
      await c.query("set local lock_timeout = '8s'");
      const pidC = (await c.query(`select pg_backend_pid() as pid`)).rows[0].pid;
      await first(asSql(b));
      const running = second(asSql(c));
      running.catch(() => undefined);
      await waitUntilBlocked(pidC);
      await b.query("commit");
      return await running.then(
        () => null,
        (cause: unknown) => cause,
      );
    } finally {
      await b.query("rollback").catch(() => undefined);
      await c.query("rollback").catch(() => undefined);
      await b.end().catch(() => undefined);
      await c.end().catch(() => undefined);
    }
  }

  it("two corrections moving two values into one slot: the second is refused in words", async () => {
    const recordId = await record();
    const depth = await attribute(recordId, "D");
    const height = await attribute(recordId, "H");
    // Free SH first, so both corrections find it empty.
    const into = (id: string, version: number, value: string) => (sql: TxnSql) =>
      correctAttribute(sql, {
        attributeId: id,
        expectedVersion: version,
        value,
        unit: "mm",
        dimensionSlot: "SH",
        state: "confirmed",
        reason: "__QA it is the seat height",
        actor: "__qa@example.test",
      });
    const refused = await secondIntoSlot(into(depth.id, depth.version, "440"), into(height.id, height.version, "450"));
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("slot_taken");
    expect((refused as DomainConflictError).message).toContain("440");
  }, 30_000);

  it("two restores into one slot: the second is refused in words", async () => {
    const recordId = await record();
    const width = await attribute(recordId, "W");
    // Two retired widths, the live one gone: both restores find W empty.
    const spare = await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state, status,
                                      retired_at, retired_by, sort_order, created_by, updated_by)
       values ($1, 'dimension', 'W', '1850', 'mm', 'W', 'confirmed', 'retired', now(), 'qa', 9, 'qa', 'qa')
       returning id, version`,
      [recordId],
    );
    await withTransaction((txn) =>
      retireAttribute(txn, { attributeId: width.id, expectedVersion: width.version, reason: "__QA off", actor: "qa" }),
    );
    const widthVersion = Number((await client.query(`select version from record_attributes where id = $1`, [width.id])).rows[0].version);
    const restore = (id: string, version: number) => (sql: TxnSql) =>
      restoreAttribute(sql, { attributeId: id, expectedVersion: version, reason: "__QA back", actor: "__qa@example.test" });
    const refused = await secondIntoSlot(
      restore(width.id, widthVersion),
      restore(String(spare.rows[0].id), Number(spare.rows[0].version)),
    );
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("slot_taken");
  }, 30_000);
});
