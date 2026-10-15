// The classify route, and the difference between "unclear" and "the call failed".
//
// ============================================================================
// FIU 2026-09-23, the pilot upload. The route answered `200 ok:true, genre:
// "unclear"` when the model call itself failed, so a deployment with no API key
// turned thirty files into thirty rows reading "Say which", and nothing said
// why. What is proved here, route handler in hand:
//
//   A REAL "UNCLEAR" STAYS A 200. The model looked and could not tell; that is
//   an answer, and a person decides.
//
//   EVERY FAILURE IS `ok:false` WITH ITS CODE — not_configured, rate_limited,
//   overloaded, timeout, auth, failed — the sentence, and whether it was
//   charged, told truthfully: a 429 and a refused key are not billed, a
//   timeout may have been.
//
//   A PDF OVER THE FAST MODEL'S PAGE CEILING IS LOOKED AT BY THE READING MODEL,
//   and the answer says so.
//
// NO MODEL IS CALLED. The SDK class is subclassed with a stubbed `messages`,
// which keeps its real error classes — the route's mapping is `instanceof`
// against those, and a hand-made stand-in would prove the stand-in.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdf, buildPdfOfPages } from "../fixtures/build-pdf.mjs";

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  // Statics are inherited, so `Anthropic.RateLimitError` is the real class.
  class Stubbed extends Real {
    constructor(options: ConstructorParameters<typeof Real>[0]) {
      super(options);
      (this as unknown as { messages: unknown }).messages = { create };
      // The large-PDF look runs on Opus 5.5, whose structured-output request
      // carries the refusal fallback: a beta, so the beta endpoint.
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

const stored = vi.hoisted(() => ({ bytes: Buffer.from("") as Buffer }));
vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async (pathname: string) => ({
      bytes: stored.bytes,
      contentType: "application/pdf",
      size: stored.bytes.length,
      pathname,
    }),
  };
});

const PROJECT = "00000000-0000-4000-8000-000000000001";
const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  vi.resetModules();
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "__qa-not-a-key";
  stored.bytes = buildPdfOfPages(2);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

async function classify(extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/imports/classify/route");
  const res = await POST(
    new Request("http://localhost/api/imports/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT,
        pathname: `projects/${PROJECT}/uploads/S-100.pdf`,
        filename: "S-100.pdf",
        contentType: "application/pdf",
        ...extra,
      }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function answers(input: Record<string, unknown>) {
  create.mockResolvedValue({
    content: [{ type: "tool_use", id: "t1", name: "record_document_kind", input }],
    stop_reason: "tool_use",
  });
}

describe("the model looked", () => {
  it("answers a real 'unclear' as a 200, ok, charged", async () => {
    answers({ genre: "unclear", titleText: null, evidence: "a cover page with no title", certain: false });
    const { status, body } = await classify();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.decision).toBeNull();
    expect(body.charged).toBe(true);
    expect(body.code).toBeUndefined();
  });

  it("answers a drawing set with its decision", async () => {
    answers({ genre: "shop_drawings", titleText: "S-100", evidence: "dimensioned elevations", certain: true });
    const { body } = await classify();
    expect(body.ok).toBe(true);
    expect(body.decision).toEqual({ importType: "spec_document", documentKind: "shop_drawings" });
    expect(body.largeDocument).toBe(false);
  });
});

describe("the call failed", () => {
  it("says the deployment has no key, and that nothing was charged", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { status, body } = await classify();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "not_configured", charged: false });
    expect(String(body.error)).toMatch(/not configured on this deployment/);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [429, "rate_limited", false],
    [529, "overloaded", false],
    [401, "auth", false],
    [500, "failed", false],
  ])("maps a %i to %s, charged %s", async (httpStatus, code, charged) => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    create.mockRejectedValue(
      Anthropic.APIError.generate(httpStatus, { type: "error", error: { type: "x", message: "x" } }, "x", new Headers()),
    );
    const { body } = await classify();
    expect(body).toMatchObject({ ok: false, code, charged });
    expect(typeof body.error).toBe("string");
  });

  it("maps a timeout, and counts it as charged because it may have been", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    create.mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const { status, body } = await classify();
    expect(status).toBe(504);
    expect(body).toMatchObject({ ok: false, code: "timeout", charged: true });
  });

  it("reports an answer with no tool call as a charged failure, not as unclear", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" });
    const { body } = await classify();
    expect(body).toMatchObject({ ok: false, code: "failed", charged: true });
  });
});

describe("which model looks", () => {
  it("uses the fast model for a short PDF", async () => {
    answers({ genre: "shop_drawings", titleText: null, evidence: "x", certain: true });
    await classify();
    const { CLASSIFY_MODEL } = await import("@/lib/document-classify");
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: CLASSIFY_MODEL });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("thinking");
  });

  it("uses the reading model for a PDF over the fast model's page ceiling, counted off the bytes", async () => {
    stored.bytes = buildPdfOfPages(101);
    // Opus 5.5 answers in the text, as structured output.
    create.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ genre: "shop_drawings", titleText: null, evidence: "x", certain: true }) }],
      stop_reason: "end_turn",
    });
    const { body } = await classify();
    const { EXTRACTION_MODEL } = await import("@/lib/anthropic");
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe(EXTRACTION_MODEL);
    // No forced tool on Opus 5.5: the answer is asked for as structured output,
    // at low effort, with the refusal fallback on.
    expect(params).not.toHaveProperty("tool_choice");
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body.largeDocument).toBe(true);
    expect(body).toMatchObject({ ok: true, decision: { importType: "spec_document", documentKind: "shop_drawings" } });
  });

  it("takes the browser's count where the server cannot read the page tree", async () => {
    // Two pages that the server CAN count: the server's count wins, so a hint
    // of 300 does not move a two-page document onto the dearer model.
    answers({ genre: "shop_drawings", titleText: null, evidence: "x", certain: true });
    await classify({ pages: 300 });
    const { CLASSIFY_MODEL } = await import("@/lib/document-classify");
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: CLASSIFY_MODEL });
  });

  it("uses the hint when the bytes carry no legible page count", async () => {
    // A PDF whose page tree is unreadable to the byte scan (the object-stream
    // case): strip the /Count so `countPdfPages` returns null.
    stored.bytes = Buffer.from(buildPdfOfPages(2).toString("latin1").replace(/\/Count \d+/, ""), "latin1");
    answers({ genre: "shop_drawings", titleText: null, evidence: "x", certain: true });
    const { body } = await classify({ pages: 250 });
    const { EXTRACTION_MODEL } = await import("@/lib/anthropic");
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: EXTRACTION_MODEL });
    expect(body.largeDocument).toBe(true);
  });
});

describe("the free paths are unchanged", () => {
  it("answers a saved email with no call", async () => {
    const { body } = await classify({ filename: "RE fabric.eml", contentType: "message/rfc822", pathname: `projects/${PROJECT}/uploads/RE fabric.eml` });
    expect(body).toMatchObject({ ok: true, genre: "email", charged: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a scanned PDF that is not a bill, after one small look (C2: a scan is looked at now)", async () => {
    const { buildPdf } = await import("../fixtures/build-pdf.mjs");
    stored.bytes = buildPdf([{ image: true }]);
    answers({ genre: "shop_drawings", titleText: null, evidence: "a drawing", certain: true });
    const { body } = await classify();
    expect(body).toMatchObject({ ok: true, charged: true, decision: null });
    expect(typeof body.unsupported).toBe("string");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("files a scanned PDF the model is certain is a bill as one, to be transcribed (C2)", async () => {
    const { buildPdf } = await import("../fixtures/build-pdf.mjs");
    stored.bytes = buildPdf([{ image: true }, { image: true }]);
    answers({ genre: "bill_of_quantities", titleText: null, evidence: "a table of items with quantities", certain: true });
    const { body } = await classify();
    expect(body.decision).toEqual({ importType: "boq", documentKind: null });
    expect(body.unsupported).toBeNull();
    expect(body.pdfBill).toEqual({ lines: 0, pages: 2, transcribe: true, reason: "This PDF has no text a program can read: its pages are pictures." });
  });
});

// ============================================================================
// A BILL IN A PDF (C1, 2026-10-15). The model says what the document IS; code
// reads whether its text is a bill's table (`readPdfBill`), from the bytes
// already in hand. Synthetic PDFs: invented codes placed the way a
// spreadsheet prints them.
// ============================================================================
type Text = { x: number; y: number; str: string };
/** A one-page schedule: FF&E CODE / DESCRIPTION / ORDER over QTY / UOM, two lines. */
function scheduleTable(): Buffer {
  const texts: Text[] = [
    { x: 40, y: 530, str: "FF&E CODE" },
    { x: 120, y: 530, str: "DESCRIPTION" },
    { x: 400, y: 534, str: "ORDER" },
    { x: 405, y: 526, str: "QTY" },
    { x: 470, y: 530, str: "UOM" },
    { x: 40, y: 490, str: "QA-CH-01" },
    { x: 120, y: 490, str: "ARMCHAIR" },
    { x: 411, y: 490, str: "9" },
    { x: 470, y: 490, str: "EACH" },
    { x: 40, y: 450, str: "QA-FB-01" },
    { x: 120, y: 450, str: "FABRIC" },
    { x: 411, y: 450, str: "13.5" },
    { x: 470, y: 450, str: "METRE" },
  ];
  return buildPdf([{ width: 842, height: 595, texts }]);
}

describe("a bill in a PDF", () => {
  it("files one whose text is a table as a bill, saying how many lines it read", async () => {
    stored.bytes = scheduleTable();
    answers({ genre: "bill_of_quantities", titleText: null, evidence: "line items with quantities", certain: true });
    const { status, body } = await classify();
    expect(status).toBe(200);
    expect(body.decision).toEqual({ importType: "boq", documentKind: null });
    expect(body.unsupported).toBeNull();
    expect(body.pdfBill).toEqual({ lines: 2, pages: 1 });
  });

  it("files one whose text is not a table as a bill to be transcribed, saying why (C2)", async () => {
    // A two-page PDF with a line of text per page: no header, no quantity.
    answers({ genre: "bill_of_quantities", titleText: null, evidence: "headed BILL OF QUANTITIES", certain: true });
    const { status, body } = await classify();
    expect(status).toBe(200);
    expect(body.decision).toEqual({ importType: "boq", documentKind: null });
    expect(body.unsupported).toBeNull();
    expect(body.pdfBill).toMatchObject({ transcribe: true, reason: "This PDF's text has no quantity column a program could find." });
  });

  it("holds one the model filed as an FF&E schedule when its text is a bill's table", async () => {
    // The real Ronnie Scott's procurement schedules, filed as FF&E schedules
    // with certainty: neither reading is allowed to win, and nothing is filed.
    stored.bytes = scheduleTable();
    answers({ genre: "ffe_schedule", titleText: "FF&E SPECIFICATION", evidence: "an FF&E specification", certain: true });
    const { body } = await classify();
    expect(body.decision).toBeNull();
    expect(body.unsupported).toBeNull();
    expect(body.held).toBe(
      "Read as an FF&E schedule, but its text is a table of 2 lines with a quantity on each: if it is the bill, choose Bill of quantities.",
    );
    expect(body.genre).toBe("ffe_schedule");
  });

  it("leaves an FF&E schedule whose text is not a bill's table exactly as the model filed it", async () => {
    answers({ genre: "ffe_schedule", titleText: null, evidence: "products by room", certain: true });
    const { body } = await classify();
    expect(body.decision).toEqual({ importType: "spec_document", documentKind: "ffe_schedule" });
    expect(body.held).toBeUndefined();
  });

  it("never reads a drawing set's text as a bill", async () => {
    stored.bytes = scheduleTable();
    answers({ genre: "shop_drawings", titleText: null, evidence: "elevations", certain: true });
    const { body } = await classify();
    expect(body.decision).toEqual({ importType: "spec_document", documentKind: "shop_drawings" });
    expect(body.held).toBeUndefined();
  });
});
