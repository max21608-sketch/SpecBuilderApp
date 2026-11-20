// A failure a caller is right to swallow still leaves a log line (review 2.2).
//
// - The pack's next deferred read: `handOffReadSlot` and `dispatchNextWaiting`
//   never throw, by design, and a failure in either left the document waiting
//   for the hourly sweep with nothing in the log saying why.
// - Graph's "last notified" timestamp: written after the 202, as a bare promise
//   with an empty catch. It is now registered with the runtime through `after`
//   and logs when it fails.
// - Two lower-severity siblings (the record history's unchanged list, the
//   classify route's registers) are held by reading their source, because
//   neither has a seam that reaches the catch without a database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    sql: async () => {
      if (db.fail) throw db.fail;
      return [];
    },
  };
});
vi.mock("@/lib/db-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-transaction")>();
  return {
    ...actual,
    withTransaction: async () => {
      if (db.fail) throw db.fail;
      return null;
    },
  };
});

const afterQueue = vi.hoisted(() => ({ callbacks: [] as (() => Promise<void> | void)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => Promise<void> | void) => afterQueue.callbacks.push(callback) };
});
vi.mock("@/lib/graph-subscriptions", () => ({
  loadSubscriptionByGraphId: async () => ({ mailbox: "qa@example.test", client_state_hash: "x" }),
  clientStateMatches: () => true,
  handleLifecycleEvent: async () => {},
}));
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return { ...actual, enqueueExtractionJob: async () => {} };
});

const GRAPH_KEYS = ["MAIL_INGESTION_MODE", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_MAILBOX"];
let savedEnv: Record<string, string | undefined> = {};
let logged: string[] = [];

beforeEach(() => {
  db.fail = null;
  afterQueue.callbacks.length = 0;
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  savedEnv = Object.fromEntries(GRAPH_KEYS.map((key) => [key, process.env[key]]));
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of GRAPH_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("the hand-off to the next deferred read", () => {
  it("logs a failure to read the settled document's scope, naming the document", async () => {
    db.fail = Object.assign(new Error("__QA connection terminated"), { code: "08006" });
    const { handOffReadSlot } = await import("@/lib/extraction-slots");
    await expect(handOffReadSlot("11111111-2222-4333-8444-555555555555", "qa")).resolves.toBeUndefined();
    expect(logged.some((line) => line.includes("11111111-2222-4333-8444-555555555555"))).toBe(true);
  });

  it("logs a failure to start the next document, naming the pack", async () => {
    db.fail = Object.assign(new Error("__QA lock timeout"), { code: "55P03" });
    const { dispatchNextWaiting } = await import("@/lib/extraction-slots");
    await expect(dispatchNextWaiting({ projectId: "project-qa", batchId: "batch-qa" }, "qa")).resolves.toBeNull();
    expect(logged.some((line) => line.includes("project-qa") && line.includes("batch-qa"))).toBe(true);
  });
});

describe("Graph's last-notified timestamp", () => {
  it("is written through `after`, and a failure to write it is logged", async () => {
    process.env.MAIL_INGESTION_MODE = "enabled";
    for (const key of GRAPH_KEYS.slice(1)) process.env[key] = "__qa";
    const { POST } = await import("@/app/api/graph/notifications/route");
    const response = await POST(
      new Request("http://localhost/api/graph/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: [{ subscriptionId: "sub-qa", clientState: "x", resourceData: { id: "AAMkQA" } }] }),
      }),
    );
    expect(response.status).toBe(202);
    // Answered before the write, and the write is the runtime's to finish.
    expect(afterQueue.callbacks).toHaveLength(1);

    db.fail = Object.assign(new Error("__QA connection terminated"), { code: "08006" });
    await afterQueue.callbacks[0]!();
    expect(logged.some((line) => line.includes("Graph last notified"))).toBe(true);
  });
});

describe("the lower-severity siblings", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), "src/app/api", file), "utf8");

  it("the record history logs the version it could not list", () => {
    const text = source("records/[id]/history/route.ts");
    expect(text).not.toMatch(/catch\s*\{/);
    expect(text).toContain("reportFailure(`listing the unchanged specs of record");
  });

  it("the classify route logs registers it could not load", () => {
    const text = source("imports/classify/route.ts");
    expect(text).not.toMatch(/\.catch\(\(\)\s*=>\s*null\)/);
    // One logged load, used by both places that read a PDF bill (prod-ready
    // review F4 moved the two loads into `billReadingOptions`): neither may
    // load the registers on its own, unlogged.
    expect(text.match(/\.catch\(registersUnread\)/g)).toHaveLength(1);
    expect(text.match(/await billReadingOptions\(\)/g)).toHaveLength(2);
    expect(text.match(/loadBoqReadingRegisters\(/g)).toHaveLength(1);
  });
});
