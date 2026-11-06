// The source document route, for the reviewer (audit A6, A10, 2026-11-06).
//
// A6: a document named with any character above U+00FF (`Ronnie Scott’s –
// Drawings.pdf`) made `new Headers` throw, which the route's catch turned into
// a 502, so the document could never be opened and every page link was dead.
//
// A10: the route set no `nosniff`, and served an EMAIL run's `.eml` inline as
// `message/rfc822`. CLAUDE.md says an `.eml` body is never rendered: it is
// untrusted HTML a stranger wrote. It is a download here (not a 404, because
// every provenance link to an email-sourced spec comes through this route).
import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROJECT = "11111111-2222-4333-8444-555555555555";

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "__qa@example.test", name: "QA", role: "viewer" }),
}));

vi.mock("@/lib/db", () => ({
  sql: async () => (state.row ? [state.row] : []),
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    streamTrustedBlob: async () => ({
      stream: new ReadableStream({ start: (c) => c.close() }),
      headers: { get: () => null },
      contentType: "application/pdf",
      size: 0,
    }),
  };
});

const { GET } = await import("@/app/api/imports/[id]/source/route");
const get = () => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: RUN }) });

beforeEach(() => {
  state.row = null;
});

describe("GET the source document", () => {
  it("opens a document whose name is not Latin-1, inline, with the real name in filename*", async () => {
    state.row = {
      project_id: PROJECT,
      storage_path: `projects/${PROJECT}/Ronnie Scott’s – Drawings.pdf`,
      filename: "Ronnie Scott’s – Drawings.pdf",
      content_type: "application/pdf",
      document_kind: "shop_drawings",
    };
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="Ronnie Scotts - Drawings\.pdf"; filename\*=UTF-8''/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves an email's .eml only as a download, never inline", async () => {
    state.row = {
      project_id: PROJECT,
      storage_path: `projects/${PROJECT}/emails/m.eml`,
      filename: "m.eml",
      content_type: "message/rfc822",
      document_kind: "email",
    };
    const response = await get();
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves a stored type it would not render as plain bytes to download", async () => {
    state.row = {
      project_id: PROJECT,
      storage_path: `projects/${PROJECT}/x.html`,
      filename: "x.html",
      content_type: "text/html",
      document_kind: "shop_drawings",
    };
    const response = await get();
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
