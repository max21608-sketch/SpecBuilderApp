// Database tier — an answer composed from the BILL follows the bill's specs
// when they change (audit E1, E5; migration 0050).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/answer-provenance.test.ts
//
// ============================================================================
// THE CHECKLIST FROZE AGAINST THE BILL.
//
// `applyAnswerFills` and `applyAnswerRetractions` decided which answers they
// could touch by reading the DOCUMENT that last wrote them: a `document`
// answer was in reach only when its `source_id` was a SHOP-DRAWINGS run (or
// null, for a typed spec). The bill confirm recomposes with the BILL run as
// the source, and a bill run's `document_kind` is null. So once a bill had
// filled an answer, no correction, retire, library edit or BW standard could
// move it again — the Specs tab and the BWS file moved, the checklist did
// not, and a retired bill fabric went on shipping through the answer.
//
// Each case below was written against that code and failed on it, except the
// dimension correction: the composed-dimensions branch has admitted any
// `document` answer since 2026-09-17, so it already followed. It stays here
// as the regression for the new rule, which keys both branches on 0050's
// `attribute` instead.
//
// Every fixture write goes through a change set and takes a version, the way
// the bill confirm does, so the whole-database coverage assertion in
// change-history.test.ts holds over what this file leaves behind.
// ============================================================================
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers, retireAttribute } from "@/lib/attribute-retire";
import { correctAttribute } from "@/lib/attribute-correct";
import { createFinish, editFinish } from "@/lib/finish-edit";
import { setRecordCategory } from "@/lib/record-category";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("an answer composed from the bill follows the bill's specs", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let specRunId = "";
  let billRunId = "";
  let ffeRunId = "";
  let categoryId = "";
  let com1FieldId = "";
  let recordNo = 9500;

  type Spec = {
    group: "dimension" | "material";
    label: string;
    value: string | null;
    slot?: string;
    unit?: string;
    fieldId?: string;
    code?: string;
    finishId?: string;
    state?: "confirmed" | "tbc";
  };

  /**
   * A bill line confirmed the way `confirm-boq.ts` confirms one: the record,
   * its `missing` checklist rows, its specs sourced to the BILL run, and the
   * answers recomposed with that run as the source — all under one change set,
   * with a version.
   */
  async function billLine(specs: Spec[], options: { categorised?: boolean } = {}): Promise<string> {
    const categorised = options.categorised !== false;
    recordNo += 1;
    return withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, {
        projectId,
        kind: "boq_confirm",
        actor: "qa",
        sourceIntakeRunId: billRunId,
      });
      const inserted = await txn`
        insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, created_by, updated_by)
        values (${projectId}, ${specRunId}, ${recordNo}, 'active', ${categorised ? categoryId : null},
                ${`__QA Armchair ${recordNo}`}, 'qa', 'qa')
        returning id
      `;
      const recordId = String(inserted[0]?.id);
      if (categorised) {
        await txn`
          insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
          select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
            from requirements q where q.category_id = ${categoryId}
        `;
      }
      let order = 0;
      for (const spec of specs) {
        order += 1;
        await txn`
          insert into record_attributes
            (record_id, attr_group, label, value, unit, dimension_slot, spec_field_id, material_code, finish_id,
             state, source_run_id, sort_order, created_by, updated_by)
          values
            (${recordId}, ${spec.group}, ${spec.label}, ${spec.value}, ${spec.unit ?? null}, ${spec.slot ?? null},
             ${spec.fieldId ?? null}, ${spec.code ?? null}, ${spec.finishId ?? null},
             ${spec.state ?? "confirmed"}, ${billRunId}, ${order}, 'qa', 'qa')
        `;
      }
      await recomposeAnswers(txn, recordId, billRunId, "qa");
      await snapshotRecords(txn, [recordId], changeSetId);
      return recordId;
    });
  }

  const com1 = (value: string, extra: Partial<Spec> = {}): Spec => ({
    group: "material",
    label: "Fabric",
    value,
    fieldId: com1FieldId,
    ...extra,
  });
  const dim = (slot: string, value: string): Spec => ({ group: "dimension", label: slot, value, slot, unit: "mm" });

  async function answerFor(recordId: string, jsonId: number) {
    const rows = await client.query(
      `select a.id, a.value, a.state, a.source_kind, a.source_id, a.version
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = $2 and a.revision_no = 0`,
      [recordId, jsonId],
    );
    return rows.rows[0] as
      | { id: string; value: string | null; state: string; source_kind: string; source_id: string | null; version: number }
      | undefined;
  }

  async function attributeOn(recordId: string, where: string): Promise<{ id: string; version: number }> {
    const rows = await client.query(
      `select id, version from record_attributes where record_id = $1 and status = 'active' and ${where}`,
      [recordId],
    );
    return { id: String(rows.rows[0].id), version: Number(rows.rows[0].version) };
  }

  /** What the reviewer does on the checklist: the answer becomes theirs. */
  async function typeAnswer(recordId: string, jsonId: number, value: string) {
    const answer = await answerFor(recordId, jsonId);
    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa" });
      await txn`
        update spec_answers
           set value = ${value}, state = 'confirmed', confirmed_by = 'qa', confirmed_at = now(),
               source_kind = 'manual', source_id = null, updated_by = 'qa'
         where id = ${answer!.id}
      `;
      await snapshotRecords(txn, [recordId], changeSetId);
    });
  }

  beforeAll(async () => {
    await client.connect();
    const category = await client.query(
      `select q.category_id from requirements q
         join spec_fields f on f.id = q.spec_field_id
        where f.json_id = 1
          and exists (select 1 from requirements c join spec_fields cf on cf.id = c.spec_field_id
                       where c.category_id = q.category_id and cf.json_id = ${DIMENSIONS_JSON_ID})
        order by q.category_id limit 1`,
    );
    categoryId = String(category.rows[0].category_id);
    com1FieldId = String((await client.query(`select id from spec_fields where json_id = 1`)).rows[0].id);

    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90050")}', '__QA Answer provenance', 'qa', 'qa') returning id`,
        )
      ).rows[0].id,
    );
    specRunId = String(
      (
        await client.query(
          `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA MAIN', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
    // A BILL run: `document_kind` is null by 0021's CHECK. That null is the
    // whole of E1 — the old guard asked for 'shop_drawings' and got nothing.
    billRunId = String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
           values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
    ffeRunId = String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, document_kind, status, created_by, updated_by)
           values ($1, 'spec_document', 'ffe_schedule', 'confirmed', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
  }, 60_000);

  afterAll(async () => {
    if (!projectId) {
      await client.end();
      return;
    }
    // Answers, attributes and versions cascade with the record; change sets
    // with the project (0014). Neither is deleted directly.
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_finishes where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, 60_000);

  it("labels what it composes as a projection of the attributes", async () => {
    const recordId = await billLine([com1("__QA Velvet Rose"), dim("W", "840")]);
    const fabric = await answerFor(recordId, 1);
    expect(fabric?.value).toBe("__QA Velvet Rose");
    expect(fabric?.state).toBe("confirmed");
    expect(fabric?.source_kind).toBe("attribute");
    // `source_id` keeps its meaning: the run the value came from.
    expect(fabric?.source_id).toBe(billRunId);
    expect((await answerFor(recordId, DIMENSIONS_JSON_ID))?.source_kind).toBe("attribute");
  });

  it("puts a retired bill fabric's answer back to missing", async () => {
    const recordId = await billLine([com1("__QA Velvet Rose")]);
    expect((await answerFor(recordId, 1))?.state).toBe("confirmed");

    const fabric = await attributeOn(recordId, "spec_field_id is not null");
    const result = await withTransaction((txn) =>
      retireAttribute(txn, { attributeId: fabric.id, expectedVersion: fabric.version, reason: "__QA wrong cloth", actor: "qa" }),
    );
    expect(result.answersRetracted).toBe(1);

    // The export falls back to the ANSWER where no attribute holds a field, so
    // an answer left confirmed here is a fabric the file goes on shipping.
    const after = await answerFor(recordId, 1);
    expect(after?.state).toBe("missing");
    expect(after?.value).toBeNull();
  });

  it("follows a correction to a bill fabric", async () => {
    const recordId = await billLine([com1("__QA Velvet Rose")]);
    const fabric = await attributeOn(recordId, "spec_field_id is not null");
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: fabric.id,
        expectedVersion: fabric.version,
        value: "__QA Velvet Moss",
        unit: null,
        state: "confirmed",
        reason: "__QA the bill misprinted it",
        actor: "qa",
      }),
    );
    const after = await answerFor(recordId, 1);
    expect(after?.value).toBe("__QA Velvet Moss");
    expect(after?.source_kind).toBe("attribute");
  });

  it("follows a correction to a bill width", async () => {
    const recordId = await billLine([dim("W", "840"), dim("D", "790")]);
    expect((await answerFor(recordId, DIMENSIONS_JSON_ID))?.value).toBe("W840 x D790mm");
    const width = await attributeOn(recordId, "dimension_slot = 'W'");
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: width.id,
        expectedVersion: width.version,
        value: "880",
        unit: "mm",
        state: "confirmed",
        reason: "__QA re-measured",
        actor: "qa",
      }),
    );
    expect((await answerFor(recordId, DIMENSIONS_JSON_ID))?.value).toBe("W880 x D790mm");
  });

  it("follows the finishes library when the code's description is edited, and says so", async () => {
    const finishId = await withTransaction((txn) =>
      createFinish(txn, {
        projectId,
        fields: { code: "__QA-FAB-01", description: "__QA Boucle Ivory", state: "confirmed" },
        actor: "qa",
      }),
    );
    const recordId = await billLine([com1("__QA Boucle Ivory", { code: "__QA-FAB-01", finishId })]);
    // A linked attribute answers as the LIBRARY says it is (code and words).
    expect((await answerFor(recordId, 1))?.value).toContain("__QA Boucle Ivory");

    const version = Number((await client.query(`select version from project_finishes where id = $1`, [finishId])).rows[0].version);
    const result = await withTransaction((txn) =>
      editFinish(txn, {
        projectId,
        finishId,
        expectedVersion: version,
        fields: { code: "__QA-FAB-01", description: "__QA Boucle Oat", state: "confirmed" },
        reason: "__QA the schedule names it Oat",
        actor: "qa",
      }),
    );

    // The library is the truth: the item's answer reads its words.
    const followed = await answerFor(recordId, 1);
    expect(followed?.value).toContain("__QA Boucle Oat");
    expect(followed?.value).not.toContain("Ivory");
    expect(result.answersFilled).toBeGreaterThanOrEqual(1);
    // And nobody is reported as not following, because nobody owns it.
    expect(result.recordsWithManualAnswers.map((row) => row.recordId)).not.toContain(recordId);
  });

  it("never touches a person's own answer, and the library edit names it", async () => {
    const finishId = await withTransaction((txn) =>
      createFinish(txn, {
        projectId,
        fields: { code: "__QA-FAB-02", description: "__QA Linen Sand", state: "confirmed" },
        actor: "qa",
      }),
    );
    const recordId = await billLine([com1("__QA Linen Sand", { code: "__QA-FAB-02", finishId }), dim("W", "900")]);
    await typeAnswer(recordId, 1, "__QA Typed by Hayley");

    const version = Number((await client.query(`select version from project_finishes where id = $1`, [finishId])).rows[0].version);
    const result = await withTransaction((txn) =>
      editFinish(txn, {
        projectId,
        finishId,
        expectedVersion: version,
        fields: { code: "__QA-FAB-02", description: "__QA Linen Stone", state: "confirmed" },
        reason: "__QA renamed",
        actor: "qa",
      }),
    );
    expect((await answerFor(recordId, 1))?.value).toBe("__QA Typed by Hayley");
    expect(result.recordsWithManualAnswers.map((row) => row.recordId)).toContain(recordId);

    const fabric = await attributeOn(recordId, "spec_field_id is not null");
    await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: fabric.id,
        expectedVersion: fabric.version,
        value: "__QA Linen Stone",
        unit: null,
        state: "confirmed",
        reason: "__QA corrected",
        actor: "qa",
      }),
    );
    expect((await answerFor(recordId, 1))?.value).toBe("__QA Typed by Hayley");

    const corrected = await attributeOn(recordId, "spec_field_id is not null");
    await withTransaction((txn) =>
      retireAttribute(txn, { attributeId: corrected.id, expectedVersion: corrected.version, reason: "__QA off", actor: "qa" }),
    );
    const after = await answerFor(recordId, 1);
    expect(after?.value).toBe("__QA Typed by Hayley");
    expect(after?.state).toBe("confirmed");
    expect(after?.source_kind).toBe("manual");
  });

  it("never touches an answer a reviewer confirmed off a schedule, straight onto the question", async () => {
    // Written the way `confirm-spec-document.ts` writes a direct answer:
    // `document`, the schedule's run, confirmed. It is a reviewer's decision,
    // not a projection, and a later bill attribute on the field must not
    // overwrite or retract it.
    const recordId = await billLine([dim("W", "700")]);
    const answer = await answerFor(recordId, 1);
    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, {
        projectId,
        kind: "spec_document_confirm",
        actor: "qa",
        sourceIntakeRunId: ffeRunId,
      });
      await txn`
        update spec_answers
           set value = '__QA Reviewer cloth', state = 'confirmed', confirmed_by = 'qa', confirmed_at = now(),
               source_kind = 'document', source_id = ${ffeRunId}, updated_by = 'qa'
         where id = ${answer!.id}
      `;
      await snapshotRecords(txn, [recordId], changeSetId);
    });

    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa" });
      await txn`
        insert into record_attributes
          (record_id, attr_group, label, value, spec_field_id, state, source_run_id, sort_order, created_by, updated_by)
        values (${recordId}, 'material', 'Fabric', '__QA Bill cloth', ${com1FieldId}, 'confirmed', ${billRunId}, 9, 'qa', 'qa')
      `;
      await recomposeAnswers(txn, recordId, billRunId, "qa");
      await snapshotRecords(txn, [recordId], changeSetId);
    });
    expect((await answerFor(recordId, 1))?.value).toBe("__QA Reviewer cloth");

    const fabric = await attributeOn(recordId, "spec_field_id is not null");
    await withTransaction((txn) =>
      retireAttribute(txn, { attributeId: fabric.id, expectedVersion: fabric.version, reason: "__QA off", actor: "qa" }),
    );
    const after = await answerFor(recordId, 1);
    expect(after?.value).toBe("__QA Reviewer cloth");
    expect(after?.source_kind).toBe("document");
  });

  it("fills a record's answers from its bill specs the moment it is categorised (E5)", async () => {
    // Intake does not block on a category, so a bill line routinely arrives
    // with none and its specs fill nothing. Setting one created the rows
    // `missing` and stopped: the record showed W, D and a fabric on its Specs
    // tab and a checklist saying nobody had looked.
    const recordId = await billLine([com1("__QA Mohair Slate"), dim("W", "1900"), dim("D", "790")], {
      categorised: false,
    });
    const before = Number(
      (await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n,
    );
    const version = Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);

    await withTransaction((txn) => setRecordCategory(txn, { recordId, categoryId, expectedVersion: version, actor: "qa" }));

    const fabric = await answerFor(recordId, 1);
    expect(fabric?.value).toBe("__QA Mohair Slate");
    expect(fabric?.state).toBe("confirmed");
    expect(fabric?.source_kind).toBe("attribute");
    expect((await answerFor(recordId, DIMENSIONS_JSON_ID))?.value).toBe("W1900 x D790mm");

    // One act, one version: the category and the answers it filled together.
    const after = Number(
      (await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [recordId])).rows[0].n,
    );
    expect(after).toBe(before + 1);
  });
});
