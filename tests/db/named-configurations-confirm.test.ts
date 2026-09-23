// Database tier — confirming a page whose configurations the DOCUMENT NAMES
// (schemaVersion 3, 2026-09-23).
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// WHAT THIS PROVES, AND WHY IT IS A DATABASE TEST.
//
// The fan-out is pure and pinned in `tests/lib/named-configurations.test.ts`.
// What only the confirm can show is where the rows actually LAND: that the
// S-301 sheet becomes FIVE records per phase named as the document names them,
// that each room type's fabric is COM 1 on its OWN record (the defect was COM 1,
// COM 2 and COM 3 of one record), that the geometry reaches all of them, and
// that a second page naming two of them lands on those two with no new record.
//
// And the safety floor: a bill line that already has OTHER configurations is
// not given a new one until the reviewer ticks it, through the real PATCH.
//
// Synthetic throughout — tests/fixtures/named-configurations.ts. No document is
// registered, no model is called, nothing is charged.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { stageDrawings, type SpecFieldEntry, type StagedDrawings } from "@/lib/drawing-document";
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

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("confirming configurations a document names", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  const runIds: string[] = [];
  const billIds: string[] = [];
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90737")}', '__QA Named configurations', 'qa', 'qa') returning id`,
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
    // Deleting the project cascades the change sets and versions (0013-0015).
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
    runIds.push(run);
    const bill = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, qty, created_by, updated_by)
         values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                 'active', '__QA Desk chair', 45, 'qa', 'qa') returning id`,
        [projectId, run],
      )
    ).rows[0].id;
    billIds.push(bill);
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [bill, projectId, code],
    );
    return bill;
  }

  async function stage(doc: StagedDrawings): Promise<string> {
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

  async function liveDoc(runId: string): Promise<StagedDrawings> {
    return (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as StagedDrawings;
  }

  async function confirm(runId: string, page: number) {
    const doc = await liveDoc(runId);
    const item = doc.items.find((entry) => entry.page === page)!;
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

  const variantsOf = async (parentId: string) =>
    (await client.query(`select id, variant_label, qty from spec_records where parent_id = $1 and status = 'active' order by variant_label`, [parentId])).rows;

  const com = (jsonId: number) => fields.find((field) => field.jsonId === jsonId)!.id;

  it("makes five configurations per phase, each fabric COM 1 on its own record", async () => {
    // The sheet uses the real ids, so the fixture's letters are replaced by
    // whatever `spec_fields` holds.
    const code = `__QA Q-301-${Date.now()}`;
    const main = await phase("__QA MAIN RUN", code);
    const ve = await phase("__QA MAIN RUN - VE", code);
    const doc = stageDrawings(
      [
        { ...SPEC_SHEET, itemCodeRaw: code },
        { ...SHOP_DRAWING, itemCodeRaw: `${code} MUR 1 & TYPO 5` },
      ],
      fields,
      "__QA q-301.pdf",
      null,
      null,
      [{ ...ONE_CHAIR_TWO_PAGES, itemCodes: [code, `${code} MUR 1 & TYPO 5`] }],
    );
    const runId = await stage(doc);

    const first = await confirm(runId, 1);
    expect(first.response.ok, JSON.stringify(first.body)).toBe(true);

    for (const parentId of [main, ve]) {
      const variants = await variantsOf(parentId);
      expect(variants.map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
      // No quantity is apportioned: the bill says 45 of the line.
      expect(variants.every((row) => row.qty === null)).toBe(true);

      const byLabel = new Map(variants.map((row) => [String(row.variant_label), String(row.id)]));
      const attributes = async (label: string) =>
        (
          await client.query(
            `select label, value, spec_field_id, dimension_slot from record_attributes
              where record_id = $1 and status = 'active' order by sort_order`,
            [byLabel.get(label)],
          )
        ).rows;
      for (const [label, cloth] of [
        ["TYPE 1", "Maker A, Ref. X"],
        ["TYPE 5", "Maker A, Ref. X"],
        ["TYPE 2", "Maker B, Ref. Y"],
        ["TYPE 3", "Maker C, Ref. Z"],
        ["TYPE 4", "Maker D, Ref. W"],
      ] as const) {
        const rows = await attributes(label);
        // The geometry, shared, on every configuration.
        expect(rows.filter((row) => row.dimension_slot).map((row) => row.dimension_slot).sort()).toEqual(["D", "H", "W"]);
        // ONE fabric, and it is COM 1. Nothing in COM 2 or COM 3.
        const fabrics = rows.filter((row) => row.spec_field_id);
        expect(fabrics).toEqual([expect.objectContaining({ value: cloth, spec_field_id: com(1) })]);
        expect(rows.some((row) => row.spec_field_id === com(2) || row.spec_field_id === com(14))).toBe(false);
      }
    }
    // The bill line itself carries nothing: it is a heading now.
    expect((await client.query(`select count(*)::int as n from record_attributes where record_id = $1`, [main])).rows[0].n).toBe(0);

    // Page 2 depicts TYPE 1 and TYPE 5 and lands on exactly those, creating nothing.
    const second = await confirm(runId, 2);
    expect(second.response.ok, JSON.stringify(second.body)).toBe(true);
    expect((await variantsOf(main)).length).toBe(5);
    const onType2 = (
      await client.query(
        `select count(*)::int as n from record_attributes a join spec_records r on r.id = a.record_id
          where r.parent_id = $1 and r.variant_label = 'TYPE 2' and a.source_page = 2`,
        [main],
      )
    ).rows[0].n;
    expect(onType2).toBe(0);
  });

  it("will not add a named configuration beside existing ones until the reviewer ticks it", async () => {
    const code = `__QA Q-302-${Date.now()}`;
    const bill = await phase("__QA LETTERED RUN", code);
    // A bill line already split by page letter, the v1 way.
    await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, item_description, parent_id, depth, split_reason,
                                 variant_label, created_by, updated_by)
       values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1), 'active',
               '__QA Desk chair', $3, 1, 'fabric', 'A', 'qa', 'qa')`,
      [projectId, runIds[runIds.length - 1], bill],
    );
    const runId = await stage(stageDrawings([{ ...SPEC_SHEET, itemCodeRaw: code }], fields, "__QA q-302.pdf", null));

    const refused = await confirm(runId, 1);
    expect(refused.response.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("already has configuration A");
    expect((await variantsOf(bill)).map((row) => row.variant_label)).toEqual(["A"]);

    // The reviewer ticks all five, through the real PATCH.
    const doc = await liveDoc(runId);
    const item = doc.items[0]!;
    const patched = await importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          expectedVersion: item.version,
          changes: { configurationAcks: ["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"].map((label) => ({ recordId: bill, label })) },
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    expect(patched.ok).toBe(true);
    // The acknowledgement did not untick the phase it was ticked on.
    expect((await liveDoc(runId)).items[0]!.targets).toBeNull();

    const accepted = await confirm(runId, 1);
    expect(accepted.response.ok, JSON.stringify(accepted.body)).toBe(true);
    expect((await variantsOf(bill)).map((row) => row.variant_label)).toEqual(["A", "TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
  });

  // Brief C1: a reviewer's corrections, through the real PATCH, reach the
  // confirm through the same plan the card reads.
  it("writes what the reviewer set: an added configuration, a moved row, a refused name", async () => {
    const code = `__QA Q-303-${Date.now()}`;
    const bill = await phase("__QA C1 RUN", code);
    const runId = await stage(stageDrawings([{ ...SPEC_SHEET, itemCodeRaw: code }], fields, "__QA q-303.pdf", null));
    const patch = async (body: Record<string, unknown>) =>
      importPatchRoute(
        new Request("http://localhost/test", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: runId }) },
      );

    let item = (await liveDoc(runId)).items[0]!;
    // A name the CHECK would refuse is refused in words, and nothing is written.
    const refused = await patch({
      itemId: item.id,
      expectedVersion: item.version,
      changes: { configurationsByReviewer: [{ label: "Type 1 & 5 guest", readAs: null }] },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("too long to be a configuration name");

    const list = ["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"].map((label) => ({ label, readAs: label }));
    const added = await patch({
      itemId: item.id,
      expectedVersion: item.version,
      changes: { configurationsByReviewer: [...list, { label: "Type 6", readAs: null }] },
    });
    expect(added.ok).toBe(true);
    item = (await liveDoc(runId)).items[0]!;
    const type2 = item.observations.find((o) => o.configurations?.includes("Type 2"))!;
    const moved = await patch({
      itemId: item.id,
      observationId: type2.id,
      expectedVersion: type2.version,
      changes: { configurations: ["type 6"] },
    });
    expect(moved.ok).toBe(true);
    // The model's reading is still on the row, beside the reviewer's.
    const after = (await liveDoc(runId)).items[0]!.observations.find((o) => o.id === type2.id)!;
    expect(after.configurations).toEqual(["Type 2"]);
    expect(after.configurationsByReviewer).toEqual(["TYPE 6"]);

    const confirmed = await confirm(runId, 1);
    expect(confirmed.response.ok, JSON.stringify(confirmed.body)).toBe(true);
    const variants = await variantsOf(bill);
    expect(variants.map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5", "TYPE 6"]);
    const fabricOn = async (label: string) =>
      (
        await client.query(
          `select a.value from record_attributes a join spec_records r on r.id = a.record_id
            where r.parent_id = $1 and r.variant_label = $2 and a.spec_field_id is not null`,
          [bill, label],
        )
      ).rows.map((row) => row.value);
    expect(await fabricOn("TYPE 6")).toEqual(["Maker B, Ref. Y"]);
    expect(await fabricOn("TYPE 2")).toEqual([]);
  });
});
