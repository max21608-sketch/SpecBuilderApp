// Database tier — a project-wide question answered ONCE, through the real route.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.localstack.local ./node_modules/vitest/vitest.mjs run tests/db/project-wide.test.ts
//
// Max, 2026-10-12: the Project / commercial section is answered once per
// project and applies to every item that asks it. What is asserted here is
// what makes that safe: the question is ONE row on the card however many
// cheat sheets ask it; the answer fans out to every item under ONE change set
// with ONE version per record and `spec_records.version` untouched; a set that
// moved since the card loaded is refused WHOLE with nothing written; and a
// settled, different answer is left alone unless ticked, and a tick needs a
// reason.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { PROJECT_WIDE_SECTION } from "@/lib/checklist-sections";
import { loadProjectSummary } from "@/lib/project-summary";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-project-wide@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Row = { recordId: string; requirementId: string; answerId: string | null; answerVersion: number | null; state: string; value: string | null };
type Question = { key: string; heading: string; rows: Row[]; items: number; toQuoteOutstanding: number; values: unknown[] };

describeIfDb("a project-wide question, answered once", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  /** Two categories that both ask Access (json 6) in the project-wide section. */
  let categoryA = "";
  let categoryB = "";
  /** A and C on category A, B on category B. */
  let recordA = "";
  let recordB = "";
  let recordC = "";

  async function card(): Promise<Question> {
    const { GET } = await import("@/app/api/projects/[id]/project-wide/route");
    const response = await GET(new Request("http://localhost/test"), params(projectId));
    const body = (await response.json()) as { questions: Question[] };
    return body.questions.find((question) => question.key === "field:6")!;
  }

  async function answer(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/projects/[id]/project-wide/route");
    const response = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params(projectId),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const seen = (question: Question) =>
    question.rows.map((row) => ({
      recordId: row.recordId,
      requirementId: row.requirementId,
      answerId: row.answerId,
      version: row.answerVersion,
    }));

  async function record(no: number, categoryId: string): Promise<string> {
    const id = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, level,
                                   created_by, updated_by)
         values ($1, $2, $3, 'active', $4, '__QA Item', 'simple', 'qa', 'qa') returning id`,
        [projectId, runId, no, categoryId],
      )
    ).rows[0].id as string;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
         from requirements q where q.category_id = $2`,
      [id, categoryId],
    );
    return id;
  }

  async function accessAnswer(recordId: string) {
    const found = await client.query(
      `select a.id, a.state, a.value, a.version, a.source_kind
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = 6 and q.section = $2 and a.revision_no = 0`,
      [recordId, PROJECT_WIDE_SECTION],
    );
    return found.rows[0];
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90061")}', '__QA Project-wide', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const categories = await client.query(
      `select q.category_id from requirements q join spec_fields f on f.id = q.spec_field_id
        where f.json_id = 6 and q.section = $1
        order by q.category_id limit 2`,
      [PROJECT_WIDE_SECTION],
    );
    categoryA = categories.rows[0].category_id;
    categoryB = categories.rows[1].category_id;
    recordA = await record(1, categoryA);
    recordB = await record(2, categoryB);
    recordC = await record(3, categoryA);
    // C is the exception somebody already settled on its own.
    await client.query(
      `update spec_answers a set state = 'confirmed', value = '__QA Crane needed', confirmed_by = 'qa',
              confirmed_at = now(), updated_by = 'qa'
        from requirements q join spec_fields f on f.id = q.spec_field_id
       where a.requirement_id = q.id and a.record_id = $1 and f.json_id = 6 and q.section = $2`,
      [recordC, PROJECT_WIDE_SECTION],
    );
  }, SLOW);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // Versions and change sets CASCADE with their record and project (0013, 0014).
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("is ONE question on the card however many cheat sheets ask it", async () => {
    const question = await card();
    expect(question.items).toBe(3);
    expect(new Set(question.rows.map((row) => row.requirementId)).size).toBe(2);
    expect(question.values).toHaveLength(1);
  });

  it("refuses WHOLE when the set moved since the card loaded, and writes nothing", async () => {
    const before = await card();
    // A fourth item arrives after the card was read.
    const late = await record(4, categoryB);
    try {
      const result = await answer({ key: before.key, value: "__QA Lift OK", state: "confirmed", seen: seen(before) });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("project_wide_moved");
      expect((await accessAnswer(recordA)).state).toBe("missing");
    } finally {
      await client.query(`delete from spec_answers where record_id = $1`, [late]);
      await client.query(`delete from spec_records where id = $1`, [late]);
    }
  });

  it("leaves a settled, different answer alone unless it is ticked, and a tick needs a reason", async () => {
    const question = await card();
    const c = question.rows.find((row) => row.recordId === recordC)!;
    const refused = await answer({
      key: question.key,
      value: "__QA Lift OK",
      state: "confirmed",
      seen: seen(question),
      overrides: [c.answerId],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("reason_required");
    expect((await accessAnswer(recordA)).state).toBe("missing");
  });

  it("writes every item that asks it under ONE change set, ONE version each, the record untouched", async () => {
    const question = await card();
    const versionsBefore = await client.query(
      `select id, version from spec_records where project_id = $1 order by id`,
      [projectId],
    );
    const result = await answer({ key: question.key, value: "__QA Lift OK", state: "confirmed", seen: seen(question) });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ written: 2, overridden: 0, records: 2 });
    expect((result.body.leftAlone as unknown[]).length).toBe(1);

    for (const id of [recordA, recordB]) {
      const row = await accessAnswer(id);
      expect(row).toMatchObject({ state: "confirmed", value: "__QA Lift OK", source_kind: "manual" });
    }
    // THE EXCEPTION STANDS.
    expect(await accessAnswer(recordC)).toMatchObject({ state: "confirmed", value: "__QA Crane needed" });

    const changeSetId = String(result.body.changeSetId);
    const snapshots = await client.query(
      `select record_id from record_snapshots where change_set_id = $1 order by record_id`,
      [changeSetId],
    );
    expect(snapshots.rows.map((row) => row.record_id).sort()).toEqual([recordA, recordB].sort());
    const sets = await client.query(`select count(*)::int as n from change_sets where id = $1`, [changeSetId]);
    expect(sets.rows[0].n).toBe(1);

    // `spec_records.version` is not touched: an answer is its own row.
    const versionsAfter = await client.query(
      `select id, version from spec_records where project_id = $1 order by id`,
      [projectId],
    );
    expect(versionsAfter.rows).toEqual(versionsBefore.rows);
  });

  it("replaces the exception when it is ticked with a reason", async () => {
    const question = await card();
    const c = question.rows.find((row) => row.recordId === recordC)!;
    const result = await answer({
      key: question.key,
      value: "__QA Lift OK",
      state: "confirmed",
      seen: seen(question),
      overrides: [c.answerId],
      reason: "__QA the crane was the old building",
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ written: 0, overridden: 1, records: 1 });
    expect(await accessAnswer(recordC)).toMatchObject({ state: "confirmed", value: "__QA Lift OK" });
  });

  it("is then off the project's TGQ figure, which the card and the summary agree on", async () => {
    const question = await card();
    expect(question.toQuoteOutstanding).toBe(0);
    const { GET } = await import("@/app/api/projects/[id]/project-wide/route");
    const body = (await (await GET(new Request("http://localhost/test"), params(projectId))).json()) as { toQuote: number };
    expect((await loadProjectSummary(projectId)).projectWide).toBe(body.toQuote);
  });
});
