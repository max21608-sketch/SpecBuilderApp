// ============================================================================
// ONE LOG LINE PER UNCAUGHT SERVER ERROR (production hardening H4b, 2026-11-20).
//
// `src/instrumentation.ts` hands Next's `onRequestError` to this. Before it,
// an error no route caught reached the log only as whatever Next printed —
// nothing searchable, and nothing a person could quote from the screen and
// find. Now each one is ONE line with a fixed prefix:
//
//   [request-error] ref=<digest or reference> method=POST route=/api/projects/[id] type=route router=app error=TypeError
//
// WHAT IT NEVER CARRIES: the error's message or stack, the request's body or
// headers, the query string, or the concrete path. This app's errors are
// thrown over NDA-covered client material — a driver error echoes the value
// that broke a constraint, a model error can quote a document — and Vercel's
// log is read by people and tools the material was never shared with. The
// route is the PATTERN (`/api/projects/[id]`), so not even an id is logged.
// The error's class name is kept when the whole of it is an identifier,
// because "NeonDbError" against "TypeError" is the first triage question and
// names no data; anything else is "unnamed". Every printed field is all one
// shape or replaced, never cleaned up, so no field can carry a sentence. A route that wants the cause logged catches it and calls
// `reportFailure`, which keeps it under a reference of its own.
//
// The digest is Next's own: the same string an error page shows a person as
// "Digest: …", so the line is findable from a screenshot. When Next gives
// none, a short random reference stands in, so every line has one.
//
// Pure and edge-safe (instrumentation also loads in the edge runtime): the
// reference comes from Web Crypto through the caller, never `node:crypto`.
// ============================================================================

export const REQUEST_ERROR_PREFIX = "[request-error]";

export type RequestErrorRequest = { path: string; method: string };
export type RequestErrorContext = { routePath: string; routeType: string; routerKind: string };

/**
 * The value when ALL of it is the shape asked for, otherwise "". Never a
 * cleaned-up fragment: stripping the spaces out of a sentence leaves the
 * sentence's words, glued together.
 */
function exactly(value: unknown, shape: RegExp): string {
  return typeof value === "string" && shape.test(value) ? value : "";
}

const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;
const METHOD = /^[A-Za-z]{1,10}$/;
const ROUTE_TYPE = /^[a-z]{1,20}$/;

/** A route pattern — Next's own, from the file tree — with no query and nothing a path does not carry. */
function routePattern(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const path = value.split("?")[0]!;
  return /^\/[A-Za-z0-9_./[\]()@-]{0,200}$/.test(path) ? path : "unknown";
}

/** Eight hex characters from Web Crypto: available in Node and on the edge. */
export function shortReference(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The one line to log for an uncaught server error. `reference` is used only
 * when the error carries no digest.
 */
export function formatRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
  reference: () => string = shortReference,
): string {
  const digest = exactly((error as { digest?: unknown } | null)?.digest, DIGEST);
  const name = exactly(error instanceof Error ? error.name : typeof error, CLASS_NAME) || "unnamed";
  const method = exactly(request.method, METHOD).toUpperCase() || "UNKNOWN";
  const router = context.routerKind === "App Router" ? "app" : context.routerKind === "Pages Router" ? "pages" : "unknown";
  return [
    REQUEST_ERROR_PREFIX,
    `ref=${digest || reference()}`,
    `method=${method}`,
    `route=${routePattern(context.routePath)}`,
    `type=${exactly(context.routeType, ROUTE_TYPE) || "unknown"}`,
    `router=${router}`,
    `error=${name}`,
  ].join(" ");
}
