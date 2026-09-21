// Database tier — an email's dimension becomes an ATTRIBUTE, and the checklist
// answer is composed from every slot the record holds.
//
// Skips silently without DATABASE_URL:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/spec-document-dimensions.test.ts
//
// NO MODEL IS CALLED. Staged proposals are written straight into
// intake_runs.parsed, which is exactly what a real extraction produces.
//
// The rule being proved is the one that made this worth building: "Seat height"
// and "Overall" both belong to the ONE Dimensions question, so they cannot each
// be an answer. They are slots, they compose, and a later document supplying
// one slot recomposes the whole cell rather than replacing it.
//
// Rows are prefixed `__QA ` and deleted FK-safe.
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
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("an email's dimensions", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let categoryId = "";
  let recordId = "";
  let specRunId = "";
  let runId = "";
  let dimensionRequirementId = "";

  beforeAll(async () => {
    await client.connect();

    // A category that actually asks BWS field 3, which is where all five slots
    // compose. CLAUDE.md says all 17 do; this asserts it rather than assuming.
    const category = await client.query(
      `select q.id as requirement_id, q.category_id
         from requirements q
         join spec_fields f on f.id = q.spec_field_id
        where f.json_id = 3
        order by q.category_id limit 1`,
    );
    if (!category.rows[0]) throw new Error("no requirement maps to BWS field 3");
    categoryId = category.rows[0].category_id;
    dimensionRequirementId = category.rows[0].requirement_id;

    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       -- NOT P90007: boq-concurrency.test.ts already owns it, and two files
       -- inserting the same bws_project_number race in a parallel run. The
       -- loser dies in beforeAll, its afterAll then throws on an empty id, and
       -- the project it did create is left behind to fail the NEXT run too.
       values ('${qaNumber("P90013")}', '__QA Dimension project', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const specRun = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    specRunId = specRun.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9301, 'active', $3, '__QA Armchair', 'qa', 'qa') returning id`,
      [projectId, specRunId, categoryId],
    );
    recordId = record.rows[0].id;

    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'spec_document', $2, '__QA note.eml', 'message/rfc822', 512, 'qa') returning id`,
      [projectId, `projects/${projectId}/__qa-note.eml`],
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
    // Snapshots, answers and attributes all cascade from the record.
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // change_sets is append-only and cascades from the project (0014). So is
    // record_snapshots, from its record (0013). Neither is deleted directly.
    await client.query(`delete from attachments where entity_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  beforeEach(async () => {
    // The record is REPLACED rather than emptied: `record_snapshots` is
    // append-only and refuses a delete while its record exists (0012), which
    // is the guarantee, not an inconvenience — it cascades with the record.
    await client.query(`delete from spec_records where id = $1`, [recordId]);
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
       values ($1, $2, 9301, 'active', $3, '__QA Armchair', 'qa', 'qa') returning id`,
      [projectId, specRunId, categoryId],
    );
    recordId = record.rows[0].id;

    // The checklist rows, `missing`, exactly as setting a category creates
    // them. `applyAnswerFills` only ever UPDATES — a record with no answer
    // rows has nothing to compose into, which is a real state (an
    // uncategorised record) and not this one.
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, revision_no, state, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 0, 'missing', 'qa', 'qa'
         from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );

    await client.query(`update intake_runs set status = 'parsed', parsed = null where id = $1`, [runId]);
  });

  function dimension(slot: string, figure: string | null, overrides: Partial<Proposal> = {}): Proposal {
    return {
      id: randomUUID(),
      sourceOrdinal: 0,
      runId: specRunId,
      runName: "__QA Main run",
      recordLabel: "__QA-9301",
      dimension: { slot: slot as never, figure, unit: "mm", unitSource: "stated", slotSuggested: false, qualifier: null, tbc: false },
      attributeTarget: null,
      version: 1,
      raw: { refRaw: "__QAS201", attributeRaw: slot, valueRaw: `${figure ?? "TBC"}mm`, page: null, sourceSheet: null, sourceRow: null, confidence: "high", note: null },
      recordCandidates: [],
      requirementCandidates: [],
      recordId,
      requirementId: null,
      target: null,
      proposedValue: figure,
      proposedState: "confirmed",
      stateReason: null,
      overwriteAcknowledged: false,
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
      ...overrides,
    } as Proposal;
  }

  async function stage(lines: Proposal[]) {
    const staged: StagedSpecDocument = { schemaVersion: 1, lines, documentNotes: null, filename: "__QA note.eml" };
    await client.query(`update intake_runs set status = 'parsed', parsed = $2 where id = $1`, [runId, JSON.stringify(staged)]);
  }

  async function confirm(lines: Proposal[]) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(
      post({ action: "confirm", recordId, proposals: lines.map((line) => ({ id: line.id, version: line.version })) }),
      params(runId),
    );
  }

  const answer = async () =>
    (await client.query(`select value, state from spec_answers where record_id = $1 and requirement_id = $2`, [
      recordId,
      dimensionRequirementId,
    ])).rows[0];

  it("writes an attribute per slot and composes ONE dimensions answer", async () => {
    const lines = [dimension("W", "660"), dimension("D", "685"), dimension("H", "680")];
    await stage(lines);

    const res = await confirm(lines);
    expect(res.status).toBe(200);

    const attributes = await client.query(
      `select dimension_slot, value, unit, attr_group, status from record_attributes
       where record_id = $1 order by dimension_slot`,
      [recordId],
    );
    expect(attributes.rows).toHaveLength(3);
    expect(attributes.rows.every((row) => row.attr_group === "dimension" && row.status === "active")).toBe(true);
    expect(attributes.rows.map((row) => `${row.dimension_slot}${row.value}${row.unit}`).sort()).toEqual([
      "D685mm",
      "H680mm",
      "W660mm",
    ]);

    // THREE slots, ONE answer. This is the whole reason a dimension is not
    // matched to a question: three answers is not representable and three
    // proposals aimed at one answer is a duplicate-target refusal.
    const composed = await answer();
    expect(composed.value).toBe("W660 x D685 x H680mm");
    expect(composed.state).toBe("confirmed");
  });

  it("recomposes the WHOLE cell when a later email supplies one more slot", async () => {
    const first = [dimension("W", "660"), dimension("D", "685"), dimension("H", "680")];
    await stage(first);
    expect((await confirm(first)).status).toBe(200);

    const second = [dimension("SH", "445")];
    await stage(second);
    expect((await confirm(second)).status).toBe(200);

    // Not "SH445mm": a message supplying only the seat height still recomposes
    // over the width and depth an earlier document confirmed.
    expect((await answer()).value).toBe("W660 x D685 x H680 x SH445mm");
  });

  it("keeps the wording a figure was read from, as a note beside it", async () => {
    const line = dimension("SH", "445");
    line.dimension = { ...line.dimension!, qualifier: "(measured to top of cushion, compressed)" };
    line.raw = { ...line.raw, valueRaw: "445mm (measured to top of cushion, compressed)" };
    await stage([line]);
    expect((await confirm([line])).status).toBe(200);

    const notes = await client.query(
      `select value from record_attributes where record_id = $1 and attr_group = 'note'`,
      [recordId],
    );
    // "445" on its own does not say what it measures.
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].value).toContain("measured to top of cushion");
  });

  it("refuses to replace an occupied slot without an acknowledgement, and writes NOTHING", async () => {
    const first = [dimension("SH", "440")];
    await stage(first);
    expect((await confirm(first)).status).toBe(200);

    const held = await client.query(
      `select id, version from record_attributes where record_id = $1 and dimension_slot = 'SH' and status = 'active'`,
      [recordId],
    );
    const occupant = held.rows[0];

    const replacement = dimension("SH", "445", {
      attributeTarget: {
        attributeId: occupant.id,
        attributeVersion: Number(occupant.version),
        label: "SH",
        value: "440",
        unit: "mm",
      },
    });
    await stage([replacement]);

    const res = await confirm([replacement]);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("blocked");

    // Nothing moved: the old row is still active and still 440.
    const after = await client.query(
      `select value, status from record_attributes where record_id = $1 and dimension_slot = 'SH'`,
      [recordId],
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({ value: "440", status: "active" });
    expect((await answer()).value).toBe("SH440mm");
  });

  it("retires the old row and recomposes once the replacement is acknowledged", async () => {
    const first = [dimension("SH", "440")];
    await stage(first);
    expect((await confirm(first)).status).toBe(200);

    const held = await client.query(
      `select id, version from record_attributes where record_id = $1 and dimension_slot = 'SH' and status = 'active'`,
      [recordId],
    );
    const occupant = held.rows[0];

    const replacement = dimension("SH", "445", {
      overwriteAcknowledged: true,
      attributeTarget: {
        attributeId: occupant.id,
        attributeVersion: Number(occupant.version),
        label: "SH",
        value: "440",
        unit: "mm",
      },
    });
    await stage([replacement]);
    expect((await confirm([replacement])).status).toBe(200);

    // Retired, never deleted: what the earlier document said is still on record.
    const rows = await client.query(
      `select value, status from record_attributes where record_id = $1 and dimension_slot = 'SH' order by status`,
      [recordId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => `${row.value}:${row.status}`).sort()).toEqual(["440:retired", "445:active"]);
    expect((await answer()).value).toBe("SH445mm");
  });

  it("refuses a stale occupant rather than retiring a value nobody saw", async () => {
    const first = [dimension("SH", "440")];
    await stage(first);
    expect((await confirm(first)).status).toBe(200);
    const held = await client.query(
      `select id, version from record_attributes where record_id = $1 and dimension_slot = 'SH' and status = 'active'`,
      [recordId],
    );

    const replacement = dimension("SH", "445", {
      overwriteAcknowledged: true,
      attributeTarget: {
        attributeId: held.rows[0].id,
        // The version the reviewer saw, one behind where it is now.
        attributeVersion: Number(held.rows[0].version) + 5,
        label: "SH",
        value: "440",
        unit: "mm",
      },
    });
    await stage([replacement]);

    const res = await confirm([replacement]);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("occupant_changed");
    expect((await answer()).value).toBe("SH440mm");
  });

  function finish(label: string, value: string, specFieldName: string, overrides: Partial<Proposal> = {}): Proposal {
    return {
      ...dimension("W", "1"),
      id: randomUUID(),
      dimension: null,
      finish: {
        group: "material",
        specFieldId: null,
        specFieldName,
        codeRaw: value.split(" ")[0] ?? null,
        value,
        tbc: false,
        reason: null,
      },
      raw: { refRaw: "__QAS201", attributeRaw: label, valueRaw: value, page: null, sourceSheet: null, sourceRow: null, confidence: "high", note: null },
      proposedValue: value,
      ...overrides,
    } as Proposal;
  }

  it("writes a finish as an attribute carrying its BWS field, and fills that answer", async () => {
    const fields = await client.query(`select id, name from spec_fields where json_id = 1`);
    const com1 = fields.rows[0];

    const line = finish("Outside back", "UPH-07", com1.name);
    line.finish = { ...line.finish!, specFieldId: com1.id };
    await stage([line]);
    expect((await confirm([line])).status).toBe(200);

    const attributes = await client.query(
      `select attr_group, label, value, material_code, spec_field_id, dimension_slot
         from record_attributes where record_id = $1 and status = 'active'`,
      [recordId],
    );
    expect(attributes.rows).toHaveLength(1);
    expect(attributes.rows[0]).toMatchObject({
      attr_group: "material",
      value: "UPH-07",
      // The client's own code, kept where the finishes library can find it.
      material_code: "UPH-07",
      spec_field_id: com1.id,
      // 0011's biconditional: only a dimension carries a slot.
      dimension_slot: null,
    });

    // And it reaches the CHECKLIST, which is the whole point — this is what an
    // alias vocabulary was going to be used for.
    const answered = await client.query(
      `select a.value, a.state from spec_answers a
       join requirements q on q.id = a.requirement_id
       where a.record_id = $1 and q.spec_field_id = $2`,
      [recordId, com1.id],
    );
    expect(answered.rows[0]?.value).toBe("UPH-07");
    expect(answered.rows[0]?.state).toBe("confirmed");
  });

  it("records a TBC dimension as a state, never as a blank", async () => {
    const line = dimension("SH", null);
    line.dimension = { ...line.dimension!, tbc: true, unit: null, unitSource: null };
    line.proposedState = "tbc";
    line.raw = { ...line.raw, valueRaw: "TBC" };
    await stage([line]);
    expect((await confirm([line])).status).toBe(200);

    const rows = await client.query(
      `select state, value from record_attributes where record_id = $1 and dimension_slot = 'SH'`,
      [recordId],
    );
    expect(rows.rows[0].state).toBe("tbc");
    expect((await answer()).state).toBe("tbc");
  });
});
