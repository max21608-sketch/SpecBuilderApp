// Database tier — the drawings review points at a figure (brief F, 2026-10-04).
//
// Skips silently without DATABASE_URL. On the local stack:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/review-point-at-figure.test.ts
//
// ============================================================================
// WHAT ONLY THE DATABASE CAN SHOW
//
//   * "Use as D" is ONE locked write through the real PATCH route: the figure
//     takes the slot and the row that held it returns to a note, both
//     versions bumped — and a stale version, or a holder the card never saw,
//     writes NOTHING (409).
//   * A configuration's slot displaces only within its scope: Type 2's width
//     leaves Type 1's alone, and a shared width is narrowed, not demoted.
//   * A doubt the read raised about an overall slot is refused by the CONFIRM
//     route too, until a person presses Checked or touches the slot.
//   * The read's proposed swatch on a finish that conflicts with the library is
//     left out of the confirm; the same crop sent as a person's is refused.
//
// Synthetic throughout. No document is registered, no model is called,
// nothing is charged.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import type { DrawingItem, SpecFieldEntry, StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { GET as importGet, PATCH as importPatch } from "@/app/api/imports/[id]/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const noOverall = { width: null, depth: null, height: null, seatHeight: null, diameter: null };
const fig = (valueRaw: string, view: string, candidates: string[] = []) => ({
  valueRaw,
  unitRaw: "mm",
  view,
  page: 1,
  evidence: `${view}, spanning the whole item`,
  candidates,
});
const rawItem = (overrides: Record<string, unknown>) => ({
  codes: [],
  name: "Bench",
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

describeIfDb("the drawings review points at a figure", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let projectId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Point at a figure', 'qa', 'qa') returning id`,
        [qaNumber("P90745")],
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

  async function billLine(code: string): Promise<string> {
    const run = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, $2, (select count(*) from spec_runs where project_id = $1), 'qa', 'qa') returning id`,
        [projectId, `__QA ${code}`],
      )
    ).rows[0].id;
    const bill = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Bench', 4, 'qa', 'qa') returning id`,
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

  async function stage(items: unknown[], filename: string): Promise<string> {
    const doc = stageDrawingsV4(DrawingsItemsOutput.parse({ documentNotes: null, nonItemPages: [], items }), fields, filename, null);
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

  const live = async (runId: string) => {
    const row = (await client.query(`select parsed, version from intake_runs where id = $1`, [runId])).rows[0];
    return { doc: row.parsed as StagedDrawings, version: Number(row.version), item: (row.parsed as StagedDrawings).items[0]! };
  };

  async function patch(runId: string, body: unknown) {
    const response = await importPatch(
      new Request("http://localhost/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function confirm(runId: string, extra: Record<string, unknown> = {}) {
    const { item } = await live(runId);
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: item.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
          ...extra,
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const bySlot = (item: DrawingItem, slot: string) =>
    item.observations.filter((o) => o.attrGroup === "dimension" && o.dimensionSlot === slot);

  it("swaps SECTION B into the depth and returns the old depth to a note, in one write", async () => {
    const code = `__QA X-10-${Date.now()}`;
    await billLine(code);
    const runId = await stage(
      [
        rawItem({
          codes: [code],
          overall: {
            ...noOverall,
            width: fig("2100", "ELEVATION 1"),
            depth: fig("640", "PLAN", ["880 (SECTION B, page 1)"]),
            height: fig("760", "SECTION A"),
          },
        }),
      ],
      "__QA x-10.pdf",
    );
    const before = await live(runId);
    const depth = bySlot(before.item, "D")[0]!;
    const section = before.item.observations.find((o) => o.id === depth.candidates![0]!.observationId)!;
    expect(section).toMatchObject({ attrGroup: "note", value: "880", view: "SECTION B" });

    const swapped = await patch(runId, {
      itemId: before.item.id,
      observationId: section.id,
      expectedVersion: section.version,
      changes: { swapSlot: { slot: "D", displaces: [{ id: depth.id, version: depth.version }] } },
    });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);

    const after = await live(runId);
    expect(after.version).toBe(before.version + 1);
    const nowDepth = bySlot(after.item, "D");
    expect(nowDepth.map((o) => [o.id, o.value, o.slotSuggested, o.isOverall, o.version])).toEqual([[section.id, "880", false, true, 2]]);
    expect(after.item.observations.find((o) => o.id === depth.id)).toMatchObject({
      attrGroup: "note",
      dimensionSlot: null,
      isOverall: false,
      value: "640",
      version: 2,
    });
    expect(after.item.slotsTouched).toEqual(["D"]);

    // And the confirm writes the depth the reviewer pointed at.
    const bill = (await client.query(`select record_id from spec_record_refs where ref_value = $1`, [code])).rows[0].record_id;
    const confirmed = await confirm(runId);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const written = (
      await client.query(
        `select value from record_attributes where record_id = $1 and status = 'active' and dimension_slot = 'D'`,
        [bill],
      )
    ).rows;
    expect(written).toEqual([{ value: "880" }]);
  });

  it("refuses a swap over a holder the card saw at another version, or never saw, and writes nothing", async () => {
    const code = `__QA X-11-${Date.now()}`;
    await billLine(code);
    const runId = await stage(
      [rawItem({ codes: [code], overall: { ...noOverall, width: fig("2100", "ELEVATION 1") }, otherDimensions: [{ label: "SECTION B", valueRaw: "1990", unitRaw: "mm", view: "SECTION B", page: 1 }] })],
      "__QA x-11.pdf",
    );
    const before = await live(runId);
    const width = bySlot(before.item, "W")[0]!;
    const section = before.item.observations.find((o) => o.labelRaw === "SECTION B")!;

    const stale = await patch(runId, {
      itemId: before.item.id,
      observationId: section.id,
      expectedVersion: section.version,
      changes: { swapSlot: { slot: "W", displaces: [{ id: width.id, version: width.version + 5 }] } },
    });
    expect(stale.status).toBe(409);
    const unseen = await patch(runId, {
      itemId: before.item.id,
      observationId: section.id,
      expectedVersion: section.version,
      changes: { swapSlot: { slot: "W", displaces: [] } },
    });
    expect(unseen.status).toBe(409);
    expect(String(unseen.body.error)).toMatch(/Another row now holds the width/);
    const moverStale = await patch(runId, {
      itemId: before.item.id,
      observationId: section.id,
      expectedVersion: section.version + 1,
      changes: { swapSlot: { slot: "W", displaces: [{ id: width.id, version: width.version }] } },
    });
    expect(moverStale.status).toBe(409);
    const alone = await patch(runId, {
      itemId: before.item.id,
      observationId: section.id,
      expectedVersion: section.version,
      changes: { swapSlot: { slot: "W", displaces: [{ id: width.id, version: width.version }] }, unit: "cm" },
    });
    expect(alone.status).toBe(400);

    const after = await live(runId);
    expect(after.version).toBe(before.version);
    expect(after.doc).toEqual(before.doc);
  });

  it("displaces only within a configuration's scope: a shared width is narrowed, another's left alone", async () => {
    const code = `__QA X-12-${Date.now()}`;
    await billLine(code);
    const runId = await stage(
      [
        rawItem({
          codes: [code],
          name: "Desk chair",
          configurations: [
            { name: "Type 1", nameRaw: "Type 1", differsIn: "fabric", overall: noOverall, pages: [1] },
            { name: "Type 2", nameRaw: "Type 2", differsIn: "fabric and height", overall: { ...noOverall, height: fig("800", "TABLE") }, pages: [1] },
          ],
          overall: { ...noOverall, width: fig("550", "TABLE"), height: fig("735", "TABLE") },
          otherDimensions: [
            { label: "SECTION C", valueRaw: "580", unitRaw: "mm", view: "SECTION C", page: 1 },
            { label: "SECTION D", valueRaw: "760", unitRaw: "mm", view: "SECTION D", page: 1 },
          ],
        }),
      ],
      "__QA x-12.pdf",
    );
    let state = await live(runId);
    const sharedWidth = bySlot(state.item, "W")[0]!;
    expect(sharedWidth.configurations ?? []).toEqual([]);
    const ownHeights = bySlot(state.item, "H");
    const type1Height = ownHeights.find((o) => o.value === "735")!;
    const type2Height = ownHeights.find((o) => o.value === "800")!;

    // SECTION C is Type 2's width, by the reviewer's say-so.
    const sectionC = state.item.observations.find((o) => o.labelRaw === "SECTION C")!;
    expect((await patch(runId, { itemId: state.item.id, observationId: sectionC.id, expectedVersion: sectionC.version, changes: { configurations: ["Type 2"] } })).status).toBe(200);
    state = await live(runId);
    const movedC = state.item.observations.find((o) => o.id === sectionC.id)!;
    const swapC = await patch(runId, {
      itemId: state.item.id,
      observationId: movedC.id,
      expectedVersion: movedC.version,
      changes: { swapSlot: { slot: "W", displaces: [{ id: sharedWidth.id, version: sharedWidth.version }] } },
    });
    expect(swapC.status, JSON.stringify(swapC.body)).toBe(200);
    state = await live(runId);
    // The shared width stays a width, now Type 1's alone.
    expect(state.item.observations.find((o) => o.id === sharedWidth.id)).toMatchObject({
      attrGroup: "dimension",
      dimensionSlot: "W",
      configurationsByReviewer: ["TYPE 1"],
      version: sharedWidth.version + 1,
    });
    expect(state.item.observations.find((o) => o.id === sectionC.id)).toMatchObject({ dimensionSlot: "W" });

    // SECTION D as Type 2's height displaces Type 2's own height and leaves Type 1's.
    const sectionD = state.item.observations.find((o) => o.labelRaw === "SECTION D")!;
    expect((await patch(runId, { itemId: state.item.id, observationId: sectionD.id, expectedVersion: sectionD.version, changes: { configurations: ["Type 2"] } })).status).toBe(200);
    state = await live(runId);
    const movedD = state.item.observations.find((o) => o.id === sectionD.id)!;
    const heightsNow = bySlot(state.item, "H");
    const swapD = await patch(runId, {
      itemId: state.item.id,
      observationId: movedD.id,
      expectedVersion: movedD.version,
      changes: { swapSlot: { slot: "H", displaces: heightsNow.map((o) => ({ id: o.id, version: o.version })) } },
    });
    expect(swapD.status, JSON.stringify(swapD.body)).toBe(200);
    state = await live(runId);
    expect(state.item.observations.find((o) => o.id === type1Height.id)).toMatchObject({ dimensionSlot: "H", version: type1Height.version });
    expect(state.item.observations.find((o) => o.id === type2Height.id)).toMatchObject({ attrGroup: "note", dimensionSlot: null });
    expect(state.item.observations.find((o) => o.id === sectionD.id)).toMatchObject({ dimensionSlot: "H" });
  });

  it("refuses the confirm over a doubt about a size until a person checks it", async () => {
    const code = `__QA X-13-${Date.now()}`;
    await billLine(code);
    const runId = await stage(
      [
        rawItem({
          codes: [code],
          overall: { ...noOverall, width: fig("760", "PLAN", ["740 (ELEVATION 2, page 1)"]), height: fig("450", "ELEVATION 1") },
          uncertain: ["width: the plan prints 760 and ELEVATION 2 prints 740", "grouping: page 2 may be another bench"],
        }),
      ],
      "__QA x-13.pdf",
    );
    const refused = await confirm(runId);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/uncertain_unchecked/);
    expect(String(refused.body.error)).toMatch(/unsure of the width/);

    // The screen says so too — the same blockers, through the GET.
    const got = (await (await importGet(new Request("http://localhost/test"), { params: Promise.resolve({ id: runId }) })).json()) as {
      resolution: { blockers: { code: string }[] }[];
    };
    expect(got.resolution[0]!.blockers.map((blocker) => blocker.code)).toEqual(["uncertain_unchecked"]);

    const { item } = await live(runId);
    const checked = await patch(runId, { itemId: item.id, expectedVersion: item.version, changes: { uncertainChecked: [0, 7] } });
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    // An index the item has no notice for is dropped.
    expect((await live(runId)).item.uncertainChecked).toEqual([0]);
    const accepted = await confirm(runId);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  });

  it("lets a person settle the doubt by touching the slot instead", async () => {
    const code = `__QA X-14-${Date.now()}`;
    await billLine(code);
    const runId = await stage(
      [rawItem({ codes: [code], overall: { ...noOverall, width: fig("760", "PLAN") }, uncertain: ["width: hard to read"] })],
      "__QA x-14.pdf",
    );
    const { item } = await live(runId);
    const width = bySlot(item, "W")[0]!;
    expect((await patch(runId, { itemId: item.id, observationId: width.id, expectedVersion: width.version, changes: { value: "765" } })).status).toBe(200);
    expect((await live(runId)).item.slotsTouched).toEqual(["W"]);
    const accepted = await confirm(runId);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  });

  it("leaves the read's proposed swatch out where its finish conflicts, and refuses the same crop as a person's", async () => {
    const code = `__QA X-15-${Date.now()}`;
    await billLine(code);
    const finishCode = `QA-UPH-${Date.now()}`;
    await client.query(
      `insert into project_finishes (project_id, code, code_norm, code_origin, kind, description, state, created_by, updated_by)
       values ($1, $2, $2, 'client', 'fabric', 'Invented red linen', 'confirmed', 'qa', 'qa')`,
      [projectId, finishCode],
    );
    const stageOne = () =>
      stage(
        [
          rawItem({
            codes: [code],
            finishes: [
              { part: "SEAT", spec: "Invented blue velvet", code: finishCode, configurations: [], page: 1, swatch: { page: 1, box: [0.6, 0.1, 0.7, 0.2] } },
            ],
          }),
        ],
        "__QA x-15.pdf",
      );

    // The screen is told why, before anybody confirms.
    const proposedRun = await stageOne();
    const got = (await (await importGet(new Request("http://localhost/test"), { params: Promise.resolve({ id: proposedRun }) })).json()) as {
      resolution: { swatchRefusals: Record<string, string> }[];
    };
    const seat = (await live(proposedRun)).item.observations.find((o) => o.labelRaw === "SEAT")!;
    expect(seat.swatchProposal).toBeTruthy();
    expect(got.resolution[0]!.swatchRefusals[seat.id]).toMatch(/^Not used: the finishes library describes/);

    const swatch = (origin: "proposed" | "person") => ({
      swatches: [
        {
          observationId: seat.id,
          pathname: `projects/${projectId}/finish-swatches/${seat.id}.png`,
          page: 1,
          filename: "x.png",
          width: 10,
          height: 10,
          size: 10,
          origin,
        },
      ],
    });
    const left = await confirm(proposedRun, swatch("proposed"));
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect(left.body.swatchesLeftOut).toBe(1);
    expect(
      (await client.query(`select count(*)::int as n from attachments where kind = 'finish_swatch' and storage_path like $1`, [`%${seat.id}%`])).rows[0].n,
    ).toBe(0);

    const personRun = await stageOne();
    const personSeat = (await live(personRun)).item.observations.find((o) => o.labelRaw === "SEAT")!;
    const refused = await confirm(personRun, {
      swatches: [{ ...swatch("person").swatches[0]!, observationId: personSeat.id }],
    });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toMatch(/nothing to attach it to/);
  });
});
