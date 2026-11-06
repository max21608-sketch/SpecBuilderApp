// The wrapper exists because every client call site did `await res.json()`
// before testing res.ok, which throws on the HTML error pages Vercel returns
// for a 500/504 -- leaving busy flags stuck and turning failures into silently
// empty UI. These cases are exactly the ones that used to throw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, SESSION_EXPIRED_EVENT } from "@/lib/api-fetch";

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

  // AUDIT G4 (2026-11-06). A 2xx whose body was not a JSON object used to be
  // `{ ok: true, data: {} }`, so a screen did `res.data.batches.find` (an
  // unhandled rejection) or `setData({})` and crashed on `data.record.parent_id`.
  it("refuses a 2xx whose body is empty", async () => {
    stub(new Response("", { status: 200 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("The server answered with something that is not data (status 200).");
  });

  it("refuses a 2xx whose body is an HTML page", async () => {
    stub(new Response("<html><body>Sign in</body></html>", { status: 200 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not data \(status 200\)/);
  });

  it("refuses a 2xx whose body is JSON but not an object", async () => {
    stub(new Response("[1,2]", { status: 200 }));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
  });

  // AUDIT G11. The middleware answers an expired session with a 401 whose
  // body says "auth required", and the body's words beat the friendly
  // fallback, so a person read "auth required" with no way to sign in.
  it("says an expired session in words and where to sign in again", async () => {
    stub(new Response(JSON.stringify({ ok: false, error: "auth required" }), { status: 401 }));
    // The pure tier has no DOM: a window that knows its address and records
    // what is dispatched on it is all apiFetch reads.
    const heard: unknown[] = [];
    vi.stubGlobal("window", {
      location: { pathname: "/dashboard/records/rec-1", search: "?tab=checklist" },
      dispatchEvent: (event: Event) => {
        if (event.type === SESSION_EXPIRED_EVENT) heard.push((event as CustomEvent).detail);
        return true;
      },
    });
    const res = await apiFetch("/api/records/rec-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Your session has expired. Sign in again.");
      expect(res.signIn).toBe("/login?from=%2Fdashboard%2Frecords%2Frec-1%3Ftab%3Dchecklist");
    }
    expect(heard).toEqual([{ signIn: "/login?from=%2Fdashboard%2Frecords%2Frec-1%3Ftab%3Dchecklist" }]);
  });

  it("leaves a wrong password a wrong password", async () => {
    stub(new Response(JSON.stringify({ ok: false, error: "incorrect email or password" }), { status: 401 }));
    const res = await apiFetch("/api/auth/login", { method: "POST" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("incorrect email or password");
      expect(res.signIn).toBeUndefined();
    }
  });
});

