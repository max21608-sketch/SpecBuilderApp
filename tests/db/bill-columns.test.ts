// Database tier — a bill's own Dims and Finish COLUMNS are read at confirm.
// Through the real review GET and the real confirm route, on the local stack.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-columns.test.ts
//
// ============================================================================
// WHAT IT PROVES.
//
// The Butler Arms bills (2026-10-06) print each item's size and finish in
// columns of their own beside a one-line description, and until 0047 both
// were lost at confirm. Now each cell is read by `bill-description.ts` — the
// reader a description's own size and finish lines go through — so the
// review shows the plan and the confirm writes exactly it: slots carrying the
// cell's or the HEADING's unit, the composed Dimensions answer, a finish of
// one kind in its field and one naming two kinds as a note. Every cell is
// SYNTHETIC: the shape is the bills', the figures and words invented.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

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

describeIfDb("a bill's own Dims and Finish columns, read at confirm", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill columns', 'qa', 'qa') returning id`,
        [qaNumber("P90072")],
      )
    ).rows[0].id;
    // A category whose checklist asks Dimensions (BWS field 3), so the
    // composed cell reaching the answer is part of what is proved.
    categoryId = (
      await client.query(
        `select c.id from item_categories c
         where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 3)
         order by c.sort_order limit 1`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  function line(index: number, lineNo: number, code: string, description: string, cells: Record<string, string | null>) {
    return {
      index,
      lineNo,
      designer: null,
      boqCategory: "__QA",
      area: "__QA Bedrooms",
      code,
      itemDescription: description,
      productReference: null,
      qty: 2,
      qtyUnit: null,
      categoryId,
      categoryStatus: "chosen",
      ignored: false,
      ...cells,
    };
  }

  function sheet(name: string, dimsHeading: string, lines: Record<string, unknown>[]) {
    return {
      sheetName: name,
      proposedRunName: name,
      headerRow: 1,
      headerRows: 1,
      skippedRows: 0,
      ignored: false,
      ignoredReason: null,
      replacesRunId: null,
      metadata: { revision: null, date: null, notes: [] },
      columns: {
        code: { index: 0, heading: "Code" },
        itemDescription: { index: 1, heading: "Description" },
        qty: { index: 2, heading: "Qty" },
        dimensions: { index: 3, heading: dimsHeading },
        finish: { index: 4, heading: "Finish" },
      },
      headings: ["Code", "Description", "Qty", dimsHeading, "Finish"],
      mappingSource: "synonym",
      layout: null,
      needsColumns: false,
      columnsNote: null,
      lines,
    };
  }

  const recordByCode = async (code: string) =>
    (
      await client.query(
        `select r.id, r.item_description from spec_records r
         join spec_record_refs f on f.record_id = r.id and f.ref_system = 'boq_code'
         where r.project_id = $1 and f.ref_value = $2 and r.status = 'active'`,
        [projectId, code],
      )
    ).rows[0] as { id: string; item_description: string };
  const attributesOf = async (recordId: string) =>
    (
      await client.query(
        `select a.attr_group, a.dimension_slot, a.label, a.value, a.unit, a.material_code, a.state, a.source_run_id,
                a.source_page, f.json_id
         from record_attributes a left join spec_fields f on f.id = a.spec_field_id
         where a.record_id = $1 and a.status = 'active' order by a.sort_order, a.created_at`,
        [recordId],
      )
    ).rows;
  const dimensionsAnswer = async (recordId: string) =>
    (
      await client.query(
        `select a.value, a.state from spec_answers a join spec_fields f on f.id = a.spec_field_id
         where a.record_id = $1 and f.json_id = 3`,
        [recordId],
      )
    ).rows[0] as { value: string | null; state: string } | undefined;

  it("writes the size into its slots and the finish into its field, as the review showed it", { timeout: 60_000 }, async () => {
    const runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
         values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [
          projectId,
          JSON.stringify({
            schemaVersion: 4,
            filename: "__QA bedrooms.xlsx",
            sourcePreserved: false,
            sheets: [
              // The heading says millimetres; the cells do not.
              sheet("__QA BEDROOMS", "Dims (mm)", [
                line(0, 2, "ZZ-BED-01", "BED - EXAMPLE KING", { dimensionsRaw: "W1900 x D2100 x H1200", finishRaw: "SMOKED OILED OAK / BRUSHED BRASS" }),
                line(1, 3, "ZZ-CHR-01", "LOUNGE CHAIR", { dimensionsRaw: "W610 x D620 x H840 x AH640 x SH440", finishRaw: "Natural oak" }),
                line(2, 4, "ZZ-SOF-01", "SOFA", { dimensionsRaw: "Which size?", finishRaw: "SUEDE / NUBUCK" }),
                line(3, 5, "ZZ-TBL-01", "SIDE TABLE", { dimensionsRaw: null, finishRaw: null }),
              ]),
              // No unit anywhere: placed, unconverted, and the answer is TBC.
              sheet("__QA PUBLIC AREAS", "DIMENSIONS", [
                line(0, 2, "ZZ-PUB-01", "ARMCHAIR", { dimensionsRaw: "W800 X D950 X H790 X SH430", finishRaw: "Ral colour" }),
              ]),
            ],
          }),
        ],
      )
    ).rows[0].id as string;

    // THE REVIEW FIRST: what the reviewer is shown is the plan the confirm writes.
    const { GET } = await import("@/app/api/imports/[id]/route");
    const read = await GET(new Request("http://localhost/test"), params(runId));
    expect(read.status).toBe(200);
    const shown = (await read.json()) as {
      descriptions: Record<string, Record<string, { name: string; dimensionCell: string; columnCells: unknown[] }>>;
      descriptionsRead: boolean;
    };
    expect(shown.descriptionsRead).toBe(true);
    // The side table carries neither cell, so it has no plan.
    expect(Object.keys(shown.descriptions["0"] ?? {})).toEqual(["0", "1", "2"]);
    expect(shown.descriptions["0"]?.["0"]).toMatchObject({ name: "BED - EXAMPLE KING", dimensionCell: "W1900 x D2100 x H1200mm" });
    expect(shown.descriptions["0"]?.["0"]?.columnCells).toHaveLength(2);
    expect(shown.descriptions["1"]?.["0"]?.dimensionCell).toBe(
      "[W 800 — no unit] [D 950 — no unit] [H 790 — no unit] [SH 430 — no unit]",
    );

    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(post({}), params(runId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 5 });

    // ---- the bed: the heading's unit, and a finish naming two kinds kept whole
    const bed = await recordByCode("ZZ-BED-01");
    expect(bed.item_description).toBe("BED - EXAMPLE KING");
    const onBed = await attributesOf(bed.id);
    expect(onBed.every((row) => row.source_page === null && row.source_run_id === runId)).toBe(true);
    expect(onBed.filter((row) => row.attr_group === "dimension").map((row) => `${row.dimension_slot} ${row.value}${row.unit}`)).toEqual([
      "W 1900mm",
      "D 2100mm",
      "H 1200mm",
    ]);
    expect(onBed.filter((row) => row.attr_group === "note").map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Finish: SMOKED OILED OAK / BRUSHED BRASS",
    ]);
    expect(onBed.some((row) => row.json_id !== null)).toBe(false);
    expect(await dimensionsAnswer(bed.id)).toMatchObject({ value: "W1900 x D2100 x H1200mm", state: "confirmed" });

    // ---- the chair: four slots, the arm height a note, the oak its timber field
    const chair = await recordByCode("ZZ-CHR-01");
    const onChair = await attributesOf(chair.id);
    expect(onChair.filter((row) => row.attr_group === "dimension").map((row) => `${row.dimension_slot} ${row.value}`)).toEqual([
      "W 610",
      "D 620",
      "H 840",
      "SH 440",
    ]);
    expect(onChair.find((row) => row.attr_group === "note")).toMatchObject({ label: "Dims (mm)", value: "W610 x D620 x H840 x AH640 x SH440" });
    expect(onChair.find((row) => row.json_id === 4)).toMatchObject({ attr_group: "finish", label: "Finish", value: "Natural oak", material_code: null });
    expect(await dimensionsAnswer(chair.id)).toMatchObject({ value: "W610 x D620 x H840 x SH440mm", state: "confirmed" });

    // ---- the sofa: a question is a note, never a size; the leather its COM 1
    const sofa = await recordByCode("ZZ-SOF-01");
    const onSofa = await attributesOf(sofa.id);
    expect(onSofa.filter((row) => row.attr_group === "dimension")).toEqual([]);
    expect(onSofa.find((row) => row.attr_group === "note")).toMatchObject({ label: "Dims (mm)", value: "Which size?" });
    expect(onSofa.find((row) => row.json_id === 1)).toMatchObject({ attr_group: "material", value: "SUEDE / NUBUCK" });

    // ---- a line with neither cell states nothing
    expect(await attributesOf((await recordByCode("ZZ-TBL-01")).id)).toEqual([]);

    // ---- no unit anywhere: slots with no unit, the cell bracketed, the answer TBC
    const armchair = await recordByCode("ZZ-PUB-01");
    const onArmchair = await attributesOf(armchair.id);
    expect(
      onArmchair.filter((row) => row.attr_group === "dimension").map((row) => `${row.dimension_slot} ${row.value} ${row.unit}`),
    ).toEqual(["W 800 null", "D 950 null", "H 790 null", "SH 430 null"]);
    expect(onArmchair.find((row) => row.attr_group === "note")).toMatchObject({ label: "Finish", value: "Ral colour" });
    expect(await dimensionsAnswer(armchair.id)).toMatchObject({
      value: "[W 800 — no unit] [D 950 — no unit] [H 790 — no unit] [SH 430 — no unit]",
      state: "tbc",
    });
  });

  it("takes a reviewer's slot change on a part of a Dims column, as it does on a description's size line", async () => {
    const runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
         values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [
          projectId,
          JSON.stringify({
            schemaVersion: 4,
            filename: "__QA stools.xlsx",
            sourcePreserved: false,
            sheets: [sheet("__QA STOOLS", "Dims", [line(0, 2, "ZZ-STL-01", "STOOL", { dimensionsRaw: "D 400 x H 420 mm", finishRaw: null })])],
          }),
        ],
      )
    ).rows[0].id as string;
    const { GET, PATCH } = await import("@/app/api/imports/[id]/route");
    const review = async () =>
      ((await (await GET(new Request("http://localhost/test"), params(runId))).json()) as {
        descriptions: Record<string, Record<string, { dimensionCell: string; depthWithoutWidth: string | null }>>;
      }).descriptions["0"]?.["0"];

    expect(await review()).toMatchObject({ dimensionCell: "D400 x H420mm", depthWithoutWidth: "D 400" });
    const set = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetIndex: 0, index: 0, slotOverride: { key: "D 400", slot: "DIA" }, slotOverridesVersion: 0 }),
      }),
      params(runId),
    );
    expect(set.status).toBe(200);
    expect(await review()).toMatchObject({ dimensionCell: "Dia.400 x H420mm", depthWithoutWidth: null });
  });
});
