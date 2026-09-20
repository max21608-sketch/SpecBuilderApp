// Database tier — recording what we already know, from the infill screen.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/infill.test.ts
//
// What is worth proving here rather than in a pure test, because all of it is
// a fact about the database:
//
//   * A MEETING IS ONE ENTRY IN THE TRAIL. Twelve values recorded while a
//     change is open belong to that change and give each record ONE version —
//     not twelve rows reading "update", which is the state that made people
//     stop opening a change at all.
//   * A DIMENSION IS NOT AN ANSWER. The row writes an attribute with a slot,
//     and the composed cell that appears in the checklist is
//     `composeDimensionCell` over the record's attributes — the same
//     projection the export ships.
//   * `spec_records.version` IS NEVER TOUCHED by any of it. Bumping it would
//     invalidate every extraction snapshot and chase coverage row taken
//     against the record, for a reason that has nothing to do with them.
//   * THE SCOPED LOADER IS THE SAME LOADER. A line opened on the screen must
//     return exactly the rows the whole-project load holds for that line, or
//     the screen is filtering by a second set of rules.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { editAnswer } from "@/lib/answer-edit";
import { createAttribute } from "@/lib/manual-capture";
import { closeChangeSet, openChangeSet } from "@/lib/change-sets";
import { loadOutstanding } from "@/lib/chase-drafts";
import { composeDimensionCell } from "@/lib/dimensions";
import { summariseLines } from "@/lib/infill";

const databaseUrl = process.env.DATABASE_URL;
const ACTOR = "__qa-infill@example.test";

describeIfDb("the infill screen's writes", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  const recordIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('__QA P90033', '__QA Infill', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, sort_order, created_by, updated_by)
         values ($1, '__QA MAIN RUN', 1, 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    categoryId = (
      await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)
    ).rows[0].id;

    for (const [index, description] of ["__QA Armchair", "__QA Sofa"].entries()) {
      const record = (
        await client.query(
          `insert into spec_records
             (project_id, run_id, record_no, status, category_id, item_description, qty, area, level, created_by, updated_by)
           values ($1, $2, $3, 'active', $4, $5, 4, '__QA Suite', 'complex', 'qa', 'qa') returning id`,
          [projectId, runId, index + 1, categoryId, description],
        )
      ).rows[0].id;
      recordIds.push(record);
      // The checklist, exactly as confirm-boq writes it.
      await client.query(
        `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
         select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
           from requirements q where q.category_id = $2`,
        [record, categoryId],
      );
    }
  }, SLOW);

  afterAll(async () => {
    const records = `select id from spec_records where project_id = '${projectId}'`;
    await client.query(`delete from spec_answers where record_id in (${records})`);
    await client.query(`delete from record_attributes where record_id in (${records})`);
    await client.query(`delete from spec_record_refs where record_id in (${records})`);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // NOT `delete from change_sets`: 0014 refuses that outright and allows the
    // cascade instead. Deleting the project is the whole cleanup.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("records twelve values under ONE open change, with one version per record", async () => {
    const outstanding = await loadOutstanding(projectId);
    const first = outstanding.filter((q) => q.recordId === recordIds[0] && q.answerId).slice(0, 6);
    const second = outstanding.filter((q) => q.recordId === recordIds[1] && q.answerId).slice(0, 6);
    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);

    const versionsBefore = await client.query(
      `select id, version from spec_records where project_id = $1 order by record_no`,
      [projectId],
    );

    const changeSetId = await withTransaction((txn) =>
      openChangeSet(txn, {
        projectId,
        kind: "manual_edit",
        actor: ACTOR,
        reason: "__QA Handover call with Hayley, 2026-09-22",
        open: true,
      }),
    );

    for (const question of [...first, ...second]) {
      await withTransaction((txn) =>
        editAnswer(txn, {
          answerId: question.answerId!,
          value: `__QA ${question.prompt.slice(0, 20)}`,
          state: "confirmed",
          expectedVersion: question.answerVersion!,
          actor: ACTOR,
        }),
      );
    }

    await withTransaction((txn) => closeChangeSet(txn, changeSetId, ACTOR));

    // ONE entry in the trail for the whole meeting.
    const changes = await client.query(
      `select id from change_sets where project_id = $1 and actor = $2`,
      [projectId, ACTOR],
    );
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0].id).toBe(changeSetId);

    // ONE version per record touched, not one per value.
    const snapshots = await client.query(
      `select record_id, count(*)::int as n from record_snapshots
        where change_set_id = $1 group by record_id`,
      [changeSetId],
    );
    expect(snapshots.rows).toHaveLength(2);
    for (const row of snapshots.rows) expect(row.n).toBe(1);

    // Every answer is the person's now, and out of reach of any later document.
    const answers = await client.query(
      `select count(*)::int as n from spec_answers
        where record_id = any($1::uuid[]) and state = 'confirmed' and source_kind = 'manual' and source_id is null`,
      [recordIds],
    );
    expect(answers.rows[0].n).toBe(12);

    // AND THE RECORD'S OWN VERSION IS UNTOUCHED. Bumping it would invalidate
    // every extraction snapshot and chase coverage row taken against it.
    const versionsAfter = await client.query(
      `select id, version from spec_records where project_id = $1 order by record_no`,
      [projectId],
    );
    expect(versionsAfter.rows.map((r) => r.version)).toEqual(versionsBefore.rows.map((r) => r.version));
  }, SLOW);

  it("writes a DIMENSION as an attribute, and the checklist cell is the composition of them", async () => {
    const recordId = recordIds[0]!;
    for (const [slot, value] of [
      ["W", "840"],
      ["D", "790"],
      ["H", "720"],
    ] as const) {
      await withTransaction((txn) =>
        createAttribute(txn, {
          recordId,
          attrGroup: "dimension",
          label: slot,
          value,
          unit: "mm",
          dimensionSlot: slot,
          state: "confirmed",
          actor: ACTOR,
        }),
      );
    }

    const attributes = await client.query(
      `select dimension_slot, value, unit, state, sort_order from record_attributes
        where record_id = $1 and attr_group = 'dimension' and status = 'active' order by sort_order`,
      [recordId],
    );
    const expected = composeDimensionCell(
      attributes.rows.map((row) => ({
        slot: row.dimension_slot,
        value: row.value,
        unit: row.unit,
        state: row.state,
        sortOrder: Number(row.sort_order),
      })),
    ).text;
    expect(expected).toBe("W840 x D790 x H720mm");

    const answer = await client.query(
      `select a.value, a.state, a.source_kind, a.source_id
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = 3`,
      [recordId],
    );
    expect(answer.rows[0].value).toBe(expected);
    expect(answer.rows[0].state).toBe("confirmed");
    // `document` with a NULL source is the discriminator for a composed cell a
    // person's typing produced — which is what lets the NEXT slot recompose it.
    expect(answer.rows[0].source_kind).toBe("document");
    expect(answer.rows[0].source_id).toBeNull();
  }, SLOW);

  it("attaches a typed dimension to the open change, so a meeting is still one entry", async () => {
    const recordId = recordIds[1]!;
    const changeSetId = await withTransaction((txn) =>
      openChangeSet(txn, {
        projectId,
        kind: "manual_edit",
        actor: "__qa-second@example.test",
        reason: "__QA Second meeting",
        open: true,
      }),
    );
    await withTransaction((txn) =>
      createAttribute(txn, {
        recordId,
        attrGroup: "dimension",
        label: "W",
        value: "1900",
        unit: "mm",
        dimensionSlot: "W",
        state: "confirmed",
        actor: "__qa-second@example.test",
      }),
    );
    await withTransaction((txn) => closeChangeSet(txn, changeSetId, "__qa-second@example.test"));

    const changes = await client.query(
      `select id, kind from change_sets where project_id = $1 and actor = $2`,
      [projectId, "__qa-second@example.test"],
    );
    expect(changes.rows).toHaveLength(1);
    const snapshot = await client.query(
      `select count(*)::int as n from record_snapshots where change_set_id = $1`,
      [changeSetId],
    );
    expect(snapshot.rows[0].n).toBe(1);
  }, SLOW);

  it("the line scope returns exactly what the whole-project load holds for that line", async () => {
    const all = await loadOutstanding(projectId);
    const lines = summariseLines(all.map((q) => ({ ...q, waiting: null })));
    expect(lines.length).toBeGreaterThan(0);

    const lineId = lines[0]!.lineId;
    const scoped = await loadOutstanding(projectId, { lineIds: [lineId] });
    const expected = all.filter((q) => (q.parentId ?? q.recordId) === lineId);
    expect(scoped.map((q) => q.requirementId).sort()).toEqual(expected.map((q) => q.requirementId).sort());

    // An EMPTY scope is nothing, not everything — a caller that filtered its
    // own list down to none must not be handed the project.
    expect(await loadOutstanding(projectId, { lineIds: [] })).toEqual([]);
  }, SLOW);

  it("refuses a stale version and writes nothing", async () => {
    const outstanding = await loadOutstanding(projectId);
    const question = outstanding.find((q) => q.answerId && q.state === "missing");
    expect(question).toBeTruthy();

    await expect(
      withTransaction((txn) =>
        editAnswer(txn, {
          answerId: question!.answerId!,
          value: "__QA stale",
          state: "confirmed",
          expectedVersion: question!.answerVersion! + 5,
          actor: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "answer_version_stale" });

    const after = await client.query(`select value, state from spec_answers where id = $1`, [question!.answerId]);
    expect(after.rows[0].state).toBe("missing");
    expect(after.rows[0].value).toBeNull();
  }, SLOW);

  it("asks for a reason before overriding a settled answer, and writes nothing without one", async () => {
    const outstanding = await loadOutstanding(projectId);
    const question = outstanding.find((q) => q.answerId && q.state === "missing");
    expect(question).toBeTruthy();

    // Settle it first — with no open change for this actor, so the second edit
    // has nothing to attach to.
    const settled = await withTransaction((txn) =>
      editAnswer(txn, {
        answerId: question!.answerId!,
        value: "__QA settled",
        state: "confirmed",
        expectedVersion: question!.answerVersion!,
        actor: "__qa-lonely@example.test",
      }),
    );

    await expect(
      withTransaction((txn) =>
        editAnswer(txn, {
          answerId: question!.answerId!,
          value: "__QA overridden",
          state: "confirmed",
          expectedVersion: settled.answer.version,
          actor: "__qa-lonely@example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "reason_required" });

    const after = await client.query(`select value from spec_answers where id = $1`, [question!.answerId]);
    expect(after.rows[0].value).toBe("__QA settled");
  }, SLOW);
});
