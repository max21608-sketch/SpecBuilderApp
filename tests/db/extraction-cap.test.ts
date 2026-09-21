// Database tier — the per-pack cap on charged reads, through the REAL
// registration route and the REAL run function.
//
// ============================================================================
// NO MODEL IS CALLED AND NOTHING IS PUBLISHED. The model, the blob store and
// the queue are mocked at the module boundary, exactly as
// `extraction-queue.test.ts` mocks them, so this exercises the arithmetic that
// decides how many paid calls a pack starts — without starting one. Eleven
// documents through the real pipeline would be eleven charged reads, which is
// the thing this file exists to prevent.
//
// The publisher stub is also the assertion: `published` IS the set of reads
// that would have been paid for, so a cap that leaked would show up as an
// extra entry rather than as a bill.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
// ============================================================================
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { MAX_IN_FLIGHT_READS_PER_PACK } from "@/lib/extraction-claim";
import { documentReviewLabel, packTally } from "@/lib/intake-status";

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

vi.mock("@/lib/intake-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake-source")>();
  return { ...actual, prepareDocumentSource: async () => ({ type: "pdf" as const, base64: "X" }) };
});

const model = { mode: "ok" as "ok" | "refusal" };

vi.mock("@/lib/anthropic", () => ({
  EXTRACTION_MODEL: "__qa-model",
  extractSpecDocument: async () => {
    if (model.mode === "refusal") {
      return { ok: false, retryable: false, code: "refusal", error: "__QA refused", elapsedMs: 1 };
    }
    return {
      ok: true,
      output: { outputKind: "observations", data: { proposals: [], documentNotes: "__QA notes" } },
      model: "__qa-model",
      rawResponse: { __qa: true },
      usage: { input_tokens: 1, output_tokens: 1 },
      requestId: "req___qa",
      elapsedMs: 1,
    };
  },
}));

/** Every read that would have been charged for. */
const published: { key: string; extractionId: string; attemptId: string }[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { extractionId: string; attemptId: string }, key: string) => {
      published.push({ key, extractionId: message.extractionId, attemptId: message.attemptId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the per-pack cap on charged reads", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90014")}', '__QA Cap project', 'qa', 'qa') returning id`,
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
    model.mode = "ok";
    published.length = 0;
  });

  /** A pack. Every test gets its own, so one test's pack cannot fill another's. */
  async function newBatch(label: string): Promise<string> {
    const rows = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, $2, 'qa', 'qa') returning id`,
      [projectId, `__QA ${label}`],
    );
    return rows.rows[0].id;
  }

  /** Register one specification document into a pack, through the real route. */
  async function registerDoc(batchId: string, name: string) {
    const { POST } = await import("@/app/api/imports/route");
    const filename = `__QA ${name}.pdf`;
    const res = await POST(
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
    return { status: res.status, body: await res.json() };
  }

  /**
   * A document nobody has read and nobody has promised to — `pending`, no
   * attempt, no deadline. Inserted rather than registered, because that is
   * exactly the row *Read all* is for: one that predates automatic reading,
   * or one whose deferral marker has expired. Registering it would start or
   * defer the read this test is about to press.
   */
  async function insertUnreadDoc(batchId: string, name: string, documentKind = "ffe_schedule") {
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'spec_document', $2, $3, 'application/pdf', 4, 'qa') returning id`,
      [projectId, `projects/${projectId}/__QA ${name}.pdf`, `__QA ${name}.pdf`],
    );
    const run = await client.query(
      `insert into intake_runs (project_id, attachment_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, $3, 'spec_document', $4, 'pending', 'qa', 'qa') returning id`,
      [projectId, attachment.rows[0].id, batchId, documentKind],
    );
    return String(run.rows[0].id);
  }

  /**
   * One press of Read, through the REAL extract route, with the version read
   * fresh — which is what the pack screen does per document.
   */
  async function readIt(runId: string, action: "start" | "retry-dispatch" | "restart-expired" = "start") {
    const version = await client.query(`select version from intake_runs where id = $1`, [runId]);
    const { POST } = await import("@/app/api/imports/[id]/extract/route");
    const res = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: Number(version.rows[0].version),
          requestId: randomUUID(),
          action,
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { status: res.status, body: await res.json() };
  }

  /** A pack's runs, oldest first, as the screens read them. */
  async function packRuns(batchId: string) {
    const rows = await client.query(
      `select id, status, attempt_id, attempt_deadline_at,
              (status = 'pending' and attempt_id is null and attempt_deadline_at > now()) as waiting_for_slot
         from intake_runs where batch_id = $1 order by created_at, id`,
      [batchId],
    );
    return rows.rows;
  }

  const runWorker = async (extractionId: string, attemptId: string) => {
    const { runDocumentExtraction } = await import("@/lib/extraction-run");
    return runDocumentExtraction({ extractionId, attemptId, actor: "__qa@example.test" });
  };

  // ---- the shape the M8 note has warned about since 2026-09-15 -------------

  it("reads three of an eleven-document pack and holds the other eight", async () => {
    const batchId = await newBatch("eleven");
    for (let n = 0; n < 11; n += 1) {
      const { status, body } = await registerDoc(batchId, `eleven-${n}`);
      // 201 EVERY TIME. The file is stored and the row exists whether or not
      // its read started — refusing the fourth upload would tell somebody
      // their document did not arrive when it did.
      expect(status).toBe(201);
      expect(body.ok).toBe(true);
    }

    const runs = await packRuns(batchId);
    expect(runs).toHaveLength(11);
    expect(runs.filter((r) => r.status === "queued")).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);
    expect(runs.filter((r) => r.waiting_for_slot)).toHaveLength(11 - MAX_IN_FLIGHT_READS_PER_PACK);

    // The decisive assertion: three paid calls were started, not eleven.
    expect(published).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);

    // A deferred run is MARKED, and the mark is the pair nothing else writes:
    // a deadline with no attempt. Without it a hand-off could not tell it from
    // a document that has sat at `pending` since before reads were automatic.
    for (const run of runs.filter((r) => r.waiting_for_slot)) {
      expect(run.attempt_id).toBeNull();
      expect(run.attempt_deadline_at).toBeTruthy();
    }
  });

  it("says WAITING rather than reporting an error the fourth upload cannot act on", async () => {
    const batchId = await newBatch("words");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `words-${n}`);

    const { body } = await registerDoc(batchId, "words-over");
    expect(body.autoRead.dispatched).toBe(false);
    expect(body.autoRead.waiting).toBe(true);
    expect(String(body.autoRead.note)).toContain("starts on its own");
    // Never in `error`: the upload screen paints that red, and this is what a
    // correctly working pack looks like.
    expect(body.autoRead.error).toBeUndefined();
  });

  // The DoD, in the screens' own functions rather than in a screenshot.
  it("the pack screen counts it as reading and waiting, in words", async () => {
    const batchId = await newBatch("dod");
    for (let n = 0; n < 5; n += 1) await registerDoc(batchId, `dod-${n}`);

    const { GET } = await import("@/app/api/projects/[id]/batches/route");
    const res = await GET(new Request("http://localhost/test"), { params: Promise.resolve({ id: projectId }) });
    const body = await res.json();
    const batch = body.batches.find((b: { id: string }) => b.id === batchId);
    const runs = batch.runs as { status: string; waitingForSlot: boolean }[];

    const tally = packTally(runs);
    expect(tally).toMatchObject({ total: 5, reading: 3, waitingForSlot: 2, notRead: 0 });
    // "not read yet" is a document waiting for a PERSON. This one is not.
    expect(documentReviewLabel(runs.find((r) => r.waitingForSlot)!)).toBe("Waiting for a slot");
  });

  // ---- the hand-off ---------------------------------------------------------

  it("starts the next waiting document when a read FINISHES", async () => {
    const batchId = await newBatch("handoff-parsed");
    for (let n = 0; n < 4; n += 1) await registerDoc(batchId, `handoff-parsed-${n}`);
    const before = await packRuns(batchId);
    const first = before[0];
    const waiting = before[3];
    published.length = 0;

    const outcome = await runWorker(String(first.id), String(first.attempt_id));
    expect(outcome.outcome).toBe("parsed");

    const after = await packRuns(batchId);
    // The fourth document is now being read, and nobody pressed anything.
    const promoted = after.find((r) => String(r.id) === String(waiting.id));
    expect(promoted?.status).toBe("queued");
    expect(promoted?.attempt_id).toBeTruthy();
    // Commit then publish: exactly one new paid call, for the run that was
    // opened, under the attempt the row now carries.
    expect(published).toHaveLength(1);
    expect(published[0]?.extractionId).toBe(String(waiting.id));
    expect(published[0]?.attemptId).toBe(String(promoted?.attempt_id));
    expect(published[0]?.key).toBe(`spec-document:${String(waiting.id)}:${String(promoted?.attempt_id)}`);
  });

  it("starts the next waiting document when a read FAILS", async () => {
    // The branch that keeps a pack moving: eleven documents whose reads all
    // fail must not leave eight waiting for a slot nothing will free.
    const batchId = await newBatch("handoff-failed");
    for (let n = 0; n < 4; n += 1) await registerDoc(batchId, `handoff-failed-${n}`);
    const before = await packRuns(batchId);
    published.length = 0;
    model.mode = "refusal";

    const outcome = await runWorker(String(before[0].id), String(before[0].attempt_id));
    expect(outcome.outcome).toBe("failed");

    const after = await packRuns(batchId);
    expect(after[0]?.status).toBe("failed");
    expect(after[3]?.status).toBe("queued");
    expect(published).toHaveLength(1);
    expect(published[0]?.extractionId).toBe(String(before[3].id));
  });

  it("starts the next waiting document when an attempt runs OUT OF DELIVERIES", async () => {
    const batchId = await newBatch("handoff-exhausted");
    for (let n = 0; n < 4; n += 1) await registerDoc(batchId, `handoff-exhausted-${n}`);
    const before = await packRuns(batchId);
    published.length = 0;

    const { recordExtractionFailure } = await import("@/lib/extraction-run");
    await recordExtractionFailure(
      String(before[0].id),
      String(before[0].attempt_id),
      "__QA out of deliveries",
      "__qa@example.test",
    );

    const after = await packRuns(batchId);
    expect(after[0]?.status).toBe("failed");
    expect(after[3]?.status).toBe("queued");
    expect(published).toHaveLength(1);
  });

  it("hands nothing on from a message that does NOT settle the attempt", async () => {
    // `recordExtractionFailure` is fenced on the attempt. A message from a
    // superseded one writes nothing, and must therefore start nothing: the
    // read it names is still running and its slot is still taken.
    const batchId = await newBatch("handoff-fenced");
    for (let n = 0; n < 4; n += 1) await registerDoc(batchId, `handoff-fenced-${n}`);
    const before = await packRuns(batchId);
    published.length = 0;

    const { recordExtractionFailure } = await import("@/lib/extraction-run");
    await recordExtractionFailure(String(before[0].id), randomUUID(), "__QA wrong attempt", "__qa@example.test");

    const after = await packRuns(batchId);
    expect(after[0]?.status).toBe("queued");
    expect(after[3]?.waiting_for_slot).toBe(true);
    expect(published).toHaveLength(0);
  });

  // ---- variance -------------------------------------------------------------

  it("VARIANCE: two packs at once have independent caps", async () => {
    const first = await newBatch("two-packs-a");
    for (let n = 0; n < 4; n += 1) await registerDoc(first, `two-packs-a-${n}`);
    published.length = 0;

    const second = await newBatch("two-packs-b");
    for (let n = 0; n < 3; n += 1) await registerDoc(second, `two-packs-b-${n}`);

    // A full pack does not hold up the pack uploaded beside it: the cap is a
    // rate per DELIVERY, not a global one.
    expect((await packRuns(second)).filter((r) => r.status === "queued")).toHaveLength(3);
    expect(published).toHaveLength(3);
    // And the first pack is untouched by the second's arrival.
    expect((await packRuns(first)).filter((r) => r.waiting_for_slot)).toHaveLength(1);
  });

  it("VARIANCE: an attempt past its deadline does not hold a slot", async () => {
    // Nothing settles an attempt that expires (a pre-existing hole, recorded
    // as an observation). What must not happen is a stuck row shrinking the
    // pack's capacity for good — three of them would stop the pack, including
    // for the Read all that is the way out of it.
    const batchId = await newBatch("expired");
    for (let n = 0; n < 4; n += 1) await registerDoc(batchId, `expired-${n}`);
    const before = await packRuns(batchId);
    await client.query(`update intake_runs set attempt_deadline_at = now() - interval '1 hour' where id = $1`, [
      before[0].id,
    ]);
    published.length = 0;

    const { body } = await registerDoc(batchId, "expired-extra");
    expect(body.autoRead.dispatched).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]?.extractionId).toBe(String(body.importId));
  });

  it("VARIANCE: a REPLAYED registration of a deferred document opens nothing", async () => {
    const batchId = await newBatch("replay");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `replay-${n}`);

    const { POST } = await import("@/app/api/imports/route");
    const requestId = randomUUID();
    const body = () => ({
      projectId,
      batchId,
      importType: "spec_document",
      documentKind: "ffe_schedule",
      pathname: `projects/${projectId}/__QA replay-over.pdf`,
      filename: "__QA replay-over.pdf",
      contentType: "application/pdf",
      size: 4,
      registrationRequestId: requestId,
    });
    const post = () =>
      POST(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body()),
        }),
      );

    const first = await (await post()).json();
    published.length = 0;
    const again = await post();
    const second = await again.json();

    expect(again.status).toBe(200);
    expect(second.importId).toBe(first.importId);
    expect(second.reused).toBe(true);
    // A replay must neither open an attempt nor re-mark the run: it returns
    // the run it already made, deferred exactly as it was.
    expect(published).toHaveLength(0);
    const runs = await packRuns(batchId);
    expect(runs.find((r) => String(r.id) === String(first.importId))?.waiting_for_slot).toBe(true);
  });
  // ---- *Read all* honours the cap too (item 2.10.f's open half) -------------

  it("READ ALL over eleven unread documents starts three and holds the other eight", async () => {
    const batchId = await newBatch("read-all-eleven");
    const ids: string[] = [];
    for (let n = 0; n < 11; n += 1) ids.push(await insertUnreadDoc(batchId, `read-all-eleven-${n}`));
    published.length = 0;

    const answers = [];
    for (const id of ids) answers.push(await readIt(id));

    // The decisive assertion, and the reason this item exists: one press over
    // eleven documents is three paid calls, not eleven. Retrying eleven
    // documents a 429 storm has just failed is the worst case the cap is for.
    expect(published).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);

    const started = answers.filter((a) => a.status === 200);
    const deferred = answers.filter((a) => a.status === 202);
    expect(started).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);
    expect(deferred).toHaveLength(11 - MAX_IN_FLIGHT_READS_PER_PACK);

    // NEVER AN ERROR. The press was correct and the document will be read.
    for (const answer of deferred) {
      expect(answer.body.ok).toBe(true);
      expect(answer.body.waiting).toBe(true);
      expect(answer.body.attemptId).toBeNull();
      expect(String(answer.body.note)).toContain("starts on its own");
      expect(answer.body.error).toBeUndefined();
    }

    const runs = await packRuns(batchId);
    expect(runs.filter((r) => r.status === "queued")).toHaveLength(MAX_IN_FLIGHT_READS_PER_PACK);
    expect(runs.filter((r) => r.waiting_for_slot)).toHaveLength(11 - MAX_IN_FLIGHT_READS_PER_PACK);
  });

  it("READ ALL with two reads already in flight starts one and defers the rest", async () => {
    const batchId = await newBatch("read-all-partial");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK - 1; n += 1) await registerDoc(batchId, `read-all-partial-${n}`);
    const ids: string[] = [];
    for (let n = 0; n < 3; n += 1) ids.push(await insertUnreadDoc(batchId, `read-all-partial-extra-${n}`));
    published.length = 0;

    const answers = [];
    for (const id of ids) answers.push(await readIt(id));

    expect(published).toHaveLength(1);
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 202)).toHaveLength(2);
  });

  it("VARIANCE: a retry of a FAILED document at the cap is deferred, and its Retry goes with it", async () => {
    const batchId = await newBatch("retry-failed");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `retry-failed-${n}`);
    const failedId = await insertUnreadDoc(batchId, "retry-failed-dead");
    await client.query(
      `update intake_runs set status = 'failed', attempt_id = $2, claim_count = 2,
              error = '__QA rate limited', attempt_deadline_at = now() + interval '1 hour'
         where id = $1`,
      [failedId, randomUUID()],
    );
    published.length = 0;

    const { status, body } = await readIt(failedId);
    expect(status).toBe(202);
    expect(body.waiting).toBe(true);
    expect(published).toHaveLength(0);

    // Put back to `pending` with no attempt, which is the ONLY marker the
    // hand-off reads — and with the error cleared, or the screen would show a
    // red failure and a Retry button for a read that is already promised.
    const row = await client.query(
      `select status, attempt_id, claim_count, error, (attempt_deadline_at > now()) as live
         from intake_runs where id = $1`,
      [failedId],
    );
    expect(row.rows[0]).toMatchObject({ status: "pending", attempt_id: null, claim_count: 0, error: null, live: true });
  });

  it("VARIANCE: a deferral that came from READ ALL is handed a freed slot like any other", async () => {
    // The marker is the same pair whoever wrote it, so the hand-off cannot
    // tell a Read all deferral from a registration one. Asserted rather than
    // assumed: a second marker would be a second set of rules about which
    // pending rows may be spent on.
    const batchId = await newBatch("read-all-handoff");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `read-all-handoff-${n}`);
    const inFlight = await packRuns(batchId);
    const deferredId = await insertUnreadDoc(batchId, "read-all-handoff-late");
    const answer = await readIt(deferredId);
    expect(answer.status).toBe(202);
    published.length = 0;

    const outcome = await runWorker(String(inFlight[0].id), String(inFlight[0].attempt_id));
    expect(outcome.outcome).toBe("parsed");

    const after = await packRuns(batchId);
    const promoted = after.find((r) => String(r.id) === deferredId);
    expect(promoted?.status).toBe("queued");
    expect(published).toHaveLength(1);
    expect(published[0]?.extractionId).toBe(deferredId);
  });

  it("VARIANCE: retry-dispatch at the cap proceeds, because its attempt already holds a slot", async () => {
    const batchId = await newBatch("retry-dispatch");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `retry-dispatch-${n}`);
    const runs = await packRuns(batchId);
    published.length = 0;

    // Re-publishing an attempt that is already queued and unclaimed starts no
    // new read, so capping it would refuse the recovery from a publish whose
    // outcome nobody knows.
    const { status, body } = await readIt(String(runs[0].id), "retry-dispatch");
    expect(status).toBe(200);
    expect(body.status).toBe("queued");
    expect(body.attemptId).toBe(String(runs[0].attempt_id));
    expect(published).toHaveLength(1);
  });

  it("VARIANCE: restart-expired at the cap proceeds, because one abandoned document is one press", async () => {
    const batchId = await newBatch("restart-expired");
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) await registerDoc(batchId, `restart-expired-${n}`);
    const abandonedId = await insertUnreadDoc(batchId, "restart-expired-dead");
    await client.query(
      // `queued_at` because the live CHECK `intake_runs_attempt_shape_check`
      // requires it of a `queued` spec document, which is what an abandoned
      // attempt looks like.
      `update intake_runs set status = 'queued', attempt_id = $2, queued_at = now() - interval '2 hours',
              attempt_deadline_at = now() - interval '1 hour' where id = $1`,
      [abandonedId, randomUUID()],
    );
    published.length = 0;

    const { status } = await readIt(abandonedId, "restart-expired");
    expect(status).toBe(200);
    expect(published).toHaveLength(1);
  });

  // The DoD's other half: the drawings step's chips agree with the pack screen.
  it("the drawings step says WAITING FOR A SLOT for a document Read all deferred", async () => {
    const batchId = await newBatch("drawings-chip");
    const ids: string[] = [];
    for (let n = 0; n < 5; n += 1) ids.push(await insertUnreadDoc(batchId, `drawings-chip-${n}`, "shop_drawings"));
    published.length = 0;
    for (const id of ids) await readIt(id);

    const { loadBatchDrawings } = await import("@/lib/drawing-resolution");
    const { runs } = await loadBatchDrawings(projectId, batchId);
    expect(runs).toHaveLength(5);
    expect(runs.filter((run) => run.status === "queued")).toHaveLength(3);
    expect(runs.filter((run) => run.waitingForSlot)).toHaveLength(2);

    // One reading of a document's state, shared with the pack screen: "Not
    // read yet" is a document waiting for a PERSON.
    const waiting = runs.find((run) => run.waitingForSlot)!;
    expect(documentReviewLabel(waiting)).toBe("Waiting for a slot");
    expect(documentReviewLabel(runs.find((run) => run.status === "queued")!)).not.toBe("Waiting for a slot");
  });
});
