// Database tier — who a chase may ask what, through the REAL routes (0062,
// decisions D and E of 2026-11-20).
//
//   * a designer's chase holds only CLIENT questions: an in-house or CAM
//     question is refused in words on generate, and on ADD when editing;
//   * a colleague may be sent anything;
//   * an external recipient's email prints the client wording and no BWS
//     field name, and the line stores what it was asked as;
//   * a draft written BEFORE 0062 opens, downloads and edits with its body as
//     stored, byte for byte;
//   * "Ask the client" moves ONE question for ONE project, audited, and back.
//
// The fixture owns its category and its questions (the chase-drafts rule:
// never strike a seeded row two runs share). Every refusal asserts that
// nothing was written.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

// Mutable, so a test can press as a second person ("Put it back" is audited
// under whoever pressed it).
const session = vi.hoisted(() => ({ email: "__qa@example.test" }));
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: session.email,
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

function req(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("chase audiences (0062)", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let otherProjectId = "";
  let designerId = "";
  let colleagueId = "";
  let categoryId = "";
  let recordId = "";
  let otherRecordId = "";
  /** A client spec field with a client wording ("Fabric 1" for "COM 1"). */
  let comId = "";
  /** An in-house spec field: "Assembly guide required". */
  let inHouseId = "";
  /** A CAM readiness question. */
  let camId = "";
  /** An area question. */
  let areaId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA Audience project', 'qa', 'qa') returning id`,
      [qaNumber("P90062")],
    );
    projectId = project.rows[0].id;
    const other = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA Audience other', 'qa', 'qa') returning id`,
      [qaNumber("P90063")],
    );
    otherProjectId = other.rows[0].id;

    designerId = (
      await client.query(
        `insert into project_contacts (project_id, name, email, role, designer_code, created_by, updated_by)
         values ($1, '__QA Designer', 'designer@example.test', 'designer', 'QAAUD', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    colleagueId = (
      await client.query(
        `insert into project_contacts (project_id, name, email, role, created_by, updated_by)
         values ($1, '__QA Colleague', 'cam@example.test', 'internal', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;

    // Its own category: no gate model reaches it, so a level tiers it.
    categoryId = (
      await client.query(
        `insert into item_categories (slug, family, name, requirements_authored, sort_order, created_by, updated_by)
         values ($1, 'upholstery', $2, true, 9002, 'qa', 'qa') returning id`,
        [qaNumber("audience-category").toLowerCase().replace(/[^a-z0-9]+/g, "-"), qaNumber("Audience category")],
      )
    ).rows[0].id;
    const field = async (jsonId: number) =>
      (await client.query(`select id from spec_fields where json_id = $1`, [jsonId])).rows[0].id as string;
    const add = async (kind: string, specFieldId: string | null, prompt: string, extra: Record<string, unknown>, sort: number) =>
      (
        await client.query(
          `insert into requirements (category_id, kind, spec_field_id, prompt, section, sort_order, audience, client_prompt, answer_scope,
                                     created_by, updated_by)
           values ($1, $2, $3, $4, '__QA section', $5, $6, $7, $8, 'qa', 'qa') returning id`,
          [categoryId, kind, specFieldId, prompt, sort, extra.audience ?? "client", extra.clientPrompt ?? null, extra.answerScope ?? "item"],
        )
      ).rows[0].id as string;
    comId = await add("spec_field", await field(1), "COM 1", { clientPrompt: "Fabric 1" }, 1);
    inHouseId = await add("spec_field", await field(191), "Assembly guide required", { audience: "in_house" }, 2);
    camId = await add("readiness", null, "__QA TOE agreement", { audience: "cam" }, 3);
    areaId = await add("spec_field", await field(130), "Indoor/ Outdoor / Humid environment", { answerScope: "area" }, 4);

    const runFor = async (pid: string) =>
      (
        await client.query(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA run', 'qa', 'qa') returning id`, [
          pid,
        ])
      ).rows[0].id as string;
    recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, level, item_description, designer, area, created_by, updated_by)
         values ($1, $2, 1, 'active', $3, 'complex', '__QA Sofa', 'qaaud', 'Restaurant', 'qa', 'qa') returning id`,
        [projectId, await runFor(projectId), categoryId],
      )
    ).rows[0].id;
    otherRecordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, level, item_description, created_by, updated_by)
         values ($1, $2, 1, 'active', $3, 'complex', '__QA Other sofa', 'qa', 'qa') returning id`,
        [otherProjectId, await runFor(otherProjectId), categoryId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    try {
      for (const pid of [projectId, otherProjectId]) {
        if (!pid) continue;
        await client.query(`delete from email_draft_items where draft_id in (select id from email_drafts where project_id = $1)`, [pid]);
        await client.query(`delete from status_history where entity_type = 'email_draft' and entity_id in (select id from email_drafts where project_id = $1)`, [pid]);
        await client.query(`delete from email_drafts where project_id = $1`, [pid]);
        await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [pid]);
        await client.query(`delete from spec_records where project_id = $1`, [pid]);
        await client.query(`delete from spec_runs where project_id = $1`, [pid]);
        await client.query(`delete from project_contacts where project_id = $1`, [pid]);
        await client.query(`delete from projects where id = $1`, [pid]);
      }
    } finally {
      if (categoryId) await client.query(`delete from item_categories where id = $1`, [categoryId]).catch(() => undefined);
      await client.end();
    }
  });

  async function drafts(status = "draft") {
    return (await client.query(`select * from email_drafts where project_id = $1 and status = $2 order by generated_at`, [projectId, status])).rows;
  }

  async function generate(contactId: string, requirementIds: string[]) {
    const { POST } = await import("@/app/api/drafts/generate/route");
    const existing = await drafts();
    return POST(
      req({
        projectId,
        selections: [{ contactId, questions: requirementIds.map((requirementId) => ({ recordId, requirementId })) }],
        expectedCurrentDrafts: existing.map((d) => ({ id: d.id, version: Number(d.version) })),
        acknowledgeDiscard: existing.map((d) => ({ id: d.id, version: Number(d.version) })),
      }),
    );
  }

  async function route(body: unknown) {
    const { POST } = await import("@/app/api/projects/[id]/question-routes/route");
    return POST(req(body), params(projectId));
  }

  it("refuses an in-house or a CAM question to a designer, in words, and writes nothing", async () => {
    const before = await drafts();
    for (const id of [inHouseId, camId]) {
      const res = await generate(designerId, [comId, id]);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("questions_ineligible");
      expect(body.error).toMatch(/ours to answer, not the client's/);
    }
    expect(await drafts()).toEqual(before);
  });

  it("sends a colleague anything", async () => {
    const res = await generate(colleagueId, [comId, inHouseId, camId]);
    expect(res.status).toBe(201);
    const [draft] = await drafts();
    // A colleague reads the prompt and the BWS field, which is how the app names it.
    expect(String(draft.body)).toContain("(BWS: COM 1)");
  });

  it("asks a designer in the client wording, with no BWS field name, and stores what each line was asked as", async () => {
    const res = await generate(designerId, [comId, areaId]);
    expect(res.status).toBe(201);
    const [draft] = await drafts();
    expect(Number(draft.template_version)).toBe(4);
    expect(String(draft.body)).not.toContain("BWS:");
    expect(String(draft.body)).toContain(">Fabric 1 <span");
    const items = (
      await client.query(`select requirement_id, prompt_text, asked_as, answer_scope from email_draft_items where draft_id = $1 order by sort_order`, [
        draft.id,
      ])
    ).rows;
    expect(items).toEqual([
      { requirement_id: comId, prompt_text: "COM 1", asked_as: "Fabric 1", answer_scope: "item" },
      { requirement_id: areaId, prompt_text: "Indoor/ Outdoor / Humid environment", asked_as: null, answer_scope: "area" },
    ]);
  });

  it("refuses to ADD an in-house question to a designer's draft, and writes nothing", async () => {
    const [draft] = await drafts();
    const { POST } = await import("@/app/api/drafts/[id]/edit/route");
    const res = await POST(
      req({
        version: Number(draft.version),
        introText: "x",
        closingText: "y",
        questions: [comId, areaId, inHouseId].map((requirementId) => ({ recordId, requirementId })),
      }),
      params(draft.id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ours to answer/);
    const [after] = await drafts();
    expect(after.version).toBe(draft.version);
    expect(after.body).toBe(draft.body);
  });

  it("opens, downloads and edits a draft written BEFORE 0062 with its body as stored", async () => {
    // A pre-0062 designer draft: template 3, BWS names in its body, and an
    // in-house question in its coverage — exactly what the first chase on the
    // test tender held. Inserted as such, because no code here writes one.
    const [current] = await drafts();
    await client.query(`update email_drafts set status = 'superseded', updated_by = 'qa' where id = $1`, [current.id]);
    const body = `<p style="margin:0 0 1em">Good morning __QA Designer,</p>\n<p>Assembly guide required <span style="font-weight:normal">(BWS: Assembly guide)</span> — ünïcödé</p>`;
    const draftId = (
      await client.query(
        `insert into email_drafts (project_id, contact_id, kind, status, intro_text, closing_text, subject, body, body_format,
                                   template_version, recipient_name, recipient_email, contact_version, project_label, created_by, updated_by)
         values ($1, $2, 'chase', 'draft', 'old intro', 'Many thanks,', '__QA old subject', $3, 'html', 3, '__QA Designer',
                 'designer@example.test', 1, '__QA', 'qa', 'qa') returning id`,
        [projectId, designerId, body],
      )
    ).rows[0].id as string;
    const { loadQuestionsByKey, coveredFromQuestion } = await import("@/lib/chase-drafts");
    const live = await loadQuestionsByKey(projectId, [inHouseId, comId].map((requirementId) => ({ recordId, requirementId })));
    for (const [index, question] of [...live.values()].entries()) {
      const covered = coveredFromQuestion(question);
      await client.query(
        `insert into email_draft_items (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version, record_version,
                                        context_snapshot, prompt_text, field_label, current_value_text, sort_order, tier, record_no, requirement_sort, created_by)
         values ($1, $2, $3, 0, null, null, $4, $5, $6, $7, 'Missing', $8, $9, $10, $11, 'qa')`,
        [draftId, recordId, covered.requirementId, covered.recordVersion, JSON.stringify(covered.context), covered.prompt, covered.fieldLabel,
         index + 1, covered.tier, covered.recordNo, covered.requirementSort],
      );
    }

    // OPEN: the inventory returns the body as stored.
    const { GET } = await import("@/app/api/drafts/route");
    const inventory = await (await GET(new Request(`http://localhost/api/drafts?projectId=${projectId}`))).json();
    const opened = inventory.drafts.find((d: { id: string }) => d.id === draftId);
    expect(opened.body).toBe(body);
    expect(opened.items.every((item: { staleReasons: string[] }) => item.staleReasons.length === 0)).toBe(true);
    // FLAGGED, NOT SILENT, AND NOT STALE (review A1): the in-house line is
    // named as ours to answer, the client line is not, and nothing is refused.
    expect(opened.nowOursCount).toBe(1);
    const flags = Object.fromEntries(opened.items.map((item: { requirementId: string; nowOurs: boolean }) => [item.requirementId, item.nowOurs]));
    expect(flags).toEqual({ [inHouseId]: true, [comId]: false });

    // DOWNLOAD: the message file carries the stored body, byte for byte.
    const { GET: eml } = await import("@/app/api/drafts/[id]/eml/route");
    const { quotedPrintableEncode } = await import("@/lib/eml");
    const file = await (await eml(new Request(`http://localhost/api/drafts/${draftId}/eml`), params(draftId))).text();
    expect(file.endsWith(`\r\n\r\n${quotedPrintableEncode(body)}\r\n`)).toBe(true);
    const stored = (await client.query(`select body from email_drafts where id = $1`, [draftId])).rows[0].body;
    expect(stored).toBe(body);

    // EDIT: still editable, its in-house line RETAINED (the rule refuses an
    // added line only), and re-rendered from its own coverage.
    const { POST } = await import("@/app/api/drafts/[id]/edit/route");
    const res = await POST(
      req({ version: 1, introText: "old intro", closingText: "Many thanks,", questions: [inHouseId, comId].map((requirementId) => ({ recordId, requirementId })) }),
      params(draftId),
    );
    expect(res.status).toBe(200);
    const edited = (await client.query(`select body, template_version from email_drafts where id = $1`, [draftId])).rows[0];
    expect(String(edited.body)).toContain("Assembly guide required");
    expect(Number(edited.template_version)).toBe(4);
  });

  it("moves ONE CAM question to the client for ONE project, audited, and back", async () => {
    const { loadOutstanding } = await import("@/lib/chase-drafts");
    const audience = async (pid: string, rid: string) =>
      (await loadOutstanding(pid)).find((q) => q.requirementId === camId && q.recordId === rid)!;

    expect((await audience(projectId, recordId)).audience).toBe("cam");
    const moved = await route({ questionKey: "prompt:__qa toe agreement", askClient: true });
    expect(moved.status).toBe(200);
    // WHERE IT WENT, truly (review A3): the designer whose chase now ticks it.
    expect(await moved.json()).toMatchObject({ chasedTo: [{ contactName: "__QA Designer", items: 1 }], unassigned: 0 });
    const here = await audience(projectId, recordId);
    expect(here).toMatchObject({ audience: "client", seedAudience: "cam" });
    // Another project asking the same question is untouched.
    expect((await audience(otherProjectId, otherRecordId)).audience).toBe("cam");
    const audit = await client.query(
      `select action from audit_log where table_name = 'project_question_routes' and new_values->>'project_id' = $1`,
      [projectId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["insert"]);

    // Now a designer may be asked it.
    expect((await generate(designerId, [comId, camId])).status).toBe(201);

    // And back: the route is deleted, the delete is audited, and it is refused again.
    expect((await route({ questionKey: "prompt:__qa toe agreement", askClient: false })).status).toBe(200);
    expect((await audience(projectId, recordId)).audience).toBe("cam");
    const deleted = await client.query(
      `select count(*)::int as n from audit_log where table_name = 'project_question_routes' and action = 'delete' and old_values->>'project_id' = $1`,
      [projectId],
    );
    expect(deleted.rows[0].n).toBe(1);
    const res = await generate(designerId, [comId, camId]);
    expect(res.status).toBe(409);
  });

  // Decision E: a question worded for us is never sent. "Ask the client" is
  // the CAM's way out (decision D), so an in-house question is refused in
  // words and nothing is stored (chase review A2).
  // REVIEW A1, the third route into the state: a colleague's draft holds
  // in-house lines by right; re-role the colleague to a designer and those
  // lines are flagged on the card, read off the LIVE contact row.
  it("flags a colleague's in-house lines once the colleague is re-roled to a designer, and refuses nothing", async () => {
    expect((await generate(colleagueId, [comId, inHouseId])).status).toBe(201);
    const { GET } = await import("@/app/api/drafts/route");
    const open = async () =>
      ((await (await GET(new Request(`http://localhost/api/drafts?projectId=${projectId}`))).json()).drafts as {
        contact_id: string;
        status: string;
        nowOursCount: number;
        staleCount: number;
        items: { requirementId: string; nowOurs: boolean }[];
      }[]).find((d) => d.contact_id === colleagueId && d.status === "draft")!;
    expect((await open()).nowOursCount).toBe(0);
    await client.query(`update project_contacts set role = 'designer', updated_by = 'qa' where id = $1`, [colleagueId]);
    try {
      const flagged = await open();
      expect(flagged.nowOursCount).toBe(1);
      expect(flagged.staleCount).toBe(0);
      expect(flagged.items.find((item) => item.requirementId === inHouseId)?.nowOurs).toBe(true);
    } finally {
      await client.query(`update project_contacts set role = 'internal', updated_by = 'qa' where id = $1`, [colleagueId]);
    }
  });

  it("refuses to move an IN-HOUSE question to the client, in words, and stores nothing", async () => {
    const res = await route({ questionKey: "field:191", askClient: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("in_house");
    expect(body.error).toMatch(/in-house/i);
    expect(body.error).toMatch(/never sent/);
    const rows = await client.query(`select count(*)::int as n from project_question_routes where project_id = $1`, [projectId]);
    expect(rows.rows[0].n).toBe(0);
  });

  // AUDIT A4 OF THE CHASE REVIEW: write_audit() takes a DELETE's actor from
  // the old row's updated_by, so B putting back A's move was logged as A.
  it("audits Put it back under the person who pressed it, not the one who moved it", async () => {
    const mark = Number((await client.query(`select coalesce(max(id), 0) as id from audit_log`)).rows[0].id);
    session.email = "__qa-mover@example.test";
    try {
      expect((await route({ questionKey: "prompt:__qa toe agreement", askClient: true })).status).toBe(200);
      session.email = "__qa-restorer@example.test";
      expect((await route({ questionKey: "prompt:__qa toe agreement", askClient: false })).status).toBe(200);
      const rows = await client.query(
        `select action, changed_by from audit_log
          where table_name = 'project_question_routes' and coalesce(old_values, new_values)->>'project_id' = $1
            and coalesce(old_values, new_values)->>'question_key' = 'prompt:__qa toe agreement'
            and id > $2
          order by id`,
        [projectId, mark],
      );
      const deleted = rows.rows.filter((row) => row.action === "delete");
      expect(deleted).toHaveLength(1);
      expect(deleted[0].changed_by).toBe("__qa-restorer@example.test");
      expect(rows.rows.find((row) => row.action === "insert")?.changed_by).toBe("__qa-mover@example.test");
    } finally {
      session.email = "__qa@example.test";
    }
  });

  it("refuses to move a question nobody on the project asks, one already the client's, or one never moved", async () => {
    const nobody = await route({ questionKey: "field:999999", askClient: true });
    expect(nobody.status).toBe(409);
    expect((await nobody.json()).error).toMatch(/No item on this project asks/);
    const already = await route({ questionKey: "field:1", askClient: true });
    expect(already.status).toBe(409);
    expect((await already.json()).error).toMatch(/already a client question/);
    const never = await route({ questionKey: "field:191", askClient: false });
    expect(never.status).toBe(409);
    const rows = await client.query(`select count(*)::int as n from project_question_routes where project_id = $1`, [projectId]);
    expect(rows.rows[0].n).toBe(0);
  });
});
