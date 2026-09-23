// Database tier — a model reads a bill's structure, and a fabric line becomes a
// COM spec on its item (plan any-bill, Step 2), through the REAL routes.
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-structure.test.ts
//
// ============================================================================
// WHAT THE PURE TIER CANNOT PROVE.
//
//   * THE STRUCTURE READ CANNOT BE PAID FOR TWICE. Two presses naming the same
//     version: one claims the run and reads, the other is refused before
//     anything is sent. The model is STUBBED — `readBillStructure` returns a
//     canned reading — so nothing is charged, and the stub counts its calls.
//   * The reading is applied as a person's columns are: every cell re-read by
//     code from the stored spreadsheet, and the confirm refuses until a person
//     says the columns are right.
//   * THE CONFIRM WRITES A FABRIC LINE ONTO ITS ITEM: N records, M fabric
//     attributes on the right records' COM slots (two under one item land as
//     COM 1 and COM 2), the code filed in the finishes library, the checklist
//     recomposed, ONE change set and ONE version per record. A fabric line
//     carrying TBC is a `tbc` attribute.
//   * "Read the specifications in this bill" registers the bill's own file ONCE;
//     a second press returns the same run. The queue publisher is stubbed.
//
// The bill is the SYNTHETIC pricing-document layout, its code column headed by
// a per-run `qaNumber` so no saved layout on a shared database can read it.
// Every row is `__QA`, and the project takes its changes with it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import ExcelJS from "exceljs";
import { describeIfDb, qaNumber } from "./db-tier";
import { assertBoqDocument } from "@/lib/boq-import";
import { PRICING_DOC_HEADINGS, pricingDoc, tenderSummarySheet } from "../fixtures/boq-shapes";

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

/** The model, stubbed: a canned reading of the layout, counted. */
const model = vi.hoisted(() => ({ calls: 0, codeHeading: "", delayMs: 0 }));
vi.mock("@/lib/boq-structure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boq-structure")>();
  return {
    ...actual,
    readBillStructure: async ({ sheetName }: { sheetName: string }) => {
      model.calls += 1;
      if (model.delayMs) await new Promise((resolve) => setTimeout(resolve, model.delayMs));
      const call = { sheet: sheetName, chunk: { from: 1, to: 20 }, ok: true, requestId: "req_qa", usage: { input_tokens: 1, output_tokens: 1 }, elapsedMs: 1 };
      if (sheetName === "LOGISTICS") {
        return {
          ok: true,
          calls: [call],
          raw: [{}],
          output: { notABill: true, notABillEvidence: "a tender summary", headerRow: null, headerRows: 1, columns: [], rows: [] },
        };
      }
      return {
        ok: true,
        calls: [call],
        raw: [{}],
        output: {
          notABill: false,
          notABillEvidence: null,
          headerRow: 8,
          headerRows: 1,
          columns: [
            { column: "A", role: "sourceLine", heading: "Line", evidence: "line numbers" },
            { column: "B", role: "area", heading: "Area", evidence: "areas" },
            { column: "C", role: "subArea", heading: "Sub-Area", evidence: "sub-areas" },
            { column: "D", role: "boqCategory", heading: "Category Code", evidence: "categories" },
            { column: "E", role: "code", heading: model.codeHeading, evidence: "item codes" },
            { column: "H", role: "itemDescription", heading: "Item Description", evidence: "descriptions" },
            { column: "L", role: "qtyUnit", heading: "Unit", evidence: "ea / m" },
            { column: "M", role: "qty", heading: "Total QTY", evidence: "counts" },
            { column: "Q", role: "notes", heading: "Notes", evidence: "notes" },
          ],
          // Rows 14 and 15 sit under the OPTION 2 sofa (row 13); row 10 is the
          // bill's own bracket and needs no model.
          rows: [
            { row: 14, kind: "finish_for", parentRow: 13, evidence: "Fabric @ Sofa, under OPTION 2" },
            { row: 15, kind: "finish_for", parentRow: 13, evidence: "Fabric @ Sofa piping" },
          ],
        },
      };
    },
  };
});

const published = vi.hoisted(() => [] as { extractionId: string }[]);
vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return {
    ...actual,
    enqueueExtractionJob: async (message: { extractionId: string }) => {
      published.push({ extractionId: message.extractionId });
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The pricing document with its code column headed by this run's own word, one fabric marked TBC. */
async function billBytes(codeHeading: string): Promise<Buffer> {
  const rows = pricingDoc({ titled: true }).map((row) => [...row]);
  const header = rows.findIndex((row) => row[0] === PRICING_DOC_HEADINGS[0]);
  rows[header]![4] = codeHeading;
  // Row 15: "Fabric @ Sofa piping" — marked TBC, as a real bill does.
  rows[14]![7] = "Fabric @ Sofa piping Technical details TBC";
  const book = new ExcelJS.Workbook();
  const add = (name: string, data: unknown[][]) => {
    const sheet = book.addWorksheet(name);
    for (const row of data) sheet.addRow(row.map((cell) => (cell === null || cell === undefined ? null : cell)));
  };
  add("CASEGOODS+SEATING+TABLES", rows);
  add("LOGISTICS", tenderSummarySheet());
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeIfDb("a bill's structure, read; its fabric lines, written onto their items", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let billId = "";
  const codeHeading = qaNumber("Spec Code");

  beforeAll(async () => {
    await client.connect();
    model.codeHeading = codeHeading;
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ($1, '__QA bill structure', '__QA Example Client', 'qa', 'qa') returning id`,
        [qaNumber("P90041")],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from status_history where entity_id in (select id from spec_records where project_id = $1)`, [projectId]);
      await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [projectId]);
      await client.query(`delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function run(id: string) {
    return (await client.query(`select status, version, parsed, model, model_metadata from intake_runs where id = $1`, [id]))
      .rows[0] as { status: string; version: number; parsed: unknown; model: string | null; model_metadata: Record<string, unknown> | null };
  }
  async function suggest(body: unknown) {
    const { POST } = await import("@/app/api/imports/[id]/suggest-columns/route");
    const res = await POST(request(body), params(billId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  async function patch(body: unknown) {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const res = await PATCH(request(body, "PATCH"), params(billId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  async function confirm(version: number) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const res = await POST(request({ version }), params(billId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("registers a bill nobody could read, staged for its columns", async () => {
    stored.bytes = await billBytes(codeHeading);
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      request({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/__QA structure.xlsx`,
        filename: "__QA structure.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(201);
    expect(body.needsColumns).toBe(2);
    billId = String(body.importId);
  });

  it("reads the structure ONCE for two presses naming the same version", async () => {
    const before = await run(billId);
    model.calls = 0;
    model.delayMs = 150;
    const [a, b] = await Promise.all([
      suggest({ version: before.version, requestId: "11111111-1111-4111-8111-111111111111" }),
      suggest({ version: before.version, requestId: "22222222-2222-4222-8222-222222222222" }),
    ]);
    model.delayMs = 0;
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    // Two sheets, read once each, by the ONE press that claimed the run.
    expect(model.calls).toBe(2);

    const after = await run(billId);
    expect(after.model).toBeTruthy();
    const record = (after.model_metadata?.structureRead ?? {}) as { pending?: unknown; calls?: unknown[]; sheets?: Record<string, unknown> };
    expect(record.pending).toBeNull();
    expect(record.calls).toHaveLength(2);
    expect(Object.keys(record.sheets ?? {}).sort()).toEqual(["CASEGOODS+SEATING+TABLES", "LOGISTICS"]);

    const doc = assertBoqDocument(after.parsed);
    const bill = doc.sheets[0]!;
    expect(bill).toMatchObject({ mappingSource: "model", needsColumns: false, columnsChecked: false });
    expect(doc.sheets[1]).toMatchObject({ ignored: true, ignoredReason: "Not a bill, as the model read it: a tender summary" });
    // Every cell read by code: the stool's quantity is the sheet's own 54.
    expect(bill.lines.find((line) => line.code === "ZZ-FUR-10")).toMatchObject({ qty: 54, qtyUnit: "ea" });
    expect(bill.lines.filter((line) => line.rowKind === "finish_for").map((line) => [line.lineNo, line.finishFor?.row, line.rowKindSource])).toEqual([
      [10, 9, "bill"],
      [14, 13, "model"],
      [15, 13, "model"],
    ]);

    // The automatic call on a later visit reads nothing, and charges nothing.
    model.calls = 0;
    const again = await suggest({ version: after.version, requestId: "33333333-3333-4333-8333-333333333333" });
    expect(again.status).toBe(200);
    expect(again.body.nothing).toBe(true);
    expect(model.calls).toBe(0);
  });

  it("refuses the confirm until a person says the columns are right", async () => {
    const staged = await run(billId);
    const refused = await confirm(staged.version);
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/The model read the columns of “CASEGOODS\+SEATING\+TABLES”/);

    const { POST } = await import("@/app/api/imports/[id]/columns/route");
    const res = await POST(request({ action: "checked", sheetIndex: 0, version: staged.version }), params(billId));
    expect(res.status).toBe(200);
  });

  it("sets a line's kind only onto a live item above it", async () => {
    const doc = assertBoqDocument((await run(billId)).parsed);
    const lounger = doc.sheets[0]!.lines.find((line) => line.code === "ZZ-FUR-40")!;
    const refused = await patch({ sheetIndex: 0, index: lounger.index, rowKind: "finish_for", finishForRow: 99 });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/not an item line above row/);
  });

  it("confirms: records for the items, a COM spec on the item for each fabric line", async () => {
    // A category on the two items whose fabrics we check, so the checklist has
    // COM questions to recompose. Any category that asks both COM 1 and COM 2.
    const category = (
      await client.query(
        `select q.category_id from requirements q join spec_fields f on f.id = q.spec_field_id
          where f.json_id in (1, 2) group by q.category_id having count(distinct f.json_id) = 2 limit 1`,
      )
    ).rows[0]?.category_id as string;
    expect(category).toBeTruthy();
    const doc = assertBoqDocument((await run(billId)).parsed);
    const lines = doc.sheets[0]!.lines;
    const stool = lines.find((line) => line.code === "ZZ-FUR-10")!;
    const sofa2 = lines.find((line) => line.lineNo === 13)!;
    for (const line of [stool, sofa2]) {
      expect((await patch({ sheetIndex: 0, index: line.index, categoryId: category })).status).toBe(200);
    }

    const staged = await run(billId);
    const done = await confirm(staged.version);
    expect(done.status).toBe(200);
    const fabricLines = lines.filter((line) => line.rowKind === "finish_for").length;
    expect(done.body).toMatchObject({ imported: lines.length - fabricLines, fabricSpecs: 3 });

    const records = await client.query(
      `select r.id, r.source_line_no, r.version from spec_records r where r.project_id = $1 order by r.source_line_no`,
      [projectId],
    );
    expect(records.rows).toHaveLength(lines.length - fabricLines);
    // No fabric line became a record.
    expect(records.rows.map((row) => Number(row.source_line_no))).not.toContain(10);
    const recordAt = (lineNo: number) => String(records.rows.find((row) => Number(row.source_line_no) === lineNo)!.id);

    const attrs = await client.query(
      `select a.record_id, a.attr_group, a.label, a.value, a.material_code, a.state, a.source_run_id, a.source_page,
              f.json_id, a.finish_id
         from record_attributes a join spec_fields f on f.id = a.spec_field_id
        where a.record_id in (select id from spec_records where project_id = $1)
        order by a.record_id, f.json_id`,
      [projectId],
    );
    expect(attrs.rows).toHaveLength(3);
    const stoolFabric = attrs.rows.filter((row) => row.record_id === recordAt(9));
    expect(stoolFabric).toHaveLength(1);
    expect(stoolFabric[0]).toMatchObject({
      attr_group: "material",
      label: "Fabric",
      material_code: "ZZ-FAB-13",
      state: "confirmed",
      source_run_id: billId,
      source_page: null,
      json_id: 1,
    });
    expect(String(stoolFabric[0]!.value)).toMatch(/^Fabric @ Stool/);
    // Two fabrics under the OPTION 2 sofa: COM 1 and COM 2, N/A and no code as none.
    const sofaFabrics = attrs.rows.filter((row) => row.record_id === recordAt(13));
    expect(sofaFabrics.map((row) => [row.json_id, row.material_code, row.state])).toEqual([
      [1, null, "confirmed"],
      [2, null, "tbc"],
    ]);

    // The code is filed in the project's library, and the stool's fabric links to it.
    const finishes = await client.query(`select id, code, state from project_finishes where project_id = $1`, [projectId]);
    expect(finishes.rows.map((row) => row.code)).toEqual(["ZZ-FAB-13"]);
    expect(stoolFabric[0]!.finish_id).toBe(finishes.rows[0]!.id);

    // The checklist follows: COM 1 answered on the stool, COM 2 TBC on the sofa.
    const answers = await client.query(
      `select a.record_id, f.json_id, a.state from spec_answers a join spec_fields f on f.id = a.spec_field_id
        where a.record_id = any($1::uuid[]) and f.json_id in (1, 2) and a.revision_no = 0`,
      [[recordAt(9), recordAt(13)]],
    );
    const answer = (recordId: string, jsonId: number) =>
      answers.rows.filter((row) => row.record_id === recordId && Number(row.json_id) === jsonId).map((row) => row.state);
    expect(new Set(answer(recordAt(9), 1))).toEqual(new Set(["tbc"]));
    expect(new Set(answer(recordAt(13), 2))).toEqual(new Set(["tbc"]));

    // ONE change set, and ONE version per record, carrying the fabrics.
    const changes = await client.query(`select id, kind from change_sets where project_id = $1`, [projectId]);
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0]!.kind).toBe("boq_confirm");
    const versions = await client.query(
      `select record_id, count(*)::int as n, min(change_set_id::text) as cs from record_snapshots
        where record_id in (select id from spec_records where project_id = $1) group by record_id`,
      [projectId],
    );
    expect(versions.rows).toHaveLength(records.rows.length);
    expect(versions.rows.every((row) => row.n === 1 && row.cs === changes.rows[0]!.id)).toBe(true);
  });

  it("registers the bill's own file as a specification read ONCE", async () => {
    published.length = 0;
    const { POST } = await import("@/app/api/imports/[id]/read-specifications/route");
    const first = await POST(request({}), params(billId));
    const firstBody = (await first.json()) as { importId: string; reused: boolean };
    expect(first.status).toBe(201);
    expect(firstBody.reused).toBe(false);
    const second = await POST(request({}), params(billId));
    const secondBody = (await second.json()) as { importId: string; reused: boolean };
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({ importId: firstBody.importId, reused: true });
    expect(published.map((message) => message.extractionId)).toEqual([firstBody.importId]);

    const rows = await client.query(
      `select s.source_kind, s.document_kind, s.attachment_id = b.attachment_id as same_file, s.batch_id is not distinct from b.batch_id as same_batch
         from intake_runs s, intake_runs b where s.id = $1 and b.id = $2`,
      [firstBody.importId, billId],
    );
    expect(rows.rows[0]).toMatchObject({ source_kind: "spec_document", document_kind: "ffe_schedule", same_file: true, same_batch: true });
  });
});
