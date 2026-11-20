// A write from another site is refused, driven through the REAL middleware
// with real tokens (production hardening H2, 2026-11-20).
//
// The session cookie is SameSite=Lax, and Lax is decided by SITE: a sibling
// app on the same registrable domain is the same site, so its pages could POST
// to this API with the signed-in person's cookie attached. These cases sign a
// real editor's token, so everything they assert is the cross-site rule and not
// the session check, and they drive `middleware` the way
// `session-boundary.test.ts` does. Which paths the middleware runs on at all is
// `middleware-matcher.test.ts`; the machine routes are outside it, and the
// last case here holds that they stay so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";

const SECRET = "__qa-cross-site-boundary-secret-0123456789";
const KEYS = ["APP_ENV", "DATABASE_ENVIRONMENT", "AUTH_SECRET"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.APP_ENV = "development";
  process.env.DATABASE_ENVIRONMENT = "sandbox";
  process.env.AUTH_SECRET = SECRET;
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

async function editorToken(): Promise<string> {
  const { makeSessionToken } = await import("@/lib/auth");
  return makeSessionToken({
    id: "00000000-0000-4000-8000-0000000000a2",
    email: "__qa@example.test",
    name: "QA",
    role: "editor",
    tokenVersion: 1,
  });
}

function request(
  url: string,
  method: string,
  headers: Record<string, string>,
  token: string | null,
): NextRequest {
  const h = new Headers(headers);
  if (token) h.set("cookie", `sb_session=${token}`);
  return new NextRequest(new Request(url, { method, headers: h }));
}

const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

async function run(url: string, method: string, headers: Record<string, string>, token: string | null = null) {
  const { middleware } = await import("@/middleware");
  return middleware(request(url, method, headers, token ?? (await editorToken())));
}

async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { ok: boolean; code: string; error: string };
  expect(body.ok).toBe(false);
  expect(body.code).toBe("cross_site_refused");
  expect(body.error).toMatch(/another website.*nothing was saved/);
}

const DEV = "http://localhost:3100/api/projects";

describe("a write from the app's own page", () => {
  it("passes on the dev server, localhost:3100", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await run(DEV, method, {
        host: "localhost:3100",
        origin: "http://localhost:3100",
        "sec-fetch-site": "same-origin",
      });
      expect(passedThrough(res), method).toBe(true);
    }
  });

  it("passes on Vercel, where the proxy names the host in x-forwarded-host", async () => {
    const res = await run("https://spec-builder-app.vercel.app/api/projects", "POST", {
      host: "spec-builder-app.vercel.app",
      "x-forwarded-host": "spec-builder-app.vercel.app",
      origin: "https://spec-builder-app.vercel.app",
      "sec-fetch-site": "same-origin",
    });
    expect(passedThrough(res)).toBe(true);
  });

  // The URL's own host is 127.0.0.1 here, so passing proves the Host header
  // was read, and read without regard to case.
  it("compares against the Host header, without regard to case", async () => {
    const res = await run("http://127.0.0.1:3100/api/projects", "POST", {
      host: "LocalHost:3100",
      origin: "http://localhost:3100",
    });
    expect(passedThrough(res)).toBe(true);
  });
});

describe("a write from another site", () => {
  it("is refused from an unrelated origin, in words", async () => {
    await expectRefused(
      await run(DEV, "POST", { host: "localhost:3100", origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
    );
  });

  // The case SameSite=Lax does not stop: a sibling app on the same domain.
  it("is refused from a sibling on the same site", async () => {
    await expectRefused(
      await run("https://spec.example-company.test/api/projects", "POST", {
        host: "spec.example-company.test",
        "x-forwarded-host": "spec.example-company.test",
        origin: "https://other-app.example-company.test",
        "sec-fetch-site": "same-site",
      }),
    );
  });

  it("is refused from the right host on another port", async () => {
    await expectRefused(await run(DEV, "POST", { host: "localhost:3100", origin: "http://localhost:3000" }));
  });

  it("is refused when the proxy's host and the origin disagree, whatever Host says", async () => {
    await expectRefused(
      await run("https://spec-builder-app.vercel.app/api/projects", "PATCH", {
        host: "spec-builder-app.vercel.app",
        "x-forwarded-host": "spec-builder-app.vercel.app",
        origin: "https://spec-builder-pilot.vercel.app",
      }),
    );
  });

  it("is refused on Sec-Fetch-Site: cross-site even with no Origin", async () => {
    await expectRefused(await run(DEV, "DELETE", { host: "localhost:3100", "sec-fetch-site": "cross-site" }));
  });

  it("is refused from an opaque origin (a sandboxed frame, a file: page)", async () => {
    await expectRefused(await run(DEV, "POST", { host: "localhost:3100", origin: "null" }));
  });

  it("is refused before the session is read, so a signed-out forgery is not a 401", async () => {
    const { middleware } = await import("@/middleware");
    await expectRefused(
      await middleware(request(DEV, "POST", { host: "localhost:3100", origin: "https://attacker.example" }, null)),
    );
  });

  it("covers sign-out too, which is a write", async () => {
    await expectRefused(
      await run("http://localhost:3100/api/auth/logout", "POST", {
        host: "localhost:3100",
        origin: "https://attacker.example",
      }),
    );
  });
});

describe("what the rule leaves alone", () => {
  it("a read from another site (CORS decides what it may see, and nothing is changed)", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const res = await run(DEV, method, {
        host: "localhost:3100",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      });
      expect(passedThrough(res), method).toBe(true);
    }
  });

  it("a write with no Origin and no Sec-Fetch-Site — a machine, not a browser", async () => {
    const res = await run(DEV, "POST", { host: "localhost:3100" });
    expect(passedThrough(res)).toBe(true);
  });

  it("a page request, which is not the API", async () => {
    const res = await run("http://localhost:3100/dashboard", "POST", {
      host: "localhost:3100",
      origin: "https://attacker.example",
    });
    expect(res.status).not.toBe(403);
  });

  it("the machine routes, which the middleware never runs on", () => {
    const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
      getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => Parameters<typeof getMiddlewareRouteMatcher>[0];
    };
    return import("@/middleware").then(({ config }) => {
      const runs = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
      for (const path of ["/api/queues/extraction", "/api/cron/graph-delta", "/api/graph/notifications"]) {
        expect(runs(path, {} as never, {}), path).toBe(false);
      }
    });
  });
});
