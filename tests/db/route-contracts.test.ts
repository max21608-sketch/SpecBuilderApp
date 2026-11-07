// Every route under src/app/api, driven from outside (audit H4, H3, A16,
// 2026-11-06).
//
// ============================================================================
// WHY THIS FILE WALKS THE TREE
//
// 27 of 84 routes had no test that named them, so a refusal nobody had
// written a test for was a refusal nobody knew still held. A test per route
// would have the same gap the day route 85 lands. So this file reads the
// route tree AT TEST TIME, imports every handler, and drives each one with
// the requests a broken or hostile client sends:
//
//   - no session at all                -> 401, through the middleware as
//                                         deployed AND at the handler itself;
//   - a view-only session on a write   -> 403 at the handler (the middleware
//                                         half is `session-boundary.test.ts`);
//   - a path id that is not an id      -> 400 before any SQL;
//   - a body that is not JSON          -> 400, never a 500;
//   - and every one of those answers is JSON, because the screens read every
//     response as JSON and a bodyless 500 is the failure the UI rule exists
//     for, seen from the other side.
//
// `route-guards.test.ts` reads the SOURCE for `requireWriter(user)` and
// `requireUuid(...)`. This file runs the handlers, so a guard that is called
// in the wrong place, after the body is read or after a query, fails here
// and not there.
//
// The public routes (the way in, the way out, the queue, the cron jobs and
// Graph's notifications) are named below with what each must answer instead.
//
// THE DATABASE TIER, because a read handler a viewer may call goes on to its
// query. Nothing here writes: every request is refused before a write, ids are
// random uuids nothing holds, and the cron routes are never given their secret.
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { describeIfDb } from "./db-tier";

// Next's runtime puts AsyncLocalStorage on globalThis before any of its server
// modules load, and the queue consumer's path reaches one that calls `run()`.
// Without it, that call throws an invariant before the consumer is reached and
// a test about the consumer would pass for the wrong reason.
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
});

// ---- the session, the cookie jar and the queue's handler, stubbed ---------
type SessionUser = { id: string; email: string; name: string; role: string };
const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  jar: new Map<string, string>(),
  extractionRuns: 0,
}));

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, getSessionUser: async () => state.user };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));

// Three export routes carry `import "server-only"`, which resolves only inside
// Next's bundler. It has no exports; an empty module is what it is everywhere
// but the client bundle.
vi.mock("server-only", () => ({}));

// The queue consumer's work. A stub, so a forged message that got through
// would be COUNTED here rather than run against anything.
vi.mock("@/lib/extraction-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-run")>();
  return {
    ...actual,
    runDocumentExtraction: async () => {
      state.extractionRuns += 1;
      return { outcome: "done" };
    },
  };
});

const API = join(process.cwd(), "src/app/api");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];
const WRITES = new Set<Method>(["POST", "PATCH", "PUT", "DELETE"]);

function routeFiles(dir = API): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

type Route = {
  /** The route as a path under src/app/api: `records/[id]`. */
  name: string;
  file: string;
  /** The dynamic segments, in order: `["id", "contactId"]`. */
  params: string[];
  methods: Method[];
};

const ROUTES: Route[] = routeFiles()
  .map((file) => {
    const name = relative(API, file).replace(/\/?route\.ts$/, "");
    const source = readFileSync(file, "utf8");
    const methods = METHODS.filter((method) =>
      new RegExp(`^export (?:async )?function ${method}\\b|^export const ${method}\\b`, "m").test(source),
    );
    const params = [...name.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!);
    return { name, file, params, methods };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// ============================================================================
// THE PUBLIC ROUTES, by name, each with what it answers instead of a 401.
// Adding a route here is a decision to let a request in without a session.
// ============================================================================
const MIDDLEWARE_EXEMPT = new Set([
  "auth/login",
  "queues/[topic]",
  "cron/graph-delta",
  "cron/graph-renew",
  "cron/sweep-reads",
  "graph/notifications",
]);

/**
 * Handlers that read no session of their own: the exempt routes above, and
 * signing out, which the middleware covers but which must work for a view-only
 * account and for a cookie that is no longer a session.
 */
const SESSION_FREE = new Set([...MIDDLEWARE_EXEMPT, "auth/logout"]);

/**
 * Read handlers that do not ask for a session themselves and rely on the
 * middleware alone. FOUND BY 5.2 (R1): every other handler behind the
 * middleware asks `getSessionUser` and refuses without one (measured: 82 of
 * 89); seven ran their query for whoever reached them, and 5.4 fixed six. The middleware refuses them today. The A13 matcher defect
 * (a prefix exempting `/login-as`, `/api/cronjobs`) shows what "today" is
 * worth: one wrong character there and these answer anybody. Each is an
 * `it.fails` below, so the day one is fixed the suite says so.
 */
const READS_TRUSTING_THE_MIDDLEWARE = new Set<string>([
  // Empty since 5.3 cut D (2026-11-07): 5.4 put the session check into six of
  // the seven (R1), and the import route's GET got its own when that file was
  // split into handlers. A label added here is a read answering anybody the
  // middleware lets through.
]);

/**
 * A handler whose job is to answer without a session. `/api/auth/me` is how a
 * screen asks "am I signed in?", so a signed-out request is answered
 * `{ authed: false }` rather than refused. The middleware still covers it, so
 * from outside it is a 401 like every other route.
 */
const ANSWERS_SIGNED_OUT = new Set(["auth/me GET"]);

/**
 * Write handlers that read no body: a body that is not JSON is ignored, and
 * the answer is whatever the request without one gets.
 */
const READS_NO_BODY = new Set(["imports/[id]/read-furniture POST", "imports/[id]/read-specifications POST"]);

/**
 * Write handlers that read a body that is not JSON AS `{}` and go on. Empty
 * since 5.4: `imports/[id]/confirm`, `imports/[id]/rematch` and
 * `projects/[id]/batches` were here, and with a real id each leniency was a
 * write (route-contract-bodies.test.ts, R2). Adding a route here is a decision
 * that a garbled body may act.
 */
const READS_GARBAGE_AS_EMPTY = new Set<string>([]);

/** Path segments that are not ids: an index into a list. */
const NOT_AN_ID: Record<string, string> = { index: "0" };

const EDITOR: SessionUser = { id: "00000000-0000-4000-8000-0000000052c0", email: "__qa@example.test", name: "QA", role: "editor" };
const VIEWER: SessionUser = { ...EDITOR, role: "viewer" };
const MISCASED: SessionUser = { ...EDITOR, role: "Viewer" };

function pathFor(route: Route, values: Record<string, string>): string {
  return `/api/${route.name.replace(/\[([^\]]+)\]/g, (_, key: string) => values[key] ?? "x")}`;
}

function validParams(route: Route): Record<string, string> {
  return Object.fromEntries(route.params.map((key) => [key, NOT_AN_ID[key] ?? randomUUID()]));
}

function request(path: string, method: Method, body?: string): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined && method !== "GET") init.body = body;
  return new Request(`http://localhost${path}`, init);
}

const modules = new Map<string, Record<string, Handler>>();

async function call(route: Route, method: Method, values: Record<string, string>, body?: string): Promise<Response> {
  const handler = modules.get(route.name)?.[method];
  if (!handler) throw new Error(`${route.name} has no ${method}`);
  return handler(request(pathFor(route, values), method, body), { params: Promise.resolve(values) });
}

/** A response a screen can read: a JSON body, whatever the status. */
async function expectJson(response: Response, label: string): Promise<{ ok?: boolean; error?: string; code?: string }> {
  expect(response.headers.get("content-type") ?? "", `${label}: content-type`).toMatch(/^application\/json/);
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}: answered ${response.status} with a body that is not JSON: ${text.slice(0, 120)}`);
  }
  return parsed as { ok?: boolean; error?: string; code?: string };
}

// The matcher as deployed: Next's own compiler over the middleware's config.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => Parameters<typeof getMiddlewareRouteMatcher>[0];
};

const handlers = ROUTES.flatMap((route) => route.methods.map((method) => ({ route, method, label: `${route.name} ${method}` })));
const coveredHandlers = handlers.filter(({ route }) => !MIDDLEWARE_EXEMPT.has(route.name));
const protectedHandlers = handlers.filter(({ route }) => !SESSION_FREE.has(route.name));
const writeHandlers = protectedHandlers.filter(({ method }) => WRITES.has(method));
const dynamicHandlers = protectedHandlers.flatMap(({ route, method, label }) =>
  route.params.filter((key) => !(key in NOT_AN_ID)).map((key) => ({ route, method, key, label: `${label} [${key}]` })),
);

describeIfDb("route contracts", () => {
  let middleware: (request: NextRequest) => Promise<Response>;
  let matcherRuns: (pathname: string) => boolean;

  beforeAll(async () => {
    for (const route of ROUTES) modules.set(route.name, (await import(route.file)) as Record<string, Handler>);
    const loaded = await import("@/middleware");
    middleware = loaded.middleware;
    const runs = getMiddlewareRouteMatcher(getMiddlewareMatchers(loaded.config.matcher, {}));
    matcherRuns = (pathname) => runs(pathname, {} as never, {});
  }, 120_000);

  afterAll(() => {
    state.user = null;
  });

  it("finds every route and every handler (84 routes and 97 handlers when this was written)", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(84);
    expect(handlers.length).toBeGreaterThanOrEqual(97);
    for (const route of ROUTES) {
      expect(route.methods.length, `${route.name} exports no handler this file recognises`).toBeGreaterThan(0);
      for (const method of route.methods) expect(typeof modules.get(route.name)?.[method], `${route.name} ${method}`).toBe("function");
    }
  });

  it("names only public routes and middleware-trusting reads that exist", () => {
    const names = new Set(ROUTES.map((route) => route.name));
    for (const name of SESSION_FREE) expect(names, name).toContain(name);
    const labels = new Set(handlers.map((handler) => handler.label));
    for (const set of [READS_TRUSTING_THE_MIDDLEWARE, ANSWERS_SIGNED_OUT, READS_NO_BODY, READS_GARBAGE_AS_EMPTY]) {
      for (const label of set) expect(labels, label).toContain(label);
    }
  });

  // ==========================================================================
  // NO SESSION.
  // ==========================================================================
  it.each(coveredHandlers)("$label: with no session, the deployed app answers 401 in JSON", async ({ route, method, label }) => {
    state.user = null;
    const path = pathFor(route, validParams(route));
    expect(matcherRuns(path), `${path} is not covered by the middleware`).toBe(true);
    const response = await middleware(new NextRequest(new Request(`http://localhost${path}`, { method })));
    expect(response.status, label).toBe(401);
    await expectJson(response, label);
  });

  for (const { route, method, label } of protectedHandlers.filter(({ label }) => !ANSWERS_SIGNED_OUT.has(label))) {
    const trusting = READS_TRUSTING_THE_MIDDLEWARE.has(label);
    // See READS_TRUSTING_THE_MIDDLEWARE: these fail, and are expected to.
    (trusting ? it.fails : it)(`${label}: with no session, the handler itself answers 401 in JSON`, async () => {
      state.user = null;
      const response = await call(route, method, validParams(route), "{}");
      expect(response.status, label).toBe(401);
      await expectJson(response, label);
    });
  }

  it("auth/me GET: with no session, says so and names nobody", async () => {
    state.user = null;
    const route = ROUTES.find((entry) => entry.name === "auth/me")!;
    const response = await call(route, "GET", {});
    expect(response.status).toBe(200);
    const body = (await expectJson(response, "auth/me")) as { authed?: boolean; user?: unknown };
    expect(body.authed).toBe(false);
    expect(body.user).toBeUndefined();
  });

  // ==========================================================================
  // A VIEW-ONLY SESSION.
  // ==========================================================================
  it.each(writeHandlers)("$label: a viewer is refused 403 in JSON, and a mis-cased Viewer too", async ({ route, method, label }) => {
    for (const user of [VIEWER, MISCASED]) {
      state.user = user;
      const response = await call(route, method, validParams(route), "{}");
      expect(response.status, `${label} as ${user.role}`).toBe(403);
      const body = await expectJson(response, label);
      expect(body.error, label).toMatch(/view-only/);
    }
  });

  it.each(protectedHandlers.filter(({ method }) => method === "GET"))(
    "$label: a viewer may read, and is answered in JSON",
    async ({ route, method, label }) => {
      state.user = VIEWER;
      const response = await call(route, method, validParams(route));
      expect([401, 403], `${label} refused a viewer's read`).not.toContain(response.status);
      expect(response.status, `${label} failed`).toBeLessThan(500);
      // A download that found something would be a file; a random id finds
      // nothing, so the answer is the JSON refusal a screen reads.
      if (response.status !== 200 || (response.headers.get("content-type") ?? "").includes("json")) {
        await expectJson(response, label);
      }
    },
  );

  // ==========================================================================
  // A PATH ID THAT IS NOT AN ID.
  // ==========================================================================
  it.each(dynamicHandlers)("$label: 'abc' is refused 400 in JSON before any query", async ({ route, method, key, label }) => {
    state.user = EDITOR;
    const values = { ...validParams(route), [key]: "abc" };
    const response = await call(route, method, values, "{}");
    expect(response.status, label).toBe(400);
    const body = await expectJson(response, label);
    expect(body.code, label).toBe("not_an_id");
  });

  // ==========================================================================
  // A BODY THAT IS NOT JSON.
  // ==========================================================================
  it.each(writeHandlers)("$label: a body that is not JSON is refused 400 in JSON, never a 500", async ({ route, method, label }) => {
    state.user = EDITOR;
    const response = await call(route, method, validParams(route), "{not json");
    if (READS_NO_BODY.has(label) || READS_GARBAGE_AS_EMPTY.has(label)) {
      // Nothing holds the random id, so the answer is the 404 a request
      // without a body gets. Still JSON, still never a 500.
      expect(response.status, label).toBe(404);
    } else {
      expect(response.status, label).toBe(400);
    }
    await expectJson(response, label);
  });

  // ==========================================================================
  // THE PUBLIC ROUTES, each with its own answer.
  // ==========================================================================
  const route = (name: string) => ROUTES.find((entry) => entry.name === name)!;

  it("the middleware runs on none of the public routes, and on every other", () => {
    for (const entry of ROUTES) {
      const path = pathFor(entry, validParams(entry));
      expect(matcherRuns(path), path).toBe(!MIDDLEWARE_EXEMPT.has(entry.name));
    }
  });

  it("auth/login: a body that is not JSON, or that names nobody, is a 400 in JSON", async () => {
    for (const body of ["{not json", "{}", JSON.stringify({ email: "not an address", password: "x" })]) {
      const response = await call(route("auth/login"), "POST", {}, body);
      expect(response.status, body).toBe(400);
      expect((await expectJson(response, body)).ok).toBe(false);
    }
  });

  it("auth/logout: with no session it still answers, in JSON, and clears this browser's cookie", async () => {
    for (const cookie of [null, "not-a-token"]) {
      state.jar.clear();
      if (cookie) state.jar.set("sb_session", cookie);
      const response = await call(route("auth/logout"), "POST", {});
      expect(response.status).toBe(200);
      expect((await expectJson(response, "logout")).ok).toBe(true);
      expect(state.jar.has("sb_session")).toBe(false);
    }
  });

  it.each(["cron/graph-delta", "cron/graph-renew", "cron/sweep-reads"])(
    "%s: without the cron secret, or with a wrong one, is a 401 in JSON",
    async (name) => {
      for (const authorization of [null, "Bearer not-the-secret", `Bearer ${process.env.CRON_SECRET ?? ""}x`]) {
        const headers = new Headers();
        if (authorization) headers.set("authorization", authorization);
        const handler = modules.get(name)!.GET!;
        const response = await handler(new Request(`http://localhost/api/${name}`, { headers }), {
          params: Promise.resolve({}),
        });
        expect(response.status, String(authorization)).toBe(401);
        await expectJson(response, name);
      }
    },
  );

  describe("graph/notifications", () => {
    // Graph is the caller, not a screen: it reads a status, never a body, so
    // these refusals are text and that is not a breach of the JSON rule.
    const KEYS = ["MAIL_INGESTION_MODE", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_MAILBOX"];
    let saved: Record<string, string | undefined> = {};
    beforeAll(() => {
      saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    });
    afterAll(() => {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
    const post = (body: string) =>
      modules.get("graph/notifications")!.POST!(
        new Request("http://localhost/api/graph/notifications", { method: "POST", body }),
        { params: Promise.resolve({}) },
      );

    it("is not there at all while mail ingestion is off", async () => {
      process.env.MAIL_INGESTION_MODE = "disabled";
      expect((await post(JSON.stringify({ value: [] }))).status).toBe(404);
    });

    it("with ingestion on, refuses a body that is not JSON, and a notification nobody subscribed to", async () => {
      process.env.MAIL_INGESTION_MODE = "enabled";
      for (const key of KEYS.slice(1)) process.env[key] = process.env[key] || "__qa-route-contracts";
      expect((await post("{not json")).status).toBe(400);
      expect((await post(JSON.stringify({ value: [{ clientState: "x", resourceData: { id: "AAMk" } }] }))).status).toBe(401);
      const forged = { value: [{ subscriptionId: randomUUID(), clientState: "guessed", resourceData: { id: "AAMk" } }] };
      expect((await post(JSON.stringify(forged))).status).toBe(401);
    });
  });

  describe("queues/[topic]", () => {
    const post = (headers: Record<string, string>, body: string) =>
      modules.get("queues/[topic]")!.POST!(
        new Request("http://localhost/api/queues/extraction", { method: "POST", headers, body }),
        { params: Promise.resolve({ topic: "extraction" }) },
      );
    const payload = JSON.stringify({
      kind: "document-intake",
      extractionId: randomUUID(),
      attemptId: randomUUID(),
      requestedBy: "__qa-forged",
    });

    it("refuses a body that is not a queue callback, in JSON, and runs nothing", async () => {
      state.extractionRuns = 0;
      const plain = await post({ "content-type": "application/json" }, payload);
      expect(plain.status).toBe(400);
      await expectJson(plain, "queue");
      expect(state.extractionRuns).toBe(0);
    });

    // ========================================================================
    // FOUND BY 5.2 (R3), FIXED BY 5.4. In @vercel/queue 0.4.0 a v2beta
    // BINARY-mode callback that carries a receipt handle is handled from the
    // request's OWN body: `handleCallback` deserialises it as the payload and
    // calls our handler BEFORE it speaks to the queue service at all, and
    // nothing in the request is signed. Measured 2026-11-06: 200
    // {"status":"success"} and the consumer ran. Our trigger is v1beta, which
    // sends the structured shape the SDK RECEIVES from the service by id, so
    // the route now refuses the binary one before `handleCallback`
    // (src/lib/queue-callback.ts).
    // ========================================================================
    it("never hands a forged binary-mode callback to the consumer (found by 5.2, R3)", async () => {
      state.extractionRuns = 0;
      const response = await post(
        {
          "content-type": "application/json",
          "ce-type": "com.vercel.queue.v2beta",
          "ce-vqsqueuename": "extraction",
          "ce-vqsconsumergroup": "forged",
          "ce-vqsmessageid": randomUUID(),
          "ce-vqsreceipthandle": "forged-receipt",
          "ce-vqsdeliverycount": "1",
        },
        payload,
      );
      expect(response.status).toBe(400);
      await expectJson(response, "queue");
      expect(state.extractionRuns).toBe(0);
    });
  });
});
