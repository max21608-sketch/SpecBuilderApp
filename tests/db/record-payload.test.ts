// Database tier — the three things the record screen reads about a record that
// are computed somewhere else: who has already been asked, who to ask, and
// whether the item can be priced.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/record-payload.test.ts
//
// Driven through the REAL route handler, because what is being tested is that
// the route reuses the chase screen's own loaders rather than a copy of their
// rules. A test that rebuilt `waitingByQuestion` here would prove that the test
// agrees with itself.
//
// Rows are prefixed `__QA ` and deleted FK-safe; the PROJECT goes last and
// takes its change sets and versions with it (0014/0013 refuse a direct
// delete, and a teardown that tries one leaves its fixture behind).
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb } from "./db-tier";
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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Payload = {
  ok: boolean;
  waiting: Record<string, { draftId: string; sentAt: string | null; contactName: string }>;
  designerContact: { id: string; name: string; designer_code: string } | null;
  designerContactAmbiguous: boolean;
  quoteReadiness: {
    toQuote: number | null;
    alsoOutstanding: number | null;
    outstanding: number;
    settled: number;
    notApplicable: number;
    noLevel: boolean;
  };
  matrixFields: { matrixRow: number; gate: string; fieldName: string }[] | null;
};

describeIfDb("record payload — waiting, who to ask, and quote readiness", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let runId = "";
  let contactId = "";
  /** A category Matthew's matrix does NOT cover, so `tgq_levels` decides — the
      half of the model that refuses to answer without a level. */
  let placeholderCategoryId = "";
  let chasedRecordId = "";
  let levellessRecordId = "";
  let chasedRequirementId = "";
  let settledRequirementId = "";
  let draftId = "";

  async function nextRecordNo(): Promise<number> {
    const row = await client.query(
      `select coalesce(max(record_no), 0) + 1 as n from spec_records where project_id = $1`,
      [projectId],
    );
    return Number(row.rows[0].n);
  }

  beforeAll(async () => {
    await client.connect();

    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00099', '__QA Record payload', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    const contact = await client.query(
      `insert into project_contacts (project_id, name, email, role, designer_code, created_by, updated_by)
       values ($1, '__QA Hayley', 'hayley@example.test', 'designer', 'QAHAY', 'qa', 'qa') returning id`,
      [projectId],
    );
    contactId = contact.rows[0].id;

    // A cheat sheet with at least three questions that is NOT in
    // spec_matrix_category_map: absence from that map is what makes
    // `questionTierOrNull` fall back to `tgq_levels`, which is the model that
    // needs a level. A mapped category would answer without one and the
    // level-less assertion below would pass for the wrong reason.
    const category = await client.query(
      `select c.id from item_categories c
         join requirements q on q.category_id = c.id
        where not exists (select 1 from spec_matrix_category_map m where m.item_category_id = c.id)
        group by c.id having count(q.id) >= 3
        order by c.id limit 1`,
    );
    placeholderCategoryId = category.rows[0].id;

    const chased = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', '__QA Armchair', ' qahay ', 'qa', 'qa') returning id, version`,
      [projectId, runId, await nextRecordNo(), placeholderCategoryId],
    );
    chasedRecordId = chased.rows[0].id;
    const chasedVersion = Number(chased.rows[0].version);

    const levelless = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, null, '__QA Bench', 'qa', 'qa') returning id`,
      [projectId, runId, await nextRecordNo(), placeholderCategoryId],
    );
    levellessRecordId = levelless.rows[0].id;

    const reqs = await client.query(
      `select id, prompt, kind, spec_field_id from requirements where category_id = $1 order by sort_order limit 2`,
      [placeholderCategoryId],
    );
    chasedRequirementId = reqs.rows[0].id;
    settledRequirementId = reqs.rows[1].id;

    // The question that gets chased has NO answer row: a requirement with no
    // answer is `missing`, is the commonest thing worth chasing, and has to be
    // coverable.
    //
    // The second one is answered and CONFIRMED by a person — source_kind
    // 'manual' — so it is settled and can never read as waiting whatever a
    // draft once said about it.
    const settledAnswer = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value,
                                 source_kind, confirmed_by, confirmed_at, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'confirmed', '__QA settled by hand', 'manual',
              'qa', now(), 'qa', 'qa'
         from requirements q where q.id = $2
       returning id, version`,
      [chasedRecordId, settledRequirementId],
    );

    // ---- one sent draft, covering both questions --------------------------
    //
    // Built by hand rather than through the generate route, because what is
    // under test is the READ. The context snapshot is computed by the same
    // function the generate route stores — `contextSnapshot` — so a mismatch
    // here would be the real thing a mismatch means: the coverage no longer
    // describes the question.
    const { loadOutstanding, contextSnapshot } = await import("@/lib/chase-drafts");
    const outstanding = (await loadOutstanding(projectId)).filter((q) => q.recordId === chasedRecordId);
    const chasedQuestion = outstanding.find((q) => q.requirementId === chasedRequirementId);
    if (!chasedQuestion) throw new Error("fixture: the chased question is not outstanding");

    const draft = await client.query(
      `insert into email_drafts (project_id, contact_id, contact_version, status, subject, body,
                                 project_label, recipient_name, recipient_email,
                                 sent_at, sent_by, created_by, updated_by)
       values ($1, $2, 1, 'sent', '__QA Chase', '<p>__QA</p>', '__QA P00099', '__QA Hayley',
               'hayley@example.test', now(), 'qa', 'qa', 'qa') returning id`,
      [projectId, contactId],
    );
    draftId = draft.rows[0].id;

    await client.query(
      `insert into email_draft_items (draft_id, record_id, requirement_id, revision_no, answer_id,
                                      snapshot_answer_version, record_version, context_snapshot,
                                      prompt_text, sort_order, tier, created_by)
       values ($1, $2, $3, 0, null, null, $4, $5, $6, 1, $7, 'qa')`,
      [
        draftId,
        chasedRecordId,
        chasedRequirementId,
        chasedVersion,
        JSON.stringify(contextSnapshot(chasedQuestion)),
        chasedQuestion.prompt,
        chasedQuestion.tier,
      ],
    );

    // And a coverage row for the question that has since been answered, so the
    // "a person's answer is never waiting" assertion is testing a row that
    // exists rather than one that was never written.
    await client.query(
      `insert into email_draft_items (draft_id, record_id, requirement_id, revision_no, answer_id,
                                      snapshot_answer_version, record_version, context_snapshot,
                                      prompt_text, sort_order, tier, created_by)
       values ($1, $2, $3, 0, $4, $5, $6, $7, '__QA settled question', 2, 'later', 'qa')`,
      [
        draftId,
        chasedRecordId,
        settledRequirementId,
        settledAnswer.rows[0].id,
        Number(settledAnswer.rows[0].version),
        chasedVersion,
        JSON.stringify({ v: 1, recordLabel: "__QA", refs: "", itemDescription: "__QA Armchair" }),
      ],
    );
  });

  afterAll(async () => {
    await client.query(`delete from email_draft_items where draft_id = $1`, [draftId]);
    await client.query(
      `delete from status_history where entity_type = 'email_draft'
        and entity_id in (select id from email_drafts where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    // The change sets go with the project. 0014 refuses a direct delete.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function read(recordId: string): Promise<Payload> {
    const { GET } = await import("@/app/api/records/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(recordId));
    const body = (await response.json()) as Payload;
    expect(body.ok).toBe(true);
    return body;
  }

  it("names the sent draft still waiting on a question", async () => {
    const { questionKey } = await import("@/lib/chase-drafts");
    const payload = await read(chasedRecordId);
    const key = questionKey(chasedRecordId, chasedRequirementId, 0);
    const info = payload.waiting[key];
    expect(info).toBeTruthy();
    expect(info?.draftId).toBe(draftId);
    expect(info?.contactName).toBe("__QA Hayley");
  });

  it("never reports a question somebody has answered as waiting", async () => {
    const { questionKey } = await import("@/lib/chase-drafts");
    const payload = await read(chasedRecordId);
    // The draft covered it and the coverage row is still there. It is settled,
    // so it is not outstanding, so it is not waiting — `isCoverageFresh` says
    // `answerSettled` and the good news wins.
    expect(payload.waiting[questionKey(chasedRecordId, settledRequirementId, 0)]).toBeUndefined();
  });

  it("resolves the designer code to one contact, through designerKey", async () => {
    const payload = await read(chasedRecordId);
    // The record's own column reads " qahay " — free text off a BOQ. The
    // contact holds 'QAHAY'. Only `designerKey` makes those one designer.
    expect(payload.designerContact?.id).toBe(contactId);
    expect(payload.designerContactAmbiguous).toBe(false);
  });

  it("offers no contact where the record names no designer", async () => {
    const payload = await read(levellessRecordId);
    expect(payload.designerContact).toBeNull();
  });

  it("counts what blocks a quote, and refuses to when there is no level", async () => {
    const chasedPayload = await read(chasedRecordId);
    expect(chasedPayload.quoteReadiness.noLevel).toBe(false);
    expect(chasedPayload.quoteReadiness.toQuote).toBeGreaterThan(0);
    expect(chasedPayload.quoteReadiness.settled).toBe(1);

    // A DASH, NEVER A ZERO. The category is not on Matthew's matrix and the
    // record has no level, so no question on it can be sorted into what blocks
    // a quote — and reporting 0 would read as an item that is ready.
    const levellessPayload = await read(levellessRecordId);
    expect(levellessPayload.quoteReadiness.noLevel).toBe(true);
    expect(levellessPayload.quoteReadiness.toQuote).toBeNull();
    expect(levellessPayload.quoteReadiness.alsoOutstanding).toBeNull();
    expect(levellessPayload.quoteReadiness.outstanding).toBeGreaterThan(0);
  });

  it("returns no matrix rows for a category his matrix does not cover", async () => {
    const payload = await read(chasedRecordId);
    // Null, never an empty list: an empty list computes as "nothing
    // outstanding", which is the confidently-wrong reading `gatesForRecord`
    // already refuses.
    expect(payload.matrixFields).toBeNull();
  });

  it("returns the matrix rows where he wrote one", async () => {
    const mapped = await client.query(
      `select item_category_id from spec_matrix_category_map limit 1`,
    );
    if (mapped.rowCount === 0) return;
    const categoryId = mapped.rows[0].item_category_id;
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, null, '__QA Sofa', 'qa', 'qa') returning id`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );
    const payload = await read(record.rows[0].id);
    expect(payload.matrixFields).not.toBeNull();
    expect(payload.matrixFields!.length).toBeGreaterThan(0);
    const first = payload.matrixFields![0]!;
    expect(typeof first.matrixRow).toBe("number");
    expect(["TGQ", "TG0", "TG1"]).toContain(first.gate);
    // A mapped category answers without a level, so this one is tiered even
    // though nobody set a level on it — his matrix carries no level column.
    expect(payload.quoteReadiness.noLevel).toBe(false);
  });
});
