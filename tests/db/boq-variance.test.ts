// Database tier — the bills a client actually sends, through the REAL routes.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// THE VARIANCE MATRIX'S DATABASE HALF (plan §6.10.a).
//
// The pure tier proves what `parseBoqSheets` read. This proves what the CONFIRM
// then wrote, which is the half where a plausible wrong answer would survive:
// a quantity nobody stated becoming a 1 is invisible in a staged JSON blob and
// permanent in `spec_records.qty`.
//
// The bills are the SYNTHETIC fixtures in tests/fixtures/boq-shapes.ts, put
// through the real parser rather than hand-written as staged JSON — so the
// thing under test is the whole path a real file takes, not a shape somebody
// typed in the middle of it. Every row is prefixed `__QA` and deleted in
// FK-safe order.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { parseBoqSheets, BOQ_SCHEMA_VERSION, assertBoqDocument, type BoqLine } from "@/lib/boq-import";
import { noQtyColumn } from "../fixtures/boq-shapes";
import { bill300Workbook, twoRowHeaderWorkbook } from "../fixtures/build-boq";

/**
 * The document store, stubbed to hand back a synthetic workbook.
 *
 * A BOQ registration READS the bytes — that is the whole of it, since a bill is
 * parsed by code and no model is ever involved — so the only thing standing
 * between this test and the real route is the store. `readTrustedBlob` is
 * replaced and everything else in `blob-source` is the real thing, including
 * the pathname scoping.
 */
const stored: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: "" };
vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async (pathname: string) => ({
      bytes: stored.bytes,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: stored.bytes.byteLength,
      pathname,
    }),
    headTrustedBlob: async (pathname: string) => ({
      pathname,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: stored.bytes.byteLength,
    }),
  };
});

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

describeIfDb("BOQ variance, through the confirm", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('__QA P90031', '__QA BOQ variance', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    categoryId = (
      await client.query(
        `select c.id from item_categories c join requirements q on q.category_id = c.id
         group by c.id having count(q.id) >= 1 order by c.id limit 1`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from status_history where entity_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // APPEND-ONLY MEANS REFUSE THE REWRITE, ALLOW THE CASCADE (0013-0015): a
    // version cannot be deleted while its record exists and a change set
    // cannot be deleted directly at all, so neither is swept by hand — the
    // record takes its snapshots and the project takes its changes.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  /**
   * Stage one of the synthetic bills the way `/api/imports` stages it: the real
   * parser's own lines, plus the decisions a reviewer would have made.
   *
   * The category is CHOSEN here so the confirm creates the checklist — this
   * file is about the bill's own columns, and an uncategorised record is
   * `boq-concurrency.test.ts`'s case.
   */
  async function stage(rows: Parameters<typeof parseBoqSheets>[0], name: string): Promise<string> {
    const parsed = parseBoqSheets(rows);
    if (!parsed.ok) throw new Error(parsed.error);
    const sheets = parsed.sheets.map((sheet) => ({
      ...sheet,
      proposedRunName: name,
      replacesRunId: null,
      lines: sheet.lines.map((line: BoqLine, index: number) => ({
        index,
        ...line,
        code: line.code,
        categoryId,
        categoryStatus: "chosen",
        level: null,
        levelStatus: "suggested",
        levelReason: null,
        nonFurnitureSuggested: null,
        ignored: false,
      })),
    }));
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify({ schemaVersion: BOQ_SCHEMA_VERSION, filename: `__QA ${name}.xlsx`, sourcePreserved: false, sheets })],
    );
    return run.rows[0].id;
  }

  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post({}), params(runId));
  };

  /** Register a synthetic workbook as a bill, through the REAL route. */
  async function register(bytes: Buffer, filename: string, batchId: string): Promise<Response> {
    stored.bytes = bytes;
    stored.filename = filename;
    const { POST } = await import("@/app/api/imports/route");
    return POST(
      post({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/${filename}`,
        filename,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        batchId,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // ROW 2 — NO QUANTITY COLUMN. Expected: FLAGS, with `qty` null. Never 1.
  // -------------------------------------------------------------------------
  it("writes a null quantity for a bill that has no quantity column", async () => {
    const runId = await stage([{ sheet: "__QA NO QTY", data: noQtyColumn() }], "__QA NO QTY");
    const res = await confirm(runId);
    expect(res.status).toBe(200);

    const rows = await client.query(
      `select r.item_description, r.qty
         from spec_records r join spec_runs n on n.id = r.run_id
        where r.project_id = $1 and n.name = '__QA NO QTY'
        order by r.record_no`,
      [projectId],
    );
    expect(rows.rows.map((row) => row.item_description)).toEqual(["Sofa", "Armchair", "Side table"]);
    // THE WHOLE POINT. The per-level columns carry 3, 14 and 1 on these rows;
    // the column that would have been the total does not exist, and a 1 in this
    // column is an order for one sofa.
    expect(rows.rows.map((row) => row.qty)).toEqual([null, null, null]);
  });

  it("leaves the checklist and the refs intact on a line with no quantity", async () => {
    // A flag is not a refusal: the record is a real record, with its client
    // ref and its questions, and only its quantity is outstanding.
    const rows = await client.query(
      `select r.id from spec_records r join spec_runs n on n.id = r.run_id
        where r.project_id = $1 and n.name = '__QA NO QTY' and r.item_description = 'Sofa'`,
      [projectId],
    );
    const recordId = rows.rows[0].id;
    const refs = await client.query(
      `select ref_value from spec_record_refs where record_id = $1 and ref_system = 'boq_code'`,
      [recordId],
    );
    expect(refs.rows.map((row) => row.ref_value)).toEqual(["ZZ-101"]);
    const answers = await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [
      recordId,
    ]);
    expect(answers.rows[0].n).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // ROW 9 — TWO BILLS IN ONE PACK. Expected: FLAGS. Both stage, nothing pairs.
  // -------------------------------------------------------------------------
  it("stages both bills of one pack, and pairs neither", async () => {
    const batch = (
      await client.query(
        `insert into intake_batches (project_id, label, created_by, updated_by)
         values ($1, '__QA two bills', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;

    // Two real workbooks, deliberately DIFFERENT bills — one 300 lines, one
    // three — because two registrations of identical bytes would also pass a
    // route that quietly merged them.
    const first = await register(await bill300Workbook(), "__QA bill rev A.xlsx", batch);
    const second = await register(await twoRowHeaderWorkbook(), "__QA bill rev B.xlsx", batch);
    expect([first.status, second.status]).toEqual([201, 201]);

    const runs = await client.query(
      `select id, status, parsed from intake_runs
        where batch_id = $1 and source_kind = 'boq_xlsx' order by created_at`,
      [batch],
    );
    expect(runs.rows).toHaveLength(2);
    expect(runs.rows.map((row) => row.status)).toEqual(["parsed", "parsed"]);

    // NOTHING IS PAIRED. `replacesRunId` is what makes a bill a revision of a
    // phase, it is set by the reviewer on the bill's own screen, and neither
    // of these carries one — so both would confirm as new phases, which is
    // what the pack screen now says out loud.
    for (const row of runs.rows) {
      const doc = assertBoqDocument(row.parsed);
      expect(doc.sheets.length).toBeGreaterThan(0);
      for (const sheet of doc.sheets) expect(sheet.replacesRunId ?? null).toBeNull();
    }

    // And each read its own bill rather than the other's.
    const lineCounts = runs.rows.map((row) => assertBoqDocument(row.parsed).sheets[0]?.lines.length);
    expect(lineCounts).toEqual([300, 3]);
    // The second bill's two-row header survived the round trip through the
    // store and the route, not only through the parser.
    expect(assertBoqDocument(runs.rows[1]!.parsed).sheets[0]?.headerRows).toBe(2);

    await client.query(`delete from intake_runs where batch_id = $1`, [batch]);
    await client.query(`delete from intake_batches where id = $1`, [batch]);
  });

  it("refuses a bill that is not a spreadsheet, and stages nothing", async () => {
    // Row 5's other half, through the real route: the refusal arrives before
    // anything is parsed, and it carries the way out.
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      post({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/__QA bill.xls`,
        filename: "__QA bill.xls",
        contentType: "application/vnd.ms-excel",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Save As .xlsx");
    const runs = await client.query(
      `select count(*)::int as n from intake_runs where project_id = $1 and source_kind = 'boq_xlsx'`,
      [projectId],
    );
    // Only the one row 2 staged. A refused bill leaves no run behind at all.
    expect(runs.rows[0].n).toBe(1);
  });
});
