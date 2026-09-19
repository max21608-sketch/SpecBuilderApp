// Database tier — starting a project by hand: a run, an item, a spec, and the
// two free-text columns.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// What is worth testing here rather than in the pure tier: that a created
// record gets its checklist rows and a change set, that a typed attribute
// PROMOTES to the checklist exactly as a confirmed drawing does, and that the
// slot and field constraints refuse with a sentence rather than a constraint
// name. All four are facts about the database.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createAttribute, createRecord, createRun, editRecordDetails } from "@/lib/manual-capture";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("adding things by hand", () => {
  // Each case opens several transactions against a remote database, and the
  // 5s default times out on the round trips rather than on anything real.
  const SLOW = 40_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  let dimensionsFieldId = "";
  let comFieldId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00028', '__QA Manual capture', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    // An upholstery category, so the record gets a real checklist.
    const category = await client.query(
      `select id from item_categories where slug = 'armchairs-benches-stools-sofas'`,
    );
    categoryId = category.rows[0].id;
    dimensionsFieldId = (await client.query(`select id from spec_fields where json_id = 3`)).rows[0].id;
    comFieldId = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;
  });

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // NOT `delete from change_sets`: 0014 refuses that outright — "a change
    // cannot be deleted while its project exists" — and allows the cascade
    // instead. Deleting the project is the whole cleanup, and an explicit
    // delete here throws and leaves the fixture behind.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("creates a run with no bill behind it", async () => {
    const run = await withTransaction((txn) =>
      createRun(txn, { projectId, name: "__QA Hand run", actor: "qa" }),
    );
    const rows = await client.query(
      `select name, source_import_id, source_sheet, status from spec_runs where id = $1`,
      [run.runId],
    );
    expect(rows.rows[0]).toMatchObject({
      name: "__QA Hand run",
      source_import_id: null,
      source_sheet: null,
      status: "active",
    });
    const change = await client.query(`select kind from change_sets where id = $1`, [run.changeSetId]);
    expect(change.rows[0].kind).toBe("run_create");
  }, SLOW);

  it("creates an item, its checklist and its client ref, and guesses a level as a SUGGESTION", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R2", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, {
        projectId,
        runId: run.runId,
        itemDescription: "__QA Armchair with brass feet",
        clientRef: "__QA S-999",
        area: "Guest room",
        qty: 4,
        categoryId,
        actor: "qa",
      }),
    );
    expect(record.answersCreated).toBeGreaterThan(0);

    const row = await client.query(
      `select item_description, area, qty, category_id, level, level_suggested, level_suggested_reason,
              source_import_id
         from spec_records where id = $1`,
      [record.recordId],
    );
    // The guess is a SUGGESTION and the decision is still nobody's — 0019's
    // rule does not bend for the way the item arrived.
    expect(row.rows[0].level).toBeNull();
    expect(row.rows[0].level_suggested).toBe("complex");
    expect(String(row.rows[0].level_suggested_reason)).toMatch(/brass/i);
    expect(row.rows[0].source_import_id).toBeNull();
    expect(Number(row.rows[0].qty)).toBe(4);

    const refs = await client.query(`select ref_system, ref_value, source from spec_record_refs where record_id = $1`, [
      record.recordId,
    ]);
    expect(refs.rows[0]).toMatchObject({ ref_system: "boq_code", ref_value: "__QA S-999", source: "Typed by hand" });

    const version = await client.query(
      `select snapshot_no from record_snapshots where record_id = $1 order by snapshot_no`,
      [record.recordId],
    );
    expect(version.rows.map((r) => Number(r.snapshot_no))).toEqual([1]);
  }, SLOW);

  it("refuses an item on a run belonging to another project", async () => {
    const other = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00028b', '__QA Other', 'qa', 'qa') returning id`,
    );
    const otherRun = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA elsewhere', 'qa', 'qa') returning id`,
      [other.rows[0].id],
    );
    await expect(
      withTransaction((txn) =>
        createRecord(txn, {
          projectId,
          runId: otherRun.rows[0].id,
          itemDescription: "__QA Stray",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/not on this project/);
    await client.query(`delete from spec_runs where project_id = $1`, [other.rows[0].id]);
    await client.query(`delete from projects where id = $1`, [other.rows[0].id]);
  }, SLOW);

  it("a typed dimension PROMOTES to the checklist, exactly as a confirmed drawing does", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R3", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId: run.runId, itemDescription: "__QA Sofa", categoryId, actor: "qa" }),
    );

    for (const [slot, value] of [["W", "1900"], ["D", "790"], ["H", "720"]] as const) {
      await withTransaction((txn) =>
        createAttribute(txn, {
          recordId: record.recordId,
          attrGroup: "dimension",
          label: slot,
          value,
          unit: "mm",
          dimensionSlot: slot,
          state: "confirmed",
          actor: "qa",
        }),
      );
    }

    const answer = await client.query(
      `select a.value, a.state, a.source_kind from spec_answers a
        where a.record_id = $1 and a.spec_field_id = $2 and a.revision_no = 0`,
      [record.recordId, dimensionsFieldId],
    );
    // The WHOLE record is recomposed, not the last row: the cell has to carry
    // the width and depth an earlier write confirmed.
    expect(answer.rows[0].value).toBe("W1900 x D790 x H720mm");
    expect(answer.rows[0].state).toBe("confirmed");

    const attrs = await client.query(
      `select source_run_id, source_page from record_attributes where record_id = $1 and status = 'active'`,
      [record.recordId],
    );
    // No document, no page. That is the truth about a typed value.
    for (const row of attrs.rows) {
      expect(row.source_run_id).toBeNull();
      expect(row.source_page).toBeNull();
    }
  }, SLOW);

  it("refuses a second value for an occupied slot and an occupied BWS field, NAMING what is there", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R4", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId: run.runId, itemDescription: "__QA Bench", categoryId, actor: "qa" }),
    );
    await withTransaction((txn) =>
      createAttribute(txn, {
        recordId: record.recordId,
        attrGroup: "dimension",
        label: "Width",
        value: "500",
        unit: "mm",
        dimensionSlot: "W",
        state: "confirmed",
        actor: "qa",
      }),
    );
    await expect(
      withTransaction((txn) =>
        createAttribute(txn, {
          recordId: record.recordId,
          attrGroup: "dimension",
          label: "Width again",
          value: "600",
          unit: "mm",
          dimensionSlot: "W",
          state: "confirmed",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/already has a W of “500”/);

    await withTransaction((txn) =>
      createAttribute(txn, {
        recordId: record.recordId,
        attrGroup: "finish",
        label: "COM 1",
        value: "__QA Mohair",
        specFieldId: comFieldId,
        state: "confirmed",
        actor: "qa",
      }),
    );
    await expect(
      withTransaction((txn) =>
        createAttribute(txn, {
          recordId: record.recordId,
          attrGroup: "finish",
          label: "COM 1 again",
          value: "__QA Velvet",
          specFieldId: comFieldId,
          state: "confirmed",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/already holds “__QA Mohair”/);
  }, SLOW);

  it("refuses a dimension with no slot, and a unit on anything else", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R5", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId: run.runId, itemDescription: "__QA Stool", actor: "qa" }),
    );
    await expect(
      withTransaction((txn) =>
        createAttribute(txn, {
          recordId: record.recordId,
          attrGroup: "dimension",
          label: "Arm height",
          value: "520",
          state: "confirmed",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/W, D, H, SH or Dia/);

    await expect(
      withTransaction((txn) =>
        createAttribute(txn, {
          recordId: record.recordId,
          attrGroup: "note",
          label: "Remark",
          value: "something",
          unit: "mm",
          state: "confirmed",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/Only a dimension carries a unit/);
  }, SLOW);

  it("edits the bill's own words and both free-text columns, and records nothing for a no-op", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R6", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId: run.runId, itemDescription: "__QA Chiar", actor: "qa" }),
    );
    const before = await client.query(`select version from spec_records where id = $1`, [record.recordId]);

    const edited = await withTransaction((txn) =>
      editRecordDetails(txn, {
        recordId: record.recordId,
        patch: {
          itemDescription: "__QA Chair",
          specDescription: "Curved back, recessed plinth",
          internalNotes: "__QA previous price 9,200",
        },
        expectedVersion: Number(before.rows[0].version),
        actor: "qa",
      }),
    );
    expect(edited.changed.sort()).toEqual(["internal_notes", "item_description", "spec_description"]);

    const row = await client.query(
      `select item_description, spec_description, internal_notes, version from spec_records where id = $1`,
      [record.recordId],
    );
    expect(row.rows[0].item_description).toBe("__QA Chair");
    expect(row.rows[0].spec_description).toBe("Curved back, recessed plinth");
    expect(row.rows[0].internal_notes).toBe("__QA previous price 9,200");

    // A no-op writes nothing and records no change: a history full of entries
    // that changed nothing is how the trail stops being read.
    const noop = await withTransaction((txn) =>
      editRecordDetails(txn, {
        recordId: record.recordId,
        patch: { itemDescription: "__QA Chair" },
        expectedVersion: Number(row.rows[0].version),
        actor: "qa",
      }),
    );
    expect(noop.changed).toEqual([]);
    const after = await client.query(`select version from spec_records where id = $1`, [record.recordId]);
    expect(Number(after.rows[0].version)).toBe(Number(row.rows[0].version));
  }, SLOW);

  it("refuses a stale version rather than overwriting somebody's edit", async () => {
    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA R7", actor: "qa" }));
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId: run.runId, itemDescription: "__QA Table", actor: "qa" }),
    );
    await expect(
      withTransaction((txn) =>
        editRecordDetails(txn, {
          recordId: record.recordId,
          patch: { itemDescription: "__QA Something else" },
          expectedVersion: 999,
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/changed this item while you had it open/);
  }, SLOW);
});
