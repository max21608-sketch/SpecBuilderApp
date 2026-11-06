// Session JWT handling — jose only, no Node built-ins, so this is safe to
// import from middleware.ts (which runs on the Edge runtime). Password
// hashing/verification (which needs node:crypto's scrypt) lives in
// auth-node.ts instead, imported only by route handlers (Node runtime).
//
// ============================================================================
// A SESSION CAN BE ENDED (audit A4, H3, 2026-11-06).
//
// The token used to carry the role for seven days and nothing ever looked
// past it: deactivating somebody, or demoting an editor to a viewer, changed
// nothing until the token ran out; signing out deleted this browser's cookie
// and left a copied one working; and the token named no deployment, so where
// two deployments shared AUTH_SECRET a staging token was a pilot session with
// the sandbox's role in it.
//
// Three claims close it, and each is checked on every read:
//
//   aud = APP_ENV          a token is for ONE deployment kind. Staging's is
//                          refused on pilot even if the secret is shared.
//   iss = "spec-builder"   a token signed by another app on the same secret
//                          (the chassis is copied between apps) is refused.
//   tv  = token_version    `users.token_version` (0053). `getSessionUser`
//                          reads the user's row on every request and refuses
//                          a token whose version is not the row's. Signing
//                          out bumps it, which ends EVERY session that user
//                          holds, on every device.
//
// The life is 24 hours, renewed while somebody is working: a request past
// half-life is answered with a fresh cookie (`shouldRenew`), so a day of use
// never meets the sign-in page and a cookie left alone dies within a day.
//
// THE ROLE IN THE TOKEN IS A HINT FOR THE EDGE, NOT THE AUTHORITY. The
// middleware cannot reach the database, so it refuses a write on the role the
// token carries; every write handler then asks `requireWriter` with the user
// `getSessionUser` read from the ROW, which is what makes a demotion take
// effect on the next request rather than at the next sign-in.
// ============================================================================
import { SignJWT, jwtVerify } from "jose";
import { getEnvironment } from "./env";

// Rename this per app. Two Ben Whistler apps served from the same parent
// domain will otherwise both read and write the same cookie, and whichever
// signed in last wins in both. Use the app slug: "<app>_session".
export const SESSION_COOKIE = "sb_session";

/** Who signed the token. Another app copied from this chassis signs as itself. */
export const SESSION_ISSUER = "spec-builder";

/** How long a token lives without being renewed (Max, 2026-11-06: 24 h, sliding). */
export const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;

/** Past this age a request is answered with a fresh token. */
export const SESSION_RENEW_AFTER_SECONDS = SESSION_LIFETIME_SECONDS / 2;

export type SessionUser = { id: string; email: string; name: string; role: string };

/** What a valid token says. `role` is what it said when it was signed; the row decides. */
export type SessionClaims = SessionUser & {
  tokenVersion: number;
  /** Seconds since the epoch, as signed. */
  issuedAt: number;
};

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET missing or too short");
  return new TextEncoder().encode(s);
}

/**
 * The deployment kind a token is for. Read through `getEnvironment`, which
 * refuses an unknown APP_ENV, so a deployment with none set can neither sign
 * nor accept a session.
 */
function audience(): string {
  return getEnvironment().appEnv;
}

export async function makeSessionToken(user: SessionUser & { tokenVersion: number }): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role, tv: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(SESSION_ISSUER)
    .setAudience(audience())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
    .sign(secret());
}

/**
 * The claims of an unexpired token this deployment signed, or null.
 *
 * A token from before 0053 carries no `tv`, no `aud` and no `iss`, and is
 * refused like any other: everybody signs in once after the deployment that
 * brings this in. That is the cost of being able to end a session.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: SESSION_ISSUER,
      audience: audience(),
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.tv !== "number" || !Number.isInteger(payload.tv)) return null;
    if (typeof payload.iat !== "number") return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "",
      tokenVersion: payload.tv,
      issuedAt: payload.iat,
    };
  } catch {
    return null;
  }
}

/**
 * Whether to answer this request with a fresh token: past half its life, or
 * the row now says something the token does not (a role changed either way, a
 * renamed person). Re-issuing on a role change is what lets a PROMOTED viewer
 * write without signing in again, because the middleware reads the token's
 * role, and what keeps a demoted editor's middleware check honest.
 */
export function shouldRenew(claims: SessionClaims, row: SessionUser, nowSeconds: number): boolean {
  if (nowSeconds - claims.issuedAt >= SESSION_RENEW_AFTER_SECONDS) return true;
  return claims.role !== row.role || claims.email !== row.email || claims.name !== row.name;
}
