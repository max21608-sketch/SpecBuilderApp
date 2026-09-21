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
import { parseBoqSheets, BOQ_SCHEMA_VERSION, type BoqLine } from "@/lib/boq-import";
import { noQtyColumn } from "../fixtures/boq-shapes";

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
});
