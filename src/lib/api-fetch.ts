// Shared client-side fetch wrapper. Every call site used to do
// `const data = await res.json()` before testing `res.ok`, which throws on the
// HTML error pages Vercel returns for a 500/504 -- leaving busy flags stuck and
// turning failures into silently empty UI. This always resolves to a
// discriminated result and always yields a message a human can act on.
//
// TWO MORE THINGS IT REFUSES TO PASS ON (audit G4, G11, 2026-11-06).
//
// A 2xx WHOSE BODY IS NOT A JSON OBJECT IS A FAILURE. It used to resolve as
// `{ ok: true, data: {} }`, so a screen trusted it and did
// `res.data.batches.find(...)` (an unhandled rejection) or `setData({})` and
// then crashed rendering `data.record.parent_id`. Every route this app's
// screens call answers with a JSON object, including the ones with nothing to
// say (`{ ok: true }`), so an empty or HTML 200 is a proxy, a login page or a
// broken deploy, never data. No caller expects an empty body today; one that
// ever does should get its own option, not a default that says "ok" about
// nothing.
//
// AN EXPIRED SESSION SAYS SO, AND SAYS WHERE TO GO. The middleware answers a
// missing session with a 401 whose body reads "auth required", and the body's
// own words used to beat the friendly fallback, so a person read "auth
// required" with no way to sign in. A 401 is now always the sentence, the
// result carries the sign-in link back to the page they were on, and the
// event below lets the dashboard shell show that link once, wherever the
// request came from. The login request itself is the exception: its 401 is a
// wrong password, and it keeps its own words.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      data: Record<string, unknown> | null;
      /** Present when the session has expired: where to sign in, coming back here. */
      signIn?: string;
    };

/** Dispatched on `window` when a request finds the session gone. `detail: { signIn }`. */
export const SESSION_EXPIRED_EVENT = "specbuilder:session-expired";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again.";

/** The one request whose 401 means a wrong password, not an expired session. */
const LOGIN_PATH = "/api/auth/login";

export async function apiFetch<T = Record<string, unknown>>(
  input: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection and try again.", data: null };
  }

  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (res.status === 401 && input.split("?")[0] !== LOGIN_PATH) {
    const signIn = signInHref();
    announceSessionExpired(signIn);
    return { ok: false, status: 401, error: SESSION_EXPIRED_MESSAGE, data: body, signIn };
  }

  if (res.ok && body === null) {
    return {
      ok: false,
      status: res.status,
      error: `The server answered with something that is not data (status ${res.status}).`,
      data: null,
    };
  }

  if (res.ok && body?.ok !== false) return { ok: true, status: res.status, data: body as T };

  const message = typeof body?.error === "string" && body.error ? body.error : fallbackMessage(res.status);
  return { ok: false, status: res.status, error: message, data: body };
}

/** The sign-in page, sent back to wherever this request was made from. */
function signInHref(): string {
  if (typeof window === "undefined" || !window.location) return "/login";
  const here = `${window.location.pathname ?? ""}${window.location.search ?? ""}`;
  return here ? `/login?from=${encodeURIComponent(here)}` : "/login";
}

function announceSessionExpired(signIn: string) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { signIn } }));
  } catch {
    // An announcement that cannot be made leaves the sentence on the screen
    // that asked, which is still true.
  }
}

function fallbackMessage(status: number): string {
  if (status === 504 || status === 408) return "The server took too long to respond. Try again.";
  if (status >= 500) return `The server returned an error (${status}). Try again, or check the deployment logs.`;
  return `Request failed (${status}).`;
}
