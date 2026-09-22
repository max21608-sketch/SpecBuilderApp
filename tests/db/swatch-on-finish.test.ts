// Database tier — a swatch cropped for a finish the client gave no code for
// (item 4a.2, after 4a.1).
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
//
// ============================================================================
// WHY THIS IS A DATABASE TEST.
//
// Which rows are OFFERED the crop control is a question about the screen and is
// pinned in `tests/components/swatch-on-finish-row.test.tsx`. Where the picture
// LANDS is a question about the confirm, and about one ordering inside it that
// nothing else asserts: the finish an uncoded row is filed under does not exist
// until `mintInternalFinishCode` and `createFinish` run in that same
// transaction, and the swatch loop reads `finishIdByObservation` afterwards. A
// rearrangement that moved the swatches ahead of the filing would attach every
// internally-filed crop to nothing, and the card would still look right.
//
// The other half is the refusal. A crop whose row resolves to no finish must
// fail the confirm BY NAME and write nothing — refused, never dropped —
// because silently discarding a picture somebody cropped is how they come to
// believe it is stored.
//
// Everything goes through the app's own routes. The staged JSON is built by
// `stageDrawings` from a synthetic page, so no document is registered, no model
// is called and nothing is charged. The blob store is never touched either:
// `assertProjectScopedPathname` is a path check, and the confirm records the
// pathname the reviewer's upload already returned.
// ============================================================================
import { it, expect, beforeAll, afterAll, describe, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { stageDrawings, type SpecFieldEntry } from "@/lib/drawing-document";
import { POST as confirmRoute } from "@/app/api/imports/[id]/confirm/route";
import { PATCH as importPatchRoute } from "@/app/api/imports/[id]/route";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

/** The S-203 shape: a supplier and a product reference, and no code anywhere. */
const AISSA = "__QA Aissa Dione, ref. Losange raphia beige et écru";

describeIfDb("a swatch cropped off the page", () => {
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
         values ('${qaNumber("P90312")}', '__QA Swatch keying', '__QA Example Client', 'qa', 'qa') returning id`,
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
      `delete from attachments where entity_type = 'project_finishes'
        and entity_id in (select id from project_finishes where project_id = $1)`,
      [projectId],
    );
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
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

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

  /** One page stating a fabric with no code, staged by the real reader. */
  async function stagePage(item: { code: string; fabric: string }) {
    const staged = stageDrawings(
      [
        {
          itemCodeRaw: item.code,
          itemNameRaw: "__QA Armchair",
          page: 2,
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
       values ($1, 'spec_document', 'shop_drawings', 'parsed', $2::jsonb, 'qa', 'qa') returning id`,
      [projectId, JSON.stringify(staged)],
    );
    return { runId: String(run.rows[0].id), staged };
  }

  /** The reviewer's press on the filing control, through the real review PATCH. */
  async function press(staged: Awaited<ReturnType<typeof stagePage>>, changes: Record<string, unknown>) {
    const item = staged.staged.items[0]!;
    const observation = item.observations[0]!;
    const response = await importPatchRoute(
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
    expect(response.ok).toBe(true);
  }

  /**
   * Confirm the card, carrying the crop the reviewer took.
   *
   * The pathname is the one the browser's own upload returned, under the
   * project's prefix — which is the only thing the confirm re-checks, and it
   * re-checks it because a client does not get to name a file outside its own
   * project. Nothing is fetched, so no blob has to exist.
   */
  async function confirmWithSwatch(staged: Awaited<ReturnType<typeof stagePage>>, pressed: boolean) {
    const item = staged.staged.items[0]!;
    const observation = item.observations[0]!;
    const response = await confirmRoute(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          itemId: item.id,
          itemVersion: item.version,
          observations: [{ id: observation.id, version: observation.version + (pressed ? 1 : 0) }],
          swatches: [
            {
              observationId: observation.id,
              pathname: `projects/${projectId}/finish-swatches/${observation.id}-1.png`,
              page: 2,
              width: 120,
              height: 120,
              size: 4096,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: staged.runId }) },
    );
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  const swatchRows = () =>
    client.query(
      `select a.storage_path, a.filename, a.image_width, f.code, f.code_origin
         from attachments a join project_finishes f on f.id = a.entity_id
        where a.entity_type = 'project_finishes' and a.kind = 'finish_swatch'
          and a.superseded_at is null and f.project_id = $1`,
      [projectId],
    );

  describe("on a finish the client gave no code for", () => {
    it("lands on the library row the confirm minted for it, in the same transaction", async () => {
      // The whole of 4a.2: before it, this row had no crop control at all,
      // because a swatch is keyed to `project_finishes` and there was no
      // finish. The finish does not exist when the confirm starts and the
      // picture still reaches it.
      await makeRecord("__QA S-203", "__QA Armchair");
      const staged = await stagePage({ code: "__QA S-203", fabric: AISSA });
      await press(staged, { finishFiling: { mode: "internal" } });

      const { response, body } = await confirmWithSwatch(staged, true);
      expect(response.ok, JSON.stringify(body)).toBe(true);

      const rows = (await swatchRows()).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].code_origin).toBe("internal");
      expect(String(rows[0].code)).toMatch(/^BW-F-\d{3}$/);
      // THE PAGE SURVIVES IN THE FILENAME, which is the only place it can:
      // `attachments` has no source column. A picture citing a page somebody
      // can open is what makes it checkable against the drawing.
      expect(rows[0].filename).toBe("swatch-page-2.png");
      expect(rows[0].storage_path).toContain(`projects/${projectId}/`);
    });

    it("is REFUSED, and writes nothing, where the reviewer filed nothing", async () => {
      // `readUncodedFinish` files nothing until somebody presses, so there is
      // no finish to attach to. The screen does not offer the control here —
      // this is the confirm holding the line under a stale page or a replay.
      const recordId = await makeRecord("__QA S-204", "__QA Bench");
      const staged = await stagePage({ code: "__QA S-204", fabric: `${AISSA} (bench)` });

      const { response, body } = await confirmWithSwatch(staged, false);
      expect(response.ok).toBe(false);
      expect(body.code).toBe("swatch_has_no_finish");
      // And in words, on the row: a code that is the reviewer's to settle.
      expect(String(body.error)).toMatch(/nothing to attach it to/);

      // Nothing at all: the refusal is inside the transaction, so the specs
      // this card would have written roll back with the picture.
      const attributes = await client.query(
        `select id from record_attributes where record_id = $1 and status = 'active'`,
        [recordId],
      );
      expect(attributes.rows).toHaveLength(0);
      const library = await client.query(
        `select id from project_finishes where project_id = $1 and description like '%(bench)%'`,
        [projectId],
      );
      expect(library.rows).toHaveLength(0);
    });
  });
});
