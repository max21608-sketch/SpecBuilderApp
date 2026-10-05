// Database tier — settling a disagreement between two documents (0046).
//
// Skips silently without DATABASE_URL. On the local stack:
//   node ~/dev/localstack/one-db-test.mjs tests/db/disagreement-resolve.test.ts
//
// ============================================================================
// WHAT IS WORTH TESTING HERE RATHER THAN IN THE PURE TIER.
//
// Every one of these is a fact about the DATABASE:
//
//   * "keep" closes the disagreement and moves NOTHING else: the held row
//     stays live, no answer moves, no record version is taken — and the
//     change set still carries the kind and the reason
//   * "use this" is a supersession: the held row is retired and points at a
//     NEW row that keeps the OTHER document's run and page, the checklist is
//     recomposed from it, and the record takes exactly ONE version
//   * a stale version is a 409 and writes nothing, through the real route
//   * "use this" over a held value that has already been replaced is refused,
//     naming what replaced it — and the second disagreement stays open
//   * the phase table's route and the overview's summary count the same open
//     disagreements the record lists
//
// The disagreement rows are written DIRECTLY: recording them at confirm time is
// another path's job (`disagreement-record.ts`), and this file is about what a
// person does with one once it exists.
//
// Rows are prefixed `__QA ` and deleted FK-safe by deleting the project: 0014
// refuses a direct `delete from change_sets` and allows the cascade.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction, DomainConflictError } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { resolveDisagreement } from "@/lib/disagreement-resolve";
import { loadDisagreements } from "@/lib/disagreements";
import { loadProjectSummary } from "@/lib/project-summary";
import { sql } from "@/lib/db";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-disagree@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("settling a disagreement between documents", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let billRunId = "";
  let trackerRunId = "";

  async function item(description: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: description, categoryId, actor: "qa" }),
    );
    return record.recordId;
  }

  /** What the BILL said: a held dimension, sourced to the bill's intake run. */
  async function billSpec(
    recordId: string,
    over: { slot?: string; value?: string; unit?: string; label?: string } = {},
  ): Promise<{ id: string; version: number }> {
    const rows = await client.query(
      `insert into record_attributes
         (record_id, attr_group, label, value, unit, dimension_slot, state, source_run_id, created_by, updated_by)
       values ($1, 'dimension', $2, $3, $4, $5, 'confirmed', $6, 'qa', 'qa')
       returning id, version`,
      [recordId, over.label ?? "Width", over.value ?? '21"', over.unit ?? "in", over.slot ?? "W", billRunId],
    );
    return { id: rows.rows[0].id, version: Number(rows.rows[0].version) };
  }

  /** What the TRACKER said, recorded beside it on page 9. */
  async function disagreement(
    recordId: string,
    heldId: string,
    over: { value?: string; unit?: string; slot?: string; label?: string; sourceRunId?: string; page?: number } = {},
  ): Promise<{ id: string; version: number }> {
    const rows = await client.query(
      `insert into attribute_disagreements
         (project_id, record_id, held_attribute_id, source_run_id, source_page,
          attr_group, label, value, unit, dimension_slot, state, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'dimension', $6, $7, $8, $9, 'confirmed', 'qa', 'qa')
       returning id, version`,
      [
        projectId,
        recordId,
        heldId,
        over.sourceRunId ?? trackerRunId,
        over.page ?? 9,
        over.label ?? "Width",
        over.value ?? "540",
        over.unit ?? "mm",
        over.slot ?? "W",
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
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P00046")}', '__QA Documents disagree', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA MAIN", actor: "qa" }))).runId;
    billRunId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
         values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    trackerRunId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, 'spec_document', 'ffe_schedule', 'confirmed', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, uploaded_by)
       values ('intake_runs', $1, 'source', $2, '__QA OMS and FF&E Tracker.pdf', 'qa') returning id`,
      [trackerRunId, `projects/${projectId}/qa-tracker.pdf`],
    );
    await client.query(`update intake_runs set attachment_id = $1 where id = $2`, [attachment.rows[0].id, trackerRunId]);
  }, SLOW);

  afterAll(async () => {
    if (!projectId) {
      await client.end();
      return;
    }
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from attribute_disagreements where project_id = $1`, [projectId]);
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`update record_attributes set superseded_by_id = null where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`update intake_runs set attachment_id = null where project_id = $1`, [projectId]);
    await client.query(`delete from attachments where entity_type = 'intake_runs' and entity_id = $1`, [trackerRunId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("keeps the held value: closes the disagreement and moves nothing else", async () => {
    const recordId = await item("__QA Desk chair, kept");
    const held = await billSpec(recordId);
    const open = await disagreement(recordId, held.id);
    const snapshotsBefore = await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [
      recordId,
    ]);

    const result = await withTransaction((txn) =>
      resolveDisagreement(txn, {
        disagreementId: open.id,
        decision: "kept_held",
        expectedVersion: open.version,
        reason: "__QA The bill is the contract",
        actor: "qa",
      }),
    );
    expect(result.snapshotNo).toBeNull();
    expect(result.attributeId).toBeNull();

    const row = await client.query(
      `select status, resolved_by, resolved_at, change_set_id, resolved_attribute_id from attribute_disagreements where id = $1`,
      [open.id],
    );
    expect(row.rows[0]).toMatchObject({ status: "kept_held", resolved_by: "qa", resolved_attribute_id: null });
    expect(row.rows[0].resolved_at).not.toBeNull();
    expect(row.rows[0].change_set_id).toBe(result.changeSetId);

    const change = await client.query(`select kind, reason from change_sets where id = $1`, [result.changeSetId]);
    expect(change.rows[0]).toEqual({ kind: "disagreement_resolve", reason: "__QA The bill is the contract" });

    // NOTHING ELSE MOVED: the held row is live and unchanged, and no version.
    const heldAfter = await client.query(`select status, value, version from record_attributes where id = $1`, [held.id]);
    expect(heldAfter.rows[0]).toMatchObject({ status: "active", value: '21"' });
    expect(Number(heldAfter.rows[0].version)).toBe(held.version);
    const snapshotsAfter = await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [
      recordId,
    ]);
    expect(snapshotsAfter.rows[0].n).toBe(snapshotsBefore.rows[0].n);
  }, SLOW);

  it("uses the other document's value: the held row is superseded and the new one keeps the tracker's page", async () => {
    const recordId = await item("__QA Desk chair, used");
    const held = await billSpec(recordId);
    const open = await disagreement(recordId, held.id, { value: "540", unit: "mm" });
    const recordVersion = (await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0]
      .version;

    const result = await withTransaction((txn) =>
      resolveDisagreement(txn, {
        disagreementId: open.id,
        decision: "used_this",
        expectedVersion: open.version,
        heldVersion: held.version,
        reason: "__QA The tracker of 24 Aug is the later statement",
        actor: "qa",
      }),
    );

    const old = await client.query(`select status, superseded_by_id, value from record_attributes where id = $1`, [held.id]);
    expect(old.rows[0]).toMatchObject({ status: "retired", superseded_by_id: result.attributeId, value: '21"' });

    const fresh = await client.query(
      `select value, unit, dimension_slot, attr_group, status, source_run_id, source_page, label
         from record_attributes where id = $1`,
      [result.attributeId],
    );
    expect(fresh.rows[0]).toMatchObject({
      value: "540",
      unit: "mm",
      dimension_slot: "W",
      attr_group: "dimension",
      status: "active",
      label: "Width",
    });
    // THE OTHER DOCUMENT'S PAGE, never the bill line it replaced.
    expect(fresh.rows[0].source_run_id).toBe(trackerRunId);
    expect(Number(fresh.rows[0].source_page)).toBe(9);

    const row = await client.query(`select status, resolved_attribute_id from attribute_disagreements where id = $1`, [
      open.id,
    ]);
    expect(row.rows[0]).toEqual({ status: "used_this", resolved_attribute_id: result.attributeId });

    // THE CHECKLIST IS RECOMPOSED from the attributes, never written directly.
    expect(await dimensionsAnswer(recordId)).toEqual({ value: "W540mm", state: "confirmed" });

    // ONE change set, ONE version — what the coverage assertion reads.
    const change = await client.query(`select kind, reason from change_sets where id = $1`, [result.changeSetId]);
    expect(change.rows[0].kind).toBe("disagreement_resolve");
    expect(change.rows[0].reason).toBe("__QA The tracker of 24 Aug is the later statement");
    const versions = await client.query(`select count(*)::int as n from record_snapshots where change_set_id = $1`, [
      result.changeSetId,
    ]);
    expect(versions.rows[0].n).toBe(1);
    expect(result.snapshotNo).not.toBeNull();
    // spec_records.version does not move: an attribute is its own row.
    const after = await client.query(`select version from spec_records where id = $1`, [recordId]);
    expect(Number(after.rows[0].version)).toBe(Number(recordVersion));
  }, SLOW);

  it("refuses a stale version with a 409 through the route, and writes nothing", async () => {
    const { POST } = await import("@/app/api/disagreements/[id]/resolve/route");
    const recordId = await item("__QA Desk chair, stale");
    const held = await billSpec(recordId);
    const open = await disagreement(recordId, held.id);
    const res = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "used_this", reason: "__QA should not land", version: open.version + 4 }),
      }),
      { params: Promise.resolve({ id: open.id }) },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body).toMatchObject({ ok: false, code: "disagreement_version_stale" });
    const row = await client.query(`select status from attribute_disagreements where id = $1`, [open.id]);
    expect(row.rows[0].status).toBe("open");
    const changes = await client.query(
      `select count(*)::int as n from change_sets where project_id = $1 and reason = '__QA should not land'`,
      [projectId],
    );
    expect(changes.rows[0].n).toBe(0);

    // A missing reason is a 400 the row can act on, never a decision.
    const blank = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "kept_held", reason: "   ", version: open.version }),
      }),
      { params: Promise.resolve({ id: open.id }) },
    );
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as { code: string }).code).toBe("reason_required");
  }, SLOW);

  it("refuses to use a second disagreement once the held value has been replaced, and it stays open", async () => {
    const recordId = await item("__QA Desk chair, two documents");
    const held = await billSpec(recordId);
    const first = await disagreement(recordId, held.id, { value: "540", unit: "mm", page: 9 });
    // A SECOND document saying something else again about the same width.
    const otherRunId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
         values ($1, 'spec_document', 'shop_drawings', 'confirmed', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const second = await disagreement(recordId, held.id, { value: "550", unit: "mm", sourceRunId: otherRunId, page: 2 });

    const used = await withTransaction((txn) =>
      resolveDisagreement(txn, {
        disagreementId: first.id,
        decision: "used_this",
        expectedVersion: first.version,
        reason: "__QA The tracker wins",
        actor: "qa",
      }),
    );

    let refused: unknown = null;
    try {
      await withTransaction((txn) =>
        resolveDisagreement(txn, {
          disagreementId: second.id,
          decision: "used_this",
          expectedVersion: second.version,
          reason: "__QA The drawing wins",
          actor: "qa",
        }),
      );
    } catch (cause) {
      refused = cause;
    }
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("held_replaced");
    expect((refused as DomainConflictError).status).toBe(409);
    expect((refused as Error).message).toMatch(/already been replaced by .*540/);

    // STILL OPEN, and listed under the row that replaced its held value.
    const listed = await loadDisagreements(sql, [recordId]);
    const stillOpen = listed.find((entry) => entry.id === second.id)!;
    expect(stillOpen.status).toBe("open");
    expect(stillOpen.heldStatus).toBe("retired");
    expect(stillOpen.currentAttributeId).toBe(used.attributeId);

    // It may still be KEPT.
    await withTransaction((txn) =>
      resolveDisagreement(txn, {
        disagreementId: second.id,
        decision: "kept_held",
        expectedVersion: second.version,
        reason: "__QA The tracker's 540 stands",
        actor: "qa",
      }),
    );
    const closed = await client.query(`select status from attribute_disagreements where id = $1`, [second.id]);
    expect(closed.rows[0].status).toBe("kept_held");
    await client.query(`delete from attribute_disagreements where source_run_id = $1`, [otherRunId]);
  }, SLOW);

  it("counts the same open disagreements on the phase table and the overview as the record lists", async () => {
    const recordId = await item("__QA Desk chair, counted");
    const width = await billSpec(recordId, { slot: "W" });
    const depth = await billSpec(recordId, { slot: "D", value: '24"', label: "Depth" });
    await disagreement(recordId, width.id);
    await disagreement(recordId, depth.id, { slot: "D", value: "610", label: "Depth" });

    const listed = (await loadDisagreements(sql, [recordId])).filter((entry) => entry.status === "open");
    expect(listed).toHaveLength(2);
    expect(listed[0]!.sourceFilename).toBe("__QA OMS and FF&E Tracker.pdf");
    expect(listed[0]!.heldFromBill).toBe(true);

    const { GET } = await import("@/app/api/records/route");
    const res = await GET(new Request(`http://localhost/api/records?projectId=${projectId}&runId=${runId}`));
    const body = (await res.json()) as {
      records: { id: string; open_disagreements: number; spec_summary: { dimensions: string; fromImperial: boolean } }[];
    };
    const row = body.records.find((record) => record.id === recordId)!;
    expect(row.open_disagreements).toBe(2);
    // The size line the table prints under the item: as printed, mm beside.
    expect(row.spec_summary.dimensions).toBe('W 21" (533mm) x D 24" (610mm)');
    expect(row.spec_summary.fromImperial).toBe(true);

    // The overview counts every open one on the project's live items — this
    // test's other cases leave none open — and lands on this phase.
    const summary = await loadProjectSummary(projectId);
    const total = await client.query(
      `select count(*)::int as n from attribute_disagreements where project_id = $1 and status = 'open'`,
      [projectId],
    );
    expect(summary.disagreements).toBe(total.rows[0].n);
    expect(summary.disagreements).toBeGreaterThanOrEqual(2);
    expect(summary.disagreementRunId).toBe(runId);
  }, SLOW);
});
