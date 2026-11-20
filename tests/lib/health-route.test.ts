// GET /api/health: public, so it says three things and nothing else
// (production hardening H4, 2026-11-20). The driver is stubbed here so the
// three outcomes — answered, refused, hung — are each reachable;
// `tests/db/health-route.test.ts` asks a real database.
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

const { GET } = await import("@/app/api/health/route");

let savedSha: string | undefined;
let logged: string[];

beforeEach(() => {
  db.mode = "answer";
  db.statements = [];
  savedSha = process.env.VERCEL_GIT_COMMIT_SHA;
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  if (savedSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = savedSha;
  vi.restoreAllMocks();
  vi.useRealTimers();
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
