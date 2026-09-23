// Database tier — the BW standard beside what the client specified (0041).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bw-standard.test.ts
//
// ============================================================================
// WHAT IS WORTH TESTING HERE RATHER THAN IN THE PURE TIER.
//
//   * The drawings confirm writes BOTH halves, into two sets of columns, and
//     the pick at intake went through the real autosave without touching the
//     value. The defect was that `record_attributes` held only the option.
//   * Setting, agreeing and changing a standard are ONE change set and ONE
//     version each, `spec_records.version` never moves, and the agreed
//     standard's change asks why -- in the database, not only in the route.
//   * A correction carries the standard forward onto the superseding row.
//   * The export cell ships the standard and the check sheet shows both.
//   * The backfill's dry run lists, `--apply` restores, and a second run is a
//     no-op that opens no change set.
//
// Synthetic throughout. The palette options are READ from the seeded BWS
// timber palette rather than typed here, so the test cannot invent one.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { agreeAttributeStandard, setAttributeStandard } from "@/lib/attribute-standard";
import { correctAttribute } from "@/lib/attribute-correct";
import { loadRecordAtoms, scopeForAtoms, exportAnswers } from "@/lib/record-atoms";
import { composeRowCells, BWS_EXPORT_COLUMNS } from "@/lib/bws-export";
import { composeCheckSheet, CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { applyStandardBackfill, planStandardBackfill } from "@/lib/standards-backfill";
import { sql } from "@/lib/db";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { PATCH as importPatchRoute } from "@/app/api/imports/[id]/route";

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
const CLIENT_WORDS = "__QA feet dark tinted wood as per approved sample";

describeIfDb("the BW standard beside the client's words", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let timberFieldId = "";
  let options: { id: string; value: string }[] = [];

  async function item(description: string, clientRef: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: description, clientRef, categoryId, actor: "qa" }),
    );
    return record.recordId;
  }

  async function stage(parsed: unknown): Promise<string> {
    return String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
           values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
          [projectId, JSON.stringify(parsed)],
        )
      ).rows[0].id,
    );
  }

  const doc = (code: string, observation: Record<string, unknown>) => ({
    kind: "shop_drawings",
    schemaVersion: 2,
    items: [
      {
        id: "item-1",
        version: 1,
        page: 1,
        itemCodeRaw: code,
        itemNameRaw: "__QA SOFA",
        confidence: "high",
        targets: null,
        observations: [observation],
      },
    ],
  });

  const timberCallout = (over: Record<string, unknown> = {}) => ({
    id: "obs-timber",
    version: 1,
    attrGroup: "finish",
    labelRaw: "SOFA FEET",
    valueRaw: CLIENT_WORDS,
    materialCodeRaw: null,
    value: CLIENT_WORDS,
    unit: null,
    unitSuggested: false,
    specFieldId: timberFieldId,
    state: "confirmed",
    stateReason: null,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...over,
  });

  async function patch(intakeId: string, body: Record<string, unknown>) {
    const response = await importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: intakeId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function liveObservation(intakeId: string) {
    const parsed = (await client.query(`select parsed from intake_runs where id = $1`, [intakeId])).rows[0].parsed;
    return parsed.items[0].observations[0] as Record<string, unknown> & { version: number };
  }

  async function timberAttribute(recordId: string) {
    return (
      await client.query(
        `select id, version, value, standard_value, standard_option_id, standard_state, standard_set_by,
                standard_agreed_evidence_id, source_run_id, source_page
           from record_attributes where record_id = $1 and spec_field_id = $2 and status = 'active'`,
        [recordId, timberFieldId],
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

  /** A spec a drawing confirmed before 0041 would have written: the option IN value. */
  async function documentSpec(recordId: string, intakeId: string, value: string): Promise<string> {
    return String(
      (
        await client.query(
          `insert into record_attributes
             (record_id, attr_group, label, value, spec_field_id, state, source_run_id, source_page, created_by, updated_by)
           values ($1, 'finish', 'SOFA FEET', $2, $3, 'confirmed', $4, 1, 'qa', 'qa') returning id`,
          [recordId, value, timberFieldId, intakeId],
        )
      ).rows[0].id,
    );
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90041")}', '__QA BW standard', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    categoryId = (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`))
      .rows[0].id;
    timberFieldId = (await client.query(`select id from spec_fields where json_id = $1`, [TIMBER_JSON_ID])).rows[0].id;
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
  }, SLOW);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = $1`;
    await client.query(`delete from spec_answers where record_id in (${records})`, [projectId]);
    await client.query(`update record_attributes set superseded_by_id = null where record_id in (${records})`, [projectId]);
    await client.query(`delete from record_attributes where record_id in (${records})`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(
      `delete from attachments where entity_type = 'change_sets'
          and entity_id in (select id from change_sets where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // Deleting the project cascades the change sets and versions (0013-0015).
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  let confirmedRecord = "";

  it(
    "a pick at intake sets the standard, never the value, and the confirm writes both halves",
    async () => {
      const code = `__QA S-${Date.now()}`;
      confirmedRecord = await item("__QA Sofa", code);
      const intakeId = await stage(doc(code, timberCallout()));
      const option = options[0]!;

      // A value that is not an option is refused in words, and nothing moves.
      const refused = await patch(intakeId, {
        itemId: "item-1",
        observationId: "obs-timber",
        expectedVersion: 1,
        changes: { standard: { state: "proposed", value: "__QA not a BWS option" } },
      });
      expect(refused.response.status).toBe(400);
      expect(String(refused.body.error)).toMatch(/not one of the/);

      const picked = await patch(intakeId, {
        itemId: "item-1",
        observationId: "obs-timber",
        expectedVersion: 1,
        changes: { standard: { state: "proposed", value: option.value } },
      });
      expect(picked.response.ok, JSON.stringify(picked.body)).toBe(true);
      const staged = await liveObservation(intakeId);
      // THE VALUE IS THE CLIENT'S AND IT DID NOT MOVE.
      expect(staged.value).toBe(CLIENT_WORDS);
      expect(staged.standard).toEqual({ state: "proposed", value: option.value, optionId: option.id });

      const response = await confirmRoute(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
            itemId: "item-1",
            itemVersion: 1,
            observations: [{ id: "obs-timber", version: staged.version }],
          }),
        }),
        { params: Promise.resolve({ id: intakeId }) },
      );
      expect(response.ok, JSON.stringify(await response.clone().json())).toBe(true);

      const attribute = await timberAttribute(confirmedRecord);
      expect(attribute).toMatchObject({
        value: CLIENT_WORDS,
        standard_value: option.value,
        standard_option_id: option.id,
        standard_state: "proposed",
        standard_set_by: "__qa@example.test",
      });

      // The checklist follows the same composer: the standard, held at TBC
      // until the client agrees, with the CLIENT'S words as value_raw.
      const answer = await timberAnswer(confirmedRecord);
      expect(answer).toMatchObject({ value: option.value, value_raw: CLIENT_WORDS, state: "tbc" });

      // The file ships the standard; the check sheet shows both halves.
      const out = await exported(confirmedRecord);
      expect(out.cell).toBe(`${option.value} TBC`);
      expect(out.at("Client specified")).toBe(CLIENT_WORDS);
      expect(out.at("BW standard")).toBe(`${option.value} (proposed)`);
    },
    SLOW,
  );

  it(
    "agreeing, changing and taking the standard to TBC are one change set and one version each",
    async () => {
      const recordId = confirmedRecord;
      const recordVersionBefore = await recordVersion(recordId);
      let attribute = await timberAttribute(recordId);
      let versions = await snapshotCount(recordId);

      // ---- the client agrees, with their email -----------------------------
      const agreed = await withTransaction((txn) =>
        agreeAttributeStandard(txn, {
          attributeId: attribute.id,
          expectedVersion: Number(attribute.version),
          evidence: { pathname: `projects/${projectId}/evidence/__qa-yes.eml`, filename: "__qa-yes.eml" },
          actor: "qa",
        }),
      );
      expect(agreed.kind).toBe("standard_agreed");
      expect(await snapshotCount(recordId)).toBe(versions + 1);
      versions += 1;
      attribute = await timberAttribute(recordId);
      expect(attribute.standard_state).toBe("agreed");
      const change = (
        await client.query(`select kind, evidence_attachment_id from change_sets where id = $1`, [agreed.changeSetId])
      ).rows[0];
      expect(change.kind).toBe("standard_agreed");
      expect(attribute.standard_agreed_evidence_id).toBe(change.evidence_attachment_id);
      // Agreed settles the answer at the attribute's own state.
      expect((await timberAnswer(recordId)).state).toBe("confirmed");
      expect((await exported(recordId)).cell).toBe(options[0]!.value);

      // ---- changing an AGREED standard asks why -----------------------------
      await expect(
        withTransaction((txn) =>
          setAttributeStandard(txn, {
            attributeId: attribute.id,
            expectedVersion: Number(attribute.version),
            choice: { state: "proposed", value: options[1]!.value },
            actor: "qa",
          }),
        ),
      ).rejects.toThrow(/has to say why/);
      expect((await timberAttribute(recordId)).standard_state).toBe("agreed");
      expect(await snapshotCount(recordId)).toBe(versions);

      const changed = await withTransaction((txn) =>
        setAttributeStandard(txn, {
          attributeId: attribute.id,
          expectedVersion: Number(attribute.version),
          choice: { state: "proposed", value: options[1]!.value },
          reason: "__QA The client has since asked for the other oak",
          actor: "qa",
        }),
      );
      expect(changed.kind).toBe("standard_change");
      expect(await snapshotCount(recordId)).toBe(versions + 1);
      versions += 1;
      attribute = await timberAttribute(recordId);
      expect(attribute).toMatchObject({ standard_value: options[1]!.value, standard_state: "proposed", value: CLIENT_WORDS });
      // The agreement's evidence belonged to the agreement, and goes with it.
      expect(attribute.standard_agreed_evidence_id).toBeNull();

      // ---- BW will propose one ---------------------------------------------
      const tbc = await withTransaction((txn) =>
        setAttributeStandard(txn, {
          attributeId: attribute.id,
          expectedVersion: Number(attribute.version),
          choice: { state: "tbc" },
          actor: "qa",
        }),
      );
      expect(tbc.kind).toBe("standard_set");
      expect(await snapshotCount(recordId)).toBe(versions + 1);
      attribute = await timberAttribute(recordId);
      expect(attribute).toMatchObject({ standard_value: null, standard_option_id: null, standard_state: "tbc" });
      expect((await exported(recordId)).cell).toBe(`${CLIENT_WORDS} TBC`);

      // An attribute is its own row: the record never moved.
      expect(await recordVersion(recordId)).toBe(recordVersionBefore);

      // THE HISTORY SHOWS EACH STEP. The last two versions differ on the
      // standard, and `value` -- the client's words -- is not in the diff.
      const snaps = (
        await client.query(`select atoms from record_snapshots where record_id = $1 order by snapshot_no desc limit 2`, [recordId])
      ).rows;
      const diff = diffSnapshots(parseAtoms(snaps[1].atoms), parseAtoms(snaps[0].atoms));
      const fields = diff.attributes.flatMap((line) => line.fields.map((field) => field.label));
      expect(fields).toContain("BW standard");
      expect(fields).not.toContain("Value");
    },
    SLOW,
  );

  it(
    "a correction carries the standard forward, and the retired row keeps it",
    async () => {
      const recordId = confirmedRecord;
      let attribute = await timberAttribute(recordId);
      const proposed = await withTransaction((txn) =>
        setAttributeStandard(txn, {
          attributeId: attribute.id,
          expectedVersion: Number(attribute.version),
          choice: { state: "proposed", value: options[0]!.value },
          actor: "qa",
        }),
      );
      expect(proposed.kind).toBe("standard_set");
      attribute = await timberAttribute(recordId);

      const corrected = await withTransaction((txn) =>
        correctAttribute(txn, {
          attributeId: attribute.id,
          expectedVersion: Number(attribute.version),
          value: "__QA feet dark tinted oak as per approved sample",
          unit: null,
          state: "confirmed",
          reason: "__QA misread the page",
          actor: "qa",
        }),
      );
      const fresh = await timberAttribute(recordId);
      expect(fresh.id).toBe(corrected.attributeId);
      expect(fresh).toMatchObject({
        value: "__QA feet dark tinted oak as per approved sample",
        standard_value: options[0]!.value,
        standard_option_id: options[0]!.id,
        standard_state: "proposed",
      });
      const old = (
        await client.query(`select status, standard_value, standard_state from record_attributes where id = $1`, [attribute.id])
      ).rows[0];
      expect(old).toMatchObject({ status: "retired", standard_value: options[0]!.value, standard_state: "proposed" });
    },
    SLOW,
  );

  it(
    "the backfill lists a pre-0041 pick, restores the client's words, and a second run does nothing",
    async () => {
      const code = `__QA B-${Date.now()}`;
      const recordId = await item("__QA Bench", code);
      const option = options[1]!;
      // The shape the old confirm left: the option in value, the drawing's
      // words only in the staged JSON, the link in applied.attributeIds.
      const intakeId = await stage(doc(code, timberCallout({ reviewStatus: "applied", value: option.value })));
      const attributeId = await documentSpec(recordId, intakeId, option.value);
      await client.query(
        `update intake_runs set status = 'confirmed',
           parsed = jsonb_set(parsed, '{items,0,observations,0,applied}', $2::jsonb)
         where id = $1`,
        [intakeId, JSON.stringify({ attributeIds: [attributeId] })],
      );

      const plan = await planStandardBackfill(sql, projectId);
      const mine = plan.rows.filter((row) => row.recordId === recordId);
      expect(mine).toEqual([
        expect.objectContaining({ attributeId, option: option.value, optionId: option.id, clientWords: CLIENT_WORDS }),
      ]);
      // The dry run wrote nothing.
      expect((await timberAttribute(recordId)).value).toBe(option.value);

      const versionsBefore = await snapshotCount(recordId);
      const applied = await withTransaction((txn) => applyStandardBackfill(txn, projectId, mine, "system:qa-backfill"));
      expect(applied.changed).toBe(1);
      expect(await snapshotCount(recordId)).toBe(versionsBefore + 1);
      expect(await timberAttribute(recordId)).toMatchObject({
        value: CLIENT_WORDS,
        standard_value: option.value,
        standard_option_id: option.id,
        standard_state: "proposed",
      });
      expect(await timberAnswer(recordId)).toMatchObject({ value: option.value, value_raw: CLIENT_WORDS, state: "tbc" });

      // SAFE TO RE-RUN: nothing left to plan, and an apply of the old plan
      // opens no change set at all.
      const again = await planStandardBackfill(sql, projectId);
      expect(again.rows.filter((row) => row.recordId === recordId)).toEqual([]);
      const changesBefore = Number(
        (await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n,
      );
      const second = await withTransaction((txn) => applyStandardBackfill(txn, projectId, mine, "system:qa-backfill"));
      expect(second).toEqual({ changed: 0, changeSetId: null });
      expect(
        Number((await client.query(`select count(*)::int as n from change_sets where project_id = $1`, [projectId])).rows[0].n),
      ).toBe(changesBefore);
    },
    SLOW,
  );

  it(
    "the backfill reports, and does not guess, an attribute it cannot link",
    async () => {
      const code = `__QA C-${Date.now()}`;
      const recordId = await item("__QA Chair", code);
      const option = options[0]!;
      const intakeId = await stage({
        ...doc(code, timberCallout({ reviewStatus: "applied", value: option.value, applied: { attributeIds: [] } })),
      });
      // A second applied row writing the same option with different words.
      await client.query(
        `update intake_runs set status = 'confirmed',
           parsed = jsonb_set(parsed, '{items,0,observations,1}', $2::jsonb, true)
         where id = $1`,
        [
          intakeId,
          JSON.stringify(
            timberCallout({
              id: "obs-other",
              reviewStatus: "applied",
              value: option.value,
              valueRaw: "__QA something else entirely",
              applied: { attributeIds: [] },
            }),
          ),
        ],
      );
      const attributeId = await documentSpec(recordId, intakeId, option.value);

      const plan = await planStandardBackfill(sql, projectId);
      expect(plan.rows.some((row) => row.attributeId === attributeId)).toBe(false);
      expect(plan.ambiguous.map((row) => row.attributeId)).toContain(attributeId);
    },
    SLOW,
  );
});
