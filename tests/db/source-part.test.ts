// Database tier — a read of PART of a file (open intake, 2026-11-20), through
// the REAL registration route, the REAL worker and the REAL staging.
//
//   * A specification document registered with a part is stored with it; the
//     refusals refuse in words and record nothing; a replay returns the run
//     the first press made.
//   * The worker sends a part of a PDF the whole file and its instruction,
//     drops what the model reported from outside the part, says so in the
//     document's notes, and records the part on the staged document.
//   * A part of a workbook reads only its sheets.
//   * The tracker's furniture read carries its parent's part.
//
// NO MODEL IS CALLED and NO BLOB IS READ: both are mocked at the module
// boundary, as `extraction-queue.test.ts` mocks them. The source bytes are
// built here (an invented PDF skeleton and an invented workbook), and go
// through the REAL `prepareDocumentSource`.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
import type { SourcePart } from "@/lib/source-part";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

// What the "store" holds for the next read: set per test.
const stored = { bytes: Buffer.from(""), contentType: "application/pdf" };
vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async (pathname: string) => ({
      bytes: stored.bytes,
      contentType: stored.contentType,
      size: stored.bytes.length,
      pathname,
    }),
    headTrustedBlob: async (pathname: string) => ({ pathname, contentType: stored.contentType, size: stored.bytes.length }),
  };
});

// The "model": records what it was sent, answers with `answer`.
const sent: { source: unknown; kind: string; options: Record<string, unknown> }[] = [];
const answer = { output: null as unknown };
vi.mock("@/lib/anthropic", () => ({
  EXTRACTION_MODEL: "__qa-model",
  extractSpecDocument: async (source: unknown, kind: string, options: Record<string, unknown> = {}) => {
    sent.push({ source, kind, options });
    return {
      ok: true,
      output: answer.output,
      model: "__qa-model",
      rawResponse: { __qa: true },
      usage: { input_tokens: 1, output_tokens: 1 },
      requestId: "req___qa",
      elapsedMs: 1,
    };
  },
}));

const published: { key: string; attemptId: string }[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { attemptId: string }, key: string) => {
      published.push({ key, attemptId: message.attemptId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PART: SourcePart = { kind: "pages", ranges: [{ from: 1, to: 11 }, { from: 31, to: 44 }] };

/** A PDF skeleton that counts 44 pages and carries no stream (so it is not called scanned). */
const PDF_44 = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Pages /Count 44 /Kids [] >> endobj\n%%EOF\n", "latin1");

const post = (body: unknown) =>
  new Request("http://localhost/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("a read of part of a file", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90065")}', '__QA Source part project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  beforeEach(async () => {
    // Every registration here opens a read that no worker runs, and the
    // project allows three in flight (`extraction-slots.ts`). The ones an
    // earlier test left queued are put out of the way, so each test's own
    // registration takes a slot and publishes.
    await client.query(
      `update intake_runs set status = 'failed', error = '__QA set aside'
        where project_id = $1 and status in ('queued', 'parsing', 'pending')`,
      [projectId],
    );
    stored.bytes = PDF_44;
    stored.contentType = "application/pdf";
    sent.length = 0;
    published.length = 0;
    answer.output = null;
  });

  async function register(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      post({
        projectId,
        importType: "spec_document",
        documentKind: "shop_drawings",
        pathname: `projects/${projectId}/__qa-pack-${randomUUID()}.pdf`,
        filename: "__QA AB-CD-MUR-ZQ-08 pack.pdf",
        contentType: "application/pdf",
        registrationRequestId: randomUUID(),
        ...body,
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function runCount(): Promise<number> {
    const rows = await client.query(`select count(*)::int as n from intake_runs where project_id = $1`, [projectId]);
    return rows.rows[0].n;
  }

  async function attachmentCount(): Promise<number> {
    const rows = await client.query(`select count(*)::int as n from attachments where entity_id = $1`, [projectId]);
    return rows.rows[0].n;
  }

  async function read(importId: string) {
    const attemptId = published.find((entry) => entry.key.includes(importId))?.attemptId;
    if (!attemptId) throw new Error("the registration published no attempt");
    const { runDocumentExtraction } = await import("@/lib/extraction-run");
    return runDocumentExtraction({ extractionId: importId, attemptId, actor: "__qa@example.test" });
  }

  async function staged(importId: string) {
    const rows = await client.query(`select status, error, parsed, source_part from intake_runs where id = $1`, [importId]);
    return rows.rows[0];
  }

  // ---- registration ----------------------------------------------------------

  it("stores the part a specification document is registered with, in its canonical form", async () => {
    const { status, body } = await register({
      part: { kind: "pages", ranges: [{ from: 31, to: 44 }, { from: 1, to: 9 }, { from: 8, to: 11 }] },
    });
    expect(status).toBe(201);
    expect((await staged(String(body.importId))).source_part).toEqual(PART);
  });

  it("stores nothing for a whole file, as before", async () => {
    const { status, body } = await register({});
    expect(status).toBe(201);
    expect((await staged(String(body.importId))).source_part).toBeNull();
  });

  it("refuses a part it cannot read, in words, and records nothing", async () => {
    const before = { runs: await runCount(), attachments: await attachmentCount() };
    const refusals: [Record<string, unknown>, string][] = [
      [{ part: { kind: "pages", ranges: [{ from: 9, to: 3 }] } }, "Pages 9 to 3 run backwards. Give the first page first."],
      [{ part: { kind: "pages", ranges: [] } }, "A part of a PDF must name at least one page."],
      [
        { part: { kind: "pages", ranges: [{ from: 40, to: 45 }] } },
        "This PDF has 44 pages, so page 45 is not in it. Check the pages and upload it again.",
      ],
      [
        { part: { kind: "sheets", sheets: ["BOQ"] } },
        "Only an .xlsx workbook is read by its sheets. Upload this file without naming sheets.",
      ],
      [
        { part: { kind: "pages", ranges: [{ from: 1, to: 2 }] }, filename: "__QA schedule.xlsx", contentType: XLSX, documentKind: "ffe_schedule" },
        "Only a PDF is read by its pages. Upload this file without naming pages.",
      ],
      [
        { part: { kind: "pages", ranges: [{ from: 1, to: 2 }] }, filename: "__QA mail.eml", contentType: "message/rfc822", documentKind: "email" },
        "An email is read whole. A part of one cannot be read on its own.",
      ],
      [{ part: { kind: "rows", rows: [1] } }, "A part is either some pages of a PDF or some sheets of a workbook."],
    ];
    for (const [body, error] of refusals) {
      const response = await register(body);
      expect(response.status, error).toBe(400);
      expect(response.body.error).toBe(error);
    }
    expect(await runCount()).toBe(before.runs);
    expect(await attachmentCount()).toBe(before.attachments);
    expect(published).toHaveLength(0);
  });

  it("answers a replayed registration with the run the first press made", async () => {
    const registrationRequestId = randomUUID();
    const first = await register({ registrationRequestId, part: PART });
    const before = await runCount();
    const again = await register({ registrationRequestId, part: PART });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ importId: first.body.importId, reused: true });
    expect(await runCount()).toBe(before);
    expect(published.filter((entry) => entry.key.includes(String(first.body.importId)))).toHaveLength(1);
  });

  // ---- the read ----------------------------------------------------------------

  it("sends a part of a PDF whole with its pages named, keeps only what its part said, and says what it left out", async () => {
    const { body } = await register({ part: PART });
    const importId = String(body.importId);
    answer.output = {
      outputKind: "drawing_items_v4",
      data: DrawingsItemsOutput.parse({
        documentNotes: "Shop drawings.",
        nonItemPages: ["12: preamble"],
        items: [
          {
            codes: ["GR-ZQ-08"],
            pages: [2, 34],
            overall: [{ slot: "width", valueRaw: "840", page: 34, evidence: "labelled WIDTH" }],
            mockup: "",
          },
          { codes: ["PL-ZQ-09"], pages: [20], overall: [{ slot: "width", valueRaw: "600", page: 20, evidence: "x" }] },
        ],
      }),
    };
    expect(await read(importId)).toEqual({ outcome: "parsed" });

    // The whole file went, with the instruction naming the part's pages.
    expect(sent).toHaveLength(1);
    const source = sent[0]!.source as { type: string; base64: string };
    expect(source.type).toBe("pdf");
    expect(Buffer.from(source.base64, "base64").equals(PDF_44)).toBe(true);
    expect(String(sent[0]!.options.instruction)).toContain("THE DOCUMENT is pages 1–11 and 31–44 of the file");
    expect(sent[0]!.options.part).toEqual(PART);

    const row = await staged(importId);
    expect(row.status).toBe("parsed");
    expect(row.parsed.sourcePart).toEqual(PART);
    expect(row.parsed.items.map((item: { itemCodeRaw: string }) => item.itemCodeRaw)).toEqual(["GR-ZQ-08"]);
    expect(row.parsed.nonItemPages ?? []).toEqual([]);
    expect(row.parsed.documentNotes).toBe(
      "Shop drawings.\nLeft out: 1 item reported from page 20 (PL-ZQ-09); 1 page said to describe no item reported from page 12. None of that is part of this read (pages 1–11 and 31–44).",
    );
  });

  it("reads a whole PDF exactly as before: no instruction, nothing left out, no part on the staged document", async () => {
    const { body } = await register({});
    const importId = String(body.importId);
    answer.output = {
      outputKind: "drawing_items_v4",
      data: DrawingsItemsOutput.parse({
        documentNotes: "Shop drawings.",
        nonItemPages: [],
        items: [{ codes: ["PL-ZQ-09"], pages: [20] }],
      }),
    };
    expect(await read(importId)).toEqual({ outcome: "parsed" });
    expect(sent[0]!.options).not.toHaveProperty("instruction");
    expect(sent[0]!.options).not.toHaveProperty("part");
    const row = await staged(importId);
    expect(row.parsed).not.toHaveProperty("sourcePart");
    expect(row.parsed.items).toHaveLength(1);
    expect(row.parsed.documentNotes).toBe("Shop drawings.");
  });

  it("reads only a workbook part's sheets", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Furniture").addRows([
      ["Code", "Item", "Width"],
      ["SX11A", "Lounge chair", "900"],
    ]);
    book.addWorksheet("Finishes").addRows([
      ["Code", "Finish"],
      ["FAB-01", "__QA bouclé"],
    ]);
    stored.bytes = Buffer.from(await book.xlsx.writeBuffer());
    stored.contentType = XLSX;
    const { status, body } = await register({
      filename: "__QA schedules.xlsx",
      contentType: XLSX,
      documentKind: "ffe_schedule",
      part: { kind: "sheets", sheets: ["Furniture"] },
    });
    expect(status).toBe(201);
    answer.output = { outputKind: "observations", data: { proposals: [], documentNotes: null } };
    expect(await read(String(body.importId))).toEqual({ outcome: "parsed" });

    const texts = sent.map((call) => String((call.source as { text?: string }).text ?? ""));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.join("\n")).toContain("SX11A");
    expect(texts.join("\n")).not.toContain("__QA bouclé");
    expect(texts.join("\n")).not.toContain("Finishes");
    expect((await staged(String(body.importId))).parsed.sourcePart).toEqual({ kind: "sheets", sheets: ["Furniture"] });
  });

  it("fails a workbook part whose sheet is not in the file, in words, before any model call", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Furniture").addRows([["Code"], ["SX11A"]]);
    stored.bytes = Buffer.from(await book.xlsx.writeBuffer());
    stored.contentType = XLSX;
    const { body } = await register({
      filename: "__QA schedules.xlsx",
      contentType: XLSX,
      documentKind: "ffe_schedule",
      part: { kind: "sheets", sheets: ["Lighting"] },
    });
    expect(await read(String(body.importId))).toMatchObject({ outcome: "failed" });
    expect(sent).toHaveLength(0);
    const row = await staged(String(body.importId));
    expect(row.status).toBe("failed");
    expect(row.error).toBe(
      "This read is for sheet “Lighting”, which this workbook does not hold. A sheet may have been renamed since the file was surveyed — upload it again.",
    );
  });

  // ---- a second read of the same file ---------------------------------------

  it("gives the tracker's furniture read its parent's part", async () => {
    const { body } = await register({ documentKind: "finishes_schedule", part: { kind: "pages", ranges: [{ from: 31, to: 44 }] } });
    const finishesRunId = String(body.importId);
    const { withTransaction } = await import("@/lib/db-transaction");
    const { registerTrackerFurniture } = await import("@/lib/tracker-furniture");
    const furniture = await withTransaction((txn) => registerTrackerFurniture(txn, { finishesRunId, actor: "__qa@example.test" }));
    const row = await staged(furniture.importId);
    expect(row.source_part).toEqual({ kind: "pages", ranges: [{ from: 31, to: 44 }] });
  });

  it("leaves the tracker's furniture read whole when its parent was", async () => {
    const { body } = await register({ documentKind: "finishes_schedule" });
    const { withTransaction } = await import("@/lib/db-transaction");
    const { registerTrackerFurniture } = await import("@/lib/tracker-furniture");
    const furniture = await withTransaction((txn) =>
      registerTrackerFurniture(txn, { finishesRunId: String(body.importId), actor: "__qa@example.test" }),
    );
    expect((await staged(furniture.importId)).source_part).toBeNull();
  });

  // ---- what the screens are given --------------------------------------------

  it("returns the part beside the filename on the document's own route and the project's documents", async () => {
    const { body } = await register({ part: PART });
    const importId = String(body.importId);
    const { GET: getImport } = await import("@/app/api/imports/[id]/route");
    const one = await (await getImport(new Request("http://localhost/x"), { params: Promise.resolve({ id: importId }) })).json();
    expect(one.import.sourcePart).toEqual(PART);
    expect(one.import).not.toHaveProperty("source_part");

    const { GET: getProject } = await import("@/app/api/projects/[id]/route");
    const project = await (
      await getProject(new Request(`http://localhost/api/projects/${projectId}?only=documents`), { params: Promise.resolve({ id: projectId }) })
    ).json();
    const document = project.documents.find((doc: { id: string }) => doc.id === importId);
    expect(document.sourcePart).toEqual(PART);
    expect(document).not.toHaveProperty("source_part");
    const whole = project.documents.find((doc: { sourcePart: unknown }) => doc.sourcePart === null);
    expect(whole).toBeDefined();
  });
});
