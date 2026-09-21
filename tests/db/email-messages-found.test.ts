// Database tier — what the inbox says an email FOUND, before anybody opens it.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/email-messages-found.test.ts
//
// The staged documents are written by hand here rather than extracted, because
// what is under test is the READ: that the route runs `describeChange` over the
// same proposals the review screen renders, instead of counting kinds in jsonb.
// A staged line whose target says `confirmed` is the whole fixture — everything
// else about it is scaffolding.
//
// Rows are prefixed `__QA ` and deleted FK-safe; the PROJECT goes last.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

type Found = { proposals: number; runs: number; changesConfirmed: number; nothingToRecord: boolean };
type Message = { id: string; subject: string; found: Found | null; chaseReply: boolean };
type Payload = { ok: boolean; messages: Message[]; arrivedToday: number; ruledThisWeek: number };

/** A staged proposal, in the shape `spec-document.ts` writes and stores. */
function proposal(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    sourceOrdinal: 1,
    version: 1,
    raw: { attributeRaw: "__QA", valueRaw: "__QA", quotedText: null },
    recordCandidates: [],
    requirementCandidates: [],
    recordId: null,
    requirementId: null,
    target: null,
    proposedValue: null,
    proposedState: null,
    stateReason: null,
    overwriteAcknowledged: false,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...over,
  };
}

function target(over: Record<string, unknown>): Record<string, unknown> {
  return {
    recordId: "00000000-0000-0000-0000-000000000000",
    requirementId: "00000000-0000-0000-0000-000000000000",
    requirementKind: "spec_field",
    answerExists: true,
    answerId: "00000000-0000-0000-0000-000000000000",
    answerVersion: 1,
    answerState: "confirmed",
    answerValue: "__QA the value we hold",
    ...over,
  };
}

describeIfDb("the inbox says what an email found", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let readRunId = "";
  let emptyRunId = "";
  let queuedRunId = "";

  async function message(fields: {
    subject: string;
    runId: string | null;
    receivedAt: string;
    chaseMatch?: string | null;
    triage?: { state: string; at: string } | null;
  }): Promise<string> {
    const row = await client.query(
      `insert into email_messages (mailbox, origin, routing_status, project_id, assigned_by, assigned_at,
                                   assignment_kind, subject, from_addr, received_at, intake_run_id,
                                   chase_match, triage, triaged_by, triaged_at, created_by, updated_by)
       values ('__qa@example.test', 'upload', 'assigned', $1, 'qa', now(), 'manual', $2,
               'designer@example.test', $3, $4, $5, $6, $7, $8, 'qa', 'qa')
       returning id`,
      [
        projectId,
        fields.subject,
        fields.receivedAt,
        fields.runId,
        fields.chaseMatch ?? null,
        fields.triage?.state ?? "open",
        fields.triage ? "qa" : null,
        fields.triage?.at ?? null,
      ],
    );
    return row.rows[0].id;
  }

  async function run(status: string, parsed: unknown): Promise<string> {
    const row = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'email', $2, $3, 'qa', 'qa') returning id`,
      [projectId, status, parsed === null ? null : JSON.stringify(parsed)],
    );
    return row.rows[0].id;
  }

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00097")}', '__QA Inbox found', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    // Four lines across two runs. One CHANGES a confirmed value, one WITHDRAWS
    // one back to TBC, one PROVIDES where nobody had answered, and one repeats
    // what we already hold — which is a row worth showing and not a change.
    readRunId = await run("parsed", {
      schemaVersion: 1,
      filename: "__QA email.eml",
      documentNotes: null,
      lines: [
        proposal({
          runId: "11111111-1111-1111-1111-111111111111",
          recordId: "22222222-2222-2222-2222-222222222222",
          requirementId: "33333333-3333-3333-3333-333333333333",
          target: target({}),
          proposedValue: "__QA something else entirely",
          proposedState: "confirmed",
        }),
        proposal({
          runId: "11111111-1111-1111-1111-111111111111",
          recordId: "22222222-2222-2222-2222-222222222222",
          requirementId: "44444444-4444-4444-4444-444444444444",
          target: target({}),
          proposedValue: null,
          proposedState: "tbc",
        }),
        proposal({
          runId: "55555555-5555-5555-5555-555555555555",
          recordId: "66666666-6666-6666-6666-666666666666",
          requirementId: "33333333-3333-3333-3333-333333333333",
          target: target({ answerExists: false, answerId: null, answerVersion: null, answerState: null, answerValue: null }),
          proposedValue: "__QA a new answer",
          proposedState: "confirmed",
        }),
        proposal({
          runId: "55555555-5555-5555-5555-555555555555",
          recordId: "66666666-6666-6666-6666-666666666666",
          requirementId: "44444444-4444-4444-4444-444444444444",
          target: target({}),
          proposedValue: "__QA the value we hold",
          proposedState: "confirmed",
        }),
      ],
    });

    emptyRunId = await run("parsed", {
      schemaVersion: 1,
      filename: "__QA nothing.eml",
      documentNotes: "Nothing in this message states a specification value.",
      lines: [],
    });

    // NOT READ YET. 'pending' rather than 'queued', which 0006 refuses without
    // an attempt id and a queued_at — the shape rule that keeps a run claiming
    // a paid call it never made.
    queuedRunId = await run("pending", null);
  });

  afterAll(async () => {
    await client.query(`delete from email_messages where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function read(): Promise<Payload> {
    const { GET } = await import("@/app/api/email-messages/route");
    const response = await GET(
      new Request(`http://localhost/api/email-messages?projectId=${projectId}&includeTriaged=1`),
    );
    const body = (await response.json()) as Payload;
    expect(body.ok).toBe(true);
    return body;
  }

  const find = (payload: Payload, subject: string) => payload.messages.find((m) => m.subject === subject);

  it("counts the proposals, their runs, and what they undo", async () => {
    await message({
      subject: "__QA a read email",
      runId: readRunId,
      receivedAt: new Date().toISOString(),
    });
    const found = find(await read(), "__QA a read email")?.found;
    expect(found).toBeTruthy();
    expect(found?.proposals).toBe(4);
    // ONE EMAIL, ONE CODE, SEVERAL RUNS: the fan-out is the reason this is a
    // count of distinct runs and not of proposals.
    expect(found?.runs).toBe(2);
    // A change over a confirmed value and a withdrawal back to TBC. The
    // `provides` and the `repeats` are not counted: neither undoes a decision.
    expect(found?.changesConfirmed).toBe(2);
    expect(found?.nothingToRecord).toBe(false);
  });

  it("says so when a read email states nothing to record", async () => {
    await message({
      subject: "__QA nothing to record",
      runId: emptyRunId,
      receivedAt: new Date().toISOString(),
    });
    const found = find(await read(), "__QA nothing to record")?.found;
    expect(found?.proposals).toBe(0);
    // A real outcome, and different from "not read yet". A blank column would
    // read as a document nobody has got to.
    expect(found?.nothingToRecord).toBe(true);
  });

  it("finds nothing at all until the run has been read", async () => {
    await message({
      subject: "__QA still queued",
      runId: queuedRunId,
      receivedAt: new Date().toISOString(),
    });
    await message({ subject: "__QA no run at all", runId: null, receivedAt: new Date().toISOString() });
    const payload = await read();
    expect(find(payload, "__QA still queued")?.found).toBeNull();
    expect(find(payload, "__QA no run at all")?.found).toBeNull();
  });

  it("calls only a confident match a reply to a chase", async () => {
    await message({
      subject: "__QA confident reply",
      runId: null,
      receivedAt: new Date().toISOString(),
      chaseMatch: "confident",
    });
    await message({
      subject: "__QA same sender only",
      runId: null,
      receivedAt: new Date().toISOString(),
      chaseMatch: "sender_only",
    });
    const payload = await read();
    expect(find(payload, "__QA confident reply")?.chaseReply).toBe(true);
    // A weaker reading is a hint the review screen states with its caveat. A
    // boolean cannot carry a caveat, so it does not claim one.
    expect(find(payload, "__QA same sender only")?.chaseReply).toBe(false);
  });

  it("counts what arrived today and what was ruled on this week", async () => {
    const before = await read();

    await message({ subject: "__QA arrived today", runId: null, receivedAt: new Date().toISOString() });
    await message({
      subject: "__QA arrived last month",
      runId: null,
      receivedAt: new Date(Date.now() - 32 * 24 * 3600 * 1000).toISOString(),
    });
    await message({
      subject: "__QA ruled on yesterday",
      runId: null,
      receivedAt: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(),
      triage: { state: "nothing_to_record", at: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
    });
    await message({
      subject: "__QA ruled on last year",
      runId: null,
      receivedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
      triage: { state: "not_specification", at: new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString() },
    });

    const after = await read();
    // One more arrival today; the month-old one does not count however recently
    // it was inserted, because the day compared is the one it was RECEIVED.
    expect(after.arrivedToday).toBe(before.arrivedToday + 1);
    expect(after.ruledThisWeek).toBe(before.ruledThisWeek + 1);
  });
});
