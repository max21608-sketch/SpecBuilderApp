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
import { it, expect, beforeAll, afterAll, describe, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { loadOutstanding, loadUncategorisedRecords } from "@/lib/chase-drafts";
import { isScopeFailure, loadExportScope } from "@/lib/export-scope";
import { BWS_EXPORT_COLUMNS, composeRow } from "@/lib/bws-export";
import { CHECK_SHEET_HEADER, composeCheckSheet } from "@/lib/export-check-sheet";
import { GET as exportRoute } from "@/app/api/projects/[id]/export/route";
import { GET as checkSheetRoute } from "@/app/api/projects/[id]/export/check-sheet/route";
import { GET as recordsRoute } from "@/app/api/records/route";
import { GET as infillRoute } from "@/app/api/projects/[id]/infill/route";

// The routes are the real ones; only the session is stubbed. Nothing here
// registers a document, so no model is called and nothing is charged.
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

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
       values ('${qaNumber("P90300")}', '__QA Records variance', 'qa', 'qa') returning id`,
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

  describe("a record with no client ref at all (row d3)", () => {
    it("exports a BLANK Client Code, never an invented one", async () => {
      // The client ref is the pre-sale primary key, and the record carrying
      // none is a real shape: a line typed by hand, or a bill whose code column
      // was empty. A composed stand-in — the record number, the description,
      // the run's name — would be a code the client has never heard of
      // arriving in their BWS job.
      const loaded = await loadExportScope(projectId, runId);
      if (isScopeFailure(loaded)) throw new Error(loaded.error);
      const column = BWS_EXPORT_COLUMNS.findIndex((entry) => entry.name === "Client Code");
      const rows = new Map(
        loaded.scope.records.map((record) => [
          record.id,
          composeRow(loaded.scope, record, loaded.scope.attributes, loaded.scope.answers),
        ]),
      );
      expect(rows.get(ordinaryId)?.[column]).toBe("__QA S-100");
      expect(rows.get(uncategorisedId)?.[column]).toBe("");
    });

    it("is LISTED by the check sheet, blank cell and all", async () => {
      // The blank cell is the failure most worth catching — the pack states a
      // code and the file lost it — so a sheet that listed only the populated
      // cells could not find the thing it exists to find. Its Client code
      // column is empty and its Verdict column is empty, which is the whole
      // point: the reviewer decides whether the pack agrees.
      const loaded = await loadExportScope(projectId, runId);
      if (isScopeFailure(loaded)) throw new Error(loaded.error);
      const sheet = composeCheckSheet(loaded.scope);
      const recordColumn = CHECK_SHEET_HEADER.indexOf("Record");
      const codeColumn = CHECK_SHEET_HEADER.indexOf("Client code");
      const verdictColumn = CHECK_SHEET_HEADER.indexOf("Verdict");
      const mine = sheet.rows.filter((row) => row[recordColumn]?.endsWith("-002"));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((row) => row[codeColumn] === "")).toBe(true);
      expect(mine.every((row) => row[verdictColumn] === "")).toBe(true);
    });
  });
  // ==========================================================================
  // WHAT IS LISTED AS "GO AND CATEGORISE THIS" MUST BE CATEGORISABLE TO ANY
  // PURPOSE. `loadUncategorisedRecords` required only an active record, so it
  // named a split bill line -- a HEADING, whose configurations are the jobs --
  // and a record on a retired phase. Neither is in the export's scope and
  // neither is in `loadOutstanding`'s, so categorising either changes nothing
  // anybody can see. Both clauses are `loadExportScope`'s, and this is where
  // the three readings are pinned together.
  // ==========================================================================
  describe("what the uncategorised list may NOT name", () => {
    let headingId = "";
    let configurationId = "";
    let retiredPhaseRecordId = "";
    let retiredPhaseId = "";

    beforeAll(async () => {
      const heading = await client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, qty, status,
                                   created_by, updated_by)
         values ($1, $2, 20, '__QA Split heading', 45, 'active', 'qa', 'qa') returning id`,
        [projectId, runId],
      );
      headingId = heading.rows[0].id;
      const configuration = await client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, qty, status,
                                   parent_id, depth, split_reason, variant_label, created_by, updated_by)
         values ($1, $2, 21, '__QA Split heading', null, 'active', $3, 1, 'fabric', 'A', 'qa', 'qa')
         returning id`,
        [projectId, runId, headingId],
      );
      configurationId = configuration.rows[0].id;

      const retiredPhase = await client.query(
        `insert into spec_runs (project_id, name, status, retired_at, retired_by, created_by, updated_by)
         values ($1, '__QA Retired phase', 'retired', now(), 'qa', 'qa', 'qa') returning id`,
        [projectId],
      );
      retiredPhaseId = retiredPhase.rows[0].id;
      const stranded = await client.query(
        `insert into spec_records (project_id, run_id, record_no, item_description, qty, status,
                                   created_by, updated_by)
         values ($1, $2, 22, '__QA Left on a retired phase', 1, 'active', 'qa', 'qa') returning id`,
        [projectId, retiredPhaseId],
      );
      retiredPhaseRecordId = stranded.rows[0].id;
    });

    afterAll(async () => {
      await client.query(`delete from spec_records where id = $1`, [configurationId]);
      await client.query(`delete from spec_records where id in ($1, $2)`, [headingId, retiredPhaseRecordId]);
      await client.query(`delete from spec_runs where id = $1`, [retiredPhaseId]);
    });

    it("leaves out a split bill line and names its configuration instead", async () => {
      const named = (await loadUncategorisedRecords(projectId)).map((row) => row.recordId);
      // The heading is not work: its configurations are what the export ships.
      expect(named).not.toContain(headingId);
      // The configuration IS, and carries no category of its own.
      expect(named).toContain(configurationId);
      // And the predicate is the export's: the heading is out of that too.
      const loaded = await loadExportScope(projectId, runId);
      if (isScopeFailure(loaded)) throw new Error(loaded.error);
      const inScope = loaded.scope.records.map((record) => record.id);
      expect(inScope).not.toContain(headingId);
      expect(inScope).toContain(configurationId);
    });

    it("leaves out a record on a retired phase, which no chase and no file reaches", async () => {
      const named = (await loadUncategorisedRecords(projectId)).map((row) => row.recordId);
      expect(named).not.toContain(retiredPhaseRecordId);
      // `loadOutstanding` has always dropped it; the two now agree.
      const outstanding = await loadOutstanding(projectId);
      expect(outstanding.some((question) => question.recordId === retiredPhaseRecordId)).toBe(false);
    });

    it("still names the ordinary uncategorised record", async () => {
      // The clauses narrow what cannot be acted on and nothing else. A list
      // that had quietly lost the record it exists for would be worse than the
      // one that named two it should not.
      expect((await loadUncategorisedRecords(projectId)).map((row) => row.recordId)).toContain(uncategorisedId);
    });
  });

  // ==========================================================================
  // THE CODE COLUMN AND THE FILE'S CLIENT CODE ARE ONE STATEMENT.
  //
  // `spec_record_refs` carries five ref systems and the export's Client Code
  // reads ONE of them, so a record holding only a `bws_job` ref used to print
  // that job number in the phase table's Code column and ship a blank code --
  // and `NoClientRef`, the only place in the app anybody would have noticed,
  // never fired. Two readings of one predicate disagreeing is exactly what
  // this file exists to pin, which is why it is here and not in a component
  // test: neither clause can be reached without the database.
  // ==========================================================================
  describe("a record whose only ref is a BWS job number", () => {
    // ON ITS OWN PHASE, and torn down when this block finishes. The retired-
    // phase rows below assert the project's EXACT membership, so a fixture
    // left lying in the main phase fails a test about something else --
    // which is the same collision the per-process project number prevents
    // between two agents, one describe further in.
    let jobRunId = "";
    let jobOnlyId = "";

    beforeAll(async () => {
      const run = await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by)
         values ($1, '__QA Job-ref phase', 'qa', 'qa') returning id`,
        [projectId],
      );
      jobRunId = run.rows[0].id;
      const record = await client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, qty, level,
                                   status, created_by, updated_by)
         values ($1, $2, 9, $3, '__QA Job-number-only bench', 2, 'simple', 'active', 'qa', 'qa') returning id`,
        [projectId, jobRunId, categoryId],
      );
      jobOnlyId = record.rows[0].id;
      await client.query(
        `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
         values ($1, $2, 'bws_job', '__QA J-4471', '__qa j-4471', 'qa')`,
        [jobOnlyId, projectId],
      );
    });

    afterAll(async () => {
      await client.query(`delete from spec_answers where record_id = $1`, [jobOnlyId]);
      await client.query(`delete from spec_record_refs where record_id = $1`, [jobOnlyId]);
      await client.query(`delete from spec_records where id = $1`, [jobOnlyId]);
      await client.query(`delete from spec_runs where id = $1`, [jobRunId]);
    });

    it("says it has no client ref, and shows the job apart", async () => {
      const response = await recordsRoute(
        new Request(`http://localhost/api/records?projectId=${projectId}&runId=${jobRunId}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        records: { id: string; refs: string | null; client_code: string | null }[];
      };
      const row = body.records.find((entry) => entry.id === jobOnlyId);
      // The Code column reads `client_code`, which is empty here — so the
      // table says "no client ref", the same thing the file says.
      expect(row?.client_code).toBeNull();
      // The job number is not LOST: it is still on the payload, still
      // searchable, and printed beneath the code rather than as it.
      expect(row?.refs).toBe("__QA J-4471");
    });

    it("keeps the two readings identical on a record that HAS a client code", async () => {
      const response = await recordsRoute(
        new Request(`http://localhost/api/records?projectId=${projectId}&runId=${runId}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { records: { id: string; client_code: string | null }[] };
      expect(body.records.find((entry) => entry.id === ordinaryId)?.client_code).toBe("__QA S-100");
    });

    it("exports a blank Client Code for it, which is what the table now says", async () => {
      const loaded = await loadExportScope(projectId, jobRunId);
      if (isScopeFailure(loaded)) throw new Error(loaded.error);
      const column = BWS_EXPORT_COLUMNS.findIndex((entry) => entry.name === "Client Code");
      const record = loaded.scope.records.find((entry) => entry.id === jobOnlyId);
      expect(record).toBeDefined();
      const cells = composeRow(loaded.scope, record!, loaded.scope.attributes, loaded.scope.answers);
      expect(cells[column]).toBe("");
      // A BWS job ref belongs to the record that earned it and is not a client
      // code; nothing composes it into that cell.
      expect(cells[column]).not.toContain("J-4471");
    });
  });

  describe("retired records and phases (row d5)", () => {
    /** Retired the way every path in src/lib does it: all three columns. */
    async function retireRecord(id: string) {
      await client.query(
        `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa'
          where id = $1`,
        [id],
      );
    }

    it("leaves a retired record out of the phase table, and counts what it is hiding", async () => {
      await retireRecord(uncategorisedId);
      const listed = async (query: string) => {
        const response = await recordsRoute(new Request(`http://localhost/api/records?${query}`));
        expect(response.status).toBe(200);
        return (await response.json()) as {
          records: { id: string }[];
          retiredCount: number;
          includeRetired: boolean;
        };
      };

      // OUT BY DEFAULT, because the export takes only active records and a
      // table listing retired ones beside the rest would describe a different
      // set from the file.
      const byDefault = await listed(`projectId=${projectId}&runId=${runId}`);
      expect(byDefault.records.map((row) => row.id)).toEqual([ordinaryId]);
      // AND COUNTED, so "1 record" cannot quietly mean "1 of 2": a record
      // retired by a bill revision is something somebody has to go and look at,
      // because a BWS job may already exist for it.
      expect(byDefault.retiredCount).toBe(1);
      expect(byDefault.includeRetired).toBe(false);

      // The toggle is what makes it reachable rather than gone.
      const withRetired = await listed(`projectId=${projectId}&runId=${runId}&includeRetired=1`);
      expect(withRetired.records.map((row) => row.id).sort()).toEqual([ordinaryId, uncategorisedId].sort());
      expect(withRetired.includeRetired).toBe(true);
    });

    it("has no toggle on the chase or the infill screen, and should not", async () => {
      // Deliberately different from the phase table: a retired item is not one
      // anybody chases or fills in, so there is nothing for a toggle to reveal.
      // `loadOutstanding` and the infill route both drop it outright.
      expect((await loadOutstanding(projectId)).some((q) => q.recordId === uncategorisedId)).toBe(false);
      expect((await loadUncategorisedRecords(projectId)).map((row) => row.recordId)).not.toContain(
        uncategorisedId,
      );
      const response = await infillRoute(new Request("http://localhost/api/infill"), {
        params: Promise.resolve({ id: projectId }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        lines: { lineId: string }[];
        uncategorised: { recordId: string }[];
      };
      expect(payload.lines.map((line) => line.lineId)).not.toContain(uncategorisedId);
      expect(payload.uncategorised.map((row) => row.recordId)).not.toContain(uncategorisedId);
    });

    it("REFUSES to export a retired phase, in words, rather than composing an empty file", async () => {
      // THE ROW'S WHOLE POINT. The records query requires an active run, so a
      // retired phase used to compose cleanly: a workbook named after the phase,
      // a header row, and none of its items. A BWS import REPLACES what it is
      // given, so that download is one upload away from wiping every field of
      // every job in the set.
      await client.query(
        `update spec_runs set status = 'retired', retired_at = now(), retired_by = 'qa' where id = $1`,
        [runId],
      );

      const failure = await loadExportScope(projectId, runId);
      expect(isScopeFailure(failure)).toBe(true);
      if (!isScopeFailure(failure)) throw new Error("expected a refusal");
      expect(failure.status).toBe(409);
      expect(failure.error).toMatch(/retired/i);
      // Not "no such phase": it is there, and sending somebody to look for a
      // typo in a link that is perfectly correct is its own wrong answer.
      expect(failure.error).not.toMatch(/no such phase/i);

      for (const route of [exportRoute, checkSheetRoute]) {
        const response = await route(
          new Request(`http://localhost/api/projects/${projectId}/export?runId=${runId}&format=csv`),
          { params: Promise.resolve({ id: projectId }) },
        );
        // A 4xx IN WORDS, never a file. Both routes, because the rule lives in
        // the loader all four outputs share rather than in any one of them.
        expect(response.status).toBe(409);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(response.headers.get("content-disposition")).toBeNull();
        const body = (await response.json()) as { ok: boolean; error: string };
        expect(body.ok).toBe(false);
        expect(body.error).toMatch(/retired/i);
      }
    });

    it("still exports the PROJECT, with the retired phase simply absent", async () => {
      // The whole-project file is untouched: a retired phase has no active
      // records, and leaving it out is correct. Refusing the project export
      // because one of its phases was retired would be the opposite error.
      const loaded = await loadExportScope(projectId, null);
      if (isScopeFailure(loaded)) throw new Error(loaded.error);
      expect(loaded.scope.records).toEqual([]);
      expect(loaded.scope.runName).toBeNull();
    });
  });
});
