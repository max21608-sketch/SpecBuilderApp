// Database tier — the one qualifier a person types about the dimension cell.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/dimension-note.test.ts
//
// ============================================================================
// WHAT IS WORTH TESTING HERE RATHER THAN IN THE PURE TIER.
//
// The composer itself is pure and tested there. Every case below is a fact
// about the DATABASE or about the route:
//
//   * the note is a RECORD edit, so `spec_records.version` moves by exactly
//     one — unlike an attribute correction, which deliberately does not touch
//     it. One change set and one snapshot, which is what the whole-database
//     coverage assertion in change-history.test.ts reads.
//   * the snapshot's atoms carry it, so a version diff can show it changing.
//     Schema 5; a field added to the atoms and not to the Zod schema reads
//     back as absent on every snapshot.
//   * the EXPORT's own cell ends with the bracket, through `loadExportScope`
//     rather than a fixture — because the file is the thing that matters.
//   * the check sheet shows it apart, in the column a placement already uses.
//   * a newline is refused TWICE: by the route in words, and by 0034's CHECK.
//     A constraint the app forgets is a constraint the database keeps.
//
// ---- IT WAITS ON 0034 BEING APPLIED --------------------------------------
//
// The migration is written and NOT applied by whoever wrote it. Until the
// column exists on the sandbox, the cases that need it call `ctx.skip()` and
// say so, rather than failing and being read as a defect in the code. The two
// ROUTE refusals need no column — zod refuses before anything is written — so
// they run today and prove the half that does not wait.
//
// Rows are prefixed `__QA ` and deleted FK-safe by deleting the project: 0014
// refuses a direct `delete from change_sets` outright and allows the cascade.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";
import { composeRow, BWS_EXPORT_COLUMNS, DIMENSIONS_JSON_ID } from "@/lib/bws-export";
import { composeCheckSheet, CHECK_SHEET_HEADER } from "@/lib/export-check-sheet";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("the dimension note", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  /** False until 0034 has been applied to the sandbox. */
  let columnExists = false;

  /** Say plainly which cases were not run, rather than reporting a green. */
  const needsMigration = (ctx: { skip: (note?: string) => void }) => {
    if (!columnExists) ctx.skip("spec_records.dimension_note does not exist yet — 0034 is not applied");
  };

  async function item(description: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: description, categoryId, actor: "qa" }),
    );
    return record.recordId;
  }

  /** A width a document stated, so the cell has figures for the note to follow. */
  async function width(recordId: string, value: string): Promise<void> {
    await client.query(
      `insert into record_attributes
         (record_id, attr_group, label, value, unit, dimension_slot, state, created_by, updated_by)
       values ($1, 'dimension', 'Width', $2, 'mm', 'W', 'confirmed', 'qa', 'qa')`,
      [recordId, value],
    );
  }

  const version = async (recordId: string): Promise<number> =>
    Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);

  beforeAll(async () => {
    await client.connect();
    columnExists =
      (
        await client.query(
          `select 1 from information_schema.columns
            where table_name = 'spec_records' and column_name = 'dimension_note'`,
        )
      ).rowCount === 1;
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('__QA P00034', '__QA Dimension note', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA MAIN", actor: "qa" }))).runId;
  }, 60_000);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, 60_000);

  // ---- what the route refuses, with or without the column -------------------

  // Neither of these reaches a record: the body is refused by the route's own
  // schema before anything is loaded, which is what makes them runnable while
  // 0034 is still unapplied — and is also the point being asserted.
  const NO_SUCH_RECORD = "00000000-0000-0000-0000-0000000000ff";

  it("refuses a newline in words, before the database has to", async () => {
    const recordId = NO_SUCH_RECORD;
    const { PATCH } = await import("@/app/api/records/[id]/route");
    const res = await PATCH(patch({ details: { dimensionNote: "1250\nL-shaped return" }, version: 1 }), params(recordId));
    expect(res.status).toBe(400);
    const body = await res.json();
    // A newline inside a BWS cell is a change to the format of the file that
    // overwrites rather than fails, so the reply says what is wrong with the
    // box rather than reporting a constraint nobody can act on.
    expect(String(body.error)).toMatch(/one line/i);
    expect(String(body.field)).toContain("dimensionNote");
    // A carriage return is the same file, arriving from a different keyboard.
    expect(
      (await PATCH(patch({ details: { dimensionNote: "1250\r L-shaped" }, version: 1 }), params(recordId))).status,
    ).toBe(400);
  });

  it("refuses more than 200 characters, and names the cap", async () => {
    const recordId = NO_SUCH_RECORD;
    const { PATCH } = await import("@/app/api/records/[id]/route");
    const res = await PATCH(patch({ details: { dimensionNote: "x".repeat(201) }, version: 1 }), params(recordId));
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toContain("200");
  });

  // ---- what it writes, once 0034 is applied ---------------------------------

  it("writes it as ONE change, and moves the record's version by exactly one", async (ctx) => {
    needsMigration(ctx);
    const recordId = await item("__QA Sofa with a return");
    await width(recordId, "1830");
    const before = await version(recordId);
    const changesBefore = (
      await client.query(`select count(*)::int n from record_snapshots where record_id = $1`, [recordId])
    ).rows[0].n;

    const { PATCH } = await import("@/app/api/records/[id]/route");
    const res = await PATCH(
      patch({ details: { dimensionNote: "1250 L-shaped return" }, version: before }),
      params(recordId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toContain("dimension_note");

    // THIS IS A RECORD EDIT, unlike an attribute correction: the column is on
    // the row, so `bump_version` fires once and the version moves by one.
    expect(await version(recordId)).toBe(before + 1);

    const snapshots = await client.query(
      `select s.atoms, cs.kind from record_snapshots s
         join change_sets cs on cs.id = s.change_set_id
        where s.record_id = $1 order by s.snapshot_no desc`,
      [recordId],
    );
    expect(snapshots.rowCount).toBe(changesBefore + 1);
    expect(snapshots.rows[0].kind).toBe("manual_edit");
    // The atoms carry it, or a version diff has nothing to compare.
    expect(snapshots.rows[0].atoms.record.dimensionNote).toBe("1250 L-shaped return");
  });

  it("ends the EXPORT's dimensions cell with the bracket", async (ctx) => {
    needsMigration(ctx);
    const recordId = await item("__QA Sofa exported with a note");
    await width(recordId, "1830");
    const { PATCH } = await import("@/app/api/records/[id]/route");
    await PATCH(
      patch({ details: { dimensionNote: "1250 L-shaped return" }, version: await version(recordId) }),
      params(recordId),
    );

    const loaded = await loadExportScope(projectId, runId);
    if (isScopeFailure(loaded)) throw new Error(loaded.error);
    const record = loaded.scope.records.find((row) => row.id === recordId);
    if (!record) throw new Error("the record is not in the export's scope");
    const row = composeRow(loaded.scope, record, loaded.scope.attributes, loaded.scope.answers);
    const index = BWS_EXPORT_COLUMNS.findIndex((column) => column.jsonId === DIMENSIONS_JSON_ID);
    expect(row[index]).toBe("W1830mm (1250 L-shaped return)");
    // The file is the thing that matters, and a newline in it overwrites
    // rather than fails.
    for (const cell of row) expect(cell).not.toMatch(/[\r\n]/);

    // And the check sheet shows the two halves apart, so a reviewer reading
    // the cell against a page can tell which half the page said.
    const sheet = composeCheckSheet(loaded.scope);
    const dimensions = sheet.rows.find(
      (line) => line[0] === record.label && line[CHECK_SHEET_HEADER.indexOf("Field id")] === String(DIMENSIONS_JSON_ID),
    );
    if (!dimensions) throw new Error("the check sheet has no Dimensions line for this record");
    expect(dimensions[CHECK_SHEET_HEADER.indexOf("Exported value")]).toBe("W1830mm (1250 L-shaped return)");
    expect(dimensions[CHECK_SHEET_HEADER.indexOf("Qualifier")]).toBe("1250 L-shaped return");
  });

  it("is refused by the CHECK as well as by the route", async (ctx) => {
    needsMigration(ctx);
    const recordId = await item("__QA Sofa, constraint");
    // The app is not the enforcement. A hand fix with psql, a future route, or
    // a script that forgets is exactly what this constraint is for.
    await expect(
      client.query(`update spec_records set dimension_note = $1 where id = $2`, ["1250\nreturn", recordId]),
    ).rejects.toThrow(/dimension_note/);
    await expect(
      client.query(`update spec_records set dimension_note = $1 where id = $2`, ["x".repeat(201), recordId]),
    ).rejects.toThrow(/dimension_note/);
  });

  it("clears back to null, because a note somebody typed by mistake must go", async (ctx) => {
    needsMigration(ctx);
    const recordId = await item("__QA Sofa, cleared note");
    const { PATCH } = await import("@/app/api/records/[id]/route");
    await PATCH(patch({ details: { dimensionNote: "1250 L-shaped return" }, version: await version(recordId) }), params(recordId));
    await PATCH(patch({ details: { dimensionNote: null }, version: await version(recordId) }), params(recordId));
    const stored = await client.query(`select dimension_note from spec_records where id = $1`, [recordId]);
    expect(stored.rows[0].dimension_note).toBeNull();
  });
});
