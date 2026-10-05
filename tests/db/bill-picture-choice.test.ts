// Database tier — a bill row's picture, cropped or refused on the review
// (2026-10-05), and what the confirm then gives: the item's picture and the
// fabric code's swatch, both read through `effectiveRowImage`. Through the
// real registration, the real line PATCH, the real thumbnail route, the real
// review GET and the real confirm, with the blob store held in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node ~/dev/localstack/one-db-test.mjs tests/db/bill-picture-choice.test.ts
//
// Nothing here is a client document: both workbooks are built from source
// every run (`picturedBillWorkbook`, `fabricSwatchBillWorkbook`), and the
// "crop" is one of the fixture's own flat pictures put in the store.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { describeIfDb, qaNumber } from "./db-tier";
import { BILL_PICTURES, fabricSwatchBillWorkbook, picturedBillWorkbook } from "../fixtures/build-boq";

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

type StagedLine = { index: number; lineNo: number; picture?: unknown; pictureVersion?: number };

describeIfDb("a bill row's picture, chosen on the review", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const projects: string[] = [];
  let items = "";
  let fabrics = "";
  let itemRun = "";
  let fabricRun = "";

  const newProject = async (number: string) => {
    const id = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill picture choice', 'qa', 'qa') returning id`,
        [qaNumber(number)],
      )
    ).rows[0].id as string;
    projects.push(id);
    return id;
  };

  beforeAll(async () => {
    await client.connect();
    items = await newProject("P90451");
    fabrics = await newProject("P90452");
  });

  afterAll(async () => {
    for (const projectId of projects) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(
        `delete from attachments where entity_type = 'project_finishes'
           and entity_id in (select id from project_finishes where project_id = $1)`,
        [projectId],
      );
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

  async function register(projectId: string, name: string, workbook: Buffer): Promise<string> {
    const pathname = `projects/${projectId}/${name}`;
    files.set(pathname, { bytes: workbook, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(jsonRequest("POST", { projectId, importType: "boq", pathname, filename: name, contentType: "" }));
    const body = (await response.json()) as { ok: boolean; importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    return body.importId;
  }
  const lines = async (runId: string): Promise<StagedLine[]> =>
    ((await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as {
      sheets: { lines: StagedLine[] }[];
    }).sheets[0]!.lines;
  const lineAt = async (runId: string, row: number) => (await lines(runId)).find((line) => line.lineNo === row)!;
  const choose = async (runId: string, row: number, picture: unknown, pictureVersion?: number) => {
    const line = await lineAt(runId, row);
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const response = await PATCH(
      jsonRequest("PATCH", { sheetIndex: 0, index: line.index, picture, pictureVersion: pictureVersion ?? line.pictureVersion ?? 0 }),
      params(runId),
    );
    return { status: response.status, body: (await response.json()) as { ok: boolean; error?: string; pictureVersion?: number } };
  };
  /** A crop the browser stored: the fixture's own flat picture, under the run's prefix. */
  const storeCrop = (projectId: string, runId: string, name: string) => {
    const pathname = `projects/${projectId}/bill-images/${runId}/${name}`;
    files.set(pathname, { bytes: BILL_PICTURES.alternative, contentType: "image/png" });
    return pathname;
  };
  const thumbnail = async (runId: string, row: number, original = false) => {
    const { GET } = await import("@/app/api/imports/[id]/row-image/route");
    return GET(new Request(`http://localhost/test?sheet=0&row=${row}${original ? "&original=1" : ""}`), params(runId));
  };
  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const body = (await response.json()) as {
      ok: boolean;
      error?: string;
      billPictures?: number;
      fabricSwatches?: number;
      swatchNotices?: string[];
    };
    expect(response.status, body.error).toBe(200);
    return body;
  };

  it("records a crop on the line, refuses a stale version, and serves the crop as the row's picture", { timeout: 60_000 }, async () => {
    itemRun = await register(items, "__QA picture choice.xlsx", await picturedBillWorkbook());
    const crop = storeCrop(items, itemRun, "crop-0-3-1.png");

    const taken = await choose(itemRun, 3, { pathname: crop, width: 3, height: 4 }, 0);
    expect(taken.status, taken.body.error).toBe(200);
    expect(taken.body.pictureVersion).toBe(1);
    expect((await lineAt(itemRun, 3)).picture).toEqual({
      pathname: crop,
      contentType: "image/png",
      size: BILL_PICTURES.alternative.length,
      width: 3,
      height: 4,
    });

    // Somebody else's choice since this screen was drawn: refused, unchanged.
    const stale = await choose(itemRun, 3, { none: true }, 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/changed in another tab/);
    expect((await lineAt(itemRun, 3)).pictureVersion).toBe(1);

    // The thumbnail shows the crop; `original=1` the bill's own, which is what the panel crops from.
    const shown = await thumbnail(itemRun, 3);
    expect(shown.status).toBe(200);
    expect(Buffer.from(await shown.arrayBuffer())).toEqual(BILL_PICTURES.alternative);
    expect(Buffer.from(await (await thumbnail(itemRun, 3, true)).arrayBuffer())).toEqual(BILL_PICTURES.stool);
  });

  it("refuses a crop from another project, from outside this bill, never stored, or off a row with no single picture", { timeout: 60_000 }, async () => {
    const elsewhere = `projects/${randomUUID()}/bill-images/${itemRun}/crop-0-4-1.png`;
    files.set(elsewhere, { bytes: BILL_PICTURES.alternative, contentType: "image/png" });
    const foreign = await choose(itemRun, 4, { pathname: elsewhere });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/not one of this project's files/);

    const notThisBill = `projects/${items}/finish-swatches/crop.png`;
    files.set(notThisBill, { bytes: BILL_PICTURES.alternative, contentType: "image/png" });
    expect((await choose(itemRun, 4, { pathname: notThisBill })).body.error).toMatch(/not stored for this bill/);

    const missing = await choose(itemRun, 4, { pathname: `projects/${items}/bill-images/${itemRun}/never-uploaded.png` });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/never reached the store/);

    // Row 5 printed two different pictures and registration stored neither:
    // nothing to crop, and "no picture" is still a choice.
    const twoPictures = await choose(itemRun, 5, { pathname: storeCrop(items, itemRun, "crop-0-5-1.png") });
    expect(twoPictures.status).toBe(400);
    expect(twoPictures.body.error).toMatch(/no single picture on row 5/);
    expect((await choose(itemRun, 5, { none: true })).status).toBe(200);

    // Nothing above moved row 4.
    expect((await lineAt(itemRun, 4)).picture).toBeUndefined();
  });

  it("gives the record the crop, and no picture where none was chosen", { timeout: 60_000 }, async () => {
    expect((await choose(itemRun, 4, { none: true })).status).toBe(200);
    expect((await thumbnail(itemRun, 4)).status).toBe(404);
    expect((await thumbnail(itemRun, 4, true)).status).toBe(200);

    const result = await confirm(itemRun);
    expect(result.billPictures).toBe(1);
    const pictureOf = async (row: number) =>
      (
        await client.query(
          `select a.storage_path, a.filename, a.image_width, a.image_height
             from attachments a join spec_records r on r.id = a.entity_id
            where a.entity_type = 'spec_records' and a.kind = 'item_image' and a.superseded_at is null
              and r.project_id = $1 and r.source_line_no = $2`,
          [items, row],
        )
      ).rows;
    expect(await pictureOf(3)).toEqual([
      {
        storage_path: `projects/${items}/bill-images/${itemRun}/crop-0-3-1.png`,
        // Still "bill row N": where a picture came from is read off its path and name (`item-image.ts`).
        filename: "bill row 3.png",
        image_width: 3,
        image_height: 4,
      },
    ]);
    expect(await pictureOf(4)).toEqual([]);
    expect(await pictureOf(5)).toEqual([]);
  });

  it("files a cropped fabric's swatch, and lets a refused picture settle a code whose pictures differed", { timeout: 60_000 }, async () => {
    fabricRun = await register(fabrics, "__QA swatch choice.xlsx", await fabricSwatchBillWorkbook());
    const crop = storeCrop(fabrics, fabricRun, "crop-0-12-1.png");
    // Row 12 is the uncoded boucle (an in-house code at confirm), row 8 one of
    // ZZ-FAB-14's two different pictures.
    expect((await choose(fabricRun, 12, { pathname: crop, width: 3, height: 4 })).status).toBe(200);
    expect((await choose(fabricRun, 8, { none: true })).status).toBe(200);

    // The review says what the confirm will do, from the same function.
    const { GET } = await import("@/app/api/imports/[id]/route");
    const review = (await (await GET(new Request("http://localhost/test"), params(fabricRun))).json()) as {
      fabricFilings: Record<number, Record<number, { swatch: string | null }>>;
    };
    const swatchAt = async (row: number) => review.fabricFilings[0]?.[(await lineAt(fabricRun, row)).index]?.swatch;
    expect(await swatchAt(12)).toBe("swatch: this row's crop");
    expect(await swatchAt(14)).toBe("swatch: row 12's picture");
    expect(await swatchAt(10)).toBe("swatch: this row's picture");

    const result = await confirm(fabricRun);
    expect(result.swatchNotices).toEqual([]);
    const swatches = (
      await client.query(
        `select f.code, f.code_origin, s.storage_path, s.filename
           from attachments s join project_finishes f on f.id = s.entity_id
          where s.entity_type = 'project_finishes' and s.kind = 'finish_swatch' and s.superseded_at is null
            and f.project_id = $1
          order by f.code_origin, f.code`,
        [fabrics],
      )
    ).rows as { code: string; code_origin: string; storage_path: string; filename: string }[];
    const swatchOf = (code: string) => swatches.find((row) => row.code === code);
    const inHouse = swatches.find((row) => row.code_origin === "internal");
    expect(inHouse).toMatchObject({ storage_path: crop, filename: "bill row 12.png" });
    // ZZ-FAB-14: row 8 refused its picture, so row 10's is the code's only one.
    expect(swatchOf("ZZ-FAB-14")).toMatchObject({ filename: "bill row 10.png" });
    expect(swatchOf("ZZ-FAB-13")).toMatchObject({ filename: "bill row 4.png" });
  });
});
