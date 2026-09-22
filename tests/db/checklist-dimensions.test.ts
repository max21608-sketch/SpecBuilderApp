// Database tier — a dimension recorded off the CHECKLIST tab.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/checklist-dimensions.test.ts
//
// ============================================================================
// TWO OF FOUR DIMENSIONS COULD BE MARKED CONFIRMED (FIU 2026-09-21).
//
// The record's Checklist tab answered BWS field 3 in a plain text box.
// `W1900 x D1400mm` was typed into it and its state set to Confirmed on an
// item with no height and no seat height, and the TGQ tile read 0.
//
// Two facts made that possible, and only one of them is about a screen:
//
//   1. A string carries no W/D/H/SH, so nothing downstream could tell that two
//      of the four figures the item needs were never taken.
//   2. `editAnswer` writes `source_kind = 'manual'`, and `planAnswerFills`'
//      composed-dimensions branch reaches an answer only while it is `missing`
//      or `document`-written — so the cell was locked for good. A later
//      drawing could hold four real slots and the record would go on showing
//      the two somebody typed.
//
// The screen's half is held in `tests/components/record-checklist.test.tsx`.
// These are the facts a component test cannot see: what the slot path writes,
// what the GATE then says about it, and — the one that matters most — that the
// answer stays REACHABLE, so a drawing confirmed afterwards recomposes the
// cell instead of being locked out. The last case writes a `manual` answer
// deliberately, to hold the difference the row now exists to prevent.
//
// Rows are prefixed `__QA ` and deleted FK-safe by deleting the project: 0014
// refuses a direct `delete from change_sets` and allows the cascade.
// ============================================================================
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { sql } from "@/lib/db";
import { withTransaction } from "@/lib/db-transaction";
import { createRecord, createRun } from "@/lib/manual-capture";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { gatesForRecord, loadGateContext } from "@/lib/gate-load";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;

const post = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("a dimension recorded from the checklist", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";

  async function item(description: string): Promise<string> {
    const record = await withTransaction((txn) =>
      createRecord(txn, { projectId, runId, itemDescription: description, categoryId, actor: "qa" }),
    );
    return record.recordId;
  }

  /** Exactly what the Checklist tab's control posts: slot, figure, unit. */
  async function record(recordId: string, slot: string, value: string): Promise<Response> {
    const { POST } = await import("@/app/api/attributes/route");
    return POST(
      post({
        recordId,
        attrGroup: "dimension",
        label: slot,
        value,
        unit: "mm",
        dimensionSlot: slot,
        state: "confirmed",
      }),
    );
  }

  /** The composed cell as the CHECKLIST holds it, and how it got there. */
  async function dimensionsAnswer(
    recordId: string,
  ): Promise<{ value: string | null; state: string; sourceKind: string | null; sourceId: string | null } | null> {
    const rows = await client.query(
      `select a.value, a.state, a.source_kind, a.source_id
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = $2 and a.revision_no = 0`,
      [recordId, DIMENSIONS_JSON_ID],
    );
    const row = rows.rows[0];
    return row
      ? {
          value: row.value,
          state: String(row.state),
          sourceKind: row.source_kind === null ? null : String(row.source_kind),
          sourceId: row.source_id === null ? null : String(row.source_id),
        }
      : null;
  }

  /** What Matthew's matrix still wants of this record, gate by gate. */
  async function gates(recordId: string) {
    const context = await loadGateContext(sql, [recordId]);
    return gatesForRecord(context, { id: recordId, categoryId });
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, client, created_by, updated_by)
         values ('${qaNumber("P00035")}', '__QA Checklist dimensions', '__QA Example Client', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    // One of Matthew's nine, so the matrix has four dimension rows to ask for.
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;
    runId = (await withTransaction((txn) => createRun(txn, { projectId, name: "__QA MAIN", actor: "qa" }))).runId;
  }, 60_000);

  afterAll(async () => {
    // A FAILED `beforeAll` MUST NOT REPORT A SECOND, UNRELATED ERROR. Without
    // this the sweep runs with an empty id and dies on "invalid input syntax
    // for type uuid", which reads as a defect of its own and sends somebody
    // hunting past the failure that actually happened.
    if (!projectId) {
      await client.end();
      return;
    }
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, 60_000);

  it("leaves the record VISIBLY short at the gate when only two slots are recorded", async () => {
    const recordId = await item("__QA Bench, luggage @ entrance");
    expect((await record(recordId, "W", "1900")).status).toBe(201);
    expect((await record(recordId, "D", "1400")).status).toBe(201);

    // The checklist question reads exactly what the screenshot showed — and
    // this is the half that was never the defect. One question, answered.
    const answer = await dimensionsAnswer(recordId);
    expect(answer?.value).toBe("W1900 x D1400mm");
    expect(answer?.state).toBe("confirmed");

    // THE GATE DISAGREES, AND IT IS RIGHT TO. Matthew's rows 4-7 are four
    // separate figures and two of them do not exist, so TGQ is blocking and
    // names them. Before this item that disagreement was invisible on the
    // screen a person answers the question on.
    const board = await gates(recordId);
    expect(board).not.toBeNull();
    expect(board!.TGQ.satisfied).toBe(false);
    const missing = board!.TGQ.fields
      .filter((field) => field.field.dimensionSlot && field.outcome === "blocking")
      .map((field) => field.field.dimensionSlot);
    expect(missing.sort()).toEqual(["H", "SH"]);
    // And the two that ARE recorded are settled, so the row's own count of
    // "2 of the 4 this item needs" is the same reading as the gate's.
    const settled = board!.TGQ.fields
      .filter((field) => field.field.dimensionSlot && field.outcome === "satisfied")
      .map((field) => field.field.dimensionSlot);
    expect(settled.sort()).toEqual(["D", "W"]);
  });

  it("stays REACHABLE, so a drawing confirmed afterwards recomposes the cell", async () => {
    const recordId = await item("__QA Armchair, two slots then a drawing");
    expect((await record(recordId, "W", "840")).status).toBe(201);
    expect((await record(recordId, "D", "790")).status).toBe(201);

    // THE DISCRIMINATOR. `document` with a NULL source is what a hand-typed
    // attribute writes, and it is precisely what keeps the composed cell in
    // reach of `applyAnswerFills`. A typed ANSWER would have been `manual`,
    // which is out of reach for good.
    const before = await dimensionsAnswer(recordId);
    expect(before?.value).toBe("W840 x D790mm");
    expect(before?.sourceKind).toBe("document");
    expect(before?.sourceId).toBeNull();

    // A drawing confirm, as far as the cell is concerned: a further slot off a
    // page, then the record's answers recomposed.
    await client.query(
      `insert into record_attributes
         (record_id, attr_group, label, value, unit, dimension_slot, state, created_by, updated_by)
       values ($1, 'dimension', 'Height', '720', 'mm', 'H', 'confirmed', 'qa', 'qa')`,
      [recordId],
    );
    await withTransaction((txn) => recomposeAnswers(txn, recordId, null, "qa"));

    const after = await dimensionsAnswer(recordId);
    expect(after?.value).toBe("W840 x D790 x H720mm");
    expect(after?.state).toBe("confirmed");
  });

  it("is what the old free-text box could NOT do: a manual answer is locked for good", async () => {
    const recordId = await item("__QA Sofa, typed into the old box");
    const answerId = (
      await client.query(
        `select a.id
           from spec_answers a
           join requirements q on q.id = a.requirement_id
           join spec_fields f on f.id = q.spec_field_id
          where a.record_id = $1 and f.json_id = $2 and a.revision_no = 0`,
        [recordId, DIMENSIONS_JSON_ID],
      )
    ).rows[0].id;

    // Exactly what the box did: a string, confirmed, through the answers route.
    const { PATCH } = await import("@/app/api/answers/[id]/route");
    const res = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "W1900 x D1400mm", state: "confirmed", version: 1 }),
      }),
      { params: Promise.resolve({ id: answerId }) },
    );
    expect(res.status).toBe(200);

    // A real width and height off a page, and a recomposition over them.
    await client.query(
      `insert into record_attributes
         (record_id, attr_group, label, value, unit, dimension_slot, state, created_by, updated_by)
       values ($1, 'dimension', 'Width', '1830', 'mm', 'W', 'confirmed', 'qa', 'qa'),
              ($1, 'dimension', 'Height', '760', 'mm', 'H', 'confirmed', 'qa', 'qa')`,
      [recordId],
    );
    await withTransaction((txn) => recomposeAnswers(txn, recordId, null, "qa"));

    // THE CELL DOES NOT MOVE, and that is correct: a person's own answer is
    // never overwritten. It is also why the box had to go rather than be
    // guarded — the record now holds W1830 and H760 while its checklist says
    // something else entirely, and nothing on any screen resolves that.
    const after = await dimensionsAnswer(recordId);
    expect(after?.value).toBe("W1900 x D1400mm");
    expect(after?.sourceKind).toBe("manual");
  });
});
