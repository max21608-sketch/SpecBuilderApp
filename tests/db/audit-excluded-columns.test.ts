// Database tier — 0054: the audit trigger stops copying whole documents, email
// bodies and password hashes.
//
// ============================================================================
// AN UNDELETABLE TABLE WAS HOLDING THREE THINGS NOBODY MEANT IT TO.
//
// `write_audit()` writes `to_jsonb(old)` and `to_jsonb(new)` whole, and
// `audit_log` refuses delete. On `intake_runs` that is the staged document
// (`parsed`, hundreds of KB on a real bill) twice per review autosave; on
// `email_messages` it is the body of an NDA-covered email; on `users` it is a
// scrypt hash, kept for ever. Max, 2026-11-06: stop auditing those columns.
//
// What must NOT change is everything else the trigger does: every other
// column still lands, the actor still falls back to `updated_by`, the change
// set still comes from the GUC, and a table with no exclusion (here
// `spec_records`) still carries whole rows. Each of those is asserted below,
// because a stripping trigger that also lost the actor would pass a test that
// only looked for the missing key.
// ============================================================================
import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";

const databaseUrl = process.env.DATABASE_URL;

type AuditRow = { action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; changed_by: string | null; change_set_id: string | null };

describeIfDb("0054 audit excludes document columns", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let userId = "";
  const email = `__qa_audit_${QA_RUN_SUFFIX}@example.test`;

  async function auditFor(table: string, rowId: string): Promise<AuditRow[]> {
    const { rows } = await client.query<AuditRow>(
      `select action, old_values, new_values, changed_by, change_set_id::text as change_set_id
         from audit_log where table_name = $1 and row_id = $2 order by id`,
      [table, rowId],
    );
    return rows;
  }

  function keysOf(row: AuditRow): string[] {
    return [...Object.keys(row.old_values ?? {}), ...Object.keys(row.new_values ?? {})];
  }

  beforeAll(async () => {
    await client.connect();
    const { rows } = await client.query<{ id: string }>(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA audit exclusions', 'qa', 'qa') returning id`,
      [qaNumber("P05401")],
    );
    projectId = rows[0]!.id;
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from email_messages where mailbox = $1`, [`__qa_audit_${QA_RUN_SUFFIX}@example.test`]);
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    if (userId) await client.query(`delete from users where id = $1`, [userId]);
    await client.end();
  });

  it("writes an intake run's audit rows without the staged document or the raw response", async () => {
    const { rows } = await client.query<{ id: string }>(
      `insert into intake_runs (project_id, source_kind, parsed, raw_response, created_by, updated_by)
       values ($1, 'boq_xlsx', '{"lines":[{"code":"QA-1"}]}', '{"model":"x"}', 'qa-author', 'qa-author')
       returning id`,
      [projectId],
    );
    const runId = rows[0]!.id;
    // An autosave: only the staged document moves.
    await client.query(
      `update intake_runs set parsed = '{"lines":[{"code":"QA-2"}]}', updated_by = 'qa-reviewer' where id = $1`,
      [runId],
    );

    const audit = await auditFor("intake_runs", runId);
    expect(audit.map((row) => row.action)).toEqual(["insert", "update"]);
    for (const row of audit) {
      expect(keysOf(row)).not.toContain("parsed");
      expect(keysOf(row)).not.toContain("raw_response");
    }
    // Everything else still lands, and the actor still falls back to the row.
    expect(audit[1]!.old_values).toMatchObject({ source_kind: "boq_xlsx", updated_by: "qa-author" });
    expect(audit[1]!.new_values).toMatchObject({ source_kind: "boq_xlsx", updated_by: "qa-reviewer" });
    expect(audit[1]!.new_values?.version).toBe((audit[1]!.old_values?.version as number) + 1);
    expect(audit[1]!.changed_by).toBe("qa-reviewer");
  });

  it("still reads the change set from the GUC on an excluded table", async () => {
    const { rows: runRows } = await client.query<{ id: string }>(
      `insert into intake_runs (project_id, source_kind, created_by, updated_by)
       values ($1, 'boq_xlsx', 'qa', 'qa') returning id`,
      [projectId],
    );
    await client.query("begin");
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into change_sets (project_id, kind, actor) values ($1, 'manual_edit', 'qa') returning id`,
        [projectId],
      );
      await client.query(`select set_config('app.change_set_id', $1, true)`, [rows[0]!.id]);
      await client.query(`update intake_runs set parsed = '{"lines":[]}' where id = $1`, [runRows[0]!.id]);
      await client.query("commit");
      const audit = await auditFor("intake_runs", runRows[0]!.id);
      expect(audit.at(-1)?.change_set_id).toBe(rows[0]!.id);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  it("writes an email message's audit rows without its body or its headers", async () => {
    const { rows } = await client.query<{ id: string }>(
      `insert into email_messages (origin, mailbox, routing_status, subject, body_text, headers_raw, created_by, updated_by)
       values ('upload', $1, 'unassigned', '__QA invented subject', 'An invented body nobody may keep.',
               '[{"name":"X-QA","value":"1"}]', 'qa', 'qa')
       returning id`,
      [email],
    );
    await client.query(
      `update email_messages set triage = 'nothing_to_record', triaged_by = 'qa', triaged_at = now() where id = $1`,
      [rows[0]!.id],
    );
    const audit = await auditFor("email_messages", rows[0]!.id);
    expect(audit).toHaveLength(2);
    for (const row of audit) {
      expect(keysOf(row)).not.toContain("body_text");
      expect(keysOf(row)).not.toContain("headers_raw");
    }
    expect(audit[1]!.new_values).toMatchObject({ subject: "__QA invented subject", triage: "nothing_to_record" });
  });

  it("writes a user's audit rows without the password hash", async () => {
    const { rows } = await client.query<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1, '__QA audit user', 'scrypt$invented$hash')
       returning id`,
      [email],
    );
    userId = rows[0]!.id;
    await client.query(`update users set password_hash = 'scrypt$another$hash' where id = $1`, [userId]);
    const audit = await auditFor("users", userId);
    expect(audit).toHaveLength(2);
    for (const row of audit) expect(keysOf(row)).not.toContain("password_hash");
    expect(audit[1]!.new_values).toMatchObject({ email, name: "__QA audit user" });
  });

  it("still writes whole rows on a table with no exclusion", async () => {
    const { rows: runRows } = await client.query<{ id: string }>(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA phase', 'qa', 'qa') returning id`,
      [projectId],
    );
    const { rows } = await client.query<{ id: string }>(
      `insert into spec_records (project_id, run_id, record_no, item_description, created_by, updated_by)
       values ($1, $2, 1, 'An invented stool', 'qa', 'qa') returning id`,
      [projectId, runRows[0]!.id],
    );
    await client.query(`update spec_records set item_description = 'An invented chair' where id = $1`, [rows[0]!.id]);
    const audit = await auditFor("spec_records", rows[0]!.id);
    const update = audit.find((row) => row.action === "update");
    expect(update?.old_values).toMatchObject({ item_description: "An invented stool" });
    expect(update?.new_values).toMatchObject({ item_description: "An invented chair" });
    // Whole means whole: the update carries every column the table has.
    const { rows: columns } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'spec_records'`,
    );
    expect(Object.keys(update?.new_values ?? {}).sort()).toEqual(columns.map((c) => c.column_name).sort());
  });
});
