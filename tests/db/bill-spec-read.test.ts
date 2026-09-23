// Database tier — a bill's OWN specification read resolves by the bill's rows,
// in row windows, and re-matches for free (plan any-bill, Step 8).
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-spec-read.test.ts
//
// ============================================================================
// WHAT THE PURE TIER CANNOT PROVE.
//
//   * The bill's confirm and the specification read agree about which record a
//     row became: `loadBillRowIndex` reads `source_import_id` / `source_line_no`
//     and the phase the sheet became, and the worker resolves every proposal
//     by it — a fabric line to its ITEM, a row whose ref names another item
//     flagged, and a ref the matcher cannot read (the fabric line's own printed
//     code) placed all the same.
//   * A sheet longer than one window is read as SEVERAL calls inside ONE
//     attempt, each sent only its own rows, and the proposals merged with the
//     sheet's own row numbers. The model is STUBBED: it answers from the rows
//     it was sent, and counts its calls. Nothing is charged.
//   * `POST /api/imports/[id]/rematch` re-matches a read staged before rows
//     resolved, for free, and a second press changes nothing.
//
// Every code is invented (`ZZ-`), every row `__QA`, and the project takes its
// changes with it.
// ============================================================================
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { describeIfDb, qaNumber } from "./db-tier";
import { ROWS_PER_WINDOW } from "@/lib/spreadsheet-windows";

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

vi.mock("@/lib/extraction-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extraction-queue")>();
  return { ...actual, enqueueExtractionJob: async () => {} };
});

/**
 * The model, stubbed: it reads the row numbers it was SENT and answers only
 * about those — which is what proves a window carries its own rows and keeps
 * their numbers.
 */
const model = vi.hoisted(() => ({ calls: [] as { rows: number[]; instruction: string | undefined }[] }));
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    extractSpecDocument: async (source: { type: string; text?: string }, _kind: string, options: { instruction?: string } = {}) => {
      const rows = [...String(source.text ?? "").matchAll(/^(\d+): /gm)].map((match) => Number(match[1]));
      model.calls.push({ rows, instruction: options.instruction });
      const proposals = [];
      for (const row of rows) {
        if (row === 1) continue; // the heading
        const base = { page: null, sourceSheet: "SEATING", sourceRow: row, confidence: "high", note: null };
        if (row === 2) {
          proposals.push({ ...base, refRaw: "ZZ-FUR-10", attributeRaw: "Sizes (mm)", valueRaw: "W 450 x D 450 x SH 460" });
          proposals.push({ ...base, refRaw: "ZZ-FUR-10", attributeRaw: "Fabric", valueRaw: "COM" });
        } else if (row === 3) {
          // The fabric line, its ref copied as the bill prints it.
          proposals.push({ ...base, refRaw: "ZZ-FAB-13 (ZZ-FUR-10)", attributeRaw: "Color Ref", valueRaw: "Example 0012" });
        } else if (row === 44) {
          // Row 44 is ZZ-FUR-52 on the bill; this names ZZ-FUR-12, row 4's.
          proposals.push({ ...base, refRaw: "ZZ-FUR-12", attributeRaw: "Finish", valueRaw: "TIM-21" });
        } else {
          proposals.push({ ...base, refRaw: `ZZ-FUR-${row + 8}`, attributeRaw: "Finish", valueRaw: "TIM-21" });
        }
      }
      return {
        ok: true,
        output: { outputKind: "observations", data: { proposals, documentNotes: "__QA notes" } },
        model: "__qa-model",
        rawResponse: { __qa: rows.length },
        usage: { input_tokens: 10, output_tokens: 20 },
        requestId: `req___qa_${model.calls.length}`,
        elapsedMs: 1,
      };
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** 44 lines: a stool, its fabric line, then 42 more items — two windows' worth. */
const DATA_ROWS = 44;
async function billBytes(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("SEATING");
  sheet.addRow(["Area", "FF&E code", "Item description", "unit", "TOTAL Q-ty"]);
  sheet.addRow(["Example Suites", "ZZ-FUR-10", "Stool Sizes (mm): W 450 x D 450 x SH 460 Fabric: COM", "ea", 54]);
  sheet.addRow(["Example Suites", "ZZ-FAB-13 (ZZ-FUR-10)", "Fabric @ Stool Example weave", "m", null]);
  for (let row = 4; row <= DATA_ROWS + 1; row += 1) {
    sheet.addRow(["Example Suites", `ZZ-FUR-${row + 8}`, `Example item ${row}`, "ea", 2]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

describeIfDb("a bill's own specification read, by row, in windows", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let billId = "";
  let specId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ($1, '__QA bill spec read', '__QA Example Client', 'qa', 'qa') returning id`,
        [qaNumber("P90043")],
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
      await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
      await client.query(`delete from attachments where entity_type = 'project' and entity_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  async function run(id: string) {
    return (await client.query(`select status, version, parsed, model_metadata, attempt_id, error from intake_runs where id = $1`, [id]))
      .rows[0] as { status: string; version: number; parsed: { lines: Record<string, unknown>[] } | null; model_metadata: Record<string, unknown> | null; attempt_id: string | null; error: string | null };
  }
  async function recordAt(lineNo: number): Promise<string> {
    const rows = await client.query(`select id from spec_records where project_id = $1 and source_line_no = $2`, [projectId, lineNo]);
    return String(rows.rows[0]?.id ?? "");
  }

  it("confirms a bill whose fabric line names its item in brackets", async () => {
    stored.bytes = await billBytes();
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(
      request({
        projectId,
        importType: "boq",
        pathname: `projects/${projectId}/uploads/__QA bill.xlsx`,
        filename: "__QA bill.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(201);
    billId = String(body.importId);

    const confirm = await import("@/app/api/imports/[id]/confirm/route");
    const done = await confirm.POST(request({ version: (await run(billId)).version }), params(billId));
    const doneBody = (await done.json()) as Record<string, unknown>;
    expect(done.status, JSON.stringify(doneBody)).toBe(200);
    // The fabric line is not a record: 43 items.
    const records = await client.query(`select count(*)::int as n from spec_records where project_id = $1`, [projectId]);
    expect(records.rows[0].n).toBe(DATA_ROWS - 1);
  });

  it("reads the bill in two windows inside one attempt, and resolves every proposal by its row", async () => {
    const { POST } = await import("@/app/api/imports/[id]/read-specifications/route");
    const res = await POST(request({}), params(billId));
    const body = (await res.json()) as { importId: string };
    expect(res.status).toBe(201);
    specId = body.importId;

    const attemptId = (await run(specId)).attempt_id;
    expect(attemptId).toBeTruthy();
    model.calls.length = 0;
    const { runDocumentExtraction } = await import("@/lib/extraction-run");
    const outcome = await runDocumentExtraction({ extractionId: specId, attemptId: String(attemptId), actor: "__qa" });
    expect(outcome, JSON.stringify(await run(specId))).toEqual({ outcome: "parsed" });

    // Two calls, each sent the heading and ONLY its own rows.
    expect(model.calls).toHaveLength(2);
    expect(model.calls[0]?.rows).toEqual([1, ...Array.from({ length: ROWS_PER_WINDOW }, (_, i) => i + 2)]);
    expect(model.calls[1]?.rows).toEqual([1, ...Array.from({ length: DATA_ROWS - ROWS_PER_WINDOW }, (_, i) => i + 2 + ROWS_PER_WINDOW)]);
    expect(model.calls[1]?.instruction).toMatch(/part 2 of 2/);

    const staged = await run(specId);
    const meta = staged.model_metadata as { windows?: unknown[]; usage?: { output_tokens: number } };
    expect(meta.windows).toHaveLength(2);
    expect(meta.usage?.output_tokens).toBe(40);

    const lines = staged.parsed!.lines as {
      recordId: string | null;
      recordCandidates: { id: string }[];
      rowMatch?: { row: number; itemRow: number | null } | null;
      raw: { sourceRow: number; attributeRaw: string };
      dimension?: { slot: string } | null;
      finish?: { group: string; specFieldId: string | null } | null;
      readingNote?: string | null;
      sourceOrdinal: number;
    }[];
    // The stool: three slots, and COM kept as a note that takes no field.
    const stool = await recordAt(2);
    const onStool = lines.filter((line) => line.raw.sourceRow === 2);
    expect(onStool.every((line) => line.recordId === stool)).toBe(true);
    expect(onStool.filter((line) => line.dimension).map((line) => line.dimension!.slot)).toEqual(["W", "D", "SH"]);
    expect(onStool.find((line) => line.raw.attributeRaw === "Fabric")?.finish).toMatchObject({ group: "note", specFieldId: null });
    // The fabric line: its ITEM's record, though the ref names no record.
    const fabric = lines.find((line) => line.raw.sourceRow === 3);
    expect(fabric).toMatchObject({ recordId: stool, rowMatch: { row: 3, itemRow: 2 } });
    // Row 44 names another item's code: flagged, both offered, neither chosen.
    const conflict = lines.find((line) => line.raw.sourceRow === 44);
    expect(conflict?.recordId).toBeNull();
    expect(conflict?.recordCandidates.map((candidate) => candidate.id)).toEqual([await recordAt(44), await recordAt(4)]);
    expect(conflict?.readingNote).toMatch(/names ZZ-FUR-12/);
    // Every other row placed by row, on the record that row became.
    for (const line of lines.filter((entry) => ![2, 3, 44].includes(entry.raw.sourceRow))) {
      expect(line.recordId).toBe(await recordAt(line.raw.sourceRow));
      expect(line.rowMatch?.row).toBe(line.raw.sourceRow);
    }
    // Ordinals are one per observation across the windows.
    expect(new Set(lines.map((line) => line.sourceOrdinal)).size).toBe(DATA_ROWS + 1);
  });

  it("re-matches a read staged before rows resolved, for free, and a second press changes nothing", async () => {
    // Stage it the way a read made before this change left it: by ref alone.
    const { loadExtractionRegisters } = await import("@/lib/spec-document-registers");
    const { resolveProposals } = await import("@/lib/spec-document");
    const staged = await run(specId);
    const raws = [...new Map((staged.parsed!.lines as { sourceOrdinal: number; raw: unknown }[]).map((line) => [line.sourceOrdinal, line.raw])).values()];
    const byRef = resolveProposals(raws as never, await loadExtractionRegisters(projectId), () => randomUUID());
    expect(byRef.find((line) => line.raw.sourceRow === 3)?.recordId).toBeNull();
    await client.query(`update intake_runs set parsed = jsonb_set(parsed, '{lines}', $2::jsonb) where id = $1`, [specId, JSON.stringify(byRef)]);

    const rematch = await import("@/app/api/imports/[id]/rematch/route");
    const first = await rematch.POST(request({ expectedVersion: (await run(specId)).version }), params(specId));
    const firstBody = (await first.json()) as { rematched: number };
    expect(first.status).toBe(200);
    expect(firstBody.rematched).toBeGreaterThanOrEqual(2);
    const after = await run(specId);
    const fabric = (after.parsed!.lines as { raw: { sourceRow: number }; recordId: string | null }[]).find((line) => line.raw.sourceRow === 3);
    expect(fabric?.recordId).toBe(await recordAt(2));

    const second = await rematch.POST(request({ expectedVersion: after.version }), params(specId));
    expect(((await second.json()) as { rematched: number }).rematched).toBe(0);
    expect((await run(specId)).parsed).toEqual(after.parsed);
  });
});
