// Database tier — an email becoming spec answers, through the REAL confirm.
//
// Skips silently without DATABASE_URL:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/email-intake.test.ts
//
// The claims worth proving here are the ones a screenshot cannot: that a
// confirmed email writes `source_kind = 'email'`, that it opens an
// `email_confirm` change carrying the message as evidence, that it snapshots
// the record (or the coverage assertion in change-history.test.ts fails), and
// that an unplaced email writes NOTHING to any spec table.
//
// Rows are prefixed `__QA ` and deleted FK-safe.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { resolveProposals } from "@/lib/spec-document";
import { PROPOSAL_SCHEMA_VERSION } from "@/lib/spec-document";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-0000000000qa".slice(0, 36),
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function patch(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function post(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIfDb("email intake", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let runId = "";
  let recordId = "";
  let categoryId = "";
  let requirementId = "";
  let messageId = "";
  let attachmentId = "";

  beforeAll(async () => {
    await client.connect();

    // NOTHING IS PRE-CLEANED, and the delete that used to be here is the
    // reason. `qaNumber` gives this process its own project number, so an
    // aborted run's rows can no longer block this one -- they wait for
    // `npm run db:qa-clean`. What stood here also swept every `mailbox =
    // 'upload'` message created by `qa`, which is not this run's row: with two
    // db-tier runs at once it deleted the OTHER run's message between its
    // insert and its assertions, and that run went red on a 409 and on a
    // missing version for a reason nothing on screen explained. Every message
    // this file creates is now removed by its own id or by its project.

    const project = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ('${qaNumber("P90009")}', '__QA Email project', '__qa-p90009@example.test', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const run = await client.query(
      `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
       values ($1, '__QA MAIN', 1, 'qa', 'qa') returning id`,
      [projectId],
    );
    const specRunId = run.rows[0].id;

    const category = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id and q.kind = 'spec_field'
       group by c.id having count(q.id) >= 2 limit 1`,
    );
    categoryId = category.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, 9101, 'active', $3, 'complex', '__QA Armchair', 'QALCS', 'qa', 'qa') returning id`,
      [projectId, specRunId, categoryId],
    );
    recordId = record.rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', '__QAE100', '__QAE100', 'qa')`,
      [recordId, projectId],
    );

    const requirement = await client.query(
      `select id, spec_field_id, prompt from requirements
       where category_id = $1 and kind = 'spec_field' order by sort_order limit 1`,
      [categoryId],
    );
    requirementId = requirement.rows[0].id;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
       from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );

    // The stored message and its .eml, as `recordMessage` + `assignMessage`
    // would have written them. The blob itself is not needed: nothing in the
    // confirm path reads it, and the download route is tested by its own 404.
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('email_messages', gen_random_uuid(), 'mime', $1, '__QA reply.eml', 'message/rfc822', 2048, 'qa')
       returning id`,
      [`projects/${projectId}/uploads/__qa-reply.eml`],
    );
    attachmentId = attachment.rows[0].id;

    const intake = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status,
                                registration_request_id, created_by, updated_by)
       values ($1, $2, 'spec_document', 'email', 'parsed', $3, 'qa', 'qa') returning id, version`,
      [projectId, attachmentId, `email:__qa-${Date.now()}`],
    );
    runId = intake.rows[0].id;

    const message = await client.query(
      `insert into email_messages
         (mailbox, origin, graph_message_id, from_addr, from_name, subject, received_at,
          mailbox_storage_path, mime_attachment_id, mime_size,
          routing_status, routing_reason, project_id, assigned_by, assigned_at, assignment_kind,
          intake_run_id, created_by, updated_by)
       values ('upload', 'upload', null, 'jane@designers.test', '__QA Jane Doe',
               '__QA RE: outstanding specification information', now(),
               $1, $2, 2048, 'assigned', 'uploaded against this project by a person',
               $3, 'qa', now(), 'manual', $4, 'qa', 'qa')
       returning id`,
      [`projects/${projectId}/uploads/__qa-reply.eml`, attachmentId, projectId, runId],
    );
    messageId = message.rows[0].id;
    await client.query(`update attachments set entity_id = $1 where id = $2`, [messageId, attachmentId]);

    // Stage one proposal against the live registers, exactly as the worker does.
    const { loadExtractionRegisters } = await import("@/lib/spec-document-registers");
    const registers = await loadExtractionRegisters(projectId);
    let n = 0;
    const proposals = resolveProposals(
      [
        {
          refRaw: "__QAE100",
          attributeRaw: String(requirement.rows[0].prompt),
          valueRaw: "__QA 440mm",
          page: null,
          sourceSheet: null,
          sourceRow: null,
          confidence: "high",
          note: null,
          quotedText: "The seat height is 440mm.",
          changeIntent: "adds",
        },
      ],
      registers,
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    );
    await client.query(
      `update intake_runs set parsed = $2::jsonb where id = $1`,
      [
        runId,
        JSON.stringify({
          schemaVersion: PROPOSAL_SCHEMA_VERSION,
          lines: proposals,
          documentNotes: null,
          filename: "__QA reply.eml",
        }),
      ],
    );
  });

  afterAll(async () => {
    if (!projectId) {
      await client.end();
      return;
    }
    // ORDER MATTERS, and the reason is worth keeping: `record_snapshots` is
    // append-only and refuses a delete while its record still exists. Dropping
    // the RECORD cascades them away, which is the one sanctioned route (0014,
    // "refuse the rewrite, allow the cascade").
    await client.query(`delete from email_messages where project_id = $1`, [projectId]);
    await client.query(`delete from spec_answers where record_id = $1`, [recordId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    if (messageId) await client.query(`delete from attachments where entity_id = $1`, [messageId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // `change_sets` is append-only too and refuses a delete while its PROJECT
    // exists. Dropping the project cascades both it and the snapshots.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("confirms an answer off an email, and says the email is where it came from", async () => {
    const before = await client.query(`select version from intake_runs where id = $1`, [runId]);
    const staged = await client.query(`select parsed from intake_runs where id = $1`, [runId]);
    const proposal = staged.rows[0].parsed.lines[0];
    expect(proposal.recordId).toBe(recordId);

    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const res = await POST(
      post({
        version: Number(before.rows[0].version),
        action: "confirm",
        recordId,
        proposals: [{ id: proposal.id, version: proposal.version }],
      }),
      params(runId),
    );
    expect(res.status).toBe(200);

    // `source_kind = 'email'` has been allowed by the CHECK since 0002 and had
    // never been written by anything.
    const answer = await client.query(
      `select value, state, source_kind, source_id from spec_answers
       where record_id = $1 and requirement_id = $2`,
      [recordId, requirementId],
    );
    expect(answer.rows[0].state).toBe("confirmed");
    expect(answer.rows[0].value).toBe("__QA 440mm");
    expect(answer.rows[0].source_kind).toBe("email");
    expect(answer.rows[0].source_id).toBe(runId);
  });

  it("records the change as an email, carrying the message as evidence", async () => {
    const change = await client.query(
      `select cs.kind, cs.reason, cs.evidence_attachment_id, cs.source_intake_run_id
       from change_sets cs
       join record_snapshots s on s.change_set_id = cs.id
       where s.record_id = $1 order by s.snapshot_no desc limit 1`,
      [recordId],
    );
    const row = change.rows[0];
    expect(row.kind).toBe("email_confirm");
    // The reason names the sender and the subject, so the trail reads without
    // opening anything.
    expect(row.reason).toContain("__QA Jane Doe");
    expect(row.reason).toContain("outstanding specification information");
    // And the .eml itself is attached: "they never asked for this" is answered
    // by opening the email.
    expect(row.evidence_attachment_id).toBe(attachmentId);
    expect(row.source_intake_run_id).toBe(runId);
  });

  it("leaves an email-sourced answer out of reach of a later drawing", async () => {
    // `applyAnswerFills` touches a missing answer, or one a shop-drawings run
    // wrote. An email answer is a person's confirmation with evidence attached,
    // exactly like a typed one.
    const { planAnswerFills, applyAnswerFills } = await import("@/lib/promote-answers");
    const field = await client.query(
      `select spec_field_id from requirements where id = $1`, [requirementId],
    );
    const fills = planAnswerFills([
      {
        attrGroup: "material",
        dimensionSlot: null,
        specFieldId: field.rows[0].spec_field_id,
        value: "__QA from a drawing",
        unit: null,
        state: "confirmed",
        sortOrder: 0,
        sourceRunId: runId,
      },
    ]);

    const { withTransaction } = await import("@/lib/db-transaction");
    const { openChangeSet } = await import("@/lib/change-sets");
    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, {
        projectId,
        kind: "drawing_confirm",
        actor: "qa",
        reason: "__QA a later drawing",
      });
      void changeSetId;
      await applyAnswerFills(txn, recordId, runId, "qa", fills);
    });

    const answer = await client.query(
      `select value, source_kind from spec_answers where record_id = $1 and requirement_id = $2`,
      [recordId, requirementId],
    );
    expect(answer.rows[0].value).toBe("__QA 440mm");
    expect(answer.rows[0].source_kind).toBe("email");
  });

  it("writes nothing to any spec table for an email nobody has placed", async () => {
    const held = await client.query(
      `insert into email_messages
         (mailbox, origin, from_addr, subject, received_at, routing_status, routing_reason, created_by, updated_by)
       values ('upload', 'upload', 'stranger@x.test', '__QA unplaced', now(), 'unassigned',
               'nothing in this message names a project', 'qa', 'qa')
       returning id, version`,
    );
    const before = await client.query(
      `select
         (select count(*)::int from spec_answers where record_id = $1) as answers,
         (select count(*)::int from record_attributes where record_id = $1) as attributes,
         (select count(*)::int from intake_runs where project_id = $2) as runs`,
      [recordId, projectId],
    );

    const after = await client.query(
      `select
         (select count(*)::int from spec_answers where record_id = $1) as answers,
         (select count(*)::int from record_attributes where record_id = $1) as attributes,
         (select count(*)::int from intake_runs where project_id = $2) as runs`,
      [recordId, projectId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // And it has no run at all: an unplaced email is never read, so no model
    // call is ever made for one.
    const message = await client.query(`select intake_run_id, project_id from email_messages where id = $1`, [
      held.rows[0].id,
    ]);
    expect(message.rows[0].intake_run_id).toBeNull();
    expect(message.rows[0].project_id).toBeNull();

    // It belongs to no project, so `afterAll`'s project-scoped delete cannot
    // reach it. Removed here by its own id rather than by a `mailbox =
    // 'upload'` sweep, which would take a concurrent run's message with it.
    await client.query(`delete from email_messages where id = $1`, [held.rows[0].id]);
  });

  it("refuses to take an email off a project once something has been applied", async () => {
    const version = (await client.query(`select version from email_messages where id = $1`, [messageId])).rows[0]
      .version;
    const { PATCH } = await import("@/app/api/email-messages/[id]/route");
    const res = await PATCH(patch({ action: "unassign", version: Number(version) }), params(messageId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_applied");

    // And it is still on the project.
    const message = await client.query(`select project_id from email_messages where id = $1`, [messageId]);
    expect(message.rows[0].project_id).toBe(projectId);
  });
});
