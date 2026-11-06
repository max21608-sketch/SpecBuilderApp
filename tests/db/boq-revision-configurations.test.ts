// Database tier — a revised bill and the configurations under its lines
// (audit 2026-11-06, item 1.2: C1/F2, C2, C14). Through the real routes.
//
// Run on the local stack:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/boq-revision-configurations.test.ts
//
// ============================================================================
// THE DEFECTS THIS FILE PROVES ARE FIXED.
//
// C1. A configuration carries no bill code (0024), so no revised line could
//     pair with one, and the confirm's retire step swept every record on the
//     phase that was not carried forward. Revise a phase holding S-301 TYPE
//     1–5 with S-301 paired: all five retired, the bill line became an item
//     again, and the export shipped it bare in place of the five jobs.
// C2. Two sheets naming one phase as the one they revise: the second sheet's
//     retire step swept the first sheet's new records.
// C14. A record retired by one revision whose code came back in the next
//     became a NEW record, with the old one's drawings and specs left behind.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Pairing = { recordId: string; recordVersion: number; restore?: boolean } | null;
type SheetSpec = { name: string; replacesRunId: string | null; lines: Record<string, unknown>[] };

describeIfDb("A revision and the configurations under its lines", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let parent = { id: "", version: 0, recordNo: 0 };
  let sibling = { id: "", version: 0 };
  let configurationIds: string[] = [];

  const line = (index: number, code: string, replaces: Pairing = null, qty = 1): Record<string, unknown> => ({
    index,
    lineNo: index + 1,
    designer: "__QA",
    boqCategory: "__QA Seating",
    area: "__QA Rooms",
    code,
    itemDescription: `__QA ${code}`,
    productReference: null,
    qty,
    qtyUnit: "pcs",
    categoryId: null,
    ignored: false,
    replaces,
  });

  async function stage(sheets: SheetSpec[]): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA boq.xlsx",
          sourcePreserved: false,
          sheets: sheets.map((sheet) => ({
            sheetName: sheet.name,
            proposedRunName: sheet.name,
            headerRow: 1,
            skippedRows: 0,
            ignored: false,
            ignoredReason: null,
            replacesRunId: sheet.replacesRunId,
            metadata: { revision: sheet.replacesRunId ? "B" : "A", date: null, notes: [] },
            lines: sheet.lines,
          })),
        }),
      ],
    );
    return run.rows[0].id;
  }

  const confirm = async (importId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(request("POST", {}), params(importId));
  };

  const fresh = async (id: string) => {
    const row = await client.query(`select id, version, record_no, status from spec_records where id = $1`, [id]);
    return row.rows[0] as { id: string; version: number; record_no: number; status: string };
  };

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90120")}', '__QA revision configurations', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    // Rev A: the desk chair and one other line.
    const first = await stage([{ name: "__QA MAIN", replacesRunId: null, lines: [line(0, "__QA-S301"), line(1, "__QA-S400")] }]);
    expect((await confirm(first)).status).toBe(200);
    runId = (await client.query(`select id from spec_runs where project_id = $1`, [projectId])).rows[0].id;
    const records = await client.query(
      `select id, version, record_no from spec_records where project_id = $1 order by record_no`,
      [projectId],
    );
    parent = { id: records.rows[0].id, version: Number(records.rows[0].version), recordNo: Number(records.rows[0].record_no) };
    sibling = { id: records.rows[1].id, version: Number(records.rows[1].version) };

    // Two configurations under the chair, each holding its own cloth: what
    // "Add a configuration" or a drawing's TYPE 1 / TYPE 2 leaves behind.
    configurationIds = [];
    for (const [n, label] of ["TYPE 1", "TYPE 2"].entries()) {
      const inserted = await client.query(
        `insert into spec_records
           (project_id, run_id, record_no, status, item_description, parent_id, depth, split_reason, variant_label,
            created_by, updated_by)
         values ($1, $2, $3, 'active', '__QA chair', $4, 1, 'configuration', $5, 'qa', 'qa') returning id`,
        [projectId, runId, 100 + n, parent.id, label],
      );
      const id = inserted.rows[0].id as string;
      configurationIds.push(id);
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, state, created_by, updated_by)
         values ($1, 'material', 'Fabric', $2, 'confirmed', 'qa', 'qa')`,
        [id, `__QA cloth ${label}`],
      );
    }
    parent = { ...parent, version: Number((await fresh(parent.id)).version) };
  });

  afterAll(async () => {
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("lists a line's configurations beside it on the review, never as records of their own", async () => {
    const importId = await stage([
      { name: "__QA MAIN", replacesRunId: runId, lines: [line(0, "__QA-S301"), line(1, "__QA-S400")] },
    ]);
    const { GET } = await import("@/app/api/imports/[id]/route");
    const body = (await (await GET(request("GET"), params(importId))).json()) as {
      reconciliation: Record<number, { records: { id: string; configurations?: string[] }[]; missing: unknown[] }>;
    };
    const sheet = body.reconciliation[0]!;
    expect(sheet.records.map((record) => record.id).sort()).toEqual([parent.id, sibling.id].sort());
    expect(sheet.records.find((record) => record.id === parent.id)?.configurations).toEqual([
      `${parent.recordNo}.1`,
      `${parent.recordNo}.2`,
    ]);
    // Nothing reads as "no longer listed": the configurations follow their line.
    expect(sheet.missing).toEqual([]);
    await client.query(`delete from intake_runs where id = $1`, [importId]);
  });

  it("carries a paired line's configurations forward, ids and specs intact", async () => {
    const importId = await stage([
      {
        name: "__QA MAIN",
        replacesRunId: runId,
        lines: [line(0, "__QA-S301", { recordId: parent.id, recordVersion: parent.version }, 4), line(1, "__QA-S400", { recordId: sibling.id, recordVersion: sibling.version })],
      },
    ]);
    const response = await confirm(importId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 2, imported: 0, retired: 0 });

    const configurations = await client.query(
      `select r.id, r.status, r.record_no, a.value
         from spec_records r join record_attributes a on a.record_id = r.id and a.status = 'active'
        where r.parent_id = $1 order by r.record_no`,
      [parent.id],
    );
    expect(configurations.rows.map((row) => [row.id, row.status, Number(row.record_no), row.value])).toEqual([
      [configurationIds[0], "active", 100, "__QA cloth TYPE 1"],
      [configurationIds[1], "active", 101, "__QA cloth TYPE 2"],
    ]);
    parent = { ...parent, version: Number((await fresh(parent.id)).version) };
    sibling = { ...sibling, version: Number((await fresh(sibling.id)).version) };
  });

  it("refuses two sheets that both revise one phase, naming both, and writes nothing", async () => {
    const importId = await stage([
      { name: "__QA TAB ONE", replacesRunId: runId, lines: [line(0, "__QA-S301", { recordId: parent.id, recordVersion: parent.version })] },
      { name: "__QA TAB TWO", replacesRunId: runId, lines: [line(0, "__QA-NEW")] },
    ]);
    const response = await confirm(importId);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("phase_revised_twice");
    expect(body.error).toContain("__QA TAB ONE");
    expect(body.error).toContain("__QA TAB TWO");
    expect((await fresh(parent.id)).status).toBe("active");
    const live = await client.query(`select count(*)::int as n from spec_records where project_id = $1 and status = 'active'`, [projectId]);
    expect(live.rows[0].n).toBe(4);
    await client.query(`delete from intake_runs where id = $1`, [importId]);
  });

  it("refuses, at the sheet's own control, a second tab revising the same phase", async () => {
    const importId = await stage([
      { name: "__QA TAB ONE", replacesRunId: runId, lines: [line(0, "__QA-S301")] },
      { name: "__QA TAB TWO", replacesRunId: null, lines: [line(0, "__QA-NEW")] },
    ]);
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const response = await PATCH(request("PATCH", { sheetIndex: 1, replacesRunId: runId }), params(importId));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("__QA TAB ONE");
    const stored = await client.query(`select parsed->'sheets'->1->>'replacesRunId' as target from intake_runs where id = $1`, [importId]);
    expect(stored.rows[0].target).toBeNull();
    await client.query(`delete from intake_runs where id = $1`, [importId]);
  });

  it("retires a dropped line's configurations with it, in the same change", async () => {
    const importId = await stage([
      { name: "__QA MAIN", replacesRunId: runId, lines: [line(1, "__QA-S400", { recordId: sibling.id, recordVersion: sibling.version })] },
    ]);
    const response = await confirm(importId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1, retired: 3 });
    const rows = await client.query(
      `select id, status, retired_at from spec_records where id = any($1::uuid[])`,
      [[parent.id, ...configurationIds]],
    );
    expect(rows.rows.map((row) => row.status)).toEqual(["retired", "retired", "retired"]);
    expect(new Set(rows.rows.map((row) => String(row.retired_at))).size).toBe(1);
    sibling = { ...sibling, version: Number((await fresh(sibling.id)).version) };
  });

  it("offers the retired line back when its code returns, and restores it with its configurations", async () => {
    // The review offers it; it chooses nothing.
    const offered = await stage([
      {
        name: "__QA MAIN",
        replacesRunId: runId,
        lines: [line(0, "__QA-S301"), line(1, "__QA-S400", { recordId: sibling.id, recordVersion: sibling.version })],
      },
    ]);
    const { GET } = await import("@/app/api/imports/[id]/route");
    const view = (await (await GET(request("GET"), params(offered))).json()) as {
      reconciliation: Record<number, { lines: { index: number; status: string; restoreCandidates: string[] }[] }>;
    };
    const chair = view.reconciliation[0]!.lines.find((entry) => entry.index === 0)!;
    expect(chair.status).toBe("new");
    expect(chair.restoreCandidates).toEqual([parent.id]);
    await client.query(`delete from intake_runs where id = $1`, [offered]);

    // The reviewer chose to bring it back.
    const retiredVersion = Number((await fresh(parent.id)).version);
    const importId = await stage([
      {
        name: "__QA MAIN",
        replacesRunId: runId,
        lines: [
          line(0, "__QA-S301", { recordId: parent.id, recordVersion: retiredVersion, restore: true }, 7),
          line(1, "__QA-S400", { recordId: sibling.id, recordVersion: sibling.version }),
        ],
      },
    ]);
    const response = await confirm(importId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 0, retired: 0 });

    const back = await client.query(`select id, status, qty, retired_at from spec_records where id = $1`, [parent.id]);
    expect(back.rows[0]).toMatchObject({ id: parent.id, status: "active", qty: 7, retired_at: null });
    const configurations = await client.query(
      `select r.status, a.value from spec_records r
         join record_attributes a on a.record_id = r.id and a.status = 'active'
        where r.parent_id = $1 order by r.record_no`,
      [parent.id],
    );
    expect(configurations.rows).toEqual([
      { status: "active", value: "__QA cloth TYPE 1" },
      { status: "active", value: "__QA cloth TYPE 2" },
    ]);
    // ONE record carries the code: nothing new was made beside it.
    const carriers = await client.query(
      `select count(*)::int as n from spec_record_refs where project_id = $1 and ref_value = '__QA-S301'`,
      [projectId],
    );
    expect(carriers.rows[0].n).toBe(1);
  });

  it("refuses a restore whose record is no longer retired at the version shown", async () => {
    const live = await fresh(parent.id);
    const importId = await stage([
      {
        name: "__QA MAIN",
        replacesRunId: runId,
        lines: [
          line(0, "__QA-S301", { recordId: parent.id, recordVersion: Number(live.version), restore: true }),
          line(1, "__QA-S400", { recordId: sibling.id, recordVersion: Number((await fresh(sibling.id)).version) }),
        ],
      },
    ]);
    const response = await confirm(importId);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("record_changed");
    await client.query(`delete from intake_runs where id = $1`, [importId]);
  });
});
