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
//
// IT ALSO ENFORCES THE ENVIRONMENT PAIR, which `src/lib/env.ts` has claimed
// since the scaffold and which this file never did. The consequence was
// measured on the first pilot deployment (2026-09-19): APP_ENV is read
// non-throwingly for the chip and the title, the session check touches no
// database, and the pair was therefore checked only when `db.ts` was first
// called — the login POST. A deployment with APP_ENV=pilot against the sandbox
// database looked healthy on every page a signed-out person could reach and
// died at the first thing they did, with a bodyless 500.
//
// The check is two environment variables compared, which is all it needs and
// all it may be: NOTHING HERE MAY IMPORT THE DATABASE DRIVER. Middleware runs
// on the edge runtime and `src/lib/env.ts` is edge-safe on purpose.
//
// It is a deliberate 503 with the reason in it, never a throw: a throw here is
// the bodyless 500 again, one layer further out.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { environmentProblemMessage } from "@/lib/env";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Kept in sync with the users_role_check constraint in
// db/migrations/0001_foundation.sql, minus the read-only role. Changing the
// role set means a new migration, not just an edit here.
const WRITER_ROLES = new Set(["admin", "editor"]);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // BEFORE THE SESSION CHECK, because a deployment that cannot serve anybody
  // should not first decide who they are. This is the only thing in this
  // function that runs ahead of authorisation, and it can only ever refuse.
  const misconfigured = environmentProblemMessage();
  if (misconfigured) {
    return req.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ ok: false, code: "environment_misconfigured", error: misconfigured }, { status: 503 })
      : new NextResponse(misconfigured, {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
  }

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
//   /login, api/auth/login - the way in; protecting these locks everyone out.
//                       They are therefore the two places the environment
//                       guard above cannot reach, and each asks it itself:
//                       the page renders the reason over the form, and the
//                       route answers 503 rather than a bodyless 500.
//   api/queues/*      - queue consumers. They have no session by design and
//                       authenticate with the queue's own signed protocol.
//                       Adding them here would break every background job.
//   api/cron/*        - same, but authenticated with CRON_SECRET.
//   api/graph/notifications
//                     - Microsoft Graph's change notifications. Graph cannot
//                       carry a session cookie. EXACTLY this path, not a
//                       prefix, so a future api/graph/* admin route stays
//                       protected by default.
//
//                       What replaces the session: a `clientState` secret
//                       compared in constant time against a hash in the
//                       database, a subscription id that has to match a row we
//                       created, and then nothing else from the body being
//                       believed — the message id is validated by shape and
//                       used to FETCH the mail from Graph, so a forged
//                       notification can at worst ask us to re-read an id that
//                       does not exist. The route answers 404 entirely when
//                       MAIL_INGESTION_MODE is not 'enabled'.
// Anything added to this list is a deliberate decision to expose a route.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth/login|api/queues|api/cron|api/graph/notifications).*)",
  ],
};
