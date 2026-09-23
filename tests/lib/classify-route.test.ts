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
import { buildPdfOfPages } from "../fixtures/build-pdf.mjs";

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  // Statics are inherited, so `Anthropic.RateLimitError` is the real class.
  class Stubbed extends Real {
    constructor(options: ConstructorParameters<typeof Real>[0]) {
      super(options);
      (this as unknown as { messages: unknown }).messages = { create };
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
    answers({ genre: "shop_drawings", titleText: null, evidence: "x", certain: true });
    const { body } = await classify();
    const { EXTRACTION_MODEL } = await import("@/lib/anthropic");
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.model).toBe(EXTRACTION_MODEL);
    // The forced tool is kept, at low effort, with the extraction call's
    // thinking shape.
    expect(params.tool_choice).toEqual({ type: "tool", name: "record_document_kind" });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(body.largeDocument).toBe(true);
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

  it("refuses a scanned PDF with no call", async () => {
    const { buildPdf } = await import("../fixtures/build-pdf.mjs");
    stored.bytes = buildPdf([{ image: true }]);
    const { body } = await classify();
    expect(body).toMatchObject({ ok: true, charged: false });
    expect(typeof body.unsupported).toBe("string");
    expect(create).not.toHaveBeenCalled();
  });
});
