// Database tier: three writes that took no version, or checked then inserted
// (audit A16, 2026-11-06).
//
//   - Retiring a phase took no version, so a press on a screen loaded before
//     somebody renamed the phase, or retired and restored it, went through.
//   - `POST /api/projects` checked for the number and then inserted, so two
//     people adding the same project at once got one 201 and one bare 500
//     from the unique index.
// (The level's version check lives beside its other tests, in
// record-level.test.ts.)
//
// Route handlers in hand, against the local stack; rows are `__QA` and swept.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "editor",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("versions and races at the boundary", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  const numbers: string[] = [];

  beforeAll(async () => {
    await client.connect();
    const number = qaNumber("P90041");
    numbers.push(number);
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA boundary versions', 'qa', 'qa') returning id`,
      [number],
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    const ids = (
      await client.query(`select id from projects where bws_project_number = any($1::text[])`, [numbers])
    ).rows.map((row) => row.id);
    for (const id of ids) {
      await client.query(`delete from spec_records where project_id = $1`, [id]);
      await client.query(`delete from spec_runs where project_id = $1`, [id]);
      await client.query(`delete from projects where id = $1`, [id]);
    }
    await client.end();
  });

  async function phase(name: string) {
    const run = await client.query(
      `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
       values ($1, $2, 1, 'qa', 'qa') returning id, version`,
      [projectId, name],
    );
    return run.rows[0] as { id: string; version: number };
  }

  async function patchPhase(runId: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/projects/[id]/runs/[runId]/route");
    return PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: projectId, runId }) },
    );
  }

  it("retires a phase at the version the screen showed", async () => {
    const run = await phase("__QA MAIN");
    const response = await patchPhase(run.id, { status: "retired", reason: "superseded by Rev B", version: run.version });
    expect(response.status).toBe(200);
    const after = await client.query(`select status from spec_runs where id = $1`, [run.id]);
    expect(after.rows[0].status).toBe("retired");
  });

  it("refuses to retire a phase that changed since the screen loaded, and writes nothing", async () => {
    const run = await phase("__QA VE");
    await client.query(`update spec_runs set name = '__QA VE (renamed)', updated_by = 'someone' where id = $1`, [run.id]);
    const response = await patchPhase(run.id, { status: "retired", reason: "not needed", version: run.version });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("phase_version_stale");
    expect(body.error).toMatch(/changed since this screen loaded/);
    const after = await client.query(`select status from spec_runs where id = $1`, [run.id]);
    expect(after.rows[0].status).toBe("active");
  });

  it("refuses a retire that does not say which version it saw", async () => {
    const run = await phase("__QA MUR");
    const response = await patchPhase(run.id, { status: "retired", reason: "not needed" });
    expect(response.status).toBe(400);
  });

  it("answers two people adding the same project at once with one 201 and 409s in words, never a 500", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const number = qaNumber("P90042");
    numbers.push(number);
    const add = () =>
      POST(
        new Request("http://localhost/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bwsProjectNumber: number, name: "__QA raced project" }),
        }),
      );
    const responses = await Promise.all([add(), add(), add(), add(), add()]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const refused = responses.find((response) => response.status === 409)!;
    expect(((await refused.json()) as { error: string }).error).toMatch(/already exists/);
  });
});
