// Next.js `cookies()` wrapper around the session token helpers in auth.ts.
// Route Handlers use this; middleware.ts reads/verifies the cookie directly
// (via auth.ts) since next/headers cookies() isn't writable there.
//
// ============================================================================
// THE ROW DECIDES, ON EVERY REQUEST (audit A4, 2026-11-06).
//
// `getSessionUser` used to return what the token said and never touch
// `users`, so a deactivated account, a demoted editor and a signed-out session
// all went on working until the token expired a week later. It now reads the
// user's row (one primary-key read) and refuses the token unless the row is
// active and its `token_version` is the one the token carries. The role,
// name and email it returns are the ROW'S.
//
// NOTHING IS CACHED, and that is the point rather than an oversight. A cache
// of "this token is fine" for even a few minutes is the seven-day window
// again at a smaller size: the demotion, the deactivation and the sign-out
// would each wait for it to expire. One indexed read per request is the price.
//
// Renewal happens here too, because this is the one place that can both see
// the row and write a cookie: a token past half its life, or one whose role
// the row no longer agrees with, is answered with a fresh one.
// ============================================================================
import { cookies } from "next/headers";
import { sql } from "./db";
import {
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  makeSessionToken,
  shouldRenew,
  verifySessionToken,
  type SessionClaims,
  type SessionUser,
} from "./auth";

type UserRow = { id: string; email: string; name: string; role: string; active: boolean; token_version: number };

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const rows = (await sql`
    select id, email, name, role, active, token_version from users where id = ${claims.id}
  `) as UserRow[];
  const row = rows[0];
  if (!row || !row.active || Number(row.token_version) !== claims.tokenVersion) return null;

  const user: SessionUser = { id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role) };
  if (shouldRenew(claims, user, Math.floor(Date.now() / 1000))) {
    try {
      await setSessionCookie(await makeSessionToken({ ...user, tokenVersion: claims.tokenVersion }));
    } catch {
      // A cookie cannot be written from a server component. The session is
      // still valid; it is renewed on the next route handler that reads it.
    }
  }
  return user;
}

/**
 * Ends every session this user holds, on every device, by moving the row past
 * the version their tokens carry. Predicated on the version the token showed,
 * so two sign-outs at once move it once and neither fails.
 */
export async function endAllSessions(claims: SessionClaims): Promise<void> {
  await sql`
    update users set token_version = token_version + 1
    where id = ${claims.id} and token_version = ${claims.tokenVersion}
  `;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
