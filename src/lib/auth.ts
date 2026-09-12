// Session JWT handling — jose only, no Node built-ins, so this is safe to
// import from middleware.ts (which runs on the Edge runtime). Password
// hashing/verification (which needs node:crypto's scrypt) lives in
// auth-node.ts instead, imported only by route handlers (Node runtime).
import { SignJWT, jwtVerify } from "jose";

// Rename this per app. Two Ben Whistler apps served from the same parent
// domain will otherwise both read and write the same cookie, and whichever
// signed in last wins in both. Use the app slug: "<app>_session".
export const SESSION_COOKIE = "sb_session";

export type SessionUser = { id: string; email: string; name: string; role: string };

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET missing or too short");
  return new TextEncoder().encode(s);
}

export async function makeSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "",
    };
  } catch {
    return null;
  }
}
