// The sign-in route: throttled, and its refusals say no more than they must
// (audit A11, A12, 2026-11-06).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string; role: string },
  throws: null as Error | null,
}));

vi.mock("@/lib/auth-node", () => ({
  verifyCredentials: async () => {
    if (state.throws) throw state.throws;
    return state.user;
  },
}));
vi.mock("@/lib/session", () => ({ setSessionCookie: async () => {} }));
vi.mock("@/lib/auth", () => ({ makeSessionToken: async () => "token" }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  environmentProblemMessage: () => null,
}));
vi.mock("@/lib/db", () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

const { POST } = await import("@/app/api/auth/login/route");

let address = 0;
const signIn = (email: string, ip: string) =>
  POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: "wrong" }),
    }),
  );

beforeEach(() => {
  state.user = null;
  state.throws = null;
  address += 1;
});

describe("POST /api/auth/login", () => {
  it("answers 429 with the wait, in words and in Retry-After, after ten failures", async () => {
    const email = `locked${address}@example.test`;
    for (let i = 0; i < 10; i += 1) expect((await signIn(email, `203.0.113.${address}`)).status).toBe(401);
    const locked = await signIn(email, `203.0.113.${address}`);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await locked.json()) as { error: string }).error).toMatch(/Too many sign-in attempts.*Wait/);
  });

  it("refuses a locked email even with the right password, until the minute is up", async () => {
    const email = `right${address}@example.test`;
    for (let i = 0; i < 10; i += 1) await signIn(email, `198.51.100.${address}`);
    state.user = { id: "u", email, name: "U", role: "editor" };
    expect((await signIn(email, `198.51.100.${address}`)).status).toBe(429);
  });
});

describe("POST /api/auth/login when the database cannot be reached", () => {
  it("on pilot, says so with a reference and never the driver's message", async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "pilot";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.throws = Object.assign(new Error("connect ECONNREFUSED ep-secret-host.neon.tech:5432"), {
      name: "NeonDbError",
    });
    try {
      const response = await signIn(`down${address}@example.test`, `192.0.2.${address}`);
      expect(response.status).toBe(503);
      const { error } = (await response.json()) as { error: string };
      expect(error).toMatch(/could not reach the database.*Reference [0-9a-f]{8}/);
      expect(error).not.toContain("ep-secret-host");
    } finally {
      spy.mockRestore();
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });
});
