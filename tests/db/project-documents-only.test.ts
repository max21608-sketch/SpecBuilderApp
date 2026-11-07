// Database tier: `GET /api/projects/[id]?only=documents`, the slice the
// overview's poll asks for (audit G13, 2026-11-07).
//
// THE POLL ASKED FOR EVERYTHING. While a document was being read the overview
// fetched the whole project payload every five seconds (the completion, the
// summary, the finishes, the designer codes) and kept two fields of it. The
// slice is the SAME documents query and the SAME failed count, answered alone,
// so the list the poll paints cannot differ from the one the page loaded.
//
// Skips without DATABASE_URL. Rows are `__QA ` and deleted FK-safe.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
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
const get = (query: string) => new Request(`http://localhost/api/projects/x${query}`);

describeIfDb("the project's documents slice", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, client, created_by, updated_by)
       values ($1, '__QA Documents slice', '__QA Client', 'qa', 'qa') returning id`,
      [qaNumber("P90031")],
    );
    projectId = project.rows[0].id;
    await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, error, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'failed', '__QA refused', 'qa', 'qa'),
              ($1, 'spec_document', 'shop_drawings', 'pending', null, 'qa', 'qa')`,
      [projectId],
    );
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("answers the documents and the failed count, and nothing else", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const res = await GET(get("?only=documents"), params(projectId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["documents", "failedDocuments", "ok"]);
    expect(body.failedDocuments).toBe(1);
    expect(body.documents).toHaveLength(2);
  });

  it("lists the same documents the whole payload lists", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const whole = await (await GET(get(""), params(projectId))).json();
    const slice = await (await GET(get("?only=documents"), params(projectId))).json();
    expect(slice.documents).toEqual(whole.documents);
    expect(slice.failedDocuments).toBe(whole.failedDocuments);
  });

  it("refuses a slice it does not know, in words, rather than answering the whole", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const res = await GET(get("?only=summary"), params(projectId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/documents/);
  });

  it("still says when there is no such project", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const res = await GET(get("?only=documents"), params("00000000-0000-0000-0000-00000000dead"));
    expect(res.status).toBe(404);
  });
});
