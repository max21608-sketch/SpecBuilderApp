// Database tier — a revised bill replaces a run WITHOUT losing the work done
// against it. Through the real confirm route.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// ============================================================================
// THE DEFECT THIS FILE PROVES IS FIXED.
//
// Confirming a revised BOQ used to create a SECOND spec_runs row and a full
// second set of records with new numbers, beside the originals. Both appeared
// as tabs, both exported, and every drawing, spec, picture and checklist
// answer gathered against the first set stayed on records nobody was looking
// at any more. 0007's own header called retiring the old run "how it leaves
// the tabs", and no code in the repo could retire one.
//
// The carry-over is the whole point, so it is what these assert: a paired
// record keeps its ID, and therefore keeps everything hanging off it.
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
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Line = {
  index: number;
  lineNo: number;
  code: string | null;
  itemDescription: string;
  qty: number | null;
  replaces?: { recordId: string; recordVersion: number } | null;
  level?: string | null;
  levelStatus?: "suggested" | "chosen";
  levelReason?: string | null;
};

describeIfDb("BOQ revision", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00017")}', '__QA BOQ revision', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
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
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  function line(over: Partial<Line> & { index: number }): Record<string, unknown> {
    return {
      index: over.index,
      lineNo: over.index + 1,
      designer: "__QA",
      boqCategory: "__QA Seating",
      area: "__QA Rooms",
      code: over.code ?? `__QAR${over.index + 1}`,
      itemDescription: over.itemDescription ?? `__QA item ${over.index + 1}`,
      productReference: null,
      qty: over.qty ?? 1,
      qtyUnit: "pcs",
      categoryId,
      categoryStatus: "chosen",
      ignored: false,
      replaces: over.replaces ?? null,
      ...(over.level === undefined
        ? {}
        : {
            level: over.level,
            levelStatus: over.levelStatus ?? "suggested",
            levelReason: over.levelReason ?? "the bill names no metalwork",
          }),
    };
  }

  async function stage(lines: Record<string, unknown>[], replacesRunId: string | null = null): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA boq.xlsx",
          sourcePreserved: false,
          sheets: [
            {
              sheetName: "__QA MAIN RUN",
              proposedRunName: "__QA MAIN RUN",
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId,
              metadata: { revision: replacesRunId ? "B" : "A", date: "14-Sep-26", notes: [] },
              lines,
            },
          ],
        }),
      ],
    );
    return run.rows[0].id;
  }

  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post({}), params(runId));
  };

  // Two confirms over a real connection, each taking a project-wide lock.
  it("carries a record through a revision, keeping its id and everything on it", { timeout: 30_000 }, async () => {
    // Rev A: three lines.
    const first = await stage([line({ index: 0 }), line({ index: 1 }), line({ index: 2 })]);
    expect((await confirm(first)).status).toBe(200);

    const runRow = await client.query(`select id from spec_runs where project_id = $1`, [projectId]);
    const runId = runRow.rows[0].id;
    const before = await client.query(
      `select id, record_no, version, qty from spec_records where project_id = $1 order by record_no`,
      [projectId],
    );
    expect(before.rows).toHaveLength(3);

    // A drawing confirmed against the second record: the work that must survive.
    const keeper = before.rows[1];
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, state, created_by, updated_by)
       values ($1, 'material', 'FABRIC', 'Yarn Tessarae YC04158 - 01', 'confirmed', 'qa', 'qa')`,
      [keeper.id],
    );

    // Rev B: line 1 keeps its quantity, line 2 changes to 9, line 3 is gone,
    // and a new line 4 arrives.
    const second = await stage(
      [
        line({ index: 0, replaces: { recordId: before.rows[0].id, recordVersion: before.rows[0].version } }),
        line({ index: 1, qty: 9, replaces: { recordId: keeper.id, recordVersion: keeper.version } }),
        line({ index: 3, code: "__QAR4", itemDescription: "__QA item 4" }),
      ],
      runId,
    );
    const response = await confirm(second);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { updated: number; imported: number; retired: number };
    expect(body).toMatchObject({ updated: 2, imported: 1, retired: 1 });

    // The kept record is the SAME ROW, with the new quantity and its spec intact.
    const after = await client.query(
      `select id, record_no, qty, status, run_id from spec_records where id = $1`,
      [keeper.id],
    );
    expect(after.rows[0].id).toBe(keeper.id);
    expect(after.rows[0].record_no).toBe(keeper.record_no);
    expect(Number(after.rows[0].qty)).toBe(9);
    expect(after.rows[0].status).toBe("active");
    expect(after.rows[0].run_id).toBe(runId);

    const kept = await client.query(
      `select value from record_attributes where record_id = $1 and status = 'active'`,
      [keeper.id],
    );
    expect(kept.rows.map((row) => row.value)).toEqual(["Yarn Tessarae YC04158 - 01"]);

    // The dropped line's record is RETIRED, not deleted — a client ref maps to
    // a BWS job that may already exist, and deleting loses that mapping.
    const dropped = await client.query(
      `select status, retired_by from spec_records where id = $1`,
      [before.rows[2].id],
    );
    expect(dropped.rows[0].status).toBe("retired");
    expect(dropped.rows[0].retired_by).toBe("__qa@example.test");

    // ONE run still, not two.
    const runs = await client.query(`select id, boq_revision, status from spec_runs where project_id = $1`, [projectId]);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].boq_revision).toBe("B");
    expect(runs.rows[0].status).toBe("active");

    // And the whole thing is one change, of the kind that says what it was.
    const change = await client.query(
      `select kind from change_sets where project_id = $1 order by created_at desc limit 1`,
      [projectId],
    );
    expect(change.rows[0].kind).toBe("boq_revision");
  });

  it("refuses the whole revision when a paired record changed since the review", { timeout: 20_000 }, async () => {
    const runRow = await client.query(`select id from spec_runs where project_id = $1`, [projectId]);
    const runId = runRow.rows[0].id;
    const record = await client.query(
      `select id, version, qty from spec_records where project_id = $1 and status = 'active' order by record_no limit 1`,
      [projectId],
    );
    const stale = { recordId: record.rows[0].id, recordVersion: Number(record.rows[0].version) - 1 };

    const run = await stage([line({ index: 0, qty: 77, replaces: stale })], runId);
    const response = await confirm(run);
    expect(response.status).toBe(409);

    // NOTHING was written — not the quantity, and not the retirement of the
    // records this sheet no longer lists.
    const after = await client.query(`select qty, status from spec_records where id = $1`, [record.rows[0].id]);
    expect(Number(after.rows[0].qty)).toBe(Number(record.rows[0].qty));
    expect(after.rows[0].status).toBe("active");
  });

  it("refuses a pairing on a sheet that is not marked as revising a run", { timeout: 20_000 }, async () => {
    const record = await client.query(
      `select id, version from spec_records where project_id = $1 and status = 'active' order by record_no limit 1`,
      [projectId],
    );
    const run = await stage([
      line({ index: 0, replaces: { recordId: record.rows[0].id, recordVersion: record.rows[0].version } }),
    ]);
    const response = await confirm(run);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("pairing_without_revision");
  });

  // ---- the level a bill arrives with -------------------------------------
  //
  // Guessed at parse time and shown in the review table. Which COLUMN the
  // confirm writes is the whole safety property: a guess must not be able to
  // satisfy the quote gate, and a decision must not be re-guessed later.
  it("writes a guessed level as a suggestion and a chosen one as a decision", { timeout: 30_000 }, async () => {
    const runId = await stage([
      line({ index: 0, code: "__QAL1", level: "complex", levelStatus: "suggested", levelReason: "the bill names brass" }),
      line({ index: 1, code: "__QAL2", level: "hero", levelStatus: "chosen" }),
      line({ index: 2, code: "__QAL3" }),
    ]);
    const response = await confirm(runId);
    expect(response.status).toBe(200);

    const rows = await client.query(
      `select x.ref_value as code, r.level, r.level_suggested, r.level_suggested_reason
         from spec_records r join spec_record_refs x on x.record_id = r.id
        where r.project_id = $1 and x.ref_value like '__QAL%'
        order by x.ref_value`,
      [projectId],
    );
    const by = new Map(rows.rows.map((row) => [row.code, row]));

    // Guessed: advisory, and it carries its reason so a reviewer can check it.
    expect(by.get("__QAL1")?.level).toBeNull();
    expect(by.get("__QAL1")?.level_suggested).toBe("complex");
    expect(by.get("__QAL1")?.level_suggested_reason).toBe("the bill names brass");

    // Chosen in the review table: a decision, and the gate may read it.
    expect(by.get("__QAL2")?.level).toBe("hero");
    expect(by.get("__QAL2")?.level_suggested).toBeNull();

    // A bill staged before any of this existed: no level at all, as before.
    expect(by.get("__QAL3")?.level).toBeNull();
    expect(by.get("__QAL3")?.level_suggested).toBeNull();
  });

  it("never lets a revision override a level somebody decided", { timeout: 40_000 }, async () => {
    const firstRun = await stage([line({ index: 0, code: "__QAV1", level: "hero", levelStatus: "chosen" })]);
    expect((await confirm(firstRun)).status).toBe(200);

    const before = await client.query(
      `select r.id, r.version, r.run_id from spec_records r
         join spec_record_refs x on x.record_id = r.id
        where r.project_id = $1 and x.ref_value = '__QAV1'`,
      [projectId],
    );
    const record = before.rows[0];

    // Rev B pairs the same line and guesses something else off the new bill.
    const revision = await stage(
      [
        line({
          index: 0,
          code: "__QAV1",
          level: "simple",
          levelStatus: "suggested",
          replaces: { recordId: record.id, recordVersion: Number(record.version) },
        }),
      ],
      record.run_id,
    );
    expect((await confirm(revision)).status).toBe(200);

    const after = await client.query(`select level, level_suggested from spec_records where id = $1`, [record.id]);
    expect(after.rows[0].level).toBe("hero");
    expect(after.rows[0].level_suggested).toBeNull();
  });
});
