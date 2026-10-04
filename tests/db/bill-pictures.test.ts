// Database tier — the picture a bill prints on an item's row: stored at
// registration, shown on the review, given at confirm to a record with none.
// Through the real registration, the real thumbnail route and the real
// confirm, with the blob store held in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-pictures.test.ts
//
// ============================================================================
// WHAT IT PROVES, on a SYNTHETIC workbook built in memory (`picturedBillWorkbook`):
//
// - registration stores each row's picture under the project and stages it by
//   sheet and row, with nothing taken from a row carrying two pictures;
// - the review's thumbnail route serves a row's picture by run, sheet and row
//   — never by a pathname the client names — and 404s a row with none;
// - the confirm gives each new record its row's picture, as the same
//   `item_image` attachment a drawing crop writes;
// - a REVISION gives a carried record its row's picture only where it has
//   none: a picture somebody already gave a record is never replaced.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { BILL_PICTURES, picturedBillWorkbook } from "../fixtures/build-boq";

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

describeIfDb("a bill's row pictures", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let firstRunId = "";
  let phaseId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill pictures', 'qa', 'qa') returning id`,
        [qaNumber("P90082")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function register(name: string): Promise<string> {
    const pathname = `projects/${projectId}/${name}`;
    files.set(pathname, {
      bytes: await picturedBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: name, contentType: "" }),
    );
    const body = (await response.json()) as { ok: boolean; importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    return body.importId;
  }
  const thumbnail = async (runId: string, row: number) => {
    const { GET } = await import("@/app/api/imports/[id]/row-image/route");
    return GET(new Request(`http://localhost/test?sheet=0&row=${row}`), params(runId));
  };
  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const body = (await response.json()) as { ok: boolean; billPictures?: number; error?: string };
    expect(response.status, body.error).toBe(200);
    return body;
  };
  const recordAt = async (lineNo: number) =>
    (
      await client.query(
        `select id, version from spec_records where project_id = $1 and source_line_no = $2 and status = 'active'`,
        [projectId, lineNo],
      )
    ).rows[0] as { id: string; version: number };
  const pictureOf = async (recordId: string) =>
    (
      await client.query(
        `select storage_path, filename, content_type, size, image_width, image_height from attachments
         where entity_type = 'spec_records' and entity_id = $1 and kind = 'item_image'`,
        [recordId],
      )
    ).rows;

  it("stores each row's picture at registration and serves it to the review by row", { timeout: 60_000 }, async () => {
    firstRunId = await register("__QA pictured bill.xlsx");
    const staged = (await client.query(`select parsed from intake_runs where id = $1`, [firstRunId])).rows[0].parsed as {
      rowImages: Record<string, Record<string, { pathname: string | null; pictures: number }>>;
      rowImagesNote: string | null;
    };
    expect(staged.rowImagesNote).toBeNull();
    const bill = staged.rowImages.Bill!;
    expect(bill["3"]?.pictures).toBe(1);
    expect(bill["3"]?.pathname?.startsWith(`projects/${projectId}/bill-images/${firstRunId}/`)).toBe(true);
    expect(bill["5"]).toMatchObject({ pathname: null, pictures: 2 });
    expect(bill["6"]).toBeUndefined();

    const shown = await thumbnail(firstRunId, 3);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await shown.arrayBuffer())).toEqual(BILL_PICTURES.stool);
    expect((await thumbnail(firstRunId, 5)).status).toBe(404);
    expect((await thumbnail(firstRunId, 6)).status).toBe(404);
  });

  it("gives each new record its row's picture, as the drawings' item image", { timeout: 60_000 }, async () => {
    const result = await confirm(firstRunId);
    expect(result.billPictures).toBe(2);
    phaseId = (await client.query(`select id from spec_runs where project_id = $1`, [projectId])).rows[0].id;

    const stool = await pictureOf((await recordAt(3)).id);
    expect(stool).toHaveLength(1);
    expect(stool[0]).toMatchObject({ content_type: "image/png", image_width: 4, image_height: 3, filename: "bill row 3.png" });
    expect(stool[0].storage_path.startsWith(`projects/${projectId}/`)).toBe(true);
    expect(await pictureOf((await recordAt(4)).id)).toHaveLength(1);
    // Two pictures on the row: none taken. No picture: none given.
    expect(await pictureOf((await recordAt(5)).id)).toHaveLength(0);
    expect(await pictureOf((await recordAt(6)).id)).toHaveLength(0);
  });

  it("never replaces a picture a carried record already has, and fills one that has none", { timeout: 60_000 }, async () => {
    const stool = await recordAt(3);
    const drawers = await recordAt(4);
    // Somebody's own picture on the stool; the drawers' bill picture taken away.
    await client.query(`delete from attachments where entity_type = 'spec_records' and kind = 'item_image' and entity_id = any($1::uuid[])`, [
      [stool.id, drawers.id],
    ]);
    await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
       values ('spec_records', $1, 'item_image', $2, 'crop.png', 'image/png', 'qa')`,
      [stool.id, `projects/${projectId}/crops/__qa-crop.png`],
    );

    const revisionId = await register("__QA pictured bill rev B.xlsx");
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    expect((await PATCH(jsonRequest("PATCH", { sheetIndex: 0, replacesRunId: phaseId }), params(revisionId))).status).toBe(200);
    for (const [index, lineNo] of [[0, 3], [1, 4], [2, 5], [3, 6]] as const) {
      const record = await recordAt(lineNo);
      const paired = await PATCH(
        jsonRequest("PATCH", { sheetIndex: 0, index, replaces: { recordId: record.id, recordVersion: record.version } }),
        params(revisionId),
      );
      expect(paired.status).toBe(200);
    }
    const result = await confirm(revisionId);
    expect(result.billPictures).toBe(1);

    expect((await pictureOf(stool.id)).map((row) => row.storage_path)).toEqual([`projects/${projectId}/crops/__qa-crop.png`]);
    const given = await pictureOf(drawers.id);
    expect(given).toHaveLength(1);
    expect(given[0].storage_path.startsWith(`projects/${projectId}/bill-images/${revisionId}/`)).toBe(true);
  });
});
