// Database tier — a bill is never refused; it is mapped (0040), through the
// REAL routes.
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node ~/dev/localstack/one-db-test.mjs tests/db/boq-columns.test.ts
//
// ============================================================================
// WHAT THE PURE TIER CANNOT PROVE.
//
//   * THE SEED IS THE OLD LIST. The reader loads its vocabulary from
//     `boq_column_aliases` now, and the day it did, every bill had to read
//     exactly as before — so the seeded rows are compared with the constant
//     they replaced.
//   * A bill nobody could read is PARSED, not failed; its columns can be set
//     from the STORED source through `/api/imports/[id]/columns`, fenced on
//     the run's version; and the confirm then writes what the person mapped —
//     the area composed with its Sub-Area, the bill's own unit, and its notes
//     on a new record.
//   * A layout saved from one copy of a bill reads the other on its own.
//
// The bill is the SYNTHETIC pricing-document layout (tests/fixtures), and the
// document store is stubbed to hand back its bytes: a bill is read by code, so
// the store is the only thing between this test and the real route. No model
// is called. Every row is `__QA`, and the project takes its changes with it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { REFERENCE_BOQ_ALIASES, assertBoqDocument } from "@/lib/boq-import";
import { foldHeading } from "@/lib/boq-roles";
import { pricingDocWorkbook } from "../fixtures/build-boq";

const stored: { bytes: Buffer } = { bytes: Buffer.alloc(0) };
vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  const meta = (pathname: string) => ({
    pathname,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: stored.bytes.byteLength,
  });
  return {
    ...actual,
    readTrustedBlob: async (pathname: string) => ({ ...meta(pathname), bytes: stored.bytes }),
    headTrustedBlob: async (pathname: string) => meta(pathname),
  };
});

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
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The pricing document's columns, as a reviewer sets them on the panel. */
const PRICING_COLUMNS = {
  sourceLine: 0,
  area: 1,
  subArea: 2,
  boqCategory: 3,
  code: 4,
  itemDescription: 7,
  qtyUnit: 11,
  qty: 12,
  notes: 16,
};

describeIfDb("a bill is mapped, not refused", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  const layoutName = qaNumber("pricing document layout");
  // Per run, so no layout already in the database (saved from the real bill,
  // whose headings the fixture copies) can read this fixture.
  const codeHeading = qaNumber("Spec Code");

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ($1, '__QA bill columns', '__QA Example Client', 'qa', 'qa') returning id`,
        [qaNumber("P90040")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from boq_layouts where name = $1`, [layoutName]);
    if (projectId) {
      await client.query(
        `delete from status_history where entity_id in (select id from spec_records where project_id = $1)`,
        [projectId],
      );
      await client.query(
        `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
        [projectId],
      );
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function register(bytes: Buffer, filename: string): Promise<{ status: number; importId: string; body: Record<string, unknown> }> {
    stored.bytes = bytes;
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      request({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/${filename}`,
        filename,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, importId: String(body.importId), body };
  }

  async function run(importId: string) {
    return (
      await client.query(`select status, error, version, parsed from intake_runs where id = $1`, [importId])
    ).rows[0] as { status: string; error: string | null; version: number; parsed: unknown };
  }

  async function columns(importId: string, body: unknown) {
    const { POST } = await import("@/app/api/imports/[id]/columns/route");
    const res = await POST(request(body), params(importId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function confirm(importId: string, version: number) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const res = await POST(request({ version }), params(importId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("seeds exactly the synonym list the reader used to carry in code", async () => {
    const rows = await client.query(`select role, term, term_norm from boq_column_aliases order by term_norm`);
    const seeded = rows.rows.map((row) => `${row.role}:${row.term_norm}`).sort();
    const reference = REFERENCE_BOQ_ALIASES.map((alias) => `${alias.role}:${foldHeading(alias.term)}`).sort();
    // DAY ONE READS EXACTLY AS BEFORE. When a term is added from verified
    // wording this equality changes on purpose, in the same commit as the seed.
    expect(seeded).toEqual(reference);
    for (const row of rows.rows) expect(row.term_norm).toBe(foldHeading(String(row.term)));
  });

  let unreadId = "";

  it("stages a bill nobody could read as PARSED, every sheet needing its columns", async () => {
    const { status, importId, body } = await register(
      await pricingDocWorkbook({ titled: false, sharedFormulaGap: true, codeHeading }),
      "__QA pricing VML.xlsx",
    );
    expect(status).toBe(201);
    expect(body.needsColumns).toBe(2);
    unreadId = importId;
    const staged = await run(importId);
    expect(staged.status).toBe("parsed");
    expect(staged.error).toBeNull();
    const doc = assertBoqDocument(staged.parsed);
    expect(doc.schemaVersion).toBe(4);
    expect(doc.sheets.map((sheet) => [sheet.sheetName, sheet.needsColumns, sheet.ignored])).toEqual([
      ["CASEGOODS+SEATING+TABLES", true, false],
      ["LOGISTICS", true, false],
    ]);
    expect(doc.sheets[0]!.preview!.length).toBeGreaterThan(5);

    // The confirm refuses while a live sheet needs its columns, by name.
    const refused = await confirm(importId, staged.version);
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/Say which column is which on “CASEGOODS\+SEATING\+TABLES”, “LOGISTICS”/);
  });

  it("refuses a stale version, and a mapping with no code or description, in words", async () => {
    const staged = await run(unreadId);
    const stale = await columns(unreadId, {
      sheetIndex: 0, headerRow: 1, headerRows: 1, columns: PRICING_COLUMNS, version: staged.version - 1,
    });
    expect(stale.status).toBe(409);
    const empty = await columns(unreadId, {
      sheetIndex: 0, headerRow: 1, headerRows: 1, columns: { qty: 12 }, version: staged.version,
    });
    expect(empty.status).toBe(400);
    expect(String(empty.body.error)).toMatch(/code or the item description/);
    expect((await run(unreadId)).version).toBe(staged.version);
  });

  it("reads the stored bill with a person's columns, and bumps the version", async () => {
    const before = await run(unreadId);
    const read = await columns(unreadId, {
      sheetIndex: 0, headerRow: 1, headerRows: 1, columns: PRICING_COLUMNS, version: before.version,
    });
    expect(read.status).toBe(200);
    expect(read.body.lines).toBe(8);
    const after = await run(unreadId);
    expect(after.version).toBeGreaterThan(before.version);
    const sheet = assertBoqDocument(after.parsed).sheets[0]!;
    expect(sheet).toMatchObject({ needsColumns: false, mappingSource: "person", columnsChecked: true, ignored: false });
    expect(sheet.columns?.code).toEqual({ index: 4, heading: codeHeading });
    // Re-suggested by the same function registration uses.
    expect(sheet.lines[0]).toMatchObject({ index: 0, code: "ZZ-FUR-10", ignored: false, levelStatus: "suggested" });
    expect(sheet.lines.map((line) => line.sourceLine)).toContain(null); // the formula with no cached value
  });

  it("confirms what the person mapped: area with its Sub-Area, the unit, and the notes", async () => {
    // The tender summary is not a bill: drop it, the way the panel's
    // "Not a bill" does, through the sheet PATCH that already exists.
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const dropped = await PATCH(request({ sheetIndex: 1, ignored: true }, "PATCH"), params(unreadId));
    expect(dropped.status).toBe(200);

    const staged = await run(unreadId);
    const done = await confirm(unreadId, staged.version);
    expect(done.status).toBe(200);
    // Seven records, not eight: the fabric row reads "ZZ-FAB-13 (ZZ-FUR-10)",
    // and the bracket names its item, so Step 2's rule makes it a fabric spec
    // ON that item rather than a record of its own.
    expect(done.body.imported).toBe(7);
    expect(done.body.fabricSpecs).toBe(1);

    const rows = await client.query(
      `select r.id, r.area, r.qty, r.qty_unit, r.internal_notes, r.boq_category, r.source_line_no,
              (select ref_value from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code') as code
         from spec_records r
        where r.source_import_id = $1
        order by r.record_no`,
      [unreadId],
    );
    expect(rows.rows[0]).toMatchObject({
      area: "Example Suites / Example Corridor",
      qty: 54,
      qty_unit: "ea",
      internal_notes: null,
      boq_category: "SEAT-X",
      source_line_no: 2,
      code: "ZZ-FUR-10",
    });
    // The fabric row is on its item, the code without the bracket.
    expect(rows.rows.some((row) => row.code === "ZZ-FAB-13 (ZZ-FUR-10)")).toBe(false);
    const fabric = await client.query(
      `select value, material_code from record_attributes where record_id = $1 and status = 'active' and label = 'Fabric'`,
      [rows.rows[0].id],
    );
    expect(fabric.rows).toHaveLength(1);
    expect(fabric.rows[0].material_code).toBe("ZZ-FAB-13");
    // A fabric row no bracket places stays a line: no quantity, never a 1, and its unit.
    expect(rows.rows.find((row) => row.code === "N/A")).toMatchObject({ qty: null, qty_unit: "m" });
    // The same code twice, told apart by the notes that became internal notes.
    expect(rows.rows.filter((row) => row.code === "ZZ-FUR-03").map((row) => [row.qty, row.internal_notes])).toEqual([
      [9, "OPTION 1"],
      [3, "OPTION 2"],
    ]);
  });

  it("saves a layout from the mapping that was read, and the other copy then reads on its own", async () => {
    // Saved from the CONFIRMED copy: a layout is a person's decision, and it
    // outlives the bill it was made on.
    const { POST: saveLayout, GET: listLayouts } = await import("@/app/api/boq-layouts/route");
    const saved = await saveLayout(request({ importId: unreadId, sheetIndex: 0, name: layoutName }));
    expect(saved.status).toBe(201);
    const again = await saveLayout(request({ importId: unreadId, sheetIndex: 0, name: layoutName }));
    expect(again.status).toBe(409);

    const listed = (await (await listLayouts()).json()) as { layouts: { name: string; mapping: Record<string, string>; headerRows: number }[] };
    const layout = listed.layouts.find((row) => row.name === layoutName)!;
    expect(layout.headerRows).toBe(1);
    expect(layout.mapping).toMatchObject({ code: foldHeading(codeHeading), subArea: "sub-area", sourceLine: "line", notes: "notes" });
    // No price, cost or picture column is in a layout.
    expect(Object.values(layout.mapping)).not.toContain("unit price usd $");

    // The ORIGINAL copy: its header is seven rows further down.
    const { status, importId } = await register(await pricingDocWorkbook({ titled: true, codeHeading }), "__QA pricing.xlsx");
    expect(status).toBe(201);
    const doc = assertBoqDocument((await run(importId)).parsed);
    const sheet = doc.sheets[0]!;
    expect(sheet).toMatchObject({ mappingSource: "layout", headerRow: 8, needsColumns: false });
    expect(sheet.layout?.name).toBe(layoutName);
    expect(sheet.columnsChecked).toBeUndefined();
    expect(sheet.lines).toHaveLength(8);
    expect(sheet.metadata.revision).toBe("Rev 0");
    // Beside a sheet that read, the tender summary is ignored with its reason.
    expect(doc.sheets[1]).toMatchObject({ ignored: true, ignoredReason: "No bill columns found on this sheet." });

    // Closing the panel records the look.
    const version = (await run(importId)).version;
    const checked = await columns(importId, { action: "checked", sheetIndex: 0, version });
    expect(checked.status).toBe(200);
    expect(assertBoqDocument((await run(importId)).parsed).sheets[0]!.columnsChecked).toBe(true);
  });

  it("reads a FAILED bill again from its stored source, with no new upload", async () => {
    // The shape every bill refused before 0040 is in: failed, no staged JSON,
    // an attachment holding the original.
    stored.bytes = await pricingDocWorkbook({ titled: true, codeHeading });
    const attachment = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
       values ('project', $1, 'boq', $2, '__QA refused.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, 'qa')
       returning id`,
      [projectId, `projects/${projectId}/uploads/__QA refused.xlsx`],
    );
    const failed = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, status, error, created_by, updated_by)
       values ($1, $2, 'boq_xlsx', 'failed', 'Could not find a header row on any sheet.', 'qa', 'qa') returning id, version`,
      [projectId, attachment.rows[0].id],
    );
    const id = String(failed.rows[0].id);
    const reread = await columns(id, { action: "reread", version: Number(failed.rows[0].version) });
    expect(reread.status).toBe(200);
    const after = await run(id);
    expect(after.status).toBe("parsed");
    expect(after.error).toBeNull();
    // The layout saved above reads it on its own.
    expect(assertBoqDocument(after.parsed).sheets[0]!.mappingSource).toBe("layout");
  });

  it("asks for the file again where the original was not kept", async () => {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, error, created_by, updated_by)
       values ($1, 'boq_xlsx', 'failed', 'refused', 'qa', 'qa') returning id, version`,
      [projectId],
    );
    const res = await columns(String(run.rows[0].id), { action: "reread", version: Number(run.rows[0].version) });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/was not kept.*Upload the file again/);
  });
});
