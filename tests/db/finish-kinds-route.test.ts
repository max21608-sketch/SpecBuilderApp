// Database tier — POST /api/projects/[id]/finishes/kinds, filing several
// finishes under the kind the app suggested, in one act.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/finish-kinds-route.test.ts
//
// What it holds (review 5.1; the route's header):
//  - the client sends WHICH rows, never which kind: each kind is re-read from
//    `suggestFinishKind` against the live row, and a body carrying a kind is a 400;
//  - a row already filed, changed since the screen loaded, with nothing to read
//    a kind from, or on another project is SKIPPED and named — never guessed;
//  - the rest are filed under ONE change set, and every other field of the
//    row survives (`editFinish` replaces the row);
//  - a press that can file nothing is a 409 and writes nothing.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";
import { suggestFinishKind } from "@/lib/finish-kind-guess";

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

type Finish = { id: string; version: number };

describeIfDb("filing suggested finish kinds", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";

  beforeAll(async () => {
    await client.connect();
    const project = async (base: string) =>
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber(base)}', '__QA finish kinds', 'qa', 'qa') returning id`,
        )
      ).rows[0].id as string;
    projectId = await project("P90207");
    otherProjectId = await project("P90208");
  });

  afterAll(async () => {
    for (const id of [projectId, otherProjectId]) if (id) await client.query(`delete from projects where id = $1`, [id]);
    await client.end();
  });

  async function finish(
    code: string,
    fields: { description?: string | null; kind?: string | null; project?: string } = {},
  ): Promise<Finish> {
    const row = await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, kind, supplier_raw, colour, state, created_by, updated_by)
       values ($1, $2, $3, $4, $5, '__QA Supplier', '__QA Colour', 'tbc', 'qa', 'qa') returning id, version`,
      [fields.project ?? projectId, code, normaliseFinishCode(code), fields.description ?? null, fields.kind ?? null],
    );
    return { id: row.rows[0].id, version: Number(row.rows[0].version) };
  }

  const read = async (id: string) =>
    (await client.query(`select kind, description, supplier_raw, colour, version from project_finishes where id = $1`, [id])).rows[0];
  const changeSets = async () =>
    Number((await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n);

  it("files the suggested kinds under one change set, and skips and names everything it must not touch", async () => {
    const trimSuggested = suggestFinishKind({ code: "TR-01" });
    const woodSuggested = suggestFinishKind({ code: "QAZ-1", description: "Dark tinted wood" });
    // The fixture's premises, checked rather than assumed.
    expect(trimSuggested?.kind).toBe("trim");
    expect(woodSuggested).not.toBeNull();
    expect(suggestFinishKind({ code: "QQZ-9" })).toBeNull();

    const trim = await finish("TR-01");
    const wood = await finish("QAZ-1", { description: "Dark tinted wood" });
    const filed = await finish("TR-02", { kind: "fabric" });
    const nothing = await finish("QQZ-9");
    const moved = await finish("TR-03");
    const elsewhere = await finish("TR-04", { project: otherProjectId });
    const before = await changeSets();

    const { POST } = await import("@/app/api/projects/[id]/finishes/kinds/route");
    const res = await POST(
      post({
        finishes: [trim, wood, filed, nothing, { id: moved.id, version: moved.version + 3 }, elsewhere],
      }),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filed.map((entry: { code: string }) => entry.code).sort()).toEqual(["QAZ-1", "TR-01"]);
    const why = new Map(body.skipped.map((entry: { code: string; why: string }) => [entry.code, entry.why]));
    expect(why.get("TR-02")).toBe("it is already filed as fabric");
    expect(why.get("QQZ-9")).toBe("there is nothing to read a kind from any more");
    expect(why.get("TR-03")).toBe("somebody changed it since this screen loaded");
    // Another project's row is not this project's to file: named by id.
    expect(why.get(elsewhere.id)).toBe("it is no longer on this project");

    expect(await changeSets()).toBe(before + 1);
    const cs = (
      await client.query(`select kind, reason from change_sets where project_id = $1 order by created_at desc limit 1`, [projectId])
    ).rows[0];
    expect(cs.kind).toBe("finish_edit");
    expect(cs.reason).toMatch(/^Filed 2 finishes/);

    const trimAfter = await read(trim.id);
    expect(trimAfter.kind).toBe("trim");
    expect(trimAfter.version).toBeGreaterThan(trim.version);
    // Every other field survives the replace.
    expect(trimAfter.supplier_raw).toBe("__QA Supplier");
    expect(trimAfter.colour).toBe("__QA Colour");
    const woodAfter = await read(wood.id);
    expect(woodAfter.kind).toBe(woodSuggested!.kind);
    expect(woodAfter.description).toBe("Dark tinted wood");

    expect((await read(filed.id)).kind).toBe("fabric");
    expect((await read(nothing.id)).kind).toBeNull();
    expect((await read(moved.id)).kind).toBeNull();
    expect((await read(elsewhere.id)).kind).toBeNull();
  });

  it("refuses a press that can file nothing, and a body that names a kind, writing nothing", async () => {
    const filed = await finish("TR-05", { kind: "trim" });
    const before = await changeSets();
    const { POST } = await import("@/app/api/projects/[id]/finishes/kinds/route");

    const none = await POST(post({ finishes: [filed] }), params(projectId));
    expect(none.status).toBe(409);
    const body = await none.json();
    expect(body.code).toBe("nothing_to_file");
    expect(body.error).toContain("TR-05 — it is already filed as trim");

    const blank = await finish("TR-06");
    const sneaky = await POST(post({ finishes: [{ ...blank, kind: "stone" }] }), params(projectId));
    expect(sneaky.status).toBe(400);
    expect((await read(blank.id)).kind).toBeNull();
    expect(await changeSets()).toBe(before);
  });
});
