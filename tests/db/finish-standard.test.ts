// Database tier — BW's own finish, set once per CODE in the finishes library (0045).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/finish-standard.test.ts
//
// ============================================================================
// WHAT IS WORTH TESTING HERE RATHER THAN IN THE PURE TIER.
//
//   * Setting it on the code reaches EVERY item carrying the code, in one
//     change set: each linked record's checklist recomposed, ONE version each,
//     `spec_records.version` untouched, and the export cell and the check
//     sheet showing the library's choice over an item's own earlier one.
//   * Agreeing with the client's email; changing an agreed one is refused
//     without a reason -- by the database's constraint as well as the code.
//   * The route's refusals: a stale version is a 409, an option on no list and
//     a code with no list are 400s in words, and a per-item standard on a
//     spec filed under a code is refused.
//   * The coverage assertion holds for every change this project made.
//
// Synthetic throughout. The palette options are READ from the seeded BWS
// timber palette rather than typed here, so the test cannot invent one.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { createFinish } from "@/lib/finish-edit";
import { agreeFinishStandard, setFinishStandard } from "@/lib/finish-standard";
import { setAttributeStandard } from "@/lib/attribute-standard";
import { loadRecordAtoms, scopeForAtoms, exportAnswers } from "@/lib/record-atoms";
import { composeRowCells, BWS_EXPORT_COLUMNS } from "@/lib/bws-export";
import { composeCheckSheet, CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { sql } from "@/lib/db";
import { POST as standardRoute } from "@/app/api/projects/[id]/finishes/[finishId]/standard/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const TIMBER_JSON_ID = 4;
const COM_1_JSON_ID = 1;
const CLIENT_WORDS = "__QA feet dark tinted wood as per approved sample";
const SPEC_CONTENT_TABLES = ["spec_records", "spec_answers", "record_attributes", "spec_record_refs"];

describeIfDb("BW's own finish, set once per code", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let timberFieldId = "";
  let comFieldId = "";
  let options: { id: string; value: string }[] = [];
  let finishId = "";
  let timberCode = "";
  let fabricId = "";
  const records: string[] = [];
  const attributes: string[] = [];

  async function item(description: string, clientRef: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: description, clientRef, categoryId, actor: "qa" }),
    );
    return record.recordId;
  }

  async function linkedSpec(recordId: string, fieldId: string, finish: string, code: string): Promise<string> {
    return String(
      (
        await client.query(
          `insert into record_attributes
             (record_id, attr_group, label, value, material_code, spec_field_id, finish_id, state, created_by, updated_by)
           values ($1, 'finish', 'SOFA FEET', $2, $3, $4, $5, 'confirmed', 'qa', 'qa') returning id`,
          [recordId, CLIENT_WORDS, code, fieldId, finish],
        )
      ).rows[0].id,
    );
  }

  async function finishRow(id = finishId) {
    return (
      await client.query(
        `select version, standard_value, standard_option_id, standard_state, standard_set_by,
                standard_agreed_evidence_id
           from project_finishes where id = $1`,
        [id],
      )
    ).rows[0];
  }

  async function timberAnswer(recordId: string) {
    return (
      await client.query(
        `select a.value, a.value_raw, a.state
           from spec_answers a join requirements q on q.id = a.requirement_id
          where a.record_id = $1 and q.spec_field_id = $2 and a.revision_no = 0`,
        [recordId, timberFieldId],
      )
    ).rows[0];
  }

  async function snapshotCount(recordId: string): Promise<number> {
    return Number(
      (await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n,
    );
  }

  async function snapshotsOf(changeSetId: string): Promise<string[]> {
    return (
      await client.query(`select record_id from record_snapshots where change_set_id = $1 order by record_id`, [changeSetId])
    ).rows.map((row) => String(row.record_id));
  }

  async function recordVersion(recordId: string): Promise<number> {
    return Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);
  }

  async function exported(recordId: string) {
    const atoms = (await loadRecordAtoms(sql, [recordId])).get(recordId)!;
    const cells = composeRowCells(scopeForAtoms(atoms), atoms.record, atoms.attributes, exportAnswers(atoms));
    const index = BWS_EXPORT_COLUMNS.findIndex((column) => column.jsonId === TIMBER_JSON_ID);
    const sheet = composeCheckSheet(scopeForAtoms(atoms));
    const line = sheet.rows.find((row) => row[CHECK_SHEET_HEADER.indexOf("Field id")] === String(TIMBER_JSON_ID));
    return {
      cell: cells[index]?.value,
      at: (name: string) => line?.[CHECK_SHEET_HEADER.indexOf(name)],
    };
  }

  async function post(body: Record<string, unknown>, finish = finishId) {
    const response = await standardRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: projectId, finishId: finish }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90045")}', '__QA BW finish per code', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    categoryId = (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`))
      .rows[0].id;
    timberFieldId = (await client.query(`select id from spec_fields where json_id = $1`, [TIMBER_JSON_ID])).rows[0].id;
    comFieldId = (await client.query(`select id from spec_fields where json_id = $1`, [COM_1_JSON_ID])).rows[0].id;
    options = (
      await client.query(
        `select o.id, o.value from spec_palette_options o
          where o.palette_key = (select g.palette_key from spec_field_gates g
                                  where g.spec_field_id = $1 and g.palette_key is not null limit 1)
            and o.active order by o.sort_order limit 3`,
        [timberFieldId],
      )
    ).rows;
    expect(options.length).toBeGreaterThanOrEqual(2);
    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA MAIN", actor: "qa" }))).runId;

    // ONE timber code on two items, each carrying it in Main timber finish.
    // The second item chose its own BW standard per item before 0045 -- the
    // library's must replace it.
    const code = `__QA WD-${Date.now()}`;
    timberCode = code;
    finishId = await withTransaction((txn) =>
      createFinish(txn, { projectId, fields: { code, kind: "timber", state: "tbc" }, actor: "qa" }),
    );
    for (const name of ["__QA Sofa", "__QA Armchair"]) {
      const recordId = await item(name, `__QA ${name}-${Date.now()}`);
      records.push(recordId);
      attributes.push(await linkedSpec(recordId, timberFieldId, finishId, code));
    }
    await client.query(
      `update record_attributes
          set standard_value = $2, standard_option_id = $3, standard_state = 'agreed',
              standard_set_by = 'qa', standard_set_at = now()
        where id = $1`,
      [attributes[1], options[1]!.value, options[1]!.id],
    );

    // And a fabric on COM 1, which has no BW finish to choose.
    const fabricCode = `__QA FAB-${Date.now()}`;
    fabricId = await withTransaction((txn) =>
      createFinish(txn, { projectId, fields: { code: fabricCode, kind: "fabric", state: "tbc" }, actor: "qa" }),
    );
    await linkedSpec(records[0]!, comFieldId, fabricId, fabricCode);
  }, SLOW);

  afterAll(async () => {
    const recordIds = `select id from spec_records where project_id = $1`;
    await client.query(`delete from spec_answers where record_id in (${recordIds})`, [projectId]);
    await client.query(`delete from record_attributes where record_id in (${recordIds})`, [projectId]);
    await client.query(`update project_finishes set standard_agreed_evidence_id = null where project_id = $1`, [projectId]);
    await client.query(
      `delete from attachments where entity_type = 'change_sets'
          and entity_id in (select id from change_sets where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    // Deleting the project cascades the change sets, versions and finishes.
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it(
    "set on the code reaches every item: one change set, one version each, the cell and the check sheet",
    async () => {
      const [sofa, armchair] = records as [string, string];
      const recordVersions = [await recordVersion(sofa), await recordVersion(armchair)];
      const versions = [await snapshotCount(sofa), await snapshotCount(armchair)];
      // Before: PER CODE ONLY. The armchair carries its own agreed standard
      // from before 0045, and the code has none -- so none is in force.
      expect((await exported(armchair)).at("BW standard")).toBe("");

      const finish = await finishRow();
      const result = await withTransaction((txn) =>
        setFinishStandard(txn, {
          projectId,
          finishId,
          expectedVersion: Number(finish.version),
          choice: { state: "proposed", value: options[0]!.value },
          actor: "__qa@example.test",
        }),
      );
      expect(result.kind).toBe("standard_set");
      expect(result.recordsTouched).toBe(2);

      expect(await finishRow()).toMatchObject({
        standard_value: options[0]!.value,
        standard_option_id: options[0]!.id,
        standard_state: "proposed",
        standard_set_by: "__qa@example.test",
      });

      // ONE change set, and one version of EACH item under it.
      expect(await snapshotsOf(result.changeSetId)).toEqual([...records].sort());
      expect(await snapshotCount(sofa)).toBe(versions[0]! + 1);
      expect(await snapshotCount(armchair)).toBe(versions[1]! + 1);
      expect([await recordVersion(sofa), await recordVersion(armchair)]).toEqual(recordVersions);

      for (const recordId of records) {
        // The library's choice wins over the armchair's own agreed one.
        const answer = await timberAnswer(recordId);
        expect(answer).toMatchObject({ value: options[0]!.value, value_raw: CLIENT_WORDS, state: "tbc" });
        const out = await exported(recordId);
        expect(out.cell).toBe(`${options[0]!.value} TBC`);
        expect(out.at("BW standard")).toBe(`${options[0]!.value} (proposed)`);
        expect(out.at("Client specified")).toBe(CLIENT_WORDS);
      }

      // The version of each item says the library's BW finish arrived.
      const snaps = (
        await client.query(
          `select atoms from record_snapshots where record_id = $1 order by snapshot_no desc limit 2`,
          [armchair],
        )
      ).rows;
      const diff = diffSnapshots(parseAtoms(snaps[1].atoms), parseAtoms(snaps[0].atoms));
      const line = diff.attributes.flatMap((change) => change.fields).find((field) => field.field === "standard");
      expect(line?.label).toMatch(/^BW finish \(set on /);
      expect(line?.now).toBe(`${options[0]!.value} (proposed)`);
    },
    SLOW,
  );

  it(
    "agreeing records the client's email; changing an agreed one asks why",
    async () => {
      let finish = await finishRow();
      const agreed = await withTransaction((txn) =>
        agreeFinishStandard(txn, {
          projectId,
          finishId,
          expectedVersion: Number(finish.version),
          evidence: { pathname: `projects/${projectId}/evidence/__qa-yes.eml`, filename: "__qa-yes.eml" },
          actor: "qa",
        }),
      );
      expect(agreed.kind).toBe("standard_agreed");
      expect(await snapshotsOf(agreed.changeSetId)).toEqual([...records].sort());
      finish = await finishRow();
      const change = (
        await client.query(`select kind, evidence_attachment_id from change_sets where id = $1`, [agreed.changeSetId])
      ).rows[0];
      expect(change.evidence_attachment_id).toBeTruthy();
      expect(finish.standard_agreed_evidence_id).toBe(change.evidence_attachment_id);
      for (const recordId of records) {
        expect((await timberAnswer(recordId)).state).toBe("confirmed");
        expect((await exported(recordId)).cell).toBe(options[0]!.value);
      }

      // Without a reason: refused, and nothing moved.
      await expect(
        withTransaction((txn) =>
          setFinishStandard(txn, {
            projectId,
            finishId,
            expectedVersion: Number(finish.version),
            choice: { state: "proposed", value: options[1]!.value },
            actor: "qa",
          }),
        ),
      ).rejects.toThrow(/has to say why/);
      expect((await finishRow()).standard_state).toBe("agreed");

      // Through the route, the same refusal reaches the screen as a 400 in words.
      const refused = await post({
        action: "set",
        version: Number(finish.version),
        standard: { state: "proposed", value: options[1]!.value },
      });
      expect(refused.status).toBe(400);
      expect(String(refused.body.error)).toMatch(/has to say why/);

      const changed = await withTransaction((txn) =>
        setFinishStandard(txn, {
          projectId,
          finishId,
          expectedVersion: Number(finish.version),
          choice: { state: "proposed", value: options[1]!.value },
          reason: "__QA The client has since asked for the other oak",
          actor: "qa",
        }),
      );
      expect(changed.kind).toBe("standard_change");
      expect(await finishRow()).toMatchObject({
        standard_value: options[1]!.value,
        standard_state: "proposed",
        standard_agreed_evidence_id: null,
      });
    },
    SLOW,
  );

  it(
    "the route refuses a stale version, an option on no list, a code with no list, and a per-item set on a filed spec",
    async () => {
      const finish = await finishRow();

      const stale = await post({ action: "set", version: Number(finish.version) - 1, standard: { state: "tbc" } });
      expect(stale.status).toBe(409);

      const offList = await post({
        action: "set",
        version: Number(finish.version),
        standard: { state: "proposed", value: "__QA not a BWS option" },
      });
      expect(offList.status).toBe(400);
      expect(String(offList.body.error)).toMatch(/not one of the/);

      const fabric = await finishRow(fabricId);
      const noList = await post(
        { action: "set", version: Number(fabric.version), standard: { state: "tbc" } },
        fabricId,
      );
      expect(noList.status).toBe(400);
      expect(String(noList.body.error)).toMatch(/no BW finish to choose/);

      // Nothing above wrote anything.
      expect(await finishRow()).toMatchObject({ version: finish.version, standard_value: options[1]!.value });

      // PER CODE ONLY: the per-item control is refused on a spec filed under a code.
      const attribute = (await client.query(`select version from record_attributes where id = $1`, [attributes[0]])).rows[0];
      await expect(
        withTransaction((txn) =>
          setAttributeStandard(txn, {
            attributeId: attributes[0]!,
            expectedVersion: Number(attribute.version),
            choice: { state: "tbc" },
            actor: "qa",
          }),
        ),
      ).rejects.toThrow(/set once on .* in the finishes library/);

      // And TBC through the route works, reaching both items.
      const tbc = await post({ action: "set", version: Number(finish.version), standard: { state: "tbc" } });
      expect(tbc.status, JSON.stringify(tbc.body)).toBe(200);
      expect(tbc.body.recordsTouched).toBe(2);
      // Nothing to ship from BW yet: the library's words (the bare code, since
      // nothing describes it), held at TBC.
      const out = await exported(records[0]!);
      expect(out.cell).toBe(`${timberCode} TBC`);
      expect(out.at("BW standard")).toBe("TBC — BW to propose one");
    },
    SLOW,
  );

  it("COVERAGE: every spec-content write this project made belongs to a change that took a version", async () => {
    const uncovered = await client.query(
      `select cs.id, cs.kind
         from change_sets cs
         join audit_log al on al.change_set_id = cs.id
        where cs.project_id = $2
          and al.table_name = any($1::text[])
          and not exists (select 1 from record_snapshots s where s.change_set_id = cs.id)
        group by cs.id, cs.kind`,
      [SPEC_CONTENT_TABLES, projectId],
    );
    expect(uncovered.rows).toEqual([]);
  });
});
