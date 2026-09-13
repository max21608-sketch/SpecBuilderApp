// Database tier — the chase draft lifecycle, through the REAL routes.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// This exercises the route handlers rather than a copy of their SQL, because
// the guards being tested (version predicates, staleness, status transitions)
// live in the routes and a test that reimplements them proves nothing.
//
// Every failure case asserts "and writes nothing". That is the house style for
// a gate: a refusal that half-wrote is worse than no gate at all.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone — it
// is append-only by design and a cleanup that deletes from it has broken the
// thing under test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-0000000000qa".slice(0, 36),
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

function post(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("chase drafts", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let contactId = "";
  let categoryId = "";
  let recordId = "";
  let requirementIds: string[] = [];

  beforeAll(async () => {
    await client.connect();

    const project = await client.query(
      `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
       values ('__QA P90001', '__QA Chase project', '__qa-inbox@example.test', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const contact = await client.query(
      `insert into project_contacts (project_id, name, email, role, designer_code, created_by, updated_by)
       values ($1, '__QA Designer', 'designer@example.test', 'designer', 'QALCS', 'qa', 'qa') returning id`,
      [projectId],
    );
    contactId = contact.rows[0].id;

    // A category with at least three requirements, so coverage is plural.
    const category = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id
       group by c.id having count(q.id) >= 3
       order by c.id limit 1`,
    );
    categoryId = category.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, record_no, status, category_id, item_description, designer, created_by, updated_by)
       values ($1, 9001, 'active', $2, '__QA Armchair', 'qalcs', 'qa', 'qa') returning id`,
      [projectId, categoryId],
    );
    recordId = record.rows[0].id;

    const reqs = await client.query(
      `select id from requirements where category_id = $1 order by sort_order limit 3`,
      [categoryId],
    );
    requirementIds = reqs.rows.map((r: { id: string }) => r.id);

    // Two questions get an answer row at `missing`; the third deliberately gets
    // NONE, because a question with no answer row is the most common thing
    // worth chasing and must be coverable.
    for (const requirementId of requirementIds.slice(0, 2)) {
      await client.query(
        `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
         select $1, q.id, q.spec_field_id, 'missing', 'qa', 'qa' from requirements q where q.id = $2`,
        [recordId, requirementId],
      );
    }
  });

  afterAll(async () => {
    await client.query(
      `delete from email_draft_items where draft_id in (select id from email_drafts where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from status_history where entity_type = 'email_draft'
       and entity_id in (select id from email_drafts where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
    await client.query(`delete from spec_answers where record_id = $1`, [recordId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function currentDrafts(status?: string) {
    const rows = await client.query(
      status
        ? `select * from email_drafts where project_id = $1 and status = $2 order by generated_at`
        : `select * from email_drafts where project_id = $1 order by generated_at`,
      status ? [projectId, status] : [projectId],
    );
    return rows.rows;
  }

  function allQuestions() {
    return requirementIds.map((requirementId) => ({ recordId, requirementId }));
  }

  async function generate(
    overrides: Record<string, unknown> = {},
    questions: { recordId: string; requirementId: string }[] = allQuestions(),
  ) {
    const { POST } = await import("@/app/api/drafts/generate/route");
    const existing = await currentDrafts("draft");
    return POST(
      post({
        projectId,
        selections: [{ contactId, questions }],
        expectedCurrentDrafts: existing.map((d) => ({ id: d.id, version: Number(d.version) })),
        ...overrides,
      }),
    );
  }

  let draftId = "";

  it("generates one draft per contact, covering every selected question", async () => {
    const res = await generate();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toHaveLength(1);

    const drafts = await currentDrafts("draft");
    expect(drafts).toHaveLength(1);
    draftId = drafts[0].id;

    const items = await client.query(`select * from email_draft_items where draft_id = $1`, [draftId]);
    expect(items.rows).toHaveLength(3);

    // The question with no answer row is covered, with a null pair asserting
    // the absence rather than inventing a version.
    const absent = items.rows.filter((r: { answer_id: string | null }) => r.answer_id === null);
    expect(absent).toHaveLength(1);
    expect(absent[0].snapshot_answer_version).toBeNull();

    // The Cc snapshot is the project inbox, taken at generation.
    expect(drafts[0].cc_email).toBe("__qa-inbox@example.test");
    // Non-production, so the subject is marked.
    expect(String(drafts[0].subject)).toContain("[STAGING]");
  });

  it("refuses a second concurrent generation and leaves one active draft", async () => {
    const { POST } = await import("@/app/api/drafts/generate/route");
    // A caller that still believes there are NO drafts — the stale tab case.
    const res = await POST(
      post({
        projectId,
        selections: [{ contactId, questions: allQuestions() }],
        expectedCurrentDrafts: [],
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("drafts_changed");

    expect(await currentDrafts("draft")).toHaveLength(1);
  });

  it("refuses to record a send against a stale draft version, and writes nothing", async () => {
    const { POST } = await import("@/app/api/drafts/[id]/confirm-sent/route");
    const res = await POST(post({ version: 999, attestation: true }), params(draftId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("draft_version_stale");

    const drafts = await currentDrafts();
    expect(drafts.find((d) => d.id === draftId).status).toBe("draft");
  });

  it("records a send, without touching a single answer", async () => {
    const before = await client.query(
      `select id, version, state, updated_at from spec_answers where record_id = $1 order by id`,
      [recordId],
    );

    const { POST } = await import("@/app/api/drafts/[id]/confirm-sent/route");
    const draft = (await currentDrafts()).find((d) => d.id === draftId);
    const res = await POST(post({ version: Number(draft.version), attestation: true }), params(draftId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.questionsCovered).toBe(3);

    const after = await client.query(
      `select id, version, state, updated_at from spec_answers where record_id = $1 order by id`,
      [recordId],
    );
    // THE central invariant: recording a chase writes nothing to spec_answers.
    // A chased_at column here would bump version and invalidate every M2
    // extraction snapshot taken against these rows.
    expect(after.rows).toEqual(before.rows);

    const history = await client.query(
      `select from_status, to_status, changed_by from status_history
       where entity_type = 'email_draft' and entity_id = $1`,
      [draftId],
    );
    expect(history.rows).toEqual([
      expect.objectContaining({ from_status: "draft", to_status: "sent", changed_by: "__qa@example.test" }),
    ]);
  });

  it("reports the covered questions as awaiting a reply", async () => {
    const { loadOutstanding, loadSentCoverage, waitingByQuestion } = await import("@/lib/chase-drafts");
    const outstanding = await loadOutstanding(projectId);
    const waiting = waitingByQuestion(outstanding, await loadSentCoverage(projectId));
    expect(waiting.size).toBe(3);
  });

  it("refuses a repeat confirmation", async () => {
    const { POST } = await import("@/app/api/drafts/[id]/confirm-sent/route");
    const draft = (await currentDrafts()).find((d) => d.id === draftId);
    const res = await POST(post({ version: Number(draft.version), attestation: true }), params(draftId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_sent");
  });

  it("stops treating a question as awaited once it is answered", async () => {
    await client.query(
      `update spec_answers set value = '__QA 450mm', state = 'confirmed',
         confirmed_by = 'qa', confirmed_at = now(), updated_by = 'qa'
       where record_id = $1 and requirement_id = $2`,
      [recordId, requirementIds[0]],
    );

    const { loadOutstanding, loadSentCoverage, waitingByQuestion } = await import("@/lib/chase-drafts");
    const outstanding = await loadOutstanding(projectId);
    const waiting = waitingByQuestion(outstanding, await loadSentCoverage(projectId));
    // Answered, so it is neither outstanding nor awaited.
    expect(waiting.size).toBe(2);
    expect(outstanding.filter((q) => q.requirementId === requirementIds[0])).toHaveLength(0);
  });

  it("withdraws a send confirmation without rolling back that answer", async () => {
    const { POST } = await import("@/app/api/drafts/[id]/undo-confirm/route");
    const draft = (await currentDrafts()).find((d) => d.id === draftId);

    // Note there is NO `version = snapshot + 1` requirement: an answer changed
    // after sending, and undo must still work. That rule belongs to gates whose
    // confirm mutates the covered rows; this one does not.
    const res = await POST(
      post({ version: Number(draft.version), reason: "__QA misclick" }),
      params(draftId),
    );
    expect(res.status).toBe(200);

    const after = (await currentDrafts()).find((d) => d.id === draftId);
    expect(after.status).toBe("voided");
    expect(after.sent_at).not.toBeNull();
    expect(after.sent_by).toBe("__qa@example.test");
    expect(after.void_reason).toBe("__QA misclick");

    const answer = await client.query(
      `select state, value from spec_answers where record_id = $1 and requirement_id = $2`,
      [recordId, requirementIds[0]],
    );
    expect(answer.rows[0].state).toBe("confirmed");
    expect(answer.rows[0].value).toBe("__QA 450mm");

    // A voided send stops supplying coverage.
    const { loadOutstanding, loadSentCoverage, waitingByQuestion } = await import("@/lib/chase-drafts");
    const waiting = waitingByQuestion(await loadOutstanding(projectId), await loadSentCoverage(projectId));
    expect(waiting.size).toBe(0);
  });

  it("refuses a send whose questions moved after the email was written, naming each one", async () => {
    // A fresh draft over the two still-outstanding questions.
    const { POST: generatePost } = await import("@/app/api/drafts/generate/route");
    const gen = await generatePost(
      post({
        projectId,
        selections: [
          { contactId, questions: requirementIds.slice(1).map((requirementId) => ({ recordId, requirementId })) },
        ],
        expectedCurrentDrafts: [],
      }),
    );
    expect(gen.status).toBe(201);
    const fresh = (await currentDrafts("draft"))[0];

    // Somebody answers one of them in the meantime.
    await client.query(
      `update spec_answers set state = 'tbc', updated_by = 'qa'
       where record_id = $1 and requirement_id = $2`,
      [recordId, requirementIds[1]],
    );

    const { POST } = await import("@/app/api/drafts/[id]/confirm-sent/route");
    const res = await POST(post({ version: Number(fresh.version), attestation: true }), params(fresh.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("coverage_stale");
    expect(body.diff).toEqual(
      expect.arrayContaining([expect.objectContaining({ requirementId: requirementIds[1] })]),
    );
    expect(String(body.diff[0].why)).toMatch(/changed|answered|settled/);

    // and writes nothing
    const after = (await currentDrafts()).find((d) => d.id === fresh.id);
    expect(after.status).toBe("draft");
    expect(after.sent_at).toBeNull();
  });

  it("refuses to edit over a question that changed, rather than silently re-snapshotting", async () => {
    const fresh = (await currentDrafts("draft"))[0];
    const { POST } = await import("@/app/api/drafts/[id]/edit/route");
    const res = await POST(
      post({
        version: Number(fresh.version),
        introText: "__QA new intro",
        closingText: "__QA thanks",
        questions: requirementIds.slice(1).map((requirementId) => ({ recordId, requirementId })),
      }),
      params(fresh.id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("coverage_stale");

    const after = (await currentDrafts()).find((d) => d.id === fresh.id);
    expect(after.intro_text).not.toBe("__QA new intro");
    expect(after.manually_edited_at).toBeNull();
  });

  it("edits prose and coverage together, leaving the body and the coverage rows agreeing", async () => {
    const fresh = (await currentDrafts("draft"))[0];
    const { POST } = await import("@/app/api/drafts/[id]/edit/route");
    // Drop the now-stale question; keep the one that has not moved.
    const res = await POST(
      post({
        version: Number(fresh.version),
        introText: "__QA revised opening",
        closingText: "__QA regards",
        questions: [{ recordId, requirementId: requirementIds[2] }],
      }),
      params(fresh.id),
    );
    expect(res.status).toBe(200);

    const after = (await currentDrafts()).find((d) => d.id === fresh.id);
    expect(after.intro_text).toBe("__QA revised opening");
    expect(after.manually_edited_by).toBe("__qa@example.test");
    expect(String(after.body)).toContain("__QA revised opening");

    const items = await client.query(`select * from email_draft_items where draft_id = $1`, [fresh.id]);
    expect(items.rows).toHaveLength(1);
    // The email and the coverage describe the same single question.
    expect(String(after.body)).toContain(String(items.rows[0].prompt_text));
  });

  it("refuses to regenerate over an edited draft without naming it, then succeeds when acknowledged", async () => {
    const edited = (await currentDrafts("draft"))[0];

    // Only the questions that are still outstanding by this point: the first
    // was answered earlier in the narrative, and the route rightly refuses it.
    const stillOutstanding = requirementIds.slice(1).map((requirementId) => ({ recordId, requirementId }));

    const refused = await generate({}, stillOutstanding);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.code).toBe("unacknowledged_edits");
    expect(body.diff[0].contact_name).toBe("__QA Designer");

    // still there, still edited
    expect((await currentDrafts("draft"))[0].intro_text).toBe("__QA revised opening");

    const accepted = await generate(
      { acknowledgeDiscard: [{ id: edited.id, version: Number(edited.version) }] },
      stillOutstanding,
    );
    expect(accepted.status).toBe(201);

    // The old one is superseded, not deleted: a stale tab gets a conflict it
    // can explain rather than a 404.
    const all = await currentDrafts();
    expect(all.find((d) => d.id === edited.id).status).toBe("superseded");
    expect(await currentDrafts("draft")).toHaveLength(1);
  });

  it("fills a blank contact address from the draft, but never overwrites one", async () => {
    await client.query(`update project_contacts set email = null, updated_by = 'qa' where id = $1`, [contactId]);
    const draft = (await currentDrafts("draft"))[0];

    const { POST } = await import("@/app/api/drafts/[id]/set-recipient/route");
    const res = await POST(
      post({ version: Number(draft.version), email: "filled@example.test" }),
      params(draft.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).contactUpdated).toBe(true);

    let contact = await client.query(`select email from project_contacts where id = $1`, [contactId]);
    expect(contact.rows[0].email).toBe("filled@example.test");

    // A second draft must not clobber the address a person has now set.
    const next = (await currentDrafts("draft"))[0];
    const second = await POST(
      post({ version: Number(next.version), email: "other@example.test" }),
      params(next.id),
    );
    expect(second.status).toBe(200);
    expect((await second.json()).contactUpdated).toBe(false);

    contact = await client.query(`select email from project_contacts where id = $1`, [contactId]);
    expect(contact.rows[0].email).toBe("filled@example.test");
  });

  it("refuses an address that would inject a mail header", async () => {
    const draft = (await currentDrafts("draft"))[0];
    const { POST } = await import("@/app/api/drafts/[id]/set-recipient/route");
    const res = await POST(
      post({ version: Number(draft.version), email: "a@b.test\r\nBcc: attacker@example.test" }),
      params(draft.id),
    );
    expect(res.status).toBe(400);
  });
});
