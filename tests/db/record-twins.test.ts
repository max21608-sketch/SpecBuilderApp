// Database tier — 0060: two bill lines linked as one item (a TWIN).
//
// What it holds, because each lives in SQL and not in the pure reading:
//  - one row per unordered pair: (A, B) and (B, A) are the same link;
//  - a link is between two BILL LINES of one project, refused in words for a
//    configuration and by 0060's trigger for a direct insert;
//  - a configuration is answered with its bill line's twins;
//  - unlinking retires (with a reason), and linking again RESTORES the row;
//  - a link needs a reason, and an open change satisfies it;
//  - a link touches no spec: spec_records.version and record_snapshots
//    unmoved, and the change-history coverage assertion stays green.
import { it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { sql } from "@/lib/db";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { insertVariant } from "@/lib/variant-create";
import { openChangeSet } from "@/lib/change-sets";
import { linkTwins, twinsOf, unlinkTwins } from "@/lib/record-twins";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("0060 twin lines", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";
  let guest = "";
  let ambassador = "";
  let presidential = "";
  let foreign = "";
  let configuration = "";

  async function line(project: string, runId: string, ref: string, area: string): Promise<string> {
    return (
      await withTransaction((txn) =>
        createRecord(txn, { projectId: project, runId, itemDescription: "Stool", clientRef: ref, qty: 2, area, actor: "qa" }),
      )
    ).recordId;
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Twins', 'qa', 'qa') returning id`,
        [qaNumber("P00060")],
      )
    ).rows[0].id;
    otherProjectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Twins other', 'qa', 'qa') returning id`,
        [qaNumber("P00061")],
      )
    ).rows[0].id;
    const runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA Main", actor: "qa" }))).runId;
    const otherRun = (await withTransaction((txn) => createRun(txn, { projectId: otherProjectId, name: "__QA Main", actor: "qa" }))).runId;
    guest = await line(projectId, runId, "GR-FUR-13", "Guest Suites");
    ambassador = await line(projectId, runId, "PL-FUR-13", "Ambassador Suite");
    presidential = await line(projectId, runId, "PL-FUR-13", "Presidential Suite");
    foreign = await line(otherProjectId, otherRun, "GR-FUR-13", "Guest Suites");
    configuration = (
      await withTransaction((txn) =>
        insertVariant(txn, { parentId: guest, label: "A", splitReason: "configuration", dimensionNote: null, actor: "qa" }),
      )
    ).recordId;
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from projects where id = any($1::uuid[])`, [[projectId, otherProjectId]]);
    await client.end();
  }, SLOW);

  it("links two lines once, whichever way round", async () => {
    const before = await client.query(`select id, version from spec_records where id = any($1::uuid[]) order by id`, [[guest, ambassador]]);
    const linked = await withTransaction((txn) =>
      linkTwins(txn, { recordId: guest, otherId: ambassador, reason: "__QA Same stool, two suites", actor: "qa" }),
    );
    expect(linked.restored).toBe(false);

    await expect(
      withTransaction((txn) => linkTwins(txn, { recordId: ambassador, otherId: guest, reason: "again", actor: "qa" })),
    ).rejects.toMatchObject({ code: "already_twins" });
    // The index itself, not only the function: a direct insert the other way round.
    await expect(
      client.query(
        `insert into spec_record_twins (project_id, record_a, record_b, reason) values ($1, $2, $3, 'x')`,
        [projectId, ambassador, guest],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    // A link changes no spec: no record version, no snapshot.
    const after = await client.query(`select id, version from spec_records where id = any($1::uuid[]) order by id`, [[guest, ambassador]]);
    expect(after.rows).toEqual(before.rows);
    const snapshots = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [linked.changeSetId]);
    expect(snapshots.rows[0].n).toBe(0);
    const change = await client.query(`select kind, reason from change_sets where id = $1`, [linked.changeSetId]);
    expect(change.rows[0]).toEqual({ kind: "twin_link", reason: "__QA Same stool, two suites" });
  }, SLOW);

  it("answers from either end, and a configuration with its bill line's twins", async () => {
    expect((await twinsOf(sql, guest)).map((twin) => twin.recordId)).toEqual([ambassador]);
    const fromAmbassador = await twinsOf(sql, ambassador);
    expect(fromAmbassador.map((twin) => twin.recordId)).toEqual([guest]);
    expect(fromAmbassador[0]).toMatchObject({ area: "Guest Suites", boqCodes: ["GR-FUR-13"], qty: 2 });
    expect((await twinsOf(sql, configuration)).map((twin) => twin.recordId)).toEqual([ambassador]);
  }, SLOW);

  it("refuses a configuration, another project's line and itself", async () => {
    await expect(
      withTransaction((txn) => linkTwins(txn, { recordId: configuration, otherId: presidential, reason: "x", actor: "qa" })),
    ).rejects.toMatchObject({ code: "twin_not_a_line" });
    await expect(
      withTransaction((txn) => linkTwins(txn, { recordId: guest, otherId: foreign, reason: "x", actor: "qa" })),
    ).rejects.toMatchObject({ code: "twin_other_project" });
    await expect(
      withTransaction((txn) => linkTwins(txn, { recordId: guest, otherId: guest, reason: "x", actor: "qa" })),
    ).rejects.toMatchObject({ code: "twin_self" });
    // The trigger, for a writer that skips the function.
    await expect(
      client.query(`insert into spec_record_twins (project_id, record_a, record_b, reason) values ($1, $2, $3, 'x')`, [
        projectId,
        configuration,
        presidential,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`insert into spec_record_twins (project_id, record_a, record_b, reason) values ($1, $2, $3, 'x')`, [
        projectId,
        presidential,
        foreign,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  }, SLOW);

  it("needs a reason, and an open change is one", async () => {
    await expect(
      withTransaction((txn) => linkTwins(txn, { recordId: guest, otherId: presidential, reason: null, actor: "qa-twins" })),
    ).rejects.toMatchObject({ code: "reason_required" });

    const open = await withTransaction((txn) =>
      openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa-twins", reason: "__QA Call with the designer", open: true }),
    );
    try {
      const linked = await withTransaction((txn) =>
        linkTwins(txn, { recordId: guest, otherId: presidential, reason: null, actor: "qa-twins" }),
      );
      expect(linked.changeSetId).toBe(open);
    } finally {
      await client.query(`update change_sets set closed_at = now() where id = $1`, [open]);
    }
  }, SLOW);

  it("unlinks by retiring, and linking again restores the same row", async () => {
    const [link] = (await twinsOf(sql, presidential)).filter((twin) => twin.recordId === guest);
    expect(link).toBeTruthy();
    await expect(
      withTransaction((txn) => unlinkTwins(txn, { twinId: link!.twinId, expectedVersion: link!.version, reason: null, actor: "qa" })),
    ).rejects.toMatchObject({ code: "reason_required" });
    await expect(
      withTransaction((txn) => unlinkTwins(txn, { twinId: link!.twinId, expectedVersion: link!.version + 5, reason: "x", actor: "qa" })),
    ).rejects.toMatchObject({ code: "twin_version_stale" });

    const unlinked = await withTransaction((txn) =>
      unlinkTwins(txn, { twinId: link!.twinId, expectedVersion: link!.version, reason: "__QA Different stools after all", actor: "qa" }),
    );
    const row = await client.query(`select status, retire_reason, retired_by from spec_record_twins where id = $1`, [link!.twinId]);
    expect(row.rows[0]).toEqual({ status: "retired", retire_reason: "__QA Different stools after all", retired_by: "qa" });
    expect((await client.query(`select kind from change_sets where id = $1`, [unlinked.changeSetId])).rows[0].kind).toBe("twin_unlink");
    expect((await twinsOf(sql, presidential)).map((twin) => twin.recordId)).toEqual([]);

    const again = await withTransaction((txn) =>
      linkTwins(txn, { recordId: presidential, otherId: guest, reason: "__QA They are one stool", actor: "qa" }),
    );
    expect(again).toMatchObject({ twinId: link!.twinId, restored: true });
    const count = await client.query(
      `select count(*)::int as n from spec_record_twins where least(record_a, record_b) = least($1::uuid, $2::uuid)
         and greatest(record_a, record_b) = greatest($1::uuid, $2::uuid)`,
      [guest, presidential],
    );
    expect(count.rows[0].n).toBe(1);
  }, SLOW);

  it("does not follow a link to a retired line", async () => {
    await client.query(`update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`, [presidential]);
    try {
      expect((await twinsOf(sql, guest)).map((twin) => twin.recordId)).toEqual([ambassador]);
    } finally {
      await client.query(`update spec_records set status = 'active', retired_at = null, retired_by = null where id = $1`, [presidential]);
    }
  }, SLOW);
});
