// Database tier — changing an item's CATEGORY once it has checklist answers
// (audit B3, and the guard found on the Stage 1 browser walk, 2026-11-06).
//
// Skips silently without DATABASE_URL. Run on the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/category-change.test.ts
//
// ============================================================================
// TWO WAYS A CATEGORY CHANGE FAILED, AND ONE IT REFUSED FOR NO REASON.
//
// 1. A PROJECTION IS NOT AN ANSWER. Since E5 a record is recomposed the moment
//    it is categorised, so a bill line with a size or a fabric holds
//    `attribute` answers at once. The guard counted every non-missing answer,
//    so EVERY such record refused to change category ("already has 2 answered
//    questions… clear them first") — the walk project's desk could not move
//    from Consoles to Desk chair, and there was nothing to clear: the answers
//    were the record's own specs, recomposed. Only a PERSON's answer (manual,
//    email, document) is a decision a dropdown must not discard.
//
// 2. A CHASED QUESTION IS PINNED. A chase's coverage row points at the answer
//    it asked about (`email_draft_items.answer_id`, 0005), and coverage is
//    history: never updated, kept on a superseded or voided draft. Deleting
//    those answers met the foreign key, 23503, "Nothing was written. Check the
//    logs." The change is refused in words, naming the chase.
// ============================================================================
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { DomainConflictError, withTransaction } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { setRecordCategory } from "@/lib/record-category";
import { DIMENSIONS_JSON_ID } from "@/lib/promote-answers";
import { deleteProjectRows } from "../../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("changing a record's category", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let specRunId = "";
  let billRunId = "";
  let contactId = "";
  let fromCategory = { id: "", name: "" };
  let toCategory = { id: "", name: "" };
  let recordNo = 9600;

  /** A bill line confirmed the way confirm-boq.ts confirms one, sizes and all. */
  async function billLine(): Promise<string> {
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
        values (${projectId}, ${specRunId}, ${recordNo}, 'active', ${fromCategory.id}, ${`__QA Desk ${recordNo}`}, 'qa', 'qa')
        returning id
      `;
      const recordId = String(inserted[0]?.id);
      await txn`
        insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
        select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa'
          from requirements q where q.category_id = ${fromCategory.id}
      `;
      let order = 0;
      for (const [slot, value] of [
        ["W", "1900"],
        ["D", "790"],
      ] as const) {
        order += 1;
        await txn`
          insert into record_attributes
            (record_id, attr_group, label, value, unit, dimension_slot, state, source_run_id, sort_order, created_by, updated_by)
          values (${recordId}, 'dimension', ${slot}, ${value}, 'mm', ${slot}, 'confirmed', ${billRunId}, ${order}, 'qa', 'qa')
        `;
      }
      await recomposeAnswers(txn, recordId, billRunId, "qa");
      await snapshotRecords(txn, [recordId], changeSetId);
      return recordId;
    });
  }

  async function dimensionsAnswer(recordId: string) {
    const rows = await client.query(
      `select a.id, a.value, a.state, a.source_kind, q.category_id
         from spec_answers a
         join requirements q on q.id = a.requirement_id
         join spec_fields f on f.id = q.spec_field_id
        where a.record_id = $1 and f.json_id = $2 and a.revision_no = 0`,
      [recordId, DIMENSIONS_JSON_ID],
    );
    return rows.rows as { id: string; value: string | null; state: string; source_kind: string; category_id: string }[];
  }

  async function versionOf(recordId: string): Promise<number> {
    return Number((await client.query(`select version from spec_records where id = $1`, [recordId])).rows[0].version);
  }

  async function categoryOf(recordId: string): Promise<string> {
    return String((await client.query(`select category_id from spec_records where id = $1`, [recordId])).rows[0].category_id);
  }

  async function changeCategory(recordId: string) {
    const expectedVersion = await versionOf(recordId);
    return withTransaction((txn) => setRecordCategory(txn, { recordId, categoryId: toCategory.id, expectedVersion, actor: "qa" }));
  }

  /** A chase draft covering one of the record's answers, inserted as generate writes one. */
  async function chase(recordId: string, status: "draft" | "voided"): Promise<string> {
    const answer = (await dimensionsAnswer(recordId))[0]!;
    const requirement = await client.query(
      `select requirement_id, version from spec_answers where id = $1`,
      [answer.id],
    );
    const draft = await client.query(
      `insert into email_drafts
         (project_id, contact_id, status, subject, body, recipient_name, recipient_email, project_label,
          generated_at, sent_at, sent_by, voided_at, voided_by, created_by, updated_by)
       values ($1, $2, $3, '__QA chase', '<p>__QA</p>', '__QA Hayley Designer', 'hayley@example.test', '__QA',
               '2026-10-14T10:00:00Z',
               case when $3 = 'voided' then timestamptz '2026-10-14T11:00:00Z' end,
               case when $3 = 'voided' then 'qa' end,
               case when $3 = 'voided' then timestamptz '2026-10-15T09:00:00Z' end,
               case when $3 = 'voided' then 'qa' end,
               'qa', 'qa')
       returning id`,
      [projectId, contactId, status],
    );
    const draftId = String(draft.rows[0].id);
    await client.query(
      `insert into email_draft_items
         (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version, record_version,
          context_snapshot, prompt_text, sort_order, created_by)
       values ($1, $2, $3, 0, $4, $5, $6, '{}'::jsonb, '__QA Dimensions', 1, 'qa')`,
      [draftId, recordId, requirement.rows[0].requirement_id, answer.id, requirement.rows[0].version, await versionOf(recordId)],
    );
    return draftId;
  }

  beforeAll(async () => {
    await client.connect();
    const categories = await client.query(
      `select c.id, c.name from item_categories c
        where exists (select 1 from requirements q join spec_fields f on f.id = q.spec_field_id
                       where q.category_id = c.id and f.json_id = ${DIMENSIONS_JSON_ID})
        order by c.sort_order limit 2`,
    );
    fromCategory = { id: String(categories.rows[0].id), name: String(categories.rows[0].name) };
    toCategory = { id: String(categories.rows[1].id), name: String(categories.rows[1].name) };

    projectId = String(
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber("P90044")}', '__QA Category change', 'qa', 'qa') returning id`,
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
    billRunId = String(
      (
        await client.query(
          `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
           values ($1, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
    contactId = String(
      (
        await client.query(
          `insert into project_contacts (project_id, name, email, role, created_by, updated_by)
           values ($1, '__QA Hayley Designer', 'hayley@example.test', 'designer', 'qa', 'qa') returning id`,
          [projectId],
        )
      ).rows[0].id,
    );
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    await client.end();
  });

  it("moves a record whose only answers are its own specs, recomposed under the new category", async () => {
    const recordId = await billLine();
    const before = await dimensionsAnswer(recordId);
    expect(before.map((row) => [row.value, row.source_kind])).toEqual([["W1900 x D790mm", "attribute"]]);

    await changeCategory(recordId);

    expect(await categoryOf(recordId)).toBe(toCategory.id);
    const after = await dimensionsAnswer(recordId);
    // ONE Dimensions answer, on the NEW category's question, recomposed from
    // the same two specs. The old category's projection went with its rows.
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ value: "W1900 x D790mm", source_kind: "attribute", category_id: toCategory.id });
    const stray = await client.query(
      `select count(*)::int as n from spec_answers a join requirements q on q.id = a.requirement_id
        where a.record_id = $1 and q.category_id <> $2`,
      [recordId, toCategory.id],
    );
    expect(stray.rows[0].n).toBe(0);
  });

  it("refuses a record holding a PERSON's answer, naming the question, and writes nothing", async () => {
    const recordId = await billLine();
    const typed = await client.query(
      `select a.id, q.prompt from spec_answers a join requirements q on q.id = a.requirement_id
        where a.record_id = $1 and a.state = 'missing' order by q.sort_order limit 1`,
      [recordId],
    );
    await withTransaction(async (txn) => {
      const changeSetId = await openChangeSet(txn, { projectId, kind: "manual_edit", actor: "qa" });
      await txn`
        update spec_answers
           set value = '__QA typed', state = 'confirmed', confirmed_by = 'qa', confirmed_at = now(),
               source_kind = 'manual', source_id = null, updated_by = 'qa'
         where id = ${String(typed.rows[0].id)}
      `;
      await snapshotRecords(txn, [recordId], changeSetId);
    });
    const version = await versionOf(recordId);

    const refused = await changeCategory(recordId).catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("category_has_answers");
    // The person's answer is NAMED — "2 answered questions" sent people looking
    // for answers that were the record's own sizes.
    expect((refused as DomainConflictError).message).toContain(String(typed.rows[0].prompt));
    expect(await categoryOf(recordId)).toBe(fromCategory.id);
    expect(await versionOf(recordId)).toBe(version);
  });

  it("refuses a CHASED record in words, naming the chase, where it used to be a foreign-key 500", async () => {
    const recordId = await billLine();
    await chase(recordId, "draft");
    const answers = Number(
      (await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [recordId])).rows[0].n,
    );

    const refused = await changeCategory(recordId).catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(DomainConflictError);
    expect((refused as DomainConflictError).code).toBe("category_chased");
    const message = (refused as DomainConflictError).message;
    expect(message).toContain("__QA Hayley Designer");
    expect(message).toContain(fromCategory.name);
    // Nothing written: the category, the answers, the version.
    expect(await categoryOf(recordId)).toBe(fromCategory.id);
    expect(
      Number((await client.query(`select count(*)::int as n from spec_answers where record_id = $1`, [recordId])).rows[0].n),
    ).toBe(answers);
  });

  it("still refuses once that chase is voided: a voided chase keeps the questions it asked", async () => {
    // The obvious way out ("void the draft first") does not exist. Voiding
    // withdraws a send confirmation and keeps the coverage as the record of
    // what was sent (0005), so the answer stays pinned. The sentence must not
    // promise a way out the data model does not have.
    const recordId = await billLine();
    await chase(recordId, "voided");
    const refused = await changeCategory(recordId).catch((cause: unknown) => cause);
    expect((refused as DomainConflictError).code).toBe("category_chased");
    expect((refused as DomainConflictError).message).not.toMatch(/void/i);
  });

  it("is not stopped by a chase of a question that had no answer row", async () => {
    // A null `answer_id` is a positive statement that nothing existed to pin.
    const recordId = await billLine();
    const draftId = await chase(recordId, "draft");
    await client.query(`delete from email_draft_items where draft_id = $1`, [draftId]);
    const requirement = await client.query(
      `select q.id from requirements q where q.category_id = $1
          and not exists (select 1 from spec_answers a where a.record_id = $2 and a.requirement_id = q.id)
        limit 1`,
      [fromCategory.id, recordId],
    );
    if (requirement.rows[0]) {
      await client.query(
        `insert into email_draft_items
           (draft_id, record_id, requirement_id, revision_no, answer_id, snapshot_answer_version, record_version,
            context_snapshot, prompt_text, sort_order, created_by)
         values ($1, $2, $3, 0, null, null, $4, '{}'::jsonb, '__QA no row', 1, 'qa')`,
        [draftId, recordId, requirement.rows[0].id, await versionOf(recordId)],
      );
    }
    await changeCategory(recordId);
    expect(await categoryOf(recordId)).toBe(toCategory.id);
  });

});
