// Database tier — the infill screen's boundary, through the REAL routes.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/infill-routes.test.ts
//
// The screen is only as safe as the two routes it posts to, and both of them
// already existed — which is the point: this screen adds no write path. What
// is asserted here is that the boundary answers in JSON with a code the row
// can act on, for the two refusals a meeting will actually hit: somebody else
// changed the answer (409), and the answer has since been settled so the edit
// needs a reason (400).
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-routes@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("the infill routes", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let recordId = "";
  let answerId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90034")}', '__QA Infill routes', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    const runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    recordId = (
      await client.query(
        `insert into spec_records
           (project_id, run_id, record_no, status, category_id, item_description, qty, area, level, created_by, updated_by)
         values ($1, $2, 1, 'active', $3, '__QA Armchair', 2, '__QA Suite', 'complex', 'qa', 'qa') returning id`,
        [projectId, runId, categoryId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
         from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );
    answerId = (
      await client.query(`select id from spec_answers where record_id = $1 limit 1`, [recordId])
    ).rows[0].id;
    // An uncategorised item too, so the screen's own block has something in it.
    await client.query(
      `insert into spec_records
         (project_id, run_id, record_no, status, item_description, created_by, updated_by)
       values ($1, $2, 2, 'active', '__QA Unknown thing', 'qa', 'qa')`,
      [projectId, runId],
    );
  }, SLOW);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("lists the lines, the uncategorised items and the palettes in one read", async () => {
    const { GET } = await import("@/app/api/projects/[id]/infill/route");
    const res = await GET(new Request("http://localhost/test"), params(projectId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lines: { lineId: string; counts: { toQuote: number } }[];
      uncategorised: { recordId: string; version: number }[];
      totals: { questions: number };
      palettes: unknown[];
    };
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]!.lineId).toBe(recordId);
    expect(body.totals.questions).toBeGreaterThan(0);
    // The uncategorised item carries its VERSION, so a category can be set
    // from the list rather than only from the record screen.
    expect(body.uncategorised).toHaveLength(1);
    expect(typeof body.uncategorised[0]!.version).toBe("number");
    expect(body.palettes.length).toBeGreaterThan(0);
  }, SLOW);

  it("groups by question too, folding the same question across categories", async () => {
    const { GET } = await import("@/app/api/projects/[id]/infill/route");
    const res = await GET(new Request("http://localhost/test"), params(projectId));
    const body = (await res.json()) as {
      questions: { key: string; heading: string; requirementIds: string[]; records: number; rows: number }[];
      questionAreas: { key: string; label: string; count: number }[];
    };
    const dimensions = body.questions.find((group) => group.heading === "Dimensions");
    expect(dimensions).toBeTruthy();
    // Keyed on the BWS field, so seventeen `requirements` rows are ONE heading.
    expect(dimensions!.key).toBe("field:3");
    expect(dimensions!.records).toBe(1);
    // And the areas are counted in ROWS, which is what the by-question list is
    // about — the by-item tab counts lines and builds its own.
    expect(body.questionAreas.length).toBeGreaterThan(0);
    expect(body.questionAreas.reduce((sum, area) => sum + area.count, 0)).toBeGreaterThan(0);
  }, SLOW);

  it("returns ONE question's items when a heading is opened", async () => {
    const { GET } = await import("@/app/api/projects/[id]/infill/route");
    const summary = await (await GET(new Request("http://localhost/test"), params(projectId))).json();
    const group = (summary as { questions: { heading: string; requirementIds: string[] }[] }).questions.find(
      (row) => row.heading === "Dimensions",
    )!;
    const res = await GET(
      new Request(`http://localhost/test?requirements=${group.requirementIds.join(",")}`),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: { prompt: string; jsonId: number | null }[] };
    expect(body.questions.length).toBeGreaterThan(0);
    for (const question of body.questions) expect(question.jsonId).toBe(3);
  }, SLOW);

  it("returns ONE line's questions when the line is opened, with what is already known", async () => {
    const { GET } = await import("@/app/api/projects/[id]/infill/route");
    const res = await GET(
      new Request(`http://localhost/test?line=${recordId}`),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: { recordId: string; answerId: string | null }[] };
    expect(body.questions.length).toBeGreaterThan(0);
    for (const question of body.questions) expect(question.recordId).toBe(recordId);
  }, SLOW);

  it("409s a stale version, in JSON, with a code the row can act on", async () => {
    const { PATCH } = await import("@/app/api/answers/[id]/route");
    const res = await PATCH(
      patch({ value: "__QA stale", state: "confirmed", version: 99 }),
      params(answerId),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("answer_version_stale");
    expect(body.error).toMatch(/changed by someone else/);
  }, SLOW);

  it("400s an override of a settled answer with no reason and no open change", async () => {
    const { PATCH } = await import("@/app/api/answers/[id]/route");
    const version = Number(
      (await client.query(`select version from spec_answers where id = $1`, [answerId])).rows[0].version,
    );
    const settled = await PATCH(patch({ value: "__QA settled", state: "confirmed", version }), params(answerId));
    expect(settled.status).toBe(200);
    const after = (await settled.json()) as { answer: { version: number } };

    const refused = await PATCH(
      patch({ value: "__QA overridden", state: "confirmed", version: after.answer.version }),
      params(answerId),
    );
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { code: string };
    expect(body.code).toBe("reason_required");

    // Nothing was written.
    const value = (await client.query(`select value from spec_answers where id = $1`, [answerId])).rows[0].value;
    expect(value).toBe("__QA settled");

    // And WITH a reason it goes through.
    const withReason = await PATCH(
      patch({
        value: "__QA overridden",
        state: "confirmed",
        version: after.answer.version,
        reason: "__QA Hayley said so on the handover call",
      }),
      params(answerId),
    );
    expect(withReason.status).toBe(200);
  }, SLOW);
});
