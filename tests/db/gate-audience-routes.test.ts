// Database tier — the record's gate rows and checklist read a question's
// audience WITH the project's route (chase review A5, 2026-11-21).
//
// "Ask the client" (`project_question_routes`) moves one question to the
// client on one project. The chase and "Chase the n" read the routed
// audience; the record's gate rows (`loadGateContext`, `itemTgqForRecord`) and
// `/api/records/[id]` read the SEED's. Latent today — every non-client gate row
// is project-wide, which is bucketed first — and it would show as the button
// and the chase disagreeing the day an in-house per-item question becomes a
// gate row. Both now read the routed audience, and another project is
// untouched.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-gate-audience@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const TOE = "prompt:toe agreement";

describeIfDb("gate rows read the routed audience", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";
  let recordId = "";
  let otherRecordId = "";
  let categoryId = "";

  async function project(no: string): Promise<{ projectId: string; recordId: string }> {
    const pid = (
      await client.query(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Gate audience', 'qa', 'qa') returning id`, [
        qaNumber(no),
      ])
    ).rows[0].id as string;
    const run = (
      await client.query(`insert into spec_runs (project_id, name, sort_order, created_by, updated_by) values ($1, '__QA run', 1, 'qa', 'qa') returning id`, [pid])
    ).rows[0].id as string;
    const rid = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
         values ($1, $2, 1, 'active', $3, '__QA Dining chair', 'qa', 'qa') returning id`,
        [pid, run, categoryId],
      )
    ).rows[0].id as string;
    return { projectId: pid, recordId: rid };
  }

  beforeAll(async () => {
    await client.connect();
    // By slug, never uuid order: a seating sheet on Matthew's matrix.
    categoryId = (await client.query(`select id from item_categories where slug = 'dining-chair'`)).rows[0].id;
    ({ projectId, recordId } = await project("P90071"));
    ({ projectId: otherProjectId, recordId: otherRecordId } = await project("P90072"));
    await client.query(
      `insert into project_question_routes (project_id, question_key, audience, created_by, updated_by) values ($1, $2, 'client', 'qa', 'qa')`,
      [projectId, TOE],
    );
  }, SLOW);

  afterAll(async () => {
    for (const pid of [projectId, otherProjectId]) {
      if (!pid) continue;
      await client.query(`delete from project_question_routes where project_id = $1`, [pid]);
      await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [pid]);
      await client.query(`delete from spec_records where project_id = $1`, [pid]);
      await client.query(`delete from spec_runs where project_id = $1`, [pid]);
      await client.query(`delete from projects where id = $1`, [pid]);
    }
    await client.end();
  }, SLOW);

  it("loadGateContext gives a record its project's routed audience, and leaves another project's alone", async () => {
    const { sql } = await import("@/lib/db");
    const { loadGateContext, questionsForRecord } = await import("@/lib/gate-load");
    const context = await loadGateContext(sql, [recordId, otherRecordId]);
    const toe = (rid: string) => questionsForRecord(context, { id: rid, categoryId }).find((q) => q.prompt === "TOE agreement")!;
    expect(toe(recordId).audience).toBe("client");
    expect(toe(otherRecordId).audience).toBe("cam");
  });

  it("/api/records/[id] sends the routed audience on the checklist answers", async () => {
    const { GET } = await import("@/app/api/records/[id]/route");
    const read = async (rid: string) =>
      (await (await GET(new Request(`http://localhost/api/records/${rid}`), { params: Promise.resolve({ id: rid }) })).json()) as {
        answers: { prompt: string; audience: string }[];
      };
    expect((await read(recordId)).answers.find((a) => a.prompt === "TOE agreement")?.audience).toBe("client");
    expect((await read(otherRecordId)).answers.find((a) => a.prompt === "TOE agreement")?.audience).toBe("cam");
  });
});
