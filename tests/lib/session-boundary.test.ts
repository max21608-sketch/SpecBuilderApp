// The authorisation boundary, driven from outside (audit A4, H3, 2026-11-06).
//
// ============================================================================
// WHY THIS TEST EXISTS
//
// Nothing sent a write as a view-only account and asserted a refusal. The
// allowlist rule (`src/lib/roles.ts`) was a comment and a constant, and a
// session could not be ended: the role lived in a seven-day token, signing
// out deleted one browser's cookie, and the token named no deployment.
//
// So this file signs real tokens and drives the real middleware with them
// (imported as `misconfigured-deployment.test.ts` does), and drives
// `getSessionUser` and the sign-out route with the database row stubbed.
// `tests/db/session-revocation.test.ts` does the same against a real row.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

const SECRET = "__qa-session-boundary-secret-0123456789";
const KEYS = ["APP_ENV", "DATABASE_ENVIRONMENT", "AUTH_SECRET"] as const;
let saved: Record<string, string | undefined>;

// ---- the row and the cookie jar, stubbed --------------------------------
type Row = { id: string; email: string; name: string; role: string; active: boolean; token_version: number };
let row: Row | null = null;
const statements: { text: string; values: unknown[] }[] = [];
const jar = new Map<string, string>();
const sets: { name: string; value: string; maxAge?: number }[] = [];

vi.mock("@/lib/db", () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });
    if (/^\s*select/i.test(text)) return row ? [row] : [];
    if (/^\s*update users/i.test(text)) {
      if (row && values.includes(row.token_version)) row = { ...row, token_version: row.token_version + 1 };
      return [];
    }
    return [];
  },
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: { maxAge?: number } = {}) => {
      jar.set(name, value);
      sets.push({ name, value, maxAge: options.maxAge });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.APP_ENV = "staging";
  process.env.DATABASE_ENVIRONMENT = "sandbox";
  process.env.AUTH_SECRET = SECRET;
  vi.resetModules();
  row = null;
  statements.length = 0;
  jar.clear();
  sets.length = 0;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.useRealTimers();
  vi.resetModules();
});

const USER_ID = "00000000-0000-4000-8000-00000000a4a4";

async function tokenFor(role: string, tokenVersion = 1): Promise<string> {
  const { makeSessionToken } = await import("@/lib/auth");
  return makeSessionToken({ id: USER_ID, email: "__qa@example.test", name: "QA", role, tokenVersion });
}

function request(path: string, method: string, token: string | null): NextRequest {
  const headers = new Headers();
  if (token) headers.set("cookie", `sb_session=${token}`);
  return new NextRequest(new Request(`http://localhost${path}`, { method, headers }));
}

/** NextResponse.next() is a 200 carrying this header; a refusal is not. */
function passedThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("the middleware's write check, with real tokens", () => {
  const cases: { role: string; mayWrite: boolean }[] = [
    { role: "viewer", mayWrite: false },
    // MIS-CASED: the denylist version of this check let it through. The
    // database's CHECK cannot hold a token minted elsewhere to the same rule.
    { role: "Viewer", mayWrite: false },
    { role: "", mayWrite: false },
    { role: "editor", mayWrite: true },
    { role: "admin", mayWrite: true },
  ];

  for (const { role, mayWrite } of cases) {
    it(`lets "${role}" read`, async () => {
      const { middleware } = await import("@/middleware");
      const res = await middleware(request("/api/projects", "GET", await tokenFor(role)));
      expect(passedThrough(res)).toBe(true);
    });

    it(`${mayWrite ? "lets" : "refuses"} "${role}" ${mayWrite ? "" : "to "}write`, async () => {
      const { middleware } = await import("@/middleware");
      const res = await middleware(request("/api/projects", "POST", await tokenFor(role)));
      if (mayWrite) {
        expect(passedThrough(res)).toBe(true);
      } else {
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/view-only/);
      }
    });

    it(`lets "${role}" sign out`, async () => {
      const { middleware } = await import("@/middleware");
      const res = await middleware(request("/api/auth/logout", "POST", await tokenFor(role)));
      expect(passedThrough(res)).toBe(true);
    });
  }

  it("refuses a token signed for another deployment, even on the same secret", async () => {
    // Signed as staging; read on pilot. Before `aud`, this was a pilot session
    // carrying whatever role the sandbox gave it.
    const staging = await tokenFor("admin");
    vi.resetModules();
    process.env.APP_ENV = "pilot";
    process.env.DATABASE_ENVIRONMENT = "pilot";
    const { middleware } = await import("@/middleware");
    const res = await middleware(request("/api/projects", "POST", staging));
    expect(res.status).toBe(401);
    const { verifySessionToken } = await import("@/lib/auth");
    expect(await verifySessionToken(staging)).toBeNull();
  });

  it("refuses a token from before 0053, which carries no version, issuer or audience", async () => {
    const old = await new SignJWT({ email: "__qa@example.test", name: "QA", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(SECRET));
    const { verifySessionToken } = await import("@/lib/auth");
    expect(await verifySessionToken(old)).toBeNull();
    const { middleware } = await import("@/middleware");
    expect((await middleware(request("/api/projects", "GET", old))).status).toBe(401);
  });

  it("refuses a token another app signed on the same secret", async () => {
    const other = await new SignJWT({ email: "__qa@example.test", name: "QA", role: "admin", tv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("fabric-ordering")
      .setAudience("staging")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    const { verifySessionToken } = await import("@/lib/auth");
    expect(await verifySessionToken(other)).toBeNull();
  });

  it("lives a day, not a week", async () => {
    const { verifySessionToken, SESSION_LIFETIME_SECONDS } = await import("@/lib/auth");
    expect(SESSION_LIFETIME_SECONDS).toBe(24 * 60 * 60);
    const token = await tokenFor("editor");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SESSION_LIFETIME_SECONDS + 60) * 1000);
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("getSessionUser reads the user's row on every request", () => {
  function signedIn(token: string): void {
    jar.set("sb_session", token);
  }

  it("refuses a token whose version the row has moved past (signed out elsewhere)", async () => {
    signedIn(await tokenFor("editor", 1));
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "editor", active: true, token_version: 2 };
    const { getSessionUser } = await import("@/lib/session");
    expect(await getSessionUser()).toBeNull();
  });

  it("refuses a deactivated user at once", async () => {
    signedIn(await tokenFor("editor", 1));
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "editor", active: false, token_version: 1 };
    const { getSessionUser } = await import("@/lib/session");
    expect(await getSessionUser()).toBeNull();
  });

  it("refuses a user who no longer exists", async () => {
    signedIn(await tokenFor("editor", 1));
    row = null;
    const { getSessionUser } = await import("@/lib/session");
    expect(await getSessionUser()).toBeNull();
  });

  it("takes the role from the ROW, so a demotion is the next request, and re-issues the cookie", async () => {
    signedIn(await tokenFor("editor", 1));
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "viewer", active: true, token_version: 1 };
    const { getSessionUser } = await import("@/lib/session");
    const user = await getSessionUser();
    expect(user?.role).toBe("viewer");
    const { requireWriter } = await import("@/lib/route-guards");
    expect(requireWriter(user)?.status).toBe(403);
    // The cookie now carries the row's role, so the middleware agrees.
    expect(sets).toHaveLength(1);
    const { verifySessionToken } = await import("@/lib/auth");
    expect((await verifySessionToken(sets[0]!.value))?.role).toBe("viewer");
  });

  it("leaves a fresh, accurate token alone", async () => {
    signedIn(await tokenFor("editor", 1));
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "editor", active: true, token_version: 1 };
    const { getSessionUser } = await import("@/lib/session");
    expect((await getSessionUser())?.role).toBe("editor");
    expect(sets).toEqual([]);
  });

  it("renews a token past half its life, for another full day", async () => {
    signedIn(await tokenFor("editor", 1));
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "editor", active: true, token_version: 1 };
    const { SESSION_RENEW_AFTER_SECONDS, SESSION_LIFETIME_SECONDS } = await import("@/lib/auth");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SESSION_RENEW_AFTER_SECONDS + 60) * 1000);
    const { getSessionUser } = await import("@/lib/session");
    expect((await getSessionUser())?.role).toBe("editor");
    expect(sets).toHaveLength(1);
    expect(sets[0]!.maxAge).toBe(SESSION_LIFETIME_SECONDS);
  });
});

describe("signing out", () => {
  it("bumps the user's token version, which ends every session they hold", async () => {
    const token = await tokenFor("viewer", 3);
    jar.set("sb_session", token);
    row = { id: USER_ID, email: "__qa@example.test", name: "QA", role: "viewer", active: true, token_version: 3 };
    const { POST } = await import("@/app/api/auth/logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(row?.token_version).toBe(4);
    expect(jar.has("sb_session")).toBe(false);

    // A copy of the same cookie, presented again, is no longer a session.
    jar.set("sb_session", token);
    const { getSessionUser } = await import("@/lib/session");
    expect(await getSessionUser()).toBeNull();
  });

  it("still clears this browser's cookie when there is no valid session to end", async () => {
    jar.set("sb_session", "not-a-token");
    const { POST } = await import("@/app/api/auth/logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(jar.has("sb_session")).toBe(false);
    expect(statements.filter((s) => /update users/i.test(s.text))).toEqual([]);
  });
});
