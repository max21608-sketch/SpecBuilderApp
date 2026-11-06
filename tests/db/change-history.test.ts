// Database tier. Skips silently without DATABASE_URL — a green `npm test` does
// not mean these ran. Run them with:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) npm test
//
// Every row it creates is prefixed `__QA ` and deleted in FK-safe order.
// audit_log is deliberately left alone: it is append-only by design.
// change_sets and record_snapshots ARE cleaned up, because unlike audit_log
// they are scoped to a project this test created and would otherwise leave a
// project's whole trail behind.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { editAnswer } from "@/lib/answer-edit";
import { withTransaction, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { createAttribute } from "@/lib/manual-capture";
import { snapshotRecords } from "@/lib/record-snapshot";
import { takeBaseline } from "@/lib/baselines";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { loadProjectHistory } from "@/lib/change-history";
import type { SqlLike } from "@/lib/record-atoms";

// The history route is behind a session like every other read. Nothing else in
// this file imports it.
// `sessionEmail` lets one test be the actor whose open change the changes
// route reports.
let sessionEmail = "__qa@example.test";
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: sessionEmail,
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

/** The tables whose every audited write must belong to a change set. */
const SPEC_CONTENT_TABLES = ["spec_records", "spec_answers", "record_attributes", "spec_record_refs"];

describeIfDb("0012 change sets and versions", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00012")}', '__QA Change history', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;
    const category = await client.query(`select id from item_categories order by sort_order limit 1`);
    categoryId = category.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(
      `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    // Records first: 0013 lets a version go with the record it describes, and
    // refuses it any other way. The project goes last and its change sets go
    // with it by cascade (0014) — they cannot be deleted while it exists.
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function openChange(kind: string, reason: string | null = null): Promise<string> {
    const row = await client.query(
      `insert into change_sets (project_id, kind, reason, closed_at, actor)
       values ($1, $2, $3, now(), 'qa') returning id`,
      [projectId, kind, reason],
    );
    return row.rows[0].id;
  }

  it("stamps every audited write in the transaction with the change set", async () => {
    await client.query("begin");
    const changeSetId = await openChange("boq_confirm");
    await client.query(`select set_config('app.change_set_id', $1, true)`, [changeSetId]);
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9001, $3, '__QA Sofa', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    // Every real write path ends by taking a version. This fixture does the
    // same, because the coverage test at the bottom checks that it did — and
    // a fixture exempt from the rule it is testing proves nothing.
    await client.query(
      `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
       values ($1, $2, 1, '{}'::jsonb, '[]'::jsonb)`,
      [record.rows[0].id, changeSetId],
    );
    await client.query("commit");

    const log = await client.query(
      `select change_set_id from audit_log where table_name = 'spec_records' and row_id = $1`,
      [record.rows[0].id],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].change_set_id).toBe(changeSetId);
  });

  it("records nothing on a write outside a change, rather than failing it", async () => {
    // Phase 1 records the gap; it does not refuse the write. A hard refusal
    // here would have broken every path between this migration and the one
    // that converts them.
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9002, $3, '__QA Unlinked', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const log = await client.query(
      `select change_set_id from audit_log where table_name = 'spec_records' and row_id = $1`,
      [record.rows[0].id],
    );
    expect(log.rows[0].change_set_id).toBeNull();
  });

  it("numbers versions per record, from 1", async () => {
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9003, $3, '__QA Numbered', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const recordId = record.rows[0].id;
    const atoms = JSON.stringify({ schemaVersion: 1 });
    for (const no of [1, 2, 3]) {
      const changeSetId = await openChange("manual_edit");
      await client.query(
        `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
         values ($1, $2, $3, $4::jsonb, '[]'::jsonb)`,
        [recordId, changeSetId, no, atoms],
      );
    }
    const rows = await client.query(
      `select snapshot_no from record_snapshots where record_id = $1 order by snapshot_no`,
      [recordId],
    );
    expect(rows.rows.map((row) => row.snapshot_no)).toEqual([1, 2, 3]);
  });

  it("lets one change hold two versions of a record, and still refuses a repeated number", async () => {
    // 0052 dropped `record_snapshots_record_change_key`: an OPEN change spans
    // many transactions, and each of them is a version (audit B1). What the
    // database still refuses is two versions with one NUMBER.
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9004, $3, '__QA Two in one change', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const changeSetId = await openChange("manual_edit");
    for (const no of [1, 2]) {
      await client.query(
        `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
         values ($1, $2, $3, '{}'::jsonb, '[]'::jsonb)`,
        [record.rows[0].id, changeSetId, no],
      );
    }
    await expect(
      client.query(
        `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
         values ($1, $2, 2, '{}'::jsonb, '[]'::jsonb)`,
        [record.rows[0].id, changeSetId],
      ),
    ).rejects.toThrow(/record_snapshots_record_no_key/);
  });

  // ---- B1: one version per TRANSACTION while a change is open ---------------
  //
  // Max, 2026-11-06. The snapshot insert was `on conflict (record_id,
  // change_set_id) do nothing`, written for ONE transaction touching a record
  // twice. An open change spans many, so the first edit to a record took the
  // version and every later edit in the same change took none: the version
  // held W, D surfaced in the NEXT change's diff under that change's reason,
  // and a baseline taken in between froze a state the record never had.

  async function openPersonChange(actor: string): Promise<string> {
    return withTransaction((txn) =>
      openChangeSet(txn, { projectId, kind: "manual_edit", actor, reason: "__QA a client's email", open: true }),
    );
  }

  async function newRecord(recordNo: number, description: string): Promise<string> {
    const row = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'active', 'qa', 'qa') returning id`,
      [projectId, runId, recordNo, categoryId, description],
    );
    return row.rows[0].id;
  }

  function dimension(recordId: string, slot: "W" | "D", value: string, actor: string) {
    return {
      recordId,
      attrGroup: "dimension",
      label: slot === "W" ? "Width" : "Depth",
      value,
      unit: "mm",
      dimensionSlot: slot,
      state: "confirmed" as const,
      actor,
    };
  }

  async function versionsOf(recordId: string) {
    const rows = await client.query(
      `select snapshot_no, change_set_id, atoms from record_snapshots where record_id = $1 order by snapshot_no`,
      [recordId],
    );
    return rows.rows as { snapshot_no: number; change_set_id: string; atoms: unknown }[];
  }

  /** The test's own client as the tagged-sql shape the loaders take. */
  function asPool(): SqlLike {
    return async (strings, ...values) => {
      let text = "";
      for (let i = 0; i < strings.length; i += 1) {
        text += strings[i] ?? "";
        if (i < values.length) text += `$${i + 1}`;
      }
      return (await client.query(text, values)).rows;
    };
  }

  it("B1: two transactions inside one open change take two versions, the second holding both edits", async () => {
    const actor = "__qa-open-change@example.test";
    const changeSetId = await openPersonChange(actor);
    const recordId = await newRecord(9020, "__QA Edited twice in one change");

    const w = await withTransaction((txn) => createAttribute(txn, dimension(recordId, "W", "900", actor)));
    const d = await withTransaction((txn) => createAttribute(txn, dimension(recordId, "D", "600", actor)));
    expect(w.changeSetId).toBe(changeSetId);
    expect(d.changeSetId).toBe(changeSetId);

    const versions = await versionsOf(recordId);
    expect(versions.map((v) => v.snapshot_no)).toEqual([1, 2]);
    expect(versions.every((v) => v.change_set_id === changeSetId)).toBe(true);

    const first = parseAtoms(versions[0]!.atoms);
    const second = parseAtoms(versions[1]!.atoms);
    expect(first.attributes.map((a) => a.dimensionSlot)).toEqual(["W"]);
    expect(second.attributes.map((a) => a.dimensionSlot).sort()).toEqual(["D", "W"]);

    // The diff between them is the second edit and nothing else.
    const diff = diffSnapshots(first, second);
    expect(diff.attributes).toHaveLength(1);
    expect(diff.attributes[0]).toMatchObject({ change: "added", label: "Depth" });

    // The trail names the record ONCE under the change, at its newest version,
    // and counts it once. Two rows here read as "2 items fixed at this point"
    // for one item edited twice.
    const trail = await loadProjectHistory(asPool(), projectId, { limit: 500 });
    const change = trail.find((entry) => entry.id === changeSetId);
    expect(change?.records.filter((r) => r.id === recordId)).toEqual([expect.objectContaining({ snapshotNo: 2 })]);
    expect(change?.recordsChanged).toBe(1);

    const { GET } = await import("@/app/api/projects/[id]/changes/route");
    sessionEmail = actor;
    try {
      const response = await GET(new Request("http://localhost/test"), { params: Promise.resolve({ id: projectId }) });
      const body = (await response.json()) as { open: { id: string; recordsChanged: number } | null };
      expect(body.open?.id).toBe(changeSetId);
      expect(body.open?.recordsChanged).toBe(1);
    } finally {
      sessionEmail = "__qa@example.test";
    }
  });

  it("B1: one transaction that writes a spec and promotes its answers is still ONE version (0012)", async () => {
    const actor = "__qa-one-txn@example.test";
    const changeSetId = await openPersonChange(actor);
    const recordId = await newRecord(9021, "__QA One act");

    await withTransaction(async (txn) => {
      // createAttribute writes the attribute, fills the checklist answers it
      // answers, and versions the record. A second call to snapshotRecords in
      // the SAME transaction is what a confirm that touches a record twice
      // does, and it must not number a second version.
      await createAttribute(txn, dimension(recordId, "W", "900", actor));
      const again = await snapshotRecords(txn, [recordId], changeSetId);
      expect(again.size).toBe(0);
    });

    const versions = await versionsOf(recordId);
    expect(versions.map((v) => v.snapshot_no)).toEqual([1]);
  });

  it("B1: a baseline taken between two edits of one open change freezes the first, and the record moves on", async () => {
    const actor = "__qa-baseline-between@example.test";
    await openPersonChange(actor);
    const recordId = await newRecord(9022, "__QA Baselined mid-change");

    await withTransaction((txn) => createAttribute(txn, dimension(recordId, "W", "900", actor)));
    const baseline = await withTransaction((txn) =>
      takeBaseline(txn, { projectId, label: "__QA mid-change", reason: "issued", actor: "__qa-baseliner" }),
    );
    await withTransaction((txn) => createAttribute(txn, dimension(recordId, "D", "600", actor)));

    const member = await client.query(
      `select s.snapshot_no from baseline_members m join record_snapshots s on s.id = m.snapshot_id
        where m.change_set_id = $1 and m.record_id = $2`,
      [baseline.changeSetId, recordId],
    );
    expect(member.rows[0]?.snapshot_no).toBe(1);
    const versions = await versionsOf(recordId);
    // Before 0052 there was no v2: the record's newest version went on
    // claiming W alone while it held W and D.
    expect(versions.map((v) => v.snapshot_no)).toEqual([1, 2]);
  });

  it("holds versions append-only", async () => {
    const rows = await client.query(
      `select id from record_snapshots where record_id in (select id from spec_records where project_id = $1) limit 1`,
      [projectId],
    );
    const id = rows.rows[0].id;
    await expect(client.query(`update record_snapshots set snapshot_no = 99 where id = $1`, [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(client.query(`delete from record_snapshots where id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it("refuses to rewrite a change, but allows it to be closed once", async () => {
    const row = await client.query(
      `insert into change_sets (project_id, kind, actor) values ($1, 'manual_edit', 'qa') returning id`,
      [projectId],
    );
    const id = row.rows[0].id;
    await expect(client.query(`update change_sets set reason = 'rewritten' where id = $1`, [id])).rejects.toThrow(
      /append-only/,
    );
    await client.query(`update change_sets set closed_at = now() where id = $1`, [id]);
    await expect(client.query(`update change_sets set closed_at = now() where id = $1`, [id])).rejects.toThrow(
      /already closed/,
    );
    await expect(client.query(`delete from change_sets where id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it("requires a reason where the change overrides a decision", async () => {
    for (const kind of ["attribute_retire", "run_retire", "finish_edit", "finish_unlink"]) {
      await expect(
        client.query(`insert into change_sets (project_id, kind, actor) values ($1, $2, 'qa')`, [projectId, kind]),
      ).rejects.toThrow(/change_sets_reason_required/);
    }
    // And does not demand one where the change simply records something.
    await client.query(`insert into change_sets (project_id, kind, closed_at, actor) values ($1, 'manual_edit', now(), 'qa')`, [
      projectId,
    ]);
  });

  it("names a baseline, and refuses a name on anything else", async () => {
    await expect(
      client.query(`insert into change_sets (project_id, kind, reason, actor) values ($1, 'baseline', 'issued', 'qa')`, [
        projectId,
      ]),
    ).rejects.toThrow(/change_sets_label_is_baseline/);
    await expect(
      client.query(
        `insert into change_sets (project_id, kind, label, closed_at, actor) values ($1, 'manual_edit', 'named', now(), 'qa')`,
        [projectId],
      ),
    ).rejects.toThrow(/change_sets_label_is_baseline/);
  });

  it("allows only one open change per actor per project", async () => {
    await client.query(`insert into change_sets (project_id, kind, actor) values ($1, 'manual_edit', '__qa_one')`, [
      projectId,
    ]);
    await expect(
      client.query(`insert into change_sets (project_id, kind, actor) values ($1, 'manual_edit', '__qa_one')`, [projectId]),
    ).rejects.toThrow(/change_sets_one_open_per_actor/);
    // A different person may have their own open change at the same time.
    await client.query(`insert into change_sets (project_id, kind, actor) values ($1, 'manual_edit', '__qa_two')`, [
      projectId,
    ]);
  });

  it("tells the versions list which version each baseline froze", async () => {
    // A baseline sits BETWEEN two versions on the screen, and where it sits is
    // read off `baseline_members` — never off a date. `created_at` is
    // transaction START time, so two overlapping guarded transactions can
    // commit in the opposite order, and a bar placed by date would put a
    // version on the wrong side of a point somebody signed off.
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9013, $3, '__QA Baselined', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const recordId = record.rows[0].id;
    const snapshots: string[] = [];
    for (const no of [1, 2, 3]) {
      const changeSetId = await openChange("manual_edit");
      const row = await client.query(
        `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
         values ($1, $2, $3, '{"schemaVersion":1}'::jsonb, '[]'::jsonb) returning id`,
        [recordId, changeSetId, no],
      );
      snapshots.push(row.rows[0].id);
    }

    // Named at version 2, so the bar belongs between 2 and 3 — which only the
    // member row can say.
    const baseline = await client.query(
      `insert into change_sets (project_id, kind, label, reason, closed_at, actor)
       values ($1, 'baseline', '__QA Issued to client', 'issued', now(), 'qa') returning id`,
      [projectId],
    );
    await client.query(
      `insert into baseline_members (change_set_id, record_id, snapshot_id) values ($1, $2, $3)`,
      [baseline.rows[0].id, recordId, snapshots[1]],
    );

    const { GET } = await import("@/app/api/records/[id]/history/route");
    const response = await GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ id: recordId }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      baselines: { changeSetId: string; label: string; memberSnapshotNo: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.baselines).toHaveLength(1);
    expect(body.baselines[0]?.label).toBe("__QA Issued to client");
    expect(body.baselines[0]?.memberSnapshotNo).toBe(2);
  });

  it("serialises two concurrent edits of ONE record into versions n+1 and n+2", async () => {
    // The race, reported from the infill screen on 2026-09-20: two edits to two
    // DIFFERENT questions of one record, each with its own change set (nobody
    // had opened one), both read `max(snapshot_no)` as n, both claim n+1, and
    // the second dies on `record_snapshots_record_no_key`. It reached the
    // reviewer as a 500 saying nothing was written, over an edit that had
    // nothing to do with the other one.
    //
    // `snapshotRecords` now locks the record before reading the number, so the
    // second transaction waits and then reads what the first committed. The
    // two are driven on their own connections and the order is FORCED — a
    // Promise.all here would pass most of the time with the lock removed, and
    // a test that usually passes is how this came back.
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9011, $3, '__QA Concurrent', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const recordId = record.rows[0].id;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
         from requirements q where q.category_id = $2 limit 2`,
      [recordId, categoryId],
    );
    const answers = await client.query(
      `select id, version from spec_answers where record_id = $1 order by id`,
      [recordId],
    );
    expect(answers.rows).toHaveLength(2);

    const clients = [new pg.Client({ connectionString: databaseUrl }), new pg.Client({ connectionString: databaseUrl })];
    // A tagged-sql shim over a raw client, so the transaction's begin and
    // commit are this test's to order. `withTransaction` deliberately gives a
    // caller no way to hold one open.
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

    try {
      for (const c of clients) {
        await c.connect();
        await c.query("begin");
      }
      const pidB = (await clients[1]!.query(`select pg_backend_pid() as pid`)).rows[0].pid;

      // A edits question 1 and holds its transaction open, having taken the
      // record lock inside `snapshotRecords`.
      const first = await editAnswer(asSql(clients[0]!), {
        answerId: answers.rows[0].id,
        value: "__QA first",
        state: "confirmed",
        expectedVersion: answers.rows[0].version,
        actor: "__qa-a@example.test",
      });
      expect(first.snapshotNo).toBe(1);

      // B edits question 2. It gets as far as the lock and stops there.
      const second = editAnswer(asSql(clients[1]!), {
        answerId: answers.rows[1].id,
        value: "__QA second",
        state: "confirmed",
        expectedVersion: answers.rows[1].version,
        actor: "__qa-b@example.test",
      });

      // WAIT UNTIL B IS ACTUALLY BLOCKED, never on a sleep. A fixed pause is
      // what made the first version of this test pass with the lock removed:
      // four round trips to a London Neon endpoint take longer than any pause
      // worth writing, so B reached the number AFTER A had committed by
      // latency alone, and the race it exists to catch never happened.
      const deadline = Date.now() + 15_000;
      for (;;) {
        const blocked = await client.query(`select cardinality(pg_blocking_pids($1)) > 0 as blocked`, [pidB]);
        if (blocked.rows[0].blocked) break;
        if (Date.now() > deadline) throw new Error("the second edit never blocked; the lock is not being taken");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await clients[0]!.query("commit");
      const result = await second;
      await clients[1]!.query("commit");

      // Not 1 again: the number was read after the first commit.
      expect(result.snapshotNo).toBe(2);
      expect(result.changeSetId).not.toBe(first.changeSetId);
    } finally {
      for (const c of clients) await c.query("rollback").catch(() => {});
      for (const c of clients) await c.end().catch(() => {});
    }

    const snapshots = await client.query(
      `select snapshot_no from record_snapshots where record_id = $1 order by snapshot_no`,
      [recordId],
    );
    expect(snapshots.rows.map((row) => row.snapshot_no)).toEqual([1, 2]);
  }, 30_000);

  // ---- COVERAGE, PER RECORD (audit 4.3) -------------------------------------
  //
  // The assertion this replaces was per CHANGE SET: a change with spec-content
  // audit rows and NO version anywhere failed it. A write path that forgot to
  // version one record inside a change that versioned another (a fan-out that
  // missed a configuration, a second transaction in an open change that wrote
  // and skipped the snapshot) passed, because the change had A version. So the
  // question is now asked per record: every record a change wrote spec content
  // to has a version under that change.
  //
  // Each audit row is traced to its RECORD through the live row (an answer, an
  // attribute or a ref carries `record_id`; a record is its own). Rows whose
  // target has since been deleted are not joined, for the reason the comment
  // below gives: the versions went with the records, by cascade, and no write
  // path can put them back. Rows written before 0012 carry a null
  // change_set_id and are not joined either, so history starting at 0012 does
  // not fail this.
  const UNCOVERED_RECORDS = `
    with written as (
      select al.change_set_id, coalesce(r.id, a.record_id, ra.record_id, rf.record_id) as record_id
        from audit_log al
        left join spec_records r on al.table_name = 'spec_records' and r.id::text = al.row_id
        left join spec_answers a on al.table_name = 'spec_answers' and a.id::text = al.row_id
        left join record_attributes ra on al.table_name = 'record_attributes' and ra.id::text = al.row_id
        left join spec_record_refs rf on al.table_name = 'spec_record_refs' and rf.id::text = al.row_id
       where al.change_set_id is not null
         and al.table_name = any($1::text[])
    )
    select cs.id as change_set_id, cs.kind, cs.actor, cs.created_at, w.record_id, count(*)::int as writes
      from written w
      join change_sets cs on cs.id = w.change_set_id
     where w.record_id is not null
       and ($2::uuid is null or cs.project_id = $2::uuid)
       and not exists (
         select 1 from record_snapshots s where s.change_set_id = w.change_set_id and s.record_id = w.record_id
       )
     group by cs.id, cs.kind, cs.actor, cs.created_at, w.record_id
     order by cs.created_at, w.record_id`;

  it("COVERAGE finds a record a change wrote to and never versioned, where the per-change test did not", async () => {
    // The check has to be able to fail. Built inside a transaction that is
    // rolled back, so the whole-database assertion below never sees it.
    await client.query("begin");
    try {
      const changeSetId = await openChange("manual_edit");
      await client.query(`select set_config('app.change_set_id', $1, true)`, [changeSetId]);
      const versioned = await newRecordIn(9030, "__QA Versioned");
      const forgotten = await newRecordIn(9031, "__QA Forgotten");
      await client.query(
        `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
         values ($1, $2, 1, '{}'::jsonb, '[]'::jsonb)`,
        [versioned, changeSetId],
      );
      // A spec written to the second record under the same change, and no version.
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, state, created_by, updated_by)
         values ($1, 'note', '__QA note', '__QA said', 'confirmed', 'qa', 'qa')`,
        [forgotten],
      );

      const perChange = await client.query(
        `select 1 from change_sets cs
          where cs.id = $1
            and not exists (select 1 from record_snapshots s where s.change_set_id = cs.id)`,
        [changeSetId],
      );
      // The old question: the change has a version, so it looked covered.
      expect(perChange.rows).toEqual([]);

      const perRecord = await client.query(UNCOVERED_RECORDS, [SPEC_CONTENT_TABLES, projectId]);
      expect(perRecord.rows.map((row) => row.record_id)).toEqual([forgotten]);
    } finally {
      await client.query("rollback");
    }
  });

  async function newRecordIn(recordNo: number, description: string): Promise<string> {
    const row = await client.query(
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'qa', 'qa') returning id`,
      [projectId, runId, recordNo, categoryId, description],
    );
    return row.rows[0].id;
  }

  it("COVERAGE: every record a change wrote spec content to has a version under that change, across the DATABASE", async () => {
    // Deliberately whole-database rather than scoped to this test's project:
    // the failure worth catching is a real confirm path that wrote spec
    // content and recorded no version, and a scoped query would only ever see
    // fixtures.
    //
    // ---- AND WHY THE ROW HAS TO STILL EXIST ------------------------------
    //
    // `record_snapshots` cascades away with its record — 0013's sanctioned
    // route, "refuse the rewrite, allow the cascade". So a change set whose
    // records have since been DELETED legitimately has no version left, while
    // its audit rows remain, because audit_log is append-only and outlives
    // everything. Counting those made this fail for a reason no write path
    // could fix: the versions existed and went with the records.
    //
    // Found on 2026-09-17, by a browser walkthrough on a real sandbox project
    // whose records were swept afterwards. The property this test wants is "a
    // LIVE write path took no version", so it traces each audit row through
    // the row that still exists. A confirm path that forgets to snapshot is
    // caught exactly as before, because its rows are still there.
    const uncovered = await client.query(UNCOVERED_RECORDS, [SPEC_CONTENT_TABLES, null]);
    expect(uncovered.rows).toEqual([]);
  });
});
