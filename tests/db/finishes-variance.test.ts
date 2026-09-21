// Database tier — the variance matrix's finishes rows (plan §6.10.e).
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// WHY THESE ARE DATABASE TESTS.
//
// `normaliseFinishCode` is pure and pinned in `tests/lib/finishes.test.ts`. The
// thing that cannot be pinned there is the half that would actually merge two
// codes a client meant to keep apart: the partial unique index on
// `(project_id, code_norm)`, which is what DECIDES equality for the library. A
// pure test proving two strings fold differently says nothing about whether the
// database agrees, and the database is where the merge would be permanent.
//
// The rest of the file goes through the app's own paths — the drawings confirm
// route and the pasted-list route — so what is proved is what a person's click
// writes. No document is registered and no model is called: the staged JSON is
// built by `stageDrawings` from synthetic pages, the way the intake route tests
// do it, so nothing here is charged.
//
// Every row is prefixed `__QA` and deleted in FK-safe order. The project
// numbers are literals rather than a helper, because Coder F is adding one in
// `db-tier.ts` and two agents editing that file in one afternoon is a conflict
// in something every db test imports; they will be replaced by it.
// ============================================================================
import { it, expect, beforeAll, afterAll, describe, vi } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { normaliseFinishCode } from "@/lib/finishes";

// Only the session is stubbed; the routes are the real ones.
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the finishes library, against the codes a client actually writes", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  /** A second project, because the same code means different things on each. */
  let otherProjectId = "";

  /** One library row, written the way `createFinish` writes one. */
  const addFinish = (project: string, code: string, description: string | null = null) =>
    client.query(
      `insert into project_finishes (project_id, code, code_norm, description, state, status, created_by, updated_by)
       values ($1, $2, $3, $4, 'tbc', 'active', 'qa', 'qa') returning id`,
      [project, code, normaliseFinishCode(code), description],
    );

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('__QA P90301', '__QA Finishes variance', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    otherProjectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('__QA P90302', '__QA Finishes variance, other project', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    for (const project of [projectId, otherProjectId]) {
      await client.query(
        `update record_attributes set finish_id = null
          where record_id in (select id from spec_records where project_id = $1)`,
        [project],
      );
      await client.query(
        `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
        [project],
      );
      await client.query(
        `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
        [project],
      );
      await client.query(`delete from spec_record_refs where project_id = $1`, [project]);
      await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [project]);
      await client.query(`delete from spec_records where project_id = $1`, [project]);
      await client.query(`delete from project_finishes where project_id = $1`, [project]);
      await client.query(`delete from spec_runs where project_id = $1`, [project]);
      await client.query(
        `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
        [project],
      );
      await client.query(`delete from intake_runs where project_id = $1`, [project]);
      await client.query(`delete from projects where id = $1`, [project]);
    }
    await client.end();
  });

  describe("CH-01.1 against CH-01-1 (row e1)", () => {
    it("holds both, because the fold is case and whitespace and NOTHING else", async () => {
      // A normaliser clever enough to merge a dot into a dash is clever enough
      // to merge two codes a client meant to keep apart, and there is no way
      // back from that: the two sets of items are now one. Merging is a button
      // somebody presses, and this app does not have one.
      await addFinish(projectId, "__QA CH-01.1", "__QA Tessarae, dot");
      await addFinish(projectId, "__QA CH-01-1", "__QA Tessarae, dash");
      const rows = await client.query(
        `select code, code_norm from project_finishes where project_id = $1 order by code`,
        [projectId],
      );
      expect(rows.rows.map((row) => row.code)).toEqual(["__QA CH-01-1", "__QA CH-01.1"]);
      expect(new Set(rows.rows.map((row) => row.code_norm)).size).toBe(2);
    });

    it("refuses a second row for the SAME code, however it is spelled", async () => {
      // The other half of the same index, and the half that makes the library
      // edit-once: two rows for one code would mean correcting one and leaving
      // the items on the other reading the old words.
      await expect(addFinish(projectId, "  __qa   ch-01.1 ", "__QA Tessarae again")).rejects.toThrow(
        /project_finishes_code_key/,
      );
    });

    it("is PROJECT-SCOPED, so the same code on another project is another finish", async () => {
      // MOR005 means different things on different projects — the invariant the
      // partial index carries. A register that was not scoped would be silently
      // wrong, which is the worst kind.
      await expect(addFinish(otherProjectId, "__QA CH-01.1", "__QA Something else entirely")).resolves.toBeTruthy();
      const mine = await client.query(
        `select count(*)::int as n from project_finishes where code_norm = $1 and status = 'active'`,
        [normaliseFinishCode("__QA CH-01.1")],
      );
      expect(mine.rows[0].n).toBe(2);
    });

    it("lets a retired code be created again, which is what makes the index partial", async () => {
      await addFinish(projectId, "__QA CH-09", "__QA Withdrawn");
      await client.query(
        `update project_finishes set status = 'retired', retired_at = now(), retired_by = 'qa'
          where project_id = $1 and code_norm = $2`,
        [projectId, normaliseFinishCode("__QA CH-09")],
      );
      await expect(addFinish(projectId, "__QA CH-09", "__QA Back again")).resolves.toBeTruthy();
    });
  });
});
