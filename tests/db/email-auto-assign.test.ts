// Database tier — a confidently routed email placing itself on a project,
// through the REAL ingestion path.
//
// ============================================================================
// NO MODEL IS CALLED AND NOTHING IS PUBLISHED. The queue, the blob store and
// Microsoft Graph are mocked at the module boundary, exactly as
// `extraction-cap.test.ts` mocks them. Everything between them is the app's
// own: `routeMessage`, `autoAssignDecision`, `assignMessage`, `takeReadSlot`,
// `deferRead`, `unassignMessage`.
//
// The publisher stub is also the assertion. `published` IS the set of reads
// that would have been paid for, so the claim this file exists to prove — that
// only the two strongest signals spend money with nobody watching — shows up
// as an entry that should not be there rather than as a bill.
//
// Graph itself is mocked rather than enabled: `MAIL_INGESTION_MODE` stays
// `disabled` on every deployment, and this suite only asserts what the
// ingestion function does with a message once it has one.
//
// Rows are prefixed `__QA ` under project number `__QA P90211` (2.11's own
// number, so a suite running beside this one cannot collide on it), and swept
// FK-safe at both ends.
// ============================================================================
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { MAX_IN_FLIGHT_READS_PER_PACK } from "@/lib/extraction-claim";
import { ROUTER_ACTOR } from "@/lib/email-routing";

/** How the two mocked boundaries behave for the test in hand. */
const fail = { publish: false, copy: false };

/** Every read that would have been charged for. */
const published: { key: string; extractionId: string; attemptId: string }[] = [];
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { extractionId: string; attemptId: string }, key: string) => {
      // A socket hang-up, not a 4xx: the AMBIGUOUS half of the two publish
      // failure modes, which stays queued and asks a person to retry.
      if (fail.publish) throw new Error("__QA the queue could not be reached");
      published.push({ key, extractionId: message.extractionId, attemptId: message.attemptId });
    },
  };
});

/** Every blob written or copied. The copy is what makes the run readable. */
const stored: string[] = [];
const copied: { from: string; to: string }[] = [];
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string) => {
    stored.push(pathname);
    return { pathname, url: `https://blob.test/${pathname}` };
  },
  copy: async (from: string, to: string) => {
    if (fail.copy) throw new Error("__QA the store refused the copy");
    copied.push({ from, to });
    return { pathname: to, url: `https://blob.test/${to}` };
  },
  get: async () => null,
  head: async () => null,
}));

/** One message at a time, handed to the ingestion function as Graph would. */
const inflight: { bytes: Buffer; receivedDateTime: string; subject: string } = {
  bytes: Buffer.alloc(0),
  receivedDateTime: new Date().toISOString(),
  subject: "",
};

vi.mock("@/lib/graph-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph-client")>();
  return {
    ...actual,
    // Enabled for this process only. Nothing here reaches Microsoft: the two
    // fetchers below answer from `inflight`.
    mailIngestionEnabled: () => true,
    mailboxPath: (suffix: string) => `/users/__qa-mailbox${suffix}`,
    graphJson: async () => ({
      id: "__qa_graph_id",
      internetMessageId: "<__qa@example.test>",
      receivedDateTime: inflight.receivedDateTime,
      subject: inflight.subject,
      hasAttachments: false,
    }),
    graphBytes: async () => ({ bytes: inflight.bytes, contentType: "message/rfc822" }),
  };
});

const databaseUrl = process.env.DATABASE_URL;

const PROJECT_NUMBER = "__QA P90211";
const INBOX = "__qa-p90211@example.test";
const CONTACT = "__qa-router-contact@example.test";
const MAILBOX = "__qa_router_mailbox";

/** A real RFC 5322 message, so `parseEnvelope` does the reading it always does. */
function eml({ to, from, subject }: { to: string; from: string; subject: string }): Buffer {
  return Buffer.from(
    [
      "Message-ID: <__qa.router.1@example.test>",
      "Date: Mon, 21 Sep 2026 09:00:00 +0000",
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "The seat height on the lounge chair is 445mm.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

describeIfDb("a confidently routed email assigns itself", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  /** Hand one message to the real ingestion function. */
  async function ingest(graphMessageId: string, message: { to: string; from: string; subject: string }) {
    inflight.bytes = eml(message);
    inflight.subject = message.subject;
    const { ingestGraphMessage } = await import("@/lib/mail-ingest");
    return ingestGraphMessage({
      kind: "mail-ingest",
      mailbox: MAILBOX,
      graphMessageId,
      source: "notification",
      requestedBy: "system:microsoft-graph",
    });
  }

  async function messageRow(id: string) {
    const rows = await client.query(
      `select project_id, routing_status, routing_reason, assignment_kind, assigned_by,
              intake_run_id, mailbox_storage_path, version
         from email_messages where id = $1`,
      [id],
    );
    return rows.rows[0];
  }

  async function runRow(id: string) {
    const rows = await client.query(
      `select project_id, status, attempt_id, attempt_deadline_at, batch_id, document_kind,
              source_kind, created_by, registration_request_id, error
         from intake_runs where id = $1`,
      [id],
    );
    return rows.rows[0];
  }

  async function sweep() {
    const stale = await client.query(`select id from projects where bws_project_number = $1`, [PROJECT_NUMBER]);
    for (const row of stale.rows) {
      await client.query(`delete from email_messages where project_id = $1`, [row.id]);
      await client.query(`delete from attachments where entity_id = $1`, [row.id]);
      await client.query(`delete from intake_runs where project_id = $1`, [row.id]);
      await client.query(`delete from project_contacts where project_id = $1`, [row.id]);
      await client.query(`delete from projects where id = $1`, [row.id]);
    }
    // Held messages never acquire a project, so they are swept by mailbox.
    const held = await client.query(`select id from email_messages where mailbox = $1`, [MAILBOX]);
    for (const row of held.rows) {
      await client.query(`delete from attachments where entity_id = $1`, [row.id]);
      await client.query(`delete from email_messages where id = $1`, [row.id]);
    }
  }

  beforeAll(async () => {
    await client.connect();
    await sweep();
    const project = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ($1, '__QA Router project QA9021', $2, 'qa', 'qa') returning id`,
      [PROJECT_NUMBER, INBOX],
    );
    projectId = project.rows[0].id;
    await client.query(
      `insert into project_contacts (project_id, name, email, role, created_by, updated_by)
       values ($1, '__QA Designer', $2, 'designer', 'qa', 'qa')`,
      [projectId, CONTACT],
    );
  });

  afterAll(async () => {
    await sweep();
    await client.end();
  });

  beforeEach(async () => {
    published.length = 0;
    stored.length = 0;
    copied.length = 0;
    fail.publish = false;
    fail.copy = false;
    // EVERY TEST STARTS WITH THE PROJECT'S SLOTS FREE. An email has no pack,
    // so its read counts against the project's batch-less runs — and each test
    // here leaves one of those in flight, so by the fourth the cap would defer
    // a read the test expected to be dispatched. Found exactly that way: the
    // dispatch-failure test read `pending` where it wanted `queued`. Settling
    // them is what a finished read would have done.
    await client.query(
      `update intake_runs set status = 'confirmed', updated_by = 'qa'
        where project_id = $1 and status in ('queued', 'parsing')`,
      [projectId],
    );
  });

  // ---- the two strongest signals -----------------------------------------

  it("assigns a message addressed to the project inbox, and starts exactly one read", async () => {
    const outcome = await ingest("__qa_router_inbox", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Lounge chair seat height",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(true);

    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("assigned");
    expect(String(message.project_id)).toBe(projectId);
    // AUTO, and under the ROUTER's name: the trail has to say what decided,
    // and "the mailbox connector" is where it came from rather than why it
    // landed here.
    expect(message.assignment_kind).toBe("auto");
    expect(message.assigned_by).toBe(ROUTER_ACTOR);
    expect(message.routing_reason).toContain("addressed to the project inbox");

    const run = await runRow(String(message.intake_run_id));
    expect(run.status).toBe("queued");
    expect(run.document_kind).toBe("email");
    expect(run.source_kind).toBe("spec_document");
    // An email has no pack, which is what puts it under the per-PROJECT cap.
    expect(run.batch_id).toBeNull();
    expect(run.created_by).toBe(ROUTER_ACTOR);

    // ONE charged read, and one only.
    expect(published).toHaveLength(1);
    expect(published[0]!.extractionId).toBe(String(message.intake_run_id));

    // COPIED UNDER THE PROJECT, never left at the arrival path: every read in
    // blob-source.ts is scoped to projects/<id>/, so a run pointed at the
    // mailbox prefix could not be read at all.
    expect(copied).toHaveLength(1);
    expect(copied[0]!.from).toBe(String(message.mailbox_storage_path));
    expect(copied[0]!.to.startsWith(`projects/${projectId}/`)).toBe(true);
    // And the arrival record survives the copy.
    expect(String(message.mailbox_storage_path).startsWith("mailbox/")).toBe(true);
  });

  it("assigns a message forwarded from the project inbox", async () => {
    // The redirect shape: the loop header names the project mailbox and the
    // original sender survives.
    inflight.bytes = Buffer.from(
      [
        "Message-ID: <__qa.router.fwd@example.test>",
        "Date: Mon, 21 Sep 2026 09:05:00 +0000",
        "From: someone@elsewhere.test",
        "To: kam@benwhistler.test",
        `X-MS-Exchange-Inbox-Rules-Loop: ${INBOX}`,
        "Subject: FW: lounge chair",
        "",
        "Body.",
        "",
      ].join("\r\n"),
      "utf8",
    );
    inflight.subject = "FW: lounge chair";
    const { ingestGraphMessage } = await import("@/lib/mail-ingest");
    const outcome = await ingestGraphMessage({
      kind: "mail-ingest",
      mailbox: MAILBOX,
      graphMessageId: "__qa_router_forwarded",
      source: "notification",
      requestedBy: "system:microsoft-graph",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(true);
    const message = await messageRow(outcome.messageId);
    expect(message.assignment_kind).toBe("auto");
    expect(message.routing_reason).toContain("forwarded from the project inbox");
    expect(published).toHaveLength(1);
  });

  // ---- the trap this item exists not to fall into -------------------------

  it("HOLDS a message placed by the sender alone, and spends nothing", async () => {
    const outcome = await ingest("__qa_router_sender", {
      to: "kam@benwhistler.test",
      from: CONTACT,
      subject: "Chair query",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    // A contact who works on two projects writes about both, and a wrong
    // placement costs a charged read AND a staged run on the wrong client.
    expect(outcome.assigned).toBe(false);

    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("unassigned");
    expect(message.project_id).toBeNull();
    expect(message.intake_run_id).toBeNull();
    expect(message.assignment_kind).toBeNull();
    // Routing's own sentence is kept, so the held row can say which project it
    // read and why that was not enough.
    expect(message.routing_reason).toContain("the sender is a contact on one project");
    expect(published).toHaveLength(0);
    expect(copied).toHaveLength(0);
  });

  // THE PROJECT CODE, not the BWS number: a `__QA ` prefix can never match the
  // subject matcher, which compares the whole number, so the code in the
  // project NAME is the subject signal a QA fixture can actually raise. It is
  // the same tier of the same rule — a token in a subject line.
  it("HOLDS a message placed by the subject alone", async () => {
    const outcome = await ingest("__qa_router_subject", {
      to: "kam@benwhistler.test",
      from: "someone@elsewhere.test",
      subject: "QA9021 lounge chair",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(false);
    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("unassigned");
    expect(message.routing_reason).toContain("the subject names the project code");
    expect(published).toHaveLength(0);
  });

  it("HOLDS a message addressed to two project inboxes", async () => {
    const second = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ('__QA P90212', '__QA Router project two', '__qa-p90212@example.test', 'qa', 'qa') returning id`,
    );
    const secondId = String(second.rows[0].id);
    try {
      const outcome = await ingest("__qa_router_ambiguous", {
        to: `${INBOX}, __qa-p90212@example.test`,
        from: "someone@elsewhere.test",
        subject: "Two projects",
      });
      expect(outcome.outcome).toBe("stored");
      if (outcome.outcome !== "stored") return;
      expect(outcome.assigned).toBe(false);
      const message = await messageRow(outcome.messageId);
      // Two candidates at the same strength is a DECISION, never a tie to
      // break — and nothing is ever auto-assigned from one.
      expect(message.routing_status).toBe("ambiguous");
      expect(message.project_id).toBeNull();
      expect(published).toHaveLength(0);
      await client.query(`delete from email_messages where id = $1`, [outcome.messageId]);
    } finally {
      await client.query(`delete from email_messages where project_id = $1`, [secondId]);
      await client.query(`delete from projects where id = $1`, [secondId]);
    }
  });

  // ---- the replay rule ----------------------------------------------------

  it("assigns the same message once, however many times it is delivered", async () => {
    const first = await ingest("__qa_router_twice", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Delivered twice",
    });
    expect(first.outcome).toBe("stored");
    if (first.outcome !== "stored") return;
    expect(published).toHaveLength(1);

    published.length = 0;
    const again = await ingest("__qa_router_twice", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Delivered twice",
    });
    // The stub row is the idempotency: a second delivery sees it and acks.
    expect(again.outcome).toBe("duplicate");
    expect(published).toHaveLength(0);

    const runs = await client.query(
      `select count(*)::int as n from intake_runs
        where project_id = $1 and registration_request_id = $2`,
      [projectId, `email:${first.messageId}`],
    );
    expect(runs.rows[0].n).toBe(1);
  });

  // ---- taking it back -----------------------------------------------------

  it("lets an automatic assignment be undone, keeping the arrival copy", async () => {
    const outcome = await ingest("__qa_router_undo", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Placed automatically",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    const before = await messageRow(outcome.messageId);
    expect(before.routing_status).toBe("assigned");

    const { unassignMessage } = await import("@/lib/email-registration");
    await unassignMessage(outcome.messageId, {
      actor: "__qa@example.test",
      expectedVersion: Number(before.version),
    });

    const after = await messageRow(outcome.messageId);
    expect(after.routing_status).toBe("unassigned");
    expect(after.project_id).toBeNull();
    expect(after.intake_run_id).toBeNull();
    expect(after.assignment_kind).toBeNull();
    // The mailbox path is the arrival record: a message taken off a project
    // must still have somewhere to have come from.
    expect(after.mailbox_storage_path).toBe(before.mailbox_storage_path);
    // The run stays: it is what the model was paid to produce.
    const kept = await runRow(String(before.intake_run_id));
    expect(kept).toBeTruthy();
  });

  // ---- the cap ------------------------------------------------------------

  it("assigns at the project's cap and DEFERS the read rather than failing it", async () => {
    // Fill the project's batch-less slots. Inserted rather than ingested: the
    // point is the arithmetic, and three more ingested messages would be three
    // more reads to account for.
    for (let n = 0; n < MAX_IN_FLIGHT_READS_PER_PACK; n += 1) {
      await client.query(
        // `queued` demands an attempt id AND a queued_at
        // (intake_runs_attempt_shape_check, read from the live constraint).
        `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status,
                                  attempt_id, queued_at, attempt_deadline_at, created_by, updated_by)
         values ($1, null, 'spec_document', 'email', 'queued', gen_random_uuid(), now(),
                 now() + interval '24 hours', 'qa', 'qa')`,
        [projectId],
      );
    }

    const outcome = await ingest("__qa_router_capped", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Arrived on a busy morning",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    // ASSIGNED, not refused: the message is on the project and its read is
    // promised. A screen that reported an error here would send somebody
    // looking for a Retry button they must not press.
    expect(outcome.assigned).toBe(true);
    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("assigned");
    expect(message.assignment_kind).toBe("auto");

    const run = await runRow(String(message.intake_run_id));
    // The deferral marker: a deadline with no attempt, which nothing else in
    // the app writes.
    expect(run.status).toBe("pending");
    expect(run.attempt_id).toBeNull();
    expect(run.attempt_deadline_at).toBeTruthy();
    // And nothing was charged for.
    expect(published).toHaveLength(0);
  });

  // ---- the two failure paths ---------------------------------------------

  it("keeps the message ASSIGNED when the dispatch fails, and puts the reason on the run", async () => {
    fail.publish = true;
    const outcome = await ingest("__qa_router_nodispatch", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Queue unreachable",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    // THE 201 RULE. The message arrived, the run exists, and the read may or
    // may not have been queued; telling somebody their email did not arrive
    // when it did would be worse than a Retry they have to press.
    expect(outcome.assigned).toBe(true);
    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("assigned");
    const run = await runRow(String(message.intake_run_id));
    // An AMBIGUOUS publish failure stays queued — the message may be in
    // flight — with its reason on the row for the screen to print.
    expect(run.status).toBe("queued");
    expect(String(run.error)).toContain("may not have been queued");
  });

  it("HOLDS the message when its file cannot be copied onto the project", async () => {
    fail.copy = true;
    const outcome = await ingest("__qa_router_nocopy", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Copy refused",
    });
    // NOT a failed ingest: the message is stored and readable, and only the
    // placement failed. Throwing would burn a delivery on an answer that will
    // not change and leave the message off the inbox's held list.
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(false);
    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("unassigned");
    expect(message.intake_run_id).toBeNull();
    expect(String(message.routing_reason)).toContain("could not be placed automatically");
    expect(published).toHaveLength(0);
  });
});
