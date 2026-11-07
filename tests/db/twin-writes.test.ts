// Database tier — a person's spec act on a bill line, written on its twins
// (0060, `twin-writes.ts`).
//
// What it holds:
//  - Add on a line and its twin: two rows, each its own, ONE change set, one
//    version per record, spec_records.version untouched;
//  - a twin that HOLDS the slot is refused unless the request names the row
//    it replaces, and then that row is superseded, never edited;
//  - Edit value reaches a twin whose row said the same, and a twin whose row
//    differs is refused as "not offered" with NOTHING written;
//  - Retire likewise;
//  - a line that is not a twin, and a configuration's act, write nothing.
import { it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { sql } from "@/lib/db";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { insertVariant } from "@/lib/variant-create";
import { linkTwins, twinsOf } from "@/lib/record-twins";
import { loadTwinAttributes, twinOffer } from "@/lib/twin-offer";
import { correctAttributeWithTwins, createAttributeWithTwins, retireAttributeWithTwins } from "@/lib/twin-writes";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("twin writes", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let guest = "";
  let ambassador = "";
  let stranger = "";
  let configuration = "";

  async function active(recordId: string, slot: string) {
    const rows = await client.query(
      `select id, version, value, source_run_id from record_attributes where record_id = $1 and dimension_slot = $2 and status = 'active'`,
      [recordId, slot],
    );
    return rows.rows;
  }

  async function attributeCount(): Promise<number> {
    const rows = await client.query(
      `select count(*)::int as n from record_attributes a join spec_records r on r.id = a.record_id where r.project_id = $1`,
      [projectId],
    );
    return rows.rows[0].n;
  }

  async function versionsIn(changeSetId: string) {
    const rows = await client.query(
      `select record_id, count(*)::int as n from record_snapshots where change_set_id = $1 group by record_id order by record_id`,
      [changeSetId],
    );
    return rows.rows;
  }

  async function recordVersions() {
    return (
      await client.query(`select id, version from spec_records where id = any($1::uuid[]) order by id`, [[guest, ambassador]])
    ).rows;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Twin writes', 'qa', 'qa') returning id`,
        [qaNumber("P00062")],
      )
    ).rows[0].id;
    const runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    const make = async (ref: string) =>
      (await withTransaction((txn) => createRecord(txn, { projectId, runId, itemDescription: "Stool", clientRef: ref, qty: 1, actor: "qa" })))
        .recordId;
    guest = await make("GR-FUR-13");
    ambassador = await make("PL-FUR-13");
    stranger = await make("GR-FUR-14");
    configuration = (
      await withTransaction((txn) =>
        insertVariant(txn, { parentId: stranger, label: "A", splitReason: "configuration", dimensionNote: null, actor: "qa" }),
      )
    ).recordId;
    await withTransaction((txn) => linkTwins(txn, { recordId: guest, otherId: ambassador, reason: "__QA One stool", actor: "qa" }));
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  const width = (recordId: string, value: string) => ({
    recordId,
    attrGroup: "dimension",
    label: "Width",
    value,
    unit: "mm",
    dimensionSlot: "W",
    state: "confirmed" as const,
    actor: "qa",
  });

  it("adds a spec to a line and its twin: one change, one version each, the record row untouched", async () => {
    const before = await recordVersions();
    const result = await withTransaction((txn) =>
      createAttributeWithTwins(txn, { ...width(guest, "540"), alsoRecords: [{ recordId: ambassador }] }),
    );
    expect(result.twins.map((twin) => twin.recordId)).toEqual([ambassador]);

    const mine = await active(guest, "W");
    const theirs = await active(ambassador, "W");
    expect(mine.map((row) => row.value)).toEqual(["540"]);
    expect(theirs.map((row) => row.value)).toEqual(["540"]);
    // Two rows, each its own: never one row shared.
    expect(mine[0].id).not.toBe(theirs[0].id);
    expect(theirs[0].source_run_id).toBeNull();

    expect(await versionsIn(result.changeSetId)).toEqual(
      [guest, ambassador].sort().map((record_id) => ({ record_id, n: 1 })),
    );
    expect(await recordVersions()).toEqual(before);
  }, SLOW);

  it("refuses a held slot unless the request names the row it replaces, then supersedes it", async () => {
    // The twin's depth already says 600; this line has none.
    const held = await withTransaction((txn) =>
      createAttributeWithTwins(txn, {
        ...width(ambassador, "600"),
        label: "Depth",
        dimensionSlot: "D",
        alsoRecords: [],
      }),
    );
    const count = await attributeCount();
    const depth = { ...width(guest, "610"), label: "Depth", dimensionSlot: "D" };

    // The offer the screen draws: held, UNTICKED, with the value beside it.
    const twins = await twinsOf(sql, guest);
    const live = await loadTwinAttributes(sql, [ambassador]);
    const liveOffer = twinOffer(
      { act: "add", attrGroup: "dimension", label: "Depth", dimensionSlot: "D", specFieldId: null },
      twins.map((twin) => ({ ...twin, attributes: live.get(twin.recordId) ?? [] })),
    );
    expect(liveOffer[0]).toMatchObject({ status: "held", offered: true, ticked: false });

    await expect(
      withTransaction((txn) => createAttributeWithTwins(txn, { ...depth, alsoRecords: [{ recordId: ambassador }] })),
    ).rejects.toMatchObject({ code: "twin_changed" });
    expect(await attributeCount()).toBe(count);

    const replaced = await withTransaction((txn) =>
      createAttributeWithTwins(txn, {
        ...depth,
        alsoRecords: [{ recordId: ambassador, attributeId: held.attributeId, version: 1 }],
      }),
    );
    expect(replaced.twins[0]?.replacedId).toBe(held.attributeId);
    expect((await active(ambassador, "D")).map((row) => row.value)).toEqual(["610"]);
    const old = await client.query(`select status, superseded_by_id from record_attributes where id = $1`, [held.attributeId]);
    expect(old.rows[0]).toEqual({ status: "retired", superseded_by_id: replaced.twins[0]!.attributeId });
  }, SLOW);

  it("corrects a twin whose row says the same, and refuses one that differs with nothing written", async () => {
    const [mine] = await active(guest, "W");
    const [theirs] = await active(ambassador, "W");
    const corrected = await withTransaction((txn) =>
      correctAttributeWithTwins(txn, {
        attributeId: mine.id,
        expectedVersion: mine.version,
        value: "550",
        unit: "mm",
        state: "confirmed",
        reason: "__QA Measured again",
        actor: "qa",
        alsoRecords: [{ recordId: ambassador, attributeId: theirs.id, version: theirs.version }],
      }),
    );
    expect((await active(guest, "W")).map((row) => row.value)).toEqual(["550"]);
    expect((await active(ambassador, "W")).map((row) => row.value)).toEqual(["550"]);
    expect(await versionsIn(corrected.changeSetId)).toHaveLength(2);

    // Now the twin is changed on its own, and the next edit must leave it alone.
    const [twinNow] = await active(ambassador, "W");
    await withTransaction((txn) =>
      correctAttributeWithTwins(txn, {
        attributeId: twinNow.id,
        expectedVersion: twinNow.version,
        value: "560",
        unit: "mm",
        state: "confirmed",
        reason: "__QA The PL stool is wider",
        actor: "qa",
        alsoRecords: [],
      }),
    );
    const [mineNow] = await active(guest, "W");
    const [theirsNow] = await active(ambassador, "W");
    const count = await attributeCount();
    await expect(
      withTransaction((txn) =>
        correctAttributeWithTwins(txn, {
          attributeId: mineNow.id,
          expectedVersion: mineNow.version,
          value: "555",
          unit: "mm",
          state: "confirmed",
          reason: "x",
          actor: "qa",
          alsoRecords: [{ recordId: ambassador, attributeId: theirsNow.id, version: theirsNow.version }],
        }),
      ),
    ).rejects.toMatchObject({ code: "twin_not_offered" });
    expect(await attributeCount()).toBe(count);
    expect((await active(guest, "W")).map((row) => row.value)).toEqual(["550"]);
  }, SLOW);

  it("retires on a twin that says the same", async () => {
    const [mine] = await active(guest, "D");
    const [theirs] = await active(ambassador, "D");
    await withTransaction((txn) =>
      retireAttributeWithTwins(txn, {
        attributeId: mine.id,
        expectedVersion: mine.version,
        reason: "__QA Depth was a misreading",
        actor: "qa",
        alsoRecords: [{ recordId: ambassador, attributeId: theirs.id, version: theirs.version }],
      }),
    );
    expect(await active(guest, "D")).toEqual([]);
    expect(await active(ambassador, "D")).toEqual([]);
  }, SLOW);

  it("writes nothing for a line that is not a twin, or from a configuration", async () => {
    const count = await attributeCount();
    await expect(
      withTransaction((txn) =>
        createAttributeWithTwins(txn, { ...width(guest, "1"), label: "Height", dimensionSlot: "H", alsoRecords: [{ recordId: stranger }] }),
      ),
    ).rejects.toMatchObject({ code: "twins_changed" });
    await expect(
      withTransaction((txn) =>
        createAttributeWithTwins(txn, { ...width(configuration, "1"), alsoRecords: [{ recordId: guest }] }),
      ),
    ).rejects.toMatchObject({ code: "twins_changed" });
    expect(await attributeCount()).toBe(count);
  }, SLOW);
});
