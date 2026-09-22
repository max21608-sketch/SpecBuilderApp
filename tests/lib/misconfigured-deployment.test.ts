// What the app does on a deployment whose APP_ENV and DATABASE_ENVIRONMENT
// disagree — at the boundary, and at the one route the boundary cannot cover.
//
// ============================================================================
// WHY THIS TEST EXISTS
//
// `src/lib/env.ts` has said since the scaffold that the pair is enforced "from
// middleware.ts and db.ts at request time", and middleware never imported it.
// The first pilot deployment (2026-09-19) showed what that costs: a signed-out
// person could reach every page, and the first thing they did returned a 500
// with no body. A comment cannot hold this — only a test can.
//
// WHAT IT ALSO HOLDS IS THAT NOTHING ELSE MOVED. The guard runs before the
// session check, so the two unauthenticated behaviours are asserted right
// beside it: an API request is still a 401, a page is still a redirect to
// /login. `WRITER_ROLES` is untouched and stays an allowlist.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const KEYS = ["APP_ENV", "DATABASE_ENVIRONMENT"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

/** A fresh module graph per case: `env.ts` caches its answer deliberately. */
async function load(appEnv: string, databaseEnvironment: string) {
  vi.resetModules();
  process.env.APP_ENV = appEnv;
  process.env.DATABASE_ENVIRONMENT = databaseEnvironment;
  return import("@/middleware");
}

const page = () => new NextRequest(new Request("http://localhost/dashboard/projects"));
const api = () => new NextRequest(new Request("http://localhost/api/projects", { method: "POST" }));

describe("middleware on a misconfigured deployment", () => {
  it("refuses a page with the reason in the body, instead of rendering one", async () => {
    const { middleware } = await load("pilot", "sandbox");
    const res = await middleware(page());
    expect(res.status).toBe(503);
    // NOT a redirect to /login: a sign-in page on a deployment that cannot
    // sign anybody in is the failure this closes.
    expect(res.headers.get("location")).toBeNull();
    const body = await res.text();
    expect(body).toContain("APP_ENV and DATABASE_ENVIRONMENT");
    expect(body).toContain("APP_ENV=pilot");
  });

  it("refuses an API request as JSON, so a screen can print it", async () => {
    const { middleware } = await load("pilot", "sandbox");
    const res = await middleware(api());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("environment_misconfigured");
    expect(body.error).toContain("DATABASE_ENVIRONMENT=sandbox");
  });

  it("withholds the detail on a production build and still refuses", async () => {
    const { middleware } = await load("production", "sandbox");
    const res = await middleware(api());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("DATABASE_ENVIRONMENT=sandbox");
  });
});

describe("middleware when the pair is right", () => {
  it("still 401s an unauthenticated API request", async () => {
    const { middleware } = await load("staging", "sandbox");
    const res = await middleware(api());
    expect(res.status).toBe(401);
  });

  it("still redirects an unauthenticated page to the sign-in page", async () => {
    const { middleware } = await load("staging", "sandbox");
    const res = await middleware(page());
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    // The `from` is what takes somebody back to where they were.
    expect(location).toContain("from=%2Fdashboard%2Fprojects");
  });
});


// ============================================================================
// AND THE ROUTE MIDDLEWARE CANNOT COVER
//
// `/api/auth/login` is excluded from the matcher, because protecting the way in
// locks everybody out — and on a fresh deployment it is also the first thing
// that touches `db.ts`. That is the exact request that answered a bodyless 500
// on the pilot build of 2026-09-19.
// ============================================================================
describe("the sign-in POST on a misconfigured deployment", () => {
  async function signIn(appEnv: string, databaseEnvironment: string) {
    vi.resetModules();
    process.env.APP_ENV = appEnv;
    process.env.DATABASE_ENVIRONMENT = databaseEnvironment;
    const { POST } = await import("@/app/api/auth/login/route");
    return POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "somebody@example.com", password: "__QA wrong" }),
      }),
    );
  }

  it("answers with a sentence, not an empty 500", async () => {
    const res = await signIn("pilot", "sandbox");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("environment_misconfigured");
    // The half that was missing: WHICH of the two variables is wrong. A blank
    // 500 sent somebody to look at the database string, and the database was
    // fine.
    expect(body.error).toContain("APP_ENV=pilot");
    expect(body.error).toContain("DATABASE_ENVIRONMENT=sandbox");
  });

  it("checks the pair before it touches the database at all", async () => {
    // No mock of `verifyCredentials` anywhere in this file: if the guard ran
    // after it, this case would try to connect and fail differently.
    const res = await signIn("staging", "pilot");
    expect(res.status).toBe(503);
  });
});
