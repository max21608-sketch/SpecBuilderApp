// Database tier — one value applied to several items, through the REAL route.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/infill-apply.test.ts
//
// "Access has been approved for everything" (Max, 2026-09-22). What is
// asserted here is everything that makes the batch safe rather than fast:
// twenty-something answers land under ONE change set with one version per
// record; a row somebody else moved is skipped and NAMED while the rest still
// land; an answer already settled is skipped and named rather than
// overwritten; and a dimension question writes nothing at all, because the
// composed cell is a projection of the record's own attributes.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-apply@example.test",
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

type Filed = { recordId: string; requirementId: string; version: number };
type Skipped = { recordId: string; label: string; why: string };

describeIfDb("applying one value to several items", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  /** Three bill lines owing the same question. */
  const recordIds: string[] = [];
  /** The question the batch is about — a spec field that is NOT dimensions. */
  let requirementId = "";
  /** The dimensions question on the same category, which must never batch. */
  let dimensionRequirementId = "";

  /** One row of the request body, read live so the version is the real one. */
  async function rowFor(recordId: string, requirement: string): Promise<{
    recordId: string;
    requirementId: string;
    answerId: string;
    version: number;
  }> {
    const found = await client.query(
      `select id, version from spec_answers where record_id = $1 and requirement_id = $2 and revision_no = 0`,
      [recordId, requirement],
    );
    return {
      recordId,
      requirementId: requirement,
      answerId: String(found.rows[0].id),
      version: Number(found.rows[0].version),
    };
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90041")}', '__QA Apply to many', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    const runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;

    for (let index = 1; index <= 3; index += 1) {
      const recordId = (
        await client.query(
          `insert into spec_records
             (project_id, run_id, record_no, status, category_id, item_description, qty, area, level, created_by, updated_by)
           values ($1, $2, $3, 'active', $4, '__QA Headboard', 2, '__QA Suite', 'simple', 'qa', 'qa') returning id`,
          [projectId, runId, index, categoryId],
        )
      ).rows[0].id;
      recordIds.push(recordId);
      await client.query(
        `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
         select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
           from requirements q where q.category_id = $2`,
        [recordId, categoryId],
      );
    }

    // A question that is NOT the composed dimensions cell, so the batch has
    // something legitimate to write.
    requirementId = (
      await client.query(
        `select q.id from requirements q
           left join spec_fields f on f.id = q.spec_field_id
          where q.category_id = $1 and coalesce(f.json_id, 0) <> 3
          order by q.sort_order limit 1`,
        [categoryId],
      )
    ).rows[0].id;
    dimensionRequirementId = (
      await client.query(
        `select q.id from requirements q
           join spec_fields f on f.id = q.spec_field_id
          where q.category_id = $1 and f.json_id = 3
          limit 1`,
        [categoryId],
      )
    ).rows[0].id;
  }, SLOW);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // NEITHER A VERSION NOR A CHANGE SET IS DELETED BY HAND. `record_snapshots`
    // is append-only and refuses a delete while its record exists (0013), and
    // a change set refuses one outright (0014) — both CASCADE, which is the
    // rule rather than an obstacle to route around. Deleting the records took
    // the versions; deleting the project takes the changes.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("writes every ticked item under ONE change set, and one version per record", async () => {
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");
    const before = Number(
      (await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n,
    );

    const rows = await Promise.all(recordIds.map((recordId) => rowFor(recordId, requirementId)));
    const res = await POST(
      post({ value: "__QA Approved", state: "confirmed", rows }),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { filed: Filed[]; skipped: Skipped[]; changeSetId: string };
    expect(body.filed).toHaveLength(3);
    expect(body.skipped).toHaveLength(0);

    // Three answers, all carrying the value and out of `applyAnswerFills`' reach.
    const written = await client.query(
      `select value, state, source_kind from spec_answers
        where requirement_id = $1 and record_id = any($2::uuid[]) and revision_no = 0`,
      [requirementId, recordIds],
    );
    expect(written.rows).toHaveLength(3);
    for (const row of written.rows) {
      expect(row.value).toBe("__QA Approved");
      expect(row.state).toBe("confirmed");
      expect(row.source_kind).toBe("manual");
    }

    // ONE change set for the press, not three — the `editFinish` lesson.
    const after = Number(
      (await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n,
    );
    expect(after - before).toBe(1);
    const reason = (
      await client.query(`select kind, reason from change_sets where id = $1`, [body.changeSetId])
    ).rows[0];
    expect(reason.kind).toBe("manual_edit");
    expect(String(reason.reason)).toMatch(/on 3 items/);

    // And ONE version per record, all of them on that change.
    const versions = await client.query(
      `select record_id, count(*)::int as n from record_snapshots
        where record_id = any($1::uuid[]) and change_set_id = $2 group by record_id`,
      [recordIds, body.changeSetId],
    );
    expect(versions.rows).toHaveLength(3);
    for (const row of versions.rows) expect(row.n).toBe(1);
  }, SLOW);

  it("skips a row whose version moved, NAMES it, and still lands the rest", async () => {
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");
    // A second question, so the first test's writes are not in the way.
    const second = (
      await client.query(
        `select q.id from requirements q
           left join spec_fields f on f.id = q.spec_field_id
          where q.category_id = $1 and coalesce(f.json_id, 0) <> 3 and q.id <> $2
          order by q.sort_order limit 1`,
        [categoryId, requirementId],
      )
    ).rows[0].id;

    const rows = await Promise.all(recordIds.map((recordId) => rowFor(recordId, second)));
    const stale = { ...rows[0]!, version: rows[0]!.version + 7 };
    const res = await POST(
      post({ value: "__QA Second value", state: "confirmed", rows: [stale, rows[1]!, rows[2]!] }),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { filed: Filed[]; skipped: Skipped[] };
    expect(body.filed).toHaveLength(2);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]!.recordId).toBe(recordIds[0]);
    expect(body.skipped[0]!.why).toMatch(/changed it since this screen loaded/);
    // NAMED, not reported by uuid — a skipped row nobody can find is no report.
    expect(body.skipped[0]!.label).toMatch(/-001$/);

    const untouched = await client.query(
      `select value from spec_answers where record_id = $1 and requirement_id = $2 and revision_no = 0`,
      [recordIds[0], second],
    );
    expect(untouched.rows[0].value).toBeNull();
  }, SLOW);

  it("does NOT overwrite an answer somebody already gave — it names it", async () => {
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");
    // The first test confirmed all three on `requirementId`. Pressing again
    // over the same set must write nothing at all.
    const rows = await Promise.all(recordIds.map((recordId) => rowFor(recordId, requirementId)));
    const res = await POST(
      post({ value: "__QA Something else", state: "confirmed", rows }),
      params(projectId),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("nothing_to_apply");
    expect(body.error).toMatch(/already answered/);

    const still = await client.query(
      `select distinct value from spec_answers
        where requirement_id = $1 and record_id = any($2::uuid[]) and revision_no = 0`,
      [requirementId, recordIds],
    );
    expect(still.rows).toHaveLength(1);
    expect(still.rows[0].value).toBe("__QA Approved");
  }, SLOW);

  it("writes NOTHING for a dimension question, whatever the request says", async () => {
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");
    const rows = await Promise.all(recordIds.map((recordId) => rowFor(recordId, dimensionRequirementId)));
    const res = await POST(post({ value: "__QA W1900mm", state: "confirmed", rows }), params(projectId));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("nothing_to_apply");
    expect(body.error).toMatch(/a dimension is recorded per item/);

    const untouched = await client.query(
      `select value, state from spec_answers
        where requirement_id = $1 and record_id = any($2::uuid[]) and revision_no = 0`,
      [dimensionRequirementId, recordIds],
    );
    expect(untouched.rows).toHaveLength(3);
    for (const row of untouched.rows) {
      expect(row.value).toBeNull();
      expect(row.state).toBe("missing");
    }
    // And no attribute was invented either — a batch is not a second way in.
    const attributes = await client.query(
      `select count(*)::int as n from record_attributes where record_id = any($1::uuid[])`,
      [recordIds],
    );
    expect(attributes.rows[0].n).toBe(0);
  }, SLOW);

  it("refuses an answer that belongs to another project", async () => {
    const { POST } = await import("@/app/api/projects/[id]/answers/apply/route");
    const rows = [await rowFor(recordIds[1]!, dimensionRequirementId)];
    const other = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90042")}', '__QA Other project', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    try {
      const res = await POST(post({ value: "__QA nope", state: "confirmed", rows }), params(other));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/belongs to another project/);
    } finally {
      await client.query(`delete from projects where id = $1`, [other]);
    }
  }, SLOW);
});
