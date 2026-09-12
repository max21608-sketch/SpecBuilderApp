// Shared client-side fetch wrapper. Every call site used to do
// `const data = await res.json()` before testing `res.ok`, which throws on the
// HTML error pages Vercel returns for a 500/504 -- leaving busy flags stuck and
// turning failures into silently empty UI. This always resolves to a
// discriminated result and always yields a message a human can act on.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; data: Record<string, unknown> | null };

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

  if (res.ok && body?.ok !== false) return { ok: true, status: res.status, data: (body ?? {}) as T };

  const message = typeof body?.error === "string" && body.error ? body.error : fallbackMessage(res.status);
  return { ok: false, status: res.status, error: message, data: body };
}

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 504 || status === 408) return "The server took too long to respond. Try again.";
  if (status >= 500) return `The server returned an error (${status}). Try again, or check the deployment logs.`;
  return `Request failed (${status}).`;
}
