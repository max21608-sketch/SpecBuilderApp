// Database tier — a person adds a configuration to a bill line by hand.
//
// Skips without DATABASE_URL. NEVER RUN at the time of writing (2026-09-23):
// the sandbox was read-only for the session that wrote it. The first run of
// this file is the first test of `src/lib/configuration-add.ts` against SQL.
//
// What it holds, because each lives in SQL and not in the pure rules:
//  - Add copies EXACTLY the ticked rows and nothing else;
//  - a carried spec keeps its source run and page;
//  - one change set and one version of the new record, and the bill line's
//    own version does not move;
//  - a stale offer is refused and writes nothing;
//  - a retired name is never reused;
//  - the export scope then carries the configuration and not the bill line;
//  - the same bill line on another phase gets the configuration in the SAME
//    change set, carrying ITS OWN specs, and a phase holding the ref on two
//    lines is offered nothing.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { addConfiguration, loadCarryOffer, loadOtherPhases, renameConfiguration } from "@/lib/configuration-add";
import { sql } from "@/lib/db";
import { defaultSelection, carryKey } from "@/lib/configuration-carry";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("adding a configuration by hand", () => {
  const SLOW = 40_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let billLineId = "";
  let intakeRunId = "";
  let widthId = "";
  let comId = "";
  let stitchAnswerId = "";
  let veRunId = "";
  let veBillLineId = "";
  let veWidthId = "";
  let murRunId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P00038")}', '__QA Configuration add', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    const comFieldId = (await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id;

    const run = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }));
    runId = run.runId;
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: "Desk chair", clientRef: "S-301", qty: 45, categoryId, actor: "qa" }),
    );
    billLineId = record.recordId;

    const intake = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'confirmed', 'qa', 'qa') returning id`,
      [projectId],
    );
    intakeRunId = intake.rows[0].id;

    // Written directly, as a drawing confirm would leave them: a width off
    // page 3 and a fabric off the same page.
    widthId = (
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state, source_run_id, source_page, created_by, updated_by)
         values ($1, 'dimension', 'Width', '840', 'mm', 'W', 'confirmed', $2, 3, 'qa', 'qa') returning id`,
        [billLineId, intakeRunId],
      )
    ).rows[0].id;
    comId = (
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, spec_field_id, state, source_run_id, source_page, created_by, updated_by)
         values ($1, 'material', 'SEAT', 'Tibor Blob Amber Fern', $2, 'confirmed', $3, 3, 'qa', 'qa') returning id`,
        [billLineId, comFieldId, intakeRunId],
      )
    ).rows[0].id;

    // One settled checklist answer that no attribute projects to.
    const answer = await client.query(
      `select sa.id from spec_answers sa
         join requirements q on q.id = sa.requirement_id
        where sa.record_id = $1 and sa.spec_field_id is null
        order by q.sort_order limit 1`,
      [billLineId],
    );
    stitchAnswerId = answer.rows[0].id;

    // THE SAME BILL LINE ON A SECOND PHASE, with its own width — the VE phase
    // quotes a narrower chair. And a third phase carrying the ref on TWO lines,
    // the SX11A case, which must be offered nothing.
    const ve = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA VE", actor: "qa" }));
    veRunId = ve.runId;
    veBillLineId = (
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId: veRunId, itemDescription: "Desk chair", clientRef: "s 301", qty: 20, categoryId, actor: "qa" }),
      )
    ).recordId;
    veWidthId = (
      await client.query(
        `insert into record_attributes (record_id, attr_group, label, value, unit, dimension_slot, state, source_run_id, source_page, created_by, updated_by)
         values ($1, 'dimension', 'Width', '800', 'mm', 'W', 'confirmed', $2, 7, 'qa', 'qa') returning id`,
        [veBillLineId, intakeRunId],
      )
    ).rows[0].id;
    const mur = await withTransaction((txn) => createRun(txn, { projectId, name: "__QA MUR", actor: "qa" }));
    murRunId = mur.runId;
    for (const qty of [2, 3]) {
      await withTransaction((txn) =>
        createRecord(txn, { projectId, runId: murRunId, itemDescription: "Desk chair", clientRef: "S-301", qty, categoryId, actor: "qa" }),
      );
    }
    await client.query(
      `update spec_answers set state = 'confirmed', value = 'Plain stitch', confirmed_by = 'qa', confirmed_at = now(), updated_by = 'qa'
        where id = $1`,
      [stitchAnswerId],
    );
  }, SLOW);

  afterAll(async () => {
    // Deleting the project is the whole cleanup (0014 refuses a direct
    // change-set delete and allows the cascade).
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  const refs = (offer: Awaited<ReturnType<typeof loadCarryOffer>>) =>
    offer.offered.map((item) => ({ kind: item.kind, id: item.id, version: item.version }));

  it("offers the bill line's specs and settled answers, the fabric unticked", async () => {
    const offer = await loadCarryOffer(sql, billLineId);
    const ids = offer.offered.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([widthId, comId, stitchAnswerId]));
    expect(offer.offered.find((item) => item.id === comId)?.differing).toBe(true);
    expect(offer.offered.find((item) => item.id === widthId)?.source).toMatchObject({ page: 3 });
    expect(offer.alreadySplit).toBe(false);
  }, SLOW);

  it("refuses an offer that is not the one there now, and writes nothing", async () => {
    const offer = await loadCarryOffer(sql, billLineId);
    const stale = refs(offer).map((ref) => (ref.id === widthId ? { ...ref, version: ref.version + 1 } : ref));
    await expect(
      withTransaction((txn) =>
        addConfiguration(txn, { billLineId, name: "Type 1", shown: stale, carry: [], actor: "qa" }),
      ),
    ).rejects.toMatchObject({ code: "targets_changed" });
    const children = await client.query(`select count(*)::int as n from spec_records where parent_id = $1`, [billLineId]);
    expect(children.rows[0].n).toBe(0);
  }, SLOW);

  it("copies exactly the ticked rows, keeps the page, and is one change and one version", async () => {
    const before = await client.query(`select version from spec_records where id = $1`, [billLineId]);
    const offer = await loadCarryOffer(sql, billLineId);
    const ticked = defaultSelection(offer.offered);
    const carry = refs(offer).filter((ref) => ticked.has(carryKey(ref)));

    const result = await withTransaction((txn) =>
      addConfiguration(txn, { billLineId, name: "type 2", shown: refs(offer), carry, actor: "qa" }),
    );
    expect(result.label).toBe("TYPE 2");
    expect(result.stoppedExporting).toBe(1); // the fabric, left unticked

    const child = await client.query(
      `select parent_id, variant_label, qty, split_reason from spec_records where id = $1`,
      [result.recordId],
    );
    expect(child.rows[0]).toMatchObject({ parent_id: billLineId, variant_label: "TYPE 2", qty: null, split_reason: "configuration" });

    const attrs = await client.query(
      `select label, value, source_run_id, source_page from record_attributes where record_id = $1 and status = 'active'`,
      [result.recordId],
    );
    expect(attrs.rows).toEqual([{ label: "Width", value: "840", source_run_id: intakeRunId, source_page: 3 }]);

    const carried = await client.query(
      `select c.value, c.state, c.source_kind from spec_answers c
         join spec_answers p on p.requirement_id = c.requirement_id and p.id = $2
        where c.record_id = $1 and c.revision_no = 0`,
      [result.recordId, stitchAnswerId],
    );
    expect(carried.rows[0]).toMatchObject({ value: "Plain stitch", state: "confirmed", source_kind: "manual" });

    // The Dimensions cell is COMPOSED on the configuration, not copied.
    const dims = await client.query(
      `select sa.value, sa.source_kind from spec_answers sa join spec_fields f on f.id = sa.spec_field_id
        where sa.record_id = $1 and f.json_id = 3`,
      [result.recordId],
    );
    expect(dims.rows[0]?.source_kind).toBe("document");
    expect(String(dims.rows[0]?.value)).toContain("W840");

    // The fabric's field is blank on the configuration.
    const com = await client.query(
      `select sa.state from spec_answers sa join spec_fields f on f.id = sa.spec_field_id
        where sa.record_id = $1 and f.json_id = 1`,
      [result.recordId],
    );
    expect(com.rows.every((row) => row.state === "missing")).toBe(true);

    const change = await client.query(`select kind, reason from change_sets where id = $1`, [result.changeSetId]);
    expect(change.rows[0].kind).toBe("record_create");
    expect(change.rows[0].reason).toContain("Carried from the bill line");
    const versions = await client.query(`select change_set_id from record_snapshots where record_id = $1`, [result.recordId]);
    expect(versions.rows).toEqual([{ change_set_id: result.changeSetId }]);

    const after = await client.query(`select version from spec_records where id = $1`, [billLineId]);
    expect(after.rows[0].version).toBe(before.rows[0].version);
    const parentSnapshots = await client.query(
      `select count(*)::int as n from record_snapshots where record_id = $1 and change_set_id = $2`,
      [billLineId, result.changeSetId],
    );
    expect(parentSnapshots.rows[0].n).toBe(0);

    // The export carries the configuration and not the bill line.
    const scope = await loadExportScope(projectId, runId);
    if (isScopeFailure(scope)) throw new Error(scope.error);
    const scoped = scope.scope.records.map((record) => record.id);
    expect(scoped).toContain(result.recordId);
    expect(scoped).not.toContain(billLineId);
  }, SLOW);

  it("refuses a name already used, and a retired one", async () => {
    const offer = await loadCarryOffer(sql, billLineId);
    expect(offer.alreadySplit).toBe(true);
    await expect(
      withTransaction((txn) =>
        addConfiguration(txn, { billLineId, name: "Type 2", shown: refs(offer), carry: [], actor: "qa" }),
      ),
    ).rejects.toMatchObject({ code: "name_taken" });

    const third = await withTransaction((txn) =>
      addConfiguration(txn, { billLineId, name: "Type 3", shown: refs(offer), carry: [], actor: "qa" }),
    );
    expect(third.stoppedExporting).toBe(0); // already a heading
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
      [third.recordId],
    );
    const again = await loadCarryOffer(sql, billLineId);
    await expect(
      withTransaction((txn) =>
        addConfiguration(txn, { billLineId, name: "type 3", shown: refs(again), carry: [], actor: "qa" }),
      ),
    ).rejects.toMatchObject({ code: "name_retired" });
  }, SLOW);

  it("renames a configuration, refusing a name its sibling holds", async () => {
    const child = await client.query(
      `select id, version from spec_records where parent_id = $1 and variant_label = 'TYPE 2'`,
      [billLineId],
    );
    const { id, version } = child.rows[0];
    await expect(
      withTransaction((txn) => renameConfiguration(txn, { recordId: id, name: "type 3", expectedVersion: version, actor: "qa" })),
    ).rejects.toMatchObject({ code: "name_retired" });
    const renamed = await withTransaction((txn) =>
      renameConfiguration(txn, { recordId: id, name: "Type 2b", expectedVersion: version, actor: "qa" }),
    );
    expect(renamed).toMatchObject({ label: "TYPE 2B", changed: true });
  }, SLOW);

  it("adds the same configuration on another phase in one change, each from its own bill line", async () => {
    const phases = await loadOtherPhases(sql, billLineId);
    const veId = phases.find((phase) => phase.runId === veRunId);
    const murId = phases.find((phase) => phase.runId === murRunId);
    // `s 301` and `S-301` are one ref under normaliseRef.
    expect(veId).toMatchObject({ billLineId: veBillLineId, lineCount: 1 });
    expect(murId).toMatchObject({ billLineId: null, lineCount: 2 });

    const main = await loadCarryOffer(sql, billLineId);
    const veOffer = await loadCarryOffer(sql, veBillLineId);
    const all = (offer: typeof main) => refs(offer);
    const result = await withTransaction((txn) =>
      addConfiguration(txn, {
        billLineId,
        name: "Type 5",
        shown: all(main),
        carry: [],
        phases: [{ billLineId: veBillLineId, shown: all(veOffer), carry: all(veOffer) }],
        actor: "qa",
      }),
    );
    expect(result.alsoAdded).toHaveLength(1);
    const veChild = result.alsoAdded[0]!.recordId;

    // The VE configuration carries the VE bill line's 800, never MAIN's 840.
    const attrs = await client.query(
      `select value, source_page from record_attributes where record_id = $1 and status = 'active'`,
      [veChild],
    );
    expect(attrs.rows).toEqual([{ value: "800", source_page: 7 }]);
    const parent = await client.query(`select parent_id, run_id from spec_records where id = $1`, [veChild]);
    expect(parent.rows[0]).toMatchObject({ parent_id: veBillLineId, run_id: veRunId });
    expect(veWidthId).toBeTruthy();

    // ONE change set, one version per new record.
    const versions = await client.query(
      `select record_id from record_snapshots where change_set_id = $1 order by record_id`,
      [result.changeSetId],
    );
    expect(versions.rows.map((row) => row.record_id).sort()).toEqual([result.recordId, veChild].sort());
  }, SLOW);

  it("refuses the whole act, naming the phase, when the name is used on another phase", async () => {
    const main = await loadCarryOffer(sql, billLineId);
    const veOffer = await loadCarryOffer(sql, veBillLineId);
    // TYPE 5 is on both now; TYPE 6 is on neither — put a TYPE 6 on VE only.
    await withTransaction((txn) =>
      addConfiguration(txn, { billLineId: veBillLineId, name: "Type 6", shown: refs(veOffer), carry: [], actor: "qa" }),
    );
    const veAgain = await loadCarryOffer(sql, veBillLineId);
    await expect(
      withTransaction((txn) =>
        addConfiguration(txn, {
          billLineId,
          name: "Type 6",
          shown: refs(main),
          carry: [],
          phases: [{ billLineId: veBillLineId, shown: refs(veAgain), carry: [] }],
          actor: "qa",
        }),
      ),
    ).rejects.toMatchObject({ code: "name_taken", message: expect.stringContaining("On __QA VE:") });
    const onMain = await client.query(
      `select count(*)::int as n from spec_records where parent_id = $1 and variant_label = 'TYPE 6'`,
      [billLineId],
    );
    expect(onMain.rows[0].n).toBe(0);
  }, SLOW);
});
