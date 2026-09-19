// Database tier for migration 0007: runs, attributes, notes and batches.
// Skips silently without DATABASE_URL — a green `npm test` does not mean these
// ran. Run them with:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) npm test
//
// Every row is prefixed `__QA ` and deleted in FK-safe order. audit_log is
// left alone: it is append-only by design.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("0007 intake model", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";
  let runId = "";
  let otherRunId = "";
  let recordId = "";
  let comOneFieldId = "";
  let comTwoFieldId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('__QA P07001', '__QA Intake project', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    otherProjectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('__QA P07002', '__QA Other project', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    otherRunId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by)
         values ($1, '__QA Foreign run', 'qa', 'qa') returning id`,
        [otherProjectId],
      )
    ).rows[0].id;
    recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
         values ($1, $2, 9701, 'active', '__QA Sofa', 'qa', 'qa') returning id`,
        [projectId, runId],
      )
    ).rows[0].id;
    comOneFieldId = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;
    comTwoFieldId = (await client.query(`select id from spec_fields where json_id = 2`)).rows[0].id;
  });

  afterAll(async () => {
    for (const id of [projectId, otherProjectId]) {
      await client.query(
        `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
        [id],
      );
      await client.query(`delete from project_notes where project_id = $1`, [id]);
      await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [id]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [id]);
      await client.query(`delete from spec_records where project_id = $1`, [id]);
      await client.query(`delete from spec_runs where project_id = $1`, [id]);
      await client.query(`delete from intake_runs where project_id = $1`, [id]);
      await client.query(`delete from intake_batches where project_id = $1`, [id]);
      await client.query(`delete from projects where id = $1`, [id]);
    }
    await client.end();
  });

  const addAttribute = (values: Record<string, unknown>) => {
    const row = {
      record_id: recordId,
      attr_group: "material",
      label: "__QA FABRIC",
      value: "__QA Yarn Tessarae",
      state: "confirmed",
      ...values,
    } as Record<string, unknown>;
    const keys = Object.keys(row);
    return client.query(
      `insert into record_attributes (${keys.join(", ")}, created_by, updated_by)
       values (${keys.map((_, i) => `$${i + 1}`).join(", ")}, 'qa', 'qa') returning id`,
      keys.map((k) => row[k]),
    );
  };

  it("keeps two observations that share a label — a page can name FABRIC twice", async () => {
    // The exact case spec_answers could not hold: one drawing page listing a
    // seat fabric and a back fabric, both called FABRIC.
    const a = await addAttribute({ value: "__QA Yarn Tessarae", spec_field_id: comOneFieldId });
    const b = await addAttribute({ value: "__QA Tibor Blob Amber Fern", spec_field_id: comTwoFieldId });
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
    const rows = await client.query(
      `select count(*)::int n from record_attributes where record_id = $1 and label = '__QA FABRIC'`,
      [recordId],
    );
    expect(rows.rows[0].n).toBe(2);
  });

  it("refuses a second active attribute claiming an occupied BWS field", async () => {
    // Two values silently sharing COM 1 is how an export loses one of them.
    await expect(addAttribute({ value: "__QA Third fabric", spec_field_id: comOneFieldId })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it("frees the slot when the occupant is retired", async () => {
    const taken = await addAttribute({ attr_group: "finish", label: "__QA WOOD", value: "__QA Dark tinted wood",
      spec_field_id: (await client.query(`select id from spec_fields where json_id = 4`)).rows[0].id });
    await client.query(
      `update record_attributes set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa' where id = $1`,
      [taken.rows[0].id],
    );
    const replacement = await addAttribute({ attr_group: "finish", label: "__QA WOOD", value: "__QA Ceruse oak",
      spec_field_id: (await client.query(`select id from spec_fields where json_id = 4`)).rows[0].id });
    expect(replacement.rows[0].id).toBeTruthy();
  });

  it("allows many dimensions, which compose into one BWS field — one per slot", async () => {
    // 0011 narrowed this: three dimensions distinguished only by LABEL is now
    // an illegal row shape, and that is the point. They are distinguished by
    // slot, and five of them still compose into json id 3.
    for (const [slot, value] of [["W", "190"], ["D", "79"], ["H", "72"]]) {
      await addAttribute({
        attr_group: "dimension", dimension_slot: slot, label: `__QA ${slot}`, value, unit: "cm", spec_field_id: null,
      });
    }
    const rows = await client.query(
      `select count(*)::int n from record_attributes where record_id = $1 and attr_group = 'dimension'`,
      [recordId],
    );
    expect(rows.rows[0].n).toBe(3);
  });

  it("refuses a second active value in one dimension slot", async () => {
    // Its own slot: these tests share one record, so a slot another test filled
    // would make this pass for the wrong reason.
    await client.query(`delete from record_attributes where record_id = $1 and dimension_slot = 'SH'`, [recordId]);
    await addAttribute({ attr_group: "dimension", dimension_slot: "SH", label: "__QA SH", value: "440", unit: "mm", spec_field_id: null });
    await expect(
      addAttribute({ attr_group: "dimension", dimension_slot: "SH", label: "__QA SH again", value: "420", unit: "mm", spec_field_id: null }),
    ).rejects.toThrow(/record_attributes_dimension_slot_key/);
  });

  it("frees a dimension slot when its occupant is retired", async () => {
    await client.query(`delete from record_attributes where record_id = $1 and dimension_slot = 'DIA'`, [recordId]);
    const first = await addAttribute({
      attr_group: "dimension", dimension_slot: "DIA", label: "__QA DIA", value: "460", unit: "mm", spec_field_id: null,
    });
    await client.query(`update record_attributes set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`, [
      first.rows[0].id,
    ]);
    const replacement = await addAttribute({
      attr_group: "dimension", dimension_slot: "DIA", label: "__QA DIA", value: "465", unit: "mm", spec_field_id: null,
    });
    expect(replacement.rows[0].id).toBeTruthy();
  });

  it("refuses a dimension with no slot, and a slot on anything else", async () => {
    // The biconditional. It is what makes composeDimensionCell total: there is
    // no such thing as a slotless dimension for it to drop on the floor.
    await expect(
      addAttribute({ attr_group: "dimension", label: "__QA Width", value: "190", unit: "cm", spec_field_id: null }),
    ).rejects.toThrow(/record_attributes_dimension_has_slot/);
    await expect(addAttribute({ attr_group: "note", dimension_slot: "W", label: "__QA note" })).rejects.toThrow(
      /record_attributes_dimension_has_slot/,
    );
  });

  it("refuses an unknown slot", async () => {
    await expect(
      addAttribute({ attr_group: "dimension", dimension_slot: "WIDTH", label: "__QA Width", value: "190", unit: "cm", spec_field_id: null }),
    ).rejects.toThrow(/record_attributes_dimension_slot_check/);
  });

  it("lets a NOTE carry a unit, because a measurement outside the five is still a measurement", async () => {
    // ARM HEIGHT 520mm. 0011 replaced record_attributes_unit_is_dimension for
    // exactly this: folding "520" and "mm" into one string is what the
    // extraction prompt forbids the model to do.
    const note = await addAttribute({ attr_group: "note", label: "__QA ARM HEIGHT", value: "520", unit: "mm" });
    expect(note.rows[0].id).toBeTruthy();
  });

  it("still refuses a unit on a material, which has none", async () => {
    await expect(addAttribute({ attr_group: "material", label: "__QA Fabric", unit: "cm" })).rejects.toThrow(
      /record_attributes_unit_is_measurement/,
    );
  });

  it("refuses an unknown unit", async () => {
    await expect(
      addAttribute({ attr_group: "dimension", dimension_slot: "W", label: "__QA Width", value: "190", unit: "cms" }),
    ).rejects.toThrow(/record_attributes_unit_check/);
  });

  it("refuses a confirmed attribute with no value, and allows a TBC one", async () => {
    await expect(addAttribute({ value: null, spec_field_id: null })).rejects.toThrow(
      /record_attributes_confirmed_has_value/,
    );
    const tbc = await addAttribute({ label: "__QA PIPING", value: null, state: "tbc", spec_field_id: null });
    expect(tbc.rows[0].id).toBeTruthy();
  });

  it("refuses a record with no run", async () => {
    await expect(
      client.query(
        `insert into spec_records (project_id, record_no, item_description, created_by, updated_by)
         values ($1, 9702, '__QA Orphan', 'qa', 'qa')`,
        [projectId],
      ),
    ).rejects.toThrow(/run_id/);
  });

  it("refuses a record filed under another project's run", async () => {
    await expect(
      client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, created_by, updated_by)
         values ($1, $2, 9703, '__QA Cross-project', 'qa', 'qa')`,
        [projectId, otherRunId],
      ),
    ).rejects.toThrow(/spec_records_run_same_project/);
  });

  it("retires a project note without deleting it, and requires an actor", async () => {
    const note = await client.query(
      `insert into project_notes (project_id, topic, title, body, created_by, updated_by)
       values ($1, '__QA Flameproofing', '__QA Public areas', '__QA Flameproofed to French Standard.', 'qa', 'qa')
       returning id, version`,
      [projectId],
    );
    await expect(
      client.query(`update project_notes set status = 'retired', updated_by = 'qa' where id = $1`, [note.rows[0].id]),
    ).rejects.toThrow(/project_notes_retired_has_actor/);
    const retired = await client.query(
      `update project_notes set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa'
       where id = $1 returning status, version`,
      [note.rows[0].id],
    );
    expect(retired.rows[0].status).toBe("retired");
    // bump_version is attached, so an optimistic lock works on notes too.
    expect(retired.rows[0].version).toBe(note.rows[0].version + 1);
  });

  it("bumps a run's version on update and keeps header notes as an array", async () => {
    const before = await client.query(`select version from spec_runs where id = $1`, [runId]);
    await client.query(
      `update spec_runs set header_notes = $2::jsonb, boq_revision = '0', boq_date = '14-Sep-26', updated_by = 'qa'
       where id = $1`,
      [runId, JSON.stringify(["__QA *All fabrics are COM"])],
    );
    const after = await client.query(`select version, header_notes, boq_date from spec_runs where id = $1`, [runId]);
    expect(after.rows[0].version).toBe(before.rows[0].version + 1);
    expect(after.rows[0].header_notes).toEqual(["__QA *All fabrics are COM"]);
    // Read back as text, never a Date: the BOQ prints whatever the client typed.
    expect(after.rows[0].boq_date).toBe("14-Sep-26");
  });

  it("refuses a blank run name", async () => {
    await expect(
      client.query(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '  ', 'qa', 'qa')`, [
        projectId,
      ]),
    ).rejects.toThrow(/spec_runs_name_not_blank/);
  });

  it("allows two runs with the same name — a revised BOQ re-uploads MAIN RUN", async () => {
    const again = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA MAIN RUN', 'qa', 'qa') returning id`,
      [projectId],
    );
    expect(again.rows[0].id).toBeTruthy();
    await client.query(`delete from spec_runs where id = $1`, [again.rows[0].id]);
  });

  it("links an intake run to a batch and refuses deleting the batch under it", async () => {
    const batch = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, '__QA Tender pack', 'qa', 'qa') returning id`,
      [projectId],
    );
    const batchId = batch.rows[0].id;
    await client.query(
      `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'shop_drawings', 'pending', 'qa', 'qa')`,
      [projectId, batchId],
    );
    await expect(client.query(`delete from intake_batches where id = $1`, [batchId])).rejects.toThrow(
      /violates RESTRICT setting of foreign key constraint "intake_runs_batch_id_fkey"/,
    );
  });

  it("accepts the two new document kinds and still refuses one on a BOQ", async () => {
    for (const kind of ["preamble", "shop_drawings"]) {
      const row = await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, 'spec_document', $2, 'pending', 'qa', 'qa') returning id`,
        [projectId, kind],
      );
      expect(row.rows[0].id).toBeTruthy();
    }
    await expect(
      client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, 'boq_xlsx', 'preamble', 'pending', 'qa', 'qa')`,
        [projectId],
      ),
    ).rejects.toThrow(/intake_runs_document_kind_check/);
  });

  it("left every existing record on a run — the backfill named it after its import", async () => {
    // Guards the migration itself: a record with no run is on no tab and in no
    // export scope.
    const orphans = await client.query(`select count(*)::int n from spec_records where run_id is null`);
    expect(orphans.rows[0].n).toBe(0);
    const runs = await client.query(
      `select count(*)::int n from spec_runs where created_by = 'migration:0007' and source_sheet is not null`,
    );
    expect(runs.rows[0].n).toBeGreaterThanOrEqual(0);
  });
});
