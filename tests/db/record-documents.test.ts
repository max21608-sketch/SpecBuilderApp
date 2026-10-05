// Database tier — the record's Documents tab, through the REAL route.
//
// Skips silently without DATABASE_URL. Run it on the local stack:
//   node ~/dev/localstack/one-db-test.mjs tests/db/record-documents.test.ts
//
// What a database is needed for: that every link the loader reads is the
// column a confirm actually writes, that one file is one row however many of
// those links point at it, that a configuration reaches its bill line's bill
// through parent_id, and that nothing on another project leaks in through a
// source column holding a foreign id. The wording is held in the pure tier.
//
// Every value is invented. Rows are prefixed `__QA ` and deleted FK-safe;
// audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import type { RecordDocumentsResult } from "@/lib/record-documents";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("the documents behind a record", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const projectIds: string[] = [];
  const attachmentIds: string[] = [];
  let projectId = "";
  let otherProjectId = "";
  let recordId = "";
  let variantId = "";
  let otherRecordId = "";
  let billRunId = "";
  let drawingRunId = "";
  let oldDrawingRunId = "";
  let emailRunId = "";
  let messageId = "";
  let manualChangeId = "";
  let foreignRunId = "";

  const documents = async (id: string): Promise<{ status: number; body: { ok: boolean } & RecordDocumentsResult }> => {
    const { GET } = await import("@/app/api/records/[id]/documents/route");
    const response = await GET(new Request("http://localhost/test"), params(id));
    return { status: response.status, body: await response.json() };
  };

  const project = async (number: string, name: string) => {
    const row = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, $2, 'qa', 'qa') returning id`,
      [qaNumber(number), name],
    );
    projectIds.push(row.rows[0].id);
    return String(row.rows[0].id);
  };

  const attachment = async (project: string, filename: string, contentType: string) => {
    const row = await client.query(
      `insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, uploaded_by)
       values ('project', $1, 'intake', $2, $3, $4, 'qa') returning id`,
      [project, `projects/${project}/uploads/__qa-${filename}`, filename, contentType],
    );
    attachmentIds.push(row.rows[0].id);
    return String(row.rows[0].id);
  };

  const intakeRun = async (project: string, attachmentId: string | null, sourceKind: string, documentKind: string | null) => {
    const row = await client.query(
      `insert into intake_runs (project_id, attachment_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, $3, $4, 'confirmed', 'qa', 'qa') returning id`,
      [project, attachmentId, sourceKind, documentKind],
    );
    return String(row.rows[0].id);
  };

  const note = async (record: string, sourceRun: string, page: number | null, retired = false) => {
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, state, sort_order, status,
                                      source_run_id, source_page, retired_at, retired_by, created_by, updated_by)
       values ($1, 'note', '__QA Note', 'Invented note', 'confirmed', 0, $2, $3, $4,
               case when $5 then now() end, case when $5 then 'qa' end, 'qa', 'qa')`,
      [record, retired ? "retired" : "active", sourceRun, page, retired],
    );
  };

  const changeWithVersion = async (
    record: string,
    snapshotNo: number,
    kind: string,
    fields: { reason?: string | null; sourceRun?: string | null; evidence?: string | null },
  ) => {
    const change = await client.query(
      `insert into change_sets (project_id, kind, reason, source_intake_run_id, evidence_attachment_id, closed_at, actor)
       values ($1, $2, $3, $4, $5, now(), 'qa') returning id`,
      [projectId, kind, fields.reason ?? null, fields.sourceRun ?? null, fields.evidence ?? null],
    );
    await client.query(
      `insert into record_snapshots (record_id, change_set_id, snapshot_no, atoms, cells)
       values ($1, $2, $3, '{}'::jsonb, '[]'::jsonb)`,
      [record, change.rows[0].id, snapshotNo],
    );
    return String(change.rows[0].id);
  };

  beforeAll(async () => {
    await client.connect();
    projectId = await project("P90061", "__QA Record documents");
    otherProjectId = await project("P90062", "__QA Record documents elsewhere");

    const phase = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
      [projectId],
    );
    const otherPhase = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
      [otherProjectId],
    );

    billRunId = await intakeRun(
      projectId,
      await attachment(projectId, "bill.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      "boq_xlsx",
      null,
    );
    drawingRunId = await intakeRun(projectId, await attachment(projectId, "X-100.pdf", "application/pdf"), "spec_document", "shop_drawings");
    oldDrawingRunId = await intakeRun(projectId, await attachment(projectId, "X-100 rev0.pdf", "application/pdf"), "spec_document", "shop_drawings");
    const emlId = await attachment(projectId, "reply.eml", "message/rfc822");
    emailRunId = await intakeRun(projectId, emlId, "spec_document", "email");
    const message = await client.query(
      `insert into email_messages (mailbox, origin, subject, routing_status, project_id, intake_run_id, mime_attachment_id,
                                   assigned_by, assigned_at, assignment_kind, created_by, updated_by)
       values ('__qa@example.test', 'upload', '__QA Re: invented armchair', 'assigned', $1, $2, $3,
               'qa', now(), 'manual', 'qa', 'qa')
       returning id`,
      [projectId, emailRunId, emlId],
    );
    messageId = message.rows[0].id;

    const record = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, qty, status,
                                 source_import_id, source_line_no, created_by, updated_by)
       values ($1, $2, 1, '__QA Armchair', 4, 'active', $3, 12, 'qa', 'qa') returning id`,
      [projectId, phase.rows[0].id, billRunId],
    );
    recordId = record.rows[0].id;

    const variant = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, parent_id, depth, split_reason,
                                 variant_label, status, created_by, updated_by)
       values ($1, $2, 2, '__QA Armchair', $3, 1, 'fabric', 'A', 'active', 'qa', 'qa') returning id`,
      [projectId, phase.rows[0].id, recordId],
    );
    variantId = variant.rows[0].id;

    // Two specs off ONE drawing, on two pages; one retired spec off another.
    await note(recordId, drawingRunId, 2);
    await note(recordId, drawingRunId, 3);
    await note(recordId, oldDrawingRunId, 5, true);

    // An answer confirmed off the email: source_id is the email's intake run.
    const requirement = await client.query(`select id, spec_field_id from requirements order by id limit 1`);
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, value, state, source_kind, source_id,
                                 created_by, updated_by)
       values ($1, $2, $3, 'TBC', 'tbc', 'email', $4, 'qa', 'qa')`,
      [recordId, requirement.rows[0].id, requirement.rows[0].spec_field_id, emailRunId],
    );

    // The email's own change carries its .eml as evidence — the same file.
    await changeWithVersion(recordId, 1, "email_confirm", {
      reason: "__QA Invented email of the 14th",
      sourceRun: emailRunId,
      evidence: emlId,
    });
    // A hand edit with a PDF attached as its evidence.
    manualChangeId = await changeWithVersion(recordId, 2, "manual_edit", {
      reason: "__QA Site visit note",
      evidence: await attachment(projectId, "site-note.pdf", "application/pdf"),
    });

    // Another project's document, and a source column on THIS record that
    // names it. Neither may appear.
    foreignRunId = await intakeRun(
      otherProjectId,
      await attachment(otherProjectId, "elsewhere.pdf", "application/pdf"),
      "spec_document",
      "shop_drawings",
    );
    const other = await client.query(
      `insert into spec_records (project_id, run_id, record_no, item_description, status, created_by, updated_by)
       values ($1, $2, 1, '__QA Elsewhere', 'active', 'qa', 'qa') returning id`,
      [otherProjectId, otherPhase.rows[0].id],
    );
    otherRecordId = other.rows[0].id;
    await note(otherRecordId, foreignRunId, 1);
    await note(recordId, foreignRunId, 9);
  });

  afterAll(async () => {
    const records = `select id from spec_records where project_id = any($1::uuid[])`;
    await client.query(`delete from spec_answers where record_id in (${records})`, [projectIds]);
    await client.query(`delete from record_attributes where record_id in (${records})`, [projectIds]);
    // Records first: a version goes with its record (0013) and no other way.
    await client.query(`delete from spec_records where project_id = any($1::uuid[]) and parent_id is not null`, [projectIds]);
    await client.query(`delete from spec_records where project_id = any($1::uuid[])`, [projectIds]);
    await client.query(`delete from email_messages where project_id = any($1::uuid[])`, [projectIds]);
    await client.query(`delete from spec_runs where project_id = any($1::uuid[])`, [projectIds]);
    await client.query(`delete from attachments where id = any($1::uuid[])`, [attachmentIds]);
    // The project goes last; its intake runs and change sets go with it.
    await client.query(`delete from projects where id = any($1::uuid[])`, [projectIds]);
    await client.end();
  });

  it("lists each document once, the bill first, with what it gave the item", async () => {
    const { status, body } = await documents(recordId);
    expect(status).toBe(200);
    const rows = body.documents;
    const byFile = new Map(rows.map((row) => [row.filename, row]));

    // Five documents: the bill, two drawings, the email and the hand edit's
    // evidence. One row each — the .eml is the email's run AND its change's
    // evidence, and it is not printed twice.
    expect(rows.map((row) => row.filename).sort()).toEqual(
      ["X-100 rev0.pdf", "X-100.pdf", "bill.xlsx", "reply.eml", "site-note.pdf"].sort(),
    );
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows[0]?.filename).toBe("bill.xlsx");

    expect(byFile.get("bill.xlsx")?.relations).toEqual(["Bill row 12"]);
    expect(byFile.get("X-100.pdf")?.relations).toEqual(["2 specs, pages 2–3"]);
    expect(byFile.get("X-100.pdf")?.open).toEqual({ href: `/api/imports/${drawingRunId}/source#page=2`, inline: true });
    expect(byFile.get("X-100 rev0.pdf")?.relations).toEqual(["1 retired spec, page 5"]);

    const email = byFile.get("reply.eml");
    expect(email?.kind).toBe("email");
    expect(email?.subject).toBe("__QA Re: invented armchair");
    expect(email?.relations).toEqual([
      "1 checklist answer",
      "Evidence for the change “__QA Invented email of the 14th” (version 1)",
    ]);
    // Downloaded through the route that never renders it.
    expect(email?.open).toEqual({ href: `/api/email-messages/${messageId}/mime`, inline: false });
    expect(email?.reviews).toEqual([{ runId: emailRunId, label: "Email" }]);

    const evidence = byFile.get("site-note.pdf");
    expect(evidence?.kind).toBe("evidence");
    expect(evidence?.relations).toEqual(["Evidence for the change “__QA Site visit note” (version 2)"]);
    expect(evidence?.open).toEqual({ href: `/api/change-sets/${manualChangeId}/evidence`, inline: false });
  });

  it("never lists another project's document, even where a source column names it", async () => {
    const { body } = await documents(recordId);
    expect(body.documents.map((row) => row.filename)).not.toContain("elsewhere.pdf");
    expect(body.documents.flatMap((row) => row.reviews.map((review) => review.runId))).not.toContain(foreignRunId);

    const other = await documents(otherRecordId);
    expect(other.body.documents.map((row) => row.filename)).toEqual(["elsewhere.pdf"]);
  });

  it("lists a configuration's bill line's bill, and says whose it is", async () => {
    const { body } = await documents(variantId);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]?.filename).toBe("bill.xlsx");
    expect(body.documents[0]?.relations).toEqual(["Bill row 12, for the bill line this configuration belongs to"]);
    expect(body.origin).toEqual({ mockup: false, noBill: false });
  });

  it("says a record of no bill and no document has none", async () => {
    const { body } = await documents(otherRecordId);
    expect(body.origin.noBill).toBe(true);
  });

  it("is a 404 for a record that does not exist, and for an id that is not one", async () => {
    expect((await documents("00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await documents("not-a-uuid")).status).toBe(404);
  });
});
