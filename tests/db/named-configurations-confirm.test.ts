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

    // A CLASH THE CARD CAN SEE IS REFUSED BEFORE ANY PAGE IS APPLIED. Both
    // pages give TYPE 1 and TYPE 5 their COM 1, in different words (page 2
    // coded, page 1 not): the sheet itself is refused, nothing is written, and
    // the reviewer decides — here by ignoring the drawing's fabric row.
    const upFront = await confirm(runId, 1);
    expect(upFront.response.status).toBe(409);
    expect(new Set(((upFront.body as { diff?: { code: string }[] }).diff ?? []).map((b) => b.code))).toEqual(
      new Set(["field_conflict"]),
    );
    expect((await variantsOf(main)).length).toBe(0);
    const staged2 = (await liveDoc(runId)).items.find((entry) => entry.page === 2)!;
    const drawingFabric = staged2.observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    const ignored = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ignore",
          itemId: staged2.id,
          itemVersion: staged2.version,
          observations: [{ id: drawingFabric.id, version: drawingFabric.version }],
        }),
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    expect(ignored.ok).toBe(true);

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
        const fabrics = rows.filter((row) => [com(1), com(2), com(14)].includes(row.spec_field_id));
        expect(fabrics).toEqual([expect.objectContaining({ value: cloth, spec_field_id: com(1) })]);
        expect(rows.some((row) => row.spec_field_id === com(2) || row.spec_field_id === com(14))).toBe(false);
      }
    }
    // The bill line itself carries nothing: it is a heading now.
    expect((await client.query(`select count(*)::int as n from record_attributes where record_id = $1`, [main])).rows[0].n).toBe(0);

    // Page 2 depicts TYPE 1 and TYPE 5 and lands on exactly those, creating
    // nothing. Its GEOMETRY is the figures the sheet already wrote, and its
    // TIMBER names the same finish by the same code (QW-01) in other words:
    // both are ALREADY RECORDED, with no tick, and nothing is refused.
    const second = await confirm(runId, 2);
    expect(second.response.ok, JSON.stringify(second.body)).toBe(true);
    expect((await variantsOf(main)).length).toBe(5);

    for (const parentId of [main, ve]) {
      for (const label of ["TYPE 1", "TYPE 5"]) {
        const held = (
          await client.query(
            `select a.dimension_slot, a.spec_field_id, a.value, a.source_page from record_attributes a
               join spec_records r on r.id = a.record_id
              where r.parent_id = $1 and r.variant_label = $2 and a.status = 'active'
                and (a.dimension_slot is not null or a.spec_field_id = $3)
              order by a.dimension_slot nulls last`,
            [parentId, label, com(4)],
          )
        ).rows;
        // One W, D, H and one timber per record — the sheet's, page 1.
        expect(held.map((row) => [row.dimension_slot, row.source_page])).toEqual([
          ["D", 1],
          ["H", 1],
          ["W", 1],
          [null, 1],
        ]);
        expect(held[3]!.value).toBe("feet dark tinted wood as per approved sample");
      }
    }
    const appliedDoc = await liveDoc(runId);
    const drawingRows = appliedDoc.items.find((entry) => entry.page === 2)!.observations;
    const recorded = drawingRows.filter((o) => o.attrGroup === "dimension" || o.materialCodeRaw === "QW-01");
    expect(recorded.length).toBe(4);
    for (const observation of recorded) {
      expect(observation.reviewStatus).toBe("applied");
      expect(observation.applied?.alreadyRecorded).toHaveLength(4);
      expect(observation.applied?.alreadyRecorded?.every((entry) => entry.sourcePage === 1)).toBe(true);
    }
    // The ignored fabric wrote nothing: TYPE 1 keeps the sheet's cloth.
    const fabricsNow = (
      await client.query(
        `select a.value from record_attributes a join spec_records r on r.id = a.record_id
          where r.parent_id = any($1::uuid[]) and r.variant_label in ('TYPE 1', 'TYPE 5')
            and a.spec_field_id = $2 and a.status = 'active'`,
        [[main, ve], com(1)],
      )
    ).rows.map((row) => row.value);
    expect(fabricsNow).toEqual(Array(4).fill("Maker A, Ref. X"));
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
    expect(JSON.stringify(refused.body)).toContain("already has A. Pair it with one of them, or create it as a new configuration");
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
          // COM 1-3 only (json_id 1, 2, 14): the shared timber row reaches every
          // configuration too, which is asserted separately below.
          `select a.value from record_attributes a join spec_records r on r.id = a.record_id
             join spec_fields f on f.id = a.spec_field_id
            where r.parent_id = $1 and r.variant_label = $2 and a.status = 'active' and f.json_id in (1, 2, 14)`,
          [bill, label],
        )
      ).rows.map((row) => row.value);
    expect(await fabricOn("TYPE 6")).toEqual(["Maker B, Ref. Y"]);
    expect(await fabricOn("TYPE 2")).toEqual([]);
    // A SHARED row reaches every configuration, the one a reviewer added included.
    const timberOn = await client.query(
      `select r.variant_label from record_attributes a join spec_records r on r.id = a.record_id
        where r.parent_id = $1 and a.status = 'active' and a.value = 'feet dark tinted wood as per approved sample'
        order by r.variant_label`,
      [bill],
    );
    expect(timberOn.rows.map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5", "TYPE 6"]);
  });

  // PLAN STEP 5: two documents, one set of configurations. The spec sheet
  // makes TYPE 1-5; a drawing set then draws the same chair per room, titled
  // in its own words. Only the page's OWN WORDS pair silently.
  it("pairs a second document's configurations only on the page's own words, and asks for the rest", async () => {
    const code = `__QA Q-305-${Date.now()}`;
    const bill = await phase("__QA PAIRING RUN", code);
    const sheetRun = await stage(stageDrawings([{ ...SPEC_SHEET, itemCodeRaw: code }], fields, "__QA sheet.pdf", null));
    const sheet = await confirm(sheetRun, 1);
    expect(sheet.response.ok, JSON.stringify(sheet.body)).toBe(true);
    expect((await variantsOf(bill)).map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);

    const geometry = SPEC_SHEET.dimensions;
    const room = (page: number, names: { name: string; nameRaw: string }[], materials: typeof SPEC_SHEET.materials = []) => ({
      ...SHOP_DRAWING,
      itemCodeRaw: code,
      page,
      dimensions: geometry,
      materials,
      configurations: names.map((entry) => ({ ...entry, evidence: `title block reads ${entry.nameRaw}` })),
      depictsConfigurations: names.map((entry) => entry.name),
    });
    const setRun = await stage(
      stageDrawings(
        [
          room(1, [
            { name: "MUR 1", nameRaw: "MUR 1" },
            { name: "TYPO 5", nameRaw: "TYPO 5" },
          ]),
          room(2, [{ name: "MUR 2", nameRaw: "MUR 2" }], [
            { labelRaw: "FABRIC", valueRaw: "Maker Q, another cloth", materialCodeRaw: null, configurations: [] },
          ]),
          // The page's own words ARE the name: pairs with no question.
          room(3, [{ name: "Type 3", nameRaw: "Type 3" }]),
          // Read as "Type 4", but the page says TYPO 4: a translation, so asked.
          room(4, [{ name: "Type 4", nameRaw: "TYPO 4" }]),
        ],
        fields,
        "__QA drawing set.pdf",
        null,
        null,
        [{ itemCodes: [code], pages: [1, 2, 3, 4], relationship: "one_item", evidence: "one chair per room" }],
      ),
    );

    // Type 3: silent, onto TYPE 3, and its geometry is already recorded there.
    const typeThree = await confirm(setRun, 3);
    expect(typeThree.response.ok, JSON.stringify(typeThree.body)).toBe(true);
    expect((await variantsOf(bill)).length).toBe(5);

    // MUR 1, TYPO 5, MUR 2 and TYPO 4 ask — the app never decides MUR 2 is TYPE 2.
    for (const page of [1, 2, 4]) {
      const asked = await confirm(setRun, page);
      expect(asked.response.status).toBe(409);
      expect(((asked.body as { diff?: { code: string }[] }).diff ?? []).map((b) => b.code)).toContain("configuration_new");
    }
    const refusedFour = await confirm(setRun, 4);
    expect(JSON.stringify(refusedFour.body)).toContain("The page says TYPO 4 (read as TYPE 4)");
    expect((await variantsOf(bill)).length).toBe(5);

    // The reviewer pairs MUR 2 with TYPE 2, through the real PATCH.
    let two = (await liveDoc(setRun)).items.find((entry) => entry.page === 2)!;
    const paired = await importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: two.id,
          expectedVersion: two.version,
          changes: { configurationPairs: [{ recordId: bill, label: "MUR 2", pairWith: "TYPE 2" }] },
        }),
      }),
      { params: Promise.resolve({ id: setRun }) },
    );
    expect(paired.ok).toBe(true);

    // TYPE 2 already holds the sheet's cloth, and MUR 2's is different: the
    // replace acknowledgement, as for any revised drawing.
    const differs = await confirm(setRun, 2);
    expect(differs.response.status).toBe(409);
    expect(new Set(((differs.body as { diff?: { code: string }[] }).diff ?? []).map((b) => b.code))).toEqual(new Set(["slot_taken"]));

    two = (await liveDoc(setRun)).items.find((entry) => entry.page === 2)!;
    const fabric = two.observations.find((o) => o.valueRaw === "Maker Q, another cloth")!;
    const occupant = (
      await client.query(
        `select a.id, a.record_id, a.version from record_attributes a join spec_records r on r.id = a.record_id
          where r.parent_id = $1 and r.variant_label = 'TYPE 2' and a.spec_field_id = $2 and a.status = 'active'`,
        [bill, com(1)],
      )
    ).rows[0];
    const ticked = await importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: two.id,
          observationId: fabric.id,
          expectedVersion: fabric.version,
          changes: { replaces: [{ recordId: occupant.record_id, attributeId: occupant.id, attributeVersion: Number(occupant.version) }] },
        }),
      }),
      { params: Promise.resolve({ id: setRun }) },
    );
    expect(ticked.ok).toBe(true);
    const replaced = await confirm(setRun, 2);
    expect(replaced.response.ok, JSON.stringify(replaced.body)).toBe(true);

    // Still five records: MUR 2 IS TYPE 2, and TYPE 2 now carries its cloth,
    // with the sheet's kept under show retired.
    expect((await variantsOf(bill)).map((row) => row.variant_label)).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
    const typeTwoFabric = (
      await client.query(
        `select a.value, a.status from record_attributes a join spec_records r on r.id = a.record_id
          where r.parent_id = $1 and r.variant_label = 'TYPE 2' and a.spec_field_id = $2 order by a.status`,
        [bill, com(1)],
      )
    ).rows;
    expect(typeTwoFabric).toEqual([
      { value: "Maker Q, another cloth", status: "active" },
      { value: "Maker B, Ref. Y", status: "retired" },
    ]);
  });
});
