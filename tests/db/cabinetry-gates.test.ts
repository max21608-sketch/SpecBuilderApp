// Database tier — the provisional cabinetry gate model (seed 0014) as the app
// READS it: through loadGateContext, gatesForRecord and itemTgqForRecord, the
// one loader every screen uses.
//
// THE TRAP. The seed passing its own closing checks says nothing about whether
// the loaders see what it says. His "All categories" rows reach the cabinetry
// types only through the GENERATED `applies_to_all` (0061); a loader still
// joining on `applies_to && array[code]` alone gives a side table its four
// drafted TGQ questions and none of his dimensions, and the side table reads
// as priceable once those four are answered.
//
// Rows are `__QA `-prefixed and deleted FK-safe.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { sql } from "@/lib/db";
import { gatesForRecord, itemTgqForRecord, loadGateContext, loadTgqMatrices, provisionalNoteFor } from "@/lib/gate-load";
import { loadOutstanding } from "@/lib/chase-drafts";
import { inItemTgq } from "@/lib/chase-grouping";
import { loadProjectSummary } from "@/lib/project-summary";

const databaseUrl = process.env.DATABASE_URL;
const NOTE = "Provisional cabinetry gate model, drafted by AI on 20 Nov 2026, not yet confirmed by Matthew";

describeIfDb("the provisional cabinetry gate model, as the loaders read it", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  const ids: Record<string, string> = {};
  const cats: Record<string, string> = {};
  // Asserted present: every key below is set in beforeAll, and a missing one
  // should fail loudly rather than pass undefined to a loader.
  const id = (key: string): string => {
    const value = ids[key];
    if (!value) throw new Error(`no fixture record "${key}"`);
    return value;
  };
  const cat = (slug: string): string => {
    const value = cats[slug];
    if (!value) throw new Error(`no seeded category "${slug}"`);
    return value;
  };

  async function record(no: number, slug: string, description: string): Promise<string> {
    return (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status,
                                   created_by, updated_by)
         select $1, $2, $3, c.id, $4, 'active', 'qa', 'qa' from item_categories c where c.slug = $5
         returning id`,
        [projectId, runId, no, description, slug],
      )
    ).rows[0].id as string;
  }

  async function answerLocal(recordId: string, localKey: string, value: string | null, state = "confirmed") {
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, value, confirmed_by, confirmed_at,
                                 created_by, updated_by)
       select r.id, q.id, null, $3, $4, 'qa', now(), 'qa', 'qa'
         from spec_records r join requirements q on q.category_id = r.category_id and q.local_key = $2
        where r.id = $1
       on conflict (record_id, requirement_id, revision_no)
       do update set state = excluded.state, value = excluded.value`,
      [recordId, localKey, state, value],
    );
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Cabinetry gates', 'qa', 'qa') returning id`,
        [qaNumber("P90061")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    ids.side = await record(1, "side-coffee-bedside-tables", "__QA Side table");
    ids.dining = await record(2, "dining-tables", "__QA Dining table, 4 cover");
    ids.mirror = await record(3, "mirrors", "__QA Wall mirror");
    ids.sofa = await record(4, "armchairs-benches-stools-sofas", "__QA Three seat sofa");
    for (const row of (
      await client.query(`select id, slug from item_categories where created_by = 'seed'`)
    ).rows as { id: string; slug: string }[]) {
      cats[row.slug] = row.id;
    }
  });

  afterAll(async () => {
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [
      projectId,
    ]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  const gates = async (key: string, slug: string) => {
    const context = await loadGateContext(sql, [id(key)]);
    return { context, gates: gatesForRecord(context, { id: id(key), categoryId: cat(slug) }) };
  };

  it("a side table has a gate view: his All-categories rows plus the drafted ones that name it", async () => {
    const { gates: g } = await gates("side", "side-coffee-bedside-tables");
    expect(g).not.toBeNull();
    const rows = (gate: "TGQ" | "TG0" | "TG1") => g![gate].fields.map((f) => f.field.matrixRow);
    // His 1-6 and 8-11 (row 7, seat height, is seating only), and 101-103:
    // a side table is not asked whether it is fitted to a wall (104).
    expect(rows("TGQ")).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 101, 102, 103]);
    // TG0 is the drafted materials only; his seating TG0 rows never reach it.
    expect(rows("TG0")).toEqual([105, 106, 107, 108, 109, 110, 111, 113, 114, 115, 116, 117, 118, 119, 120]);
    // His four production-lock rows are All categories.
    expect(rows("TG1")).toEqual([32, 33, 34, 35]);
  });

  it("a mirror is asked its glass outright, and none of the drawer or second-finish rows", async () => {
    const { gates: g } = await gates("mirror", "mirrors");
    const tg0 = g!.TG0.fields.map((f) => f.field.matrixRow);
    expect(tg0).toContain(112);
    expect(tg0).not.toContain(113);
    for (const row of [107, 108, 110, 116, 118, 120]) expect(tg0).not.toContain(row);
    expect(g!.TGQ.fields.map((f) => f.field.matrixRow)).toContain(104);
  });

  it("a blank side table's TGQ is its own model's rows, not every open question", async () => {
    const context = await loadGateContext(sql, [id("side")]);
    const tgq = itemTgqForRecord(context, { id: id("side"), categoryId: cat("side-coffee-bedside-tables") }, []);
    expect(tgq.model).toBe("matrix");
    // 30 under the placeholder (coder 1's before-count on T20120-006). Now the
    // gate's TGQ rows less the settled, project-wide and nowhere ones: W, D,
    // H, spec notes, designer reference, outdoor, the three controllers.
    expect(tgq.count).not.toBeNull();
    expect(tgq.count!).toBeLessThanOrEqual(10);
    expect(tgq.rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Stone top or stone parts?", "Glass or mirror?", "Integrated lighting or power?"]),
    );
  });

  it("a dining table's socket row is UNKNOWN until 103 is answered, then judged", async () => {
    const socket = async () => {
      const { gates: g } = await gates("dining", "dining-tables");
      return g!.TG0.fields.find((f) => f.field.matrixRow === 120)!;
    };
    expect((await socket()).outcome).toBe("unknown");
    await answerLocal(id("dining"), "has_lighting_power", "No");
    expect((await socket()).outcome).toBe("not_applicable");
    await answerLocal(id("dining"), "has_lighting_power", "Yes");
    expect((await socket()).outcome).toBe("blocking");
  });

  it("the context carries the provisional note for a cabinetry record, and none for his seating", async () => {
    const context = await loadGateContext(sql, [id("side"), id("sofa")]);
    expect(provisionalNoteFor(context, { categoryId: cat("side-coffee-bedside-tables") })).toBe(NOTE);
    expect(provisionalNoteFor(context, { categoryId: cat("armchairs-benches-stools-sofas") })).toBeNull();
    expect(provisionalNoteFor(context, { categoryId: null })).toBeNull();
  });

  it("the TGQ matrix a checklist is handed carries his All-categories fields to a cabinetry sheet", async () => {
    const matrices = await loadTgqMatrices(sql);
    const side = matrices.get(cat("side-coffee-bedside-tables"))!;
    expect(side).toBeDefined();
    // Outdoor (130) is his row 9, All categories.
    expect(side.fields.has(130)).toBe(true);
    expect([...side.localKeys].sort()).toEqual(
      expect.arrayContaining(["has_stone", "has_glass_mirror", "has_lighting_power"]),
    );
    expect(side.localKeys.has("fitted_or_built_in")).toBe(false);
  });

  it("the overview's SQL tiers a cabinetry question by the model the TypeScript reads", async () => {
    // project-summary.ts re-expresses the tier in SQL. Its join needed the
    // same applies_to_all as loadTgqMatrices, or the overview counts a side
    // table's Outdoor question as also-outstanding while the chase screen
    // counts it at TGQ.
    const outstanding = await loadOutstanding(projectId);
    const outdoor = outstanding.find(
      (q) => q.recordId === id("side") && q.prompt === "Indoor/ Outdoor / Humid environment",
    );
    expect(outdoor?.tier).toBe("to_quote");
    const summary = await loadProjectSummary(projectId);
    expect(summary.toQuoteQuestions).toBe(outstanding.filter(inItemTgq).length);
  });
});
