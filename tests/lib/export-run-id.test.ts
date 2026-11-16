// The phase an export names is checked before it reaches SQL (review
// 2026-11-16, item 1.2).
//
// `?runId=abc` and `?runId=` reached a `::uuid` cast and came back as a
// bodyless 500, and `?runId=A&runId=B` silently exported the first phase —
// a scope nobody asked for, on the one file whose import replaces. All four
// outputs read the scope, so all four are held to it here.
import { describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const RUN_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RUN_B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "__qa@example.test", name: "QA", role: "viewer" }),
}));

// Nothing below may reach the database: every case is refused first.
vi.mock("@/lib/db-transaction", () => ({
  withTransaction: async () => {
    throw new Error("the scope was loaded for a request that should have been refused");
  },
}));
vi.mock("@/lib/db", () => ({
  sql: async () => {
    throw new Error("a query ran for a request that should have been refused");
  },
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

const routes = {
  export: (await import("@/app/api/projects/[id]/export/route")).GET,
  quote: (await import("@/app/api/projects/[id]/export/quote/route")).GET,
  costing: (await import("@/app/api/projects/[id]/export/costing/route")).GET,
  "check sheet": (await import("@/app/api/projects/[id]/export/check-sheet/route")).GET,
};

const cases: Array<[string, string, RegExp]> = [
  ["a runId that is not an id", "runId=abc", /does not name a phase/],
  ["an empty runId", "runId=", /does not name a phase/],
  ["a repeated runId", `runId=${RUN_A}&runId=${RUN_B}`, /more than one phase/],
];

describe.each(Object.entries(routes))("the %s route", (_name, GET) => {
  it.each(cases)("refuses %s with a 400 in words", async (_label, query, words) => {
    const response = await GET(new Request(`http://localhost/api/projects/${PROJECT}/export?${query}`), {
      params: Promise.resolve({ id: PROJECT }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(words);
  });

  it("still refuses a parameter it does not accept", async () => {
    const response = await GET(new Request(`http://localhost/api/projects/${PROJECT}/export?category=x`), {
      params: Promise.resolve({ id: PROJECT }),
    });
    expect(response.status).toBe(400);
  });
});
