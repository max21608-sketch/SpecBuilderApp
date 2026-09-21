// Database tier — the M2 review and confirm boundary, through the REAL routes.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// NO MODEL IS CALLED anywhere in this file. The staged proposals are written
// straight into intake_runs.parsed, which is exactly what a real extraction
// produces — so every guard below is exercised against the real shape without
// spending anything.
//
// Every failure case asserts "and writes nothing". That is the house style for
// a gate: a refusal that half-wrote is worse than no gate at all.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { Proposal, StagedSpecDocument } from "@/lib/spec-document";

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

function post(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patch(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIfDb("spec document review", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let categoryId = "";
  let recordId = "";
  let otherRecordId = "";
  let otherCategoryId = "";
  let otherCategoryRecordId = "";
  let runId = "";
  let requirementIds: string[] = [];
  let requirementPrompts: string[] = [];

  beforeAll(async () => {
    await client.connect();

    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90004")}', '__QA Extraction project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const category = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id
       group by c.id having count(q.id) >= 3
       order by c.id limit 1`,
    );
    categoryId = category.rows[0].id;

    const reqs = await client.query(
      `select id, prompt from requirements where category_id = $1 order by sort_order limit 3`,
      [categoryId],
    );
    requirementIds = reqs.rows.map((row: { id: string }) => row.id);
    requirementPrompts = reqs.rows.map((row: { prompt: string }) => row.prompt);

    // Every record belongs to a run (0007).
    const specRun = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = specRun.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9101, 'active', $3, '__QA Armchair', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    recordId = record.rows[0].id;

    const other = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9102, 'active', $3, '__QA Sofa', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    otherRecordId = other.rows[0].id;

    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
       values ($1, $2, 'boq_code', '__QASX11A', '__QASX11A', 'test', 'qa')`,
      [recordId, projectId],
    );

    const otherCategory = await client.query(
      `select c.id from item_categories c
       join requirements q on q.category_id = c.id
       where c.id <> $1
       group by c.id having count(q.id) >= 1
       order by c.id limit 1`,
      [categoryId],
    );
    otherCategoryId = otherCategory.rows[0].id;

    const foreignCategoryRecord = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9103, 'active', $3, '__QA Cabinet', 'qa', 'qa') returning id`,
      [projectId, runId, otherCategoryId],
    );
    otherCategoryRecordId = foreignCategoryRecord.rows[0].id;

    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'spec_document', $2, '__QA schedule.pdf', 'application/pdf', 1024, 'qa') returning id`,
      [projectId, `projects/${projectId}/__qa-schedule.pdf`],
    );

    const run = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'ffe_schedule', 'pending', 'qa', 'qa') returning id`,
      [projectId, attachment.rows[0].id],
    );
    runId = run.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from status_history where entity_type = 'intake_run' and entity_id = $1`, [runId]);
    await client.query(
      `delete from status_history where entity_type = 'spec_record' and entity_id in ($1, $2, $3)`,
      [recordId, otherRecordId, otherCategoryRecordId],
    );
    await client.query(`delete from spec_answers where record_id in ($1, $2, $3)`, [
      recordId, otherRecordId, otherCategoryRecordId,
    ]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  // ---- fixtures ------------------------------------------------------------

  function proposal(overrides: Partial<Proposal> = {}): Proposal {
    const requirementId = overrides.requirementId ?? requirementIds[0] ?? "";
    const index = requirementIds.indexOf(requirementId);
    return {
      id: randomUUID(),
      sourceOrdinal: 0,
      version: 1,
      raw: {
        refRaw: "__QASX11A",
        attributeRaw: "Leg finish",
        valueRaw: "Antique brass",
        page: 14,
        sourceSheet: null,
        sourceRow: null,
        confidence: "high",
        note: null,
      },
      recordCandidates: [],
      requirementCandidates: [],
      recordId,
      requirementId,
      target: {
        recordId,
        recordLabel: `${qaNumber("P90004")}-9101`,
        recordVersion: 1,
        requirementId,
        requirementPrompt: requirementPrompts[index < 0 ? 0 : index] ?? "",
        requirementKind: "spec_field",
        answerExists: false,
        answerId: null,
        answerVersion: null,
        answerState: null,
        answerValue: null,
      },
      proposedValue: "Antique brass",
      proposedState: "confirmed",
      stateReason: null,
      overwriteAcknowledged: false,
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
      ...overrides,
    };
  }

  async function stage(lines: Proposal[], status = "parsed") {
    const staged: StagedSpecDocument = {
      schemaVersion: 1,
      lines,
      documentNotes: null,
      filename: "__QA schedule.pdf",
    };
    await client.query(
      `update intake_runs
         set parsed = $2::jsonb, status = $3, confirmed_at = null, error = null,
             attempt_id = null, claim_token = null, claim_count = 0,
             queued_at = null, attempt_deadline_at = null, processing_started_at = null
       where id = $1`,
      [runId, JSON.stringify(staged), status],
    );
    const rows = await client.query(`select version from intake_runs where id = $1`, [runId]);
    return Number(rows.rows[0].version);
  }

  async function currentStaged(): Promise<StagedSpecDocument> {
    const rows = await client.query(`select parsed from intake_runs where id = $1`, [runId]);
    return rows.rows[0].parsed as StagedSpecDocument;
  }

  async function runRow() {
    const rows = await client.query(`select * from intake_runs where id = $1`, [runId]);
    return rows.rows[0];
  }

  async function answersFor(record = recordId) {
    const rows = await client.query(
      `select requirement_id, value, value_raw, state, source_kind, source_id, confirmed_by, version
         from spec_answers where record_id = $1 order by requirement_id`,
      [record],
    );
    return rows.rows;
  }

  const confirm = async (body: unknown) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post(body), params(runId));
  };

  beforeEach(async () => {
    await client.query(`delete from spec_answers where record_id in ($1, $2)`, [recordId, otherRecordId]);
  });

  // ---- the happy path ------------------------------------------------------

  it("applies a whole record's proposals and records where they came from", async () => {
    const a = proposal({ requirementId: requirementIds[0] });
    const b = proposal({
      requirementId: requirementIds[1],
      proposedValue: "TBC",
      proposedState: "tbc",
      raw: { ...proposal().raw, attributeRaw: "Seat fabric", valueRaw: "TBC" },
    });
    const version = await stage([a, b]);

    const res = await confirm({
      version,
      action: "confirm",
      recordId,
      proposals: [
        { id: a.id, version: 1 },
        { id: b.id, version: 1 },
      ],
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.applied).toBe(2);

    const answers = await answersFor();
    expect(answers).toHaveLength(2);
    const confirmed = answers.find((row) => row.state === "confirmed");
    expect(confirmed?.value).toBe("Antique brass");
    expect(confirmed?.source_kind).toBe("document");
    expect(confirmed?.source_id).toBe(runId);
    expect(confirmed?.confirmed_by).toBe("__qa@example.test");

    // A TBC observation is a real answer and it does NOT get a confirmer: who
    // accepted it is proposal metadata, not an attestation that it is settled.
    const tbc = answers.find((row) => row.state === "tbc");
    expect(tbc?.confirmed_by).toBeNull();
    expect(tbc?.value_raw).toBe("TBC");

    // Nothing pending left, so the run reads as review-complete.
    expect((await runRow()).status).toBe("confirmed");
    const staged = await currentStaged();
    expect(staged.lines.every((line) => line.reviewStatus === "applied")).toBe(true);
    // Reviewed rows are KEPT, not compacted away.
    expect(staged.lines).toHaveLength(2);
    expect(staged.lines[0]?.applied?.answerId).toBeTruthy();
  });

  // ---- the guards ----------------------------------------------------------

  it("refuses a card whose pending set changed, and writes nothing", async () => {
    const a = proposal({ requirementId: requirementIds[0] });
    const b = proposal({ requirementId: requirementIds[1] });
    const version = await stage([a, b]);

    // Only one of the two named: the reviewer is looking at half a card.
    const res = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("card_changed");
    expect(await answersFor()).toHaveLength(0);
  });

  it("refuses a stale proposal version, and writes nothing", async () => {
    const a = proposal();
    const version = await stage([a]);
    const res = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 99 }] });
    expect((await res.json()).code).toBe("proposal_version_stale");
    expect(await answersFor()).toHaveLength(0);
  });

  it("refuses two proposals aimed at one question, and writes NEITHER", async () => {
    const a = proposal({ requirementId: requirementIds[0], proposedValue: "Antique brass" });
    const b = proposal({ requirementId: requirementIds[0], proposedValue: "Polished nickel" });
    const version = await stage([a, b]);

    const res = await confirm({
      version, action: "confirm", recordId,
      proposals: [{ id: a.id, version: 1 }, { id: b.id, version: 1 }],
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/answers this question/);
    expect(await answersFor()).toHaveLength(0);
  });

  it("refuses to overwrite a settled answer without an acknowledgement", async () => {
    const inserted = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, confirmed_by, confirmed_at, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'confirmed', 'Chrome', 'someone@example.test', now(), 'qa', 'qa'
         from requirements q where q.id = $2
       returning id, version`,
      [recordId, requirementIds[0]],
    );
    const existing = inserted.rows[0];

    const a = proposal({
      requirementId: requirementIds[0],
      target: {
        ...(proposal().target as NonNullable<Proposal["target"]>),
        requirementId: requirementIds[0] ?? "",
        answerExists: true,
        answerId: existing.id,
        answerVersion: existing.version,
        answerState: "confirmed",
        answerValue: "Chrome",
      },
    });
    const version = await stage([a]);

    const blocked = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    expect((await blocked.json()).error).toMatch(/already answered/);
    expect((await answersFor())[0]?.value).toBe("Chrome");

    // Acknowledged, it goes through.
    const acknowledged = await stage([{ ...a, overwriteAcknowledged: true }]);
    const ok = await confirm({
      version: acknowledged, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }],
    });
    expect(ok.status).toBe(200);
    expect((await answersFor())[0]?.value).toBe("Antique brass");
  });

  it("refuses when the answer moved after the snapshot, and writes nothing", async () => {
    const inserted = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'tbc', 'TBC', 'qa', 'qa' from requirements q where q.id = $2
       returning id, version`,
      [recordId, requirementIds[0]],
    );
    const existing = inserted.rows[0];

    const a = proposal({
      requirementId: requirementIds[0],
      target: {
        ...(proposal().target as NonNullable<Proposal["target"]>),
        requirementId: requirementIds[0] ?? "",
        answerExists: true,
        answerId: existing.id,
        answerVersion: existing.version,
        answerState: "tbc",
        answerValue: "TBC",
      },
    });
    const version = await stage([a]);

    // Somebody edits the answer between the snapshot and the confirm.
    await client.query(`update spec_answers set value = 'Brushed steel', updated_by = 'someone' where id = $1`, [
      existing.id,
    ]);

    const res = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("answer_version_stale");
    expect((await answersFor())[0]?.value).toBe("Brushed steel");
  });

  it("rolls the WHOLE card back when one of its answers moves", async () => {
    const inserted = await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'tbc', 'TBC', 'qa', 'qa' from requirements q where q.id = $2
       returning id, version`,
      [recordId, requirementIds[1]],
    );
    const moved = inserted.rows[0];

    const a = proposal({ requirementId: requirementIds[0] });
    const b = proposal({
      requirementId: requirementIds[1],
      target: {
        ...(proposal().target as NonNullable<Proposal["target"]>),
        requirementId: requirementIds[1] ?? "",
        answerExists: true,
        answerId: moved.id,
        answerVersion: moved.version,
        answerState: "tbc",
        answerValue: "TBC",
      },
    });
    const version = await stage([a, b]);

    await client.query(`update spec_answers set value = 'Moved', updated_by = 'someone' where id = $1`, [moved.id]);

    const res = await confirm({
      version, action: "confirm", recordId,
      proposals: [{ id: a.id, version: 1 }, { id: b.id, version: 1 }],
    });
    expect(res.status).toBe(409);

    // The FIRST proposal's answer must not exist: a half-applied card looks
    // finished, and the missing answer is invisible.
    const answers = await answersFor();
    expect(answers).toHaveLength(1);
    expect(answers[0]?.requirement_id).toBe(requirementIds[1]);
    expect(answers[0]?.value).toBe("Moved");
    expect((await currentStaged()).lines.every((line) => line.reviewStatus === "pending")).toBe(true);
  });

  it("refuses a question from another category, and writes nothing", async () => {
    const foreign = await client.query(
      `select id from requirements where category_id <> $1 order by id limit 1`,
      [categoryId],
    );
    const a = proposal({
      requirementId: foreign.rows[0].id,
      target: {
        ...(proposal().target as NonNullable<Proposal["target"]>),
        requirementId: foreign.rows[0].id,
      },
    });
    const version = await stage([a]);
    const res = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    expect((await res.json()).code).toBe("requirement_mismatch");
    expect(await answersFor()).toHaveLength(0);
  });

  it("refuses a record from another project, and writes nothing", async () => {
    const otherProject = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90005")}', '__QA Elsewhere', 'qa', 'qa') returning id`,
    );
    const foreignRun = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Elsewhere run', 'qa', 'qa') returning id`,
      [otherProject.rows[0].id],
    );
    const foreignRunId = foreignRun.rows[0].id;
    const foreignRecord = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 1, 'active', $3, '__QA Foreign', 'qa', 'qa') returning id`,
      [otherProject.rows[0].id, foreignRunId, categoryId],
    );

    const a = proposal({
      recordId: foreignRecord.rows[0].id,
      target: { ...(proposal().target as NonNullable<Proposal["target"]>), recordId: foreignRecord.rows[0].id },
    });
    const version = await stage([a]);
    const res = await confirm({
      version, action: "confirm", recordId: foreignRecord.rows[0].id, proposals: [{ id: a.id, version: 1 }],
    });
    expect((await res.json()).code).toBe("wrong_project");
    expect(await answersFor(foreignRecord.rows[0].id)).toHaveLength(0);

    await client.query(`delete from spec_answers where record_id = $1`, [foreignRecord.rows[0].id]);
    await client.query(`delete from spec_records where project_id = $1`, [otherProject.rows[0].id]);
    await client.query(`delete from spec_runs where project_id = $1`, [otherProject.rows[0].id]);
    await client.query(`delete from projects where id = $1`, [otherProject.rows[0].id]);
  });

  it("refuses to confirm the same proposals twice", async () => {
    const a = proposal();
    const version = await stage([a]);
    const first = await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    expect(first.status).toBe(200);

    const second = await confirm({ action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });
    const body = await second.json();
    expect(second.status).toBe(409);
    expect(body.code).toBe("proposal_reviewed");
    expect(await answersFor()).toHaveLength(1);
  });

  // ---- ignore and restore ---------------------------------------------------

  it("ignores without writing any answer, and restores back to pending", async () => {
    const a = proposal();
    const version = await stage([a]);

    const ignored = await confirm({ version, action: "ignore", proposals: [{ id: a.id, version: 1 }] });
    expect(ignored.status).toBe(200);
    expect(await answersFor()).toHaveLength(0);
    expect((await runRow()).status).toBe("confirmed"); // nothing pending remains
    expect((await currentStaged()).lines[0]?.reviewStatus).toBe("ignored");

    // Restoring the last ignored row REOPENS the completed run.
    const restored = await confirm({ action: "restore", proposals: [{ id: a.id, version: 2 }] });
    expect(restored.status).toBe(200);
    expect((await runRow()).status).toBe("parsed");
    const staged = await currentStaged();
    expect(staged.lines[0]?.reviewStatus).toBe("pending");
    // The acknowledgement was about a value that may have moved.
    expect(staged.lines[0]?.overwriteAcknowledged).toBe(false);
    expect(await answersFor()).toHaveLength(0);
  });

  it("refuses to restore an applied proposal — that would imply undoing an answer", async () => {
    const a = proposal();
    const version = await stage([a]);
    await confirm({ version, action: "confirm", recordId, proposals: [{ id: a.id, version: 1 }] });

    const res = await confirm({ action: "restore", proposals: [{ id: a.id, version: 2 }] });
    expect((await res.json()).code).toBe("proposal_reviewed");
    expect(await answersFor()).toHaveLength(1);
  });

  // ---- autosave -------------------------------------------------------------

  it("edits the proposal it was asked for, not the one at that position", async () => {
    const a = proposal({ requirementId: requirementIds[0] });
    const b = proposal({ requirementId: requirementIds[1], proposedValue: "Walnut" });
    await stage([a, b]);

    // Ignore the FIRST, then edit the second. A positional implementation would
    // now write to the wrong row.
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    await POST(post({ action: "ignore", proposals: [{ id: a.id, version: 1 }] }), params(runId));

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: b.id, expectedProposalVersion: 1, changes: { proposedValue: "Oak" } }),
      params(runId),
    );
    expect(res.status).toBe(200);

    const staged = await currentStaged();
    expect(staged.lines.find((line) => line.id === b.id)?.proposedValue).toBe("Oak");
    expect(staged.lines.find((line) => line.id === a.id)?.proposedValue).toBe("Antique brass");
  });

  it("conflicts on a stale proposal version and returns the current row", async () => {
    const a = proposal();
    await stage([a]);
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    await PATCH(patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { proposedValue: "First" } }), params(runId));

    const stale = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { proposedValue: "Second" } }),
      params(runId),
    );
    const body = await stale.json();
    expect(stale.status).toBe(409);
    expect(body.code).toBe("proposal_version_stale");
    expect(body.diff.proposal.proposedValue).toBe("First");
    expect((await currentStaged()).lines[0]?.proposedValue).toBe("First");
  });

  it("rebuilds the target and drops the acknowledgement when the record changes", async () => {
    const a = proposal({ overwriteAcknowledged: true });
    await stage([a]);

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { recordId: otherRecordId } }),
      params(runId),
    );
    expect(res.status).toBe(200);

    const updated = (await currentStaged()).lines[0];
    expect(updated?.recordId).toBe(otherRecordId);
    // Same category, so the question is still one of this item's questions and
    // is kept -- but against a FRESH target, which the reviewer must see.
    expect(updated?.requirementId).toBe(requirementIds[0]);
    expect(updated?.target?.recordId).toBe(otherRecordId);
    // The acknowledgement was about a different record's answer entirely.
    expect(updated?.overwriteAcknowledged).toBe(false);
  });

  it("clears the question when the new record is in another category", async () => {
    const a = proposal();
    await stage([a]);

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { recordId: otherCategoryRecordId } }),
      params(runId),
    );
    expect(res.status).toBe(200);

    const updated = (await currentStaged()).lines[0];
    expect(updated?.recordId).toBe(otherCategoryRecordId);
    // That question does not exist on a cabinet. Inheriting it would offer an
    // upholstery question for a cabinetry item.
    expect(updated?.requirementId).toBeNull();
    expect(updated?.target).toBeNull();
  });

  it("refuses a question outside the chosen record's category", async () => {
    const foreign = await client.query(
      `select id from requirements where category_id <> $1 order by id limit 1`,
      [categoryId],
    );
    const a = proposal();
    await stage([a]);

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { requirementId: foreign.rows[0].id } }),
      params(runId),
    );
    expect(res.status).toBe(400);
    expect((await currentStaged()).lines[0]?.requirementId).toBe(requirementIds[0]);
  });

  it("refuses to edit a reviewed proposal", async () => {
    const a = proposal({ requirementId: requirementIds[0] });
    // A second, still-pending proposal keeps the run at 'parsed' -- otherwise
    // the run itself is complete and the refusal would be about the run, not
    // about this row.
    const b = proposal({ requirementId: requirementIds[1] });
    const version = await stage([a, b]);
    await confirm({ version, action: "ignore", proposals: [{ id: a.id, version: 1 }] });

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 2, changes: { proposedValue: "Nope" } }),
      params(runId),
    );
    expect((await res.json()).code).toBe("proposal_reviewed");
  });

  it("refuses an unknown change field", async () => {
    const a = proposal();
    await stage([a]);
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(
      patch({ proposalId: a.id, expectedProposalVersion: 1, changes: { state: "confirmed" } }),
      params(runId),
    );
    expect(res.status).toBe(400);
  });
});
