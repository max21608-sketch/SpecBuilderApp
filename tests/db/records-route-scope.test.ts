// Database tier: the phase table loads the questions of the lines it LISTS
// (audit F13, 2026-11-06).
//
// `/api/records?runId=` ran `loadOutstanding(projectId)` and
// `loadSentCoverage(projectId)` for the WHOLE project on every load, then
// threw away everything not on the phase: measured on a synthetic 440-record
// project, 19,715 question rows read to draw a phase of 300. `loadOutstanding`
// already takes a scope (a WHERE on the same query, built for the fill-in
// screen), so the route passes the listed lines. These tests hold that the
// route ASKS for only its lines and that what it prints is unchanged: the same
// counts a whole-project load gives for those records.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000001", email: "__qa@example.test", name: "QA", role: "viewer" }),
}));

/** What the route asked the loaders for, call by call. */
const asked = vi.hoisted(() => ({ outstanding: [] as unknown[], coverage: [] as unknown[] }));
vi.mock("@/lib/chase-drafts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chase-drafts")>();
  return {
    ...real,
    loadOutstanding: (...args: Parameters<typeof real.loadOutstanding>) => {
      asked.outstanding.push(args[1] ?? null);
      return real.loadOutstanding(...args);
    },
    loadSentCoverage: (...args: Parameters<typeof real.loadSentCoverage>) => {
      asked.coverage.push(args[1] ?? null);
      return real.loadSentCoverage(...args);
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the phase table reads the lines it lists", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let phaseA = "";
  let phaseB = "";
  const onA: string[] = [];
  let lineWithOptions = "";

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA records scope', 'qa', 'qa') returning id`,
        [qaNumber("P90591")],
      )
    ).rows[0].id;
    const phase = async (name: string) =>
      (await client.query(`insert into spec_runs (project_id, name, created_by, updated_by) values ($1, $2, 'qa', 'qa') returning id`, [projectId, name])).rows[0].id as string;
    phaseA = await phase("__QA A");
    phaseB = await phase("__QA B");
    const category = (
      await client.query(
        `select c.id from item_categories c where c.slug not like '\\_\\_qa%'
           and exists (select 1 from requirements q where q.category_id = c.id) order by c.slug limit 1`,
      )
    ).rows[0].id;
    const record = async (run: string, no: number, parent: string | null = null) =>
      (
        await client.query(
          `insert into spec_records (project_id, run_id, record_no, item_description, category_id, level, status,
                                     parent_id, depth, split_reason, variant_label, created_by, updated_by)
           values ($1, $2, $3, 'Invented item', $4, 'simple', 'active',
                   $5, $6, $7, $8, 'qa', 'qa') returning id`,
          [projectId, run, no, category, parent, parent ? 1 : 0, parent ? "configuration" : null, parent ? `V${no}` : null],
        )
      ).rows[0].id as string;
    onA.push(await record(phaseA, 1), await record(phaseA, 2));
    lineWithOptions = await record(phaseA, 3);
    onA.push(lineWithOptions, await record(phaseA, 4, lineWithOptions), await record(phaseA, 5, lineWithOptions));
    await record(phaseB, 6);
    await record(phaseB, 7);
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select r.id, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
         from spec_records r join requirements q on q.category_id = r.category_id where r.project_id = $1`,
      [projectId],
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("asks loadOutstanding and loadSentCoverage for this phase's lines only, and counts as a whole-project load does", async () => {
    asked.outstanding.length = 0;
    asked.coverage.length = 0;
    const { GET } = await import("@/app/api/records/route");
    const response = await GET(new Request(`http://x/api/records?projectId=${projectId}&runId=${phaseA}`));
    const body = (await response.json()) as { records: { id: string; to_quote_outstanding: number | null; waiting: number }[] };
    expect(response.status).toBe(200);

    // The lines of phase A: two items, and the split line with its options.
    expect(asked.outstanding).toHaveLength(1);
    const scope = asked.outstanding[0] as { lineIds?: string[] } | null;
    expect(scope?.lineIds ? [...scope.lineIds].sort() : scope).toEqual([onA[0], onA[1], lineWithOptions].sort());
    expect(asked.coverage).toHaveLength(1);
    const coverageScope = asked.coverage[0] as { recordIds?: string[] } | null;
    expect(coverageScope?.recordIds ? [...coverageScope.recordIds].sort() : coverageScope).toEqual([...onA].sort());

    // What the cells say is what the whole-project table says for the same
    // records: scoping changes what is READ, never what is counted.
    const all = (await (await GET(new Request(`http://x/api/records?projectId=${projectId}`))).json()) as typeof body;
    const wholeById = new Map(all.records.map((row) => [row.id, row]));
    for (const row of body.records) {
      expect(row.to_quote_outstanding, row.id).toBe(wholeById.get(row.id)!.to_quote_outstanding);
      expect(row.waiting, row.id).toBe(wholeById.get(row.id)!.waiting);
      if (row.id === lineWithOptions) expect(row.to_quote_outstanding).toBeNull();
      else expect(row.to_quote_outstanding).toBeGreaterThan(0);
    }
    expect(body.records.map((row) => row.id).sort()).toEqual([...onA].sort());
  });
});
