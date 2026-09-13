// Database tier — the project overview's read and write, through the REAL route.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// What is worth testing here rather than in the pure tier: the date set is
// validated MERGED OVER WHAT IS STORED, so a request that sends one date can
// still be refused by the two it did not send. That merge only exists in the
// route, and a pure test of validateProgramme cannot see it.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patch(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIfDb("project overview", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  async function stored() {
    // ::text, not the driver's Date. `pg` parses a date column into LOCAL
    // midnight, so toISOString() reads the day before it in British Summer
    // Time -- which is how the route's own round-trip bug hid, and how this
    // test would have hidden it a second time.
    const rows = await client.query(
      `select name, client, shared_inbox,
              order_date::text as order_date,
              specs_agreed_by::text as specs_agreed_by,
              delivery_date::text as delivery_date,
              version
         from projects where id = $1`,
      [projectId],
    );
    return rows.rows[0];
  }

  const iso = (value: string | null) => value;

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, client, created_by, updated_by)
       values ('__QA P90002', '__QA Overview project', '__QA Client', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("reads the project and its documents", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const body = await (await GET(new Request("http://localhost/test"), params(projectId))).json();
    expect(body.ok).toBe(true);
    expect(body.project.bws_project_number).toBe("__QA P90002");
    expect(body.project.specs_agreed_by).toBeNull();
    expect(Array.isArray(body.documents)).toBe(true);
  });

  it("stores the three TOE dates as days", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({
        version: before.version,
        orderDate: "2026-02-17",
        specsAgreedBy: "2026-04-01",
        deliveryDate: "2026-06-17",
      }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.project.specs_agreed_by).toBe("2026-04-01");

    const after = await stored();
    expect(iso(after.order_date)).toBe("2026-02-17");
    expect(iso(after.specs_agreed_by)).toBe("2026-04-01");
    expect(iso(after.delivery_date)).toBe("2026-06-17");
    expect(after.version).toBe(before.version + 1);
  });

  // The regression for the day-shift: a PATCH that does not mention the dates
  // still rewrites them, because every field is written on every save. Before
  // the ::text fix this moved each date one day earlier per save.
  it("leaves unsent fields alone", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, client: "__QA New client" }), params(projectId));
    expect(res.status).toBe(200);

    const after = await stored();
    expect(after.client).toBe("__QA New client");
    expect(after.name).toBe(before.name);
    expect(iso(after.specs_agreed_by)).toBe("2026-04-01");
  });

  // The merge case. One date is sent; the two stored ones make the set invalid.
  it("refuses a single date that contradicts the stored ones, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, orderDate: "2026-07-01" }), params(projectId));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/after the/);

    const after = await stored();
    expect(iso(after.order_date)).toBe("2026-02-17");
    expect(after.version).toBe(before.version);
  });

  it("refuses the BWS project number by name, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({ version: before.version, bwsProjectNumber: "__QA P99999" }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/cannot be changed/);

    const rows = await client.query(`select bws_project_number, version from projects where id = $1`, [
      projectId,
    ]);
    expect(rows.rows[0].bws_project_number).toBe("__QA P90002");
    expect(rows.rows[0].version).toBe(before.version);
  });

  it("refuses an unknown field, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, budget: 1000 }), params(projectId));
    expect(res.status).toBe(400);
    expect((await stored()).version).toBe(before.version);
  });

  it("conflicts on a stale version, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({ version: before.version - 1, client: "__QA Stale write" }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("project_version_stale");

    const after = await stored();
    expect(after.client).toBe("__QA New client");
    expect(after.version).toBe(before.version);
  });

  it("clears a date with an explicit null", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, deliveryDate: null }), params(projectId));
    expect(res.status).toBe(200);
    expect(iso((await stored()).delivery_date)).toBeNull();
  });

  it("refuses a date that is not a real day, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, deliveryDate: "2026-02-30" }), params(projectId));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not a real date/);
    expect((await stored()).version).toBe(before.version);
  });

  it("refuses an empty change", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version }), params(projectId));
    expect(res.status).toBe(400);
    expect((await stored()).version).toBe(before.version);
  });
});
