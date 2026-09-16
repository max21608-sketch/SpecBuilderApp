// Microsoft Graph, read-only, for one mailbox.
//
// ============================================================================
// WHAT THIS MAY DO, AND WHAT IT MAY NOT
//
// `docs/integration.md`: this reads messages from one shared mailbox so emailed
// specification information can be staged. It does not send, reply, forward,
// flag, move, delete, or mark anything as read. The Entra grant is `Mail.Read`
// APPLICATION permission, narrowed by an Exchange application access policy to
// the one mailbox — and that scoping is verified in BOTH directions, because a
// policy that is not in force fails open and looks identical.
//
// There is no write helper here for the same reason there is none in
// capsule.ts: an absent function is a fact, and "we only ever GET" is a habit.
//
// ---- IT FAILS CLOSED -----------------------------------------------------
//
// `mailIngestionEnabled()` is false unless MAIL_INGESTION_MODE is 'enabled' AND
// a secret is present. Deleting `GRAPH_CLIENT_SECRET` is the documented
// emergency stop, and it works because every call goes through the token below.
//
// ---- ONLY AN ID IS EVER TAKEN FROM A NOTIFICATION ------------------------
//
// A webhook body is a stranger's HTTP request. `assertGraphId` is what stops a
// value from one becoming part of a URL; everything else about a message is
// fetched from Graph BY that id. `@odata.nextLink` and `@odata.deltaLink` are
// the one exception and are accepted only on Graph's own origin.
// ============================================================================
const AUTHORITY = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_EARLY_REFRESH_MS = 60_000;

export class GraphError extends Error {
  status: number;
  retryable: boolean;
  retryAfterSeconds: number | null;
  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    // 429 and 5xx are worth another delivery; 401/403/404 are configuration or
    // a message that is gone, and retrying buys the same answer.
    this.retryable = status === 429 || status >= 500;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GraphNotConfiguredError extends Error {
  constructor() {
    super("Mail ingestion is not enabled on this deployment.");
    this.name = "GraphNotConfiguredError";
  }
}

export function mailIngestionEnabled(): boolean {
  return (
    (process.env.MAIL_INGESTION_MODE ?? "disabled").toLowerCase() === "enabled" &&
    Boolean(process.env.GRAPH_CLIENT_SECRET) &&
    Boolean(process.env.GRAPH_TENANT_ID) &&
    Boolean(process.env.GRAPH_CLIENT_ID) &&
    Boolean(process.env.GRAPH_MAILBOX)
  );
}

export function graphMailbox(): string {
  const mailbox = (process.env.GRAPH_MAILBOX ?? "").trim().toLowerCase();
  if (!mailbox) throw new GraphNotConfiguredError();
  return mailbox;
}

/**
 * The only values that may be interpolated into a Graph path.
 *
 * Graph message ids are long base64url-ish strings. Anything carrying a slash,
 * a dot-segment or a query character is refused outright rather than escaped:
 * a value that shape has not come from Graph.
 */
export function assertGraphId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 512 || !/^[A-Za-z0-9_=-]+$/.test(id)) {
    throw new GraphError(400, "That is not a Microsoft Graph id.");
  }
  return id;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt - TOKEN_EARLY_REFRESH_MS > Date.now()) {
    return cachedToken.value;
  }
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const secret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) throw new GraphNotConfiguredError();

  const response = await fetch(`${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    // The body can carry the client secret's own expiry detail; the status is
    // enough for a log and the message says where to look.
    throw new GraphError(
      response.status,
      `Microsoft would not issue a token (${response.status}). Check GRAPH_CLIENT_SECRET has not expired.`,
    );
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new GraphError(502, "Microsoft returned no access token.");
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** A Graph URL built from a literal path, or an `@odata` link Graph itself gave us. */
export function graphUrl(pathOrLink: string): string {
  if (pathOrLink.startsWith("https://")) {
    const url = new URL(pathOrLink);
    // A link from a payload is still a stranger's string until its origin is
    // checked. Graph's own paging links are the only absolute URLs accepted.
    if (url.origin !== "https://graph.microsoft.com") {
      throw new GraphError(400, "That is not a Microsoft Graph link.");
    }
    return pathOrLink;
  }
  return `${GRAPH}${pathOrLink.startsWith("/") ? "" : "/"}${pathOrLink}`;
}

type GraphInit = { method?: "GET" | "POST" | "PATCH"; body?: unknown; accept?: string; signal?: AbortSignal };

/**
 * One request, with one retry on a 401.
 *
 * POST and PATCH exist for SUBSCRIPTION management only — creating and renewing
 * the change notification. Neither touches a message: there is no path in this
 * module that writes to a mailbox, and `Mail.Read` would refuse one anyway.
 */
export async function graphFetch(path: string, init: GraphInit = {}): Promise<Response> {
  const send = async (token: string) =>
    fetch(graphUrl(path), {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: init.accept ?? "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: "no-store",
    });

  let response = await send(await accessToken());
  if (response.status === 401) {
    // The cached token may have been revoked rather than expired. One fresh
    // attempt; a second 401 is configuration, not a hiccup.
    response = await send(await accessToken(true));
  }

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new GraphError(
      response.status,
      `Microsoft Graph answered ${response.status} for ${path.split("?")[0]}.`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return response;
}

export async function graphJson<T>(path: string, init: GraphInit = {}): Promise<T> {
  return (await graphFetch(path, init)).json() as Promise<T>;
}

/** Raw bytes, capped. A message over the cap is recorded without its MIME, never refused. */
export async function graphBytes(
  path: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; contentType: string } | { tooLarge: true; size: number }> {
  const response = await graphFetch(path, { accept: "*/*" });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { tooLarge: true, size: declared };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) return { tooLarge: true, size: buffer.byteLength };
  return { bytes: buffer, contentType: response.headers.get("content-type") ?? "message/rfc822" };
}

/** The mailbox path prefix, with the address encoded exactly once. */
export function mailboxPath(suffix: string): string {
  return `/users/${encodeURIComponent(graphMailbox())}${suffix}`;
}
