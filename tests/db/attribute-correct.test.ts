// Database tier — correcting a spec, keeping the page it was read from.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/attribute-correct.test.ts
//
// ============================================================================
// WHAT IS WORTH TESTING HERE RATHER THAN IN THE PURE TIER.
//
// Every one of these is a fact about the DATABASE, not about a function:
//
//   * the new row keeps `source_run_id` and `source_page` — and keeps their
//     NULLs on a hand-typed spec, rather than inventing a page
//   * the old row is retired and points at the new one, which is the only order
//     the two partial unique indexes and 0016's own check allow
//   * `spec_records.version` does not move, because an attribute is its own row
//     and bumping the record invalidates every extraction snapshot taken
//     against it
//   * the checklist RECOMPOSES — a unit correction changes no value and every
//     composed cell on the record, which is the case a value-diffing test would
//     miss entirely
//   * ONE change set and ONE version per correction, which is what the
//     whole-database coverage assertion in change-history.test.ts reads
//   * a reason is refused by the constraint 0033 put behind it, not merely by
//     the route's zod
//
// Rows are prefixed `__QA ` and deleted FK-safe by deleting the project: 0014
// refuses a direct `delete from change_sets` outright and allows the cascade.
// ============================================================================
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { correctAttribute } from "@/lib/attribute-correct";
import { createAttribute, createRecord, createRun } from "@/lib/manual-capture";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("correcting a spec", () => {
  // Each case opens several transactions against a remote database.
  const SLOW = 40_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let intakeRunId = "";
  let comFieldId = "";

  /** A fresh item, so no case can be affected by what another one wrote. */
  async function item(description: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, {
        projectId,
        runId,
        itemDescription: description,
        categoryId,
        actor: "qa",
      }),
    );
    return record.recordId;
  }

  /**
   * A spec a DOCUMENT said, written directly: `createAttribute` is the
   * hand-typed path and deliberately records no source, and the point of half
   * of this file is what happens to a row that HAS one.
   */
  async function documentSpec(
    recordId: string,
    over: {
      attrGroup?: string;
      label?: string;
      value?: string | null;
      unit?: string | null;
      dimensionSlot?: string | null;
      specFieldId?: string | null;
      materialCode?: string | null;
      finishId?: string | null;
      state?: string;
    } = {},
  ): Promise<{ id: string; version: number }> {
    const rows = await client.query(
      `insert into record_attributes
         (record_id, attr_group, label, value, unit, dimension_slot, spec_field_id,
          material_code, finish_id, state, source_run_id, source_page, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 4, 'qa', 'qa')
       returning id, version`,
      [
        recordId,
        over.attrGroup ?? "dimension",
        over.label ?? "Width",
        over.value === undefined ? "190" : over.value,
        over.unit === undefined ? "cm" : over.unit,
        over.dimensionSlot === undefined ? "W" : over.dimensionSlot,
        over.specFieldId ?? null,
        over.materialCode ?? null,
        over.finishId ?? null,
        over.state ?? "confirmed",
        intakeRunId,
      ],
    );
    return { id: rows.rows[0].id, version: Number(rows.rows[0].version) };
  }

  async function dimensionsAnswer(recordId: string): Promise<{ value: string | null; state: string } | null> {
    const rows = await client.query(
      `select a.value, a.state
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = 3 and a.revision_no = 0`,
      [recordId],
    );
    return rows.rows[0] ? { value: rows.rows[0].value, state: String(rows.rows[0].state) } : null;
  }

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00033', '__QA Correcting a spec', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    comFieldId = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;
    const run = await withTransaction((txn) =>
      createRun(txn, { projectId, name: "__QA MAIN", actor: "qa" }),
    );
    runId = run.runId;
    const intake = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'confirmed', 'qa', 'qa') returning id`,
      [projectId],
    );
    intakeRunId = intake.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(
      `update record_attributes set superseded_by_id = null where record_id in (${records})`,
    );
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // NOT `delete from change_sets`: 0014 refuses that outright and allows the
    // cascade. Deleting the project is the whole cleanup.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, 60_000);

  // ---- the shape of a correction -------------------------------------------

  it("supersedes the old row, keeps its page, and does not touch the record", async () => {
    const recordId = await item("__QA Sofa, misread width");
    const before = await documentSpec(recordId, { value: "1900", unit: "mm" });
    const recordBefore = await client.query(`select version from spec_records where id = $1`, [recordId]);

    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        value: "1090",
        unit: "mm",
        state: "confirmed",
        reason: "__QA Misread off page 4 — the drawing says 1090",
        actor: "qa",
      }),
    );

    const old = await client.query(
      `select status, retired_by, superseded_by_id, value from record_attributes where id = $1`,
      [before.id],
    );
    expect(old.rows[0].status).toBe("retired");
    expect(old.rows[0].retired_by).toBe("qa");
    expect(old.rows[0].superseded_by_id).toBe(result.attributeId);
    // The old row still says what the document said. That is the whole point:
    // an in-place edit would leave it saying something its page does not.
    expect(old.rows[0].value).toBe("1900");

    const fresh = await client.query(
      `select value, unit, label, attr_group, dimension_slot, state, status,
              source_run_id, source_page, created_by
         from record_attributes where id = $1`,
      [result.attributeId],
    );
    expect(fresh.rows[0]).toMatchObject({
      value: "1090",
      unit: "mm",
      label: "Width",
      attr_group: "dimension",
      dimension_slot: "W",
      state: "confirmed",
      status: "active",
      created_by: "qa",
    });
    // THE PAGE IS KEPT. A correction that dropped it would be
    // indistinguishable from a value somebody made up.
    expect(fresh.rows[0].source_run_id).toBe(intakeRunId);
    expect(Number(fresh.rows[0].source_page)).toBe(4);

    // ONE CHANGE SET, ONE VERSION — what change-history.test.ts's
    // whole-database coverage assertion reads.
    const change = await client.query(`select kind, reason from change_sets where id = $1`, [
      result.changeSetId,
    ]);
    expect(change.rows[0].kind).toBe("attribute_correct");
    expect(String(change.rows[0].reason)).toMatch(/1090/);
    expect(result.snapshotNo).not.toBeNull();
    const snapshots = await client.query(
      `select count(*)::int as n from record_snapshots where change_set_id = $1`,
      [result.changeSetId],
    );
    expect(snapshots.rows[0].n).toBe(1);

    // spec_records.version is NOT touched: an attribute is its own row, and
    // bumping the record invalidates every extraction snapshot and chase
    // coverage row taken against it.
    const recordAfter = await client.query(`select version from spec_records where id = $1`, [recordId]);
    expect(Number(recordAfter.rows[0].version)).toBe(Number(recordBefore.rows[0].version));
  }, SLOW);

  // THE CASE A VALUE-DIFFING TEST WOULD MISS. The figure does not change at
  // all; the composed cell does, because the unit is what it is rendered in.
  it("recomposes the checklist on a unit-only correction", async () => {
    const recordId = await item("__QA Armchair, wrong unit");
    const before = await documentSpec(recordId, { value: "80", unit: "cm" });
    // The attribute alone does not fill the answer — a document confirm does.
    // Correcting recomposes, which is the assertion.
    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        value: "80",
        unit: "mm",
        state: "confirmed",
        reason: "__QA The sheet is in millimetres, not centimetres",
        actor: "qa",
      }),
    );
    expect(result.answersFilled).toBeGreaterThan(0);
    const answer = await dimensionsAnswer(recordId);
    // 80cm composed as W800mm; 80mm composes as W80mm. The value never moved.
    expect(answer?.value).toBe("W80mm");
    expect(answer?.state).toBe("confirmed");
  }, SLOW);

  it("promotes a TBC spec to confirmed, and the checklist answer with it", async () => {
    const recordId = await item("__QA Bench, TBC width");
    const before = await documentSpec(recordId, { value: null, unit: "mm", state: "tbc" });
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        value: "1520",
        unit: "mm",
        state: "confirmed",
        reason: "__QA The client settled it on the call of 19 Sep",
        actor: "qa",
      }),
    );
    const answer = await dimensionsAnswer(recordId);
    expect(answer?.value).toBe("W1520mm");
    // A TBC attribute can never produce a confirmed answer; a confirmed one
    // can, and this is the transition that makes the gate move.
    expect(answer?.state).toBe("confirmed");
  }, SLOW);

  // A HAND-TYPED SPEC IS A SPEC WITH NO PAGE TO TURN TO, and its correction is
  // too. Copied, never invented: a link opening a document at page 1 to stand
  // in would be a false provenance rather than a missing one.
  it("keeps the absent page of a hand-typed spec rather than inventing one", async () => {
    const recordId = await item("__QA Stool, typed by hand");
    const created = await withTransaction((txn) =>
      createAttribute(txn, {
        recordId,
        attrGroup: "dimension",
        label: "Height",
        value: "450",
        unit: "mm",
        dimensionSlot: "H",
        state: "confirmed",
        actor: "qa",
      }),
    );
    const rows = await client.query(`select version from record_attributes where id = $1`, [
      created.attributeId,
    ]);
    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: created.attributeId,
        expectedVersion: Number(rows.rows[0].version),
        value: "460",
        unit: "mm",
        state: "confirmed",
        reason: "__QA Mistyped — the CAM says 460",
        actor: "qa",
      }),
    );
    const fresh = await client.query(
      `select source_run_id, source_page from record_attributes where id = $1`,
      [result.attributeId],
    );
    expect(fresh.rows[0].source_run_id).toBeNull();
    expect(fresh.rows[0].source_page).toBeNull();
  }, SLOW);

  // ---- the refusals ---------------------------------------------------------

  it("refuses a stale version and writes nothing", async () => {
    const recordId = await item("__QA Chair, two people at once");
    const before = await documentSpec(recordId, { value: "700", unit: "mm" });
    await expect(
      withTransaction((txn) =>
        correctAttribute(txn, {
          attributeId: before.id,
          expectedVersion: before.version + 5,
          value: "701",
          unit: "mm",
          state: "confirmed",
          reason: "__QA should not land",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/changed while you had it open/i);

    const after = await client.query(
      `select count(*)::int as n from record_attributes where record_id = $1`,
      [recordId],
    );
    expect(after.rows[0].n).toBe(1);
    const changes = await client.query(
      `select count(*)::int as n from change_sets where project_id = $1 and reason like '__QA should not land%'`,
      [projectId],
    );
    expect(changes.rows[0].n).toBe(0);
  }, SLOW);

  it("refuses a row that has already been superseded, and names the newer value", async () => {
    const recordId = await item("__QA Sofa, corrected twice");
    const before = await documentSpec(recordId, { value: "1900", unit: "mm" });
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        value: "1090",
        unit: "mm",
        state: "confirmed",
        reason: "__QA First correction",
        actor: "qa",
      }),
    );
    const stale = await client.query(`select version from record_attributes where id = $1`, [before.id]);
    await expect(
      withTransaction((txn) =>
        correctAttribute(txn, {
          attributeId: before.id,
          expectedVersion: Number(stale.rows[0].version),
          value: "1095",
          unit: "mm",
          state: "confirmed",
          reason: "__QA Second correction on the old row",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow(/already been superseded by .*1090/i);
  }, SLOW);

  // 0033 PUT THE CONSTRAINT BEHIND THIS, not only the route's zod. A blank
  // reason reaches `change_sets_reason_required` and the whole transaction
  // rolls back, which is what makes "nothing was written" true.
  it("refuses a correction with no reason and no open change", async () => {
    const recordId = await item("__QA Daybed, no reason given");
    const before = await documentSpec(recordId, { value: "2000", unit: "mm" });
    await expect(
      withTransaction((txn) =>
        correctAttribute(txn, {
          attributeId: before.id,
          expectedVersion: before.version,
          value: "2100",
          unit: "mm",
          state: "confirmed",
          reason: "   ",
          actor: "qa",
        }),
      ),
    ).rejects.toThrow();
    const after = await client.query(
      `select status, value from record_attributes where id = $1`,
      [before.id],
    );
    expect(after.rows[0].status).toBe("active");
    expect(after.rows[0].value).toBe("2000");
  }, SLOW);

  // ---- the finishes library -------------------------------------------------
  //
  // THE LIBRARY IS THE TRUTH AND THE ATTRIBUTE IS THE EVIDENCE. Where the
  // corrected words disagree with what the library says that code is, linking
  // would make the item render the library's description while its own row said
  // something else — so the new row stays UNLINKED and the library is untouched.
  it("unlinks a corrected finish whose words now disagree with the library", async () => {
    const recordId = await item("__QA Armchair, fabric corrected");
    const finish = await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
       values ($1, '__QA UPH-07', '__QAUPH07', 'Yarn Tessarae YC04158', 'confirmed', 'qa', 'qa')
       returning id`,
      [projectId],
    );
    const finishId = finish.rows[0].id;
    const before = await documentSpec(recordId, {
      attrGroup: "material",
      label: "SOFA",
      value: "Yarn Tessarae YC04158",
      unit: null,
      dimensionSlot: null,
      specFieldId: comFieldId,
      materialCode: "__QA UPH-07",
      finishId,
    });

    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        value: "Mohair Bouclé MB-12",
        unit: null,
        state: "confirmed",
        reason: "__QA The client changed the cloth on 19 Sep",
        actor: "qa",
      }),
    );
    expect(result.finishUnlinked).toBe(true);

    const fresh = await client.query(`select finish_id, material_code from record_attributes where id = $1`, [
      result.attributeId,
    ]);
    expect(fresh.rows[0].finish_id).toBeNull();
    // The code itself is KEPT — it is what the document said, and it is how
    // the finishes screen reports the code as needing a person.
    expect(String(fresh.rows[0].material_code)).toBe("__QA UPH-07");

    // The library row is untouched. Correcting it is a separate decision, with
    // its own reason, on the finishes screen.
    const library = await client.query(`select description, state from project_finishes where id = $1`, [
      finishId,
    ]);
    expect(library.rows[0].description).toBe("Yarn Tessarae YC04158");
    expect(library.rows[0].state).toBe("confirmed");
  }, SLOW);

  it("keeps the link where the corrected words still match the library", async () => {
    const recordId = await item("__QA Armchair, fabric re-typed");
    const finish = await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
       values ($1, '__QA UPH-08', '__QAUPH08', 'Linen Weave LW-2', 'confirmed', 'qa', 'qa')
       returning id`,
      [projectId],
    );
    const finishId = finish.rows[0].id;
    const before = await documentSpec(recordId, {
      attrGroup: "material",
      label: "SOFA",
      value: "Linen Weave LW-2",
      unit: null,
      dimensionSlot: null,
      specFieldId: comFieldId,
      materialCode: "__QA UPH-08",
      finishId,
      state: "tbc",
    });
    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: before.id,
        expectedVersion: before.version,
        // Same words, different case: `resolveFinishCode` folds case, so this
        // is not a disagreement and the link survives.
        value: "linen weave lw-2",
        unit: null,
        state: "confirmed",
        reason: "__QA Confirmed on the call of 19 Sep",
        actor: "qa",
      }),
    );
    expect(result.finishUnlinked).toBe(false);
    const fresh = await client.query(`select finish_id from record_attributes where id = $1`, [
      result.attributeId,
    ]);
    expect(fresh.rows[0].finish_id).toBe(finishId);
  }, SLOW);
});
