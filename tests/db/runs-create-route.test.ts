// Database tier — POST /api/projects/[id]/runs, adding a phase with no bill
// behind it.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/runs-create-route.test.ts
//
// What it holds (review 5.1; the route's header and `createRun`):
//  - a phase is added active, trimmed, at the end of the project's order, and
//    the trail says so (`run_create`, the name as its reason — `label` is a
//    baseline's alone);
//  - TWO PHASES MAY SHARE A NAME: a revised bill legitimately makes a second
//    "MAIN RUN", so refusing one here would be a rule the import does not follow;
//  - a retired phase still holds its place: the next one goes after it, and it
//    stays retired;
//  - a blank name is a 400 and an unknown project a 404, each writing nothing.
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

describeIfDb("adding a phase", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90210")}', '__QA phase create', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const phases = async () =>
    (
      await client.query(`select id, name, status, sort_order from spec_runs where project_id = $1 order by sort_order`, [projectId])
    ).rows as { id: string; name: string; status: string; sort_order: number }[];

  async function add(name: string): Promise<Response> {
    const { POST } = await import("@/app/api/projects/[id]/runs/route");
    return POST(post({ name }), params(projectId));
  }

  it("adds an active phase at the end, trimmed, with one entry in the trail", async () => {
    const res = await add("  __QA MAIN RUN  ");
    expect(res.status).toBe(201);
    const { run } = await res.json();
    expect(run.name).toBe("__QA MAIN RUN");
    const [row] = await phases();
    expect(row).toMatchObject({ id: run.runId, name: "__QA MAIN RUN", status: "active", sort_order: 1 });
    const cs = (await client.query(`select kind, reason, label from change_sets where id = $1`, [run.changeSetId])).rows[0];
    expect(cs).toEqual({ kind: "run_create", reason: "__QA MAIN RUN", label: null });
  });

  it("allows a second phase with the same name, beside the first", async () => {
    const res = await add("__QA MAIN RUN");
    expect(res.status).toBe(201);
    const same = (await phases()).filter((row) => row.name === "__QA MAIN RUN");
    expect(same).toHaveLength(2);
    expect(same.map((row) => row.sort_order)).toEqual([1, 2]);
  });

  it("puts a new phase after a retired one, and leaves the retired one retired", async () => {
    const last = (await phases()).at(-1)!;
    await client.query(
      `update spec_runs set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa' where id = $1`,
      [last.id],
    );
    const res = await add("__QA MAIN RUN");
    expect(res.status).toBe(201);
    const all = await phases();
    expect(all.find((row) => row.id === last.id)!.status).toBe("retired");
    expect(all.at(-1)).toMatchObject({ name: "__QA MAIN RUN", status: "active", sort_order: last.sort_order + 1 });
  });

  it("refuses a blank name and an unknown project, writing nothing", async () => {
    const before = await phases();
    const sets = async () =>
      Number((await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n);
    const setsBefore = await sets();

    for (const name of ["", "   "]) {
      const res = await add(name);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("A phase needs a name.");
    }
    const { POST } = await import("@/app/api/projects/[id]/runs/route");
    const missing = await POST(post({ name: "__QA Nowhere" }), params("00000000-0000-4000-8000-000000000000"));
    expect(missing.status).toBe(404);

    expect(await phases()).toEqual(before);
    expect(await sets()).toBe(setsBefore);
  });
});
