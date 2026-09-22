// Database tier — filing a finish the client gave no code for (item 4a.1).
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// WHY THESE ARE DATABASE TESTS.
//
// `readUncodedFinish` is pure and pinned in `tests/lib/finishes.test.ts`. Three
// things about this item cannot be pinned there and all three are where it
// would go wrong:
//
//   * the MINT is allocated under the project row lock, and the defect it
//     exists to prevent (`boq-concurrency`) only appears when two transactions
//     run at once. A test with a fixed pause passes with the lock deleted;
//     this one runs both mints concurrently and asserts two different codes;
//   * the CONFIRM is what writes the register row, and whether a second item
//     carrying the same wording creates a second row or joins the first is a
//     question about `project_finishes`, not about a pure function;
//   * `code_origin` is a column with a CHECK behind it (0036).
//
// Everything goes through the app's own routes — the drawings review PATCH and
// the confirm route — so what is proved is what a reviewer's press writes. No
// document is registered and no model is called: the staged JSON is built by
// `stageDrawings` from synthetic pages, so nothing here is charged.
// ============================================================================
import { it, expect, beforeAll, afterAll, describe, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { createFinish, mintInternalFinishCode } from "@/lib/finish-edit";
import { stageDrawings, type SpecFieldEntry } from "@/lib/drawing-document";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { PATCH as importPatchRoute } from "@/app/api/imports/[id]/route";

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

/** The real wording off the S-203 sheet's shape: a supplier and a reference, no code. */
const AISSA = "__QA Aissa Dione, ref. Losange raphia beige et écru";

describeIfDb("a finish the client gave no code for", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  let fields: SpecFieldEntry[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('${qaNumber("P90311")}', '__QA Finish keying', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN PHASE', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    categoryId = (
      await client.query(
        `select c.id from item_categories c join requirements q on q.category_id = c.id
         group by c.id having count(q.id) >= 1 order by c.id limit 1`,
      )
    ).rows[0].id;
    fields = (await client.query(`select id, json_id, name from spec_fields order by sort_order`)).rows.map(
      (row: { id: string; json_id: number; name: string }) => ({
        id: row.id,
        jsonId: Number(row.json_id),
        name: row.name,
      }),
    );
  });

  afterAll(async () => {
    await client.query(
      `update record_attributes set finish_id = null
        where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    // `record_snapshots` is NOT deleted here: 0013 refuses the direct delete
    // and lets the CASCADE through, so a version goes with its record.
    await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(
      `delete from status_history where entity_id in (select id from intake_runs where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    // A change set cannot be deleted directly (0014 refuses it); it goes with
    // the project. Same for the audit rows behind it.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  /** A bill line on the one phase, numbered by the database as `confirm-boq` does. */
  async function makeRecord(code: string, description: string): Promise<string> {
    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, qty,
                                 created_by, updated_by)
       values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
               'active', $3, $4, 4, 'qa', 'qa') returning id`,
      [projectId, runId, categoryId, description],
    );
    const recordId = record.rows[0].id;
    await client.query(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, created_by)
       values ($1, $2, 'boq_code', $3, $3, 'qa')`,
      [recordId, projectId, code],
    );
    return recordId;
  }

  /**
   * One specification page stating a fabric and NO code — the S-203 shape.
   *
   * `stageDrawings` is the real function and the page is synthetic, so this is
   * the whole confirm path with nothing registered and nothing charged.
   */
  async function stagePage(item: { code: string; fabric: string }) {
    const staged = stageDrawings(
      [
        {
          itemCodeRaw: item.code,
          itemNameRaw: "__QA Armchair",
          page: 1,
          dimensions: [],
          materials: [{ labelRaw: "FABRIC REFERENCE", valueRaw: item.fabric, materialCodeRaw: null }],
          dimensionsCombinedRaw: [],
          notesRaw: [],
          confidence: "high" as const,
        },
      ],
      fields,
      "__QA drawings.pdf",
      null,
    );
    const run = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, parsed, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id, version`,
      [projectId, JSON.stringify(staged)],
    );
    return { runId: String(run.rows[0].id), version: Number(run.rows[0].version), staged };
  }

  /** The reviewer's press on the card, through the real review PATCH. */
  async function press(
    staged: Awaited<ReturnType<typeof stagePage>>,
    changes: Record<string, unknown>,
  ): Promise<Response> {
    const item = staged.staged.items[0]!;
    const observation = item.observations[0]!;
    return importPatchRoute(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          observationId: observation.id,
          expectedVersion: observation.version,
          changes,
        }),
      }),
      { params: Promise.resolve({ id: staged.runId }) },
    );
  }

  /** Confirm the whole card, the way a reviewer's one click does. */
  async function confirmCard(staged: Awaited<ReturnType<typeof stagePage>>, bumped = false) {
    const item = staged.staged.items[0]!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: item.observations.map((observation) => ({
            id: observation.id,
            // A press through the PATCH bumps the observation's own version,
            // which is what the confirm checks.
            version: observation.version + (bumped ? 1 : 0),
          })),
        }),
      }),
      { params: Promise.resolve({ id: staged.runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  const libraryRows = () =>
    client.query(
      `select id, code, code_origin, description, state from project_finishes
        where project_id = $1 and status = 'active' order by code`,
      [projectId],
    );

  const attributeOf = (recordId: string) =>
    client.query(
      `select id, value, finish_id, material_code from record_attributes
        where record_id = $1 and status = 'active' order by sort_order`,
      [recordId],
    );

  describe("the S-203 case: one fabric, no code, filed internally", () => {
    let firstRecord = "";

    it("files NOTHING when nobody has pressed anything", async () => {
      // `createFinish` is a register write and §5's write boundary is a
      // person's submit. A confirm that filed on its own would put a library
      // entry on the project that nobody agreed to — and it is what the
      // library looked like before this item: the fabric on the record, the
      // library empty, and no question anywhere.
      firstRecord = await makeRecord("__QA4A1-0", "__QA Armchair, unasked");
      const staged = await stagePage({ code: "__QA4A1-0", fabric: `${AISSA} (unasked)` });
      const { response } = await confirmCard(staged);
      expect(response.status).toBe(200);

      const attribute = await attributeOf(firstRecord);
      expect(attribute.rows).toHaveLength(1);
      expect(attribute.rows[0].finish_id).toBeNull();
      expect((await libraryRows()).rows).toHaveLength(0);
    });

    it("mints ONE internal code when the reviewer says the client gave none", async () => {
      const record = await makeRecord("__QA4A1-1", "__QA Armchair S-203");
      const staged = await stagePage({ code: "__QA4A1-1", fabric: AISSA });
      expect((await press(staged, { finishFiling: { mode: "internal" } })).status).toBe(200);
      const { response } = await confirmCard(staged, true);
      expect(response.status).toBe(200);

      const library = await libraryRows();
      expect(library.rows).toHaveLength(1);
      expect(library.rows[0].code).toBe("BW-F-001");
      expect(library.rows[0].code_origin).toBe("internal");
      expect(library.rows[0].description).toBe(AISSA);
      // TBC, because a drawing stating a fabric is not somebody confirming it
      // — the same rule a coded finish is created under.
      expect(library.rows[0].state).toBe("tbc");

      const attribute = await attributeOf(record);
      expect(attribute.rows[0].finish_id).toBe(library.rows[0].id);
      // The attribute keeps the page's own words. The library is the truth and
      // the attribute is the evidence; the CELL renders the library.
      expect(attribute.rows[0].value).toBe(AISSA);
      // And no client code was invented onto the attribute.
      expect(attribute.rows[0].material_code).toBeNull();
    });

    it("JOINS that row for the same wording on a second item, creating nothing", async () => {
      // Max, 2026-09-22: "use this again if it matches in another line item
      // where the same fabric appears." No press at all on this one — an exact
      // fold links on its own, which is approval 3.
      const record = await makeRecord("__QA4A1-2", "__QA Bench, same fabric");
      const staged = await stagePage({ code: "__QA4A1-2", fabric: `  ${AISSA.toUpperCase()}  ` });
      const { response } = await confirmCard(staged);
      expect(response.status).toBe(200);

      const library = await libraryRows();
      expect(library.rows).toHaveLength(1);
      expect(library.rows[0].code).toBe("BW-F-001");

      const attribute = await attributeOf(record);
      expect(attribute.rows[0].finish_id).toBe(library.rows[0].id);
    });

    it("links NOTHING one character apart, even with the press", async () => {
      // `écru` against `ecru`. The near miss is OFFERED on the card and files
      // nothing; pressing "no code" on it mints its own row rather than
      // joining one it only resembles, because a normaliser clever enough to
      // merge two spellings is clever enough to merge two fabrics somebody
      // kept apart.
      const record = await makeRecord("__QA4A1-3", "__QA Stool, nearly the same");
      const staged = await stagePage({
        code: "__QA4A1-3",
        fabric: "__QA Aissa Dione, ref. Losange raphia beige et ecru",
      });
      expect((await press(staged, { finishFiling: { mode: "internal" } })).status).toBe(200);
      const { response } = await confirmCard(staged, true);
      expect(response.status).toBe(200);

      const library = await libraryRows();
      expect(library.rows.map((row) => row.code)).toEqual(["BW-F-001", "BW-F-002"]);
      const attribute = await attributeOf(record);
      expect(attribute.rows[0].finish_id).toBe(
        library.rows.find((row) => row.code === "BW-F-002")!.id,
      );
    });

    it("files the CLIENT's own code where the reviewer types one, as a client code", async () => {
      const record = await makeRecord("__QA4A1-4", "__QA Sofa, coded by hand");
      const staged = await stagePage({ code: "__QA4A1-4", fabric: "__QA Yarn Tessarae" });
      expect((await press(staged, { materialCode: "__QA CH-77" })).status).toBe(200);
      const { response } = await confirmCard(staged, true);
      expect(response.status).toBe(200);

      const library = await libraryRows();
      const filed = library.rows.find((row) => row.code === "__QA CH-77");
      expect(filed).toBeTruthy();
      expect(filed!.code_origin).toBe("client");

      const attribute = await attributeOf(record);
      expect(attribute.rows[0].finish_id).toBe(filed!.id);
      expect(attribute.rows[0].material_code).toBe("__QA CH-77");
    });
  });

  describe("minting under the project row lock", () => {
    it("gives two concurrent reviewers two different codes", async () => {
      // THE `boq-concurrency` DEFECT, available to be rediscovered here. Two
      // confirms reading the same maximum both take `BW-F-00n` and one dies on
      // the partial unique index with a 500 reading "nothing was written".
      // Both transactions are opened before either commits, so the lock is
      // what makes this pass — a fixed pause would pass with it deleted.
      const before = (await libraryRows()).rows.length;
      const mint = (marker: string) =>
        withTransaction(async (txn) => {
          const code = await mintInternalFinishCode(txn, projectId);
          await createFinish(txn, {
            projectId,
            fields: { code, codeOrigin: "internal", description: `__QA concurrent ${marker}`, state: "tbc" },
            actor: "__qa@example.test",
          });
          return code;
        });
      const [a, b] = await Promise.all([mint("a"), mint("b")]);
      expect(a).not.toBe(b);
      expect(new Set([a, b])).toEqual(new Set(["BW-F-003", "BW-F-004"]));
      expect((await libraryRows()).rows).toHaveLength(before + 2);
    });

    it("never re-uses a retired code", async () => {
      // A code somebody quoted in an email has to go on meaning that — the
      // variant-letter rule. The scan counts every row, retired ones included.
      const retired = await withTransaction(async (txn) => {
        const code = await mintInternalFinishCode(txn, projectId);
        await createFinish(txn, {
          projectId,
          fields: { code, codeOrigin: "internal", description: "__QA withdrawn", state: "tbc" },
          actor: "__qa@example.test",
        });
        return code;
      });
      expect(retired).toBe("BW-F-005");
      await client.query(
        `update project_finishes set status = 'retired', retired_at = now(), retired_by = 'qa'
          where project_id = $1 and code = $2`,
        [projectId, retired],
      );
      const next = await withTransaction((txn) => mintInternalFinishCode(txn, projectId));
      expect(next).toBe("BW-F-006");
    });
  });

  describe("the column itself", () => {
    it("refuses an origin that is neither", async () => {
      await expect(
        client.query(
          `insert into project_finishes (project_id, code, code_norm, code_origin, state, created_by, updated_by)
           values ($1, '__QA BAD', '__QA BAD', 'invented', 'tbc', 'qa', 'qa')`,
          [projectId],
        ),
      ).rejects.toThrow(/project_finishes_code_origin_check/);
    });

    it("defaults to `client`, which is what every row on record already was", async () => {
      const row = await client.query(
        `insert into project_finishes (project_id, code, code_norm, state, created_by, updated_by)
         values ($1, '__QA DEF-1', '__QA DEF-1', 'tbc', 'qa', 'qa') returning code_origin`,
        [projectId],
      );
      expect(row.rows[0].code_origin).toBe("client");
    });
  });
});
