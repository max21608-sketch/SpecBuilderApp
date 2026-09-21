// Database tier — the variance matrix's records-and-phases rows (plan §6.10.d).
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// WHY THESE ARE DATABASE TESTS.
//
// Every row here is a claim about what a LOADER returns, and each of those
// loaders carries a SQL predicate that no pure test can reach: which records
// are in the export's scope, which questions a chase can ask, which records a
// default list leaves out. The failure mode is never arithmetic — it is two
// readings of the same predicate disagreeing, which is what the check sheet
// exists to prevent between two files and what these pin between two screens.
//
// The completion half of row d1 is pinned in `project-completion.test.ts` ("an
// uncategorised record blocks it, having asked nothing"); this file pins the
// half that reaches the chase screen and the infill screen, which read
// `loadOutstanding` and `loadUncategorisedRecords` rather than the completion.
//
// Everything is prefixed `__QA` and deleted in FK-safe order. The project
// numbers are literals rather than a helper, because Coder F is adding one and
// two agents editing the same helper in the same afternoon is a merge conflict
// in a file every db test imports; they will be replaced by it.
// ============================================================================
import { it, expect, beforeAll, afterAll, describe } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { loadOutstanding, loadUncategorisedRecords } from "@/lib/chase-drafts";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("records and phases, the shapes a real project arrives in", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  /** Categorised, levelled, with a client ref: the ordinary case. */
  let ordinaryId = "";
  /** No category at all: no checklist, and therefore no questions. */
  let uncategorisedId = "";

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P90300', '__QA Records variance', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main phase', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;
    // A category that actually asks something. One with no authored
    // requirements would score zero outstanding and prove nothing about a
    // record that scores zero for a different reason.
    const category = await client.query(
      `select c.id from item_categories c
        where exists (select 1 from requirements q where q.category_id = c.id)
        order by c.sort_order limit 1`,
    );
    categoryId = category.rows[0].id;

    const ordinary = await client.query(
      // `status` defaults to 'draft' and every scope here takes only 'active',
      // so a fixture that left it would be counted by nothing.
      `insert into spec_records (project_id, run_id, record_no, category_id, item_description, qty, level,
                                 status, created_by, updated_by)
       values ($1, $2, 1, $3, '__QA Sofa', 4, 'simple', 'active', 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    ordinaryId = ordinary.rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', '__QA S-100', '__qa s-100', 'qa')`,
      [ordinaryId, projectId],
    );

    const uncategorised = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, qty, level,
                                 status, created_by, updated_by)
       values ($1, $2, 2, '__QA Unknown thing', 1, 'simple', 'active', 'qa', 'qa') returning id`,
      [projectId, runId],
    );
    uncategorisedId = uncategorised.rows[0].id;
  });

  afterAll(async () => {
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  describe("an uncategorised record (row d1)", () => {
    it("has no questions at all, so no chase can ask about it", async () => {
      // The inner join to `item_categories` is what does it, and that is the
      // right answer rather than a gap: nobody has decided what to ask. The
      // trap is the screen that renders the consequence as "0 outstanding".
      const outstanding = await loadOutstanding(projectId);
      expect(outstanding.some((question) => question.recordId === ordinaryId)).toBe(true);
      expect(outstanding.filter((question) => question.recordId === uncategorisedId)).toEqual([]);
    });

    it("is NAMED by the loader both screens use for it, not merely absent", async () => {
      // `loadUncategorisedRecords` is what the chase screen's blocker panel and
      // the infill screen's UncategorisedBlock both read. Absence alone would
      // leave a record that can never be chased invisible on the one screen
      // whose job is to say what is in the way.
      const named = await loadUncategorisedRecords(projectId);
      expect(named.map((row) => row.recordId)).toContain(uncategorisedId);
      expect(named.map((row) => row.recordId)).not.toContain(ordinaryId);
      // With the optimistic lock, so a category can be SET from that list.
      expect(named.find((row) => row.recordId === uncategorisedId)?.version).toBeGreaterThanOrEqual(1);
    });

    it("is not chaseable merely because somebody set its level", async () => {
      // Both fixtures carry a level, so this is the clean statement of it: a
      // level tiers questions and creates none. The phase table used to answer
      // an uncategorised row with the LEVEL sentence, which sends somebody to
      // choose simple or hero for nothing.
      const levels = await client.query(`select level from spec_records where id = $1`, [uncategorisedId]);
      expect(levels.rows[0].level).toBe("simple");
      const outstanding = await loadOutstanding(projectId, { lineIds: [uncategorisedId] });
      expect(outstanding).toEqual([]);
    });
  });
});
