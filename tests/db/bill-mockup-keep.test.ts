// Database tier — a bill's Prototype Quantity puts items on the mock-up phase,
// any column can be kept in notes, and a sheet with no codes says what that
// costs (2026-10-06, Max's decisions on Matthew's next bills).
//
// Through the real registration, the real Columns route (a person saying which
// column is the rollout quantity and which two are kept), the real review GET
// and the real confirm, with the blob store held in memory. A REVISION is
// staged directly, as `boq-revision.test.ts` stages one, because pairing is
// the reviewer's decision and this file is about what the confirm then does.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-mockup-keep.test.ts
//
// Nothing here is a client document: both workbooks are built from source
// every run (`tests/fixtures/build-boq.ts`), every code and figure invented.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { codelessBillWorkbook, prototypeBillWorkbook } from "../fixtures/build-boq";
import { NO_CODES_REVIEW_SENTENCE } from "@/lib/bill-sheet-notices";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

/** The blob store, in memory: what was put, by pathname. */
const files = new Map<string, { bytes: Buffer; contentType: string }>();
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: { contentType?: string }) => {
    files.set(pathname, { bytes: Buffer.from(body), contentType: options?.contentType ?? "application/octet-stream" });
    return { pathname, url: `https://blob.test/${pathname}` };
  },
  head: async (pathname: string) => {
    const file = files.get(pathname);
    return file ? { pathname, size: file.bytes.length, contentType: file.contentType } : null;
  },
  get: async (pathname: string) => {
    const file = files.get(pathname);
    if (!file) return null;
    return {
      statusCode: 200,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(file.bytes));
          controller.close();
        },
      }),
      headers: new Headers({ "content-length": String(file.bytes.length) }),
      blob: { contentType: file.contentType, size: file.bytes.length },
    };
  },
  copy: async () => {
    throw new Error("not used");
  },
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type StagedLine = { index: number; lineNo: number; code: string | null; rowKind?: string; mockupQtyRaw?: string | null };

describeIfDb("a bill's prototype quantity, its kept columns, and a bill with no codes", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const projects: string[] = [];
  const layoutName = `__QA prototype layout ${qaNumber("L")}`;

  async function makeProject(number: string, name: string): Promise<string> {
    const id = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, $2, 'qa', 'qa') returning id`,
        [qaNumber(number), name],
      )
    ).rows[0].id as string;
    projects.push(id);
    return id;
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.query(`delete from boq_layouts where name = $1`, [layoutName]);
    for (const projectId of projects) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`update spec_records set mockup_of = null where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'spec_records' and entity_id in ${records}`, [projectId]);
      await client.query(`update record_attributes set finish_id = null where record_id in ${records}`, [projectId]);
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(
        `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
        [projectId],
      );
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function register(projectId: string, bytes: Buffer, filename: string): Promise<string> {
    const pathname = `projects/${projectId}/${filename}`;
    files.set(pathname, { bytes, contentType: XLSX });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(jsonRequest("POST", { projectId, importType: "boq", pathname, filename, contentType: "" }));
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    return body.importId;
  }

  const version = async (runId: string) =>
    Number((await client.query(`select version from intake_runs where id = $1`, [runId])).rows[0].version);

  async function setColumns(runId: string, body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/imports/[id]/columns/route");
    const response = await POST(jsonRequest("POST", { sheetIndex: 0, version: await version(runId), ...body }), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, result.error).toBe(200);
  }

  async function review(runId: string) {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    expect(response.status).toBe(200);
    return (await response.json()) as {
      sheetNotices: Record<number, { noCodes: boolean; mockup: { count: number; sentence: string } | null }>;
      import: { parsed: { sheets: { lines: StagedLine[] }[] } };
    };
  }

  async function confirm(runId: string) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const body = (await response.json()) as {
      ok: boolean;
      error?: string;
      imported?: number;
      updated?: number;
      fabricSpecs?: number;
      mockup?: { added: number; already: number; skipped: number; left: number; phaseCreated: boolean; message: string } | null;
    };
    expect(response.status, body.error).toBe(200);
    return body;
  }

  // ---- the prototype quantity and two kept columns -------------------------
  let projectId = "";
  let firstRun = "";

  it("stages the prototype cell as printed, and says how many go on the mock-up phase", { timeout: 60_000 }, async () => {
    projectId = await makeProject("P90471", "__QA prototype quantity");
    firstRun = await register(projectId, await prototypeBillWorkbook(), "__QA prototype bill.xlsx");
    // A person says the ROLLOUT column is the quantity and keeps PHASE and Zone note.
    await setColumns(firstRun, {
      headerRow: 2,
      headerRows: 1,
      columns: { code: 0, itemDescription: 1, qty: 2, mockupQty: 3 },
      keep: [4, 5],
    });

    const body = await review(firstRun);
    const lines = body.import.parsed.sheets[0]!.lines;
    expect(lines.map((line) => [line.lineNo, line.rowKind ?? "item", line.mockupQtyRaw])).toEqual([
      [3, "item", "1"],
      [4, "finish_for", "1"],
      [5, "item", "PARTIAL"],
      [6, "item", "N/A"],
      [7, "item", null],
    ]);
    // Two ITEM lines: the fabric line's "1" is not an item on the mock-up.
    expect(body.sheetNotices[0]).toEqual({
      noCodes: false,
      mockup: {
        count: 2,
        sentence: "2 items will also be added to the Mock-up phase (from the bill's Prototype Quantity).",
      },
    });
  });

  it("remembers the kept columns in a saved layout, and the next bill in that layout keeps them", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/boq-layouts/route");
    const response = await POST(jsonRequest("POST", { importId: firstRun, sheetIndex: 0, name: layoutName }));
    const body = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, body.error).toBe(201);
    const saved = await client.query(`select mapping from boq_layouts where name = $1`, [layoutName]);
    expect(saved.rows[0].mapping).toEqual({
      code: "code",
      itemDescription: "description",
      qty: "rollout quantity",
      mockupQty: "prototype quantity",
      keep: ["phase", "zone note"],
    });

    // The registers the reader loads carry the list, and a fresh read applies it.
    const { loadBoqReadingRegisters } = await import("@/lib/boq-stage");
    const { parseBoqSheets } = await import("@/lib/boq-import");
    const { withTransaction } = await import("@/lib/db-transaction");
    const registers = await withTransaction((txn) => loadBoqReadingRegisters(txn));
    expect(registers.layouts.find((layout) => layout.name === layoutName)?.keep).toEqual(["phase", "zone note"]);
    const { readSpreadsheetSheets } = await import("@/lib/intake-source");
    const sources = await readSpreadsheetSheets(await prototypeBillWorkbook(), "next bill.xlsx", XLSX);
    const sheet = parseBoqSheets(sources, registers).sheets![0]!;
    expect(sheet.layout?.name).toBe(layoutName);
    expect(sheet.kept).toEqual([
      { index: 4, heading: "PHASE" },
      { index: 5, heading: "Zone note" },
    ]);
    expect(sheet.lines[0]!.qty).toBe(40);
  });

  it("confirms: rollout quantities on the phase, a Mock-up phase with two records, kept cells in notes, one change", { timeout: 60_000 }, async () => {
    const result = await confirm(firstRun);
    expect(result.imported).toBe(4);
    expect(result.fabricSpecs).toBe(1);
    expect(result.mockup).toMatchObject({ added: 2, already: 0, skipped: 0, left: 0, phaseCreated: true });
    expect(result.mockup?.message).toMatch(/^Added 2 items to Mock-up\. The Mock-up phase was created\. No specs were copied/);

    const rows = (
      await client.query(
        `select r.id, r.qty, r.internal_notes, r.mockup_of, run.is_mockup, run.name,
                (select x.ref_value from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code') as code
           from spec_records r join spec_runs run on run.id = r.run_id
          where r.project_id = $1 and r.status = 'active'
          order by run.is_mockup, r.record_no`,
        [projectId],
      )
    ).rows;
    const main = rows.filter((row) => !row.is_mockup);
    const mockup = rows.filter((row) => row.is_mockup);
    expect(main.map((row) => [row.code, row.qty, row.internal_notes])).toEqual([
      ["ZZ-PR-01", 40, "PHASE: 2\nZone note: near the window"],
      ["ZZ-PR-02", 20, "PHASE: 3"],
      ["ZZ-PR-03", 12, null],
      ["ZZ-PR-04", 12, "PHASE: 5\nZone note: by the door"],
    ]);
    // The bill SAID how many: 1 where it is a number, none and a note where it is words.
    expect(mockup.map((row) => [row.name, row.code, row.qty, row.internal_notes])).toEqual([
      ["Mock-up", "ZZ-PR-01", 1, null],
      ["Mock-up", "ZZ-PR-02", null, "Prototype quantity on the bill: PARTIAL"],
    ]);
    const byCode = new Map(main.map((row) => [row.code, row.id]));
    expect(mockup.map((row) => row.mockup_of)).toEqual([byCode.get("ZZ-PR-01"), byCode.get("ZZ-PR-02")]);

    // The identity only: no spec followed it onto the mock-up record.
    const mockupSpecs = await client.query(
      `select count(*)::int as n from record_attributes where record_id = any($1::uuid[])`,
      [mockup.map((row) => row.id)],
    );
    expect(mockupSpecs.rows[0].n).toBe(0);

    // ONE change: the bill's confirm, and every version — mock-up records too — under it.
    const changes = await client.query(`select id, kind from change_sets where project_id = $1`, [projectId]);
    expect(changes.rows.map((row) => row.kind)).toEqual(["boq_confirm"]);
    const versions = await client.query(
      `select distinct s.change_set_id from record_snapshots s join spec_records r on r.id = s.record_id
        where r.project_id = $1`,
      [projectId],
    );
    expect(versions.rows.map((row) => row.change_set_id)).toEqual([changes.rows[0].id]);
  });

  it("a revision does not duplicate, adds what is new, and LEAVES one whose figure was dropped", { timeout: 60_000 }, async () => {
    const mainRun = (
      await client.query(`select id from spec_runs where project_id = $1 and not is_mockup`, [projectId])
    ).rows[0].id as string;
    const records = (
      await client.query(
        `select r.id, r.version, r.internal_notes,
                (select x.ref_value from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code') as code
           from spec_records r where r.run_id = $1 and r.status = 'active' order by r.record_no`,
        [mainRun],
      )
    ).rows;
    const line = (index: number, mockupQtyRaw: string | null, kept: { heading: string; value: string }[] = []) => {
      const record = records[index]!;
      return {
        index,
        lineNo: index + 3,
        designer: null,
        boqCategory: null,
        area: null,
        code: record.code,
        itemDescription: `Item ${index + 1}`,
        productReference: null,
        qty: 10,
        qtyUnit: null,
        mockupQtyRaw,
        kept,
        categoryId: null,
        categoryStatus: "none",
        ignored: false,
        replaces: { recordId: record.id, recordVersion: Number(record.version) },
      };
    };
    const revision = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
         values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [
          projectId,
          JSON.stringify({
            schemaVersion: 4,
            filename: "__QA prototype bill rev B.xlsx",
            sourcePreserved: false,
            sheets: [
              {
                sheetName: "Bill",
                proposedRunName: "Bill",
                headerRow: 2,
                skippedRows: 0,
                ignored: false,
                ignoredReason: null,
                replacesRunId: mainRun,
                metadata: { revision: "B", date: null, notes: [] },
                columns: { mockupQty: { index: 3, heading: "Prototype Quantity" } },
                lines: [
                  // Still 1: already on the mock-up phase — reported, never duplicated.
                  line(0, "1", [{ heading: "PHASE", value: "9" }]),
                  // Now N/A: its mock-up record is LEFT, and the result says so.
                  line(1, "N/A"),
                  // Now 2: new on the mock-up phase.
                  line(2, "2"),
                  line(3, null),
                ],
              },
            ],
          }),
        ],
      )
    ).rows[0].id as string;

    const result = await confirm(revision);
    expect(result.updated).toBe(4);
    expect(result.mockup).toMatchObject({ added: 1, already: 1, left: 1, phaseCreated: false });
    expect(result.mockup?.message).toMatch(/Added 1 item to Mock-up; 1 was already there\./);
    expect(result.mockup?.message).toMatch(
      /1 item stays on the Mock-up phase though the bill no longer gives it a prototype quantity — retire it there if it should go\./,
    );

    const mockup = (
      await client.query(
        `select r.qty, r.status, (select x.ref_value from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code') as code
           from spec_records r join spec_runs run on run.id = r.run_id
          where r.project_id = $1 and run.is_mockup order by r.record_no`,
        [projectId],
      )
    ).rows;
    expect(mockup.map((row) => [row.code, row.qty, row.status])).toEqual([
      ["ZZ-PR-01", 1, "active"],
      ["ZZ-PR-02", null, "active"],
      ["ZZ-PR-03", 2, "active"],
    ]);
    // A revision never writes over a record's notes, kept columns included.
    const notes = await client.query(`select internal_notes from spec_records where id = $1`, [records[0]!.id]);
    expect(notes.rows[0].internal_notes).toBe("PHASE: 2\nZone note: near the window");
  });

  // ---- a bill with no codes -----------------------------------------------
  it("flags a sheet with no codes on the review, and its phase after the confirm", { timeout: 60_000 }, async () => {
    const codeless = await makeProject("P90472", "__QA codeless bill");
    const runId = await register(codeless, await codelessBillWorkbook(), "__QA codeless bill.xlsx");
    // No code column: a person sets the description, the quantity and one kept column.
    await setColumns(runId, { headerRow: 1, headerRows: 1, columns: { itemDescription: 0, qty: 1 }, keep: [2] });

    const body = await review(runId);
    expect(body.sheetNotices[0]).toEqual({ noCodes: true, mockup: null });
    expect(NO_CODES_REVIEW_SENTENCE).toMatch(/each will have to be paired by hand on the revision's review/);

    const result = await confirm(runId);
    expect(result.imported).toBe(2);
    expect(result.mockup).toBeNull();

    const notes = await client.query(
      `select internal_notes from spec_records where project_id = $1 order by record_no`,
      [codeless],
    );
    expect(notes.rows.map((row) => row.internal_notes)).toEqual(["PHASE: 2", "PHASE: 3"]);

    const { GET } = await import("@/app/api/projects/[id]/route");
    const project = (await (await GET(new Request("http://localhost/test"), params(codeless))).json()) as {
      runs: { name: string; bill_without_codes: boolean }[];
    };
    expect(project.runs.map((run) => [run.name, run.bill_without_codes])).toEqual([["Public areas", true]]);

    // And a phase whose items DO carry codes says nothing.
    const coded = (await (await GET(new Request("http://localhost/test"), params(projectId))).json()) as {
      runs: { is_mockup?: boolean; bill_without_codes: boolean }[];
    };
    expect(coded.runs.every((run) => run.bill_without_codes === false)).toBe(true);
  });
});
