// Route protection: redirect unauthenticated page requests to /login, and 401
// unauthenticated API requests. Also the single enforcement point for write
// authorisation: only roles on WRITER_ROLES may make a mutating API request.
//
// WRITER_ROLES is an ALLOWLIST, not a `role === "viewer"` denylist. The
// denylist version failed open on the fabric-ordering app: any role string the
// deny check did not recognise -- a mis-cased "Viewer", a role added later --
// got full write rights. An allowlist fails closed instead.
//
// Each mutating route handler still re-checks auth itself via getSessionUser().
// This middleware is the first line, not the only line.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Kept in sync with the users_role_check constraint in
// db/migrations/0001_foundation.sql, minus the read-only role. Changing the
// role set means a new migration, not just an edit here.
const WRITER_ROLES = new Set(["admin", "editor"]);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;

  if (user) {
    const { pathname } = req.nextUrl;
    if (
      !WRITER_ROLES.has(user.role) &&
      pathname.startsWith("/api/") &&
      !READ_METHODS.has(req.method) &&
      pathname !== "/api/auth/logout" // view-only accounts must still be able to log out
    ) {
      return NextResponse.json(
        { ok: false, error: "This is a view-only account" },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "auth required" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

// DEFAULT-PROTECTED, explicitly public.
//
// The fabric-ordering app lists every protected prefix instead, which means
// adding a route and forgetting to list it leaves it WIDE OPEN, and nothing
// fails to tell you. Inverting the polarity makes the failure mode "a new
// route is unexpectedly protected", which someone notices immediately and
// which loses no data.
//
// Everything not excluded below requires a session. The exclusions are:
//   _next/*, favicon  - static assets
//   /login, api/auth/login - the way in; protecting these locks everyone out
//   api/queues/*      - queue consumers. They have no session by design and
//                       authenticate with the queue's own signed protocol.
//                       Adding them here would break every background job.
//   api/cron/*        - same, but authenticated with CRON_SECRET.
// Anything added to this list is a deliberate decision to expose a route.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth/login|api/queues|api/cron).*)",
  ],
};
