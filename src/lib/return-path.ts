// ============================================================================
// WHERE SIGNING IN RETURNS TO. A leaf, read by the login page (server) and by
// `LoginForm` (browser), so both apply one rule.
//
// The session-expired link (`api-fetch.ts`) and the middleware both send a
// person to `/login?from=<the page they were on>`, and `LoginForm` ignored it
// and pushed `/dashboard`, so a reviewer whose session lapsed mid-review lost
// their place. `from` is honoured now, and only as a path INSIDE the
// dashboard: a sign-in page that redirects wherever its query string says is
// an open redirect, the shape a phishing email uses to borrow this app's
// address. An absolute URL, a protocol-relative `//host`, a backslash (which
// browsers read as a slash), or any path outside `/dashboard` lands on
// `/dashboard`.
// ============================================================================

export const DEFAULT_RETURN_PATH = "/dashboard";

export function safeReturnPath(from: string | null | undefined): string {
  const raw = String(from ?? "");
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_RETURN_PATH;
  let parsed: URL;
  try {
    parsed = new URL(raw, "http://this.app");
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (parsed.origin !== "http://this.app") return DEFAULT_RETURN_PATH;
  if (parsed.pathname !== "/dashboard" && !parsed.pathname.startsWith("/dashboard/")) return DEFAULT_RETURN_PATH;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
