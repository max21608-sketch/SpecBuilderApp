// Database tier — the bill review's twin suggestions, accepted and linked at
// confirm (0060). Through the real registration, the real twins route and the
// real confirm, with the blob store held in memory.
//
//  - nothing is linked from a suggestion nobody accepted;
//  - the route accepts only what `suggestTwins` would suggest, on the line's
//    own version;
//  - the confirm links the two records the accepted lines become, in the
//    bill's OWN change set, and nothing else.
//
// `twinBillWorkbook` is built from source every run: codes `Z…`, "Example …".
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stagedVersion } from "./staged-version";
import { twinBillWorkbook } from "../fixtures/build-boq";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The blob store, in memory: what was put, by pathname. */
const files = new Map<string, { bytes: Buffer; contentType: string }>();
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: { contentType?: string }) => {
    files.set(pathname, { bytes: Buffer.from(body), contentType: options?.contentType ?? "application/octet-stream" });
    return { pathname, url: `https://blob.test/${pathname}` };
  },
  head: async (pathname: string) => {
    const file = files.get(pathname);
    return file ? { pathname, size: file.bytes.length, contentType: file.contentType } : null;
  },
  get: async (pathname: string) => {
    const file = files.get(pathname);
    if (!file) return null;
    return {
      statusCode: 200,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(file.bytes));
          controller.close();
        },
      }),
      headers: new Headers({ "content-length": String(file.bytes.length) }),
      blob: { contentType: file.contentType, size: file.bytes.length },
    };
  },
  copy: async () => {
    throw new Error("not used");
  },
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type Line = { index: number; lineNo: number; twinOf?: { row: number; evidence: string } | null; twinOfVersion?: number };

describeIfDb("twin suggestions on a bill", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Bill twins', 'qa', 'qa') returning id`,
        [qaNumber("P00064")],
      )
    ).rows[0].id as string;
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const lines = async () =>
    ((await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as { sheets: { lines: Line[] }[] })
      .sheets[0]!.lines;
  const line = async (row: number) => (await lines()).find((entry) => entry.lineNo === row)!;
  const twins = async (body: unknown) => {
    const { POST } = await import("@/app/api/imports/[id]/twins/route");
    const response = await POST(jsonRequest("POST", body), params(runId));
    return { status: response.status, body: (await response.json()) as { ok: boolean; error?: string; code?: string } };
  };

  it("stages the bill with nothing accepted", { timeout: 60_000 }, async () => {
    const pathname = `projects/${projectId}/__QA twins.xlsx`;
    files.set(pathname, {
      bytes: await twinBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: "__QA twins.xlsx", contentType: "" }),
    );
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    runId = body.importId;
    expect((await lines()).some((entry) => entry.twinOf)).toBe(false);
  });

  it("accepts only a suggested twin, on the line's own version", { timeout: 60_000 }, async () => {
    // Row 3 (the desk) is nobody's twin.
    const desk = await line(3);
    expect(await twins({ sheetIndex: 0, accept: [{ index: desk.index, version: 0 }] })).toMatchObject({ status: 409 });
    const stool = await line(4);
    expect(await twins({ sheetIndex: 0, accept: [{ index: stool.index, version: 7 }] })).toMatchObject({ status: 409 });

    const bench = await line(6);
    const accepted = await twins({ sheetIndex: 0, accept: [{ index: stool.index, version: 0 }, { index: bench.index, version: 0 }] });
    expect(accepted.status, accepted.body.error).toBe(200);
    expect((await line(4)).twinOf).toEqual({
      row: 2,
      evidence: "ZP-FUR-13 and ZG-FUR-13 (row 2) are one code, FUR-13, under two zones (ZP, ZG).",
    });
    expect((await line(6)).twinOf?.row).toBe(5);

    // Taken back, and nothing is linked from it.
    const cleared = await twins({ sheetIndex: 0, clear: [{ index: bench.index, version: 1 }] });
    expect(cleared.status, cleared.body.error).toBe(200);
    expect((await line(6)).twinOf).toBeNull();
  });

  it("links the accepted pair in the bill's own change set, and only it", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", { version: await stagedVersion(client, runId) }), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string; twinsLinked: number };
    expect(response.status, result.error).toBe(200);
    expect(result.twinsLinked).toBe(1);
    const confirmChange = (
      await client.query(`select id from change_sets where project_id = $1 and kind = 'boq_confirm'`, [projectId])
    ).rows.map((row) => String(row.id));
    expect(confirmChange).toHaveLength(1);

    const links = (
      await client.query(
        `select a.source_line_no as a_row, b.source_line_no as b_row, t.reason, c.id as change_set_id, c.kind
           from spec_record_twins t
           join spec_records a on a.id = t.record_a
           join spec_records b on b.id = t.record_b
           join audit_log l on l.table_name = 'spec_record_twins' and l.row_id = t.id::text and l.action = 'insert'
           join change_sets c on c.id = l.change_set_id
          where t.project_id = $1`,
        [projectId],
      )
    ).rows;
    expect(links).toHaveLength(1);
    expect([links[0].a_row, links[0].b_row].sort()).toEqual([2, 4]);
    expect(links[0]).toMatchObject({ change_set_id: confirmChange[0], kind: "boq_confirm" });
    expect(links[0].reason).toContain("ZP-FUR-13 and ZG-FUR-13");
  });
});
