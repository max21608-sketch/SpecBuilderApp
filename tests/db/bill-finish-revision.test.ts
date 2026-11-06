// Database tier — a revised bill's finish lines, planned ONCE (audit
// 2026-11-06, item 1.5, C5). Through the real review GET and the real confirm.
//
// Run on the local stack:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/bill-finish-revision.test.ts
//
// ============================================================================
// THE DEFECT THIS FILE PROVES IS FIXED.
//
// The confirm re-read what a carried record held from the bill for EVERY
// finish line, the rows it had itself written a moment before included. So a
// revision listing the fabric the item already held AND a second one refused
// the whole bill ("fabric_changed"), while the review, planning on its own,
// said "→ COM 2". Now one planner decides, the review shows it, and the
// confirm executes it: the second fabric lands in COM 2, and the refusal is
// kept for the case it was meant for — a held fabric the revision no longer
// lists, named.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { stagedVersion } from "./staged-version";

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
const request = (method: string, body?: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const VELVET = "EXAMPLE VELVET, IVORY";
const BOUCLE = "EXAMPLE BOUCLE, SAND";
const LINEN = "EXAMPLE LINEN, GREY";

describeIfDb("a revision's finish lines, planned once", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let phaseId = "";
  let recordId = "";

  const base = { designer: null, boqCategory: null, area: "Example Bar", productReference: null, qtyUnit: null, ignored: false };
  const item = (replaces: unknown) => ({
    ...base,
    index: 0,
    lineNo: 2,
    code: "ZZ-CH-01",
    itemDescription: "Armchair",
    qty: 2,
    replaces,
  });
  const fabric = (index: number, code: string, words: string) => ({
    ...base,
    index,
    lineNo: index + 2,
    code,
    itemDescription: words,
    qty: null,
    replaces: null,
    rowKind: "finish_for",
    finishFor: { row: 2, code: "ZZ-CH-01" },
  });

  async function stage(lines: unknown[], replacesRunId: string | null): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA finish revision.xlsx",
          sourcePreserved: false,
          sheets: [
            {
              sheetName: "Bill",
              proposedRunName: "Bill",
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId,
              metadata: { revision: replacesRunId ? "B" : "A", date: null, notes: [] },
              lines,
            },
          ],
        }),
      ],
    );
    return run.rows[0].id as string;
  }
  const review = async (importId: string) => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const body = (await (await GET(request("GET"), params(importId))).json()) as {
      fabricFilings: Record<number, Record<number, { goesTo: string; filing: string; refusal?: string }>>;
    };
    return body.fabricFilings[0] ?? {};
  };
  const confirm = async (importId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(request("POST", { version: await stagedVersion(client, importId) }), params(importId));
    return { status: response.status, body: (await response.json()) as { code?: string; error?: string; fabricSpecs?: number } };
  };
  const fabrics = async () =>
    (
      await client.query(
        `select a.value, f.json_id from record_attributes a left join spec_fields f on f.id = a.spec_field_id
          where a.record_id = $1 and a.status = 'active' and a.attr_group = 'material' order by f.json_id`,
        [recordId],
      )
    ).rows.map((row) => [row.value, row.json_id]);
  const version = async () =>
    Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, finish_code_prefix, created_by, updated_by)
         values ($1, '__QA finish revision', 'ZZR', 'qa', 'qa') returning id`,
        [qaNumber("P90470")],
      )
    ).rows[0].id as string;
    // Rev A: the armchair and its one fabric.
    const first = await stage([item(null), fabric(1, "F-FA-01", VELVET)], null);
    const done = await confirm(first);
    expect(done.status, done.body.error).toBe(200);
    phaseId = (await client.query(`select id from spec_runs where project_id = $1`, [projectId])).rows[0].id as string;
    recordId = (await client.query(`select id from spec_records where project_id = $1`, [projectId])).rows[0].id as string;
    expect(await fabrics()).toEqual([[VELVET, 1]]);
  });

  afterAll(async () => {
    if (projectId) await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("writes a revision's second fabric into COM 2, exactly where the review said", async () => {
    const revision = await stage(
      [item({ recordId, recordVersion: await version() }), fabric(1, "F-FA-01", VELVET), fabric(2, "F-FA-02", BOUCLE)],
      phaseId,
    );
    const shown = await review(revision);
    expect(shown[1]).toMatchObject({ goesTo: "→ nothing written" });
    expect(shown[2]?.goesTo).toBe("→ COM 2");
    expect(shown[2]?.refusal).toBeUndefined();

    const done = await confirm(revision);
    expect(done.status, done.body.error).toBe(200);
    expect(done.body.fabricSpecs).toBe(1);
    // What the review said is what was written.
    expect(await fabrics()).toEqual([
      [VELVET, 1],
      [BOUCLE, 2],
    ]);
  });

  it("refuses, naming the row and the fabric, a revision that no longer lists a held fabric — on the review first", async () => {
    const before = await fabrics();
    const revision = await stage(
      [item({ recordId, recordVersion: await version() }), fabric(1, "F-FA-01", VELVET), fabric(2, "F-FA-03", LINEN)],
      phaseId,
    );
    const shown = await review(revision);
    // The refusal sits on the first fabric line of the item, in the confirm's words.
    expect(shown[1]?.refusal).toContain(BOUCLE);

    const refused = await confirm(revision);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("fabric_changed");
    expect(refused.body.error).toBe(shown[1]?.refusal);
    expect(refused.body.error).toContain("Row 2");
    // Nothing was written.
    expect(await fabrics()).toEqual(before);
  });
});
