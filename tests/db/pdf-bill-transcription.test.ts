// Database tier — a PDF bill code could not read, TRANSCRIBED by the model
// (workstream C2, 2026-10-15). Through the real registration, the real
// transcribe route, the real columns route and the real confirm, with the blob
// store held in memory and ONLY the model's call replaced: `transcribePdfBill`
// answers with a fixed transcription, so what is tested is everything the app
// does with one.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/pdf-bill-transcription.test.ts
//
// ============================================================================
// WHAT IT PROVES, on a synthetic scanned PDF and an invented transcription:
//
// - a scan registered as a bill waits, and the transcribe route stores the
//   workbook the transcription becomes BESIDE the PDF, makes it the run's
//   source, and stages it through the ordinary reader — each line's page
//   kept, every line marked by `pdfTranscription`, what the checks need kept;
// - a retried request is answered from the record and a later one costs
//   nothing: the model is asked ONCE;
// - a whole-bill re-read keeps the pages and the marks;
// - the confirm is the unchanged one, and makes the records.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { buildPdf } from "../fixtures/build-pdf.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

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

/** THE MODEL, AND ONLY THE MODEL, replaced: a fixed, invented transcription of two pages. */
const modelCalls = vi.hoisted(() => ({ count: 0, pageCounts: [] as number[] }));
vi.mock("@/lib/pdf-bill-transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf-bill-transcribe")>();
  return {
    ...actual,
    transcribePdfBill: async (input: { pageCount: number }) => {
      modelCalls.count += 1;
      modelCalls.pageCounts.push(input.pageCount);
      const output = (rows: { page: number; cells: string[]; unclear: string[] }[], totals: unknown[] = [], aboveHeader: unknown[] = []) =>
        actual.TranscribeOutput.parse({ notABill: false, notABillEvidence: "", columns: ["FF&E CODE", "DESCRIPTION", "QTY", "UOM"], aboveHeader, rows, totals, note: "" });
      const transcription = actual.mergeTranscription(actual.planPageWindows(2), [
        output(
          [
            { page: 1, cells: ["QA-CH-01", "ARMCHAIR", "9", "EA"], unclear: [] },
            { page: 1, cells: ["QA-CH-02", "BAR STOOL", "4", "EA"], unclear: ["QTY"] },
            { page: 2, cells: ["QA-TB-01", "SIDE TABLE", "2", "EA"], unclear: [] },
          ],
          [{ page: 2, label: "TOTAL", column: 2, value: "16", scope: "document" }],
          [{ page: 1, text: "Revision: B" }],
        ),
      ]);
      return {
        ok: true as const,
        transcription,
        calls: [{ part: 1, pages: "1-2", ok: true, requestId: "req_qa", usage: { input_tokens: 1, output_tokens: 1 }, elapsedMs: 1, model: "claude-opus-5-5" }],
        raw: [{ qa: true }],
      };
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describeIfDb("a PDF bill the model transcribes", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  const pdfName = "__QA scanned schedule.pdf";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA transcribed bill', 'qa', 'qa') returning id`,
        [qaNumber("P90092")],
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

  type Staged = {
    sheets: { proposedRunName: string; metadata: { revision: string | null }; lines: { lineNo: number; code: string | null; qty: number | null }[] }[];
    pdfSource: { attachmentId: string; firstRow: number; pages: number[] };
    pdfTranscription: { state: string; reason: string; pageCount: number | null; totals?: unknown[]; rowUnclear?: Record<string, string[]>; pageText?: unknown[] };
  };
  const staged = async () =>
    (await client.query(`select parsed, version, attachment_id, model_metadata from intake_runs where id = $1`, [runId])).rows[0] as {
      parsed: Staged;
      version: number;
      attachment_id: string;
      model_metadata: { transcription?: { lastRequestId?: string; pending?: unknown; outcome?: { ok: boolean } } } | null;
    };

  it("registers a scan declared a bill, waiting, with nothing read", { timeout: 30_000 }, async () => {
    const pathname = `projects/${projectId}/${pdfName}`;
    files.set(pathname, { bytes: buildPdf([{ image: true }, { image: true }]), contentType: "application/pdf" });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(jsonRequest("POST", { projectId, importType: "boq", pathname, filename: pdfName, contentType: "application/pdf" }));
    const body = (await response.json()) as { ok: boolean; importId?: string; error?: string; transcribe?: unknown };
    expect(response.status, body.error).toBe(201);
    expect(body.transcribe).toMatchObject({ pages: 2 });
    runId = body.importId!;
    const { parsed } = await staged();
    expect(parsed.sheets).toEqual([]);
    expect(parsed.pdfTranscription).toMatchObject({ state: "waiting", pageCount: 2 });
    expect(modelCalls.count).toBe(0);
  });

  it("stores the transcription as the workbook beside the PDF, and stages it, every line marked with its page", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/transcribe/route");
    const before = await staged();
    const requestId = "6f1d3a42-1111-4c2a-9a1e-0000000000c2";
    const response = await POST(jsonRequest("POST", { version: before.version, requestId }), params(runId));
    const body = (await response.json()) as { ok: boolean; lines?: number; error?: string };
    expect(response.status, body.error).toBe(200);
    expect(body.lines).toBe(3);
    expect(modelCalls.count).toBe(1);
    expect(modelCalls.pageCounts).toEqual([2]);

    const after = await staged();
    const source = (await client.query(`select kind, storage_path, filename from attachments where id = $1`, [after.attachment_id])).rows[0];
    expect(source).toMatchObject({
      kind: "boq",
      storage_path: `projects/${projectId}/__QA scanned schedule (transcribed from PDF).xlsx`,
      filename: "__QA scanned schedule (transcribed from PDF).xlsx",
    });
    expect(files.has(source.storage_path)).toBe(true);

    const sheet = after.parsed.sheets[0]!;
    expect(sheet.lines.map((line) => [line.code, line.qty])).toEqual([
      ["QA-CH-01", 9],
      ["QA-CH-02", 4],
      ["QA-TB-01", 2],
    ]);
    expect(sheet.metadata.revision).toBe("B");
    expect(sheet.proposedRunName).toBe("__QA scanned schedule");
    // The header is on row 2 (the revision line is above it): lines start on row 3.
    expect(after.parsed.pdfSource).toMatchObject({ firstRow: 3, pages: [1, 1, 2] });
    expect(after.parsed.pdfTranscription).toMatchObject({
      state: "done",
      pageCount: 2,
      totals: [{ page: 2, label: "TOTAL", column: 2, valueRaw: "16", scope: "document" }],
      rowUnclear: { "4": ["QTY"] },
      pageText: [null, null],
    });
    expect(after.model_metadata?.transcription).toMatchObject({ lastRequestId: requestId, pending: null, outcome: { ok: true } });

    // A retried request is answered from the record; a new one costs nothing now.
    const replay = await POST(jsonRequest("POST", { version: before.version, requestId }), params(runId));
    expect(((await replay.json()) as { replayed?: boolean }).replayed).toBe(true);
    const later = await POST(jsonRequest("POST", { version: after.version, requestId: "6f1d3a42-1111-4c2a-9a1e-0000000000c3" }), params(runId));
    expect(((await later.json()) as { nothing?: boolean }).nothing).toBe(true);
    expect(modelCalls.count).toBe(1);
  });

  it("keeps the pages and the marks through a whole-bill re-read, and confirms through the unchanged confirm", { timeout: 60_000 }, async () => {
    const { POST: columns } = await import("@/app/api/imports/[id]/columns/route");
    const { version } = await staged();
    const again = await columns(jsonRequest("POST", { action: "reread", version }), params(runId));
    expect(again.status).toBe(200);
    const reread = await staged();
    expect(reread.parsed.pdfSource.pages).toEqual([1, 1, 2]);
    expect(reread.parsed.pdfTranscription.state).toBe("done");

    const { POST: confirm } = await import("@/app/api/imports/[id]/confirm/route");
    const confirmed = await confirm(jsonRequest("POST", {}), params(runId));
    const confirmedBody = (await confirmed.json()) as { ok: boolean; error?: string };
    expect(confirmed.status, confirmedBody.error).toBe(200);
    const records = (await client.query(`select item_description, qty from spec_records where project_id = $1 order by source_line_no`, [projectId])).rows;
    expect(records.map((r) => [r.item_description, Number(r.qty)])).toEqual([
      ["ARMCHAIR", 9],
      ["BAR STOOL", 4],
      ["SIDE TABLE", 2],
    ]);
  });
});
