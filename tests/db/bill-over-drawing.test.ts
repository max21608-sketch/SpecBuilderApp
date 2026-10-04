// Database tier — one press lets a drawing's values replace the bill's (brief G).
//
// Skips without DATABASE_URL. On the local stack, from a worktree:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-over-drawing.test.ts
//
// ============================================================================
// WHAT IT PROVES.
//
// A bill confirmed first has written a stool's depth, height and metal finish
// onto its record; a shop drawing of the same stool gives a DIAMETER, a height
// and a different metal. Through the real resolution, the real autosave PATCH
// and the real confirm route:
//
//   * the card's list names exactly the bill's three values — the bill's D as a
//     retirement the diameter needs — and never the seat height a PERSON typed;
//   * the press clears the dia conflict and the bill's slot clashes, and the
//     typed seat height still holds the card on its own per-row tick;
//   * the confirm writes the drawing's values and retires the bill's, each
//     pointing at the row that took its place, under ONE drawing_confirm change
//     set and one version, with the checklist's Dimensions answer recomposed
//     from the diameter;
//   * an occupant that moved after the press is refused, and nothing is written.
//
// Synthetic throughout: invented codes and figures, no document registered,
// no model called.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import type { DrawingItem, SpecFieldEntry, StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
import { loadDrawingContext, resolveStagedRun } from "@/lib/drawing-resolution";
import { withBillAcknowledgements, type BillReplacement } from "@/lib/bill-over-drawing";
import { PATCH as patchRoute } from "@/app/api/imports/[id]/route";
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
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const noOverall = { width: null, depth: null, height: null, seatHeight: null, diameter: null };
const fig = (valueRaw: string) => ({
  valueRaw,
  unitRaw: "mm",
  view: "ELEVATION",
  page: 1,
  evidence: "ELEVATION, overall",
  candidates: [],
});

describeIfDb("a drawing's values over the bill's, one press per card", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let phaseId = "";
  let billRunId = "";
  let categoryId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA drawing over bill', 'qa', 'qa') returning id`,
        [qaNumber("P90781")],
      )
    ).rows[0].id;
    phaseId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN', 0, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    // The bill this phase came from: what makes an occupant "the bill's".
    billRunId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
         values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    // A category whose checklist asks Dimensions, so the recomposed answer is part of what is proved.
    categoryId = (
      await client.query(
        `select c.id from item_categories c
         where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 3)
         order by c.sort_order limit 1`,
      )
    ).rows[0].id;
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({ id: row.id, jsonId: Number(row.json_id), name: row.name }),
    );
  });

  afterAll(async () => {
    if (projectId) {
      const records = `select id from spec_records where project_id = $1`;
      await client.query(`update record_attributes set finish_id = null, superseded_by_id = null where record_id in (${records})`, [projectId]);
      await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
      await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      // Deleting the project cascades the change sets, versions, records and finishes.
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const fieldId = (jsonId: number) => fields.find((field) => field.jsonId === jsonId)!.id;

  /** A bill line with its category's checklist, as a confirmed bill leaves it. */
  async function billRecord(code: string): Promise<string> {
    const recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, category_id, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Stool', 4, $3, 'qa', 'qa') returning id`,
        [projectId, phaseId, categoryId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa' from requirements q where q.category_id = $2`,
      [recordId, categoryId],
    );
    return recordId;
  }

  async function attribute(
    recordId: string,
    row: { group: string; slot?: string | null; label: string; value: string; unit?: string | null; code?: string | null; field?: string | null },
    sourceRunId: string | null,
  ): Promise<string> {
    return (
      await client.query(
        `insert into record_attributes
           (record_id, attr_group, dimension_slot, label, value, unit, material_code, spec_field_id, state,
            source_run_id, source_page, sort_order, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, null, 1, 'qa', 'qa') returning id`,
        [recordId, row.group, row.slot ?? null, row.label, row.value, row.unit ?? null, row.code ?? null, row.field ?? null, sourceRunId],
      )
    ).rows[0].id;
  }

  async function stage(code: string, overall: Record<string, unknown>): Promise<string> {
    const doc = stageDrawingsV4(
      DrawingsItemsOutput.parse({
        documentNotes: null,
        nonItemPages: [],
        items: [
          {
            codes: [code],
            name: "Stool",
            pages: [1],
            whyOneItem: null,
            overall: { ...noOverall, ...overall },
            combinedLine: null,
            configurations: [],
            finishes: [{ part: "BASE", spec: "Example bronze", code: "MTL-02", configurations: [], page: 1, swatch: null }],
            statements: [],
            mockup: { is: false, evidence: null },
            otherDimensions: [],
            notes: [],
            pictures: [],
            uncertain: [],
            confidence: "high",
          },
        ],
      }),
      fields,
      "__QA stool drawing.pdf",
      null,
    );
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

  async function staged(runId: string): Promise<{ doc: StagedDrawings; item: DrawingItem }> {
    const doc = (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;
    return { doc, item: doc.items[0]! };
  }

  async function resolved(runId: string) {
    const { doc } = await staged(runId);
    return resolveStagedRun(doc, await loadDrawingContext(projectId), fields, runId)[0]!;
  }

  /** The card's press: each row's whole `replaces` list through the real autosave. */
  async function press(runId: string, entries: readonly BillReplacement[]) {
    const { item } = await staged(runId);
    for (const observation of item.observations) {
      const mine = entries.filter((entry) => entry.observationId === observation.id);
      if (mine.length === 0) continue;
      const response = await patchRoute(
        request("PATCH", {
          itemId: item.id,
          observationId: observation.id,
          expectedVersion: observation.version,
          changes: { replaces: withBillAcknowledgements(observation, mine, true) },
        }),
        params(runId),
      );
      expect(response.ok, await response.clone().text()).toBe(true);
    }
  }

  async function confirm(runId: string) {
    const { item } = await staged(runId);
    const response = await confirmRoute(
      request("POST", {
        action: "confirm",
        itemId: item.id,
        itemVersion: item.version,
        observations: item.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
      }),
      params(runId),
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function row(id: string) {
    return (
      await client.query(`select id, status, superseded_by_id, value, dimension_slot, version from record_attributes where id = $1`, [id])
    ).rows[0];
  }

  it("lists only the bill's values, clears their blockers in one press, and the confirm replaces them", async () => {
    const code = `__QA-STL-${Date.now()}`;
    const recordId = await billRecord(code);
    const metalField = fieldId(5); // Main metal finish
    const billD = await attribute(recordId, { group: "dimension", slot: "D", label: "Size", value: "460", unit: "mm" }, billRunId);
    const billH = await attribute(recordId, { group: "dimension", slot: "H", label: "Size", value: "450", unit: "mm" }, billRunId);
    const billMetal = await attribute(
      recordId,
      { group: "finish", label: "Metal", value: "MTL-01 Example brass", code: "MTL-01", field: metalField },
      billRunId,
    );
    // A seat height a PERSON typed: no run, no page.
    const typedSh = await attribute(recordId, { group: "dimension", slot: "SH", label: "Seat height", value: "400", unit: "mm" }, null);

    const runId = await stage(code, { diameter: fig("457"), height: fig("425"), seatHeight: fig("380") });
    const { item } = await staged(runId);
    expect(item.observations.find((o) => o.attrGroup !== "dimension")?.specFieldId).toBe(metalField);

    const before = await resolved(runId);
    expect(before.targets).toEqual([recordId]);
    expect(before.blockers.map((b) => b.code).sort()).toEqual([
      "dia_conflict",
      "dimension_slot_taken",
      "dimension_slot_taken",
      "slot_taken",
    ]);
    const entries = before.billReplacements ?? [];
    expect(entries.map((entry) => [entry.kind, entry.occupant.attributeId]).sort()).toEqual(
      [
        ["replace", billH],
        ["replace", billMetal],
        ["retire_square", billD],
      ].sort(),
    );
    // Never the person's seat height.
    expect(entries.some((entry) => entry.occupant.attributeId === typedSh)).toBe(false);

    await press(runId, entries);

    const after = await resolved(runId);
    // The typed seat height still holds the card, on its own tick, with today's sentence.
    expect(after.blockers.map((b) => b.code)).toEqual(["dimension_slot_taken"]);
    expect((after.billReplacements ?? []).every((entry) => entry.acknowledged)).toBe(true);
    const refused = await confirm(runId);
    expect(refused.response.status).toBe(409);
    expect((await row(billD)).status).toBe("active");

    // The reviewer ticks the typed one too, row by row.
    const { item: now } = await staged(runId);
    const seat = now.observations.find((o) => o.dimensionSlot === "SH")!;
    const ticked = await patchRoute(
      request("PATCH", {
        itemId: now.id,
        observationId: seat.id,
        expectedVersion: seat.version,
        changes: { replaces: [{ recordId, attributeId: typedSh, attributeVersion: (await row(typedSh)).version }] },
      }),
      params(runId),
    );
    expect(ticked.ok).toBe(true);

    const confirmed = await confirm(runId);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);

    const active = (
      await client.query(
        `select id, dimension_slot, value, source_run_id, spec_field_id from record_attributes
          where record_id = $1 and status = 'active' order by dimension_slot nulls last`,
        [recordId],
      )
    ).rows;
    expect(active.map((a) => [a.dimension_slot, a.value, a.source_run_id])).toEqual([
      ["DIA", "457", runId],
      ["H", "425", runId],
      ["SH", "380", runId],
      [null, "Example bronze", runId],
    ]);
    const newId = (slot: string | null) => active.find((a) => a.dimension_slot === slot)!.id;

    // Each bill value retired, kept, and pointing at what took its place; the
    // bill's D at the DIAMETER.
    expect(await row(billD)).toMatchObject({ status: "retired", superseded_by_id: newId("DIA") });
    expect(await row(billH)).toMatchObject({ status: "retired", superseded_by_id: newId("H") });
    expect(await row(billMetal)).toMatchObject({ status: "retired", superseded_by_id: newId(null) });
    expect(await row(typedSh)).toMatchObject({ status: "retired", superseded_by_id: newId("SH") });

    // One change, one version, and the retirements are in that change's trail.
    const changes = (
      await client.query(`select id, kind from change_sets where project_id = $1 and source_intake_run_id = $2`, [projectId, runId])
    ).rows;
    expect(changes.map((change) => change.kind)).toEqual(["drawing_confirm"]);
    const versions = (
      await client.query(`select snapshot_no from record_snapshots where record_id = $1 and change_set_id = $2`, [recordId, changes[0].id])
    ).rows;
    expect(versions).toHaveLength(1);
    const audited = (
      await client.query(
        `select distinct row_id from audit_log where change_set_id = $1 and table_name = 'record_attributes' and row_id = any($2::text[])`,
        [changes[0].id, [billD, billH, billMetal]],
      )
    ).rows;
    expect(audited).toHaveLength(3);

    // The checklist recomposed from the diameter: the bill's depth is gone from it.
    const dims = (
      await client.query(
        `select a.value, a.state from spec_answers a join spec_fields f on f.id = a.spec_field_id
          where a.record_id = $1 and f.json_id = 3`,
        [recordId],
      )
    ).rows[0];
    expect(dims.value).toMatch(/^Dia\.457 x H425 x SH380mm/);
    expect(dims.value).not.toMatch(/D460/);
  });

  it("refuses an occupant that moved after the press, and writes nothing", async () => {
    const code = `__QA-STL-B-${Date.now()}`;
    const recordId = await billRecord(code);
    const billD = await attribute(recordId, { group: "dimension", slot: "D", label: "Size", value: "460", unit: "mm" }, billRunId);
    const billH = await attribute(recordId, { group: "dimension", slot: "H", label: "Size", value: "450", unit: "mm" }, billRunId);
    const runId = await stage(code, { diameter: fig("457"), height: fig("425") });
    // No finish on this card: ignore the staged metal row so only the sizes count.
    const { item } = await staged(runId);
    const metal = item.observations.find((o) => o.attrGroup !== "dimension")!;
    const ignored = await confirmRoute(
      request("POST", { action: "ignore", itemId: item.id, observations: [{ id: metal.id, version: metal.version }] }),
      params(runId),
    );
    expect(ignored.ok).toBe(true);

    await press(runId, (await resolved(runId)).billReplacements ?? []);
    expect((await resolved(runId)).blockers).toEqual([]);

    // Somebody touches the bill's depth after the press.
    await client.query(`update record_attributes set label = 'Size (checked)', updated_by = 'qa' where id = $1`, [billD]);

    const refused = await confirm(runId);
    expect(refused.response.status).toBe(409);
    expect(String(refused.body.error ?? "")).toMatch(/changed since you looked at it/);
    expect(await row(billD)).toMatchObject({ status: "active", superseded_by_id: null });
    expect(await row(billH)).toMatchObject({ status: "active", superseded_by_id: null });
    const written = (
      await client.query(`select count(*)::int as n from record_attributes where record_id = $1 and source_run_id = $2`, [recordId, runId])
    ).rows[0].n;
    expect(written).toBe(0);
  });
});
