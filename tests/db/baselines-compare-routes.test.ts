// Database tier — POST /api/projects/[id]/baselines and GET
// /api/projects/[id]/compare: naming a point in a project's history, and
// reading what changed between two.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/baselines-compare-routes.test.ts
//
// What it holds (review 5.1; `src/lib/baselines.ts`):
//  - a baseline's membership is EXACTLY the newest version of every ACTIVE
//    record at the moment it is taken — a retired record is out, and a later
//    edit does not move it;
//  - comparing two baselines names what was added, removed, changed and left
//    alone, from those memberships;
//  - a baseline needs a name and a reason; a comparison needs two DIFFERENT
//    points on THIS project.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun, editRecordDetails } from "@/lib/manual-capture";

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

describeIfDb("baselines and the comparison between two points", () => {
  const SLOW = 40_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";
  let otherChangeSetId = "";
  let runId = "";
  let keptId = "";
  let editedId = "";
  let retiredId = "";
  let addedId = "";
  let baselineA = "";
  let baselineB = "";

  async function record(description: string, ref: string): Promise<string> {
    return (
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId, itemDescription: description, clientRef: ref, qty: 2, actor: "qa" }),
      )
    ).recordId;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90203")}', '__QA baselines', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    otherProjectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90204")}', '__QA baselines elsewhere', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    keptId = await record("__QA Sofa", "S-100");
    editedId = await record("__QA Armchair", "S-200");
    retiredId = await record("__QA Bench", "S-402");
    otherChangeSetId = (
      await withTransaction((txn) => createRun(txn, { projectId: otherProjectId, name: "__QA Elsewhere", actor: "qa" }))
    ).changeSetId;
  }, SLOW);

  afterAll(async () => {
    // Deleting the project is the whole cleanup (0014/0055: the change sets,
    // versions and baseline members go with it).
    for (const id of [projectId, otherProjectId]) {
      if (id) await client.query(`delete from projects where id = $1`, [id]);
    }
    await client.end();
  }, SLOW);

  const newestSnapshot = async (recordId: string) =>
    String(
      (
        await client.query(
          `select id from record_snapshots where record_id = $1 order by snapshot_no desc limit 1`,
          [recordId],
        )
      ).rows[0].id,
    );

  const members = async (changeSetId: string) =>
    (
      await client.query(`select record_id, snapshot_id from baseline_members where change_set_id = $1`, [changeSetId])
    ).rows.map((row: { record_id: string; snapshot_id: string }) => ({ record: row.record_id, snapshot: row.snapshot_id }));

  it("refuses a baseline with no name or no reason, and writes nothing", async () => {
    const { POST } = await import("@/app/api/projects/[id]/baselines/route");
    const count = async () =>
      Number(
        (await client.query(`select count(*)::int as n from change_sets where project_id = $1 and kind = 'baseline'`, [projectId]))
          .rows[0].n,
      );
    const before = await count();
    const noName = await POST(post({ label: "", reason: "Issued to the client" }), params(projectId));
    expect(noName.status).toBe(400);
    expect((await noName.json()).error).toMatch(/needs a name/);
    const noReason = await POST(post({ label: "__QA Rev A" }), params(projectId));
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).field).toBe("reason");
    expect(await count()).toBe(before);
  });

  it("names the newest version of every active record, and leaves a retired one out", async () => {
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa'
        where id = $1`,
      [retiredId],
    );
    const { POST } = await import("@/app/api/projects/[id]/baselines/route");
    const res = await POST(post({ label: "__QA Rev A", reason: "Issued to the client" }), params(projectId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toBe(2);
    expect(body.label).toBe("__QA Rev A");
    baselineA = body.changeSetId;

    const named = await members(baselineA);
    expect(named).toHaveLength(2);
    expect(new Set(named.map((m) => m.record))).toEqual(new Set([keptId, editedId]));
    for (const member of named) expect(member.snapshot).toBe(await newestSnapshot(member.record));

    const row = (await client.query(`select kind, label, reason from change_sets where id = $1`, [baselineA])).rows[0];
    expect(row).toEqual({ kind: "baseline", label: "__QA Rev A", reason: "Issued to the client" });
  }, SLOW);

  it("does not move when a record is edited after it, and the next baseline names the new version", async () => {
    const before = await members(baselineA);
    const version = Number((await client.query(`select version from spec_records where id = $1`, [editedId])).rows[0].version);
    await withTransaction((txn) =>
      editRecordDetails(txn, { recordId: editedId, patch: { itemDescription: "__QA Armchair, wider" }, expectedVersion: version, actor: "qa" }),
    );
    addedId = await record("__QA Ottoman", "UP-100");

    expect(await members(baselineA)).toEqual(before);

    const { POST } = await import("@/app/api/projects/[id]/baselines/route");
    const res = await POST(post({ label: "__QA Rev B", reason: "Reissued after the VE round" }), params(projectId));
    expect(res.status).toBe(200);
    baselineB = (await res.json()).changeSetId;
    const named = await members(baselineB);
    expect(new Set(named.map((m) => m.record))).toEqual(new Set([keptId, editedId, addedId]));
    expect(named.find((m) => m.record === editedId)!.snapshot).toBe(await newestSnapshot(editedId));
    expect(named.find((m) => m.record === editedId)!.snapshot).not.toBe(before.find((m) => m.record === editedId)!.snapshot);
  }, SLOW);

  it("compares two baselines: one changed, one added, one left alone", async () => {
    const { GET } = await import("@/app/api/projects/[id]/compare/route");
    const res = await GET(new Request(`http://localhost/test?from=${baselineA}&to=${baselineB}`), params(projectId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ added: 1, removed: 0, changed: 1, unchanged: 1 });
    const byId = new Map(body.records.map((r: { recordId: string; change: string }) => [r.recordId, r.change]));
    expect(byId.get(editedId)).toBe("changed");
    expect(byId.get(addedId)).toBe("added");
    expect(byId.get(keptId)).toBe("unchanged");
    // Changed first: a reviewer opens this to find what moved.
    expect(body.records[0].change).toBe("changed");
    expect(body.from.changeSetId).toBe(baselineA);
    expect(body.to.kind).toBe("baseline");

    // Read the other way round, the added record is the removed one.
    const back = await (await GET(new Request(`http://localhost/test?from=${baselineB}&to=${baselineA}`), params(projectId))).json();
    expect(back.counts).toEqual({ added: 0, removed: 1, changed: 1, unchanged: 1 });
  });

  it("refuses the same point twice, a missing point, and a point on another project", async () => {
    const { GET } = await import("@/app/api/projects/[id]/compare/route");
    const ask = (query: string) => GET(new Request(`http://localhost/test${query}`), params(projectId));
    const same = await ask(`?from=${baselineA}&to=${baselineA}`);
    expect(same.status).toBe(400);
    expect((await same.json()).error).toMatch(/same point/);
    expect((await ask(`?from=${baselineA}`)).status).toBe(400);
    expect((await ask(`?from=${baselineA}&to=not-a-uuid`)).status).toBe(400);
    const foreign = await ask(`?from=${baselineA}&to=${otherChangeSetId}`);
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error).toMatch(/No such change on this project/);
  });
});
