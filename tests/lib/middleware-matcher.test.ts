// Which paths the middleware runs on, decided by NEXT'S OWN matcher compiler
// (audit A13, 2026-11-06).
//
// The exclusions in `config.matcher` were prefixes inside a negative lookahead,
// while the comment beside them claimed "EXACTLY this path". So a future
// `/api/cronjobs`, `/api/queuesadmin`, `/api/graph/notifications-admin` or
// `/login-as` would have been PUBLIC: no session, no writer check, nothing.
// The polarity of this file (default protected, explicitly public) is only as
// good as the anchors on the exceptions.
//
// The table is run through `getMiddlewareMatchers` and
// `getMiddlewareRouteMatcher`, the two functions Next itself uses at build and
// at request time, so this is the matcher as deployed rather than a regex this
// test wrote to resemble it.
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { config } from "@/middleware";

// Exported at runtime and absent from Next's typings, hence the cast.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => Parameters<typeof getMiddlewareRouteMatcher>[0];
};
const runs = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
const protectedPath = (pathname: string) => runs(pathname, {} as never, {});

const PUBLIC = [
  "/login",
  "/api/auth/login",
  "/api/cron/graph-delta",
  "/api/cron/graph-renew",
  "/api/cron/sweep-reads",
  "/api/queues/extraction",
  "/api/graph/notifications",
  "/_next/static/chunks/main.js",
  "/_next/image",
  "/favicon.ico",
];

const PROTECTED = [
  "/",
  "/dashboard",
  "/dashboard/projects/1",
  "/api/projects",
  "/api/auth/logout",
  "/api/auth/me",
  // The ones a prefix let through.
  "/api/cronjobs",
  "/api/cron",
  "/api/queuesadmin",
  "/api/graph/notifications-admin",
  "/api/graph/notifications/replay",
  "/api/graph/subscriptions",
  "/login-as",
  "/loginhelp",
  "/api/auth/login-as",
  "/api/auth/loginas",
  "/favicon.ico.php",
];

describe("the middleware matcher", () => {
  it.each(PUBLIC)("leaves %s public, deliberately", (pathname) => {
    expect(protectedPath(pathname)).toBe(false);
  });

  it.each(PROTECTED)("protects %s", (pathname) => {
    expect(protectedPath(pathname)).toBe(true);
  });
});
