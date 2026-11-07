// Database tier — the twin routes the record screen calls (0060): the link
// candidates, linking, unlinking, and the phase table's twin chip.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { insertVariant } from "@/lib/variant-create";

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
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describeIfDb("the twin routes", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let guest = "";
  let ambassador = "";
  let mockupCopy = "";
  let configuration = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Twin routes', 'qa', 'qa') returning id`,
        [qaNumber("P00065")],
      )
    ).rows[0].id;
    const main = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    const mockup = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Mock-up", actor: "qa" }))).runId;
    const make = async (runId: string, ref: string) =>
      (await withTransaction((txn) => createRecord(txn, { projectId, runId, itemDescription: "Stool", clientRef: ref, qty: 1, actor: "qa" })))
        .recordId;
    guest = await make(main, "GR-FUR-13");
    ambassador = await make(main, "PL-FUR-13");
    mockupCopy = await make(mockup, "GR-FUR-13");
    configuration = (
      await withTransaction((txn) =>
        insertVariant(txn, { parentId: ambassador, label: "A", splitReason: "configuration", dimensionNote: null, actor: "qa" }),
      )
    ).recordId;
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("offers every other live bill line, across phases, and never a configuration", async () => {
    const { GET } = await import("@/app/api/records/[id]/twins/route");
    const body = (await (await GET(new Request("http://localhost/test"), params(guest))).json()) as {
      twins: unknown[];
      candidates: { recordId: string }[];
    };
    expect(body.twins).toEqual([]);
    expect(body.candidates.map((candidate) => candidate.recordId).sort()).toEqual([ambassador, mockupCopy].sort());
    // A configuration offers nothing to link: it carries its bill line's twins.
    const fromConfiguration = (await (await GET(new Request("http://localhost/test"), params(configuration))).json()) as {
      candidates: unknown[];
    };
    expect(fromConfiguration.candidates).toEqual([]);
  }, SLOW);

  it("links, shows the chip on the phase table, and unlinks with a reason", async () => {
    const { POST } = await import("@/app/api/records/[id]/twins/route");
    const refused = await POST(jsonRequest("POST", { otherId: ambassador }), params(guest));
    expect(refused.status).toBe(400);
    const linked = await POST(jsonRequest("POST", { otherId: ambassador, reason: "__QA One stool" }), params(guest));
    expect(linked.status, JSON.stringify(await linked.clone().json())).toBe(200);
    const { twinId } = (await linked.json()) as { twinId: string };

    const { GET: list } = await import("@/app/api/records/route");
    const rows = (
      (await (await list(new Request(`http://localhost/test?projectId=${projectId}`))).json()) as {
        records: { id: string; twin_codes?: string[] }[];
      }
    ).records;
    expect(rows.find((row) => row.id === guest)?.twin_codes).toEqual(["PL-FUR-13"]);
    expect(rows.find((row) => row.id === ambassador)?.twin_codes).toEqual(["GR-FUR-13"]);
    expect(rows.find((row) => row.id === mockupCopy)?.twin_codes).toEqual([]);

    const { PATCH } = await import("@/app/api/twins/[id]/route");
    expect((await PATCH(jsonRequest("PATCH", { status: "retired", version: 1 }), params(twinId))).status).toBe(400);
    const unlinked = await PATCH(jsonRequest("PATCH", { status: "retired", version: 1, reason: "__QA Two stools" }), params(twinId));
    expect(unlinked.status, JSON.stringify(await unlinked.clone().json())).toBe(200);
    const row = await client.query(`select status from spec_record_twins where id = $1`, [twinId]);
    expect(row.rows[0].status).toBe("retired");
  }, SLOW);
});
