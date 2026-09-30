// Database tier — a bill's multi-line description cells are read at confirm.
// Through the real review GET and the real confirm route, on the local stack.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-description.test.ts
//
// ============================================================================
// WHAT IT PROVES.
//
// The Aman pricing document writes an item as one cell: a name, then its size,
// finishes and model on lines of their own. The confirm now names the record
// after the first line and writes the rest as `record_attributes` sourced to
// the bill's run with no page — slots, BWS fields, the finishes library — and
// the review GET shows exactly that plan first. Every cell here is SYNTHETIC:
// the shape is the bill's, the codes and figures are invented.
//
// And the four traps: the fabric line under an item and a fabric named in its
// description give ONE COM, not two; a single-line bill reads exactly as it
// did; a revision writes nothing twice onto a record that already holds a
// bill's specifications; and it does write onto a carried record that holds
// none.
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
const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const BENCH = [
  "Bench @ Example Lounge",
  "Model Ref: Bespoke",
  "Sizes (ft-in): W 5'-0\"\" x D 1'-6\"\" x H 1'-4\"\"",
  // The missing line break the real bill has, welded onto the seat height.
  "Sizes(mm): W 1520 x D 460 x OAH 410 x SH 360Finish: ZZ-TIM-09 Example Oak",
  "Metal: ZZ-MTL-01 EXAMPLE BRONZE",
  "COM: ZZ-FAB-04",
].join("\r\n");
const SIDE_TABLE = ["Side Table", "Sizes(mm): DIA 400 x H 550", "Finish: ", "ZZ-TIM-10 - Example Walnut", "ZZ-MTL-01 - Example Bronze"].join(
  "\r\n",
);
const collapse = (cell: string) => cell.replace(/\s+/g, " ").trim();

describeIfDb("a bill's description cells, read at confirm", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let categoryId = "";
  let firstRunId = "";
  let phaseId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA bill descriptions', 'qa', 'qa') returning id`,
        [qaNumber("P90071")],
      )
    ).rows[0].id;
    // A category whose checklist asks Dimensions (BWS field 3), so the
    // composed cell reaching the answer is part of what is proved.
    categoryId = (
      await client.query(
        `select c.id from item_categories c
         where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = 3)
         order by c.sort_order limit 1`,
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

  function line(index: number, lineNo: number, code: string | null, cell: string, extra: Record<string, unknown> = {}) {
    const multi = /[\r\n]/.test(cell.trim());
    return {
      index,
      lineNo,
      designer: null,
      boqCategory: "__QA",
      area: "__QA Example Suites",
      code,
      itemDescription: collapse(cell),
      ...(multi ? { itemDescriptionRaw: cell } : {}),
      productReference: null,
      qty: 4,
      qtyUnit: "ea",
      categoryId,
      categoryStatus: "chosen",
      ignored: false,
      ...extra,
    };
  }

  async function stage(lines: Record<string, unknown>[], replacesRunId: string | null = null): Promise<string> {
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
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
              replacesRunId,
              metadata: { revision: replacesRunId ? "B" : "A", date: null, notes: [] },
              lines,
            },
          ],
        }),
      ],
    );
    return run.rows[0].id;
  }

  const review = async (runId: string) => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    expect(response.status).toBe(200);
    return (await response.json()) as {
      descriptions: Record<string, Record<string, { name: string; dimensionCell: string; revisionRefusal: string | null; attributes: unknown[] }>>;
      descriptionsRead: boolean;
    };
  };
  const confirm = async (runId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    return POST(post({}), params(runId));
  };
  const attributesOf = async (recordId: string) =>
    (
      await client.query(
        `select a.attr_group, a.dimension_slot, a.label, a.value, a.unit, a.material_code, a.state, a.source_run_id,
                a.source_page, a.finish_id, f.json_id
         from record_attributes a left join spec_fields f on f.id = a.spec_field_id
         where a.record_id = $1 and a.status = 'active' order by a.sort_order, a.created_at`,
        [recordId],
      )
    ).rows;
  const recordByLine = async (lineNo: number) =>
    (
      await client.query(
        `select id, version, item_description from spec_records
         where project_id = $1 and source_line_no = $2 and status = 'active'`,
        [projectId, lineNo],
      )
    ).rows[0] as { id: string; version: number; item_description: string };

  it("names each record after its cell's first line and writes the rest, as the review showed it", { timeout: 60_000 }, async () => {
    firstRunId = await stage([
      line(0, 2, "ZZ-FUR-01", BENCH),
      // The item's own fabric line: written as its COM by the fabric path.
      line(1, 3, "ZZ-FAB-04 (ZZ-FUR-01)", "Fabric @ Bench Example weave", {
        rowKind: "finish_for",
        rowKindSource: "bill",
        finishFor: { row: 2, code: "ZZ-FUR-01" },
      }),
      line(2, 4, "ZZ-FUR-02", SIDE_TABLE),
      line(3, 5, "ZZ-FUR-03", "Lounge chair"),
    ]);

    // THE REVIEW FIRST: what the reviewer is shown is the plan the confirm writes.
    const shown = await review(firstRunId);
    expect(shown.descriptionsRead).toBe(true);
    expect(Object.keys(shown.descriptions["0"] ?? {})).toEqual(["0", "2"]);
    expect(shown.descriptions["0"]?.["0"]?.name).toBe("Bench @ Example Lounge");
    expect(shown.descriptions["0"]?.["0"]?.dimensionCell).toBe("W1520 x D460 x H410 x SH360mm");
    expect(shown.descriptions["0"]?.["2"]?.dimensionCell).toBe("Dia.400 x H550mm");

    const response = await confirm(firstRunId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { imported: number; fabricSpecs: number; descriptionSpecs: number };
    expect(body).toMatchObject({ imported: 3, fabricSpecs: 1 });
    phaseId = (await client.query(`select id from spec_runs where project_id = $1`, [projectId])).rows[0].id;

    const bench = await recordByLine(2);
    const table = await recordByLine(4);
    const chair = await recordByLine(5);
    expect(bench.item_description).toBe("Bench @ Example Lounge");
    expect(table.item_description).toBe("Side Table");
    // A SINGLE-LINE DESCRIPTION IS ITS OWN NAME AND STATES NOTHING ELSE.
    expect(chair.item_description).toBe("Lounge chair");
    expect(await attributesOf(chair.id)).toEqual([]);

    const onBench = await attributesOf(bench.id);
    // Every row is the bill's, with no page: a spreadsheet has none.
    expect(onBench.every((row) => row.source_run_id === firstRunId && row.source_page === null)).toBe(true);
    // ONE SIZE LINE FILLED THE SLOTS — the mm one; OAH is the height; the
    // imperial twin is a note.
    expect(
      onBench.filter((row) => row.attr_group === "dimension").map((row) => `${row.dimension_slot} ${row.value}${row.unit}`),
    ).toEqual(["W 1520mm", "D 460mm", "H 410mm", "SH 360mm"]);
    // The finishes in their fields, and the ONE COM — the fabric line's.
    const fielded = onBench.filter((row) => row.json_id !== null).map((row) => [row.json_id, row.material_code, row.value]);
    expect(fielded).toEqual(
      expect.arrayContaining([
        [4, "ZZ-TIM-09", "ZZ-TIM-09 Example Oak"],
        [5, "ZZ-MTL-01", "ZZ-MTL-01 EXAMPLE BRONZE"],
        [1, "ZZ-FAB-04", "Fabric @ Bench Example weave"],
      ]),
    );
    expect(onBench.filter((row) => [1, 2, 14].includes(Number(row.json_id)))).toHaveLength(1);
    // The description's fabric and every other line, as notes, verbatim.
    expect(onBench.filter((row) => row.attr_group === "note").map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Model Ref: Bespoke",
      "Sizes (ft-in): W 5'-0\"\" x D 1'-6\"\" x H 1'-4\"\"",
      "COM: ZZ-FAB-04",
    ]);

    // THE FINISHES LIBRARY: one row per code, ZZ-MTL-01 once for both items —
    // "EXAMPLE BRONZE" and "Example Bronze" are one description, case folded.
    const library = await client.query(
      `select code, description, state from project_finishes where project_id = $1 order by code`,
      [projectId],
    );
    expect(library.rows.map((row) => row.code)).toEqual(["ZZ-FAB-04", "ZZ-MTL-01", "ZZ-TIM-09", "ZZ-TIM-10"]);
    expect(library.rows.every((row) => row.state === "tbc")).toBe(true);
    const metal = await client.query(
      `select distinct finish_id from record_attributes where material_code = 'ZZ-MTL-01' and record_id = any($1::uuid[])`,
      [[bench.id, table.id]],
    );
    expect(metal.rows).toHaveLength(1);
    expect(metal.rows[0].finish_id).not.toBeNull();

    // The checklist follows: the Dimensions answer is the composed cell.
    const dims = await client.query(
      `select a.value from spec_answers a join spec_fields f on f.id = a.spec_field_id
       where a.record_id = $1 and f.json_id = 3`,
      [bench.id],
    );
    expect(dims.rows.map((row) => row.value)).toContain("W1520 x D460 x H410 x SH360mm");

    // And the version is taken LAST, so it holds what the description wrote.
    const snapshots = await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [bench.id]);
    expect(snapshots.rows[0].n).toBe(1);

    // No charged read of these same cells is offered, and none is registered.
    const { POST: readSpecs } = await import("@/app/api/imports/[id]/read-specifications/route");
    const refused = await readSpecs(post({}), params(firstRunId));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toMatch(/descriptions were read when it was confirmed/);
  });

  it("a revision writes nothing twice, says so first, and still fills a record that held nothing", { timeout: 60_000 }, async () => {
    const bench = await recordByLine(2);
    const table = await recordByLine(4);
    const chair = await recordByLine(5);
    const before = (await attributesOf(bench.id)).length;
    const replaces = (record: { id: string; version: number }) => ({ replaces: { recordId: record.id, recordVersion: record.version } });

    const revision = await stage(
      [
        line(0, 2, "ZZ-FUR-01", BENCH, replaces(bench)),
        line(1, 3, "ZZ-FAB-04 (ZZ-FUR-01)", "Fabric @ Bench Example weave", {
          rowKind: "finish_for",
          rowKindSource: "bill",
          finishFor: { row: 2, code: "ZZ-FUR-01" },
        }),
        line(2, 4, "ZZ-FUR-02", SIDE_TABLE, replaces(table)),
        // The lounge chair's revised cell now states a size, and its record holds nothing.
        line(3, 5, "ZZ-FUR-03", "Lounge chair\r\nSizes (mm): W 700 x D 800 x H 750", replaces(chair)),
      ],
      phaseId,
    );

    const shown = await review(revision);
    expect(shown.descriptions["0"]?.["0"]?.revisionRefusal).toMatch(/already holds specifications from a bill/);
    expect(shown.descriptions["0"]?.["3"]?.revisionRefusal).toBeNull();

    const response = await confirm(revision);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 3, imported: 0, descriptionsHeldBack: 2 });

    expect((await attributesOf(bench.id)).length).toBe(before);
    expect((await recordByLine(2)).item_description).toBe("Bench @ Example Lounge");
    expect(
      (await attributesOf(chair.id)).filter((row) => row.attr_group === "dimension").map((row) => `${row.dimension_slot} ${row.value}`),
    ).toEqual(["W 700", "D 800", "H 750"]);
    expect((await recordByLine(5)).item_description).toBe("Lounge chair");
  });
});
