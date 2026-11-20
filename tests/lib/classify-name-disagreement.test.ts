// The name and the model disagree about what a file is (prod-ready K1,
// 2026-11-20), the classify route in hand.
//
// THE DEFECT. A clean bill — Ref / Location / Description / Unit / Qty, no
// price columns — named "… Bill of Quantities.xlsx" showed "Bill of
// quantities" in its box; the press asked the model, the model answered an
// FF&E schedule, and the file was filed as one and READ: a charged read, no
// records, no question asked. Proved here: where the two disagree the file is
// HELD with both readings and no decision; where they agree, or the name
// abstains, the answer is exactly as before.
//
// NO MODEL IS CALLED: the SDK's `messages` is stubbed, as in classify-route.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdfOfPages } from "../fixtures/build-pdf.mjs";
import { twoRowHeaderWorkbook } from "../fixtures/build-boq";
import { guessKindFromName, nameModelDisagreement } from "@/lib/document-name-guess";
import { KIND_FROM_GENRE } from "@/lib/document-kinds";

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
  stored.bytes = buildPdfOfPages(2);
  stored.contentType = "application/pdf";
});

async function classify(filename: string, contentType = "application/pdf") {
  const { POST } = await import("@/app/api/imports/classify/route");
  const res = await POST(
    new Request("http://localhost/api/imports/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT, pathname: `projects/${PROJECT}/uploads/${filename}`, filename, contentType }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function answers(genre: string, evidence = "a table of items with finishes") {
  create.mockResolvedValue({
    content: [{ type: "tool_use", id: "t1", name: "record_document_kind", input: { genre, titleText: null, evidence, certain: true } }],
    stop_reason: "tool_use",
  });
}

describe("nameModelDisagreement", () => {
  it("names both readings where they file differently", () => {
    expect(
      nameModelDisagreement(guessKindFromName("NPI Bill of Quantities.xlsx"), {
        genre: "ffe_schedule",
        decision: KIND_FROM_GENRE.ffe_schedule,
      }),
    ).toBe("The name says Bill of quantities; the model reads an FF&E schedule — which is it?");
  });
  it("is silent where they file the same, or either abstains", () => {
    const sheets = guessKindFromName("SPEC-346-Seating - S-100 - Sofa.pdf");
    expect(nameModelDisagreement(sheets, { genre: "shop_drawings", decision: KIND_FROM_GENRE.shop_drawings })).toBeNull();
    expect(nameModelDisagreement(null, { genre: "ffe_schedule", decision: KIND_FROM_GENRE.ffe_schedule })).toBeNull();
    expect(nameModelDisagreement(sheets, { genre: "unclear", decision: null })).toBeNull();
  });
});

describe("the classify route", () => {
  it("HOLDS a bill named as a bill that the model reads as an FF&E schedule, deciding nothing", async () => {
    stored.bytes = await twoRowHeaderWorkbook();
    stored.contentType = XLSX;
    answers("ffe_schedule");
    const { status, body } = await classify("NPI-HHH Phase 2 Bill of Quantities.xlsx", XLSX);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      decision: null,
      held: "The name says Bill of quantities; the model reads an FF&E schedule — which is it?",
      modelDecision: { importType: "spec_document", documentKind: "ffe_schedule" },
      evidence: "a table of items with finishes",
      charged: true,
    });
  });

  it("holds a PDF whose name says a finishes schedule and whose pages read as FF&E", async () => {
    answers("ffe_schedule");
    const { body } = await classify("Finishes schedule rev C.pdf");
    expect(body.decision).toBeNull();
    expect(body.held).toBe("The name says Finishes schedule; the model reads an FF&E schedule — which is it?");
  });

  it("answers as before where they agree, or the name says nothing", async () => {
    answers("shop_drawings");
    expect((await classify("SPEC-346-Seating - S-100 - Sofa.pdf")).body).toMatchObject({
      decision: { importType: "spec_document", documentKind: "shop_drawings" },
    });
    answers("ffe_schedule");
    const plain = (await classify("S-100.pdf")).body;
    expect(plain.decision).toEqual({ importType: "spec_document", documentKind: "ffe_schedule" });
    expect(plain.held).toBeUndefined();
  });
});
