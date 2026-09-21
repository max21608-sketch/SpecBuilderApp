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
import { loadUnlinkedFinishCodes, normaliseFinishCode } from "@/lib/finishes";
import { sql } from "@/lib/db";
import { stageDrawings, type SpecFieldEntry } from "@/lib/drawing-document";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { POST as bulkFinishesRoute } from "@/app/api/projects/[id]/finishes/bulk/route";
import { suggestFinishKind } from "@/lib/finish-kind-guess";

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
  let runId = "";
  let categoryId = "";
  let fields: SpecFieldEntry[] = [];

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

  /**
   * A bill line carrying one client code, on the one phase.
   *
   * `record_no` comes from the database the way `confirm-boq` takes it, not
   * from a counter in this file: `ensureVariant` allocates the next free number
   * in the PROJECT, so a counter here collides with it on
   * `spec_records_project_no_key` the moment anything is split.
   */
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
   * One specification page, staged the way the model's output stages.
   *
   * `stageDrawings` is the real function and the pages are synthetic, so this
   * is the whole confirm path with no document registered and nothing charged.
   */
  async function stagePage(item: { code: string; fabric: string | null; materialCode: string }) {
    const staged = stageDrawings(
      [
        {
          itemCodeRaw: item.code,
          itemNameRaw: "__QA Sofa",
          page: 1,
          dimensions: [],
          materials: [
            {
              labelRaw: "FABRIC",
              valueRaw: item.fabric ?? "",
              materialCodeRaw: item.materialCode,
            },
          ],
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

  /** Confirm the whole card, the way a reviewer's one click does. */
  async function confirmCard(staged: Awaited<ReturnType<typeof stagePage>>) {
    const item = staged.staged.items[0]!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: staged.version,
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: item.observations.map((observation) => ({
            id: observation.id,
            version: observation.version,
          })),
        }),
      }),
      { params: Promise.resolve({ id: staged.runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

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
  describe("one code, two descriptions across pages (row e2)", () => {
    const code = "__QA CH-02";
    let firstRecord = "";
    let secondRecord = "";

    it("creates the library row from the FIRST page and links the item to it", async () => {
      firstRecord = await makeRecord("__QAE2-1", "__QA Sofa, page one");
      const staged = await stagePage({
        code: "__QAE2-1",
        fabric: "__QA Yarn Tessarae, boucle",
        materialCode: code,
      });
      const { response } = await confirmCard(staged);
      expect(response.status).toBe(200);

      const finish = await client.query(
        `select id, description, state, kind from project_finishes
          where project_id = $1 and code_norm = $2 and status = 'active'`,
        [projectId, normaliseFinishCode(code)],
      );
      expect(finish.rows).toHaveLength(1);
      expect(finish.rows[0].description).toBe("__QA Yarn Tessarae, boucle");
      // TBC, because a drawing NAMING a code is not somebody confirming what
      // it is; and no kind, because the library never infers one.
      expect(finish.rows[0].state).toBe("tbc");
      expect(finish.rows[0].kind).toBeNull();

      const attribute = await client.query(
        `select finish_id from record_attributes where record_id = $1 and status = 'active' and material_code is not null`,
        [firstRecord],
      );
      expect(attribute.rows).toHaveLength(1);
      expect(attribute.rows[0].finish_id).toBe(finish.rows[0].id);
    });

    it("LINKS NOTHING when a second page says something else, and leaves the library alone", async () => {
      // The conflict rule. Either the library is out of date or this page is,
      // and nothing here can tell which — so linking would make the item render
      // the library's words while its own page said otherwise, which is a false
      // provenance rather than a missing one.
      secondRecord = await makeRecord("__QAE2-2", "__QA Bench, page two");
      const staged = await stagePage({
        code: "__QAE2-2",
        fabric: "__QA Yarn Tessarae, chenille",
        materialCode: code,
      });
      const { response } = await confirmCard(staged);
      expect(response.status).toBe(200);

      const attribute = await client.query(
        `select finish_id, value from record_attributes
          where record_id = $1 and status = 'active' and material_code is not null`,
        [secondRecord],
      );
      expect(attribute.rows).toHaveLength(1);
      expect(attribute.rows[0].finish_id).toBeNull();
      // The page's own words are kept verbatim, which is what makes the value
      // re-checkable against the page it came from.
      expect(attribute.rows[0].value).toBe("__QA Yarn Tessarae, chenille");

      // And the library is UNTOUCHED: still one row, still the first page's
      // description. A confirm that quietly rewrote it would change every
      // export cell carrying the code.
      const finish = await client.query(
        `select count(*)::int as n, min(description) as description from project_finishes
          where project_id = $1 and code_norm = $2 and status = 'active'`,
        [projectId, normaliseFinishCode(code)],
      );
      expect(finish.rows[0].n).toBe(1);
      expect(finish.rows[0].description).toBe("__QA Yarn Tessarae, boucle");
    });

    it("shows up as a code needing a person, named rather than counted", async () => {
      // `loadUnlinkedFinishCodes` is what the finishes page and the project
      // overview both read, and it returns ROWS: "three codes are not in the
      // library" is a number somebody dismisses where the codes themselves are
      // a job. The conflicting code is unlinked, so it is in that list.
      // The app's own driver, the way the screens call it — not this file's
      // pg client, which would be a second reading of the same query.
      const unlinked = await loadUnlinkedFinishCodes(sql, projectId);
      const mine = unlinked.find((row) => row.code === normaliseFinishCode(code));
      expect(mine).toBeTruthy();
      expect(mine?.records).toBe(1);
    });
  });
  describe("a code with no description anywhere (row e3)", () => {
    // The pasted-list path, which is how the library is meant to be set out
    // before the first drawing lands: "Project finishes I think are the way to
    // go; set these out from the outset." A bare code is the normal thing to
    // paste, because a finishes schedule's codes arrive long before anybody has
    // written down what each one is.
    const code = "__QA CH-03";

    const bulk = async (action: "preview" | "create", text: string) => {
      const response = await bulkFinishesRoute(
        new Request("http://localhost/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, text }),
        }),
        { params: Promise.resolve({ id: projectId }) },
      );
      return { response, body: (await response.json()) as Record<string, unknown> };
    };

    it("previews before it writes, so nothing is created by a paste alone", async () => {
      const { response, body } = await bulk("preview", `${code}\n`);
      expect(response.status).toBe(200);
      expect(body.newCount).toBe(1);
      const held = await client.query(
        `select count(*)::int as n from project_finishes where project_id = $1 and code_norm = $2`,
        [projectId, normaliseFinishCode(code)],
      );
      expect(held.rows[0].n).toBe(0);
    });

    it("creates the row with the CODE ALONE, and files it as nothing", async () => {
      const { response, body } = await bulk("create", `${code}\n`);
      // 201: the route created something, and says so.
      expect(response.status).toBe(201);
      expect(body.created).toBe(1);

      const finish = await client.query(
        `select code, description, kind, state, supplier_raw, reference from project_finishes
          where project_id = $1 and code_norm = $2 and status = 'active'`,
        [projectId, normaliseFinishCode(code)],
      );
      expect(finish.rows).toHaveLength(1);
      expect(finish.rows[0].description).toBeNull();
      // KIND IS NEVER INFERRED. `classifyGroup` already guesses a group from
      // words in a label, and a second guess stacked on it produces a register
      // full of confident mistakes.
      expect(finish.rows[0].kind).toBeNull();
      // TBC is the honest state: a code somebody pasted is not a code anybody
      // has confirmed, and 0018's own CHECK refuses a confirmed row with no
      // description for the same reason.
      expect(finish.rows[0].state).toBe("tbc");
      expect(finish.rows[0].supplier_raw).toBeNull();
    });

    it("refuses to be CONFIRMED while it says nothing, at the database", async () => {
      // The constraint behind the state, and the reason it is worth a test: a
      // confirmed finish with no description is the confidently-wrong state the
      // whole register exists to avoid, and it would reach a BWS cell as a
      // settled value nothing downstream questions.
      await expect(
        client.query(
          `update project_finishes set state = 'confirmed', updated_by = 'qa'
            where project_id = $1 and code_norm = $2`,
          [projectId, normaliseFinishCode(code)],
        ),
      ).rejects.toThrow(/project_finishes_confirmed_has_description/);
    });

    it("has nothing to suggest, which is a different answer from an empty cell", async () => {
      // `suggestFinishKind` is the same pure function the screen runs, so the
      // row the page renders under "Nothing to suggest" is decided here. What
      // the page then SAYS is pinned in tests/components/finishes-library.
      const row = await client.query(
        `select code, description from project_finishes where project_id = $1 and code_norm = $2`,
        [projectId, normaliseFinishCode(code)],
      );
      expect(
        suggestFinishKind({
          code: String(row.rows[0].code),
          description: row.rows[0].description as string | null,
        }),
      ).toBeNull();
    });
  });
});
