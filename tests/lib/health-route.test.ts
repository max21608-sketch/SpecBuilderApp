// GET /api/health: public, so it says three things and nothing else
// (production hardening H4, 2026-11-20). The driver is stubbed here so the
// three outcomes — answered, refused, hung — are each reachable;
// `tests/db/health-route.test.ts` asks a real database.
//
// AND A MISCONFIGURED DEPLOYMENT IS NOT HEALTHY (pre-push review E3): with no
// usable AUTH_SECRET every other request answers 503
// `environment_misconfigured`, and health said 200 {"ok":true} — the go-live
// proof `docs/environments.md` names. It now asks the same question first and
// answers the problem's CODE, nothing else. `src/lib/env.ts` caches its
// answer, so every case loads a fresh route (`vi.resetModules`) under the
// environment it names, as `tests/lib/env.test.ts` does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  mode: "answer" as "answer" | "throw" | "hang",
  statements: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray) => {
    db.statements.push(strings.join("?"));
    if (db.mode === "throw") {
      return Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED ep-secret-host.eu-west-2.aws.neon.tech:5432"), {
          name: "NeonDbError",
        }),
      );
    }
    if (db.mode === "hang") return new Promise(() => {});
    return Promise.resolve([{ "?column?": 1 }]);
  },
}));

const KEYS = ["VERCEL_GIT_COMMIT_SHA", "APP_ENV", "DATABASE_ENVIRONMENT", "AUTH_SECRET"] as const;

/** A secret long enough for production; never a real one. */
const GOOD_SECRET = "__qa-health-test-secret-0123456789abcdef0123456789";

let saved: Record<string, string | undefined>;
let logged: string[];

/** A fresh route under this environment; `null` unsets a variable. */
async function routeUnder(env: { APP_ENV: string | null; DATABASE_ENVIRONMENT: string | null; AUTH_SECRET: string | null }) {
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return (await import("@/app/api/health/route")).GET;
}

/** A well-configured development build, as the stack and CI run. */
const routeFine = () => routeUnder({ APP_ENV: "development", DATABASE_ENVIRONMENT: "sandbox", AUTH_SECRET: GOOD_SECRET });

let GET: () => Promise<Response>;

beforeEach(async () => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  db.mode = "answer";
  db.statements = [];
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  GET = await routeFine();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("answers 200 with the commit when the database answers select 1", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "7b8eb4b0000000000000000000000000000000aa";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, commit: "7b8eb4b0000000000000000000000000000000aa" });
    expect(db.statements).toEqual(["select 1"]);
  });

  it("says null for the commit off Vercel, which is the honest answer", async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const res = await GET();
    expect(await res.json()).toEqual({ ok: true, commit: null });
  });

  it("answers 503 {ok:false} and nothing else when the database refuses", async () => {
    db.mode = "throw";
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false });
    // No host, no driver text, no environment name.
    expect(text).not.toMatch(/neon|ECONNREFUSED|sandbox|pilot|staging|production/i);
    // The log holds the cause under a reference instead.
    expect(logged.join("\n")).toMatch(/\[health\] failure [0-9a-f]{8}/);
  });

  it("answers 503 when the database does not answer within the timeout, rather than hanging", async () => {
    vi.useFakeTimers();
    db.mode = "hang";
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("is never cached, by a browser or a CDN", async () => {
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
    db.mode = "throw";
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/health on a misconfigured deployment (E3)", () => {
  it("answers 503 naming the code when production has no AUTH_SECRET, and never asks the database", async () => {
    const health = await routeUnder({ APP_ENV: "production", DATABASE_ENVIRONMENT: "production", AUTH_SECRET: null });
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, problem: "session_secret_misconfigured" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(db.statements).toEqual([]);
  });

  it("names the same code for a short secret, and never the secret, its length or any value", async () => {
    const short = "__qa-short-secret";
    const health = await routeUnder({ APP_ENV: "production", DATABASE_ENVIRONMENT: "production", AUTH_SECRET: short });
    const res = await health();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, problem: "session_secret_misconfigured" });
    expect(text).not.toContain(short);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/AUTH_SECRET|shorter|production/i);
  });

  it("answers 503 environment_misconfigured when APP_ENV and DATABASE_ENVIRONMENT disagree", async () => {
    const health = await routeUnder({ APP_ENV: "pilot", DATABASE_ENVIRONMENT: "sandbox", AUTH_SECRET: GOOD_SECRET });
    const res = await health();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, problem: "environment_misconfigured" });
    expect(text).not.toMatch(/pilot|sandbox|APP_ENV|DATABASE_ENVIRONMENT/);
    expect(db.statements).toEqual([]);
  });

  it("answers 200 on a production build with a full-length secret and a database that answers", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "7b8eb4b0000000000000000000000000000000aa";
    const health = await routeUnder({ APP_ENV: "production", DATABASE_ENVIRONMENT: "production", AUTH_SECRET: GOOD_SECRET });
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, commit: "7b8eb4b0000000000000000000000000000000aa" });
  });
});
