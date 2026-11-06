// Database tier — audit D2 and D3 (2026-11-06), through the real review GET,
// the real autosave PATCH and the real confirm route.
//
// Skips without DATABASE_URL. On the local stack, from a worktree:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/drawing-replace-follows-row.test.ts
//
// ============================================================================
// WHAT IT PROVES.
//
// D2. A bill has written a desk's width. A drawing of the desk gives another
// width; the reviewer ticks "Use this drawing's", then makes the row a note.
// The bill's width stays live and the drawing's figure is written BESIDE it as
// a note; nothing is retired. Before the fix the tick survived the move and the
// confirm retired the bill's W, superseded by the note. A tick that survived
// anyway (a row staged before the fix) holds the card in words.
//
// D3. An untouched card is confirmed with the records it SHOWED. A bill in
// another tab puts the code on a second phase between the page load and the
// press; the confirm refuses with "The records this drawing applies to
// changed. Reload." and writes nothing anywhere.
//
// Synthetic throughout: invented codes and figures, no document registered,
// no model called.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { shownTargets } from "./shown-targets";
import type { DrawingItem, SpecFieldEntry, StagedDrawings } from "@/lib/drawing-document";
import { stageDrawingsV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";
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

describeIfDb("a replace tick follows its row, and a card writes only where it showed", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let mainPhase = "";
  let billRunId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA replace follows row', 'qa', 'qa') returning id`,
        [qaNumber("P90814")],
      )
    ).rows[0].id;
    mainPhase = await phase("__QA MAIN", 0);
    billRunId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
         values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
        [projectId],
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

  async function phase(name: string, sortOrder: number): Promise<string> {
    return (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, $2, $3, 'qa', 'qa') returning id`,
        [projectId, name, sortOrder],
      )
    ).rows[0].id;
  }

  /** A bill line, as a confirmed bill leaves it (no category: no checklist to recompose). */
  async function billRecord(code: string, runId: string): Promise<string> {
    const recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Desk', 2, 'qa', 'qa') returning id`,
        [projectId, runId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    return recordId;
  }

  async function billWidth(recordId: string, value: string): Promise<string> {
    return (
      await client.query(
        `insert into record_attributes
           (record_id, attr_group, dimension_slot, label, value, unit, state, source_run_id, source_page, sort_order, created_by, updated_by)
         values ($1, 'dimension', 'W', 'Size', $2, 'mm', 'confirmed', $3, null, 1, 'qa', 'qa') returning id`,
        [recordId, value, billRunId],
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
            name: "Desk",
            pages: [1],
            whyOneItem: null,
            overall: { ...noOverall, ...overall },
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
          },
        ],
      }),
      fields,
      "__QA desk drawing.pdf",
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

  async function patch(runId: string, observationId: string, changes: Record<string, unknown>) {
    const { item } = await staged(runId);
    const observation = item.observations.find((o) => o.id === observationId)!;
    const response = await patchRoute(
      request("PATCH", { itemId: item.id, observationId, expectedVersion: observation.version, changes }),
      params(runId),
    );
    expect(response.ok, await response.clone().text()).toBe(true);
  }

  async function confirm(runId: string, shown?: string[]) {
    const { item } = await staged(runId);
    const response = await confirmRoute(
      request("POST", {
        action: "confirm",
        itemId: item.id,
        itemVersion: item.version,
        shownTargets: shown ?? (await shownTargets(runId, item.id)),
        observations: item.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
      }),
      params(runId),
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function active(recordId: string) {
    return (
      await client.query(
        `select id, attr_group, dimension_slot, value, source_run_id from record_attributes
          where record_id = $1 and status = 'active' order by sort_order`,
        [recordId],
      )
    ).rows;
  }

  it("a ticked width made a note writes the note beside the bill's width and retires nothing", async () => {
    const code = `__QA-DSK-${Date.now()}`;
    const recordId = await billRecord(code, mainPhase);
    const billW = await billWidth(recordId, "900");
    const runId = await stage(code, { width: fig("950") });
    const { item } = await staged(runId);
    const width = item.observations.find((o) => o.dimensionSlot === "W")!;

    // "Use this drawing's" on the bill's width, then "is a note, not a slot".
    await patch(runId, width.id, { replaces: [{ recordId, attributeId: billW, attributeVersion: 1 }] });
    await patch(runId, width.id, { attrGroup: "note", dimensionSlot: null });

    // The autosave dropped the tick with the move.
    const { item: after } = await staged(runId);
    expect(after.observations.find((o) => o.id === width.id)!.replaces ?? []).toEqual([]);

    const confirmed = await confirm(runId);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);
    const rows = await active(recordId);
    // The bill's W is still THE width; the drawing's figure is a note beside it.
    expect(rows.find((row) => row.dimension_slot === "W")).toMatchObject({ id: billW, value: "900" });
    expect(rows.find((row) => row.attr_group === "note")).toMatchObject({ value: "950", source_run_id: runId });
    const retired = await client.query(`select count(*)::int n from record_attributes where record_id = $1 and status = 'retired'`, [recordId]);
    expect(retired.rows[0].n).toBe(0);
  });

  it("a tick that survived a move anyway holds the card, and the confirm retires nothing", async () => {
    const code = `__QA-DSK-S-${Date.now()}`;
    const recordId = await billRecord(code, mainPhase);
    const billW = await billWidth(recordId, "900");
    const runId = await stage(code, { width: fig("950") });
    const { doc, item } = await staged(runId);
    // A row staged before the fix: a note still carrying its tick, written
    // straight into the staged JSON as the old autosave left it.
    const stale = {
      ...doc,
      items: doc.items.map((row) =>
        row.id !== item.id
          ? row
          : {
              ...row,
              observations: row.observations.map((o) =>
                o.dimensionSlot === "W"
                  ? { ...o, attrGroup: "note" as const, dimensionSlot: null, replaces: [{ recordId, attributeId: billW, attributeVersion: 1 }] }
                  : o,
              ),
            },
      ),
    };
    await client.query(`update intake_runs set parsed = $2::jsonb where id = $1`, [runId, JSON.stringify(stale)]);

    const refused = await confirm(runId);
    expect(refused.response.status).toBe(409);
    const blockers = (refused.body.diff ?? []) as { code: string }[];
    expect(blockers.map((b) => b.code)).toContain("replace_stale");
    expect(String(refused.body.error)).toMatch(/no longer replaces/);
    const rows = await active(recordId);
    expect(rows.map((row) => row.id)).toEqual([billW]);
  });

  it("an untouched card refuses a record that appeared after the page loaded, and writes nothing", async () => {
    const code = `__QA-DSK-T-${Date.now()}`;
    const main = await billRecord(code, mainPhase);
    const runId = await stage(code, { height: fig("740") });
    const { item } = await staged(runId);
    expect(item.targets).toBeNull();

    // What the card shows when the page loads.
    const shown = await shownTargets(runId, item.id);
    expect(shown).toEqual([main]);

    // In another tab, a bill puts the code on a second phase.
    const vePhase = await phase(`__QA VE ${Date.now()}`, 1);
    const ve = await billRecord(code, vePhase);

    const refused = await confirm(runId, shown);
    expect(refused.response.status).toBe(409);
    expect(refused.body.code).toBe("targets_changed");
    expect(refused.body.error).toBe("The records this drawing applies to changed. Reload.");
    for (const recordId of [main, ve]) expect(await active(recordId)).toEqual([]);

    // Reloaded, the card shows both and confirms onto both.
    const reloaded = await shownTargets(runId, item.id);
    expect([...reloaded].sort()).toEqual([main, ve].sort());
    const confirmed = await confirm(runId, reloaded);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);
    for (const recordId of [main, ve]) expect((await active(recordId)).map((row) => row.value)).toEqual(["740"]);
  });

  it("a drawings confirm that does not say what its card showed is asked to reload", async () => {
    const code = `__QA-DSK-O-${Date.now()}`;
    await billRecord(code, mainPhase);
    const runId = await stage(code, { height: fig("740") });
    const { item } = await staged(runId);
    const response = await confirmRoute(
      request("POST", {
        action: "confirm",
        itemId: item.id,
        itemVersion: item.version,
        observations: item.observations.map((o) => ({ id: o.id, version: o.version })),
      }),
      params(runId),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Reload/);
  });
});
