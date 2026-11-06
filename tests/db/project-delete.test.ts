// Database tier — 0055 and db/project-delete.mjs: a project can be deleted,
// by script, and nothing of it is left but its audit trail.
//
// ============================================================================
// THERE WAS NO DELETION PATH, AND THE SCHEMA RESISTED ADDING ONE (audit B5).
//
// Three things stood in the way, each found by deleting a real-shaped project:
//
//   * `email_drafts.project_id` is RESTRICT, so a project anybody ever chased
//     refused outright;
//   * `email_messages.project_id` is SET NULL, which an ASSIGNED message's own
//     CHECK (`assigned = project is not null`) then refuses;
//   * five more RESTRICTs sit BETWEEN two tables the project cascade empties
//     (a run and its batch, a record and its phase, an attribute and its
//     finish, a draft and its contact, a coverage row and its answer). Whether
//     those pass depends on which cascade Postgres fires first, which is the
//     order the RI triggers were created in, which `db/restore.mjs` can change.
//     And the version guard (0013) refused a version whose record still
//     existed, which is exactly the state it is in when `change_sets` cascades
//     before `spec_records`.
//
// The fixture below carries every one of those shapes: mail on the project
// (one that arrived through the mailbox, one uploaded to it), a sent chase and
// its coverage, a version inside a baseline, a configuration under its bill
// line, a spec linked to a finish, a run inside a batch, and the polymorphic
// rows (attachments, status history, a note) no FK reaches.
// ============================================================================
import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
import { normaliseFinishCode } from "@/lib/finishes";
import { TABLE_HANDLING } from "../../tools/lib/copy-project-core";
import {
  OWNED_TABLES,
  POLYMORPHIC_TABLES,
  deleteProjectRows,
  planProjectDeletion,
} from "../../db/project-delete.mjs";

const databaseUrl = process.env.DATABASE_URL;

type Fixture = {
  projectId: string;
  recordId: string;
  variantId: string;
  graphMessageId: string;
  uploadMessageId: string;
  prefix: string;
};

describeIfDb("0055 a project is deletable", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const made: string[] = [];
  const mailbox = `__qa_delete_${QA_RUN_SUFFIX}@example.test`;

  /** The first row, or undefined when there is none (a test asserts which). */
  async function maybe<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T | undefined> {
    const { rows } = await client.query<T>(text, values);
    return rows[0];
  }

  async function one<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T> {
    const row = await maybe<T>(text, values);
    if (!row) throw new Error(`No row from: ${text}`);
    return row;
  }

  /** A project carrying every shape that used to stop a delete. */
  async function buildProject(base: string): Promise<Fixture> {
    const { id: projectId } = await one<{ id: string }>(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA deletable project', 'qa', 'qa') returning id`,
      [qaNumber(base)],
    );
    made.push(projectId);
    const prefix = `projects/${projectId}/`;

    const { id: batchId } = await one<{ id: string }>(
      `insert into intake_batches (project_id, created_by) values ($1, 'qa') returning id`, [projectId],
    );
    const { id: intakeRunId } = await one<{ id: string }>(
      `insert into intake_runs (project_id, batch_id, source_kind, status, created_by, updated_by)
       values ($1, $2, 'boq_xlsx', 'confirmed', 'qa', 'qa') returning id`,
      [projectId, batchId],
    );
    await one(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename)
       values ('project', $1, 'boq', $2, '__QA bill.xlsx') returning id`,
      [projectId, `${prefix}uploads/__QA bill.xlsx`],
    );
    await one(
      `insert into status_history (entity_type, entity_id, to_status, changed_by) values ('intake_run', $1, 'confirmed', 'qa') returning id`,
      [intakeRunId],
    );
    const { id: runId } = await one<{ id: string }>(
      `insert into spec_runs (project_id, name, source_import_id, created_by, updated_by)
       values ($1, '__QA phase', $2, 'qa', 'qa') returning id`,
      [projectId, intakeRunId],
    );
    const { id: recordId } = await one<{ id: string }>(
      `insert into spec_records (project_id, run_id, record_no, item_description, source_import_id, created_by, updated_by)
       values ($1, $2, 1, 'An invented desk chair', $3, 'qa', 'qa') returning id`,
      [projectId, runId, intakeRunId],
    );
    const { id: variantId } = await one<{ id: string }>(
      `insert into spec_records (project_id, run_id, record_no, item_description, parent_id, depth, split_reason,
                                 variant_label, created_by, updated_by)
       values ($1, $2, 2, 'An invented desk chair', $3, 1, 'configuration', 'TYPE 1', 'qa', 'qa') returning id`,
      [projectId, runId, recordId],
    );
    await one(
      `insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm)
       values ($1, $2, 'boq_code', 'QA-CH-01', 'QA-CH-01') returning id`,
      [recordId, projectId],
    );
    await one(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename)
       values ('spec_records', $1, 'item_image', $2, 'chair.png') returning id`,
      [recordId, `${prefix}bill-images/${recordId}/chair.png`],
    );
    await one(`insert into notes (entity_type, entity_id, body, created_by) values ('spec_records', $1, 'An invented note.', 'qa') returning id`, [recordId]);

    // A spec linked to a finish: the RESTRICT whose order is up to the cascade.
    const { id: finishId } = await one<{ id: string }>(
      `insert into project_finishes (project_id, code, code_norm, created_by, updated_by)
       values ($1, 'QA-FAB-01', $2, 'qa', 'qa') returning id`,
      [projectId, normaliseFinishCode("QA-FAB-01")],
    );
    const { id: attributeId } = await one<{ id: string }>(
      `insert into record_attributes (record_id, attr_group, label, value, state, finish_id, source_run_id, created_by, updated_by)
       values ($1, 'material', 'Fabric', 'An invented cloth', 'confirmed', $2, $3, 'qa', 'qa') returning id`,
      [variantId, finishId, intakeRunId],
    );
    await one(
      `insert into attribute_disagreements (project_id, record_id, held_attribute_id, attr_group, label, value, state, source_run_id)
       values ($1, $2, $3, 'material', 'Fabric', 'Another invented cloth', 'confirmed', $4) returning id`,
      [projectId, variantId, attributeId, intakeRunId],
    );

    // A version, inside a baseline: change_sets and spec_records both cascade
    // to it, in an order nothing fixes.
    const { id: changeSetId } = await one<{ id: string }>(
      `insert into change_sets (project_id, kind, actor, source_intake_run_id, closed_at) values ($1, 'boq_confirm', 'qa', $2, now()) returning id`,
      [projectId, intakeRunId],
    );
    const { id: snapshotId } = await one<{ id: string }>(
      `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
       values ($1, $2, 1, '{}', '[]') returning id`,
      [recordId, changeSetId],
    );
    const { id: baselineId } = await one<{ id: string }>(
      `insert into change_sets (project_id, kind, actor, label, reason, closed_at) values ($1, 'baseline', 'qa', '__QA Rev A', 'An invented sign-off', now()) returning id`,
      [projectId],
    );
    await one(
      `insert into baseline_members (change_set_id, record_id, snapshot_id) values ($1, $2, $3) returning change_set_id`,
      [baselineId, recordId, snapshotId],
    );

    // A sent chase and its coverage: RESTRICT on the project, the record and
    // the answer.
    const requirement = await one<{ id: string }>(
      `select id from requirements where spec_field_id is null and created_by = 'seed' order by id limit 1`,
    );
    const { id: answerId } = await one<{ id: string }>(
      `insert into spec_answers (record_id, requirement_id, state) values ($1, $2, 'missing') returning id`,
      [recordId, requirement.id],
    );
    const { id: contactId } = await one<{ id: string }>(
      `insert into project_contacts (project_id, name, role, created_by, updated_by)
       values ($1, '__QA Designer', 'designer', 'qa', 'qa') returning id`,
      [projectId],
    );
    const { id: draftId } = await one<{ id: string }>(
      `insert into email_drafts (project_id, contact_id, subject, body, project_label, created_by, updated_by)
       values ($1, $2, '__QA chase', '<p>invented</p>', '__QA', 'qa', 'qa') returning id`,
      [projectId, contactId],
    );
    await one(
      `insert into email_draft_items (draft_id, record_id, requirement_id, answer_id, snapshot_answer_version,
                                      record_version, context_snapshot, prompt_text, sort_order)
       values ($1, $2, $3, $4, 1, 1, '{}', 'An invented question', 1) returning id`,
      [draftId, recordId, requirement.id, answerId],
    );
    await client.query(`update email_drafts set status = 'sent', sent_at = now(), sent_by = 'qa' where id = $1`, [draftId]);

    // Mail. One arrived through the mailbox and was assigned here: its arrival
    // record is outside the project and it survives, unassigned. One was
    // uploaded to the project: its only copy is under the project's prefix and
    // it goes with it.
    const { id: graphMessageId } = await one<{ id: string }>(
      `insert into email_messages (origin, mailbox, graph_message_id, mailbox_storage_path, routing_status, project_id,
                                   assigned_by, assigned_at, assignment_kind, intake_run_id, chase_draft_id, created_by, updated_by)
       values ('graph', $1, $2, $3, 'assigned', $4, 'system:router', now(), 'auto', $5, $6, 'qa', 'qa') returning id`,
      [mailbox, `__qa_graph_${base}_${QA_RUN_SUFFIX}`, `mailbox/__qa/${base}-${QA_RUN_SUFFIX}.eml`, projectId, intakeRunId, draftId],
    );
    const { id: uploadMessageId } = await one<{ id: string }>(
      `insert into email_messages (origin, mailbox, mailbox_storage_path, routing_status, project_id,
                                   assigned_by, assigned_at, assignment_kind, created_by, updated_by)
       values ('upload', $1, $2, 'assigned', $3, 'qa', now(), 'manual', 'qa', 'qa') returning id`,
      [mailbox, `${prefix}emails/uploaded.eml`, projectId],
    );
    await one(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename)
       values ('email_messages', $1, 'eml', $2, 'uploaded.eml') returning id`,
      [uploadMessageId, `${prefix}emails/uploaded.eml`],
    );
    await one(`insert into project_notes (project_id, body, source_run_id, created_by, updated_by) values ($1, 'An invented preamble note.', $2, 'qa', 'qa') returning id`, [projectId, intakeRunId]);

    return { projectId, recordId, variantId, graphMessageId, uploadMessageId, prefix };
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    // Whatever a failed assertion left. The function under test is the
    // cleanup too; if it is the thing that failed, the sweep says so.
    for (const projectId of made) {
      await deleteProjectRows(client, projectId).catch(() => undefined);
    }
    await client.query(`delete from email_messages where mailbox = $1`, [mailbox]);
    await client.end();
  });

  it("lets the database itself delete a project with mail, a sent chase, versions and a finish link", async () => {
    const fixture = await buildProject("P05501");
    await client.query(`delete from projects where id = $1`, [fixture.projectId]);

    // The arrival record survives its project, taken off it in the same
    // statement rather than refused by its own CHECK.
    const survivor = await one<{ routing_status: string; project_id: string | null; assigned_by: string | null; intake_run_id: string | null; chase_draft_id: string | null }>(
      `select routing_status, project_id, assigned_by, intake_run_id, chase_draft_id from email_messages where id = $1`,
      [fixture.graphMessageId],
    );
    expect(survivor).toEqual({ routing_status: "unassigned", project_id: null, assigned_by: null, intake_run_id: null, chase_draft_id: null });
  });

  it("has no RESTRICT between two tables a project delete empties", async () => {
    // Every table that reaches `projects` through foreign keys, and every FK
    // between two of them. A RESTRICT there passes or fails on which cascade
    // fires first; NO ACTION waits for the end of the statement.
    const { rows } = await client.query<{ conname: string }>(`
      with recursive owned(tbl) as (
        select 'projects'::regclass
        union
        select c.conrelid::regclass from pg_constraint c join owned o on c.confrelid = o.tbl where c.contype = 'f'
      )
      select c.conname from pg_constraint c
       where c.contype = 'f' and c.confdeltype = 'r'
         and c.conrelid in (select tbl from owned) and c.confrelid in (select tbl from owned)
       order by 1`);
    expect(rows.map((row) => row.conname)).toEqual([]);
  });

  it("still refuses to delete a version, a finish in use or a chased answer on its own", async () => {
    const fixture = await buildProject("P05502");
    await expect(client.query(`delete from record_snapshots where record_id = $1`, [fixture.recordId]))
      .rejects.toThrow(/append-only/);
    await expect(client.query(`delete from project_finishes where project_id = $1`, [fixture.projectId]))
      .rejects.toThrow(/record_attributes_finish_id_fkey/);
    await expect(client.query(`delete from spec_answers where record_id = $1`, [fixture.recordId]))
      .rejects.toThrow(/email_draft_items_answer_id_fkey/);
    await expect(client.query(`update email_messages set project_id = null where id = $1`, [fixture.graphMessageId]))
      .rejects.toThrow(/email_messages_assigned_has_project/);
  });

  it("deletes every row of the project but its audit trail, and names the files", async () => {
    const fixture = await buildProject("P05503");
    const plan = await planProjectDeletion(client, fixture.projectId);
    const counted = Object.fromEntries(plan.counts.map((entry: { table: string; rows: number }) => [entry.table, entry.rows]));
    expect(counted).toMatchObject({
      projects: 1, spec_records: 2, record_snapshots: 1, baseline_members: 1, email_drafts: 1,
      email_draft_items: 1, email_messages: 1, attachments: 3, status_history: 1, notes: 1,
    });
    expect(plan.messagesKept).toBe(1);
    expect([...plan.blobPaths].sort()).toEqual([
      `${fixture.prefix}bill-images/${fixture.recordId}/chair.png`,
      `${fixture.prefix}emails/uploaded.eml`,
      `${fixture.prefix}uploads/__QA bill.xlsx`,
    ]);

    const { rows: before } = await client.query<{ n: string }>(
      `select count(*) as n from audit_log where row_id = $1`, [fixture.projectId],
    );
    const done = await deleteProjectRows(client, fixture.projectId);
    expect(done.blobPaths).toEqual(plan.blobPaths);

    const after = await planProjectDeletion(client, fixture.projectId).catch((error: Error) => error);
    expect(after).toBeInstanceOf(Error);
    for (const entry of plan.counts) {
      const { rows } = await client.query<{ n: string }>(entry.countSql, entry.values);
      expect(Number(rows[0]!.n), `${entry.table} still holds rows`).toBe(0);
    }
    expect(await maybe(`select id from email_messages where id = $1`, [fixture.uploadMessageId])).toBeUndefined();
    expect(await one<{ routing_status: string }>(`select routing_status from email_messages where id = $1`, [fixture.graphMessageId]))
      .toEqual({ routing_status: "unassigned" });

    // The trail stays, by design, and grows by the delete itself.
    const { rows: afterAudit } = await client.query<{ n: string }>(
      `select count(*) as n from audit_log where row_id = $1`, [fixture.projectId],
    );
    expect(Number(afterAudit[0]!.n)).toBe(Number(before[0]!.n) + 1);
  });

  it("covers every table the project copy calls the project's own", () => {
    // `tools/lib/copy-project-core.ts` refuses a table it has not classified,
    // so its list is the schema's. A table it carries with a project that this
    // delete does not empty is a row left behind the first time it is used.
    const copied = Object.entries(TABLE_HANDLING)
      .filter(([, handling]) => ["root", "owned", "polymorphic"].includes(handling.kind))
      .map(([table]) => table)
      .sort();
    expect([...OWNED_TABLES, ...POLYMORPHIC_TABLES].sort()).toEqual(copied);
  });
});
