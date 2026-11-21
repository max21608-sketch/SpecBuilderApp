// Database tier — a BILL registered as part of a file, and a bill registration
// replayed (open intake, 2026-11-20). Through the REAL registration route, the
// REAL transcribe route, the REAL confirm, the REAL bill-specifications
// registration and the REAL worker, with the blob store held in memory and
// only the model's calls replaced.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/bill-part.test.ts
//
// ============================================================================
// WHAT IT PROVES, on synthetic workbooks and PDFs:
//
// - a replayed bill registration answers with the first run and creates
//   nothing — no second run, no second attachment, no second stored workbook —
//   on all three bill paths: a workbook, a PDF read by its text, and a PDF
//   registered to be transcribed (the design's trap 4);
// - a workbook part stores its part, stages every sheet with the others
//   ignored and saying why, and a part naming a sheet the workbook does not
//   hold is refused in words with nothing created;
// - a PDF part reads its own pages only — another document's table on a page
//   outside it does not refuse the bill — keeps each line's page in the whole
//   file, and stores its workbook at a pathname naming its pages;
// - a transcription of a part windows over the part's pages and stores its
//   workbook under a pathname naming them;
// - the bill's own specification read carries the bill's sheets part, so the
//   finishes sheet beside the bill is never sent to the model.
// ============================================================================
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { describeIfDb, qaNumber } from "./db-tier";
import { stagedVersion } from "./staged-version";
import { buildPdf } from "../fixtures/build-pdf.mjs";
import type { SourcePart } from "@/lib/source-part";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The blob store, in memory, and every put it was asked for. */
const files = new Map<string, { bytes: Buffer; contentType: string }>();
const puts = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: { contentType?: string }) => {
    puts.paths.push(pathname);
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

/** THE TRANSCRIPTION MODEL: records the part it was given, answers rows on the part's pages. */
const transcribed = vi.hoisted(() => ({ parts: [] as unknown[] }));
vi.mock("@/lib/pdf-bill-transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf-bill-transcribe")>();
  return {
    ...actual,
    transcribePdfBill: async (input: { pageCount: number; part?: SourcePart | null }) => {
      transcribed.parts.push(input.part ?? null);
      const windows = input.part ? actual.planPartWindows(input.part) : actual.planPageWindows(input.pageCount);
      const outputs = windows.map((window) =>
        actual.TranscribeOutput.parse({
          notABill: false,
          notABillEvidence: "",
          columns: ["FF&E CODE", "DESCRIPTION", "QTY", "UOM"],
          aboveHeader: [],
          rows: [{ page: window.firstPage, cells: [`QA-P${window.firstPage}`, "ARMCHAIR", "3", "EA"], unclear: [] }],
          totals: [],
          note: "",
        }),
      );
      return {
        ok: true as const,
        transcription: actual.mergeTranscription(windows, outputs),
        calls: windows.map((window) => ({ part: window.index + 1, pages: `${window.firstPage}-${window.lastPage}`, ok: true, requestId: "req_qa", usage: {}, elapsedMs: 1, model: "claude-opus-5-5" })),
        raw: [{ qa: true }],
      };
    },
  };
});

/** THE EXTRACTION MODEL: records what it was sent. */
const sent = vi.hoisted(() => ({ sources: [] as unknown[] }));
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    extractSpecDocument: async (source: unknown) => {
      sent.sources.push(source);
      return {
        ok: true,
        output: { outputKind: "observations", data: { proposals: [], documentNotes: null } },
        model: "__qa-model",
        rawResponse: { __qa: true },
        usage: { input_tokens: 1, output_tokens: 1 },
        requestId: "req___qa",
        elapsedMs: 1,
      };
    },
  };
});

const published = vi.hoisted(() => ({ entries: [] as { key: string; attemptId: string }[] }));
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { attemptId: string }, key: string) => {
      published.entries.push({ key, attemptId: message.attemptId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type Text = { x: number; y: number; str: string; size?: number };
const landscape = (texts: Text[]) => ({ width: 842, height: 595, texts });
const billHeader = (y: number): Text[] => [
  { x: 40, y, str: "FF&E CODE" },
  { x: 120, y, str: "DESCRIPTION" },
  { x: 400, y, str: "QTY" },
  { x: 470, y, str: "UOM" },
];
const billLine = (y: number, code: string, description: string, qty: string): Text[] => [
  { x: 40, y, str: code },
  { x: 120, y, str: description },
  { x: 406, y, str: qty },
  { x: 470, y, str: "EACH" },
];

/** Page 1 a drawing, pages 2–3 the bill, page 4 a finishes schedule printing its own table. */
const mixedPdf = () =>
  buildPdf([
    { label: "__QA ELEVATION 1:10" },
    landscape([...billHeader(530), ...billLine(490, "QA-CH-01", "ARMCHAIR", "9")]),
    landscape([...billHeader(530), ...billLine(490, "QA-TB-01", "SIDE TABLE", "2")]),
    landscape([
      { x: 40, y: 530, str: "REF" },
      { x: 120, y: 530, str: "FINISH" },
      { x: 300, y: 530, str: "SUPPLIER" },
      { x: 400, y: 530, str: "QTY" },
      { x: 40, y: 490, str: "FAB-01" },
      { x: 120, y: 490, str: "__QA BOUCLE" },
      { x: 300, y: 490, str: "__QA MILL" },
      { x: 406, y: 490, str: "40" },
    ]),
  ]);

/** A bill sheet and a finishes sheet, one workbook. */
async function billAndFinishes(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Bill").addRows([
    ["Code", "Description", "Qty"],
    ["QA-SF-01", "Sofa", 2],
    ["QA-CH-02", "Dining chair", 12],
  ]);
  book.addWorksheet("Finishes").addRows([
    ["Code", "Description", "Qty"],
    ["QA-FAB-99", "__QA finishes-only bouclé", 40],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeIfDb("a bill that is part of a file, and a bill registered twice", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill part', 'qa', 'qa') returning id`,
        [qaNumber("P90066")],
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
      await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  beforeEach(() => {
    puts.paths.length = 0;
    transcribed.parts.length = 0;
    sent.sources.length = 0;
    published.entries.length = 0;
  });

  async function register(name: string, bytes: Buffer, contentType: string, extra: Record<string, unknown> = {}) {
    const pathname = `projects/${projectId}/${name}`;
    files.set(pathname, { bytes, contentType });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(jsonRequest("POST", { projectId, importType: "boq", pathname, filename: name, contentType, ...extra }));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const count = async (table: "attachments" | "intake_runs") => {
    const where = table === "attachments" ? "entity_type = 'project' and entity_id = $1" : "project_id = $1";
    return (await client.query(`select count(*)::int n from ${table} where ${where}`, [projectId])).rows[0].n as number;
  };

  const run = async (id: unknown) =>
    (
      await client.query(
        `select r.status, r.parsed, r.source_part, r.registration_request_id, a.storage_path
         from intake_runs r left join attachments a on a.id = r.attachment_id where r.id = $1`,
        [String(id)],
      )
    ).rows[0];

  // ---- the replay guard (trap 4) ---------------------------------------------

  it("answers a replayed workbook registration with the first bill, and creates nothing", { timeout: 60_000 }, async () => {
    const requestId = randomUUID();
    const first = await register("__QA replay.xlsx", await billAndFinishes(), XLSX, { registrationRequestId: requestId });
    expect(first.status, String(first.body.error)).toBe(201);
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];

    const again = await register("__QA replay.xlsx", await billAndFinishes(), XLSX, { registrationRequestId: requestId });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true, importId: first.body.importId, reused: true, sourcePreserved: true });
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
    expect((await run(first.body.importId)).registration_request_id).toBe(requestId);
  });

  it("answers a replayed FAILED bill as the failure it was, never as an added bill", { timeout: 60_000 }, async () => {
    // Fix 5 (2026-11-21): the replay answered `ok: true` for a run whose parse
    // had failed, so a lost response, retried, showed a bill that never read
    // as "Added".
    const requestId = randomUUID();
    const first = await register("__QA replay broken.xlsx", Buffer.from("not a workbook at all"), XLSX, { registrationRequestId: requestId });
    expect(first.body.ok).toBe(false);
    expect((await run(first.body.importId)).status).toBe("failed");
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];

    const again = await register("__QA replay broken.xlsx", Buffer.from("not a workbook at all"), XLSX, { registrationRequestId: requestId });
    expect(again.status).toBe(422);
    expect(again.body).toEqual({ ok: false, error: first.body.error, importId: first.body.importId, reused: true });
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
  });

  it("answers a replayed PDF bill without storing a second workbook", { timeout: 60_000 }, async () => {
    const requestId = randomUUID();
    const first = await register("__QA replay mixed.pdf", mixedPdf(), "application/pdf", {
      registrationRequestId: requestId,
      part: { kind: "pages", ranges: [{ from: 2, to: 3 }] },
    });
    expect(first.status, String(first.body.error)).toBe(201);
    expect(puts.paths).toHaveLength(1);
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];

    const again = await register("__QA replay mixed.pdf", mixedPdf(), "application/pdf", {
      registrationRequestId: requestId,
      part: { kind: "pages", ranges: [{ from: 2, to: 3 }] },
    });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ importId: first.body.importId, reused: true });
    expect(puts.paths).toHaveLength(1);
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
  });

  it("answers a replayed registration for transcription with the first run", { timeout: 60_000 }, async () => {
    const requestId = randomUUID();
    const scan = buildPdf([{ image: true }, { image: true }]);
    const first = await register("__QA replay scan.pdf", scan, "application/pdf", { registrationRequestId: requestId });
    expect(first.status, String(first.body.error)).toBe(201);
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];

    const again = await register("__QA replay scan.pdf", scan, "application/pdf", { registrationRequestId: requestId });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ importId: first.body.importId, reused: true });
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
  });

  // ---- a workbook part (trap 9) ------------------------------------------------

  it("refuses a part naming a sheet the workbook does not hold, and records nothing", { timeout: 30_000 }, async () => {
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];
    const refused = await register("__QA no such sheet.xlsx", await billAndFinishes(), XLSX, {
      registrationRequestId: randomUUID(),
      part: { kind: "sheets", sheets: ["Bill", "Lighting"] },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      ok: false,
      field: "part",
      error: "This bill is filed as sheet “Lighting”, which this workbook does not hold. A sheet may have been renamed since the file was surveyed — upload it again.",
    });
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
  });

  it(
    "stores a workbook part, stages the sheets outside it ignored, and the bill's own specification read never sees them",
    { timeout: 120_000 },
    async () => {
      const part = { kind: "sheets", sheets: ["Bill"] };
      const registered = await register("__QA bill and finishes.xlsx", await billAndFinishes(), XLSX, {
        registrationRequestId: randomUUID(),
        part,
      });
      expect(registered.status, String(registered.body.error)).toBe(201);
      const billRunId = String(registered.body.importId);
      const bill = await run(billRunId);
      expect(bill.source_part).toEqual(part);
      expect(
        bill.parsed.sheets.map((sheet: { sheetName: string; ignored: boolean; ignoredReason: string | null }) => [
          sheet.sheetName,
          sheet.ignored,
          sheet.ignoredReason,
        ]),
      ).toEqual([
        ["Bill", false, null],
        ["Finishes", true, "Not filed as part of the bill at upload."],
      ]);

      // A whole-bill re-read files the sheet outside the part the same way.
      const { POST: columns } = await import("@/app/api/imports/[id]/columns/route");
      const again = await columns(jsonRequest("POST", { action: "reread", version: await stagedVersion(client, billRunId) }), params(billRunId));
      expect(again.status).toBe(200);
      expect((await run(billRunId)).parsed.sheets[1]).toMatchObject({ ignored: true, ignoredReason: "Not filed as part of the bill at upload." });

      const { POST: confirm } = await import("@/app/api/imports/[id]/confirm/route");
      const confirmed = await confirm(jsonRequest("POST", { version: await stagedVersion(client, billRunId) }), params(billRunId));
      const confirmedBody = (await confirmed.json()) as { error?: string };
      expect(confirmed.status, confirmedBody.error).toBe(200);
      const names = (await client.query(`select item_description from spec_records where project_id = $1`, [projectId])).rows.map(
        (row) => row.item_description,
      );
      expect(names).toEqual(expect.arrayContaining(["Sofa", "Dining chair"]));
      expect(names).not.toContain("__QA finishes-only bouclé");

      const { withTransaction } = await import("@/lib/db-transaction");
      const { registerBillSpecifications } = await import("@/lib/bill-specifications");
      const { dispatchRegisteredRead } = await import("@/lib/spec-registration");
      const specs = await withTransaction((txn) => registerBillSpecifications(txn, { billRunId, actor: "__qa@example.test" }));
      if (specs.reused) throw new Error("the specification read was not new");
      expect((await run(specs.importId)).source_part).toEqual(part);
      expect(await dispatchRegisteredRead(specs, "__qa@example.test")).toEqual({ dispatched: true });

      const { runDocumentExtraction } = await import("@/lib/extraction-run");
      const attemptId = published.entries.find((entry) => entry.key.includes(specs.importId))?.attemptId;
      if (!attemptId) throw new Error("the specification read published no attempt");
      expect(await runDocumentExtraction({ extractionId: specs.importId, attemptId, actor: "__qa@example.test" })).toEqual({ outcome: "parsed" });
      const request = JSON.stringify(sent.sources);
      expect(request).toContain("QA-SF-01");
      expect(request).not.toContain("QA-FAB-99");
      expect(request).not.toContain("finishes-only");
    },
  );

  // ---- a PDF part (traps 5 and 6) ----------------------------------------------

  it("reads a PDF part by its pages only, keeps whole-file pages, and names the pages in the workbook's pathname", { timeout: 60_000 }, async () => {
    const part = { kind: "pages", ranges: [{ from: 2, to: 3 }] };
    // The whole file is refused as a bill whose columns change; its part is not.
    const registered = await register("__QA mixed pack.pdf", mixedPdf(), "application/pdf", { registrationRequestId: randomUUID(), part });
    expect(registered.status, String(registered.body.error)).toBe(201);
    const bill = await run(registered.body.importId);
    expect(bill.source_part).toEqual(part);
    expect(bill.storage_path).toBe(`projects/${projectId}/__QA mixed pack (read from PDF, pages 2-3).xlsx`);
    expect(files.has(bill.storage_path)).toBe(true);
    expect(bill.parsed.sheets[0].lines.map((line: { code: string }) => line.code)).toEqual(["QA-CH-01", "QA-TB-01"]);
    expect(bill.parsed.pdfSource).toMatchObject({ pages: [2, 3], part });
  });

  it("refuses a PDF part past the last page, and records nothing", { timeout: 30_000 }, async () => {
    const [runs, attachments] = [await count("intake_runs"), await count("attachments")];
    const refused = await register("__QA short.pdf", mixedPdf(), "application/pdf", {
      registrationRequestId: randomUUID(),
      part: { kind: "pages", ranges: [{ from: 2, to: 9 }] },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ field: "part" });
    expect(String(refused.body.error)).toContain("This PDF has 4 pages, so page 9 is not in it.");
    expect([await count("intake_runs"), await count("attachments")]).toEqual([runs, attachments]);
  });

  it("transcribes a part of a scanned PDF over its own pages, under a pathname naming them", { timeout: 60_000 }, async () => {
    const part = { kind: "pages", ranges: [{ from: 2, to: 4 }] };
    const scan = buildPdf([{ image: true }, { image: true }, { image: true }, { image: true }, { image: true }]);
    const registered = await register("__QA scanned pack.pdf", scan, "application/pdf", { registrationRequestId: randomUUID(), part });
    expect(registered.status, String(registered.body.error)).toBe(201);
    expect(registered.body.transcribe).toMatchObject({ pages: 3 });
    const runId = String(registered.body.importId);
    const waiting = await run(runId);
    expect(waiting.source_part).toEqual(part);
    expect(waiting.parsed.pdfSource.part).toEqual(part);

    const { POST: transcribe } = await import("@/app/api/imports/[id]/transcribe/route");
    const response = await transcribe(jsonRequest("POST", { version: await stagedVersion(client, runId), requestId: randomUUID() }), params(runId));
    const body = (await response.json()) as { ok: boolean; error?: string; outcome?: string };
    expect(response.status, body.error).toBe(200);
    expect(transcribed.parts).toEqual([part]);
    expect(body.outcome).toContain("over 3 pages");

    const done = await run(runId);
    expect(done.storage_path).toBe(`projects/${projectId}/__QA scanned pack (transcribed from PDF, pages 2-4).xlsx`);
    expect(done.parsed.pdfSource).toMatchObject({ pages: [2, 4], part });
    expect(done.parsed.sheets[0].lines.map((line: { code: string }) => line.code)).toEqual(["QA-P2", "QA-P4"]);
  });
});
