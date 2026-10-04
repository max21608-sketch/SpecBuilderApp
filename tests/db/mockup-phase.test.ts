// Database tier — "Also in a mock-up phase" (0043, brief E).
//
// Skips without DATABASE_URL. Run with the database tier on the local stack:
//   npm run checks:local
//
// ============================================================================
// Max, 2026-10-04: assign items to a mock-up phase "without taking them away
// from the main run". What only the database can show:
//
//   THE ACTION   makes the phase ONCE, copies the bill line's identity and
//                its refs (never a BWS job number), leaves the quantity null,
//                copies no specs, creates the checklist, opens ONE change set
//                and gives every new record its version 1 -- and pressing it
//                again adds nothing.
//   THE SOURCE   is untouched: same phase, same quantity, same version.
//   A MOCK-UP DRAWING confirmed writes to the mock-up record only, never to
//                the bill line it shares a code with; one whose code has no
//                mock-up record is refused, saying so.
//   UNDO         is the retire verb, with a reason; and a retired copy is not
//                silently replaced by pressing again.
//
// Synthetic throughout. No document is registered, no model is called.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
import type { RawDrawingItem } from "@/lib/extraction-schema";
import { POST as mockupRoute } from "@/app/api/projects/[id]/mockup/route";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { PATCH as statusRoute } from "@/app/api/records/[id]/configuration-status/route";
import { MOCKUP_NO_SPECS_SENTENCE } from "@/lib/mockup-phase";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

describeIfDb("the mock-up phase", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let projectId = "";
  let categoryId = "";
  let questions = 0;
  let fields: SpecFieldEntry[] = [];
  let gr = "";
  let pl = "";
  let other = "";
  let configuration = "";
  const GR_CODE = "QZ-GR-08";
  const PL_CODE = "QZ-PL-08";
  const OTHER_CODE = "QZ-GR-11";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Mock-up phase', 'qa', 'qa') returning id`,
        [qaNumber("P90043")],
      )
    ).rows[0].id;
    const category = (
      await client.query(
        `select category_id, count(*)::int as n from requirements group by category_id order by n desc limit 1`,
      )
    ).rows[0];
    categoryId = String(category.category_id);
    questions = Number(category.n);
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({ id: row.id, jsonId: Number(row.json_id), name: row.name }),
    );

    const run = async (name: string, order: number) =>
      String(
        (
          await client.query(
            `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
             values ($1, $2, $3, 'qa', 'qa') returning id`,
            [projectId, name, order],
          )
        ).rows[0].id,
      );
    const guestSuites = await run("__QA Guest Suites", 1);
    const suites = await run("__QA Presidential Suites", 2);

    const line = async (
      runId: string,
      code: string,
      qty: number,
      level: { level?: string; suggested?: string },
      extraRefs: [string, string][] = [],
    ) => {
      const id = String(
        (
          await client.query(
            `insert into spec_records
               (project_id, run_id, record_no, status, category_id, item_description, qty, area,
                level, level_suggested, level_suggested_reason, source_line_no, dimension_note, created_by, updated_by)
             values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                     'active', $3, '__QA Dresser stool', $4, 'Dressing area', $5, $6, $7, 12, 'with a handle', 'qa', 'qa')
             returning id`,
            [projectId, runId, categoryId, qty, level.level ?? null, level.suggested ?? null, level.suggested ? "read off the bill" : null],
          )
        ).rows[0].id,
      );
      for (const [system, value] of [["boq_code", code] as [string, string], ...extraRefs]) {
        await client.query(
          `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
           values ($1, $2, $3, $4, upper(regexp_replace($4, '[^A-Za-z0-9]', '', 'g')), 'BOQ', 'qa')`,
          [id, projectId, system, value],
        );
      }
      return id;
    };
    gr = await line(guestSuites, GR_CODE, 6, { level: "simple" }, [
      ["design_code", "DS-08"],
      ["bws_job", "J99001"],
    ]);
    pl = await line(suites, PL_CODE, 2, { suggested: "complex" });
    other = await line(guestSuites, OTHER_CODE, 4, { level: "simple" });
    configuration = String(
      (
        await client.query(
          `insert into spec_records
             (project_id, run_id, record_no, status, item_description, parent_id, depth, split_reason, variant_label,
              created_by, updated_by)
           values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                   'active', '__QA Dresser stool', $3, 1, 'configuration', 'A', 'qa', 'qa')
           returning id`,
          [projectId, guestSuites, other],
        )
      ).rows[0].id,
    );
  });

  afterAll(async () => {
    const records = `select id from spec_records where project_id = $1`;
    await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function press(recordIds: string[]) {
    const response = await mockupRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordIds }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> & { message: string } };
  }

  const mockupPhases = async () =>
    (await client.query(`select id, name, status from spec_runs where project_id = $1 and is_mockup`, [projectId])).rows;

  const copyOf = async (sourceId: string) =>
    (
      await client.query(
        `select r.*, run.is_mockup from spec_records r join spec_runs run on run.id = r.run_id
          where r.mockup_of = $1 order by r.created_at`,
        [sourceId],
      )
    ).rows;

  it("makes the phase once, copies the identity and the refs, and nothing else", async () => {
    const before = (await client.query(`select id, run_id, qty, version from spec_records where id = any($1::uuid[])`, [[gr, pl]])).rows;

    const { response, body } = await press([gr, pl, configuration]);
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body.message).toBe(
      `Added 2 items to Mock-up; 1 configuration left out — add its bill line instead. The Mock-up phase was created. ${MOCKUP_NO_SPECS_SENTENCE}`,
    );

    const phases = await mockupPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0].name).toBe("Mock-up");

    const [grCopy] = await copyOf(gr);
    const [plCopy] = await copyOf(pl);
    expect(grCopy.run_id).toBe(phases[0].id);
    expect(grCopy.is_mockup).toBe(true);
    expect(grCopy.item_description).toBe("__QA Dresser stool");
    expect(grCopy.category_id).toBe(categoryId);
    expect(grCopy.area).toBe("Dressing area");
    // A decision comes as a decision, a suggestion as a suggestion.
    expect([grCopy.level, grCopy.level_suggested]).toEqual(["simple", null]);
    expect([plCopy.level, plCopy.level_suggested, plCopy.level_suggested_reason]).toEqual([null, "complex", "read off the bill"]);
    // NEVER the quantity, the bill row, or a person's note about the main item.
    expect(grCopy.qty).toBeNull();
    expect(grCopy.source_line_no).toBeNull();
    expect(grCopy.dimension_note).toBeNull();
    expect(grCopy.parent_id).toBeNull();

    // Every ref but the BWS job number.
    const refs = (
      await client.query(`select ref_system, ref_value from spec_record_refs where record_id = $1 order by ref_system`, [grCopy.id])
    ).rows;
    expect(refs).toEqual([
      { ref_system: "boq_code", ref_value: GR_CODE },
      { ref_system: "design_code", ref_value: "DS-08" },
    ]);

    // The checklist, all missing; no specs.
    const answers = (
      await client.query(`select state, count(*)::int as n from spec_answers where record_id = $1 group by state`, [grCopy.id])
    ).rows;
    expect(answers).toEqual([{ state: "missing", n: questions }]);
    const specs = (await client.query(`select count(*)::int as n from record_attributes where record_id = $1`, [grCopy.id])).rows[0].n;
    expect(specs).toBe(0);

    // ONE change set, and a version 1 of each new record under it.
    const changes = (await client.query(`select id, kind from change_sets where project_id = $1`, [projectId])).rows;
    expect(changes.map((row) => row.kind)).toEqual(["mockup_add"]);
    const versions = (
      await client.query(
        `select record_id, snapshot_no, change_set_id from record_snapshots where record_id = any($1::uuid[]) order by record_id`,
        [[grCopy.id, plCopy.id]],
      )
    ).rows;
    expect(versions).toHaveLength(2);
    expect(versions.every((row) => row.snapshot_no === 1 && row.change_set_id === changes[0].id)).toBe(true);

    // The sources are untouched.
    const after = (await client.query(`select id, run_id, qty, version from spec_records where id = any($1::uuid[])`, [[gr, pl]])).rows;
    expect(after).toEqual(before);
  });

  it("adds nothing the second time, and writes no change", async () => {
    const { response, body } = await press([gr]);
    expect(response.status).toBe(200);
    expect(body.message).toBe("Nothing was added to Mock-up; 1 was already there.");
    expect(await mockupPhases()).toHaveLength(1);
    expect(await copyOf(gr)).toHaveLength(1);
    const changes = (await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n;
    expect(changes).toBe(1);
  });

  async function stageMockupDrawing(code: string): Promise<string> {
    const raw: RawDrawingItem = {
      itemCodeRaw: code,
      itemNameRaw: "Dresser stool",
      page: 1,
      dimensions: [
        { labelRaw: "Width", valueRaw: "450", unitRaw: "mm", slot: "width", slotEvidence: "labelled Width", isOverall: true, configurations: [] },
      ],
      materials: [],
      dimensionsCombinedRaw: [],
      notesRaw: [],
      confidence: "high",
      configurations: [],
      depictsConfigurations: [],
    } as unknown as RawDrawingItem;
    const doc: StagedDrawings = stageDrawings([raw], fields, "__QA AB-CD-MUR-QZ-08.pdf", null, null, []);
    // What brief D's read stages from the page itself.
    doc.items[0]!.mockup = { is: true, evidence: "MUR in the drawing number" };
    return String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
           values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
          [projectId, JSON.stringify(doc)],
        )
      ).rows[0].id,
    );
  }

  async function confirm(runId: string) {
    const doc = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;
    const item = doc.items[0]!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: item.observations
            .filter((o) => o.reviewStatus === "pending")
            .map((o) => ({ id: o.id, version: o.version })),
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  it("lands a mock-up drawing on the mock-up record only, never on the bill line sharing its code", async () => {
    const runId = await stageMockupDrawing(GR_CODE);
    const { response, body } = await confirm(runId);
    expect(response.ok, JSON.stringify(body)).toBe(true);

    const [grCopy] = await copyOf(gr);
    const written = (
      await client.query(
        `select r.id, a.dimension_slot, a.value from record_attributes a join spec_records r on r.id = a.record_id
          where r.project_id = $1 and a.status = 'active'`,
        [projectId],
      )
    ).rows;
    expect(written).toEqual([{ id: grCopy.id, dimension_slot: "W", value: "450" }]);
  });

  it("refuses a mock-up drawing whose code has no mock-up record, and says what to press", async () => {
    const runId = await stageMockupDrawing(OTHER_CODE);
    const { response, body } = await confirm(runId);
    expect(response.ok).toBe(false);
    expect(JSON.stringify(body)).toMatch(/no mock-up record carries QZ-GR-11 yet/);
    const onOther = (await client.query(`select count(*)::int as n from record_attributes where record_id = $1`, [other])).rows[0].n;
    expect(onOther).toBe(0);
  });

  it("is undone by the retire verb, with a reason, and a retired copy is not replaced by pressing again", async () => {
    const [grCopy] = await copyOf(gr);
    const patch = (body: Record<string, unknown>) =>
      statusRoute(
        new Request("http://localhost/test", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: grCopy.id }) },
      );

    const refused = await patch({ status: "retired", version: grCopy.version });
    expect(refused.status).toBe(400);

    const retired = await patch({ status: "retired", version: grCopy.version, reason: "not in the mock-up room after all" });
    expect(retired.status, JSON.stringify(await retired.clone().json())).toBe(200);

    const again = await press([gr]);
    expect(again.body.message).toBe(
      "Nothing was added to Mock-up; 1 was retired there — put it back on the record rather than adding again.",
    );
    expect(await copyOf(gr)).toHaveLength(1);

    const version = (await client.query(`select version from spec_records where id = $1`, [grCopy.id])).rows[0].version;
    const restored = await patch({ status: "active", version });
    expect(restored.status).toBe(200);
    expect((await copyOf(gr))[0].status).toBe("active");
  });
});
