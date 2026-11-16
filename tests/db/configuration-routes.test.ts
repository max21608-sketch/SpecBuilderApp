// Database tier — the configuration routes: GET/POST
// /api/records/[id]/configurations (the offer, and the add) and PATCH
// /api/records/[id]/configuration-name (the rename), with PATCH
// configuration-status for the retire between them.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/configuration-routes.test.ts
//
// `tests/db/configuration-add.test.ts` holds the library's rules (what is
// carried, one change set, the other phases). This file holds the HTTP layer
// over them (review 5.1; `docs/load-bearing/drawings.md`, "A person can add,
// rename and retire a configuration"):
//  - the offer the GET sends is the offer the POST accepts, and a stale one is
//    a 409 that writes nothing;
//  - a configuration's number under its line, `variant_ordinal`, is max + 1
//    over EVERY sibling, retired included, and is NEVER reused — retiring the
//    newest and adding another does not hand its number back;
//  - a name is never reused, retired ones included: the add and the rename
//    both refuse it with a 409;
//  - the rename is under the record's lock (an older version is a 409) and is
//    refused on a bill line, which has no name to change.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: "__qa@example.test", name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (method: string, body: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Ref = { kind: string; id: string; version: number };

describeIfDb("the configuration routes", () => {
  const SLOW = 40_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let billLineId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90211")}', '__QA configuration routes', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    // By slug, never by uuid order.
    const categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    const runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    billLineId = (
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId, itemDescription: "__QA Desk chair", clientRef: "S-301", qty: 45, categoryId, actor: "qa" }),
      )
    ).recordId;
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state, created_by, updated_by)
       values ($1, 'dimension', 'Width', '840', 'mm', 'W', 'confirmed', 'qa', 'qa')`,
      [billLineId],
    );
  }, SLOW);

  afterAll(async () => {
    // Deleting the project is the whole cleanup.
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  async function offer(): Promise<{ shown: Ref[]; taken: unknown[]; alreadySplit: boolean }> {
    const { GET } = await import("@/app/api/records/[id]/configurations/route");
    const res = await GET(new Request("http://localhost/test"), params(billLineId));
    expect(res.status).toBe(200);
    const body = await res.json();
    return {
      shown: body.offered.map((item: Ref) => ({ kind: item.kind, id: item.id, version: item.version })),
      taken: body.taken,
      alreadySplit: body.alreadySplit,
    };
  }

  async function add(name: string, shown?: Ref[]): Promise<Response> {
    const { POST } = await import("@/app/api/records/[id]/configurations/route");
    const refs = shown ?? (await offer()).shown;
    return POST(send("POST", { name, shown: refs, carry: refs }), params(billLineId));
  }

  const child = async (id: string) =>
    (
      await client.query(`select variant_label, variant_ordinal, status, version from spec_records where id = $1`, [id])
    ).rows[0] as { variant_label: string; variant_ordinal: number; status: string; version: number };

  const children = async () =>
    Number((await client.query(`select count(*)::int as n from spec_records where parent_id = $1`, [billLineId])).rows[0].n);

  let typeOne = "";
  let typeTwo = "";

  it("refuses a stale offer with a 409 and writes nothing", async () => {
    const { shown } = await offer();
    expect(shown.length).toBeGreaterThan(0);
    const stale = shown.map((ref, index) => (index === 0 ? { ...ref, version: ref.version + 1 } : ref));
    const res = await add("TYPE 1", stale);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("targets_changed");
    expect(await children()).toBe(0);
  }, SLOW);

  it("adds configurations numbered 1 and 2 under the line, from the offer the GET sent", async () => {
    const first = await add("type 1");
    expect(first.status).toBe(200);
    const one = await first.json();
    expect(one.label).toBe("TYPE 1");
    typeOne = one.recordId;
    const second = await add("Type 2");
    expect(second.status).toBe(200);
    typeTwo = (await second.json()).recordId;

    expect(await child(typeOne)).toMatchObject({ variant_label: "TYPE 1", variant_ordinal: 1, status: "active" });
    expect(await child(typeTwo)).toMatchObject({ variant_label: "TYPE 2", variant_ordinal: 2, status: "active" });
    expect((await offer()).alreadySplit).toBe(true);
  }, SLOW);

  it("never reuses a retired configuration's number or its name", async () => {
    // Retire the NEWEST: max + 1 over the active siblings alone would hand 2
    // straight back.
    const { PATCH } = await import("@/app/api/records/[id]/configuration-status/route");
    const two = await child(typeTwo);
    const noReason = await PATCH(send("PATCH", { status: "retired", version: two.version }), params(typeTwo));
    expect(noReason.status).toBe(400);
    const retired = await PATCH(
      send("PATCH", { status: "retired", version: two.version, reason: "__QA not ordered" }),
      params(typeTwo),
    );
    expect(retired.status).toBe(200);
    expect((await child(typeTwo)).status).toBe("retired");

    const third = await add("TYPE 3");
    expect(third.status).toBe(200);
    const threeId = (await third.json()).recordId;
    expect((await child(threeId)).variant_ordinal).toBe(3);

    const reused = await add("type 2");
    expect(reused.status).toBe(409);
    expect((await reused.json()).code).toBe("name_retired");
    const taken = await add("TYPE 1");
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("name_taken");
    expect(await children()).toBe(3);
  }, SLOW);

  it("renames under the record's lock, refusing a taken or retired name and a bill line", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/configuration-name/route");
    const one = await child(typeOne);

    const stale = await PATCH(send("PATCH", { name: "TYPE 1A", version: one.version - 1 }), params(typeOne));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("record_version_stale");

    const retiredName = await PATCH(send("PATCH", { name: "type 2", version: one.version }), params(typeOne));
    expect(retiredName.status).toBe(409);
    expect((await retiredName.json()).code).toBe("name_retired");
    const siblingName = await PATCH(send("PATCH", { name: "TYPE 3", version: one.version }), params(typeOne));
    expect(siblingName.status).toBe(409);
    expect((await siblingName.json()).code).toBe("name_taken");
    expect(await child(typeOne)).toEqual(one);

    const renamed = await PATCH(send("PATCH", { name: "type 1a", version: one.version }), params(typeOne));
    expect(renamed.status).toBe(200);
    const body = await renamed.json();
    expect(body).toMatchObject({ label: "TYPE 1A", changed: true, version: one.version + 1 });
    // Renaming changes the name, never the number under the line.
    expect(await child(typeOne)).toMatchObject({ variant_label: "TYPE 1A", variant_ordinal: 1 });

    const line = Number((await client.query(`select version from spec_records where id = $1`, [billLineId])).rows[0].version);
    const onLine = await PATCH(send("PATCH", { name: "TYPE 9", version: line }), params(billLineId));
    expect(onLine.status).toBe(400);
    expect((await onLine.json()).code).toBe("not_a_configuration");
  }, SLOW);
});
