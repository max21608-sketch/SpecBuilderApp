// Database tier — attempt ownership, claims and fencing, through the REAL run
// function and the REAL producer route.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// NO MODEL IS CALLED and NO BLOB IS READ: both are mocked at the module
// boundary, so this exercises the ownership protocol — the part that decides
// how much a duplicate delivery costs — without spending anything. The mocks
// are also what let a test simulate a transient fault deterministically, which
// is the only way to prove the release path.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { CLAIM_EXPIRY_SECONDS, MAX_CLAIMS_PER_ATTEMPT } from "@/lib/extraction-claim";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

// The document never leaves this file.
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
    // Registration asks the store what it actually holds, rather than
    // believing the client's claim about it.
    headTrustedBlob: async (pathname: string) => ({
      pathname,
      contentType: "application/pdf",
      size: 4,
    }),
  };
});

vi.mock("@/lib/intake-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake-source")>();
  return { ...actual, prepareDocumentSource: async () => ({ type: "pdf" as const, base64: "X" }) };
});

// Controlled per test. `mode` decides what the "model" does.
const model = { mode: "ok" as "ok" | "refusal" | "transient" };

vi.mock("@/lib/anthropic", () => ({
  EXTRACTION_MODEL: "__qa-model",
  extractSpecDocument: async () => {
    if (model.mode === "refusal") {
      return { ok: false, retryable: false, code: "refusal", error: "__QA refused", elapsedMs: 1 };
    }
    if (model.mode === "transient") {
      return { ok: false, retryable: true, code: "server_error", error: "__QA 503", elapsedMs: 1 };
    }
    return {
      ok: true,
      // The payload is discriminated by the SHAPE the model returned, so a
      // caller that forgets to branch cannot read `proposals` off a drawing.
      output: { outputKind: "observations", data: { proposals: [], documentNotes: "__QA notes" } },
      model: "__qa-model",
      rawResponse: { __qa: true },
      usage: { input_tokens: 1, output_tokens: 1 },
      requestId: "req___qa",
      elapsedMs: 1,
    };
  },
}));

// The queue is not exercised here: publishing is Vercel's, and what matters is
// what the database does. A publish that "succeeds" keeps the route on its
// happy path.
const published: { key: string; attemptId: string }[] = [];
// `reject` is a DEFINITE refusal (the queue answered 4xx); `hang` is the
// ambiguous kind, which must leave the attempt queued rather than failed.
const queueMode = { mode: "ok" as "ok" | "reject" | "hang" };
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { attemptId: string }, key: string) => {
      if (queueMode.mode === "reject") {
        throw Object.assign(new Error("__QA queue refused"), { status: 400 });
      }
      if (queueMode.mode === "hang") throw new Error("__QA socket hang up");
      published.push({ key, attemptId: message.attemptId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("extraction attempts", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90006', '__QA Queue project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'spec_document', $2, '__QA doc.pdf', 'application/pdf', 4, 'qa') returning id`,
      [projectId, `projects/${projectId}/__qa-doc.pdf`],
    );

    const run = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'ffe_schedule', 'pending', 'qa', 'qa') returning id`,
      [projectId, attachment.rows[0].id],
    );
    runId = run.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function reset(state: Record<string, unknown> = {}) {
    await client.query(
      `update intake_runs
         set status = $2, attempt_id = $3, claim_token = $4, claim_count = $5,
             queued_at = $6, attempt_deadline_at = $7, processing_started_at = $8,
             parsed = null, error = null
       where id = $1`,
      [
        runId,
        state.status ?? "pending",
        state.attemptId ?? null,
        state.claimToken ?? null,
        state.claimCount ?? 0,
        state.queuedAt ?? null,
        state.deadline ?? null,
        state.processingStartedAt ?? null,
      ],
    );
  }

  async function row() {
    const rows = await client.query(`select * from intake_runs where id = $1`, [runId]);
    return rows.rows[0];
  }

  async function queueAttempt(state: Record<string, unknown> = {}) {
    const attemptId = randomUUID();
    await reset({
      status: "queued",
      attemptId,
      queuedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      ...state,
    });
    return attemptId;
  }

  const run = async (attemptId: string) => {
    const { runDocumentExtraction } = await import("@/lib/extraction-run");
    return runDocumentExtraction({ extractionId: runId, attemptId, actor: "__qa@example.test" });
  };

  beforeEach(() => {
    model.mode = "ok";
    queueMode.mode = "ok";
    published.length = 0;
  });

  // ---- the producer --------------------------------------------------------

  it("opens one attempt and publishes it once", async () => {
    await reset({ status: "pending" });
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const requestId = randomUUID();
    const res = await POST(post({ expectedVersion: (await row()).version, requestId }), params(runId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attemptId).toBe(requestId);
    expect((await row()).status).toBe("queued");
    expect(published).toHaveLength(1);
    // Stable per (run, attempt) -- never Date.now(), or one press of Extract
    // becomes two paid pipelines.
    expect(published[0]?.key).toBe(`spec-document:${runId}:${requestId}`);
  });

  it("returns the SAME attempt when one user action is retried", async () => {
    await reset({ status: "pending" });
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const requestId = randomUUID();
    await POST(post({ expectedVersion: (await row()).version, requestId }), params(runId));
    const first = await row();

    const again = await POST(post({ expectedVersion: first.version, requestId }), params(runId));
    const body = await again.json();
    expect(body.attemptId).toBe(requestId);
    expect(body.reused).toBe(true);
    // No second logical attempt, and nothing republished.
    expect((await row()).attempt_id).toBe(requestId);
    expect(published).toHaveLength(1);
  });

  it("refuses to start a document that is already being read", async () => {
    await queueAttempt();
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const res = await POST(post({ expectedVersion: (await row()).version, requestId: randomUUID() }), params(runId));
    expect((await res.json()).code).toBe("already_started");
    expect(published).toHaveLength(0);
  });

  it("refuses to restart an attempt that has not been abandoned", async () => {
    const attemptId = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: 1,
      processingStartedAt: new Date().toISOString(),
    });
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const res = await POST(
      post({ expectedVersion: (await row()).version, requestId: randomUUID(), action: "restart-expired" }),
      params(runId),
    );
    expect((await res.json()).code).toBe("not_restartable");
    expect((await row()).attempt_id).toBe(attemptId);
  });

  it("restarts an abandoned claim under a NEW attempt", async () => {
    const old = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: 1,
      processingStartedAt: new Date(Date.now() - (CLAIM_EXPIRY_SECONDS + 60) * 1000).toISOString(),
    });
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const requestId = randomUUID();
    const res = await POST(
      post({ expectedVersion: (await row()).version, requestId, action: "restart-expired" }),
      params(runId),
    );
    expect(res.status).toBe(200);

    const after = await row();
    expect(after.attempt_id).toBe(requestId);
    expect(after.attempt_id).not.toBe(old);
    // A new attempt gets a fresh budget; the old claim is fenced out by the id.
    expect(after.claim_count).toBe(0);
    expect(after.claim_token).toBeNull();
  });

  it("refuses to retry a dispatch a worker has already claimed", async () => {
    await queueAttempt({ claimCount: 1 });
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const res = await POST(
      post({ expectedVersion: (await row()).version, requestId: randomUUID(), action: "retry-dispatch" }),
      params(runId),
    );
    expect((await res.json()).code).toBe("already_claimed");
    expect(published).toHaveLength(0);
  });

  // ---- claiming -------------------------------------------------------------

  it("stages a result and leaves the attempt owned", async () => {
    const attemptId = await queueAttempt();
    expect(await run(attemptId)).toEqual({ outcome: "parsed" });

    const after = await row();
    expect(after.status).toBe("parsed");
    expect(after.model).toBe("__qa-model");
    expect(after.model_metadata.requestId).toBe("req___qa");
    expect(after.raw_response).toEqual({ __qa: true });
    expect(after.claim_count).toBe(1);
  });

  it("NEVER claims a run nobody has asked to read", async () => {
    await reset({ status: "pending", attemptId: randomUUID() });
    const current = await row();
    const outcome = await run(String(current.attempt_id));
    expect(outcome.outcome).toBe("skipped");
    expect((await row()).status).toBe("pending");
  });

  it("never claims a terminal failure, so a duplicate cannot re-bill it", async () => {
    const attemptId = await queueAttempt({ status: "failed", claimCount: 1 });
    const outcome = await run(attemptId);
    expect(outcome.outcome).toBe("skipped");
    expect((await row()).status).toBe("failed");
  });

  it("reports a live claim as BUSY, not as done", async () => {
    // Ack'ing a duplicate would spend the delivery that recovery depends on.
    const attemptId = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: 1,
      processingStartedAt: new Date().toISOString(),
    });
    const outcome = await run(attemptId);
    expect(outcome.outcome).toBe("busy");
  });

  it("reclaims an EXPIRED claim under the same attempt", async () => {
    const attemptId = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: 1,
      processingStartedAt: new Date(Date.now() - (CLAIM_EXPIRY_SECONDS + 60) * 1000).toISOString(),
    });
    expect(await run(attemptId)).toEqual({ outcome: "parsed" });
    expect((await row()).claim_count).toBe(2);
  });

  it("ignores a message from a superseded attempt", async () => {
    await queueAttempt();
    const outcome = await run(randomUUID());
    expect(outcome).toMatchObject({ outcome: "skipped", reason: expect.stringContaining("superseded") });
    expect((await row()).status).toBe("queued");
  });

  it("refuses to claim past the attempt deadline or the claim budget", async () => {
    const expired = await queueAttempt({ deadline: new Date(Date.now() - 1000).toISOString() });
    expect((await run(expired)).outcome).toBe("skipped");

    const spent = await queueAttempt({ claimCount: MAX_CLAIMS_PER_ATTEMPT });
    const outcome = await run(spent);
    expect(outcome).toMatchObject({ outcome: "skipped", reason: expect.stringContaining("all of its attempts") });
  });

  // ---- fencing --------------------------------------------------------------

  // The hard-kill case. A worker's claim expires while its request is still in
  // flight; a later delivery reclaims with a NEW token. The old invocation's
  // writes must now affect ZERO rows.
  it("a superseded claim's writes affect nothing", async () => {
    const attemptId = await queueAttempt();
    const zombieToken = randomUUID();
    await client.query(
      `update intake_runs set status = 'parsing', claim_token = $2, claim_count = 1,
             processing_started_at = $3 where id = $1`,
      [runId, zombieToken, new Date(Date.now() - (CLAIM_EXPIRY_SECONDS + 60) * 1000).toISOString()],
    );

    // The live worker reclaims.
    expect(await run(attemptId)).toEqual({ outcome: "parsed" });
    const live = await row();

    // Now the "dead" worker's write lands, fenced on its own stale token.
    const zombie = await client.query(
      `update intake_runs set status = 'failed', error = '__QA zombie'
        where id = $1 and attempt_id = $2 and claim_token = $3 and status = 'parsing'
        returning id`,
      [runId, attemptId, zombieToken],
    );
    expect(zombie.rowCount).toBe(0);
    expect((await row()).status).toBe("parsed");
    expect((await row()).claim_token).toBe(live.claim_token);
  });

  it("releases the claim BEFORE throwing on a transient fault", async () => {
    // Order matters: retry backoff is far shorter than the claim expiry, so a
    // row left claimed makes every retry a silent no-op.
    model.mode = "transient";
    const attemptId = await queueAttempt();
    await expect(run(attemptId)).rejects.toThrow(/__QA 503/);

    const after = await row();
    expect(after.status).toBe("queued");
    expect(after.claim_token).toBeNull();
    // The error is recorded on a QUEUED row, which is why the screen must show
    // a lingering error here neutrally rather than as a failure.
    expect(after.error).toMatch(/__QA 503/);
  });

  it("records a refusal terminally, WITHOUT throwing", async () => {
    // Throwing would buy the same refusal three more times at full price.
    model.mode = "refusal";
    const attemptId = await queueAttempt();
    expect(await run(attemptId)).toMatchObject({ outcome: "failed" });

    const after = await row();
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/__QA refused/);
    // The evidence of WHY an extraction was wrong is kept.
    expect(after.raw_response).not.toBeNull();
  });

  it("does not mark an attempt failed while another claim is live", async () => {
    const attemptId = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: 2,
      processingStartedAt: new Date().toISOString(),
    });
    const { recordExtractionFailure } = await import("@/lib/extraction-run");
    await recordExtractionFailure(runId, attemptId, "__QA exhausted", "__qa@example.test");

    // The active owner is mid-run and has already been paid for.
    expect((await row()).status).toBe("parsing");
  });

  it("marks an exhausted attempt failed once its claim has expired", async () => {
    const attemptId = await queueAttempt({
      status: "parsing",
      claimToken: randomUUID(),
      claimCount: MAX_CLAIMS_PER_ATTEMPT,
      processingStartedAt: new Date(Date.now() - (CLAIM_EXPIRY_SECONDS + 60) * 1000).toISOString(),
    });
    const { recordExtractionFailure } = await import("@/lib/extraction-run");
    await recordExtractionFailure(runId, attemptId, "__QA exhausted", "__qa@example.test");
    expect((await row()).status).toBe("failed");
  });

  it("cannot be failed by a message from a superseded attempt", async () => {
    await queueAttempt();
    const { recordExtractionFailure } = await import("@/lib/extraction-run");
    await recordExtractionFailure(runId, randomUUID(), "__QA wrong attempt", "__qa@example.test");
    expect((await row()).status).toBe("queued");
  });


  // ---- registration dispatches its own read --------------------------------
  // A tender pack is eleven documents and packs of thirty are expected, so the
  // read is dispatched as each one registers. These tests are the reason the
  // upload screen may promise that: the row must be committed QUEUED with an
  // attempt, exactly once, and a dispatch that fails must not lose the file.

  const registerDoc = async (requestId: string, filename = "__QA auto.pdf") => {
    const { POST } = await import("@/app/api/imports/route");
    return POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          importType: "spec_document",
          documentKind: "shop_drawings",
          pathname: `projects/${projectId}/${filename}`,
          filename,
          contentType: "application/pdf",
          size: 4,
          registrationRequestId: requestId,
        }),
      }),
    );
  };

  const runRow = async (id: string) => (await client.query(`select * from intake_runs where id = $1`, [id])).rows[0];

  it("registering a specification document queues its read, once", async () => {
    const res = await registerDoc(randomUUID());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.autoRead).toEqual({ dispatched: true });

    const registered = await runRow(body.importId);
    // Committed QUEUED, not pending: a worker must never be handed a message
    // for a row that is still waiting to be asked for.
    expect(registered.status).toBe("queued");
    expect(registered.attempt_id).toBeTruthy();
    expect(registered.attempt_deadline_at).toBeTruthy();
    expect(published).toHaveLength(1);
    expect(published[0]?.attemptId).toBe(registered.attempt_id);
    expect(published[0]?.key).toBe(`spec-document:${body.importId}:${registered.attempt_id}`);
  });

  it("a REPLAYED registration reuses the run and does not open a second attempt", async () => {
    const requestId = randomUUID();
    const first = await (await registerDoc(requestId)).json();
    const openedAttempt = (await runRow(first.importId)).attempt_id;
    published.length = 0;

    const again = await registerDoc(requestId);
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.importId).toBe(first.importId);
    expect(body.reused).toBe(true);
    // The decisive assertion: a lost response must not buy a second paid
    // pipeline over the one already running.
    expect(published).toHaveLength(0);
    expect((await runRow(first.importId)).attempt_id).toBe(openedAttempt);
  });

  it("keeps the registration when the queue REFUSES the read outright", async () => {
    queueMode.mode = "reject";
    const res = await registerDoc(randomUUID());
    const body = await res.json();

    // 201: the document is stored and registered. Whether its read reached the
    // queue is a separate fact, and failing the upload over it would tell
    // somebody their file did not arrive when it did.
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.autoRead.dispatched).toBe(false);
    expect(body.autoRead.code).toBe("dispatch_rejected");

    const failed = await runRow(body.importId);
    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("could not be queued");
  });

  it("leaves an AMBIGUOUS dispatch queued, so a retry can recover it", async () => {
    queueMode.mode = "hang";
    const res = await registerDoc(randomUUID());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.autoRead.code).toBe("dispatch_uncertain");

    // Never `failed`: the message may be in flight, and marking it failed kills
    // a run that is about to start.
    const uncertain = await runRow(body.importId);
    expect(uncertain.status).toBe("queued");
    expect(String(uncertain.error)).toContain("may not have been queued");
  });

  // ---- the real race --------------------------------------------------------

  it("lets exactly ONE of two simultaneous deliveries claim the attempt", async () => {
    const attemptId = await queueAttempt();
    // Both start before either finishes: the claim is one predicated UPDATE, so
    // the database decides, not the order they were called in.
    const [first, second] = await Promise.all([run(attemptId), run(attemptId)]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["busy", "parsed"]);
    // One claim, one model call.
    expect((await row()).claim_count).toBe(1);
  });
});
