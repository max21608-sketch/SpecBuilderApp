// GET /api/health against a real database (production hardening H4,
// 2026-11-20): `select 1` through the app's own driver answers, and the body
// is exactly what a person outside may read. The three outcomes with the
// driver stubbed are `tests/lib/health-route.test.ts`.
import { expect, it } from "vitest";
import { describeIfDb } from "./db-tier";

describeIfDb("GET /api/health on a real database", () => {
  it("answers 200 with ok and the commit, and nothing else", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["commit", "ok"]);
    expect(body.ok).toBe(true);
    expect(body.commit).toBe(process.env.VERCEL_GIT_COMMIT_SHA || null);
  });
});
