// Database tier — POST /api/projects/[id]/levels/accept, accepting the levels
// the app suggested, THROUGH THE ROUTE.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/levels-accept-route.test.ts
//
// `tests/db/record-level.test.ts` holds the library: one change set for a
// run, the `expectedCount` refusal, the named-records form. What it does not
// hold, and this file does (review 5.1, and review 1.4's "the screens' scope"):
//  - `runId` scopes the press to that phase — another phase's suggestions stand;
//  - with no `runId`, a RETIRED phase's records are not accepted: no screen
//    shows them, so nothing there was seen;
//  - a SPLIT bill line is skipped (its configurations carry the level), while
//    each configuration's own suggestion is accepted;
//  - a decided level is never revisited, and a record with no suggestion is
//    left alone;
//  - a body that is neither form is a 400.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: "__qa@example.test", name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("accepting suggested levels, through the route", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90209")}', '__QA levels accept route', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    // Deleting the project takes the phases, records, versions and change sets.
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function phase(name: string, retired = false): Promise<string> {
    return (
      await client.query(
        `insert into spec_runs (project_id, name, status, retired_at, retired_by, created_by, updated_by)
         values ($1, $2, $3, $4, $5, 'qa', 'qa') returning id`,
        [projectId, name, retired ? "retired" : "active", retired ? new Date() : null, retired ? "qa" : null],
      )
    ).rows[0].id;
  }

  async function record(
    runId: string,
    fields: { suggested?: string | null; level?: string | null; parentId?: string; label?: string } = {},
  ): Promise<string> {
    const no = Number(
      (await client.query(`select coalesce(max(record_no), 0) + 1 as n from spec_records where project_id = $1`, [projectId]))
        .rows[0].n,
    );
    const suggested = fields.suggested ?? null;
    return (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, status, level, level_suggested,
                                   level_suggested_reason, parent_id, depth, split_reason, variant_label, created_by, updated_by)
         values ($1, $2, $3, '__QA Sofa', 'active', $4, $5, $6, $7, $8, $9, $10, 'qa', 'qa') returning id`,
        [
          projectId,
          runId,
          no,
          fields.level ?? null,
          suggested,
          suggested ? "the bill names no metalwork" : null,
          fields.parentId ?? null,
          fields.parentId ? 1 : 0,
          fields.parentId ? "fabric" : null,
          fields.label ?? null,
        ],
      )
    ).rows[0].id;
  }

  const level = async (id: string) =>
    (await client.query(`select level, level_suggested from spec_records where id = $1`, [id])).rows[0];

  it("accepts only the named phase, skipping a split line, a decided level and a record with nothing to agree with", async () => {
    const main = await phase("__QA Main");
    const ve = await phase("__QA VE");
    const plain = await record(main, { suggested: "complex" });
    const decided = await record(main, { level: "hero" });
    const none = await record(main);
    // A split bill line: its own suggestion is not what ships; each
    // configuration's is.
    const split = await record(main, { suggested: "simple" });
    const typeA = await record(main, { suggested: "hero", parentId: split, label: "TYPE A" });
    const typeB = await record(main, { suggested: "simple", parentId: split, label: "TYPE B" });
    const elsewhere = await record(ve, { suggested: "simple" });

    const { POST } = await import("@/app/api/projects/[id]/levels/accept/route");
    const res = await POST(post({ runId: main, expectedCount: 3 }), params(projectId));
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBe(3);

    expect(await level(plain)).toEqual({ level: "complex", level_suggested: null });
    expect(await level(typeA)).toEqual({ level: "hero", level_suggested: null });
    expect(await level(typeB)).toEqual({ level: "simple", level_suggested: null });
    expect(await level(split)).toEqual({ level: null, level_suggested: "simple" });
    expect(await level(decided)).toEqual({ level: "hero", level_suggested: null });
    expect(await level(none)).toEqual({ level: null, level_suggested: null });
    expect(await level(elsewhere)).toEqual({ level: null, level_suggested: "simple" });

    // ONE change set for the press.
    const sets = await client.query(
      `select count(*)::int as n from change_sets where project_id = $1 and kind = 'level_set'`,
      [projectId],
    );
    expect(sets.rows[0].n).toBe(1);
  });

  it("with no phase named, accepts every active phase and never a retired one", async () => {
    const live = await phase("__QA Live");
    const retired = await phase("__QA Retired", true);
    const onLive = await record(live, { suggested: "simple" });
    const onRetired = await record(retired, { suggested: "complex" });
    const pending = Number(
      (
        await client.query(
          `select count(*)::int as n from spec_records r join spec_runs run on run.id = r.run_id
            where r.project_id = $1 and r.status = 'active' and run.status = 'active' and r.level is null
              and r.level_suggested is not null
              and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')`,
          [projectId],
        )
      ).rows[0].n,
    );

    const { POST } = await import("@/app/api/projects/[id]/levels/accept/route");
    // A count that includes the retired phase's record is what a screen
    // counting it would send, and it is refused.
    const wrong = await POST(post({ expectedCount: pending + 1 }), params(projectId));
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).code).toBe("levels_stale");
    expect((await level(onLive)).level).toBeNull();

    const res = await POST(post({ expectedCount: pending }), params(projectId));
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBe(pending);
    expect((await level(onLive)).level).toBe("simple");
    expect(await level(onRetired)).toEqual({ level: null, level_suggested: "complex" });
  });

  it("refuses a body that is neither form", async () => {
    const { POST } = await import("@/app/api/projects/[id]/levels/accept/route");
    const levelOnly = await POST(post({ level: "hero" }), params(projectId));
    expect(levelOnly.status).toBe(400);
    const mixed = await POST(post({ runId: null, level: "hero" }), params(projectId));
    expect(mixed.status).toBe(400);
  });
});
