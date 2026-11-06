// ============================================================================
// TWO CHECKS EVERY ROUTE HANDLER RUNS ITSELF (audit A16, A13, 2026-11-06).
//
// THE WRITE BOUNDARY WAS NOT THE AUTHORISATION BOUNDARY. `WRITER_ROLES` was
// enforced only by the middleware's matcher, whose exceptions were prefixes
// (A13), and no handler ever asked for a role: every mutating route trusted
// that the request had passed a regex it could not see. The middleware is the
// first line and stays; `requireWriter` is the second, at the top of EVERY
// write handler, so a matcher mistake or a route reached some other way does
// not hand a view-only account a write. `tests/lib/route-guards.test.ts` reads
// every route file and fails on a write handler that does not call it.
//
// A PATH ID WENT STRAIGHT INTO SQL. Thirty-five dynamic routes passed `[id]`
// to a `uuid` column, so `/api/records/abc` was a driver error and a bodyless,
// non-JSON 500 (`invalid input syntax for type uuid`). `requireUuid` answers
// 400 in words before any query runs.
//
// Both return a Response to send, or null to carry on, so a call site reads
// `const denied = requireWriter(user); if (denied) return denied;`. A leaf: no
// database, no session, so the pure tier can test it.
// ============================================================================
import { isWriterRole } from "./roles";

function refuse(status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ ok: false, code, error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A session that may write, or the refusal to send. A signed-out request is a 401, a view-only one a 403. */
export function requireWriter(user: { role: string } | null | undefined): Response | null {
  if (!user) return refuse(401, "auth_required", "Sign in again to make this change.");
  if (!isWriterRole(user.role)) {
    return refuse(403, "view_only", "This is a view-only account, so it cannot change anything here.");
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Every id a path names, checked before any of them reaches SQL. */
export function requireUuid(...ids: string[]): Response | null {
  return ids.every(isUuid)
    ? null
    : refuse(400, "not_an_id", "That address does not point at anything in this app. Check the link and try again.");
}
