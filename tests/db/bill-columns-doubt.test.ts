// Database tier — the reader's own doubt about a bill's columns holds the
// confirm until a person has looked (audit C6, 2026-11-16).
//
// `Item` and `Description` are both seeded synonyms of the item description. A
// sheet printing both used to read `Item` (the line numbers) as every record's
// name, drop the real description and confirm with nothing said. The sheet is
// now staged with a `columnsDoubt`, the confirm refuses it in words, and "The
// columns are right" lets it through. Every row here is invented.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import ExcelJS from "exceljs";
import { describeIfDb, qaNumber } from "./db-tier";
import { assertBoqDocument } from "@/lib/boq-import";

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
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function billBytes(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Bill");
  sheet.addRow(["Item", "Code", "Description", "Qty"]);
  sheet.addRow(["1.01", "ZZ-DBT-01", "Example sofa", 2]);
  sheet.addRow(["1.02", "ZZ-DBT-02", "Example armchair", 4]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeIfDb("a bill whose columns the reader doubts waits for a person", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let billId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ($1, '__QA columns doubt', '__QA Example Client', 'qa', 'qa') returning id`,
        [qaNumber("P90071")],
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
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function run() {
    return (await client.query(`select status, version, parsed from intake_runs where id = $1`, [billId])).rows[0] as {
      status: string;
      version: number;
      parsed: unknown;
    };
  }
  async function confirm(version: number) {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const res = await POST(request({ version }), params(billId));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("stages the sheet read, with the doubt naming both columns", async () => {
    stored.bytes = await billBytes();
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      request({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/__QA doubt.xlsx`,
        filename: "__QA doubt.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(201);
    billId = String(body.importId);
    const sheet = assertBoqDocument((await run()).parsed).sheets[0]!;
    expect(sheet.columnsDoubt).toMatch(/Columns A \(“Item”\) and C \(“Description”\)/);
  });

  it("refuses the confirm in words, and confirms once a person says the columns are right", async () => {
    const staged = await run();
    const refused = await confirm(staged.version);
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/The columns of “Bill” need a look/);
    expect(Number((await client.query(`select count(*) from spec_records where project_id = $1`, [projectId])).rows[0].count)).toBe(0);

    const { POST } = await import("@/app/api/imports/[id]/columns/route");
    const checked = await POST(request({ action: "checked", sheetIndex: 0, version: staged.version }), params(billId));
    expect(checked.status).toBe(200);
    const done = await confirm((await run()).version);
    expect(done.status).toBe(200);
  });
});
