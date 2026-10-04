// Database tier — confirming an item the drawings read returned WHOLE
// (schemaVersion 4, 2026-10-04).
//
// Skips silently without DATABASE_URL. On the local stack:
//   node ~/dev/localstack/one-db-test.mjs tests/db/drawing-items-confirm.test.ts
//
// ============================================================================
// WHAT THIS PROVES, AND WHY IT IS A DATABASE TEST.
//
// The staging is pure and pinned in `tests/lib/drawing-items.test.ts`. What only
// the confirm can show is where the rows LAND:
//
//   * an item spanning two pages commits in ONE request, as one card, to every
//     phase that quotes it, and each attribute keeps the page IT was printed on
//     (`source_page` from the row, never the item's first page);
//   * a specification sheet's labelled statements land as note attributes,
//     requirement-free, label and value as printed;
//   * an item whose document names its configurations writes one record per
//     configuration through the SAME plan the v3 machinery uses — and a
//     configuration's own width lands on it alone.
//
// Synthetic throughout. No document is registered, no model is called,
// nothing is charged.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import type { SpecFieldEntry, StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const noOverall = { width: null, depth: null, height: null, seatHeight: null, diameter: null };
const fig = (valueRaw: string, page: number, view: string) => ({
  valueRaw,
  unitRaw: "mm",
  view,
  page,
  evidence: `${view}, spanning the whole item`,
  candidates: [],
});
const item = (overrides: Record<string, unknown>) => ({
  codes: [],
  name: "Armchair",
  pages: [1],
  whyOneItem: null,
  overall: noOverall,
  combinedLine: null,
  configurations: [],
  finishes: [],
  statements: [],
  mockup: { is: false, evidence: null },
  otherDimensions: [],
  notes: [],
  pictures: [],
  uncertain: [],
  confidence: "high",
  ...overrides,
});

describeIfDb("confirming an item the drawings read returned whole", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90744")}', '__QA Items read whole', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({ id: row.id, jsonId: Number(row.json_id), name: row.name }),
    );
  });

  afterAll(async () => {
    const records = `select id from spec_records where project_id = $1`;
    await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in (${records})`, [projectId]);
    await client.query(`update record_attributes set finish_id = null where record_id in (${records})`, [projectId]);
    await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // Deleting the project cascades the change sets, versions and finishes.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function phase(name: string, code: string): Promise<string> {
    const run = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, $2, (select count(*) from spec_runs where project_id = $1), 'qa', 'qa') returning id`,
        [projectId, name],
      )
    ).rows[0].id;
    const bill = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Armchair', 12, 'qa', 'qa') returning id`,
        [projectId, run],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [bill, projectId, code],
    );
    return bill;
  }

  async function stage(raw: unknown, filename: string): Promise<string> {
    const doc = stageDrawingsV4(DrawingsItemsOutput.parse(raw), fields, filename, null);
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

  async function confirmOnlyItem(runId: string) {
    const doc = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;
    expect(doc.schemaVersion).toBe(4);
    expect(doc.items).toHaveLength(1);
    const staged = doc.items[0]!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: staged.id,
          itemVersion: staged.version,
          observations: staged.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  const fieldId = (jsonId: number) => fields.find((field) => field.jsonId === jsonId)!.id;

  it("writes a two-page item in one request, each attribute on the page it was printed on", async () => {
    const code = `__QA X-200-${Date.now()}`;
    const main = await phase("__QA MAIN RUN", code);
    const mockup = await phase("__QA MOCK-UP", code);
    const runId = await stage(
      {
        documentNotes: null,
        nonItemPages: [{ page: 3, why: "general notes" }],
        items: [
          item({
            codes: [code, `${code} SHOP DRAWING`],
            pages: [1, 2],
            whyOneItem: "page 1 is the sheet, page 2 the shop drawing of the same chair",
            overall: {
              ...noOverall,
              width: fig("840", 1, "SPECIFICATION TABLE"),
              depth: fig("790", 2, "SIDE ELEVATION"),
              height: fig("720", 1, "SPECIFICATION TABLE"),
            },
            finishes: [{ part: "FEET", spec: "Invented dark oak", code: null, configurations: [], page: 2, swatch: null }],
            statements: [
              { label: "FILLING", value: "Invented feather wrap", page: 1, configurations: [] },
              { label: "LEAD TIME", value: "12 weeks", page: 1, configurations: [] },
            ],
            otherDimensions: [{ label: "ARM HEIGHT", valueRaw: "620", unitRaw: "mm", view: "SECTION", page: 2 }],
          }),
        ],
      },
      "__QA x-200.pdf",
    );

    const confirmed = await confirmOnlyItem(runId);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);

    for (const recordId of [main, mockup]) {
      const rows = (
        await client.query(
          `select attr_group, dimension_slot, label, value, unit, spec_field_id, source_page
             from record_attributes where record_id = $1 and status = 'active' order by sort_order`,
          [recordId],
        )
      ).rows;
      const bySlot = (slot: string) => rows.find((row) => row.dimension_slot === slot);
      expect([bySlot("W")?.source_page, bySlot("D")?.source_page, bySlot("H")?.source_page]).toEqual([1, 2, 1]);
      expect(bySlot("D")).toMatchObject({ value: "790", unit: "mm" });
      expect(rows.find((row) => row.label === "FEET")).toMatchObject({ source_page: 2, spec_field_id: fieldId(4) });
      // The statements: notes, requirement-free, label and value as printed.
      expect(rows.find((row) => row.label === "FILLING")).toMatchObject({
        attr_group: "note",
        value: "Invented feather wrap",
        spec_field_id: null,
        source_page: 1,
      });
      expect(rows.find((row) => row.label === "LEAD TIME")).toMatchObject({ attr_group: "note", value: "12 weeks" });
      expect(rows.find((row) => row.label === "ARM HEIGHT")).toMatchObject({ attr_group: "note", source_page: 2 });
    }

    // ONE change for the card, naming both of its pages.
    const reasons = (
      await client.query(`select reason from change_sets where project_id = $1 and kind = 'drawing_confirm'`, [projectId])
    ).rows.map((row) => String(row.reason));
    expect(reasons.filter((reason) => reason.includes("x-200"))).toEqual([expect.stringContaining("pages 1–2")]);

    // And the whole item is reviewed: nothing pending is left on the card.
    const after = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;
    expect(after.items[0]!.observations.every((o) => o.reviewStatus === "applied")).toBe(true);
  });

  it("writes one record per named configuration through the v3 plan, a configuration's own width on it alone", async () => {
    const code = `__QA X-301-${Date.now()}`;
    const bill = await phase("__QA DESK CHAIRS", code);
    const runId = await stage(
      {
        documentNotes: null,
        nonItemPages: [],
        items: [
          item({
            codes: [code],
            name: "Desk chair",
            pages: [1, 2],
            overall: { ...noOverall, width: fig("550", 1, "TABLE"), height: fig("735", 1, "TABLE") },
            configurations: [
              { name: "Type 1", nameRaw: "Type 1", differsIn: "fabric", pages: [1], overall: noOverall },
              { name: "Type 2", nameRaw: "Type 2", differsIn: "fabric and width", pages: [1], overall: { ...noOverall, width: fig("600", 2, "PLAN") } },
              { name: "Type 3", nameRaw: "Type 3", differsIn: "fabric", pages: [1], overall: noOverall },
            ],
            finishes: [
              { part: "FABRIC REFERENCE", spec: "Invented raffia", code: null, configurations: ["Type 1"], page: 1, swatch: null },
              { part: "FABRIC REFERENCE", spec: "Invented velvet", code: null, configurations: ["Type 2"], page: 1, swatch: null },
              { part: "FABRIC REFERENCE", spec: "Invented linen", code: null, configurations: ["Type 3"], page: 1, swatch: null },
            ],
          }),
        ],
      },
      "__QA x-301.pdf",
    );

    const confirmed = await confirmOnlyItem(runId);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);

    const variants = (
      await client.query(`select id, variant_label from spec_records where parent_id = $1 and status = 'active' order by variant_label`, [bill])
    ).rows;
    expect(variants.map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3"]);
    const held = async (variant: string) =>
      (
        await client.query(
          `select dimension_slot, value, spec_field_id, source_page from record_attributes
            where record_id = $1 and status = 'active' order by sort_order`,
          [variants.find((row) => row.variant_label === variant)!.id],
        )
      ).rows;
    for (const [label, width, widthPage, cloth] of [
      ["TYPE 1", "550", 1, "Invented raffia"],
      ["TYPE 2", "600", 2, "Invented velvet"],
      ["TYPE 3", "550", 1, "Invented linen"],
    ] as const) {
      const rows = await held(label);
      const widths = rows.filter((row) => row.dimension_slot === "W");
      expect(widths).toEqual([expect.objectContaining({ value: width, source_page: widthPage })]);
      expect(rows.filter((row) => row.dimension_slot === "H").map((row) => row.value)).toEqual(["735"]);
      expect(rows.filter((row) => row.spec_field_id === fieldId(1)).map((row) => row.value)).toEqual([cloth]);
    }
    // The bill line is a heading: nothing lands on it.
    expect((await client.query(`select count(*)::int as n from record_attributes where record_id = $1`, [bill])).rows[0].n).toBe(0);
  });
});
