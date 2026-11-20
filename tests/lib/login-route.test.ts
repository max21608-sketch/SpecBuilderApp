// The sign-in route: throttled, and its refusals say no more than they must
// (audit A11, A12, 2026-11-06).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string; role: string },
  throws: null as Error | null,
  tokenThrows: null as Error | null,
}));

vi.mock("@/lib/auth-node", () => ({
  verifyCredentials: async () => {
    if (state.throws) throw state.throws;
    return state.user;
  },
}));
vi.mock("@/lib/session", () => ({ setSessionCookie: async () => {} }));
vi.mock("@/lib/auth", () => ({
  makeSessionToken: async () => {
    if (state.tokenThrows) throw state.tokenThrows;
    return "token";
  },
}));
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
  state.tokenThrows = null;
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

// Review 2.3: any database error used to read "could not reach the database",
// so a missing column before the migrations ran sent somebody to check the
// network. A database that WAS reached and failed says so, names no schema to
// a caller who is not signed in, and is still not the password.
describe("POST /api/auth/login when the database was reached and failed", () => {
  it("says the sign-in failed on the server's side, with a reference, and names no column", async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "pilot";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.throws = Object.assign(new Error('column "token_version" does not exist'), {
      name: "NeonDbError",
      code: "42703",
    });
    try {
      const response = await signIn(`schema${address}@example.test`, `192.0.2.${address + 100}`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { code: string; error: string };
      expect(body.code).toBe("sign_in_failed");
      expect(body.error).toMatch(/failed on the server's side.*not your password.*Reference [0-9a-f]{8}/);
      expect(body.error).not.toMatch(/reach the database/);
      expect(body.error).not.toContain("token_version");
    } finally {
      spy.mockRestore();
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });
});

describe("isDatabaseConnectionFailure", () => {
  it("tells a connection failure from a failure inside a database that answered", async () => {
    const { isDatabaseConnectionFailure } = await import("@/lib/db-transaction");
    const err = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);
    expect(isDatabaseConnectionFailure(err("x", { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseConnectionFailure(err("x", { code: "08006" }))).toBe(true);
    expect(isDatabaseConnectionFailure(err("x", { code: "28P01" }))).toBe(true);
    expect(isDatabaseConnectionFailure(err("Error connecting to database: fetch failed", { name: "NeonDbError" }))).toBe(true);
    expect(isDatabaseConnectionFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isDatabaseConnectionFailure(err("DATABASE_URL is not set"))).toBe(true);
    expect(isDatabaseConnectionFailure(err("x", { name: "NeonDbError", code: "42703" }))).toBe(false);
    expect(isDatabaseConnectionFailure(err("x", { code: "42P01" }))).toBe(false);
    expect(isDatabaseConnectionFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});

// Production hardening H1 (2026-11-20): the token was signed outside the try,
// so a throw there — `auth.ts` throws on a missing AUTH_SECRET — was a
// bodyless 500 for somebody who had typed the RIGHT password.
describe("POST /api/auth/login when the session cannot be signed", () => {
  it("says so in words with a reference, after the right password", async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "pilot";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const email = `token${address}@example.test`;
    state.user = { id: "u", email, name: "U", role: "editor" };
    state.tokenThrows = new Error("AUTH_SECRET missing or too short");
    try {
      const response = await signIn(email, `192.0.2.${address + 150}`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { ok: boolean; code: string; error: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe("sign_in_failed");
      expect(body.error).toMatch(/failed on the server's side.*Reference [0-9a-f]{8}/);
    } finally {
      spy.mockRestore();
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });
});
