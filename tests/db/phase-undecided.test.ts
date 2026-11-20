// Database tier — a revised bill's tab that looks like a phase the project
// already has is SUGGESTED as its revision, and the confirm waits until a
// person has said which it is (prod-ready RV0, 2026-11-20). Through the real
// review GET, sheet PATCH and confirm routes.
//
// ============================================================================
// THE DEFECT. A sheet named `Guest Rooms`, uploaded to a project whose active
// phase `Guest Rooms` held the same codes, defaulted to "a new phase", and one
// press of Confirm made a second "Guest Rooms" phase with every record twice.
// ============================================================================
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
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
const jsonRequest = (method: string, body?: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describeIfDb("a tab that looks like a phase the project has (RV0)", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let phaseId = "";
  const PHASE = "__QA Guest Rooms";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('${qaNumber("P90211")}', '__QA phase undecided', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const phase = await client.query(
      `insert into spec_runs (project_id, name, source_sheet, created_by, updated_by)
       values ($1, $2, $2, 'qa', 'qa') returning id`,
      [projectId, PHASE],
    );
    phaseId = phase.rows[0].id;
    for (const [n, code] of [[1, "__QA-GR-01"], [2, "__QA-GR-02"], [3, "__QA-GR-03"]] as const) {
      const record = await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, item_description, created_by, updated_by)
         values ($1, $2, $3, 'active', $4, 'qa', 'qa') returning id`,
        [projectId, phaseId, n, `__QA item ${code}`],
      );
      await client.query(
        `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
         values ($1, $2, 'boq_code', $3, upper(regexp_replace($3, '[^A-Za-z0-9]', '', 'g')), 'test', 'qa')`,
        [record.rows[0].id, projectId, code],
      );
    }
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const line = (index: number, code: string) => ({
    index,
    lineNo: index + 2,
    designer: null,
    boqCategory: null,
    area: "__QA Rooms",
    code,
    itemDescription: `__QA item ${code}`,
    productReference: null,
    qty: 2,
    qtyUnit: "nr",
    categoryId: null,
    categoryStatus: "none",
    ignored: false,
    replaces: null,
  });

  async function stage(sheetName: string, codes: string[]): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA rev B.xlsx",
          sourcePreserved: false,
          sheets: [
            {
              sheetName,
              proposedRunName: sheetName,
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: null,
              metadata: { revision: "B", date: null, notes: [] },
              lines: codes.map((code, index) => line(index, code)),
            },
          ],
        }),
      ],
    );
    return run.rows[0].id;
  }

  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(jsonRequest("POST", { version: await stagedVersion(client, runId) }), params(runId));
  };
  const review = async (runId: string) => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    return (await GET(jsonRequest("GET"), params(runId))).json();
  };
  const patchSheet = async (runId: string, body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    return PATCH(jsonRequest("PATCH", { sheetIndex: 0, version: await stagedVersion(client, runId), ...body }), params(runId));
  };
  const phaseCount = async () =>
    Number((await client.query(`select count(*)::int as n from spec_runs where project_id = $1`, [projectId])).rows[0].n);

  it("suggests the phase a same-named tab revises, with its evidence, and the confirm refuses until somebody says", { timeout: 30_000 }, async () => {
    const runId = await stage(PHASE, ["__QA-GR-01", "__QA-GR-02", "__QA-GR-03"]);

    const body = await review(runId);
    expect(body.phaseSuggestions[0]).toEqual([
      { runId: phaseId, runName: PHASE, sameName: true, codesOnPhase: 3, codesOnSheet: 3 },
    ]);

    const refused = await confirm(runId);
    expect(refused.status).toBe(400);
    const refusal = await refused.json();
    expect(refusal.code).toBe("phase_undecided");
    expect(refusal.error).toContain(`“${PHASE}” looks like a phase this project already has`);
    // Nothing written: still one phase, and the bill is still under review.
    expect(await phaseCount()).toBe(1);
    expect((await client.query(`select status from intake_runs where id = $1`, [runId])).rows[0].status).toBe("parsed");
  });

  it("refuses a differently named tab most of whose codes are on one phase", { timeout: 30_000 }, async () => {
    const runId = await stage("__QA Rev B tab", ["__QA-GR-01", "__QA-GR-02", "__QA-OTHER"]);
    const body = await review(runId);
    expect(body.phaseSuggestions[0][0]).toMatchObject({ runId: phaseId, sameName: false, codesOnPhase: 2, codesOnSheet: 3 });
    const refused = await confirm(runId);
    expect((await refused.json()).code).toBe("phase_undecided");
    expect(await phaseCount()).toBe(1);
  });

  it("stores “a new phase” as a choice, and then confirms it as one", { timeout: 30_000 }, async () => {
    const runId = await stage(PHASE, ["__QA-GR-01", "__QA-GR-02", "__QA-GR-03"]);
    const chosen = await patchSheet(runId, { replacesRunId: null });
    expect(chosen.status).toBe(200);
    const stored = await client.query(`select version, parsed->'sheets'->0 as sheet from intake_runs where id = $1`, [runId]);
    expect(stored.rows[0].sheet.newPhaseChosen).toBe(true);
    // The version the PATCH answers is the bill's version AFTER its second
    // write (clearing the pairings), so a confirm carrying it is not refused.
    expect((await chosen.json()).version).toBe(Number(stored.rows[0].version));

    const res = await confirm(runId);
    expect(res.status).toBe(200);
    expect(await phaseCount()).toBe(2);
  });

  it("asks nothing of a tab that looks like no phase: a new phase by default, as before", { timeout: 30_000 }, async () => {
    const runId = await stage("__QA Public Areas", ["__QA-PA-01", "__QA-PA-02"]);
    const body = await review(runId);
    expect(body.phaseSuggestions[0]).toBeUndefined();
    const before = await phaseCount();
    const res = await confirm(runId);
    expect(res.status).toBe(200);
    expect(await phaseCount()).toBe(before + 1);
  });
});
