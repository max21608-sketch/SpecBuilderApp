// The two session-free entrances compare and reflect safely (audit A14).
//
// The three cron routes compared the Authorization header with `===`, which
// returns at the first differing byte, so response timing leaks how much of a
// guess was right. And the Graph webhook reflected its `validationToken` as a
// response body with no `nosniff` and no length limit: a token is whatever the
// caller put in the query string.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cronAuthorised } from "@/lib/cron-auth";

const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/sweep-reads", authorization ? { headers: { authorization } } : {});

describe("cronAuthorised", () => {
  const SECRET = "a-long-enough-cron-secret-0123456789";

  it("accepts the exact bearer secret", () => {
    expect(cronAuthorised(request(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("refuses a wrong, a shorter, a longer and a missing value", () => {
    for (const header of [`Bearer ${SECRET.slice(0, -1)}x`, `Bearer ${SECRET.slice(1)}`, `Bearer ${SECRET}0`, SECRET, ""]) {
      expect(cronAuthorised(request(header), SECRET), header).toBe(false);
    }
  });

  it("fails closed when no secret is configured, whatever the request says", () => {
    expect(cronAuthorised(request("Bearer "), undefined)).toBe(false);
    expect(cronAuthorised(request("Bearer "), "")).toBe(false);
    expect(cronAuthorised(request("Bearer undefined"), undefined)).toBe(false);
  });

  it("never compares with === (the source is the proof)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const route of ["graph-delta", "graph-renew", "sweep-reads"]) {
      const source = readFileSync(`src/app/api/cron/${route}/route.ts`, "utf8");
      expect(source, route).toContain("cronAuthorised(request)");
      expect(source, route).not.toMatch(/===\s*`Bearer/);
    }
  });
});

describe("the Graph validation handshake", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/graph-client");
  });

  async function handshake(token: string) {
    vi.resetModules();
    vi.doMock("@/lib/graph-client", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/graph-client")>()),
      mailIngestionEnabled: () => true,
    }));
    const { POST } = await import("@/app/api/graph/notifications/route");
    return POST(
      new Request(`http://localhost/api/graph/notifications?validationToken=${encodeURIComponent(token)}`, {
        method: "POST",
      }),
    );
  }

  it("echoes the token as plain text that a browser may not sniff", async () => {
    const response = await handshake("Validation: Token-123");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Validation: Token-123");
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses a token far longer than Graph ever sends", async () => {
    const response = await handshake("x".repeat(5000));
    expect(response.status).toBe(400);
  });
});
