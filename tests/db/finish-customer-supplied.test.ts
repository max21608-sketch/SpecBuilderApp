// Database tier — the finishes library's "customer's own material" tick
// (0062, decision F of 2026-11-20), through the real routes.
//
// It is an EDIT like any other: on a confirmed finish it needs the Edit
// panel's reason, it opens a `finish_edit` change, and it moves the version.
// And `editFinish` REPLACES the row, so every other writer of it — the kinds
// route here — must leave the tick exactly as it found it.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: "__qa@example.test", name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const send = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describeIfDb("a fabric marked as the customer's own material", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA COM tick', 'qa', 'qa') returning id`, [
        qaNumber("P90209"),
      ])
    ).rows[0].id;
  });
  afterAll(async () => {
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function finish(code: string, state: "confirmed" | "tbc", kind: string | null = "fabric") {
    const row = await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, kind, state, created_by, updated_by)
       values ($1, $2, $3, '__QA Teddy mohair', $4, $5, 'qa', 'qa') returning id, version`,
      [projectId, code, normaliseFinishCode(code), kind, state],
    );
    return { id: String(row.rows[0].id), version: Number(row.rows[0].version) };
  }
  const read = async (id: string) =>
    (await client.query(`select customer_supplied, description, version from project_finishes where id = $1`, [id])).rows[0];

  async function patch(finishId: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/projects/[id]/finishes/[finishId]/route");
    return PATCH(send("PATCH", body), { params: Promise.resolve({ id: projectId, finishId }) });
  }

  it("is off by default", async () => {
    const f = await finish("QA-FAB-01", "tbc");
    expect((await read(f.id)).customer_supplied).toBe(false);
  });

  it("needs the Edit panel's reason on a confirmed finish, writes nothing without one, and is an edit with one", async () => {
    const f = await finish("QA-FAB-02", "confirmed");
    const refused = await patch(f.id, { version: f.version, customerSupplied: true, description: "__QA Teddy mohair" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("reason_required");
    expect((await read(f.id)).customer_supplied).toBe(false);

    const ok = await patch(f.id, {
      version: f.version,
      customerSupplied: true,
      description: "__QA Teddy mohair",
      kind: "fabric",
      state: "confirmed",
      reason: "__QA the client is supplying it",
    });
    expect(ok.status).toBe(200);
    const after = await read(f.id);
    expect(after.customer_supplied).toBe(true);
    expect(after.version).toBeGreaterThan(f.version);
    const cs = (await client.query(`select kind, reason from change_sets where project_id = $1 order by created_at desc limit 1`, [projectId])).rows[0];
    expect(cs).toMatchObject({ kind: "finish_edit" });
    expect(String(cs.reason)).toContain("__QA the client is supplying it");
  });

  it("is left exactly as it was by an edit that does not mention it, and by the kinds route", async () => {
    const f = await finish("TR-QA-1", "tbc", null);
    await client.query(`update project_finishes set customer_supplied = true, updated_by = 'qa' where id = $1`, [f.id]);
    const ticked = await read(f.id);

    const { POST } = await import("@/app/api/projects/[id]/finishes/kinds/route");
    const res = await POST(send("POST", { finishes: [{ id: f.id, version: ticked.version }] }), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const filed = await read(f.id);
    expect(filed.version).toBeGreaterThan(ticked.version);
    expect(filed.customer_supplied).toBe(true);

    const edited = await patch(f.id, { version: filed.version, description: "__QA trim braid" });
    expect(edited.status).toBe(200);
    expect((await read(f.id)).customer_supplied).toBe(true);
  });

  // CHASE REVIEW C5: the quote route hands the ticked rows' CODES to the
  // composer, so an UNLINKED spec carrying a ticked code prints COM.
  it("prints COM on the quote for an unlinked spec whose code is ticked, through the real route", async () => {
    const f = await finish("QA-FAB-C5", "tbc");
    await client.query(`update project_finishes set customer_supplied = true, updated_by = 'qa' where id = $1`, [f.id]);
    const run = (
      await client.query(`insert into spec_runs (project_id, name, sort_order, created_by, updated_by) values ($1, '__QA run', 1, 'qa', 'qa') returning id`, [projectId])
    ).rows[0].id;
    const record = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
         values ($1, $2, 1, 'active', '__QA Sofa', 'qa', 'qa') returning id`,
        [projectId, run],
      )
    ).rows[0].id;
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, material_code, spec_field_id, state, created_by, updated_by)
       values ($1, 'finish', 'Fabric', '__QA Teddy mohair', 'qa-fab-c5', (select id from spec_fields where json_id = 1), 'confirmed', 'qa', 'qa')`,
      [record],
    );
    const { GET } = await import("@/app/api/projects/[id]/export/quote/route");
    const res = await GET(new Request(`http://localhost/api/projects/${projectId}/export/quote?format=json`), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: string[][] };
    expect(body.rows[0]![3]).toMatch(/^COM: __QA Teddy mohair/m);
  });

  // CHASE REVIEW C6, 2026-11-21: the tick ALWAYS takes a reason — on a TBC
  // finish too — and its sentence says what happened, never "Filled in". A
  // tick-only edit changes nothing any record ships (the tick is not in the
  // atoms), and the coverage assertion in change-history.test.ts asks only
  // that every record whose SPEC CONTENT a change wrote has a version: so no
  // identical version of every linked record is written.
  it("takes a reason on a TBC finish too, says what it did, and versions no record whose atoms did not move", async () => {
    const f = await finish("QA-FAB-C6", "tbc");
    const run = (
      await client.query(`insert into spec_runs (project_id, name, sort_order, created_by, updated_by) values ($1, '__QA run C6', 2, 'qa', 'qa') returning id`, [projectId])
    ).rows[0].id;
    const record = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
         values ($1, $2, 2, 'active', '__QA Chair C6', 'qa', 'qa') returning id`,
        [projectId, run],
      )
    ).rows[0].id;
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, material_code, finish_id, spec_field_id, state, created_by, updated_by)
       values ($1, 'finish', 'Fabric', '__QA mohair', 'QA-FAB-C6', $2, (select id from spec_fields where json_id = 1), 'confirmed', 'qa', 'qa')`,
      [record, f.id],
    );
    const versions = async () => Number((await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [record])).rows[0].n);
    const before = await versions();
    const whole = { description: "__QA Teddy mohair", kind: "fabric", state: "tbc" };

    const refused = await patch(f.id, { version: f.version, customerSupplied: true, ...whole });
    expect(refused.status).toBe(400);
    const body = await refused.json();
    expect(body.code).toBe("reason_required");
    expect(body.error).toMatch(/customer's own material/);
    expect((await read(f.id)).customer_supplied).toBe(false);

    const ok = await patch(f.id, { version: f.version, customerSupplied: true, ...whole, reason: "__QA client supplies it" });
    expect(ok.status).toBe(200);
    const result = await ok.json();
    const marked = (await client.query(`select reason from change_sets where id = $1`, [result.changeSetId])).rows[0].reason as string;
    expect(marked).toContain("__QA client supplies it");
    expect(marked).toContain("Marked QA-FAB-C6 as the customer's own material");
    expect(marked).not.toContain("Filled in");
    expect(await versions()).toBe(before);
    expect((await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [result.changeSetId])).rows[0].n).toBe(0);

    const back = await patch(f.id, { version: (await read(f.id)).version, customerSupplied: false, ...whole, reason: "__QA BW supplies it after all" });
    expect(back.status).toBe(200);
    const unmarked = (await client.query(`select reason from change_sets where id = $1`, [(await back.json()).changeSetId])).rows[0].reason as string;
    expect(unmarked).toContain("Marked QA-FAB-C6 as supplied by BW");
  });
});
