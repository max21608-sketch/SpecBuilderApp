// A body that is not JSON, sent to a write handler WITH A REAL ID (found by
// 5.2, R2, 2026-11-06).
//
// ============================================================================
// WHAT `route-contracts.test.ts` COULD NOT SEE
//
// That file sends "{not json" to every write handler with random ids, and
// three answered 404 rather than 400: `imports/[id]/confirm`,
// `imports/[id]/rematch` and `projects/[id]/batches` each read a body that
// fails to parse AS `{}` and carry on, so with a random id they reached the
// lookup first. With a real id the leniency is a write:
//
//   - the BILL confirm's `version` is optional, and a missing version skips
//     the optimistic lock (`confirm-boq.ts`, `expectedVersion !== null`). The
//     review screen always sends one (audit G1), so the only requests that
//     arrive without one are a garbled body and a hand-made call, and both
//     confirm the bill, one of this app's hard approval gates, against
//     whatever the staged bill holds now;
//   - a batch is created for a body nobody could read.
//
// The two `it.fails` below are the defect, held. Each turns red the day it is
// fixed, and should then become a plain `it`.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import ExcelJS from "exceljs";
import { describeIfDb, qaNumber } from "./db-tier";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-4000-8000-0000000052c2",
    email: "__qa@example.test",
    name: "QA User",
    role: "editor",
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
const raw = (body: string) =>
  new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body });

/** One invented sheet the seeded headings map with no person and no model. */
async function smallBill(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Bill");
  sheet.addRow(["Code", "Description", "Qty"]);
  sheet.addRow(["ZZ-RB-01", "Example stool", 2]);
  sheet.addRow(["ZZ-RB-02", "Example side table", 1]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeIfDb("a body that is not JSON, with a real id", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  const records = async () =>
    Number((await client.query(`select count(*)::int as n from spec_records where project_id = $1`, [projectId])).rows[0].n);
  const runState = async () =>
    (await client.query(`select status, version from intake_runs where id = $1`, [runId])).rows[0] as {
      status: string;
      version: number;
    };

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA route contract bodies', 'qa', 'qa') returning id`,
        [qaNumber("P90521")],
      )
    ).rows[0].id as string;

    const pathname = `projects/${projectId}/__QA small bill.xlsx`;
    files.set(pathname, {
      bytes: await smallBill(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, importType: "boq", pathname, filename: "__QA small bill.xlsx", contentType: "" }),
      }),
    );
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    runId = body.importId;
  }, 60_000);

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("the bill is staged and nothing is confirmed yet", async () => {
    expect((await runState()).status).toBe("parsed");
    expect(await records()).toBe(0);
  });

  it("a bill confirm naming a version the bill has moved past is refused, and writes nothing", async () => {
    // The lock the next test shows a garbled body walking round.
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const { version } = await runState();
    const response = await POST(raw(JSON.stringify({ version: version - 1 })), params(runId));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect((await runState()).status).toBe("parsed");
    expect(await records()).toBe(0);
  });

  // FOUND BY 5.2 (R2). Today this answers 200 and confirms the bill: the body
  // is read as `{}`, `version` is optional, and no version skips the lock.
  it.fails("a bill confirm whose body is not JSON is refused 400, and confirms nothing", async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(raw("{not json"), params(runId));
    const confirmed = (await runState()).status;
    const written = await records();
    expect(response.status).toBe(400);
    expect(confirmed).toBe("parsed");
    expect(written).toBe(0);
  });

  // FOUND BY 5.2 (R2). Today this answers 201 and creates a batch.
  it.fails("a batch is not created from a body that is not JSON", async () => {
    const before = Number(
      (await client.query(`select count(*)::int as n from intake_batches where project_id = $1`, [projectId])).rows[0].n,
    );
    const { POST } = await import("@/app/api/projects/[id]/batches/route");
    const response = await POST(raw("{not json"), params(projectId));
    const after = Number(
      (await client.query(`select count(*)::int as n from intake_batches where project_id = $1`, [projectId])).rows[0].n,
    );
    expect(response.status).toBe(400);
    expect(after).toBe(before);
  });
});
