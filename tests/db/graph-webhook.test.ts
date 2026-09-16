// The one public route in this app, and what it refuses.
//
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/graph-webhook.test.ts
//
// The queue is stubbed, so nothing is published and no model call can follow.
// What is under test is the gate: a disabled deployment, the validation
// handshake, and every way a body can fail to authenticate.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { clientStateHash } from "@/lib/graph-subscriptions";

const published: unknown[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: unknown) => {
      published.push(message);
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SECRET = "__qa-client-state";
const MAILBOX = "__qa-inbox@example.test";
const SUBSCRIPTION = "__qa-subscription-1";

function notify(body: unknown, query = ""): Request {
  return new Request(`http://localhost/api/graph/notifications${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = {
  value: [
    {
      subscriptionId: SUBSCRIPTION,
      clientState: SECRET,
      resourceData: { id: "AAMkAGI2THVSAAA=" },
    },
  ],
};

describeIfDb("the Graph webhook", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const saved = { ...process.env };

  beforeAll(async () => {
    await client.connect();
    await client.query(`delete from graph_subscriptions where mailbox = $1`, [MAILBOX]);
    await client.query(
      `insert into graph_subscriptions
         (mailbox, resource, subscription_id, client_state_hash, notification_url, status, expires_at,
          created_by, updated_by)
       values ($1, '/mailFolders/inbox/messages', $2, $3, 'https://example.test/api/graph/notifications',
               'active', now() + interval '2 days', 'qa', 'qa')`,
      [MAILBOX, SUBSCRIPTION, clientStateHash(SECRET)],
    );
  });

  afterAll(async () => {
    process.env = saved;
    await client.query(`delete from graph_subscriptions where mailbox = $1`, [MAILBOX]);
    await client.end();
  });

  beforeEach(() => {
    published.length = 0;
    process.env.MAIL_INGESTION_MODE = "enabled";
    process.env.GRAPH_CLIENT_SECRET = "__qa-secret";
    process.env.GRAPH_TENANT_ID = "__qa-tenant";
    process.env.GRAPH_CLIENT_ID = "__qa-client";
    process.env.GRAPH_MAILBOX = MAILBOX;
    process.env.GRAPH_CLIENT_STATE = SECRET;
  });

  it("is invisible when ingestion is not enabled", async () => {
    process.env.MAIL_INGESTION_MODE = "disabled";
    const { POST } = await import("@/app/api/graph/notifications/route");
    // 404, not 403: there is no subscription, so anything arriving is noise,
    // and 404 tells a prober less.
    expect((await POST(notify(valid))).status).toBe(404);
    expect(published).toEqual([]);
  });

  it("echoes the validation token as text, and writes nothing", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(notify({}, "?validationToken=abc123"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("abc123");
    expect(published).toEqual([]);
  });

  it("enqueues a fetch for a notification that authenticates", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(notify(valid));
    expect(res.status).toBe(202);
    expect(published).toEqual([
      {
        kind: "mail-ingest",
        mailbox: MAILBOX,
        graphMessageId: "AAMkAGI2THVSAAA=",
        source: "notification",
        requestedBy: "system:microsoft-graph",
      },
    ]);
  });

  it("refuses a wrong clientState, and publishes nothing", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(notify({ value: [{ ...valid.value[0], clientState: "wrong" }] }));
    expect(res.status).toBe(401);
    expect(published).toEqual([]);
  });

  it("refuses a subscription id we never created", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(notify({ value: [{ ...valid.value[0], subscriptionId: "__qa-not-ours" }] }));
    expect(res.status).toBe(401);
    expect(published).toEqual([]);
  });

  // A batch mixing real and forged entries is not a batch worth half-trusting.
  it("refuses the whole batch when one entry does not authenticate", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(
      notify({ value: [valid.value[0], { ...valid.value[0], clientState: "wrong" }] }),
    );
    expect(res.status).toBe(401);
    expect(published).toEqual([]);
  });

  it("ignores a message id that is not the shape Graph uses", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const res = await POST(
      notify({ value: [{ ...valid.value[0], resourceData: { id: "../../subscriptions" } }] }),
    );
    // Authenticated, so not a 401 — but the id is refused and nothing is
    // enqueued, because it is the one value taken from the body.
    expect(res.status).toBe(202);
    expect(published).toEqual([]);
  });

  it("refuses a body that is not the shape Graph sends", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    expect((await POST(notify({ value: "not an array" }))).status).toBe(400);
    expect(published).toEqual([]);
  });

  it("refuses an oversized body before parsing it", async () => {
    const { POST } = await import("@/app/api/graph/notifications/route");
    const huge = { value: [{ ...valid.value[0], clientState: "x".repeat(300_000) }] };
    expect((await POST(notify(huge))).status).toBe(413);
    expect(published).toEqual([]);
  });
});

describeIfDb("the Graph crons", () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it("refuse a request with no CRON_SECRET", async () => {
    process.env.CRON_SECRET = "__qa-cron";
    const renew = await import("@/app/api/cron/graph-renew/route");
    const delta = await import("@/app/api/cron/graph-delta/route");
    expect((await renew.GET(new Request("http://localhost/test"))).status).toBe(401);
    expect((await delta.GET(new Request("http://localhost/test"))).status).toBe(401);
  });

  // The normal state of every deployment until somebody turns ingestion on.
  // It must be a quiet success, not an error somebody learns to ignore.
  it("skip quietly when ingestion is disabled", async () => {
    process.env.CRON_SECRET = "__qa-cron";
    process.env.MAIL_INGESTION_MODE = "disabled";
    const renew = await import("@/app/api/cron/graph-renew/route");
    const res = await renew.GET(
      new Request("http://localhost/test", { headers: { authorization: "Bearer __qa-cron" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("disabled");
  });
});
