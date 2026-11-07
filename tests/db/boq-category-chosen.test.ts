// Database tier — a bill's confirm writes a category only where a person chose
// it (audit 2026-11-06, G8; Max's decision the same day).
//
// The staging guesses a category from each line's name and the review used to
// pre-fill the select with it; the confirm then wrote `categoryId` whatever
// `categoryStatus` said, so a guess nobody looked at became the record's
// category AND created its checklist. Now a `suggested` line confirms with
// `category_id` null and no questions, exactly as an unsuggested line always
// has, and a `chosen` one is written with its questions.
//
// Staged directly, as boq-revision.test.ts stages a bill: what is under test
// is the confirm, not the reader. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/boq-category-chosen.test.ts
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import { stagedVersion } from "./staged-version";
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

describeIfDb("a bill line's category at confirm", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA bill category', 'qa', 'qa') returning id`,
      [qaNumber("P90061")],
    );
    projectId = project.rows[0].id;
    // A category that asks questions, so "created its checklist" is visible.
    const category = await client.query(
      `select c.id from item_categories c where exists (select 1 from requirements q where q.category_id = c.id)
        order by c.sort_order limit 1`,
    );
    categoryId = category.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(
      `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const line = (index: number, categoryStatus: string) => ({
    index,
    lineNo: index + 1,
    designer: "__QA",
    boqCategory: "__QA Seating",
    area: "__QA Rooms",
    code: `__QAC${index + 1}`,
    itemDescription: `__QA item ${index + 1}`,
    productReference: null,
    qty: 1,
    qtyUnit: "pcs",
    categoryId,
    categoryStatus,
    categoryReason: "name matches “__QA”",
    ignored: false,
  });

  it("writes the chosen line's category and questions, and leaves the suggested one uncategorised", { timeout: 30_000 }, async () => {
    const staged = await client.query(
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
              sheetName: "__QA MAIN",
              proposedRunName: "__QA MAIN",
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: null,
              metadata: { revision: "A", date: "14-Sep-26", notes: [] },
              lines: [line(0, "chosen"), line(1, "suggested"), line(2, "confident")],
            },
          ],
        }),
      ],
    );
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(post({ version: await stagedVersion(client, staged.rows[0].id) }), params(staged.rows[0].id));
    expect(response.status, await response.clone().text()).toBe(200);

    const records = await client.query(
      `select r.source_line_no, r.category_id,
              (select count(*)::int from spec_answers a where a.record_id = r.id) as questions
         from spec_records r where r.project_id = $1 order by r.source_line_no`,
      [projectId],
    );
    expect(records.rows.map((row) => row.source_line_no)).toEqual([1, 2, 3]);
    const [chosen, suggested, confident] = records.rows;
    expect(chosen.category_id).toBe(categoryId);
    expect(chosen.questions).toBeGreaterThan(0);
    // A guess nobody accepted is not a category and creates no checklist.
    expect(suggested.category_id).toBeNull();
    expect(suggested.questions).toBe(0);
    expect(confident.category_id).toBeNull();
    expect(confident.questions).toBe(0);
  });
});
