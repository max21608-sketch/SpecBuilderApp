// Database tier — one fabric stated on two pages is ONE fabric per record.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/cross-page-same-fabric.test.ts
//
// ============================================================================
// Plan any-bill, step 4. S-301's specification sheet and its shop drawing name
// one cloth twice, the sheet with no code and the drawing coded. Two paths,
// both through the real routes, and what only the confirm can show is where
// the rows land:
//
//   THE SAME WORDS IN ANOTHER ORDER fold at read time: no clash, and the
//   drawing's row is already recorded when its page is confirmed.
//
//   DIFFERENT WORDS ask. "Same fabric — keep page 1's wording" is two
//   autosaves — the kept row takes page 2's code, and page 2's row is ignored
//   "same as page 1" through the PATCH — and then both pages confirm.
//
// Either way: ONE COM 1 per configuration record, nothing in COM 2.
//
// Synthetic throughout (tests/fixtures/named-configurations.ts). No document
// is registered, no model is called, nothing is charged.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
import { planClashResolution } from "@/lib/clash-resolution";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { PATCH as importPatchRoute } from "@/app/api/imports/[id]/route";
import { ONE_CHAIR_TWO_PAGES, SHOP_DRAWING, SPEC_SHEET } from "../fixtures/named-configurations";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

describeIfDb("one fabric stated on two pages", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let projectId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Same fabric twice', 'qa', 'qa') returning id`,
        [qaNumber("P90081")],
      )
    ).rows[0].id;
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({ id: row.id, jsonId: Number(row.json_id), name: row.name }),
    );
  });

  afterAll(async () => {
    const records = `select id from spec_records where project_id = $1`;
    await client.query(`update record_attributes set finish_id = null where record_id in (${records})`, [projectId]);
    await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const com = (jsonId: number) => fields.find((field) => field.jsonId === jsonId)!.id;

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
                 'active', '__QA Desk chair', 45, 'qa', 'qa') returning id`,
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

  async function stage(code: string, sheetWords: string, drawingWords: string): Promise<string> {
    const doc = stageDrawings(
      [
        {
          ...SPEC_SHEET,
          itemCodeRaw: code,
          materials: SPEC_SHEET.materials.map((m, i) => (i === 0 ? { ...m, valueRaw: sheetWords } : m)),
        },
        {
          ...SHOP_DRAWING,
          itemCodeRaw: `${code} MUR 1 & TYPO 5`,
          materials: SHOP_DRAWING.materials.map((m, i) => (i === 0 ? { ...m, valueRaw: drawingWords } : m)),
        },
      ],
      fields,
      "__QA q-301.pdf",
      null,
      null,
      [{ ...ONE_CHAIR_TWO_PAGES, itemCodes: [code, `${code} MUR 1 & TYPO 5`] }],
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

  const liveDoc = async (runId: string) =>
    (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;

  async function confirm(runId: string, page: number) {
    const item = (await liveDoc(runId)).items.find((entry) => entry.page === page)!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: item.observations.filter((o) => o.reviewStatus === "pending").map((o) => ({ id: o.id, version: o.version })),
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function patch(runId: string, itemId: string, observationId: string, expectedVersion: number, changes: Record<string, unknown>) {
    const response = await importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, observationId, expectedVersion, changes }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  /** Every active COM attribute on the bill line's TYPE 1 and TYPE 5. */
  async function fabricsOn(bill: string) {
    return (
      await client.query(
        `select r.variant_label, a.spec_field_id, a.value, a.material_code, a.source_page
           from record_attributes a join spec_records r on r.id = a.record_id
          where r.parent_id = $1 and r.variant_label in ('TYPE 1', 'TYPE 5') and a.status = 'active'
            and a.spec_field_id = any($2::uuid[])
          order by r.variant_label, a.spec_field_id`,
        [bill, [com(1), com(2), com(14)]],
      )
    ).rows;
  }

  it("folds the same words in another order: no clash, one COM 1 per record", async () => {
    const code = `__QA Q-311-${Date.now()}`;
    const bill = await billLine(code);
    const runId = await stage(code, "Maker A, Pattern X - Raffia", "Raffia, Maker A, Pattern X");

    const first = await confirm(runId, 1);
    expect(first.response.ok, JSON.stringify(first.body)).toBe(true);
    const second = await confirm(runId, 2);
    expect(second.response.ok, JSON.stringify(second.body)).toBe(true);

    const fabrics = await fabricsOn(bill);
    expect(fabrics.map((row) => [row.variant_label, row.spec_field_id, row.source_page])).toEqual([
      ["TYPE 1", com(1), 1],
      ["TYPE 5", com(1), 1],
    ]);
    // The drawing's row wrote nothing: already recorded from page 1.
    const drawingFabric = (await liveDoc(runId)).items
      .find((entry) => entry.page === 2)!
      .observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    expect(drawingFabric.reviewStatus).toBe("applied");
    expect(drawingFabric.applied?.alreadyRecorded?.length).toBe(2);
  });

  it("keeps page 1's wording with page 2's code, ignores page 2, and writes one COM 1 per record", async () => {
    const code = `__QA Q-312-${Date.now()}`;
    const bill = await billLine(code);
    const runId = await stage(code, "Maker A, Ref. Pattern X - Raffia", "Maker A, raffia, Pattern X");

    // The clash is refused before anything is written.
    const upFront = await confirm(runId, 1);
    expect(upFront.response.status).toBe(409);
    expect(JSON.stringify(upFront.body)).toContain("If they are the same fabric, keep one wording");

    // The answer, planned by the function the screen calls, sent through the
    // real autosave under each row's own version.
    const doc = await liveDoc(runId);
    const sheet = doc.items.find((entry) => entry.page === 1)!;
    const drawing = doc.items.find((entry) => entry.page === 2)!;
    const kept = sheet.observations.find((o) => o.specFieldId === com(1) && o.configurations?.includes("Type 1"))!;
    const dropped = drawing.observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    const plan = planClashResolution({ kind: "keep", keepId: kept.id, dropId: dropped.id }, doc.items, () => false);
    if (!plan.ok) throw new Error(plan.error);
    for (const edit of plan.edits) {
      const sent = await patch(runId, edit.item.id, edit.observation.id, edit.observation.version, edit.changes);
      expect(sent.response.ok, JSON.stringify(sent.body)).toBe(true);
    }

    const after = await liveDoc(runId);
    const droppedNow = after.items.find((entry) => entry.page === 2)!.observations.find((o) => o.id === dropped.id)!;
    expect(droppedNow.reviewStatus).toBe("ignored");
    expect(droppedNow.ignoredReason).toBe("same as page 1");
    expect(after.items.find((entry) => entry.page === 1)!.observations.find((o) => o.id === kept.id)!.materialCodeRaw).toBe(
      "QQ-01.1",
    );

    const first = await confirm(runId, 1);
    expect(first.response.ok, JSON.stringify(first.body)).toBe(true);
    const second = await confirm(runId, 2);
    expect(second.response.ok, JSON.stringify(second.body)).toBe(true);

    const fabrics = await fabricsOn(bill);
    expect(fabrics).toEqual([
      expect.objectContaining({ variant_label: "TYPE 1", spec_field_id: com(1), value: "Maker A, Ref. Pattern X - Raffia", material_code: "QQ-01.1" }),
      expect.objectContaining({ variant_label: "TYPE 5", spec_field_id: com(1), value: "Maker A, Ref. Pattern X - Raffia", material_code: "QQ-01.1" }),
    ]);
  });

  it("refuses an ignore sent with other changes, in words", async () => {
    const code = `__QA Q-313-${Date.now()}`;
    await billLine(code);
    const runId = await stage(code, "Maker A, Ref. Pattern X", "Maker A, Pattern X");
    const drawing = (await liveDoc(runId)).items.find((entry) => entry.page === 2)!;
    const row = drawing.observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    const sent = await patch(runId, drawing.id, row.id, row.version, { ignoreBecause: "same as page 1", value: "x" });
    expect(sent.response.status).toBe(400);
    expect(String(sent.body.error)).toContain("on its own");
    const still = (await liveDoc(runId)).items.find((entry) => entry.page === 2)!.observations.find((o) => o.id === row.id)!;
    expect(still.reviewStatus).toBe("pending");
  });
});
