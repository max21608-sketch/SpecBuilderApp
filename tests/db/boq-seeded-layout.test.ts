// Database tier — a SEEDED bill layout reads like a known heading (2026-09-30).
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/boq-seeded-layout.test.ts
//
// ============================================================================
// WHAT THIS HOLDS.
//
// On pilot the Aman pricing document was read by the MODEL — a charged
// structure read — and then waited for a person to tick "the columns are
// right", because the layout a person had saved for it lived in one other
// database. `db/seed/0013_boq_layouts.sql` makes it seed data, and a seeded
// layout (`created_by = 'seed'`) reads the way a known heading does:
//
//   * the bill stages `mappingSource: "layout"`, `layoutOrigin: "seed"`, with
//     no columns check pending — through the REAL registration route;
//   * the tender summary beside it is ignored with its reason, is not a phase,
//     and asks for nothing that holds the bill up;
//   * the confirm goes through with no columns check, and NO MODEL is asked
//     to read the structure at any point (the reader is stubbed and counted);
//   * a PERSON-saved layout on the same shape still carries its check.
//
// The bill is the synthetic pricing-document fixture, which copies the real
// document's HEADINGS and invents every row. It is read with the seeded
// layout ITSELF, so the test fails in words if the seed has not run on this
// database — the seed is what is under test, not a copy of it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { assertBoqDocument, sheetsAwaitingColumnCheck } from "@/lib/boq-import";
import { columnsAwaitingALook, foldHeading } from "@/lib/boq-roles";
import { pricingDocWorkbook } from "../fixtures/build-boq";

const SEEDED_NAME = "Aman Interiors — AMB pricing document";

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

/** Every way a bill could meet a model, stubbed and counted: none may fire. */
const model = vi.hoisted(() => ({ structureReads: 0, dispatched: 0 }));
vi.mock("@/lib/boq-structure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boq-structure")>();
  return {
    ...actual,
    readBillStructure: async () => {
      model.structureReads += 1;
      throw new Error("A seeded layout must never send a bill's structure to the model.");
    },
  };
});
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async () => {
      model.dispatched += 1;
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("a seeded bill layout reads like a known heading", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  const personLayout = qaNumber("person pricing layout");

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ($1, '__QA seeded bill layout', '__QA Example Client', 'qa', 'qa') returning id`,
        [qaNumber("P90041")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from boq_layouts where name = $1`, [personLayout]);
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

  async function register(bytes: Buffer, filename: string) {
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

  it("holds the seeded layout, as the seed wrote it", async () => {
    const rows = await client.query(
      `select mapping, header_rows, created_by, retired_at from boq_layouts where name = $1`,
      [SEEDED_NAME],
    );
    // Not a skip: a database without the seed reads this bill with the model,
    // which is the defect this seed closes. Say so and stop.
    expect(rows.rows, "db/seed/0013_boq_layouts.sql has not run on this database").toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ header_rows: 1, created_by: "seed", retired_at: null });
    expect(rows.rows[0].mapping).toEqual({
      sourceLine: "line",
      area: "area",
      subArea: "sub-area",
      boqCategory: "category code",
      code: "spec code",
      itemDescription: "item description",
      qtyUnit: "unit",
      qty: "total qty",
      notes: "notes",
    });
    // Every heading is already folded, or the exact match could never fire.
    for (const heading of Object.values(rows.rows[0].mapping as Record<string, string>)) {
      expect(heading).toBe(foldHeading(heading));
    }
  });

  let importId = "";

  it("stages the bill with the seeded layout, and no columns check waits", async () => {
    const registered = await register(await pricingDocWorkbook({ titled: true }), "__QA seeded pricing.xlsx");
    expect(registered.status).toBe(201);
    importId = registered.importId;

    const staged = await run(importId);
    expect(staged.status).toBe("parsed");
    const doc = assertBoqDocument(staged.parsed);
    const bill = doc.sheets[0]!;
    expect(bill).toMatchObject({
      sheetName: "CASEGOODS+SEATING+TABLES",
      mappingSource: "layout",
      layoutOrigin: "seed",
      needsColumns: false,
      ignored: false,
      headerRow: 8,
    });
    expect(bill.layout?.name).toBe(SEEDED_NAME);
    expect(bill.lines).toHaveLength(8);
    // What the layout reads, and what it does not: no price column is a role.
    expect(Object.keys(bill.columns ?? {}).sort()).toEqual(
      ["area", "boqCategory", "code", "itemDescription", "notes", "qty", "qtyUnit", "sourceLine", "subArea"],
    );
    expect(columnsAwaitingALook(bill)).toBe(false);
    expect(sheetsAwaitingColumnCheck(doc)).toEqual([]);

    // THE TENDER SUMMARY: staged, ignored with its reason, so it neither
    // becomes a phase nor holds the bill up — and, being ignored, it is not a
    // sheet the review's automatic structure read would ever send.
    expect(doc.sheets[1]).toMatchObject({
      sheetName: "LOGISTICS",
      ignored: true,
      ignoredReason: "No bill columns found on this sheet.",
      needsColumns: true,
    });
  });

  it("confirms with no columns check, and no model was asked anything", async () => {
    const staged = await run(importId);
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const res = await POST(request({ version: staged.version }), params(importId));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.imported).toBe(7);

    // One phase, from the bill; the tender summary made none.
    const phases = await client.query(`select source_sheet from spec_runs where project_id = $1`, [projectId]);
    expect(phases.rows.map((row) => row.source_sheet)).toEqual(["CASEGOODS+SEATING+TABLES"]);

    expect(model.structureReads).toBe(0);
    expect(model.dispatched).toBe(0);
  });

  it("a PERSON'S layout on the same shape still waits to be looked at", async () => {
    // Saved from the bill the seed read: same mapping, a person's name on it.
    const { POST: saveLayout } = await import("@/app/api/boq-layouts/route");
    const saved = await saveLayout(request({ importId, sheetIndex: 0, name: personLayout }));
    expect(saved.status).toBe(201);
    const creator = await client.query(`select created_by from boq_layouts where name = $1`, [personLayout]);
    expect(creator.rows[0].created_by).toBe("__qa@example.test");

    // Newest first among equally specific layouts: the person's reads it now.
    const { importId: second } = await register(await pricingDocWorkbook({ titled: false }), "__QA person pricing.xlsx");
    const bill = assertBoqDocument((await run(second)).parsed).sheets[0]!;
    expect(bill).toMatchObject({ mappingSource: "layout", layoutOrigin: "person" });
    expect(bill.layout?.name).toBe(personLayout);
    expect(columnsAwaitingALook(bill)).toBe(true);
    expect(model.structureReads).toBe(0);
  });
});
