// The classify route answers per PART (open intake, 2026-11-20), route handler in hand.
//
// ============================================================================
// What is proved, with the survey's answer stubbed:
//
//   ONE PART TO READ IS TODAY'S ANSWER. A cover set aside leaves one part,
//   and the response has the file check's shape — no `parts`, the decision,
//   and the name rule (K1) still applied.
//
//   TWO OR MORE ARE ANSWERED PER PART, each with its place, its reader and its
//   evidence; a cover stays in the list marked nothing-to-read; the name rule
//   is not applied, because a name cannot describe a mix.
//
//   BILL OR SCHEDULE GOES TO CODE. A part held between a bill and an FF&E
//   schedule is tried by the bill reader — a PDF part on its own pages, a
//   sheet through `parseBoqSheets` — and where it reads as a bill it stays
//   HELD, its suggestion the bill and its evidence code's sentence. For a
//   single-part file too, in both file types.
//
//   THE BROWSER'S PAGE COUNT REACHES THE SURVEY, as it reached the file check.
//
// NO MODEL IS CALLED: the SDK's `messages` is stubbed, as in classify-route.test.ts.
// ============================================================================
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdf, buildPdfOfPages } from "../fixtures/build-pdf.mjs";
import { lookAnswer, surveyAnswer } from "../fixtures/look-answers";

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  class Stubbed extends Real {
    constructor(options: ConstructorParameters<typeof Real>[0]) {
      super(options);
      (this as unknown as { messages: unknown }).messages = { create };
      (this as unknown as { beta: unknown }).beta = { messages: { create } };
    }
  }
  return { ...actual, default: Stubbed };
});

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "__qa@example.test", name: "QA", role: "admin" }),
}));

vi.mock("@/lib/db", () => ({
  sql: async () => [{ id: PROJECT }],
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

// Quiet: the stubbed database has no bill vocabulary, so the registers load
// is logged as failed and the reader falls back to its reference headings —
// the degraded path the route already takes, and not what is under test.
vi.mock("@/lib/error-detail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/error-detail")>();
  return { ...actual, reportFailure: () => "ref" };
});

const stored = vi.hoisted(() => ({ bytes: Buffer.from("") as Buffer, contentType: "application/pdf" }));
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
  };
});

const PROJECT = "00000000-0000-4000-8000-000000000001";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

beforeEach(() => {
  vi.resetModules();
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "__qa-not-a-key";
  stored.bytes = buildPdfOfPages(3);
  stored.contentType = "application/pdf";
});

async function classify(filename: string, extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/imports/classify/route");
  const contentType = filename.endsWith(".xlsx") ? XLSX : "application/pdf";
  const res = await POST(
    new Request("http://localhost/api/imports/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT, pathname: `projects/${PROJECT}/uploads/${filename}`, filename, contentType, ...extra }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Text = { x: number; y: number; str: string };
/** A page of an invented schedule: FF&E CODE / DESCRIPTION / QTY, two lines. */
function schedulePage(): { width: number; height: number; texts: Text[] } {
  return {
    width: 842,
    height: 595,
    texts: [
      { x: 40, y: 530, str: "FF&E CODE" },
      { x: 120, y: 530, str: "DESCRIPTION" },
      { x: 405, y: 530, str: "QTY" },
      { x: 40, y: 490, str: "QA-CH-01" },
      { x: 120, y: 490, str: "ARMCHAIR" },
      { x: 411, y: 490, str: "9" },
      { x: 40, y: 450, str: "QA-SF-01" },
      { x: 120, y: 450, str: "SOFA" },
      { x: 411, y: 450, str: "4" },
    ],
  };
}

const prose = (str: string) => ({ width: 595, height: 842, texts: [{ x: 60, y: 760, str }] });

async function workbook(sheets: Record<string, (string | number)[][]>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

const BILL_ROWS = [
  ["Code", "Description", "Qty"],
  ["QA-CH-01", "Armchair", 9],
  ["QA-SF-01", "Sofa", 4],
  ["QA-TB-01", "Side table", 2],
];

describe("one part to read is today's answer", () => {
  it("sets a cover aside and answers the one part in the file check's shape", async () => {
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 1, genre: "unclear", evidence: "a cover", certain: false, nothingToRead: true },
        { firstPage: 2, lastPage: 3, genre: "shop_drawings", evidence: "dimensioned elevations", certain: true },
      ]),
    );
    const { status, body } = await classify("QA Drawings.pdf");
    expect(status).toBe(200);
    expect(body).not.toHaveProperty("parts");
    expect(body).toMatchObject({
      ok: true,
      genre: "shop_drawings",
      decision: { importType: "spec_document", documentKind: "shop_drawings" },
      unsupported: null,
      evidence: "dimensioned elevations",
      certain: true,
      charged: true,
    });
  });

  it("still holds a single part whose name says another kind (K1)", async () => {
    create.mockImplementation(lookAnswer({ genre: "shop_drawings", evidence: "elevations", certain: true }));
    const { body } = await classify("QA Finishes schedule rev C.pdf");
    expect(body.decision).toBeNull();
    expect(String(body.held)).toMatch(/which is it\?/);
    expect(body.modelDecision).toEqual({ importType: "spec_document", documentKind: "shop_drawings" });
  });

  it("answers a file whose every part is a cover as one part for a person: unclear, held, nothing filed", async () => {
    create.mockImplementation(surveyAnswer([{ genre: "unclear", evidence: "a title page", certain: false, nothingToRead: true }]));
    const { body } = await classify("QA Cover.pdf");
    expect(body).not.toHaveProperty("parts");
    expect(body).toMatchObject({ genre: "unclear", decision: null, certain: false, evidence: "a title page" });
  });

  it("gives the survey the browser's page count where the bytes could not be counted", async () => {
    stored.bytes = Buffer.from(buildPdfOfPages(2).toString("latin1").replace(/\/Count \d+/, ""), "latin1");
    create.mockImplementation(lookAnswer({ genre: "shop_drawings", evidence: "x", certain: true }));
    await classify("QA Drawings.pdf", { pages: 250 });
    const request = create.mock.calls[0]?.[0] as { messages: { content: { type: string; text?: string }[] }[] };
    const prompt = request.messages[0]!.content.find((block) => block.type === "text")?.text ?? "";
    expect(prompt).toMatch(/This PDF has 250 pages\.$/);
  });

  it("looks at a scan with the file check, never the survey", async () => {
    stored.bytes = buildPdf([{ image: true }]);
    create.mockImplementation(lookAnswer({ genre: "shop_drawings", evidence: "a drawing", certain: true }));
    const { body } = await classify("QA Scan.pdf");
    expect((create.mock.calls[0]?.[0] as { tool_choice: { name: string } }).tool_choice.name).toBe("record_document_kind");
    expect(typeof body.unsupported).toBe("string");
    expect(body).not.toHaveProperty("parts");
  });
});

describe("two or more parts are answered per part", () => {
  it("gives each part its place, its reader and its evidence, keeps the cover marked, and applies no name rule", async () => {
    stored.bytes = buildPdfOfPages(5);
    create.mockImplementation(
      surveyAnswer(
        [
          { firstPage: 1, lastPage: 1, genre: "unclear", evidence: "cover", certain: false, nothingToRead: true },
          { firstPage: 2, lastPage: 3, genre: "shop_drawings", evidence: "elevations", certain: true, itemCodes: ["QA-CH-01"] },
          { firstPage: 4, lastPage: 5, genre: "preamble", evidence: "GENERAL CONDITIONS", certain: true },
        ],
        "a drawing set then its preamble",
      ),
    );
    // Named as a schedule: a single-kind file so named would be HELD (K1). A mix is not.
    const { status, body } = await classify("QA Finishes schedule rev C.pdf");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, charged: true });
    expect(body).not.toHaveProperty("held");
    expect(String(body.note)).toContain("a drawing set then its preamble");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ place: { kind: "pages", from: 1, to: 1 }, nothingToRead: true, decision: null });
    expect(parts[1]).toMatchObject({
      place: { kind: "pages", from: 2, to: 3 },
      genre: "shop_drawings",
      decision: { importType: "spec_document", documentKind: "shop_drawings" },
      evidence: "elevations",
      itemCodes: ["QA-CH-01"],
      held: null,
      nothingToRead: false,
    });
    expect(parts[2]).toMatchObject({ place: { kind: "pages", from: 4, to: 5 }, decision: { importType: "spec_document", documentKind: "preamble" } });
  });

  it("reads a bill part of a PDF on its own pages, and says how many lines", async () => {
    stored.bytes = buildPdf([schedulePage(), prose("ELEVATION A"), prose("ELEVATION B")]);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 1, genre: "bill_of_quantities", evidence: "CODE / QTY", certain: true },
        { firstPage: 2, lastPage: 3, genre: "shop_drawings", evidence: "elevations", certain: true },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts[0]).toMatchObject({ decision: { importType: "boq", documentKind: null }, pdfBill: { lines: 2, pages: 1 } });
    expect(parts[1]).toMatchObject({ pdfBill: null });
  });

  it("holds every part of a sheet two parts name, and fills nothing in", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({ Mixed: [...BILL_ROWS, ["Code", "Finish"], ["QA-TIM-01", "Oak"]], Finishes: [["Code", "Finish"], ["QA-TIM-02", "Ash"]] });
    create.mockImplementation(
      surveyAnswer([
        { sheet: "Mixed", firstRow: 1, lastRow: 4, genre: "bill_of_quantities", evidence: "Code / Qty", certain: true },
        { sheet: "Mixed", firstRow: 5, lastRow: 6, genre: "finishes_schedule", evidence: "Code / Finish", certain: true },
        { sheet: "Finishes", genre: "finishes_schedule", evidence: "Code / Finish", certain: true },
      ]),
    );
    const { body } = await classify("QA Mixed.xlsx");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts).toHaveLength(3);
    for (const held of parts.slice(0, 2)) {
      expect(held).toMatchObject({ decision: null, suggestion: null });
      expect(String(held.held)).toBe("This sheet seems to hold two kinds of document. A sheet is read whole: choose one kind for it, or don't read it.");
    }
    expect(parts[2]).toMatchObject({ decision: { importType: "spec_document", documentKind: "finishes_schedule" }, held: null });
  });

  it("answers a three-sheet workbook the survey gave whole-sheet row ranges as three sheets, none held (the walk, 2026-11-21)", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({
      BOQ: BILL_ROWS,
      Finishes: [["Code", "Finish"], ["QA-TIM-01", "Oak"]],
      Notes: [["General"], ["All timber FSC certified."]],
    });
    create.mockImplementation(
      surveyAnswer([
        { sheet: "BOQ", firstRow: 1, lastRow: 4, genre: "bill_of_quantities", evidence: "Code / Qty", certain: true },
        { sheet: "Finishes", firstRow: 1, lastRow: null, genre: "finishes_schedule", evidence: "Code / Finish", certain: true },
        // Past the sheet's end: the part used to be dropped.
        { sheet: "Notes", firstRow: 1, lastRow: 90, genre: "preamble", evidence: "General", certain: true },
      ]),
    );
    const { body } = await classify("QA Bill and Finishes.xlsx");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts.map((part) => part.place)).toEqual([
      { kind: "sheet", sheet: "BOQ" },
      { kind: "sheet", sheet: "Finishes" },
      { kind: "sheet", sheet: "Notes" },
    ]);
    expect(parts.map((part) => part.held)).toEqual([null, null, null]);
    expect(parts.map((part) => part.decision)).toEqual([
      { importType: "boq", documentKind: null },
      { importType: "spec_document", documentKind: "finishes_schedule" },
      { importType: "spec_document", documentKind: "preamble" },
    ]);
  });

  it("holds a part of a mixed PDF the survey called a schedule whose text is a bill's table, with the bill suggested (C1 per part)", async () => {
    stored.bytes = buildPdf([prose("ELEVATION A"), schedulePage()]);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 1, genre: "shop_drawings", evidence: "elevation", certain: true },
        { firstPage: 2, lastPage: 2, genre: "ffe_schedule", evidence: "FF&E SPECIFICATION", certain: true },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts[1]).toMatchObject({
      decision: null,
      suggestion: { importType: "boq", documentKind: null },
      pdfBill: { lines: 2, pages: 1 },
      held: "Read as an FF&E schedule, but its text is a table of 2 lines with a quantity on each: if it is the bill, choose Bill of quantities.",
    });
    // A drawing part is never read as a bill.
    expect(parts[0]).toMatchObject({ held: null, suggestion: null, pdfBill: null });
  });
});

describe("one reader for the whole file is one whole-file read", () => {
  it("answers a drawing set with a cover and a blank divider as the single file it is", async () => {
    stored.bytes = buildPdfOfPages(30);
    create.mockImplementation(
      surveyAnswer(
        [
          { firstPage: 1, lastPage: 1, genre: "unclear", evidence: "a cover", certain: false, nothingToRead: true },
          { firstPage: 2, lastPage: 11, genre: "shop_drawings", evidence: "elevations", certain: true, itemCodes: ["QA-CH-01"] },
          { firstPage: 12, lastPage: 12, genre: "unclear", evidence: "blank", certain: false, nothingToRead: true },
          { firstPage: 13, lastPage: 30, genre: "specification_sheets", evidence: "spec sheets", certain: false, weighedAgainst: "shop_drawings" },
        ],
        "a drawing set",
      ),
    );
    const { status, body } = await classify("QA S-200 Drawings.pdf");
    expect(status).toBe(200);
    expect(body).not.toHaveProperty("parts");
    expect(body).toMatchObject({
      ok: true,
      // Pages 13–30 outweigh 2–11.
      genre: "specification_sheets",
      decision: { importType: "spec_document", documentKind: "shop_drawings" },
      evidence: "elevations / spec sheets",
      certain: true,
    });
    expect(String(body.note)).toContain("a drawing set");
  });

  it("still answers per part where the readers differ", async () => {
    stored.bytes = buildPdfOfPages(4);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 2, genre: "shop_drawings", evidence: "elevations", certain: true },
        { firstPage: 3, lastPage: 4, genre: "preamble", evidence: "GENERAL CONDITIONS", certain: true },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    expect(body.parts).toHaveLength(2);
  });

  it("does not collapse a file with a held part into one read", async () => {
    stored.bytes = buildPdfOfPages(4);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 2, genre: "shop_drawings", evidence: "elevations", certain: true },
        { firstPage: 3, lastPage: 4, genre: "unclear", evidence: "?", certain: false },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    expect(body.parts).toHaveLength(2);
  });
});

describe("nothing the survey set aside is read silently", () => {
  it("answers per part, with the uncovered pages held as a part of their own, when the survey's other part was dropped", async () => {
    stored.bytes = buildPdfOfPages(8);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 5, genre: "shop_drawings", evidence: "elevations", certain: true },
        // Past the file's end: dropped by code.
        { firstPage: 6, lastPage: 12, genre: "bill_of_quantities", evidence: "CODE / QTY", certain: true },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ place: { kind: "pages", from: 1, to: 5 }, decision: { documentKind: "shop_drawings" } });
    expect(parts[1]).toMatchObject({
      place: { kind: "pages", from: 6, to: 8 },
      genre: "unclear",
      decision: null,
      held: "No part of the file covers these pages — say what they are, or don't read them.",
    });
    expect(String(body.note)).toContain("was dropped");
  });

  it("never reads a workbook as its one placed sheet when the survey named another that is not there", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({ BOQ: BILL_ROWS, Finishes: [["Code", "Finish"], ["QA-TIM-01", "Oak"]] });
    create.mockImplementation(
      surveyAnswer([
        { sheet: "Bill of Quantities", genre: "bill_of_quantities", evidence: "Code / Qty", certain: true },
        { sheet: "Finishes", genre: "finishes_schedule", evidence: "Code / Finish", certain: true },
      ]),
    );
    const { body } = await classify("QA Bill and Finishes.xlsx");
    expect(body).not.toHaveProperty("decision");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts.map((part) => part.place)).toEqual([
      { kind: "sheet", sheet: "BOQ" },
      { kind: "sheet", sheet: "Finishes" },
    ]);
    expect(parts[0]).toMatchObject({ decision: null, held: "No part of the file covers this sheet — say what it is, or don't read it." });
  });

  it("answers per part where two parts claim the same pages, even for one reader", async () => {
    stored.bytes = buildPdfOfPages(6);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 4, genre: "shop_drawings", evidence: "elevations", certain: true },
        { firstPage: 3, lastPage: 6, genre: "shop_drawings", evidence: "more elevations", certain: true },
      ]),
    );
    const { body } = await classify("QA Drawings.pdf");
    expect(body.parts).toHaveLength(2);
    expect(String(body.note)).toContain("claimed by two parts");
  });
});

describe("bill or schedule goes to code", () => {
  const torn = { genre: "ffe_schedule", evidence: "FF&E SPECIFICATION", certain: false, weighedAgainst: "bill_of_quantities" } as const;

  it("holds a single-part PDF that reads as a bill, with the bill suggested and code's sentence as evidence", async () => {
    stored.bytes = buildPdf([schedulePage()]);
    create.mockImplementation(lookAnswer(torn));
    const { body } = await classify("QA Procurement Schedule.pdf");
    expect(body).not.toHaveProperty("parts");
    expect(body.decision).toBeNull();
    expect(body.suggestion).toEqual({ importType: "boq", documentKind: null });
    expect(String(body.held)).toMatch(/If it is the bill, accept Bill of quantities/);
    expect(String(body.evidence).startsWith("Reads as a bill: 2 lines; code and quantity columns found.")).toBe(true);
    expect(body.pdfBill).toEqual({ lines: 2, pages: 1 });
  });

  it("holds a single-sheet workbook that reads as a bill, either way round", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({ Schedule: BILL_ROWS });
    create.mockImplementation(
      lookAnswer({ genre: "bill_of_quantities", evidence: "Code / Qty", certain: false, weighedAgainst: "ffe_schedule" }),
    );
    const { body } = await classify("QA Schedule.xlsx");
    expect(body.decision).toBeNull();
    expect(body.suggestion).toEqual({ importType: "boq", documentKind: null });
    expect(String(body.evidence).startsWith("Reads as a bill: 3 lines; code and quantity columns found.")).toBe(true);
  });

  it("leaves a torn part that does not read as a bill exactly as today: held, nothing suggested", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({ Rooms: [["Room", "Product"], ["Lobby", "Lamp"]] });
    create.mockImplementation(lookAnswer(torn));
    const { body } = await classify("QA Rooms.xlsx");
    expect(body.decision).toBeNull();
    expect(body).not.toHaveProperty("suggestion");
    expect(body.held).toBeUndefined();
  });

  it("never probes a doubt that is not between a bill and a schedule", async () => {
    stored.bytes = buildPdf([schedulePage()]);
    create.mockImplementation(
      lookAnswer({ genre: "shop_drawings", evidence: "a drawing?", certain: false, weighedAgainst: "bill_of_quantities" }),
    );
    const { body } = await classify("QA Thing.pdf");
    expect(body).not.toHaveProperty("suggestion");
  });

  it("tries a torn part of a mixed workbook on its own sheet only", async () => {
    stored.contentType = XLSX;
    stored.bytes = await workbook({ Procurement: BILL_ROWS, Finishes: [["Code", "Finish"], ["QA-TIM-01", "Oak"]] });
    create.mockImplementation(
      surveyAnswer([
        { sheet: "Procurement", ...torn },
        { sheet: "Finishes", genre: "finishes_schedule", evidence: "Code / Finish", certain: true },
      ]),
    );
    const { body } = await classify("QA Schedules.xlsx");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts[0]).toMatchObject({ decision: null, suggestion: { importType: "boq", documentKind: null }, held: expect.any(String) });
    expect(String(parts[0]!.evidence)).toMatch(/^Reads as a bill: 3 lines; code and quantity columns found\./);
    expect(parts[1]).toMatchObject({ suggestion: null, decision: { importType: "spec_document", documentKind: "finishes_schedule" } });
  });

  it("tries a torn part of a mixed PDF on its own pages only", async () => {
    stored.bytes = buildPdf([prose("ELEVATION A"), schedulePage()]);
    create.mockImplementation(
      surveyAnswer([
        { firstPage: 1, lastPage: 1, genre: "shop_drawings", evidence: "elevation", certain: true },
        { firstPage: 2, lastPage: 2, ...torn },
      ]),
    );
    const { body } = await classify("QA Pack.pdf");
    const parts = body.parts as Record<string, unknown>[];
    expect(parts[1]).toMatchObject({ suggestion: { importType: "boq", documentKind: null }, pdfBill: { lines: 2, pages: 1 } });
  });
});
