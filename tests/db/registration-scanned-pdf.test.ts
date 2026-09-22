// Registering a scanned PDF, and the read it must not spend.
//
// ============================================================================
// FIU 2026-09-21. `pdfHasTextLayer` and `scannedPdfRefusal` have existed since
// 91360b6 and the CLASSIFY route asks them before the model. REGISTRATION did
// not — and classify is not on the path when somebody DECLARES the kind, which
// is the held row's dropdown, a second press after an unclear answer, and
// anything registering without the upload screen. So a hand-declared kind on an
// image-only PDF opened an attempt and spent the read: four minutes of the
// model looking at pictures of pages, at full price, for a review screen with
// nothing on it.
//
// WHAT THIS FILE PROVES, and why it is the database tier rather than a pure
// one. `scannedPdfRefusal` is already covered pure, on both readings and on the
// null that proceeds. What was uncovered is that REGISTRATION ASKS IT — and
// asking is only half of it: the refusal has to happen before a row is
// inserted, before an attempt is opened and before anything is published,
// because each of those is a way the charge happens anyway. Only the route
// against a real database can say that, and it says it by counting rows.
//
// NO MODEL IS CALLED HERE, on either path. `@/lib/anthropic` and the queue are
// both stubbed and the stubs are ASSERTED unused, which is the point of the
// test rather than a precaution around it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
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

// The document never leaves this file, and which document it is changes per
// test — a scanned page, a compressed real one, a codec nothing decodes.
const stored: { bytes: Buffer } = { bytes: Buffer.from("__QA") };

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
    headTrustedBlob: async (pathname: string) => ({
      pathname,
      contentType: "application/pdf",
      size: stored.bytes.length,
    }),
  };
});

// STUBBED AND ASSERTED UNUSED. A charged read is real money; this suite must
// never be able to spend one even if the refusal it is testing is deleted.
const modelCalls: unknown[] = [];
vi.mock("@/lib/anthropic", () => ({
  EXTRACTION_MODEL: "__qa-model",
  extractSpecDocument: async (...args: unknown[]) => {
    modelCalls.push(args);
    throw new Error("__QA the model must not be called from a registration test");
  },
}));

const published: unknown[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: unknown, key: string) => {
      published.push({ message, key });
    },
  };
});

describeIfDb("registering a scanned PDF", () => {
  let projectId = "";
  const number = qaNumber("P90041");

  beforeAll(async () => {
    const { sql } = await import("@/lib/db");
    const rows = await sql`
      insert into projects (name, bws_project_number, created_by, updated_by)
      values (${`__QA ${number}`}, ${`__QA ${number}`}, '__qa@example.test', '__qa@example.test')
      returning id
    `;
    projectId = String(rows[0]!.id);
  });

  afterAll(async () => {
    const { sql } = await import("@/lib/db");
    if (projectId) await sql`delete from projects where id = ${projectId}`;
  });

  async function register(filename: string) {
    const { POST } = await import("@/app/api/imports/route");
    return POST(
      new Request("http://localhost/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          importType: "spec_document",
          documentKind: "shop_drawings",
          pathname: `projects/${projectId}/${filename}`,
          filename,
          contentType: "application/pdf",
        }),
      }),
    );
  }

  async function runCount() {
    const { sql } = await import("@/lib/db");
    const rows = await sql`select count(*)::int as n from intake_runs where project_id = ${projectId}`;
    return Number(rows[0]!.n);
  }

  it("refuses it, and registers nothing at all", async () => {
    stored.bytes = buildPdf([{ image: true }, { image: true }]);
    modelCalls.length = 0;
    published.length = 0;

    const res = await register("__QA scanned drawings.pdf");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/scanned document/);
    expect(body.error).toMatch(/OCR/);

    // THE THREE WAYS THE CHARGE HAPPENS ANYWAY, each one closed. No run means
    // no attempt and nothing for *Read all* to pick up later; no publish means
    // no worker; no model call means no money.
    expect(await runCount()).toBe(0);
    expect(published).toEqual([]);
    expect(modelCalls).toEqual([]);
  });

  it("registers a real drawing whose text is inside a COMPRESSED stream", async () => {
    // The naive test — no `Tj` in the raw bytes — calls this scanned, and every
    // real exporter writes it. Refusing it would be a document nobody can get
    // into the app at all, which is the more expensive mistake.
    stored.bytes = buildPdf([{ compress: true, label: "__QA S-100 ARMCHAIR" }]);
    const res = await register("__QA real drawings.pdf");
    expect(res.status).toBe(201);
    expect(await runCount()).toBe(1);
  });

  it("PROCEEDS on a stream it cannot decode, because that is not a measurement", async () => {
    // `LZWDecode`: the content stream is unreadable rather than absent, so
    // `pdfHasTextLayer` answers null and null must behave exactly as a text
    // layer does. Certain or proceed.
    stored.bytes = buildPdf([{ contentFilter: "/LZWDecode", label: "__QA undecodable" }]);
    const res = await register("__QA undecodable.pdf");
    expect(res.status).toBe(201);
    expect(await runCount()).toBe(2);
  });
});
