// The wrapper exists because every client call site did `await res.json()`
// before testing res.ok, which throws on the HTML error pages Vercel returns
// for a 500/504 -- leaving busy flags stuck and turning failures into silently
// empty UI. These cases are exactly the ones that used to throw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(response: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }));
}

describe("apiFetch", () => {
  it("resolves ok with the parsed body on success", async () => {
    stub(new Response(JSON.stringify({ ok: true, version: 3 }), { status: 200 }));
    const res = await apiFetch<{ version: number }>("/api/x");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.version).toBe(3);
  });

  it("resolves (never throws) when fetch itself rejects", async () => {
    stub(new TypeError("Failed to fetch"));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.error).toMatch(/Could not reach the server/);
    }
  });

  it("resolves with a usable message for a non-JSON error page", async () => {
    stub(new Response("<html><body>An error occurred</body></html>", { status: 500 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/server returned an error \(500\)/);
  });

  it("prefers the server's own error message and keeps the body for conflict details", async () => {
    stub(new Response(JSON.stringify({ ok: false, conflict: true, error: "This draft changed" }), { status: 409 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("This draft changed");
      expect(res.data?.conflict).toBe(true);
    }
  });

  it("treats a 200 carrying ok:false as a failure", async () => {
    stub(new Response(JSON.stringify({ ok: false, error: "nope" }), { status: 200 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
  });
});
