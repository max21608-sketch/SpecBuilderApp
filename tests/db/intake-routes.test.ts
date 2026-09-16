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
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";

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

  // ALLOCATED FROM THE DATABASE, like confirm-boq does, and NOT from a counter
  // in this file. A counter was fine until something else started creating
  // records: `ensureVariant` takes `max(record_no) + 1` for a configuration, so
  // the moment one test split a record the next `makeRecord` collided with it on
  // `spec_records_project_no_key`. Variants share the project's numbering —
  // `record_no` is one per RECORD, not one per bill line.
  async function makeRecord(runId: string, code: string, description: string, withCategory = false): Promise<string> {
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, qty, created_by, updated_by)
       values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
               'active', $3, $4, 4, 'qa', 'qa') returning id`,
      [projectId, runId, withCategory ? categoryId : null, description],
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

  /** Ignore one observation, so a bulk edit has something reviewed to skip. */
  async function POSTConfirmIgnore(runId: string, itemId: string, observation: { id: string; version: number }) {
    const runRow = await client.query(`select version from intake_runs where id = $1`, [runId]);
    const res = await confirmRoute(runId, {
      version: Number(runRow.rows[0].version),
      action: "ignore",
      itemId,
      observations: [{ id: observation.id, version: observation.version }],
    });
    expect(res.status).toBe(200);
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
    dimensionsCombinedRaw: [],
  notesRaw: [],
    confidence: "high" as const,
  });


  // ---- through to the checklist --------------------------------------------
  // Confirming a card writes the attribute AND the checklist answer it
  // implies. The gate still holds -- a human ticked the observation against
  // the page -- and the alternative was asking them to retype
  // "W1900 x D790 x H720", which is where a 790 becomes a 709.

  /** The answer rows a categorised record gets, exactly as confirm-boq makes them. */
  async function makeAnswers(recordId: string) {
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
       from requirements q join spec_records r on r.category_id = q.category_id
       where r.id = $1`,
      [recordId],
    );
  }

  const dimensionsAnswer = async (recordId: string) =>
    (
      await client.query(
        `select a.value, a.value_raw, a.state, a.source_kind, a.source_id, a.confirmed_by
           from spec_answers a
           join requirements q on q.id = a.requirement_id
           join spec_fields f on f.id = q.spec_field_id
          where a.record_id = $1 and f.json_id = 3`,
        [recordId],
      )
    ).rows[0];

  const dimsItem = (code: string, dims: { labelRaw: string; valueRaw: string }[]) => ({
    ...drawingItem(code),
    materials: [],
    dimensions: dims,
  });

  it("fills the dimensions answer with the composed cell, on every run", async () => {
    const code = "__QAX170";
    const main = await makeRecord(mainRunId, code, "__QA Sofa main", true);
    const ve = await makeRecord(veRunId, code, "__QA Sofa VE", true);
    await makeAnswers(main);
    await makeAnswers(ve);

    const { runId, version, staged } = await stageDrawingRun(
      code,
      dimsItem(code, [
        { labelRaw: "Width", valueRaw: "1900mm" },
        { labelRaw: "Depth", valueRaw: "790mm" },
        { labelRaw: "Height", valueRaw: "720mm" },
      ]),
    );
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
    // Reported back, so a reviewer is told rather than left to notice.
    expect(body.answersFilled).toBe(2);

    for (const recordId of [main, ve]) {
      const answer = await dimensionsAnswer(recordId);
      // One cell, millimetres, unit once at the end -- composeDimensionCell,
      // the same function the export calls.
      expect(answer.value).toBe("W1900 x D790 x H720mm");
      expect(answer.state).toBe("confirmed");
      expect(answer.confirmed_by).toBe("__qa@example.test");
      // Provenance, so the answer can be traced back to the page.
      expect(answer.source_kind).toBe("document");
      expect(answer.source_id).toBe(runId);
      expect(String(answer.value_raw)).toContain("W 1900");
    }
  });

  it("carries TBC through to the answer instead of confirming it", async () => {
    const code = "__QAX171";
    const recordId = await makeRecord(mainRunId, code, "__QA Sofa tbc", true);
    await makeAnswers(recordId);
    // A page that prints "WIDTH: TBC" beside a real height. This is the real
    // Panther shape -- the sofa records four dimensions as TBC.
    // version and staged are re-read below: setting the unit bumps the run and
    // rewrites the observations, so the pre-PATCH copies are stale by design.
    const { runId } = await stageDrawingRun(
      code,
      dimsItem(code, [
        { labelRaw: "Width", valueRaw: "TBC" },
        { labelRaw: "Height", valueRaw: "720mm" },
      ]),
    );
    // The unit is chosen by the reviewer, exactly as on screen: a unitless
    // dimension is a BLOCKER and the confirm refuses the card until it is
    // answered. Nothing about promotion changes that.
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    expect((await PATCH(patch({ bulkUnit: { scope: "run", unit: "mm" } }), params(runId))).status).toBe(200);

    const reread = await client.query(`select parsed, version from intake_runs where id = $1`, [runId]);
    const item = reread.rows[0].parsed.items[0];
    const res = await confirmRoute(runId, {
      version: Number(reread.rows[0].version),
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o: { id: string; version: number }) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(200);

    const answer = await dimensionsAnswer(recordId);
    // The trap this rule exists for: promoted as confirmed, a gate reads
    // satisfied over a width nobody has decided. TBC is a real, distinct,
    // gate-blocking state and it survives the trip.
    expect(answer.state).toBe("tbc");
    expect(answer.confirmed_by).toBeNull();
    expect(String(answer.value)).toContain("TBC");
    expect(String(answer.value)).toContain("H720");
  });

  it("NEVER overwrites an answer a person typed", async () => {
    const code = "__QAX172";
    const recordId = await makeRecord(mainRunId, code, "__QA Sofa owned", true);
    await makeAnswers(recordId);
    // A human answer: confirmed and marked 'manual', which is what
    // /api/answers/[id] leaves behind once somebody edits.
    await client.query(
      `update spec_answers a
          set value = '__QA typed by a person', state = 'confirmed', confirmed_at = now(), confirmed_by = 'qa', source_kind = 'manual', source_id = null
        from requirements q join spec_fields f on f.id = q.spec_field_id
        where q.id = a.requirement_id and a.record_id = $1 and f.json_id = 3`,
      [recordId],
    );

    const { runId, version, staged } = await stageDrawingRun(
      code,
      dimsItem(code, [{ labelRaw: "Width", valueRaw: "1900mm" }]),
    );
    const item = staged.items[0]!;
    const res = await confirmRoute(runId, {
      version,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    // The card still commits -- the ATTRIBUTE is the record of what the page
    // said, and it lands either way. Only the answer is left alone.
    expect(res.status).toBe(200);
    expect((await res.json()).answersFilled).toBe(0);

    const answer = await dimensionsAnswer(recordId);
    expect(answer.value).toBe("__QA typed by a person");
    expect(answer.source_kind).toBe("manual");

    const attrs = await client.query(
      `select count(*)::int n from record_attributes where record_id = $1 and attr_group = 'dimension'`,
      [recordId],
    );
    expect(attrs.rows[0].n).toBe(1);
  });

  it("RECOMPOSES its own answer as later slots arrive", async () => {
    const code = "__QAX173";
    const recordId = await makeRecord(mainRunId, code, "__QA Sofa growing", true);
    await makeAnswers(recordId);

    const first = await stageDrawingRun(code, dimsItem(code, [{ labelRaw: "Width", valueRaw: "1900mm" }]));
    const firstItem = first.staged.items[0]!;
    await confirmRoute(first.runId, {
      version: first.version,
      action: "confirm",
      itemId: firstItem.id,
      itemVersion: firstItem.version,
      observations: firstItem.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect((await dimensionsAnswer(recordId)).value).toBe("W1900mm");

    // A SECOND document, carrying the height this one never printed. The
    // answer has to say W1900 x H720mm -- not H720mm, which is what reading
    // only the current card would produce.
    const second = await stageDrawingRun(code, dimsItem(code, [{ labelRaw: "Height", valueRaw: "720mm" }]));
    const secondItem = second.staged.items[0]!;
    const res = await confirmRoute(second.runId, {
      version: second.version,
      action: "confirm",
      itemId: secondItem.id,
      itemVersion: secondItem.version,
      observations: secondItem.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(200);
    expect((await dimensionsAnswer(recordId)).value).toBe("W1900 x H720mm");
  });

  it("writes the attribute and no answer when the record has no category yet", async () => {
    const code = "__QAX174";
    const recordId = await makeRecord(mainRunId, code, "__QA Sofa uncategorised");
    const { runId, version, staged } = await stageDrawingRun(
      code,
      dimsItem(code, [{ labelRaw: "Width", valueRaw: "1900mm" }]),
    );
    const item = staged.items[0]!;
    const res = await confirmRoute(runId, {
      version,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    // No questions exist to answer, and that is not a failure: the attribute
    // is the record of what the document said either way.
    expect(res.status).toBe(200);
    expect((await res.json()).answersFilled).toBe(0);
    const attrs = await client.query(
      `select count(*)::int n from record_attributes where record_id = $1`,
      [recordId],
    );
    expect(attrs.rows[0].n).toBe(1);
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

  it("sets the unit on every pending dimension in one request", async () => {
    // The escape from answering the same question once per figure. A pack whose
    // pages print no unit and whose figures disagree arrives with every
    // dimension blank and every card blocked.
    const code = "__QAX120";
    await makeRecord(mainRunId, code, "__QA Bench");
    const { runId, staged } = await stageDrawingRun(code, {
      ...drawingItem(code),
      // 190 and 735 together: suggestUnit abstains, so both arrive blank.
      dimensions: [
        { labelRaw: "Width", valueRaw: "190" },
        { labelRaw: "Seat height", valueRaw: "735" },
      ],
    });
    expect(staged.items[0]!.observations.filter((o) => o.attrGroup === "dimension" && o.unit === null)).toHaveLength(2);

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(patch({ bulkUnit: { scope: "run", unit: "mm" } }), params(runId));
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(2);

    const after = await client.query(`select parsed from intake_runs where id = $1`, [runId]);
    const observations = after.rows[0].parsed.items[0].observations;
    const dimensions = observations.filter((o: { attrGroup: string }) => o.attrGroup === "dimension");
    expect(dimensions.every((o: { unit: string }) => o.unit === "mm")).toBe(true);
    // A human set it, so it must stop reading as a suggestion.
    expect(dimensions.every((o: { unitSuggested: boolean }) => !o.unitSuggested)).toBe(true);
    expect(dimensions.every((o: { version: number }) => o.version === 2)).toBe(true);

    // The material is untouched: the database refuses a unit on one, and
    // bumping its version would make another tab's edit conflict for nothing.
    const material = observations.find((o: { attrGroup: string }) => o.attrGroup === "material");
    expect(material.unit).toBeNull();
    expect(material.version).toBe(1);
  });

  it("leaves reviewed observations alone when setting units in bulk", async () => {
    // An applied observation is history and an ignored one was a decision.
    const code = "__QAX121";
    await makeRecord(mainRunId, code, "__QA Stool");
    const { runId, staged } = await stageDrawingRun(code, {
      ...drawingItem(code),
      dimensions: [
        { labelRaw: "Width", valueRaw: "190" },
        { labelRaw: "Seat height", valueRaw: "735" },
      ],
    });
    const item = staged.items[0]!;
    const ignored = item.observations.find((o) => o.labelRaw === "Seat height")!;

    const { PATCH } = await import("@/app/api/imports/[id]/route");
    await POSTConfirmIgnore(runId, item.id, ignored);

    const res = await PATCH(patch({ bulkUnit: { scope: "item", itemId: item.id, unit: "mm" } }), params(runId));
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(1);

    const after = await client.query(`select parsed from intake_runs where id = $1`, [runId]);
    const rows = after.rows[0].parsed.items[0].observations;
    const stillIgnored = rows.find((o: { id: string }) => o.id === ignored.id);
    expect(stillIgnored.reviewStatus).toBe("ignored");
    expect(stillIgnored.unit).toBeNull();
  });

  it("shows every drawing document in a pack on one screen, with its cross-document warnings", async () => {
    // The real Panther shape: a combined set and a per-item sheet describing
    // the same code, and boilerplate repeated on every sheet.
    const code = "__QAX130";
    const recordId = await makeRecord(mainRunId, code, "__QA Console");
    const batch = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, '__QA pack', 'qa', 'qa') returning id`, [projectId]);
    const batchId = batch.rows[0].id;

    const REMARKS = ["__QA ALL MATERIALS MUST COMPLY WITH APPLICABLE FIRE CODES."];
    const runIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const staged = stageDrawings(
        [{ ...drawingItem(code), itemCodeRaw: i === 2 ? "__QAX131" : code, notesRaw: REMARKS }],
        fields, `__QA sheet ${i}.pdf`, null,
      );
      const run = await client.query(
        `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, parsed, created_by, updated_by)
         values ($1,$2,'spec_document','shop_drawings','parsed',$3::jsonb,'qa','qa') returning id`,
        [projectId, batchId, JSON.stringify(staged)]);
      runIds.push(run.rows[0].id);
    }

    const { GET } = await import("@/app/api/projects/[id]/batches/[batchId]/drawings/route");
    const res = await GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ id: projectId, batchId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.runs).toHaveLength(3);
    // Two of the three carry the same code, so they land on the same record.
    const duplicate = body.duplicates.find((d: { recordId: string }) => d.recordId === recordId);
    expect(duplicate.cards).toHaveLength(2);
    expect(duplicate.recordLabel).toContain("__QA Console");
    // The boilerplate note is on all three.
    expect(body.repeated).toHaveLength(1);
    expect(body.repeated[0].occurrences).toHaveLength(3);
    // And the hand-pick list is there for a card that matched nothing.
    expect(body.records.some((r: { id: string }) => r.id === recordId)).toBe(true);

    await client.query(`delete from intake_runs where id = any($1::uuid[])`, [runIds]);
    await client.query(`delete from intake_batches where id = $1`, [batchId]);
  });

  it("refuses a pack from another project", async () => {
    // Scoped from the batch's own row, so a batch id from elsewhere 404s rather
    // than leaking that project's drawings.
    const other = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90099', '__QA Other', 'qa', 'qa') returning id`);
    const batch = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, '__QA elsewhere', 'qa', 'qa') returning id`, [other.rows[0].id]);

    const { GET } = await import("@/app/api/projects/[id]/batches/[batchId]/drawings/route");
    const res = await GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ id: projectId, batchId: batch.rows[0].id }),
    });
    expect(res.status).toBe(404);

    await client.query(`delete from intake_batches where id = $1`, [batch.rows[0].id]);
    await client.query(`delete from projects where id = $1`, [other.rows[0].id]);
  });

  it("attaches the confirmed picture to every record the drawing fans out to", async () => {
    const code = "__QAX150";
    const main = await makeRecord(mainRunId, code, "__QA Console main");
    const ve = await makeRecord(veRunId, code, "__QA Console VE");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;

    const res = await confirmRoute(runId, {
      version,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
      image: {
        pathname: `projects/${projectId}/item-images/__QA-${code}.png`,
        filename: "__QA console.png",
        width: 640,
        height: 420,
        size: 12_345,
      },
    });
    expect(res.status).toBe(200);

    // ONE drawing of one item; the runs quoting it are quoting that item, so
    // the picture fans out exactly as the attributes do.
    for (const recordId of [main, ve]) {
      const rows = await client.query(
        `select storage_path, content_type, image_width, image_height, size
         from attachments where entity_type = 'spec_records' and entity_id = $1 and kind = 'item_image'`,
        [recordId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].content_type).toBe("image/png");
      expect(rows.rows[0].image_width).toBe(640);
      expect(rows.rows[0].image_height).toBe(420);
    }

    await client.query(
      `delete from attachments where entity_type = 'spec_records' and entity_id = any($1::uuid[])`,
      [[main, ve]],
    );
  });

  it("refuses an image pathname that is not this project's file", async () => {
    // Being signed in does not make an arbitrary pathname this project's. The
    // blob token is the STORE's, not the user's, so a client-chosen address
    // would point a store-wide credential wherever it liked.
    const code = "__QAX151";
    await makeRecord(mainRunId, code, "__QA Mirror");
    const { runId, version, staged } = await stageDrawingRun(code, drawingItem(code));
    const item = staged.items[0]!;

    const res = await confirmRoute(runId, {
      version,
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
      image: { pathname: "projects/00000000-0000-0000-0000-000000000000/item-images/someone-else.png" },
    });
    // 400, not 409: this is a malformed request rather than a lost race.
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("image_not_this_project");

    // Nothing was written -- not the picture, and not the specs either.
    const attrs = await client.query(
      `select count(*)::int n from record_attributes where source_run_id = $1`, [runId]);
    expect(attrs.rows[0].n).toBe(0);
  });

  it("serves an item image only from the record's own attachment row", async () => {
    const { GET } = await import("@/app/api/records/[id]/image/route");
    const code = "__QAX152";
    const recordId = await makeRecord(mainRunId, code, "__QA Lamp");

    // No row yet: a fact the screen renders in words, not a broken image.
    const missing = await GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ id: recordId }),
    });
    expect(missing.status).toBe(404);

    await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
       values ('spec_records', $1, 'item_image', $2, '__QA lamp.png', 'image/png', 'qa')`,
      [recordId, `projects/${projectId}/item-images/__QA-${code}.png`],
    );
    // The blob itself does not exist in the store, so this reaches the read and
    // fails there -- which is the point: it got past the lookup without the
    // caller ever naming a path.
    const found = await GET(new Request("http://localhost/test"), {
      params: Promise.resolve({ id: recordId }),
    });
    expect([404, 502]).toContain(found.status);

    await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id = $1`, [recordId]);
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

  it("flags a note without touching whether it is retired, and 409s on a stale version", async () => {
    // Two independent facts about one note: `status` is whether it is a correct
    // reading of the document, `flagged` is whether an accurate note binds.
    const staged = stagePreamble(
      [{ topicRaw: "__QA SECTION 9", titleRaw: "__QA Precedence", bodyRaw: "__QA Signed drawings take precedence.", page: 2 }],
      "__QA preamble flags.pdf",
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'preamble', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    await confirmRoute(run.rows[0].id, {
      version: Number(run.rows[0].version),
      action: "confirm",
      notes: staged.notes.map((note) => ({ id: note.id, version: note.version })),
    });

    const rows = await client.query(
      `select id, version from project_notes where project_id = $1 and title = '__QA Precedence'`, [projectId]);
    const noteId = rows.rows[0].id;

    const { PATCH } = await import("@/app/api/projects/[id]/notes/[noteId]/route");
    const flag = await PATCH(patch({ flagged: true, version: rows.rows[0].version }), {
      params: Promise.resolve({ id: projectId, noteId }),
    });
    expect(flag.status).toBe(200);

    let after = await client.query(`select status, flagged, version from project_notes where id = $1`, [noteId]);
    expect(after.rows[0].flagged).toBe(true);
    // Flagging must not retire it, and must not be confused with retiring.
    expect(after.rows[0].status).toBe("active");

    // A stale version writes nothing rather than overwriting a change.
    const stale = await PATCH(patch({ flagged: false, version: 99 }), {
      params: Promise.resolve({ id: projectId, noteId }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("note_version_stale");
    expect((await client.query(`select flagged from project_notes where id = $1`, [noteId])).rows[0].flagged).toBe(true);

    // Retiring a flagged note keeps the flag: it is still evidence of what the
    // document was read as, and of how it was judged.
    const retire = await PATCH(patch({ status: "retired", version: after.rows[0].version }), {
      params: Promise.resolve({ id: projectId, noteId }),
    });
    expect(retire.status).toBe(200);
    after = await client.query(`select status, flagged, retired_by from project_notes where id = $1`, [noteId]);
    expect(after.rows[0].status).toBe("retired");
    expect(after.rows[0].flagged).toBe(true);
    expect(after.rows[0].retired_by).toBeTruthy();

    await client.query(`delete from project_notes where id = $1`, [noteId]);
  });

  it("refuses a note patch that changes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/notes/[noteId]/route");
    const res = await PATCH(patch({ version: 1 }), {
      params: Promise.resolve({ id: projectId, noteId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Nothing to change/);
  });

  it("takes a pack with no preamble all the way through", async () => {
    // Nothing anywhere requires one, and plenty of projects have none. This
    // keeps that true rather than true by accident.
    const batch = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, '__QA bill only', 'qa', 'qa') returning id`, [projectId]);
    const batchId = batch.rows[0].id;

    const code = "__QAX140";
    // Idempotent: a retried test must not leave a SECOND record on this code
    // and then fail resolution as ambiguous against its own first attempt.
    await client.query(
      `delete from spec_records where id in (
         select record_id from spec_record_refs where project_id = $1 and ref_value = $2)`,
      [projectId, code],
    );
    const recordId = await makeRecord(mainRunId, code, "__QA Lamp table");
    const staged = stageDrawings([drawingItem(code)], fields, "__QA drawings only.pdf", null);
    const run = await client.query(
      `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1,$2,'spec_document','shop_drawings','parsed',$3::jsonb,'qa','qa') returning id, version`,
      [projectId, batchId, JSON.stringify(staged)]);

    const preambles = await client.query(
      `select count(*)::int as n from intake_runs where batch_id = $1 and document_kind = 'preamble'`, [batchId]);
    expect(preambles.rows[0].n).toBe(0);

    const item = staged.items[0]!;
    const res = await confirmRoute(run.rows[0].id, {
      version: Number(run.rows[0].version),
      action: "confirm",
      itemId: item.id,
      itemVersion: item.version,
      observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).records).toBe(1);

    await client.query(`delete from intake_runs where batch_id = $1`, [batchId]);
    await client.query(`delete from intake_batches where id = $1`, [batchId]);
    await client.query(`delete from record_attributes where record_id = $1`, [recordId]);
    await client.query(`delete from spec_records where id = $1`, [recordId]);
  });

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

  // ---- the item level ------------------------------------------------------

  it("sets an item level, records it as its own change, and shows it in the diff", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX180", "__QA Hero item", true);
    const { PATCH } = await import("@/app/api/records/[id]/route");

    // Set one, then change it. The first version has no predecessor to diff
    // against; the second is what proves a level change is legible afterwards.
    const v1 = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    expect((await PATCH(patch({ level: "simple", version: v1 }), params(recordId))).status).toBe(200);
    const v2 = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    expect((await PATCH(patch({ level: "hero", version: v2 }), params(recordId))).status).toBe(200);

    const stored = await client.query(`select level from spec_records where id = $1`, [recordId]);
    expect(stored.rows[0].level).toBe("hero");

    // Its own kind, not `category_set`: CHANGE_SET_KIND_LABELS is what the
    // history screen prints, and a level filed under "Category set" is a lie
    // by label.
    const changes = await client.query(
      `select cs.kind from change_sets cs
       join record_snapshots s on s.change_set_id = cs.id
       where s.record_id = $1 order by s.snapshot_no desc limit 1`,
      [recordId],
    );
    expect(changes.rows[0].kind).toBe("level_set");

    const { GET } = await import("@/app/api/records/[id]/history/route");
    const history = await GET(new Request("http://localhost/test"), params(recordId));
    const body = await history.json();
    const latest = body.versions[0];
    expect(latest.kind).toBe("level_set");
    expect(latest.diff.core).toContainEqual({ field: "level", label: "Level", was: "simple", now: "hero" });
  });

  it("records nothing when the level is set to what it already was", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX181", "__QA Simple item", true);
    const { PATCH } = await import("@/app/api/records/[id]/route");

    const v1 = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    expect((await PATCH(patch({ level: "simple", version: v1 }), params(recordId))).status).toBe(200);
    const v2 = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;

    // A history entry saying "set the level to what it already was" is noise
    // in the one screen that has to stay readable.
    const before = await client.query(
      `select count(*)::int n from record_snapshots where record_id = $1`, [recordId],
    );
    expect((await PATCH(patch({ level: "simple", version: v2 }), params(recordId))).status).toBe(200);
    const after = await client.query(
      `select count(*)::int n from record_snapshots where record_id = $1`, [recordId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("refuses a level outside the vocabulary, and a stale version", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX182", "__QA Bad level", true);
    const { PATCH } = await import("@/app/api/records/[id]/route");
    const version = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;

    expect((await PATCH(patch({ level: "gold", version }), params(recordId))).status).toBe(400);
    // "With Metalwork" is Matthew's display name for a level, not a fourth one.
    expect((await PATCH(patch({ level: "with Metalwork", version }), params(recordId))).status).toBe(400);
    expect((await PATCH(patch({ level: "hero", version: version + 5 }), params(recordId))).status).toBe(409);

    const stored = await client.query(`select level from spec_records where id = $1`, [recordId]);
    expect(stored.rows[0].level).toBeNull();
  });

  it("reports a level-less record as unable to say what blocks its quote", async () => {
    const recordId = await makeRecord(mainRunId, "__QAX183", "__QA No level", true);
    const { GET } = await import("@/app/api/records/route");
    const res = await GET(new Request(`http://localhost/test?projectId=${projectId}`));
    const body = await res.json();
    const row = body.records.find((r: { id: string }) => r.id === recordId);

    // null, not 0: "nothing is blocking the quote" and "nobody has said what
    // kind of item this is" are different answers.
    expect(row.to_quote_outstanding).toBeNull();

    const { PATCH } = await import("@/app/api/records/[id]/route");
    const version = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version;
    await PATCH(patch({ level: "simple", version }), params(recordId));

    const after = await (await GET(new Request(`http://localhost/test?projectId=${projectId}`))).json();
    const updated = after.records.find((r: { id: string }) => r.id === recordId);
    expect(typeof updated.to_quote_outstanding).toBe("number");
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

  // ==========================================================================
  // A CODE DRAWN TWICE IS TWO CONFIGURATIONS. Needs 0024.
  //
  // The AP364 set draws S-201 on pages 5 and 6: identical geometry, different
  // fabric, ONE bill line. Both cards used to resolve to that one record, so
  // confirming the second offered to RETIRE the first's fabric — the app
  // insisting one of two true statements had to be wrong.
  // ==========================================================================
  it("confirms two pages of one code onto configurations A and B", async () => {
    const parentId = await makeRecord(mainRunId, "__QA S-201", "__QA Armchair", true);
    await makeAnswers(parentId);

    const staged = stageDrawings(
      [
        {
          ...drawingItem("__QA S-201"),
          page: 5,
          materials: [{ labelRaw: "FABRIC", valueRaw: "__QA Kolda", materialCodeRaw: "__QA UPH-07" }],
        },
        {
          ...drawingItem("__QA S-201"),
          page: 6,
          materials: [{ labelRaw: "FABRIC", valueRaw: "__QA Goree", materialCodeRaw: "__QA UPH-07" }],
        },
      ],
      fields,
      "__QA two pages.pdf",
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    const drawingsRunId = run.rows[0].id as string;

    // Confirm page 5, then page 6. The letters come from page order, derived
    // server-side — the request never names one.
    for (const item of staged.items) {
      const runRow = await client.query(`select version from intake_runs where id = $1`, [drawingsRunId]);
      const res = await confirmRoute(drawingsRunId, {
        version: Number(runRow.rows[0].version),
        action: "confirm",
        itemId: item.id,
        itemVersion: item.version,
        observations: item.observations.map((observation) => ({ id: observation.id, version: observation.version })),
      });
      expect(res.status).toBe(200);
    }

    const variants = await client.query(
      `select id, variant_label, split_reason, depth, qty, item_description
         from spec_records where parent_id = $1 and status = 'active' order by variant_label`,
      [parentId],
    );
    expect(variants.rows.map((row) => row.variant_label)).toEqual(["A", "B"]);
    expect(variants.rows.map((row) => row.split_reason)).toEqual(["fabric", "fabric"]);
    // The bill says 4 off and never says how many are fabric A.
    expect(variants.rows.map((row) => row.qty)).toEqual([null, null]);

    // Each fabric on its own configuration, and NEITHER on the bill line.
    const fabricOf = async (recordId: string) => {
      const rows = await client.query(
        `select value from record_attributes where record_id = $1 and label = 'FABRIC' and status = 'active'`,
        [recordId],
      );
      return rows.rows.map((row) => row.value);
    };
    expect(await fabricOf(variants.rows[0].id)).toEqual(["__QA Kolda"]);
    expect(await fabricOf(variants.rows[1].id)).toEqual(["__QA Goree"]);
    expect(await fabricOf(parentId)).toEqual([]);

    // Nothing was retired: the second fabric is not a correction of the first.
    const retired = await client.query(
      `select count(*)::int as n from record_attributes
        where record_id = any($1::uuid[]) and status = 'retired'`,
      [[parentId, variants.rows[0].id, variants.rows[1].id]],
    );
    expect(retired.rows[0].n).toBe(0);

    // The variants are the jobs; the bill line is a heading.
    const scope = await loadExportScope(projectId, mainRunId);
    if (isScopeFailure(scope)) throw new Error(scope.error);
    const shipped = scope.scope.records.map((record) => record.id);
    expect(shipped).toContain(variants.rows[0].id);
    expect(shipped).toContain(variants.rows[1].id);
    expect(shipped).not.toContain(parentId);

    // A variant has no boq_code of its own, so Client Code reads the parent's.
    const exported = scope.scope.records.find((record) => record.id === variants.rows[0].id);
    expect(exported?.boqCodes).toEqual(["__QA S-201"]);
    expect(exported?.variantLabel).toBe("A");

    // Idempotent: confirming the same card again makes no third variant.
    const again = await client.query(
      `select count(*)::int as n from spec_records where parent_id = $1`,
      [parentId],
    );
    expect(again.rows[0].n).toBe(2);
    // TWO full confirms through the real route, against a remote database. The
    // 5s default is for tests that do one.
  }, 40_000);

  it("refuses to split a record that already carries confirmed specs", async () => {
    // Those specs would stay on a record the export has stopped shipping, so a
    // confirmed fabric would vanish from the file.
    const parentId = await makeRecord(mainRunId, "__QA S-900", "__QA Armchair", true);
    await makeAnswers(parentId);
    const first = await stageDrawingRun("__QA S-900", { ...drawingItem("__QA S-900"), page: 1 });
    const res = await confirmRoute(first.runId, {
      version: first.version,
      action: "confirm",
      itemId: first.staged.items[0]!.id,
      itemVersion: first.staged.items[0]!.version,
      observations: first.staged.items[0]!.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(res.status).toBe(200);

    // Now the same code arrives on two pages, which would split it.
    const staged = stageDrawings(
      [
        { ...drawingItem("__QA S-900"), page: 2 },
        { ...drawingItem("__QA S-900"), page: 3 },
      ],
      fields,
      "__QA split later.pdf",
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    const blocked = await confirmRoute(run.rows[0].id, {
      version: Number(run.rows[0].version),
      action: "confirm",
      itemId: staged.items[0]!.id,
      itemVersion: staged.items[0]!.version,
      observations: staged.items[0]!.observations.map((o) => ({ id: o.id, version: o.version })),
    });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect((await blocked.json()).error).toMatch(/already carries/i);
    const none = await client.query(`select count(*)::int as n from spec_records where parent_id = $1`, [parentId]);
    expect(none.rows[0].n).toBe(0);
  }, 40_000);

});
