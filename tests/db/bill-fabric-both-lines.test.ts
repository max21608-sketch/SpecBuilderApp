// Database tier — a COM line naming a code that two lines of one phase carry
// (2026-10-15, Max: "apply it to both, no tick boxes"; the Ronnie Scott's
// CH-03 case). The line is written to every line carrying the code that has no
// finish line of its own, each in the next free COM on THAT record; a twin
// with its own COM line keeps only its own. Through the real registration, the
// real row-kind PATCH, the real review GET and the real confirm, with the blob
// store held in memory.
//
// Skips without DATABASE_URL, and needs 0048 and db/seed/0012 ("com code").
// Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-fabric-both-lines.test.ts
//
// Nothing here is a client document: `twinLinesComBillWorkbook` is built from
// source every run, codes `Z…`, words "EXAMPLE …".
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { twinLinesComBillWorkbook } from "../fixtures/build-boq";

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

type Parsed = { sheets: { lines: { index: number; lineNo: number }[] }[] };
type Plan = { goesTo: string; forRows?: { rows: number[]; sentence: string } };

describeIfDb("a COM line naming a code on two lines of one phase", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA COM on both lines', 'qa', 'qa') returning id`,
        [qaNumber("P90482")],
      )
    ).rows[0].id as string;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in ${records}`, [projectId]);
      await client.query(`update record_attributes set finish_id = null where record_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(
        `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
        [projectId],
      );
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const parsed = async () =>
    (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as Parsed;
  const indexOf = async (row: number) => (await parsed()).sheets[0]!.lines.find((line) => line.lineNo === row)!.index;
  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const response = await PATCH(jsonRequest("PATCH", body), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, result.error).toBe(200);
  };

  it("stages the bill, each COM line under the item above it", { timeout: 60_000 }, async () => {
    const pathname = `projects/${projectId}/__QA twin lines.xlsx`;
    files.set(pathname, {
      bytes: await twinLinesComBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: "__QA twin lines.xlsx", contentType: "" }),
    );
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    runId = body.importId;

    // As a person or the structure read would say it: under the item above.
    for (const [row, parent] of [
      [4, 3],
      [5, 3],
      [7, 6],
      [9, 8],
    ] as const) {
      await patch({ sheetIndex: 0, index: await indexOf(row), rowKind: "finish_for", finishForRow: parent });
    }
  });

  it("says on the review which lines each COM line goes on, and the COM on each", { timeout: 60_000 }, async () => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    const body = (await response.json()) as { fabricFilings: Record<number, Record<number, Plan>> };
    const line = async (row: number) => body.fabricFilings[0]?.[await indexOf(row)];

    // Names no code: its own item only.
    expect(await line(4)).toMatchObject({ goesTo: "→ COM 1" });
    expect((await line(4))?.forRows).toBeUndefined();
    // Names ZC-03 by its own code: both lines, the next free COM on each.
    const both = await line(5);
    expect(both?.goesTo).toBe("→ COM 1 on row 2, COM 2 on row 3");
    expect(both?.forRows?.rows).toEqual([2, 3]);
    expect(both?.forRows?.sentence).toBe(
      "For rows 2 and 3 — ZC-03, both: its code ZB-ZC-03 names it, and row 2 carries ZC-03 with no finish line of its own.",
    );
    // ZC-02's two lines each have their own COM line: each keeps its own.
    for (const row of [7, 9]) {
      expect((await line(row))?.goesTo).toBe("→ COM 1");
      expect((await line(row))?.forRows).toBeUndefined();
    }
  });

  it("confirms: the COM line on both ZC-03 records, the ZC-02 cloths each on their own", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, result.error).toBe(200);

    // Filed ONCE per code, however many records it went on.
    const library = (
      await client.query(`select code from project_finishes where project_id = $1 and status = 'active' order by code`, [
        projectId,
      ])
    ).rows.map((row) => row.code);
    expect(library).toEqual(["ZB_02", "ZB_04", "ZB_06", "ZB_08"]);

    const specs = (
      await client.query(
        `select r.source_line_no as row, a.material_code, f.code as finish, sf.json_id
           from record_attributes a
           join spec_records r on r.id = a.record_id
           left join project_finishes f on f.id = a.finish_id
           left join spec_fields sf on sf.id = a.spec_field_id
          where r.project_id = $1 and a.status = 'active' and a.attr_group = 'material' and a.source_run_id = $2
            and a.material_code like 'ZB%'
          order by r.source_line_no, sf.json_id`,
        [projectId, runId],
      )
    ).rows;
    expect(specs).toEqual([
      { row: 2, material_code: "ZB_04", finish: "ZB_04", json_id: 1 },
      { row: 3, material_code: "ZB_02", finish: "ZB_02", json_id: 1 },
      { row: 3, material_code: "ZB_04", finish: "ZB_04", json_id: 2 },
      { row: 6, material_code: "ZB_06", finish: "ZB_06", json_id: 1 },
      { row: 8, material_code: "ZB_08", finish: "ZB_08", json_id: 1 },
    ]);
  });
});
