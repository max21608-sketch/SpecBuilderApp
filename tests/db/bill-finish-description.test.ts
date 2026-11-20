// Database tier — a library row THIS bill's confirm creates is described by
// the first real words the bill gives its code (R10, 2026-11-20). Through the
// real confirm route; the bill is staged as JSON, every code and word invented.
//
// Found on the merged build (an invented bill): a side table's description
// cell said `Base: MTL-01` — a code and no words — and created MTL-01 first;
// the sofa's own finish line `MTL-01 / Finish: Brushed brass, lacquered`
// linked to it and the row stayed empty, so the BWS cell shipped "MTL-01" and
// nothing else. A row that existed before the confirm is never described here.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stagedVersion } from "./staged-version";
import { normaliseFinishCode } from "@/lib/finishes";

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
const post = (body: unknown) =>
  new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describeIfDb("a finish this bill creates is described by the bill's words", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA finish descriptions', 'qa', 'qa') returning id`,
        [qaNumber("P90471")],
      )
    ).rows[0].id as string;
    // In the library before the bill, with no words: a person's to describe.
    await client.query(
      `insert into project_finishes (project_id, code, code_norm, description, state, created_by, updated_by)
       values ($1, 'ZZ-MTL-09', $2, null, 'tbc', 'qa', 'qa')`,
      [projectId, normaliseFinishCode("ZZ-MTL-09")],
    );
  });

  afterAll(async () => {
    const records = `(select id from spec_records where project_id = $1)`;
    await client.query(`update record_attributes set finish_id = null where record_id in ${records}`, [projectId]);
    await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
    await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
    await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const item = (index: number, code: string, description: string) => ({
    index,
    lineNo: index + 3,
    code,
    itemDescription: description.split("\n")[0],
    ...(description.includes("\n") ? { itemDescriptionRaw: description } : {}),
    productReference: null,
    qty: 2,
    qtyUnit: "nr",
    designer: null,
    area: null,
    boqCategory: null,
    categoryId: null,
    categoryStatus: "none",
    ignored: false,
    rowKind: "item",
  });
  const finishLine = (index: number, code: string, words: string) => ({
    ...item(index, code, words),
    qty: null,
    qtyUnit: null,
    rowKind: "finish_for",
    rowKindSource: "person",
    finishFor: { row: 4, code: "ZZ-SF-01" },
  });

  it("describes the row it created with the line's words, and leaves a placeholder's and an existing row empty", { timeout: 30_000 }, async () => {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 4,
          filename: "__QA descriptions.xlsx",
          sourcePreserved: false,
          sheets: [
            {
              sheetName: "__QA Rooms",
              proposedRunName: "__QA Rooms",
              headerRow: 2,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: null,
              metadata: { revision: null, date: null, notes: [] },
              lines: [
                item(0, "ZZ-ST-01", "Side table\nBase: ZZ-MTL-01"),
                item(1, "ZZ-SF-01", "Sofa"),
                finishLine(2, "ZZ-MTL-01", "Finish: Example brass, lacquered"),
                finishLine(3, "ZZ-FAB-13", "Technical details TBC"),
                finishLine(4, "ZZ-MTL-09", "Finish: Example bronze"),
              ],
            },
          ],
        }),
      ],
    );
    const runId = run.rows[0].id as string;
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(post({ version: await stagedVersion(client, runId) }), params(runId));
    const body = (await response.json()) as { error?: string };
    expect(response.status, body.error).toBe(200);

    const library = (
      await client.query(`select code, description from project_finishes where project_id = $1 order by code`, [projectId])
    ).rows.map((row) => [row.code, row.description ?? ""]);
    expect(library).toEqual([
      ["ZZ-FAB-13", ""],
      ["ZZ-MTL-01", "Example brass, lacquered"],
      ["ZZ-MTL-09", ""],
    ]);
    // The line is linked to it, its label read off (R8).
    const linked = (
      await client.query(
        `select a.value, f.code from record_attributes a join project_finishes f on f.id = a.finish_id
          where a.record_id in (select id from spec_records where project_id = $1) and a.label = 'Metal' order by f.code`,
        [projectId],
      )
    ).rows.map((row) => [row.code, row.value]);
    expect(linked).toEqual([
      ["ZZ-MTL-01", "Example brass, lacquered"],
      ["ZZ-MTL-09", "Example bronze"],
    ]);
  });
});
