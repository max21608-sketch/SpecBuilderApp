// Database tier — a bill line's configurations numbered under it (0039), and
// an edit to what they have in common fanned out to every one of them.
//
// What it holds, because each lives in SQL and not in the pure reading:
//  - configurations are numbered 1, 2, 3 under their line; a retired one keeps
//    its number and the next is the one after it, never a reused one; a fixture inserting one
//    directly is numbered by the same trigger;
//  - a version carries the new label, `P…-001.2`;
//  - a common correction writes EVERY configuration in ONE change set with one
//    version each, supersedes each old row, and leaves spec_records.version
//    alone;
//  - a stale `seen` version is refused and writes nothing;
//  - a row that stopped being common is refused and writes nothing;
//  - a configuration added since the screen loaded is refused;
//  - retire fans out and recomposes the Dimensions answer on each;
//  - add and a common checklist answer each fan out as one change.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { sql } from "@/lib/db";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { insertVariant } from "@/lib/variant-create";
import { correctAttribute } from "@/lib/attribute-correct";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { loadRecordAtoms } from "@/lib/record-atoms";
import { editCommonSpec, loadConfigurationFamily } from "@/lib/configuration-family";
import { readCommonAnswers, readCommonSpecs, seenRows } from "@/lib/configuration-common";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("configurations numbered under their line, and a common edit", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let projectNumber = "";
  let runId = "";
  let lineId = "";
  let categoryId = "";
  let comFieldId = "";
  const configurationIds: string[] = [];

  async function changeSetCount(): Promise<number> {
    const rows = await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId]);
    return rows.rows[0].n;
  }

  async function family() {
    const loaded = await loadConfigurationFamily(sql, lineId);
    if (!loaded) throw new Error("no family");
    return loaded;
  }

  beforeAll(async () => {
    await client.connect();
    projectNumber = qaNumber("P00039");
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA Common specs', 'qa', 'qa') returning id`,
      [projectNumber],
    );
    projectId = project.rows[0].id;
    categoryId = (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)).rows[0].id;
    comFieldId = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;

    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    lineId = (
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId, itemDescription: "Desk chair", clientRef: "S-301", qty: 45, categoryId, actor: "qa" }),
      )
    ).recordId;

    for (const label of ["TYPE 1", "TYPE 2", "TYPE 3"]) {
      const made = await withTransaction((txn) =>
        insertVariant(txn, { parentId: lineId, label, splitReason: "configuration", dimensionNote: null, actor: "qa" }),
      );
      configurationIds.push(made.recordId);
    }

    // What a drawing confirm leaves on each: the same width and seat height,
    // and a different cloth.
    for (const [index, recordId] of configurationIds.entries()) {
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state, sort_order, created_by, updated_by)
         values ($1, 'dimension', 'Width', '600', 'mm', 'W', 'confirmed', 1, 'qa', 'qa'),
                ($1, 'dimension', 'Seat height', '440', 'mm', 'SH', 'confirmed', 2, 'qa', 'qa')`,
        [recordId],
      );
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, sort_order, created_by, updated_by)
         values ($1, 'material', 'SEAT', $2, $3, 'confirmed', 3, 'qa', 'qa')`,
        [recordId, `Cloth ${index + 1}`, comFieldId],
      );
      await withTransaction((txn) => recomposeAnswers(txn, recordId, null, "qa"));
    }
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("numbers configurations 1, 2, 3 under their line and names them by it", async () => {
    const rows = await client.query(
      `select id, variant_ordinal from spec_records where parent_id = $1 order by variant_ordinal`,
      [lineId],
    );
    expect(rows.rows.map((row) => row.id)).toEqual(configurationIds);
    expect(rows.rows.map((row) => row.variant_ordinal)).toEqual([1, 2, 3]);

    const line = await client.query(`select record_no from spec_records where id = $1`, [lineId]);
    const lineNo = String(line.rows[0].record_no).padStart(3, "0");
    const atoms = await loadRecordAtoms(sql, [configurationIds[1]!]);
    expect(atoms.get(configurationIds[1]!)?.record.label).toBe(`${projectNumber}-${lineNo}.2`);
  }, SLOW);

  it("never reuses a retired configuration's number, and numbers a direct insert too", async () => {
    // A separate line, so the retire does not disturb the common tests.
    const other = (
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId, itemDescription: "Stool", clientRef: "S-400", qty: 4, categoryId, actor: "qa" }),
      )
    ).recordId;
    const a = await withTransaction((txn) =>
      insertVariant(txn, { parentId: other, label: "A", splitReason: "fabric", dimensionNote: null, actor: "qa" }),
    );
    const b = await withTransaction((txn) =>
      insertVariant(txn, { parentId: other, label: "B", splitReason: "fabric", dimensionNote: null, actor: "qa" }),
    );
    expect([a.variantOrdinal, b.variantOrdinal]).toEqual([1, 2]);
    await client.query(`update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa' where id = $1`, [b.recordId]);
    const c = await withTransaction((txn) =>
      insertVariant(txn, { parentId: other, label: "C", splitReason: "fabric", dimensionNote: null, actor: "qa" }),
    );
    expect(c.variantOrdinal).toBe(3);

    const maxNo = await client.query(`select max(record_no) as n from spec_records where project_id = $1`, [projectId]);
    const direct = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, parent_id, depth, split_reason, variant_label, created_by, updated_by)
       values ($1, $2, $3, 'Stool', $4, 1, 'fabric', 'D', 'qa', 'qa') returning variant_ordinal`,
      [projectId, runId, Number(maxNo.rows[0].n) + 1, other],
    );
    expect(direct.rows[0].variant_ordinal).toBe(4);
  }, SLOW);

  it("refuses a common edit whose seen version is stale, and writes nothing", async () => {
    const loaded = await family();
    const group = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === "slot:SH")!;
    expect(group.status).toBe("common");
    const stale = seenRows(group).map((row, index) => (index === 1 ? { ...row, version: row.version + 1 } : row));
    const before = await changeSetCount();
    await expect(
      withTransaction((txn) =>
        editCommonSpec(txn, {
          lineId,
          actor: "qa",
          edit: {
            op: "correct",
            groupKey: group.key,
            value: "450",
            unit: "mm",
            state: "confirmed",
            reason: "__QA stale",
            configurations: configurationIds,
            seen: stale,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "seen_version_stale", status: 409 });
    expect(await changeSetCount()).toBe(before);
    const values = await client.query(
      `select value from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'SH' and status = 'active'`,
      [configurationIds],
    );
    expect(values.rows.map((row) => row.value)).toEqual(["440", "440", "440"]);
  }, SLOW);

  it("refuses an edit to a row that differs", async () => {
    const loaded = await family();
    const com = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === `field:${comFieldId}`)!;
    expect(com.status).toBe("differs");
    await expect(
      withTransaction((txn) =>
        editCommonSpec(txn, {
          lineId,
          actor: "qa",
          edit: {
            op: "correct",
            groupKey: com.key,
            value: "Velvet",
            unit: null,
            state: "confirmed",
            reason: "__QA",
            configurations: configurationIds,
            seen: seenRows(com),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "not_common" });
  }, SLOW);

  it("refuses when the set of configurations is not the one the screen showed", async () => {
    const loaded = await family();
    const group = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === "slot:SH")!;
    await expect(
      withTransaction((txn) =>
        editCommonSpec(txn, {
          lineId,
          actor: "qa",
          edit: {
            op: "correct",
            groupKey: group.key,
            value: "450",
            unit: "mm",
            state: "confirmed",
            reason: "__QA",
            configurations: configurationIds.slice(0, 2),
            seen: seenRows(group),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "configurations_changed" });
  }, SLOW);

  it("writes a common correction to every configuration in ONE change set, one version each", async () => {
    const versionsBefore = await client.query(
      `select id, version from spec_records where id = any($1::uuid[]) order by id`,
      [configurationIds],
    );
    const loaded = await family();
    const group = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === "slot:SH")!;
    const oldIds = seenRows(group).map((row) => row.attributeId);

    const result = await withTransaction((txn) =>
      editCommonSpec(txn, {
        lineId,
        actor: "qa",
        edit: {
          op: "correct",
          groupKey: group.key,
          value: "450",
          unit: "mm",
          state: "confirmed",
          reason: "__QA seat height re-measured",
          configurations: configurationIds,
          seen: seenRows(group),
        },
      }),
    );

    expect(result.written.map((row) => row.recordId)).toEqual(configurationIds);
    expect(result.written.every((row) => typeof row.snapshotNo === "number")).toBe(true);
    const change = await client.query(`select kind, reason from change_sets where id = $1`, [result.changeSetId]);
    expect(change.rows[0]).toMatchObject({ kind: "attribute_correct", reason: "__QA seat height re-measured" });
    const snapshots = await client.query(
      `select record_id from record_snapshots where change_set_id = $1 order by record_id`,
      [result.changeSetId],
    );
    expect(snapshots.rows.map((row) => row.record_id)).toEqual([...configurationIds].sort());

    const live = await client.query(
      `select value from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'SH' and status = 'active'`,
      [configurationIds],
    );
    expect(live.rows.map((row) => row.value)).toEqual(["450", "450", "450"]);
    const old = await client.query(
      `select status, superseded_by_id from record_attributes where id = any($1::uuid[])`,
      [oldIds],
    );
    expect(old.rows.every((row) => row.status === "retired" && row.superseded_by_id)).toBe(true);

    // Recording that something happened never bumps the record.
    const versionsAfter = await client.query(
      `select id, version from spec_records where id = any($1::uuid[]) order by id`,
      [configurationIds],
    );
    expect(versionsAfter.rows).toEqual(versionsBefore.rows);

    // The checklist's Dimensions cell was recomposed on each.
    const dims = await client.query(
      `select a.value from spec_answers a join spec_fields f on f.id = a.spec_field_id
        where a.record_id = any($1::uuid[]) and f.json_id = 3`,
      [configurationIds],
    );
    expect(dims.rows.length).toBe(3);
    expect(dims.rows.every((row) => String(row.value).includes("SH450"))).toBe(true);
  }, SLOW);

  it("refuses a row that stopped being common after the screen loaded", async () => {
    const loaded = await family();
    const group = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === "slot:W")!;
    expect(group.status).toBe("common");
    const seen = seenRows(group);

    // Somebody corrects 12.3's width on its own screen, deliberately.
    const third = group.members[2]!.rows[0]!;
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: third.id,
        expectedVersion: third.version,
        value: "620",
        unit: "mm",
        state: "confirmed",
        reason: "__QA TYPE 3 is wider",
        actor: "qa",
      }),
    );

    const before = await changeSetCount();
    await expect(
      withTransaction((txn) =>
        editCommonSpec(txn, {
          lineId,
          actor: "qa",
          edit: {
            op: "correct",
            groupKey: group.key,
            value: "610",
            unit: "mm",
            state: "confirmed",
            reason: "__QA",
            configurations: configurationIds,
            seen,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "not_common" });
    expect(await changeSetCount()).toBe(before);
    const widths = await client.query(
      `select value from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'W' and status = 'active' order by value`,
      [configurationIds],
    );
    expect(widths.rows.map((row) => row.value)).toEqual(["600", "600", "620"]);
  }, SLOW);

  it("adds a spec to every configuration as one change", async () => {
    const loaded = await family();
    const result = await withTransaction((txn) =>
      editCommonSpec(txn, {
        lineId,
        actor: "qa",
        edit: {
          op: "add",
          attrGroup: "dimension",
          label: "Height",
          value: "780",
          unit: "mm",
          dimensionSlot: "H",
          state: "confirmed",
          seen: loaded.configurations.map((configuration) => ({ recordId: configuration.recordId, version: configuration.version })),
        },
      }),
    );
    const rows = await client.query(
      `select count(*)::int as n from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'H' and status = 'active'`,
      [configurationIds],
    );
    expect(rows.rows[0].n).toBe(3);
    const snapshots = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [result.changeSetId]);
    expect(snapshots.rows[0].n).toBe(3);

    // Adding it again is refused: it is already there.
    const again = await family();
    await expect(
      withTransaction((txn) =>
        editCommonSpec(txn, {
          lineId,
          actor: "qa",
          edit: {
            op: "add",
            attrGroup: "dimension",
            label: "Height",
            value: "790",
            unit: "mm",
            dimensionSlot: "H",
            state: "confirmed",
            seen: again.configurations.map((configuration) => ({ recordId: configuration.recordId, version: configuration.version })),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "already_there" });
  }, SLOW);

  it("retires a common row on every configuration and recomposes each Dimensions answer", async () => {
    const loaded = await family();
    const group = readCommonSpecs(loaded.configurations).groups.find((entry) => entry.key === "slot:H")!;
    expect(group.status).toBe("common");
    const result = await withTransaction((txn) =>
      editCommonSpec(txn, {
        lineId,
        actor: "qa",
        edit: {
          op: "retire",
          groupKey: group.key,
          reason: "__QA height was the back, not the overall",
          configurations: configurationIds,
          seen: seenRows(group),
        },
      }),
    );
    const change = await client.query(`select kind from change_sets where id = $1`, [result.changeSetId]);
    expect(change.rows[0].kind).toBe("attribute_retire");
    const live = await client.query(
      `select count(*)::int as n from record_attributes where record_id = any($1::uuid[]) and dimension_slot = 'H' and status = 'active'`,
      [configurationIds],
    );
    expect(live.rows[0].n).toBe(0);
    const dims = await client.query(
      `select a.value from spec_answers a join spec_fields f on f.id = a.spec_field_id
        where a.record_id = any($1::uuid[]) and f.json_id = 3`,
      [configurationIds],
    );
    expect(dims.rows.every((row) => !String(row.value).includes("H780"))).toBe(true);
    const snapshots = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [result.changeSetId]);
    expect(snapshots.rows[0].n).toBe(3);
  }, SLOW);

  it("answers a question missing on every configuration once, for all of them", async () => {
    const loaded = await family();
    const group = readCommonAnswers(loaded.configurations).find(
      (entry) => entry.status === "common" && entry.shared?.state === "missing" && entry.jsonId !== 3,
    )!;
    expect(group).toBeTruthy();
    const result = await withTransaction((txn) =>
      editCommonSpec(txn, {
        lineId,
        actor: "qa",
        edit: {
          op: "answer",
          requirementId: group.requirementId,
          value: "__QA Lift to level 3",
          state: "confirmed",
          configurations: configurationIds,
          seen: group.members.map((member) => ({ answerId: member.answer!.answerId!, version: member.answer!.version! })),
        },
      }),
    );
    const answers = await client.query(
      `select value, state from spec_answers where record_id = any($1::uuid[]) and requirement_id = $2`,
      [configurationIds, group.requirementId],
    );
    expect(answers.rows).toHaveLength(3);
    expect(answers.rows.every((row) => row.state === "confirmed" && row.value === "__QA Lift to level 3")).toBe(true);
    const snapshots = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [result.changeSetId]);
    expect(snapshots.rows[0].n).toBe(3);
  }, SLOW);
});
