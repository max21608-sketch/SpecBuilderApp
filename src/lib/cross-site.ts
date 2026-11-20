// ============================================================================
// A WRITE FROM ANOTHER SITE IS REFUSED (production hardening H2, 2026-11-20).
//
// The session cookie is `SameSite=Lax`, and Lax is decided by SITE, not by
// origin: every app under one registrable domain is the same site. A sibling
// app on the company's domain — or a page somebody manages to host there —
// could therefore POST to this app's API with the signed-in person's cookie
// attached, and the middleware asked nothing but who they were.
//
// So a mutating `/api/*` request is refused when the browser says it came
// from somewhere else:
//
//   - `Origin` is present and its host is not the host the request was sent
//     to (`x-forwarded-host` where a proxy sets it, as Vercel does; otherwise
//     `Host`). `Origin: null` — a sandboxed frame, a `file:` page — is never
//     this app, and is refused too.
//   - `Sec-Fetch-Site: cross-site`, which a browser sets and a page cannot.
//
// A request with NO Origin and no Sec-Fetch-Site is let through, because that
// is a machine, not a browser: the queue callback, cron, the Graph webhook, a
// script. Every browser this app supports sends Origin on a POST, PUT, PATCH
// or DELETE, so a missing one is not a gap a page can open. The machine routes
// are outside the middleware's matcher anyway; this rule would not refuse them
// if they were not.
//
// `x-forwarded-host` and `Host` are not headers a page can set on a request
// to another origin without a CORS preflight this app never answers, which is
// why comparing against them is sound.
//
// Edge-safe: no Node built-ins, because the middleware imports it.
// ============================================================================

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The refusal, written for the person who will read it on a screen. */
export const CROSS_SITE_REFUSED =
  "This change came from a page on another website, so it was refused and nothing was saved. " +
  "Open Project Spec Builder at its own address and make the change there.";

/** The host the request was addressed to: the proxy's word first, then the request's own. */
function requestHost(headers: Headers, fallbackHost: string): string {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.toLowerCase();
  const host = headers.get("host")?.trim();
  return (host || fallbackHost).toLowerCase();
}

/** The host:port an Origin header names, or null when it names none (`null`, garbage). */
function originHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether this request is a write to the API sent from another site.
 *
 * `fallbackHost` is the host of the request's own URL, used only when neither
 * `x-forwarded-host` nor `Host` is present.
 */
export function isCrossSiteWrite(request: {
  method: string;
  pathname: string;
  headers: Headers;
  fallbackHost: string;
}): boolean {
  if (!request.pathname.startsWith("/api/")) return false;
  if (READ_METHODS.has(request.method.toUpperCase())) return false;

  if (request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const from = originHost(origin.trim());
  if (from === null) return true;
  return from !== requestHost(request.headers, request.fallbackHost);
}
