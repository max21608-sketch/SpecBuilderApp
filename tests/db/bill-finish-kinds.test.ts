// Database tier — a bill's finish lines are filed by KIND (2026-10-06): one
// item carrying four fabrics, a metal, a timber and a trim CONFIRMS; COM 1–3,
// Main metal finish and Main timber finish are written and their checklist
// answers filled; the fourth fabric and the trim are kept with no field; and
// a contractor's uncoded fabric line still mints an in-house code. A revision
// keeps its refuse-on-change rule PER KIND: a changed timber is refused by
// name, and a first line of a kind the record holds none of is written though
// the record holds fabrics from the bill. Through the
// real registration, the real review GET, the real row-kind PATCH and the
// real confirm, with the blob store held in memory.
//
// Skips without DATABASE_URL. Run from a worktree with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/bill-finish-kinds.test.ts
//
// Nothing here is a client document: `finishLinesBillWorkbook` is built from
// source every run, every code, supplier and colour invented.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { FINISH_LINES, finishLinesBillWorkbook } from "../fixtures/build-boq";

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

type Parsed = { sheets: { lines: { index: number; lineNo: number; rowKind?: string }[] }[] };

describeIfDb("a bill's finish lines, filed by kind", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, finish_code_prefix, created_by, updated_by)
         values ($1, '__QA finish lines by kind', 'ZZB', 'qa', 'qa') returning id`,
        [qaNumber("P90461")],
      )
    ).rows[0].id as string;
  });

  afterAll(async () => {
    if (projectId) {
      const records = `(select id from spec_records where project_id = $1)`;
      await client.query(
        `delete from attachments where entity_type = 'project_finishes'
           and entity_id in (select id from project_finishes where project_id = $1)`,
        [projectId],
      );
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

  const parsed = async () =>
    (await client.query(`select parsed from intake_runs where id = $1`, [runId])).rows[0].parsed as Parsed;
  const indexOf = async (row: number) => (await parsed()).sheets[0]!.lines.find((line) => line.lineNo === row)!.index;
  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/imports/[id]/route");
    const response = await PATCH(jsonRequest("PATCH", body), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status, result.error).toBe(200);
  };

  it("stages the bill, and its finish lines under their items", { timeout: 60_000 }, async () => {
    const pathname = `projects/${projectId}/__QA finish lines.xlsx`;
    files.set(pathname, {
      bytes: await finishLinesBillWorkbook(),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { POST } = await import("@/app/api/imports/route");
    const response = await POST(
      jsonRequest("POST", { projectId, importType: "boq", pathname, filename: "__QA finish lines.xlsx", contentType: "" }),
    );
    const body = (await response.json()) as { importId: string; error?: string };
    expect(response.status, body.error).toBe(201);
    runId = body.importId;

    // As the structure read says it: each finish line `finish_for` its item.
    for (const row of [4, 5, 6, 7, 8, 9, 10]) {
      await patch({ sheetIndex: 0, index: await indexOf(row), rowKind: "finish_for", finishForRow: 3 });
    }
    await patch({ sheetIndex: 0, index: await indexOf(12), rowKind: "finish_for", finishForRow: 11 });

    // A category on both items that asks every field these lines fill, so
    // the checklist has questions for the confirm to answer.
    const category = (
      await client.query(
        `select q.category_id from requirements q join spec_fields f on f.id = q.spec_field_id
          where f.json_id in (1, 2, 14, 4, 5) group by q.category_id having count(distinct f.json_id) = 5 limit 1`,
      )
    ).rows[0]?.category_id as string;
    expect(category).toBeTruthy();
    for (const row of [3, 11]) await patch({ sheetIndex: 0, index: await indexOf(row), categoryId: category });
  });

  it("says on the review where every finish line goes", { timeout: 60_000 }, async () => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(runId));
    const body = (await response.json()) as {
      fabricFilings: Record<number, Record<number, { goesTo: string; filing: string }>>;
    };
    const line = async (row: number) => body.fabricFilings[0]?.[await indexOf(row)];
    expect(await line(4)).toMatchObject({ goesTo: "→ COM 1", filing: "new library entry F-FA-05" });
    expect((await line(5))?.goesTo).toBe("→ COM 2");
    expect((await line(6))?.goesTo).toBe("→ COM 3");
    expect(await line(7)).toMatchObject({ goesTo: "→ kept, COM 1–3 are full", filing: "new library entry F-FA-18" });
    expect((await line(8))?.goesTo).toBe("→ Main metal finish");
    expect((await line(9))?.goesTo).toBe("→ Main timber finish");
    expect(await line(10)).toMatchObject({ goesTo: "→ kept, no BWS field (trim)", filing: "new library entry F-TR-01" });
    expect(await line(12)).toMatchObject({
      goesTo: "→ COM 1",
      filing: "new in-house fabric — numbered BW-ZZB-… at confirm",
    });
  });

  it("confirms an item with seven finishes: every line kept, each kind in its own fields", { timeout: 60_000 }, async () => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(runId));
    const result = (await response.json()) as { ok: boolean; error?: string; fabricSpecs?: number; inHouseFinishes?: number };
    expect(response.status, result.error).toBe(200);
    expect(result.fabricSpecs).toBe(8);
    expect(result.inHouseFinishes).toBe(1);

    const records = await client.query(
      `select id, source_line_no from spec_records where project_id = $1 order by source_line_no`,
      [projectId],
    );
    expect(records.rows.map((row) => Number(row.source_line_no))).toEqual([3, 11]);
    const [banquette, chair] = records.rows.map((row) => String(row.id)) as [string, string];

    const attributes = async (recordId: string) =>
      (
        await client.query(
          `select a.attr_group, a.label, a.value, a.material_code, f.json_id, pf.code as finish_code
             from record_attributes a
             left join spec_fields f on f.id = a.spec_field_id
             left join project_finishes pf on pf.id = a.finish_id
            where a.record_id = $1 and a.status = 'active' and a.source_run_id = $2
            order by a.sort_order`,
          [recordId, runId],
        )
      ).rows.map((row) => [row.attr_group, row.label, row.json_id === null ? null : Number(row.json_id), row.material_code, row.finish_code]);

    // The words stay verbatim; the code is the line's own; every line is filed.
    const words = await client.query(
      `select value from record_attributes where record_id = $1 and source_run_id = $2 order by sort_order`,
      [banquette, runId],
    );
    expect(words.rows.map((row) => row.value)).toEqual([4, 5, 6, 7, 8, 9, 10].map((row) => FINISH_LINES[row as 4].words));
    expect(await attributes(banquette)).toEqual([
      ["material", "Fabric", 1, "F-FA-05", "F-FA-05"],
      ["material", "Fabric", 2, "F-FA-07", "F-FA-07"],
      ["material", "Fabric", 14, "F-FA-08", "F-FA-08"],
      // The fourth fabric: kept, with no field.
      ["material", "Fabric", null, "F-FA-18", "F-FA-18"],
      ["finish", "Metal", 5, "F-MT-03", "F-MT-03"],
      ["finish", "Timber", 4, "F-WD-02", "F-WD-02"],
      // The trim: kept, with no field — BWS has none for it.
      ["other", "Trim", null, "F-TR-01", "F-TR-01"],
    ]);
    // The contractor's uncoded leather: COM 1, an in-house code minted for it.
    expect(await attributes(chair)).toEqual([["material", "Fabric", 1, null, "BW-ZZB-001"]]);

    // The checklist follows, for the metal and the timber as for the fabrics.
    const answers = await client.query(
      `select f.json_id, a.state, a.value from spec_answers a join spec_fields f on f.id = a.spec_field_id
        where a.record_id = $1 and f.json_id in (1, 2, 14, 4, 5) and a.revision_no = 0`,
      [banquette],
    );
    const answer = (jsonId: number) => answers.rows.filter((row) => Number(row.json_id) === jsonId);
    expect(answer(5).map((row) => row.state)).toEqual(["tbc"]);
    expect(String(answer(5)[0]!.value)).toContain("POLISHED NICKEL");
    expect(answer(4).map((row) => row.state)).toEqual(["tbc"]);
    expect(String(answer(4)[0]!.value)).toContain("EXAMPLE SAPELE");
    for (const jsonId of [1, 2, 14]) {
      expect(answer(jsonId).map((row) => row.state), `COM json ${jsonId}`).toEqual(["tbc"]);
    }
    expect(String(answer(14)[0]!.value)).toContain("SAND");
    // The fourth fabric reached no answer: COM 3 holds the third.
    expect(answers.rows.some((row) => String(row.value ?? "").includes("BETA"))).toBe(false);

    // The library holds every coded line and the minted one, all TBC.
    const finishes = await client.query(
      `select code, code_origin, state from project_finishes where project_id = $1 order by code_origin, code`,
      [projectId],
    );
    expect(finishes.rows.map((row) => [row.code, row.code_origin, row.state])).toEqual([
      ["F-FA-05", "client", "tbc"],
      ["F-FA-07", "client", "tbc"],
      ["F-FA-08", "client", "tbc"],
      ["F-FA-18", "client", "tbc"],
      ["F-MT-03", "client", "tbc"],
      ["F-TR-01", "client", "tbc"],
      ["F-WD-02", "client", "tbc"],
      ["BW-ZZB-001", "internal", "tbc"],
    ]);
  });

  // ---- a revision keeps its refuse-on-change rule, PER KIND ------------------
  /** A revision of the bill's phase, staged as its review would leave it: the banquette carried, these finish lines under it. */
  async function stageRevision(finishes: { code: string; words: string }[]): Promise<string> {
    const phase = (await client.query(`select id from spec_runs where project_id = $1`, [projectId])).rows[0].id as string;
    const banquette = (
      await client.query(`select id, version from spec_records where project_id = $1 and source_line_no = 3`, [projectId])
    ).rows[0] as { id: string; version: number };
    const base = { designer: null, boqCategory: null, area: "Example Bar", productReference: null, qtyUnit: null, ignored: false };
    const lines = [
      {
        ...base,
        index: 0,
        lineNo: 3,
        code: "ZZ-SE-03.A",
        itemDescription: "Banquette",
        qty: 1,
        replaces: { recordId: banquette.id, recordVersion: Number(banquette.version) },
      },
      ...finishes.map((finish, offset) => ({
        ...base,
        index: offset + 1,
        lineNo: offset + 4,
        code: finish.code,
        itemDescription: finish.words,
        qty: null,
        replaces: null,
        rowKind: "finish_for",
        finishFor: { row: 3, code: "ZZ-SE-03.A" },
      })),
    ];
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, status, parsed, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [
        projectId,
        JSON.stringify({
          schemaVersion: 3,
          filename: "__QA finish lines rev B.xlsx",
          sourcePreserved: false,
          sheets: [
            {
              sheetName: "Bill",
              proposedRunName: "Bill",
              headerRow: 2,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: phase,
              metadata: { revision: "B", date: null, notes: [] },
              lines,
            },
          ],
        }),
      ],
    );
    return run.rows[0].id as string;
  }
  const confirmRevision = async (revisionId: string) => {
    const { POST } = await import("@/app/api/imports/[id]/confirm/route");
    const response = await POST(jsonRequest("POST", {}), params(revisionId));
    return { status: response.status, body: (await response.json()) as { error?: string; fabricSpecs?: number } };
  };

  it("refuses a revision that changes the timber, naming it", { timeout: 60_000 }, async () => {
    const revision = await stageRevision([
      { code: "F-MT-03", words: FINISH_LINES[8].words },
      { code: "F-WD-05", words: "EXAMPLE WALNUT, OILED" },
    ]);
    const refused = await confirmRevision(revision);
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toMatch(/^Row 5's timber is not the one this item's record already holds from the bill/);
  });

  it("writes a revision's first line of a NEW kind, though the record holds fabrics from the bill", { timeout: 60_000 }, async () => {
    const revision = await stageRevision([
      { code: "F-MT-03", words: FINISH_LINES[8].words },
      { code: "ZZ-HW-01", words: "EXAMPLE CASTORS, BLACK" },
    ]);
    const done = await confirmRevision(revision);
    expect(done.status, done.body.error).toBe(200);
    // The metal it already holds: nothing written. The castors: kept, no field.
    expect(done.body.fabricSpecs).toBe(1);
    const castors = await client.query(
      `select a.attr_group, a.label, a.spec_field_id from record_attributes a
         join spec_records r on r.id = a.record_id
        where r.project_id = $1 and r.source_line_no = 3 and a.status = 'active' and a.value = 'EXAMPLE CASTORS, BLACK'`,
      [projectId],
    );
    expect(castors.rows).toEqual([{ attr_group: "hardware", label: "Hardware", spec_field_id: null }]);
    const metals = await client.query(
      `select count(*)::int as n from record_attributes a join spec_records r on r.id = a.record_id
        where r.project_id = $1 and a.status = 'active' and a.label = 'Metal'`,
      [projectId],
    );
    expect(metals.rows[0].n).toBe(1);
  });
});
