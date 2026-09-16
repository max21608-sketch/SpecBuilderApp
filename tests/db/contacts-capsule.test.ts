// Database tier — linking a contact to Capsule, through the REAL routes.
//
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/contacts-capsule.test.ts
//
// The claim worth proving: with no token, a LINKED contact is refused and
// NOTHING is written, while a manual one still succeeds. Capsule must gate the
// link and never gate the ability to record somebody to chase.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-0000000000qa".slice(0, 36),
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function post(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIfDb("contacts and Capsule", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  const token = process.env.CAPSULE_API_TOKEN;

  beforeAll(async () => {
    await client.connect();
    // No token: the deployment state this test is about.
    delete process.env.CAPSULE_API_TOKEN;

    const stale = await client.query(`select id from projects where bws_project_number = '__QA P90012'`);
    for (const row of stale.rows) {
      await client.query(`delete from project_contacts where project_id = $1`, [row.id]);
      await client.query(`delete from projects where id = $1`, [row.id]);
    }
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90012', '__QA Capsule project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    if (token === undefined) delete process.env.CAPSULE_API_TOKEN;
    else process.env.CAPSULE_API_TOKEN = token;
    if (projectId) {
      await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function contacts() {
    const rows = await client.query(`select * from project_contacts where project_id = $1 order by name`, [
      projectId,
    ]);
    return rows.rows;
  }

  it("refuses a Capsule-linked contact when Capsule is not connected, and writes nothing", async () => {
    const { POST } = await import("@/app/api/projects/[id]/contacts/route");
    const before = await contacts();
    const res = await POST(
      post({ name: "__QA Linked", email: "linked@example.test", role: "designer", capsulePartyId: 42 }),
      params(projectId),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("capsule_not_configured");
    // A contact recorded as linked to a party nobody read would be worse than
    // no contact at all.
    expect(await contacts()).toHaveLength(before.length);
  });

  it("still records a contact added by hand, because chasing must not depend on Capsule", async () => {
    const { POST } = await import("@/app/api/projects/[id]/contacts/route");
    const res = await POST(
      post({ name: "__QA By Hand", email: "byhand@example.test", role: "designer", designerCode: "qalcs" }),
      params(projectId),
    );
    expect(res.status).toBe(201);
    const row = (await contacts()).find((c: { name: string }) => c.name === "__QA By Hand");
    expect(row.capsule_party_id).toBeNull();
    expect(row.capsule_synced_at).toBeNull();
    // Uppercased at the boundary, because the designer code is an equality
    // join against the BOQ's own wording.
    expect(row.designer_code).toBe("QALCS");
  });

  it("refuses to refresh a contact that was never linked", async () => {
    const row = (await contacts()).find((c: { name: string }) => c.name === "__QA By Hand");
    const { POST } = await import("@/app/api/projects/[id]/contacts/[contactId]/refresh/route");
    const res = await POST(post({ version: Number(row.version) }), {
      params: Promise.resolve({ id: projectId, contactId: row.id }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not linked to Capsule");
  });

  it("says why the search is unavailable rather than returning nothing", async () => {
    const { GET } = await import("@/app/api/capsule/parties/route");
    const res = await GET(new Request("http://localhost/test?q=jane"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("capsule_not_configured");
    // The message has to tell somebody what to do instead.
    expect(body.error).toContain("by hand");
  });

  it("refuses a one-character search before spending a call", async () => {
    const { GET } = await import("@/app/api/capsule/parties/route");
    const res = await GET(new Request("http://localhost/test?q=j"));
    expect(res.status).toBe(400);
  });
});
