// The upload token is issued only for a project this app holds (review 2.6).
// The project id in the client's payload only had to look like a uuid, so a
// file could be stored under a project that does not exist — a blob no
// registration accepts and nothing lists.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ projects: new Set<string>() }));

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u", email: "__qa@example.test", name: "QA", role: "editor" }),
}));
vi.mock("@/lib/db", () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  sql: async (_strings: TemplateStringsArray, ...values: unknown[]) =>
    state.projects.has(String(values[0])) ? [{ id: values[0] }] : [],
}));

const KNOWN = "11111111-2222-4333-8444-555555555555";
const UNKNOWN = "99999999-2222-4333-8444-555555555555";

let savedToken: string | undefined;
beforeAll(() => {
  savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  // The client token is signed locally from this; nothing is sent anywhere.
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_qastore_qasecretqasecretqasecret";
});
afterAll(() => {
  if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
});
beforeEach(() => {
  state.projects = new Set([KNOWN]);
});

const ask = async (projectId: string) => {
  const { POST } = await import("@/app/api/uploads/token/route");
  return POST(
    new Request("http://localhost/api/uploads/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname: `projects/${projectId}/bill.xlsx`, clientPayload: projectId, multipart: false },
      }),
    }),
  );
};

describe("POST /api/uploads/token", () => {
  it("issues a token for a project the app holds", async () => {
    const response = await ask(KNOWN);
    const body = (await response.json()) as { clientToken?: string; error?: string };
    expect(response.status, body.error).toBe(200);
    expect(body.clientToken).toBeTruthy();
  });

  it("refuses, in a sentence, a uuid-shaped id that is no project", async () => {
    const response = await ask(UNKNOWN);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; clientToken?: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.clientToken).toBeUndefined();
    expect(body.error).toMatch(/not in this app/);
  });
});
