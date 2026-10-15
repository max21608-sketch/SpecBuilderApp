// Database tier — a bill that names its cloths by a COM CODE (2026-10-15, the
// shape of the Ronnie Scott's procurement schedule): each COM line is filed
// in the library under its COM code, writes the FINISH column's cloth as its
// value with the description's placement as the qualifier, and links to a
// code the library already holds whatever the bill's copy of the cloth says.
// Through the real registration, the real row-kind PATCH, the real review GET
// and the real confirm, with the blob store held in memory.
//
// Skips without DATABASE_URL, and needs 0048 and db/seed/0012 ("com code").
// Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-com-code.test.ts
//
// Nothing here is a client document: `comCodeBillWorkbook` is built from
// source every run, codes `Z…`, words "EXAMPLE …".
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { comCodeBillWorkbook } from "../fixtures/build-boq";

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

type Parsed = {
  sheets: {
    columns: Record<string, { heading: string }>;
    lines: { index: number; lineNo: number; rowKind?: string; finishCode?: string | null }[];
  }[];
};

describeIfDb("a bill that names its cloths by a COM code", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA COM code bill', 'qa', 'qa') returning id`,
        [qaNumber("P90481")],
      )
    ).rows[0].id as string;
    // ZB_06 is in the library already, described as a COM list describes it —
    // NOT in the bill's words, which is the point.
    await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
       values ($1, 'ZB_06', 'ZB_06', 'EXAMPLE PLUSH; Colour: COGNAC', 'tbc', 'qa', 'qa')`,
      [projectId],
    );
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

  it("reads the COM CODE column by its heading, and stages each COM line under its item", { timeout: 60_000 }, async () => {
    const pathname = `projects/${projectId}/__QA com code.xlsx`;
    files.set(pathname, {
      bytes: await comCodeBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: "__QA com code.xlsx", contentType: "" }),
    );
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    runId = body.importId;

    const sheet = (await parsed()).sheets[0]!;
    expect(sheet.columns.finishCode?.heading).toBe("COM CODE");
    expect(sheet.lines.find((line) => line.lineNo === 3)?.finishCode).toBe("ZB_04");

    // As the structure read says it: each COM line `finish_for` the item above.
    for (const [row, parent] of [
      [3, 2],
      [5, 4],
      [7, 6],
      [9, 8],
    ] as const) {
      await patch({ sheetIndex: 0, index: await indexOf(row), rowKind: "finish_for", finishForRow: parent });
    }
  });

  it("says on the review what each COM line writes, and the code it is filed under", { timeout: 60_000 }, async () => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    const body = (await response.json()) as {
      fabricFilings: Record<number, Record<number, { goesTo: string; filing: string; writes?: { value: string; qualifier: string | null } }>>;
    };
    const line = async (row: number) => body.fabricFilings[0]?.[await indexOf(row)];
    expect(await line(3)).toMatchObject({
      goesTo: "→ COM 1",
      filing: "new library entry ZB_04, by its COM CODE — described when the finishes schedule is read",
      writes: { value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY", qualifier: "POUFFE DEPTH" },
    });
    expect((await line(5))?.filing).toBe("new library entry ZB_04, with row 3, by its COM CODE");
    expect((await line(7))?.filing).toBe("matches ZB_06 in the library, by its COM CODE");
    expect((await line(9))?.filing).toBe(
      "new library entry ZB_08, by its COM CODE — described when the finishes schedule is read",
    );
  });

  it("confirms: one library entry per COM code, each item's COM 1 linked to it, the cloth and its placement kept", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, result.error).toBe(200);

    const library = (
      await client.query(
        `select code, description, code_origin from project_finishes where project_id = $1 and status = 'active' order by code`,
        [projectId],
      )
    ).rows;
    // Filed by COM code only: no library row for an FF&E position code, and
    // the bill's copy of a cloth never becomes what a code is.
    expect(library).toEqual([
      { code: "ZB_04", description: null, code_origin: "client" },
      { code: "ZB_06", description: "EXAMPLE PLUSH; Colour: COGNAC", code_origin: "client" },
      { code: "ZB_08", description: null, code_origin: "client" },
    ]);

    const specs = (
      await client.query(
        `select r.source_line_no as row, a.value, a.qualifier, a.material_code, a.state, f.code as finish, sf.json_id
           from record_attributes a
           join spec_records r on r.id = a.record_id
           left join project_finishes f on f.id = a.finish_id
           left join spec_fields sf on sf.id = a.spec_field_id
          where r.project_id = $1 and a.status = 'active' and a.attr_group = 'material' and a.source_run_id = $2
            and a.material_code like 'ZB%'
          order by r.source_line_no`,
        [projectId, runId],
      )
    ).rows;
    expect(specs).toEqual([
      {
        row: 2,
        value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY",
        qualifier: "POUFFE DEPTH",
        material_code: "ZB_04",
        state: "confirmed",
        finish: "ZB_04",
        json_id: 1,
      },
      {
        row: 4,
        value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY",
        qualifier: null,
        material_code: "ZB_04",
        state: "confirmed",
        finish: "ZB_04",
        json_id: 1,
      },
      {
        row: 6,
        value: "NAME: EXAMPLE PLUSH COLOUR: COGNAC",
        qualifier: "ARMCHAIR INTERNAL SEAT & BACK",
        material_code: "ZB_06",
        state: "confirmed",
        finish: "ZB_06",
        json_id: 1,
      },
      {
        row: 8,
        value: "NAME: EXAMPLE VELOUR COLOUR: RUST",
        qualifier: "ARMCHAIR INTERNAL SEAT & BACK",
        material_code: "ZB_08",
        state: "confirmed",
        finish: "ZB_08",
        json_id: 1,
      },
    ]);

    // An item line's COM CODE cell is kept in its notes, under the heading.
    const mirror = (
      await client.query(`select internal_notes from spec_records where project_id = $1 and source_line_no = 10`, [projectId])
    ).rows[0];
    expect(mirror?.internal_notes).toBe("COM CODE: ZB_20");
  });
});
