// Database tier — a size part's slot, corrected on the bill review before the
// confirm. Through the real PATCH, the real review GET and the real confirm.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-slot-override.test.ts
//
// ============================================================================
// WHAT IT PROVES.
//
// Matthew, 2026-10-01: a round stool's "D" is its diameter. The review shows
// the line's parts; a person says D 400 is the diameter; the change is stored
// on the staged line under that map's own version; the review recomposes the
// cell; a stale screen is refused with a 409 and a change that would put two
// parts in one slot with a 400 — both writing nothing; and the confirm writes
// the DIAMETER as a `record_attributes` dimension and the composed cell as the
// Dimensions answer. Every cell is SYNTHETIC.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

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
const request = (method: string, body: unknown) =>
  new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const STOOL = ["Stool @ Example Corridor", "Model Ref: Bespoke", "Spec size: D 400 X H 420 mm"].join("\r\n");

describeIfDb("a size part's slot, corrected before the confirm", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill slot override', 'qa', 'qa') returning id`,
        [qaNumber("P90081")],
      )
    ).rows[0].id;
    categoryId = (
      await client.query(
        `select c.id from item_categories c
         where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 3)
         order by c.sort_order limit 1`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
         values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
        [
          projectId,
          JSON.stringify({
            schemaVersion: 4,
            filename: "__QA pricing.xlsx",
            sourcePreserved: false,
            sheets: [
              {
                sheetName: "__QA BILL",
                proposedRunName: "__QA BILL",
                headerRow: 1,
                skippedRows: 0,
                ignored: false,
                ignoredReason: null,
                replacesRunId: null,
                metadata: { revision: "A", date: null, notes: [] },
                lines: [
                  {
                    index: 0,
                    lineNo: 2,
                    designer: null,
                    boqCategory: "__QA",
                    area: "__QA Example Suites",
                    code: "ZZ-FUR-10",
                    itemDescription: STOOL.replace(/\s+/g, " "),
                    itemDescriptionRaw: STOOL,
                    productReference: null,
                    qty: 2,
                    qtyUnit: "ea",
                    categoryId,
                    categoryStatus: "chosen",
                    ignored: false,
                  },
                ],
              },
            ],
          }),
        ],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(`delete from status_history where entity_id in ${records}`, [projectId]);
      await client.query(`delete from spec_answers where record_id in ${records}`, [projectId]);
      await client.query(`delete from record_attributes where record_id in ${records}`, [projectId]);
      await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const review = async () => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    expect(response.status).toBe(200);
    return (await response.json()) as {
      descriptions: Record<string, Record<string, { dimensionCell: string; depthWithoutWidth: string | null; cautions: string[] }>>;
    };
  };
  const patch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    return PATCH(request("PATCH", body), params(runId));
  };
  const stagedLine = async () =>
    (await client.query(`select parsed->'sheets'->0->'lines'->0 as line from intake_runs where id = $1`, [runId])).rows[0]
      .line as { slotOverrides?: Record<string, string>; slotOverridesVersion?: number };

  it("stores the change on the line, recomposes the review, and refuses a stale or doubled-up one", async () => {
    const before = await review();
    expect(before.descriptions["0"]?.["0"]?.dimensionCell).toBe("D400 x H420mm");
    expect(before.descriptions["0"]?.["0"]?.depthWithoutWidth).toBe("D 400");

    const set = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "D 400", slot: "DIA" }, slotOverridesVersion: 0 });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ ok: true, slotOverridesVersion: 1 });
    expect(await stagedLine()).toMatchObject({ slotOverrides: { "D 400": "DIA" }, slotOverridesVersion: 1 });

    const after = await review();
    expect(after.descriptions["0"]?.["0"]?.dimensionCell).toBe("Dia.400 x H420mm");
    expect(after.descriptions["0"]?.["0"]?.depthWithoutWidth).toBeNull();

    // A SCREEN DRAWN BEFORE THAT CHANGE is refused, and writes nothing.
    const stale = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "H 420", slot: "note" }, slotOverridesVersion: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.text()).toMatch(/changed in another tab/);
    expect(await stagedLine()).toMatchObject({ slotOverrides: { "D 400": "DIA" }, slotOverridesVersion: 1 });

    // TWO PARTS IN ONE SLOT is refused in words, and writes nothing.
    const doubled = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "H 420", slot: "DIA" }, slotOverridesVersion: 1 });
    expect(doubled.status).toBe(400);
    expect(await doubled.text()).toMatch(/both in the diameter slot/);
    expect(await stagedLine()).toMatchObject({ slotOverrides: { "D 400": "DIA" }, slotOverridesVersion: 1 });

    // A PART THE LINE DOES NOT PRINT is refused rather than stored.
    const gone = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "W 900", slot: "W" }, slotOverridesVersion: 1 });
    expect(gone.status).toBe(409);
    expect(await gone.text()).toMatch(/no longer prints “W 900”/);

    // Not a slot.
    const nonsense = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "D 400", slot: "Diameter" }, slotOverridesVersion: 1 });
    expect(nonsense.status).toBe(400);
  });

  it("confirms the diameter as a dimension attribute and the composed cell as the answer", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(request("POST", {}), params(runId));
    expect(response.status).toBe(200);

    const record = (
      await client.query(`select id from spec_records where project_id = $1 and source_line_no = 2 and status = 'active'`, [
        projectId,
      ])
    ).rows[0] as { id: string };
    const dimensions = await client.query(
      `select dimension_slot, value, unit from record_attributes
       where record_id = $1 and status = 'active' and attr_group = 'dimension' order by sort_order`,
      [record.id],
    );
    expect(dimensions.rows.map((row) => `${row.dimension_slot} ${row.value}${row.unit}`)).toEqual(["DIA 400mm", "H 420mm"]);
    const dims = await client.query(
      `select a.value from spec_answers a join spec_fields f on f.id = a.spec_field_id
       where a.record_id = $1 and f.json_id = 3`,
      [record.id],
    );
    expect(dims.rows.map((row) => row.value)).toContain("Dia.400 x H420mm");

    // The confirmed bill takes no further slot changes.
    const late = await patch({ sheetIndex: 0, index: 0, slotOverride: { key: "D 400", slot: "D" }, slotOverridesVersion: 1 });
    expect(late.status).toBe(409);
  });
});
