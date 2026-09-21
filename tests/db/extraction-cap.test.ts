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
import { describeIfDb } from "./db-tier";
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
       values ('__QA P90014', '__QA Cap project', 'qa', 'qa') returning id`,
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
});
