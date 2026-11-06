// Database tier — an item's TGQ by `itemTgq`, and every total equal to the sum
// of its lines (Max, 2026-10-13: "with the TGQ question it should show the 7").
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.localstack.local ./node_modules/vitest/vitest.mjs run tests/db/item-tgq-totals.test.ts
//
// On Matthew's matrix an item's TGQ is its TGQ GATE rows — slots and record
// columns included — judged by `gateStatus` in TypeScript, never in SQL. The
// overview's total is therefore two halves added (the SQL placeholder half and
// the TypeScript matrix half), and the trap is a total that no longer equals
// what the screens' lines add up to. Three readings are held equal here: the
// overview's summary, the phase table's rows, and the fill-in screen's header
// and lines — including a matrix item with EVERY question answered, which has
// no question to group and still owes its slots and record columns.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { loadProjectSummary } from "@/lib/project-summary";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-item-tgq@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("an item's TGQ, and totals equal to their lines", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let answeredId = "";
  let openId = "";
  let placeholderId = "";

  async function record(no: number, categoryId: string, description: string): Promise<string> {
    return (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, level, status,
                                   created_by, updated_by)
         values ($1, $2, $3, $4, $5, 'simple', 'active', 'qa', 'qa') returning id`,
        [projectId, runId, no, categoryId, description],
      )
    ).rows[0].id as string;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90071")}', '__QA Item TGQ totals', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const mapped = (
      await client.query(`select item_category_id as id from spec_matrix_category_map order by item_category_id limit 1`)
    ).rows[0].id as string;
    const placeholder = (
      await client.query(
        `select c.id from item_categories c
          where c.id not in (select item_category_id from spec_matrix_category_map)
            and exists (select 1 from requirements q where q.category_id = c.id)
          order by c.sort_order limit 1`,
      )
    ).rows[0].id as string;
    answeredId = await record(1, mapped, "__QA Every question answered");
    openId = await record(2, mapped, "__QA Nothing answered");
    placeholderId = await record(3, placeholder, "__QA On the placeholder");
    // EVERY checklist question on the first answered: it has no outstanding
    // question at all, and still owes its dimension slots and record columns.
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, confirmed_by, confirmed_at,
                                 created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'confirmed', '__QA', 'qa', now(), 'qa', 'qa'
         from requirements q where q.category_id = $2`,
      [answeredId, mapped],
    );
  });

  afterAll(async () => {
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [
      projectId,
    ]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("the overview's total is the phase table's rows added up, item for item", async () => {
    const { GET } = await import("@/app/api/records/route");
    const body = (await (
      await GET(new Request(`http://localhost/api/records?projectId=${projectId}&runId=${runId}&withToQuote=1`))
    ).json()) as {
      records: { id: string; to_quote_outstanding: number | null; to_quote_questions: { kind: string }[] }[];
    };
    const byId = new Map(body.records.map((row) => [row.id, row]));
    const summary = await loadProjectSummary(projectId);
    const lines = body.records.map((row) => row.to_quote_outstanding ?? 0);
    expect(summary.toQuote).toBe(lines.reduce((sum, n) => sum + n, 0));
    expect(summary.toQuoteItems).toBe(lines.filter((n) => n > 0).length);

    // The item with every question answered is STILL held at TGQ on the
    // matrix — by rows that are not questions — and its list says which.
    const answered = byId.get(answeredId)!;
    expect(answered.to_quote_outstanding).toBeGreaterThan(0);
    expect(answered.to_quote_questions.length).toBe(answered.to_quote_outstanding);
    expect(answered.to_quote_questions.some((row) => row.kind !== "question")).toBe(true);
    // THE LIST IS THE COUNT, on every row.
    for (const row of body.records) {
      expect(row.to_quote_questions.length).toBe(row.to_quote_outstanding ?? 0);
    }
  });

  it("the fill-in header is its lines added up, and lists the item no question holds", async () => {
    const { GET } = await import("@/app/api/projects/[id]/infill/route");
    const body = (await (await GET(new Request("http://localhost/test"), params(projectId))).json()) as {
      totals: { toQuote: number };
      lines: { lineId: string; counts: { toQuote: number }; itemRows?: unknown[] }[];
    };
    const sum = body.lines.reduce((total, line) => total + line.counts.toQuote, 0);
    expect(body.totals.toQuote).toBe(sum);
    expect(body.totals.toQuote).toBe((await loadProjectSummary(projectId)).toQuote);
    const answered = body.lines.find((line) => line.lineId === answeredId)!;
    expect(answered.counts.toQuote).toBeGreaterThan(0);
    expect(answered.itemRows?.length).toBe(answered.counts.toQuote);
    expect(body.lines.some((line) => line.lineId === placeholderId)).toBe(true);
    expect(body.lines.some((line) => line.lineId === openId)).toBe(true);
  });

  // AUDIT F7 (2026-11-06): the chase header walked only the records that had
  // an outstanding question, so the matrix item with every question answered
  // (and slots still open) was in the overview's total and not in this one.
  it("the chase header's TGQ is the overview's, the item no question holds included", async () => {
    const { GET } = await import("@/app/api/drafts/route");
    const body = (await (await GET(new Request(`http://localhost/api/drafts?projectId=${projectId}`))).json()) as {
      inventory: { totals: { toQuote: number }; itemTgq: Record<string, { count: number | null; lineId?: string }> };
    };
    expect(body.inventory.totals.toQuote).toBe((await loadProjectSummary(projectId)).toQuote);
    // The answered item is on the matrix and owes its gate rows; the payload
    // says which line it is on, which is what lets a line count it.
    expect(body.inventory.itemTgq[answeredId]?.count).toBeGreaterThan(0);
    expect(body.inventory.itemTgq[answeredId]?.lineId).toBe(answeredId);
  });

  // AUDIT F1 / F14: a matrix record with no level is not a "no level" blocker
  // on the chase screen. Every record here has a level, so take one away.
  it("does not list a matrix record with no level as needing one; a placeholder record still is", async () => {
    await client.query(`update spec_records set level = null, updated_by = 'qa' where id = any($1::uuid[])`, [
      [openId, placeholderId],
    ]);
    try {
      const { GET } = await import("@/app/api/drafts/route");
      const body = (await (await GET(new Request(`http://localhost/api/drafts?projectId=${projectId}`))).json()) as {
        inventory: { levelless: { recordId: string }[]; blocked: { recordId: string; reason: string }[] };
      };
      const levelless = body.inventory.levelless.map((row) => row.recordId);
      expect(levelless).not.toContain(openId);
      expect(levelless).toContain(placeholderId);
      // Nobody is named on these lines, so both are blocked for that reason,
      // and never for a level on the matrix record.
      const matrixBlock = body.inventory.blocked.find((row) => row.recordId === openId);
      expect(matrixBlock?.reason).not.toBe("no level on the record");
    } finally {
      await client.query(`update spec_records set level = 'simple', updated_by = 'qa' where id = any($1::uuid[])`, [
        [openId, placeholderId],
      ]);
    }
  });
});
