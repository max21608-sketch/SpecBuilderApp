// Database tier — settling an attempt that passed its deadline, and the
// deferral marker that must stop moving for the sweeper to find it.
//
// ============================================================================
// NO MODEL IS CALLED AND NOTHING IS PUBLISHED. The queue and the blob store are
// mocked at the module boundary exactly as `extraction-cap.test.ts` mocks them,
// and the publisher stub IS the assertion: `published` is the set of reads that
// would have been paid for. The property this file exists to hold is that a
// SWEEP publishes only what the cap already deferred and promised — never a
// second read of the attempt it just closed.
//
// Deadlines are moved by writing `attempt_deadline_at` into the past rather
// than by waiting 24 hours. That is the one thing these tests fake; everything
// else goes through the real registration route, the real extract route and the
// real sweep.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
// ============================================================================
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { MAX_IN_FLIGHT_READS_PER_PACK } from "@/lib/extraction-claim";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    readTrustedBlob: async () => ({
      bytes: Buffer.from("__QA"),
      contentType: "application/pdf",
      size: 4,
      pathname: "projects/qa/doc.pdf",
    }),
    headTrustedBlob: async (pathname: string) => ({ pathname, contentType: "application/pdf", size: 4 }),
  };
});

/** Every read that would have been charged for. */
const published: { extractionId: string; attemptId: string }[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { extractionId: string; attemptId: string }) => {
      published.push({ extractionId: message.extractionId, attemptId: message.attemptId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("settling an extraction attempt that passed its deadline", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90019")}', '__QA Sweep project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  beforeEach(() => {
    published.length = 0;
  });

  async function newBatch(label: string): Promise<string> {
    const rows = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, $2, 'qa', 'qa') returning id`,
      [projectId, `__QA ${label}`],
    );
    return rows.rows[0].id;
  }

  /** Register one specification document into a pack, through the real route. */
  async function registerDoc(batchId: string, name: string): Promise<void> {
    const { POST } = await import("@/app/api/imports/route");
    const filename = `__QA ${name}.pdf`;
    await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          batchId,
          importType: "spec_document",
          documentKind: "ffe_schedule",
          pathname: `projects/${projectId}/${filename}`,
          filename,
          contentType: "application/pdf",
          size: 4,
          registrationRequestId: randomUUID(),
        }),
      }),
    );
  }

  /** One press of Read, through the REAL extract route. */
  async function readIt(runId: string) {
    const version = await client.query(`select version from intake_runs where id = $1`, [runId]);
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const res = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: Number(version.rows[0].version),
          requestId: randomUUID(),
          action: "start",
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { status: res.status, body: await res.json() };
  }

  async function packRuns(batchId: string) {
    const rows = await client.query(
      `select id, status, error, attempt_id, attempt_deadline_at
         from intake_runs where batch_id = $1 order by created_at, id`,
      [batchId],
    );
    return rows.rows as {
      id: string;
      status: string;
      error: string | null;
      attempt_id: string | null;
      attempt_deadline_at: Date | null;
    }[];
  }

  /** The 24 hours, without the 24 hours. */
  async function expire(runId: string): Promise<void> {
    await client.query(`update intake_runs set attempt_deadline_at = now() - interval '1 hour' where id = $1`, [runId]);
  }

  /**
   * SCOPED TO THIS TEST'S PROJECT, and that is not a convenience. The cron
   * sweeps the whole database, which is right for the cron and wrong here: a
   * sandbox shared with other agents holds other packs, and an unscoped sweep
   * inside a test would settle their attempts and start their deferred reads
   * against a publisher that only exists in this process.
   */
  const sweep = async () => {
    const { sweepExpiredReads } = await import("@/lib/extraction-sweep");
    return sweepExpiredReads("system:read-sweeper", { projectId });
  };

  // ---- the hole the cap stepped around ------------------------------------

  it("closes the expired attempts of a pack and starts the document waiting behind them", async () => {
    const batchId = await newBatch("expired");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK + 1; n += 1) await registerDoc(batchId, `expired-${n}`);

    const before = await packRuns(batchId);
    const started = before.filter((run) => run.status === "queued");
    const deferred = before.filter((run) => run.status === "pending" && run.attempt_id === null);
    expect(started).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);
    expect(deferred).toHaveLength(1);
    expect(published).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);
    published.length = 0;

    // Every in-flight attempt dies of old age. Before the sweeper this left the
    // pack still: the deferred document held its promise and nothing came.
    for (const run of started) await expire(run.id);

    const result = await sweep();
    expect(result.settled).toBe(MAX_IN_FLIGHT_READS_PER_PACK);
    expect(result.skipped).toBe(0);
    // ONE read started, and it is the one that was already promised.
    expect(result.dispatched).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.extractionId).toBe(deferred[0]?.id);

    const after = await packRuns(batchId);
    const byId = new Map(after.map((run) => [run.id, run]));
    for (const run of started) {
      expect(byId.get(run.id)?.status).toBe("failed");
      // The sentence says what happened AND what pressing Read costs.
      expect(String(byId.get(run.id)?.error)).toContain("deadline");
      expect(String(byId.get(run.id)?.error)).toContain("charged");
      // NEVER republished. There is no exactly-once billing guarantee, so a
      // sweeper that restarted what it settled would be the one component able
      // to charge for a document with nobody watching.
      expect(published.some((entry) => entry.extractionId === run.id)).toBe(false);
    }
    expect(byId.get(deferred[0]!.id)?.status).toBe("queued");
    expect(byId.get(deferred[0]!.id)?.attempt_id).toBeTruthy();
  });

  it("leaves an attempt inside its deadline alone", async () => {
    const batchId = await newBatch("live");
    await registerDoc(batchId, "live-0");
    published.length = 0;

    const result = await sweep();
    expect(result.settled).toBe(0);
    expect(published).toHaveLength(0);
    expect((await packRuns(batchId))[0]?.status).toBe("queued");
  });

  it("does not escalate an expired row a worker still holds", async () => {
    const batchId = await newBatch("claimed");
    await registerDoc(batchId, "claimed-0");
    const [run] = await packRuns(batchId);
    // A live claim under an expired deadline: only reachable with a badly
    // skewed clock, and the fence is what makes reasoning about that
    // unnecessary. Zero rows means ownership moved — stop, never force.
    await client.query(
      `update intake_runs set status = 'parsing', claim_token = $2, processing_started_at = now(),
                              attempt_deadline_at = now() - interval '1 hour'
        where id = $1`,
      [run!.id, randomUUID()],
    );
    // Registration published this document's own read a moment ago. Cleared
    // here, so what is left is whatever the SWEEP publishes — which is nothing.
    published.length = 0;

    const result = await sweep();
    expect(result.settled).toBe(0);
    const after = await packRuns(batchId);
    expect(after[0]?.status).toBe("parsing");
    expect(published).toHaveLength(0);
  });

  // ---- the marker the sweeper has to be able to find -----------------------

  it("does not extend a deferral that is already in place, however often Read is pressed", async () => {
    const batchId = await newBatch("marker");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `marker-${n}`);
    await registerDoc(batchId, "marker-over");

    const deferred = (await packRuns(batchId)).find((run) => run.status === "pending" && run.attempt_id === null);
    expect(deferred).toBeTruthy();
    const first = deferred!.attempt_deadline_at?.getTime();
    expect(first).toBeTruthy();

    // Pressing Read on a document already waiting for a slot is the ordinary
    // impatient thing to do, and it used to push the marker's expiry an hour
    // further out every time — so the run never reached the resting state
    // *Read all* picks up, and now would never be reached by a sweep either.
    for (let n = 0; n < 3; n += 1) {
      const { status, body } = await readIt(deferred!.id);
      expect(status).toBe(202);
      expect(body.waiting).toBe(true);
    }

    const again = (await packRuns(batchId)).find((run) => run.id === deferred!.id);
    expect(again?.status).toBe("pending");
    expect(again?.attempt_id).toBeNull();
    expect(again?.attempt_deadline_at?.getTime()).toBe(first);
  });
});
