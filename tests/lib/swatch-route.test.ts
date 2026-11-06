// The swatch route: a picture is what the STORE says it is, never what the
// browser declared.
//
// ============================================================================
// AUDIT A2 (2026-11-06). The POST stored the request's `contentType` verbatim
// and the GET served it back `inline`. An editor could upload a .csv whose body
// is a script, attach it as a swatch with `contentType: "text/html"`, and
// anybody opening the swatch then ran that script on the app's own origin as
// themselves: `nosniff` does nothing when the declared type is already HTML.
//
// AUDIT A15. The pathname was scope-checked and never asked about, so the row
// could point at nothing, with a size and a type the browser made up.
//
// What is proved, route handler in hand, with the store and the database
// stubbed (the shape of each call is what is asserted):
//   - the type and the size written are the STORE's;
//   - a type that is not a picture is refused, and nothing is written;
//   - a pathname the store has never heard of is refused, nothing written;
//   - a row ALREADY holding a non-picture type is served as a download,
//     never inline, because rows written before the fix still exist.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";

const FINISH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROJECT = "11111111-2222-4333-8444-555555555555";

const state = vi.hoisted(() => ({
  stored: null as { size: number; contentType: string } | null,
  servedRow: null as Record<string, unknown> | null,
  inserts: [] as unknown[][],
}));

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "__qa@example.test", name: "QA", role: "editor" }),
}));

vi.mock("@/lib/db", () => ({
  sql: async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("join attachments")) return state.servedRow ? [state.servedRow] : [];
    return [{ project_id: PROJECT }];
  },
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

vi.mock("@/lib/db-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-transaction")>();
  return {
    ...actual,
    withTransaction: async <T,>(fn: (txn: unknown) => Promise<T>) =>
      fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        if (text.includes("from project_finishes")) return [{ id: FINISH, project_id: PROJECT, code: "FAB-01" }];
        if (text.includes("insert into attachments")) state.inserts.push(values);
        return [];
      }),
  };
});

vi.mock("@/lib/change-sets", () => ({ openChangeSet: async () => "cs" }));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    headTrustedBlob: async (pathname: string, projectId: string) => {
      const scoped = actual.assertProjectScopedPathname(pathname, projectId);
      if (!state.stored) throw new actual.UntrustedBlobError("That upload could not be found in the document store.");
      return { pathname: scoped, ...state.stored };
    },
    streamTrustedBlob: async () => ({
      stream: new ReadableStream({ start: (c) => c.close() }),
      headers: { get: () => null },
      contentType: "application/octet-stream",
      size: 0,
    }),
  };
});

const { GET, POST } = await import("@/app/api/finishes/[id]/swatch/route");

const params = { params: Promise.resolve({ id: FINISH }) };
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), params);
const pathname = `projects/${PROJECT}/finish-swatches/1730900000000-swatch.png`;

beforeEach(() => {
  state.stored = null;
  state.servedRow = null;
  state.inserts = [];
});

describe("POST a swatch", () => {
  it("writes the STORE's type and size, whatever the browser declared", async () => {
    state.stored = { size: 4321, contentType: "image/png" };
    const response = await post({ pathname, contentType: "text/html", size: 9, source: "p.3" });
    expect(response.status).toBe(200);
    expect(state.inserts).toHaveLength(1);
    const values = state.inserts[0]!;
    expect(values).toContain("image/png");
    expect(values).toContain(4321);
    expect(values).not.toContain("text/html");
    expect(values).not.toContain(9);
  });

  it("refuses a file the store says is not a picture, and writes nothing", async () => {
    state.stored = { size: 120, contentType: "text/html" };
    const response = await post({ pathname, contentType: "image/png", source: "p.3" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/not a picture/i);
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a pathname the store never received, and writes nothing", async () => {
    state.stored = null;
    const response = await post({ pathname, source: "p.3" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/never reached/i);
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a picture larger than a swatch can be", async () => {
    state.stored = { size: 64 * 1024 * 1024, contentType: "image/png" };
    const response = await post({ pathname, source: "p.3" });
    expect(response.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });
});

describe("GET a swatch", () => {
  it("serves a picture inline", async () => {
    state.servedRow = { project_id: PROJECT, storage_path: pathname, content_type: "image/jpeg" };
    const response = await GET(new Request("http://localhost/x"), params);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toMatch(/^inline/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  // A row written before the fix still holds whatever the browser declared.
  it("serves a stored NON-picture type as a download of plain bytes, never inline", async () => {
    state.servedRow = { project_id: PROJECT, storage_path: pathname, content_type: "text/html" };
    const response = await GET(new Request("http://localhost/x"), params);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
