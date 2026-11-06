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
// EVERY KEY THIS FILE WRITES IS THIS PROCESS'S OWN (audit H2, 2026-11-06).
// The project numbers come from `qaNumber()`, and the project inboxes, the
// contact, the mailbox and every Message-ID carry the same per-process suffix.
// They used to be literals (`__QA P90211`, one inbox, one mailbox) swept by a
// `beforeAll`, so two runs at once either died on
// `projects_bws_project_number_key` or, worse, the second run's sweep deleted
// the first run's fixtures mid-test. A literal ROUTING key fails more quietly
// than a literal project number: a crashed run's project still holding the
// same inbox or the same contact turns the next run's confident outcome into
// an AMBIGUOUS one, and the assertion that fails reads as a routing defect.
// Nothing is swept before the run any more; what a crashed run left is
// `npm run db:qa-clean`'s. Each run sweeps its own rows, FK-safe, at the end.
// ============================================================================
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
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
const inflight: {
  bytes: Buffer;
  receivedDateTime: string;
  subject: string;
  internetMessageId: string;
  /** Who Graph reports the delivered item was sent to (audit A8). */
  reportedTo: string[];
} = {
  bytes: Buffer.alloc(0),
  internetMessageId: "",
  reportedTo: [],
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
      internetMessageId: inflight.internetMessageId,
      receivedDateTime: inflight.receivedDateTime,
      subject: inflight.subject,
      hasAttachments: false,
      toRecipients: inflight.reportedTo.map((address) => ({ emailAddress: { address } })),
    }),
    graphBytes: async () => ({ bytes: inflight.bytes, contentType: "message/rfc822" }),
  };
});

const databaseUrl = process.env.DATABASE_URL;

const PROJECT_NUMBER = qaNumber("P90211");
const SECOND_NUMBER = qaNumber("P90212");
const MOVED_TO_NUMBER = qaNumber("P90213");
const CAPPED_NUMBER = qaNumber("P90214");
const CAPPED_INBOX = `__qa-p90214-${QA_RUN_SUFFIX}@example.test`;
const INBOX = `__qa-p90211-${QA_RUN_SUFFIX}@example.test`;
const SECOND_INBOX = `__qa-p90212-${QA_RUN_SUFFIX}@example.test`;
const CONTACT = `__qa-router-contact-${QA_RUN_SUFFIX}@example.test`;
const MAILBOX = `__qa_router_mailbox_${QA_RUN_SUFFIX}`;
// THE PROJECT CODE IS THIS RUN'S TOO. The subject signal matches a code in the
// project NAME, so two runs naming their projects alike would each read the
// other's as a second candidate and hold the message as ambiguous. Two letters
// and five digits is the shape `routeMessage` reads as a code; the digits come
// from the suffix.
const PROJECT_CODE = `QA${String(parseInt(QA_RUN_SUFFIX, 16) % 100000).padStart(5, "0")}`;

/** A Message-ID unique to this run and this delivery. */
function messageIdFor(tag: string): string {
  return `<__qa.router.${tag}.${QA_RUN_SUFFIX}@example.test>`;
}

/** A real RFC 5322 message, so `parseEnvelope` does the reading it always does. */
function eml({ to, from, subject, messageId }: { to: string; from: string; subject: string; messageId: string }): Buffer {
  return Buffer.from(
    [
      `Message-ID: ${messageId}`,
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
  async function ingest(
    graphMessageId: string,
    message: { to: string; from: string; subject: string },
    /** The same Message-ID under two Graph ids is the same mail by two routes. */
    sameMessageAs?: string,
  ) {
    inflight.internetMessageId = messageIdFor(sameMessageAs ?? graphMessageId);
    inflight.bytes = eml({ ...message, messageId: inflight.internetMessageId });
    inflight.subject = message.subject;
    // Graph reports what was delivered; here, what the To line says, which is
    // the honest case. The spoofed cases set their own.
    inflight.reportedTo = message.to.split(",").map((address) => address.trim());
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

  /**
   * This run's rows, and only this run's: every message arrived in this run's
   * mailbox, and every project carries this run's number. The `.eml`
   * attachments belong to the MESSAGE (`entity_type = 'email_messages'`), so
   * they are found through it; the old sweep deleted by the project's id and
   * left every one of them behind.
   */
  async function sweep() {
    const messages = await client.query(`select id from email_messages where mailbox = $1`, [MAILBOX]);
    const ids = messages.rows.map((row) => String(row.id));
    if (ids.length > 0) {
      await client.query(`delete from email_messages where id = any($1::uuid[])`, [ids]);
      await client.query(
        `delete from attachments where entity_type = 'email_messages' and entity_id = any($1::uuid[])`,
        [ids],
      );
    }
    const projects = await client.query(
      `select id from projects where bws_project_number = any($1::text[])`,
      [[PROJECT_NUMBER, SECOND_NUMBER, MOVED_TO_NUMBER, CAPPED_NUMBER]],
    );
    for (const row of projects.rows) {
      await client.query(`delete from email_messages where project_id = $1`, [row.id]);
      await client.query(`delete from intake_runs where project_id = $1`, [row.id]);
      await client.query(`delete from project_contacts where project_id = $1`, [row.id]);
      await client.query(`delete from projects where id = $1`, [row.id]);
    }
  }

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ($1, $2, $3, 'qa', 'qa') returning id`,
      [PROJECT_NUMBER, `__QA Router project ${PROJECT_CODE}`, INBOX],
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
    inflight.internetMessageId = messageIdFor("fwd");
    inflight.bytes = Buffer.from(
      [
        `Message-ID: ${inflight.internetMessageId}`,
        "Date: Mon, 21 Sep 2026 09:05:00 +0000",
        "From: someone@elsewhere.test",
        "To: kam@benwhistler.test",
        `X-MS-Exchange-Inbox-Rules-Loop: ${INBOX}`,
        // Exchange's own stamp, which a sender cannot write (audit A8): the
        // loop header beside it is an ordinary line anybody can.
        "X-MS-Exchange-Organization-AutoForwarded: true",
        "Subject: FW: lounge chair",
        "",
        "Body.",
        "",
      ].join("\r\n"),
      "utf8",
    );
    inflight.subject = "FW: lounge chair";
    inflight.reportedTo = ["kam@benwhistler.test"];
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

  // ---- audit A8: the strong signals, spoofed ------------------------------

  it("HOLDS a forged X-Forwarded-To from an outside address, names the project, and spends nothing", async () => {
    inflight.internetMessageId = messageIdFor("forged");
    inflight.bytes = Buffer.from(
      [
        `Message-ID: ${inflight.internetMessageId}`,
        "Date: Mon, 21 Sep 2026 09:06:00 +0000",
        "From: stranger@elsewhere.test",
        "To: kam@benwhistler.test",
        // An ordinary header, which any sender can write.
        `X-Forwarded-To: ${INBOX}`,
        "Subject: Looks forwarded",
        "",
        "Body.",
        "",
      ].join("\r\n"),
      "utf8",
    );
    inflight.subject = "Looks forwarded";
    inflight.reportedTo = ["kam@benwhistler.test"];
    const { ingestGraphMessage } = await import("@/lib/mail-ingest");
    const outcome = await ingestGraphMessage({
      kind: "mail-ingest",
      mailbox: MAILBOX,
      graphMessageId: "__qa_router_forged",
      source: "notification",
      requestedBy: "system:microsoft-graph",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(false);
    const message = await messageRow(outcome.messageId);
    expect(message.routing_status).toBe("unassigned");
    expect(message.project_id).toBeNull();
    // Routing still names the inbox it read, and says why that was not enough.
    expect(message.routing_reason).toContain("forwarded from the project inbox");
    expect(message.routing_reason).toContain("any sender can write");
    expect(published).toHaveLength(0);
  });

  it("HOLDS a message whose To line names the inbox when Graph does not report it", async () => {
    inflight.internetMessageId = messageIdFor("bcc");
    inflight.bytes = eml({
      to: INBOX,
      from: "stranger@elsewhere.test",
      subject: "Blind copy",
      messageId: inflight.internetMessageId,
    });
    inflight.subject = "Blind copy";
    // Delivered to the app mailbox as a blind copy: the To line is the
    // sender's, and Graph reports nobody it can stand behind.
    inflight.reportedTo = [];
    const { ingestGraphMessage } = await import("@/lib/mail-ingest");
    const outcome = await ingestGraphMessage({
      kind: "mail-ingest",
      mailbox: MAILBOX,
      graphMessageId: "__qa_router_bcc",
      source: "notification",
      requestedBy: "system:microsoft-graph",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    expect(outcome.assigned).toBe(false);
    expect((await messageRow(outcome.messageId)).routing_status).toBe("unassigned");
    expect(published).toHaveLength(0);
  });

  // ---- audit B8: the same mail by two routes -------------------------------

  it("records the same email arriving under two Graph ids once", async () => {
    const first = await ingest("__qa_router_route_a", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "By two routes",
    });
    expect(first.outcome).toBe("stored");
    if (first.outcome !== "stored") return;
    expect(published).toHaveLength(1);

    published.length = 0;
    const second = await ingest(
      "__qa_router_route_b",
      { to: INBOX, from: "someone@elsewhere.test", subject: "By two routes" },
      "__qa_router_route_a",
    );
    // Acked as a duplicate of the row that exists, and nothing read twice.
    expect(second).toEqual({ outcome: "duplicate", messageId: first.messageId });
    expect(published).toHaveLength(0);
    const rows = await client.query(`select count(*)::int as n from email_messages where internet_message_id = $1`, [
      messageIdFor("__qa_router_route_a"),
    ]);
    expect(rows.rows[0].n).toBe(1);
    // And the stub the second delivery claimed is gone, not left pending.
    const stub = await client.query(`select count(*)::int as n from email_messages where mailbox = $1 and graph_message_id = $2`, [
      MAILBOX,
      "__qa_router_route_b",
    ]);
    expect(stub.rows[0].n).toBe(0);
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
      subject: `${PROJECT_CODE} lounge chair`,
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
       values ($1, '__QA Router project two', $2, 'qa', 'qa') returning id`,
      [SECOND_NUMBER, SECOND_INBOX],
    );
    const secondId = String(second.rows[0].id);
    try {
      const outcome = await ingest("__qa_router_ambiguous", {
        to: `${INBOX}, ${SECOND_INBOX}`,
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
      [projectId, `email:${first.messageId}:${projectId}`],
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

  // ---- putting it somewhere else (audit A1) ------------------------------
  //
  // Unassign is the only remedy the auto-assign gate promises, and it was a
  // dead end: the replay key was the message alone, so assigning the message
  // to the RIGHT project found the wrong project's run, linked it, answered
  // 200, and never set the project: the message read "unassigned" while
  // pointing at a run on the project it had just been taken off.
  it("puts a message taken off one project onto another, as a new read on that project", async () => {
    const elsewhere = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA Router project moved to', 'qa', 'qa') returning id`,
      [MOVED_TO_NUMBER],
    );
    const otherId = String(elsewhere.rows[0].id);

    const outcome = await ingest("__qa_router_move", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Placed on the wrong project",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    const placed = await messageRow(outcome.messageId);
    const firstRunId = String(placed.intake_run_id);
    expect(String(placed.project_id)).toBe(projectId);

    const { assignMessage, unassignMessage } = await import("@/lib/email-registration");
    await unassignMessage(outcome.messageId, { actor: "__qa@example.test", expectedVersion: Number(placed.version) });
    const held = await messageRow(outcome.messageId);
    expect(held.routing_status).toBe("unassigned");

    published.length = 0;
    copied.length = 0;
    const moved = await assignMessage({
      messageId: outcome.messageId,
      projectId: otherId,
      kind: "manual",
      actor: "__qa@example.test",
      expectedVersion: Number(held.version),
    });
    // A NEW READ, and it says so: the other project has never seen this email.
    expect(moved.read).toBe(true);
    expect(moved.runId).not.toBe(firstRunId);

    const after = await messageRow(outcome.messageId);
    expect(String(after.project_id)).toBe(otherId);
    expect(after.routing_status).toBe("assigned");
    expect(after.assignment_kind).toBe("manual");
    expect(String(after.intake_run_id)).toBe(moved.runId);

    const run = await runRow(moved.runId);
    expect(String(run.project_id)).toBe(otherId);
    expect(run.registration_request_id).toBe(`email:${outcome.messageId}:${otherId}`);
    expect(published).toHaveLength(1);
    expect(published[0]!.extractionId).toBe(moved.runId);

    // The run reads the message from UNDER THE NEW PROJECT. The first copy
    // sits under the first project, whose prefix this project's read refuses.
    expect(copied).toHaveLength(1);
    expect(copied[0]!.to.startsWith(`projects/${otherId}/`)).toBe(true);
    const attachment = await client.query(
      `select a.storage_path from intake_runs r join attachments a on a.id = r.attachment_id where r.id = $1`,
      [moved.runId],
    );
    expect(String(attachment.rows[0].storage_path).startsWith(`projects/${otherId}/`)).toBe(true);
    expect(String(after.mailbox_storage_path).startsWith("mailbox/")).toBe(true);

    // The first project's run is untouched: it is what the model was paid for.
    const first = await runRow(firstRunId);
    expect(String(first.project_id)).toBe(projectId);
    expect(first.registration_request_id).toBe(`email:${outcome.messageId}:${projectId}`);

    // ---- and back again: the run it already has, no second read ----------
    const { unassignMessage: unassignAgain } = await import("@/lib/email-registration");
    await unassignAgain(outcome.messageId, { actor: "__qa@example.test", expectedVersion: Number(after.version) });
    const heldAgain = await messageRow(outcome.messageId);
    published.length = 0;
    copied.length = 0;
    const back = await assignMessage({
      messageId: outcome.messageId,
      projectId,
      kind: "manual",
      actor: "__qa@example.test",
      expectedVersion: Number(heldAgain.version),
    });
    expect(back.read).toBe(false);
    expect(back.runId).toBe(firstRunId);
    expect(published).toHaveLength(0);
    expect(copied).toHaveLength(0);

    const returned = await messageRow(outcome.messageId);
    expect(String(returned.project_id)).toBe(projectId);
    expect(returned.routing_status).toBe("assigned");
    expect(String(returned.intake_run_id)).toBe(firstRunId);
    const runs = await client.query(
      `select count(*)::int as n from intake_runs where registration_request_id like $1`,
      [`email:${outcome.messageId}%`],
    );
    expect(runs.rows[0].n).toBe(2);
  });

  it("re-links a run stored under the old one-key-per-message form, on its own project only", async () => {
    // Keys written before A1 are `email:<messageId>`. Such a run is still
    // correctly linked to the project it was made on, so assigning the message
    // back there finds it; on any other project it is not this project's run.
    const outcome = await ingest("__qa_router_legacy", {
      to: INBOX,
      from: "someone@elsewhere.test",
      subject: "Registered before the key changed",
    });
    expect(outcome.outcome).toBe("stored");
    if (outcome.outcome !== "stored") return;
    const placed = await messageRow(outcome.messageId);
    const runId = String(placed.intake_run_id);
    // And it never finished its read: unassign settles such a run as
    // `confirmed`, which on its project again would call an unread email
    // reviewed.
    await client.query(
      `update intake_runs set registration_request_id = $1, status = 'failed', error = 'qa' where id = $2`,
      [`email:${outcome.messageId}`, runId],
    );

    const { assignMessage, unassignMessage } = await import("@/lib/email-registration");
    await unassignMessage(outcome.messageId, { actor: "__qa@example.test", expectedVersion: Number(placed.version) });
    const held = await messageRow(outcome.messageId);
    published.length = 0;
    const back = await assignMessage({
      messageId: outcome.messageId,
      projectId,
      kind: "manual",
      actor: "__qa@example.test",
      expectedVersion: Number(held.version),
    });
    expect(back.read).toBe(false);
    expect(back.runId).toBe(runId);
    expect(published).toHaveLength(0);
    const relinked = await runRow(runId);
    expect(relinked.status).toBe("failed");
    expect(String(relinked.error)).toContain("taken off the project before it was read");
  });

  // ---- audit A5: the daily cap on automatic reads ---------------------------

  it("holds the automatic read over the project's daily cap, and a person's read still starts", async () => {
    const { AUTO_READ_DAILY_CAP_DEFAULT } = await import("@/lib/auto-read-cap");
    const capped = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ($1, '__QA Router capped project', $2, 'qa', 'qa') returning id`,
      [CAPPED_NUMBER, CAPPED_INBOX],
    );
    const cappedId = String(capped.rows[0].id);

    // One short of the cap: reads the router started today, all settled so
    // the in-flight slots (a different limit) are free.
    for (let n = 0; n < AUTO_READ_DAILY_CAP_DEFAULT - 1; n += 1) {
      await client.query(
        `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, null, 'spec_document', 'email', 'confirmed', $2, $2)`,
        [cappedId, ROUTER_ACTOR],
      );
    }
    // A PERSON'S reads today do not count against it.
    await client.query(
      `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, null, 'spec_document', 'email', 'confirmed', 'someone@benwhistler.test', 'qa')`,
      [cappedId],
    );

    // The last one the cap allows.
    const last = await ingest("__qa_router_cap_last", {
      to: CAPPED_INBOX,
      from: "someone@elsewhere.test",
      subject: "The twentieth today",
    });
    expect(last.outcome).toBe("stored");
    if (last.outcome !== "stored") return;
    expect(last.assigned).toBe(true);
    expect(published).toHaveLength(1);

    // The one after it: HELD, with the sentence, the project still named.
    published.length = 0;
    const over = await ingest("__qa_router_cap_over", {
      to: CAPPED_INBOX,
      from: "someone@elsewhere.test",
      subject: "The twenty-first today",
    });
    expect(over.outcome).toBe("stored");
    if (over.outcome !== "stored") return;
    expect(over.assigned).toBe(false);
    const held = await messageRow(over.messageId);
    expect(held.routing_status).toBe("unassigned");
    expect(held.intake_run_id).toBeNull();
    expect(held.routing_reason).toContain("addressed to the project inbox");
    expect(held.routing_reason).toContain(
      `The automatic-read cap for this project (${AUTO_READ_DAILY_CAP_DEFAULT} a day) is reached; a person starts this read.`,
    );
    expect(published).toHaveLength(0);
    const runs = await client.query(`select count(*)::int as n from intake_runs where project_id = $1`, [cappedId]);
    expect(runs.rows[0].n).toBe(AUTO_READ_DAILY_CAP_DEFAULT + 1);

    // A person's click is never capped.
    const { assignMessage } = await import("@/lib/email-registration");
    const pressed = await assignMessage({
      messageId: over.messageId,
      projectId: cappedId,
      kind: "manual",
      actor: "__qa@example.test",
      expectedVersion: Number(held.version),
    });
    expect(pressed.read).toBe(true);
    expect(published).toEqual([expect.objectContaining({ extractionId: pressed.runId })]);
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
