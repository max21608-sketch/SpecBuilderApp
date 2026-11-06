// Signing out.
//
// It used to delete this browser's cookie and nothing else, so a copy of the
// cookie (another device, a stolen one) went on working for the rest of its
// seven days (audit A4). It now moves the user's `token_version` on, which
// ends EVERY session they hold. A per-device sign-out was not asked for, and
// would need a session table this app does not have.
//
// Not behind `requireWriter`: a view-only account must still be able to sign
// out, and the middleware exempts this route from its write check for the
// same reason (`tests/lib/route-guards.test.ts` lists the exemption).
import { cookies } from "next/headers";
import { json } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { clearSessionCookie, endAllSessions } from "@/lib/session";

export async function POST(): Promise<Response> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  // The cookie goes whatever happens next: this browser asked to be signed out.
  await clearSessionCookie();

  if (claims) {
    try {
      await endAllSessions(claims);
    } catch {
      return json(
        {
          ok: false,
          code: "sessions_not_ended",
          error:
            "You are signed out in this browser, but your other sessions are still open because the database could not be reached. Sign in and sign out again to end them.",
        },
        503,
      );
    }
  }
  return json({ ok: true });
}
