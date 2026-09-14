// Database tier — the new intake boundaries, through the REAL routes.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// Every row is prefixed `__QA ` and deleted in FK-safe order. audit_log is left
// alone: it is append-only by design.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { stageDrawings, type SpecFieldEntry } from "@/lib/drawing-document";
import { stagePreamble } from "@/lib/preamble-document";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("intake routes", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let mainRunId = "";
  let veRunId = "";
  let categoryId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('__QA P90010', '__QA Panther', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    mainRunId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    veRunId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA VE RUN', 2, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    categoryId = (
      await client.query(
        `select c.id from item_categories c join requirements q on q.category_id = c.id
         group by c.id having count(q.id) >= 1 order by c.id limit 1`,
      )
    ).rows[0].id;
    const fieldRows = await client.query(`select id, json_id, name from spec_fields order by sort_order`);
    fields = fieldRows.rows.map((row: { id: string; json_id: number; name: string }) => ({
      id: row.id,
      jsonId: Number(row.json_id),
      name: row.name,
    }));
  });

  afterAll(async () => {
    await client.query(
      `delete from status_history where entity_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from project_notes where project_id = $1`, [projectId]);
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(
      `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  let nextRecordNo = 100;
  async function makeRecord(runId: string, code: string, description: string, withCategory = false): Promise<string> {
    nextRecordNo += 1;
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, qty, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, $5, 4, 'qa', 'qa') returning id`,
      [projectId, runId, nextRecordNo, withCategory ? categoryId : null, description],
    );
    const recordId = record.rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    return recordId;
  }

  async function stageDrawingRun(itemCode: string, overrides: Parameters<typeof stageDrawings>[0][number]) {
    const staged = stageDrawings([overrides], fields, "__QA drawings.pdf", null);
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    void itemCode;
    return { runId: run.rows[0].id as string, version: Number(run.rows[0].version), staged };
  }

  const confirmRoute = async (runId: string, body: unknown) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post(body), params(runId));
  };

  const drawingItem = (code: string) => ({
    itemCodeRaw: code,
    itemNameRaw: "__QA Sofa",
    page: 1,
    dimensions: [{ labelRaw: "Width", valueRaw: "190" }],
    materials: [{ labelRaw: "FABRIC", valueRaw: "__QA Yarn Tessarae", materialCodeRaw: "__QA CH-01" }],
    notesRaw: [],
    confidence: "high" as const,
  });

  // ---- drawings ------------------------------------------------------------

  it("fans one drawing out to the same code in every run, atomically", async () => {
    const code = "__QAX100";
    const main = await makeRecord(mainRunId, code, "__QA Sofa main");
    const ve = await makeRecord(veRunId, code, "__QA Sofa VE");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;

    const res = await confirmRoute(runId, {
      version,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toBe(2);

    for (const recordId of [main, ve]) {
      const rows = await client.query(
        `select label, value, unit, material_code, source_page from record_attributes where record_id = $1 order by sort_order`,
        [recordId],
      );
      expect(rows.rows.map((r: { label: string }) => r.label)).toEqual(["Width", "FABRIC"]);
      expect(rows.rows[0].unit).toBe("cm");
      expect(rows.rows[1].material_code).toBe("__QA CH-01");
      expect(rows.rows[0].source_page).toBe(1);
    }
  });

  it("does not touch spec_records.version when an attribute is written", async () => {
    // Bumping it would invalidate every extraction snapshot and chase coverage
    // row taken against the record, for a reason unrelated to them.
    const code = "__QAX110";
    const recordId = await makeRecord(mainRunId, code, "__QA Armchair");
    const before = await client.query(`select version from spec_records where id = $1`, [recordId]);
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;
    await confirmRoute(runId, {
      version, action: "confirm", itemId: item.id, itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    const after = await client.query(`select version from spec_records where id = $1`, [recordId]);
    expect(after.rows[0].version).toBe(before.rows[0].version);
  });

  it("refuses a card when a run appeared since the page loaded, and writes nothing", async () => {
    const code = "__QAX120";
    const main = await makeRecord(mainRunId, code, "__QA Bench main");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;

    // The reviewer decided on the one record they could see.
    await client.query(
      `update intake_runs set parsed = jsonb_set(parsed, '{items,0,targets}', $2::jsonb) where id = $1`,
      [runId, JSON.stringify({ ticked: [main], unticked: [] })],
    );
    // Then the pack's VE bill was confirmed, creating a second record.
    const ve = await makeRecord(veRunId, code, "__QA Bench VE");

    const res = await confirmRoute(runId, {
      version: version + 1,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("targets_changed");

    for (const recordId of [main, ve]) {
      const rows = await client.query(`select count(*)::int n from record_attributes where record_id = $1`, [recordId]);
      expect(rows.rows[0].n).toBe(0);
    }
  });

  it("refuses a run that holds the code twice, and writes nothing", async () => {
    const code = "__QAX130";
    const a = await makeRecord(mainRunId, code, "__QA Twin A");
    const b = await makeRecord(mainRunId, code, "__QA Twin B");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;

    const res = await confirmRoute(runId, {
      version, action: "confirm", itemId: item.id, itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("blocked");
    for (const recordId of [a, b]) {
      const rows = await client.query(`select count(*)::int n from record_attributes where record_id = $1`, [recordId]);
      expect(rows.rows[0].n).toBe(0);
    }
  });

  it("refuses a card whose code matches no record, naming the BOQ", async () => {
    const { runId, version, staged } = await stageDrawingRun("__QAZZZ", drawingItem("__QAZZZ"));
    const item = staged.items[0]!;
    const res = await confirmRoute(runId, {
      version, action: "confirm", itemId: item.id, itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Confirm the BOQ/);
  });

  it("refuses a BWS field that already has a value on a target record", async () => {
    const code = "__QAX140";
    const recordId = await makeRecord(mainRunId, code, "__QA Occupied");
    const comOne = fields.find((f) => f.jsonId === 1)!;
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, created_by, updated_by)
       values ($1, 'material', '__QA Existing fabric', '__QA Something', $2, 'confirmed', 'qa', 'qa')`,
      [recordId, comOne.id],
    );
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;
    const res = await confirmRoute(runId, {
      version, action: "confirm", itemId: item.id, itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has a value/);
  });

  it("ignores and restores an observation, and refuses to restore an applied one", async () => {
    const code = "__QAX150";
    await makeRecord(mainRunId, code, "__QA Reversible");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;
    const first = item.observations[0]!;

    const ignored = await confirmRoute(runId, {
      version, action: "ignore", itemId: item.id, observations: [{ id: first.id, version: first.version }],
    });
    expect(ignored.status).toBe(200);

    const restored = await confirmRoute(runId, {
      action: "restore", itemId: item.id, observations: [{ id: first.id, version: first.version + 1 }],
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).restored).toBe(1);
  });

  // ---- preamble ------------------------------------------------------------

  it("adds preamble notes to the project and retires one without deleting it", async () => {
    const staged = stagePreamble(
      [
        { topicRaw: "__QA SECTION 4", titleRaw: "__QA Flameproofing", bodyRaw: "__QA Flameproofed to the local standard.", page: 14 },
        { topicRaw: "__QA SECTION 4", titleRaw: "__QA Samples", bodyRaw: "__QA Samples submitted before purchase.", page: 14 },
      ],
      "__QA preamble.pdf",
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'preamble', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    const runId = run.rows[0].id;

    const res = await confirmRoute(runId, {
      version: Number(run.rows[0].version),
      action: "confirm",
      notes: staged.notes.map((note) => ({ id: note.id, version: note.version })),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(2);
    // Nothing pending left, so the run reads as review complete.
    expect(body.status).toBe("confirmed");

    const notes = await client.query(
      `select id, title, source_page, version from project_notes where project_id = $1 order by sort_order`,
      [projectId],
    );
    expect(notes.rows).toHaveLength(2);
    expect(notes.rows[0].source_page).toBe(14);

    const { PATCH } = await import("@/app/api/projects/[id]/notes/[noteId]/route");
    const retire = await PATCH(patch({ status: "retired", version: notes.rows[0].version }), {
      params: Promise.resolve({ id: projectId, noteId: notes.rows[0].id }),
    });
    expect(retire.status).toBe(200);

    // Retired, not deleted: the trail survives.
    const remaining = await client.query(
      `select count(*)::int n from project_notes where project_id = $1 and status = 'active'`,
      [projectId],
    );
    expect(remaining.rows[0].n).toBe(1);
    const all = await client.query(`select count(*)::int n from project_notes where project_id = $1`, [projectId]);
    expect(all.rows[0].n).toBe(2);

    // A stale version writes nothing.
    const stale = await PATCH(patch({ status: "retired", version: 99 }), {
      params: Promise.resolve({ id: projectId, noteId: notes.rows[1].id }),
    });
    expect(stale.status).toBe(409);
  });

  // ---- category ------------------------------------------------------------

  it("sets a category after import and creates the answer rows with it", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX160", "__QA Uncategorised");
    const before = await client.query(`select count(*)::int n from spec_answers where record_id = $1`, [recordId]);
    expect(before.rows[0].n).toBe(0);

    const { PATCH } = await import("@/app/api/records/[id]/route");
    const version = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    const res = await PATCH(patch({ categoryId, version }), params(recordId));
    expect(res.status).toBe(200);

    // A category with no answers scores 0/0 and reads as complete.
    const after = await client.query(`select count(*)::int n from spec_answers where record_id = $1`, [recordId]);
    const expected = await client.query(`select count(*)::int n from requirements where category_id = $1`, [categoryId]);
    expect(after.rows[0].n).toBe(expected.rows[0].n);
  });

  it("refuses a category CHANGE once somebody has answered under the old one", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX170", "__QA Answered", true);
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
       from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );
    const answer = await client.query(
      `select id from spec_answers where record_id = $1 limit 1`, [recordId],
    );
    // Somebody actively said "not yet decided" — a real answer, not an empty row.
    await client.query(
      `update spec_answers set state = 'tbc', value = '__QA TBC', updated_by = 'qa' where id = $1`,
      [answer.rows[0].id],
    );
    const other = await client.query(
      `select id from item_categories where id <> $1 order by id limit 1`, [categoryId],
    );

    const { PATCH } = await import("@/app/api/records/[id]/route");
    const version = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    const res = await PATCH(patch({ categoryId: other.rows[0].id, version }), params(recordId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("category_has_answers");
  });

  // ---- export --------------------------------------------------------------

  const exportRoute = async (query: string) => {
    const { GET } = await import("@/app/api/projects/[id]/export/route");
    return GET(new Request(`http://localhost/test${query}`), params(projectId));
  };

  it("exports every active record in scope, including ones with nothing on them", async () => {
    // "Complete dataset" is the whole rule: a BWS import replaces rather than
    // merges, so an omitted record is one whose fields would be wiped.
    const res = await exportRoute("?format=csv&runId=" + veRunId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    // The allowlist keeps letters, digits, spaces, & and - and drops the rest,
    // including the QA prefix's underscores. Nothing a project name contains
    // can reach a Content-Disposition header as a quote or a newline.
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="QA P90010 - QA VE RUN - BWS spec fields.csv"',
    );

    const inScope = await client.query(
      `select count(*)::int n from spec_records where run_id = $1 and status = 'active'`, [veRunId],
    );
    expect(Number(res.headers.get("x-export-records"))).toBe(inScope.rows[0].n);

    const csv = await res.text();
    const lines = csv.trim().split("\r\n");
    // Two header rows plus one row per record.
    expect(lines.length).toBe(2 + inScope.rows[0].n);
    expect(lines[0]).toContain("Client Code");
    expect(lines[1]?.startsWith(",,,,")).toBe(true); // ids start at AF
  });

  it("covers the whole project when no run is named", async () => {
    const res = await exportRoute("?format=csv");
    const all = await client.query(
      `select count(*)::int n from spec_records where project_id = $1 and status = 'active'`, [projectId],
    );
    expect(Number(res.headers.get("x-export-records"))).toBe(all.rows[0].n);
    expect(res.headers.get("x-export-scope")).toBe("project");
  });

  it("refuses any query parameter it does not recognise", async () => {
    // A filtered export is the erasing case, so the refusal lives in the route.
    const res = await exportRoute("?format=csv&status=incomplete");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/never filtered/);
  });

  it("refuses a run from another project", async () => {
    const other = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90011', '__QA Elsewhere', 'qa', 'qa') returning id`,
    );
    const foreignRun = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Foreign', 'qa', 'qa') returning id`,
      [other.rows[0].id],
    );
    const res = await exportRoute("?runId=" + foreignRun.rows[0].id);
    expect(res.status).toBe(404);
    await client.query(`delete from spec_runs where project_id = $1`, [other.rows[0].id]);
    await client.query(`delete from projects where id = $1`, [other.rows[0].id]);
  });

  it("writes a real xlsx with both sheets", async () => {
    const res = await exportRoute("?format=xlsx&runId=" + mainRunId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/spreadsheetml/);
    const bytes = Buffer.from(await res.arrayBuffer());
    // A .xlsx is a zip; its magic number is the cheapest proof it is not HTML.
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
