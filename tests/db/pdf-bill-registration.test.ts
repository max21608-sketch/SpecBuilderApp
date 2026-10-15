// Database tier — a bill uploaded as a PDF, read by its text at registration
// (workstream C1, 2026-10-15). Through the real registration, the real columns
// route, the real source route and the real confirm, with the blob store held
// in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/pdf-bill-registration.test.ts
//
// ============================================================================
// WHAT IT PROVES, on SYNTHETIC PDFs (tests/fixtures/build-pdf.mjs):
//
// - a PDF declared a bill is read by code: the workbook it builds is stored
//   BESIDE the PDF and is the run's source, the PDF is kept as an attachment
//   of its own, each staged line knows its page, and the phase is named after
//   the PDF;
// - from there it is the ordinary bill path: a person's columns re-read the
//   stored workbook (keeping the pages), and the confirm makes the records;
// - "open the PDF" serves the PDF, resolved from the run, never from the request;
// - a PDF whose text is not a table, and a scan, are refused in ONE sentence
//   and register nothing.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { buildPdf } from "../fixtures/build-pdf.mjs";
import { pdfBillRefusal } from "@/lib/pdf-bill";
import { SCANNED_PDF } from "@/lib/document-classify";

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

type Text = { x: number; y: number; str: string; size?: number };
const landscape = (texts: Text[]) => ({ width: 842, height: 595, texts });
const header = (y: number): Text[] => [
  { x: 40, y, str: "FF&E CODE" },
  { x: 120, y, str: "DESCRIPTION" },
  { x: 400, y: y + 4, str: "ORDER" },
  { x: 405, y: y - 4, str: "QTY" },
  { x: 470, y, str: "UOM" },
];
const line = (y: number, code: string, description: string, qty: string): Text[] => [
  { x: 40, y, str: code },
  { x: 120, y, str: description },
  { x: 411, y, str: qty },
  { x: 470, y, str: "EACH" },
];

/** Three lines over two pages, each page repeating the header. */
const schedule = () =>
  buildPdf([
    landscape([
      { x: 40, y: 570, str: "__QA SCHEDULE", size: 10 },
      ...header(530),
      ...line(490, "QA-CH-01", "ARMCHAIR", "9"),
      ...line(450, "QA-CH-02", "BAR STOOL", "4"),
      { x: 800, y: 20, str: "1" },
    ]),
    landscape([...header(530), ...line(490, "QA-TB-01", "SIDE TABLE", "2"), { x: 800, y: 20, str: "2" }]),
  ]);

describeIfDb("a bill uploaded as a PDF", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  const pdfName = "__QA Procurement Schedule.pdf";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA pdf bill', 'qa', 'qa') returning id`,
        [qaNumber("P90091")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
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

  async function register(name: string, bytes: Buffer) {
    const pathname = `projects/${projectId}/${name}`;
    files.set(pathname, { bytes, contentType: "application/pdf" });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: name, contentType: "application/pdf" }),
    );
    return { response, body: (await response.json()) as { ok: boolean; importId?: string; error?: string; detail?: string } };
  }

  type Staged = {
    filename: string;
    sheets: { sheetName: string; proposedRunName: string; lines: { lineNo: number; code: string | null; qty: number | null }[] }[];
    pdfSource: { attachmentId: string; filename: string; sheet: string; firstRow: number; pages: number[] };
  };
  const staged = async () => (await client.query(`select parsed, version from intake_runs where id = $1`, [runId])).rows[0] as {
    parsed: Staged;
    version: number;
  };

  it("stores the workbook its text reads as beside the PDF, and stages it as a bill", { timeout: 60_000 }, async () => {
    const { response, body } = await register(pdfName, schedule());
    expect(response.status, body.error).toBe(201);
    runId = body.importId!;

    const run = (
      await client.query(
        `select r.status, r.source_kind, a.storage_path, a.filename, a.kind
         from intake_runs r join attachments a on a.id = r.attachment_id where r.id = $1`,
        [runId],
      )
    ).rows[0];
    // THE RUN'S SOURCE IS THE WORKBOOK, so every re-read is the ordinary one.
    expect(run).toMatchObject({
      status: "parsed",
      source_kind: "boq_xlsx",
      kind: "boq",
      storage_path: `projects/${projectId}/__QA Procurement Schedule (read from PDF).xlsx`,
      filename: "__QA Procurement Schedule (read from PDF).xlsx",
    });
    expect(files.has(run.storage_path)).toBe(true);

    const { parsed } = await staged();
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0]!.lines.map((l) => l.code)).toEqual(["QA-CH-01", "QA-CH-02", "QA-TB-01"]);
    // The phase is named after the PDF, not after "… (read from PDF)".
    expect(parsed.sheets[0]!.proposedRunName).toBe("__QA Procurement Schedule");
    expect(parsed.pdfSource).toMatchObject({ filename: pdfName, sheet: "Sheet1", firstRow: 2, pages: [1, 1, 2] });

    const pdf = (await client.query(`select kind, storage_path, filename from attachments where id = $1`, [parsed.pdfSource.attachmentId])).rows[0];
    expect(pdf).toMatchObject({ kind: "boq_pdf", storage_path: `projects/${projectId}/${pdfName}`, filename: pdfName });
  });

  it("serves the PDF itself, resolved from the run", { timeout: 30_000 }, async () => {
    const { GET } = await import("@/app/api/imports/[id]/source/route");
    const asPdf = await GET(new Request("http://localhost/test?document=pdf"), params(runId));
    expect(asPdf.status).toBe(200);
    expect(asPdf.headers.get("content-disposition")).toContain(pdfName);
    expect(Buffer.from(await asPdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const asWorkbook = await GET(new Request("http://localhost/test"), params(runId));
    expect(asWorkbook.headers.get("content-disposition")).toContain("(read from PDF).xlsx");
    expect((await GET(new Request("http://localhost/test?document=other"), params(runId))).status).toBe(400);
  });

  it("is the ordinary bill path from there: a person's columns keep the pages, and the confirm makes the records", { timeout: 60_000 }, async () => {
    const { POST: columns } = await import("@/app/api/imports/[id]/columns/route");
    const { version } = await staged();
    const set = await columns(
      jsonRequest("POST", {
        sheetIndex: 0,
        headerRow: 1,
        headerRows: 1,
        columns: { code: 0, itemDescription: 1, qty: 2, qtyUnit: 3 },
        version,
      }),
      params(runId),
    );
    const setBody = (await set.json()) as { ok: boolean; error?: string };
    expect(set.status, setBody.error).toBe(200);

    const after = await staged();
    expect(after.parsed.sheets[0]!.lines.map((l) => l.qty)).toEqual([9, 4, 2]);
    expect(after.parsed.pdfSource.pages).toEqual([1, 1, 2]);

    // Read the whole bill again from its stored source: the pages survive that too.
    const again = await columns(jsonRequest("POST", { action: "reread", version: after.version }), params(runId));
    expect(again.status).toBe(200);
    const reread = await staged();
    expect(reread.parsed.pdfSource.pages).toEqual([1, 1, 2]);
    expect(reread.parsed.sheets[0]!.proposedRunName).toBe("__QA Procurement Schedule");

    // Put the person's columns back, then confirm.
    await columns(
      jsonRequest("POST", {
        sheetIndex: 0,
        headerRow: 1,
        headerRows: 1,
        columns: { code: 0, itemDescription: 1, qty: 2, qtyUnit: 3 },
        version: reread.version,
      }),
      params(runId),
    );
    const { POST: confirm } = await import("@/app/api/imports/[id]/confirm/route");
    const confirmed = await confirm(jsonRequest("POST", {}), params(runId));
    const confirmedBody = (await confirmed.json()) as { ok: boolean; error?: string };
    expect(confirmed.status, confirmedBody.error).toBe(200);
    const records = (
      await client.query(`select item_description, qty from spec_records where project_id = $1 order by source_line_no`, [projectId])
    ).rows;
    expect(records.map((r) => [r.item_description, Number(r.qty)])).toEqual([
      ["ARMCHAIR", 9],
      ["BAR STOOL", 4],
      ["SIDE TABLE", 2],
    ]);
  });

  it("refuses a PDF whose text is not a table in one sentence, and registers nothing", { timeout: 30_000 }, async () => {
    const before = Number((await client.query(`select count(*) from intake_runs where project_id = $1`, [projectId])).rows[0].count);
    const { response, body } = await register("__QA elevation.pdf", buildPdf([{ label: "__QA ELEVATION 1:10" }]));
    expect(response.status).toBe(400);
    expect(body.error).toBe(pdfBillRefusal("no_quantity_column"));
    expect(body.detail).toBeTruthy();
    const after = Number((await client.query(`select count(*) from intake_runs where project_id = $1`, [projectId])).rows[0].count);
    expect(after).toBe(before);
  });

  it("refuses a scan as a scan", { timeout: 30_000 }, async () => {
    const { response, body } = await register("__QA scan.pdf", buildPdf([{ image: true }]));
    expect(response.status).toBe(400);
    expect(body.error).toBe(SCANNED_PDF);
  });
});
