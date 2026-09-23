// Database tier — one project's mail, and counts that describe it.
//
// Plan any-bill, step 7. The inbox page now passes `?projectId=` to the route,
// which has always filtered on it; this proves that the messages AND the three
// tiles the route counts follow it, and that held mail — on no project — is in
// no project's list while the held count it reports stays the whole inbox's,
// which is what the project view's one line says.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

type Payload = {
  messages: { id: string; project_id: string | null }[];
  heldCount: number;
  arrivedToday: number;
  ruledThisWeek: number;
  failedReads: number;
};

describeIfDb("the inbox for one project", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const mailbox = `__qa-${qaNumber("inbox").replace(/\W+/g, "-")}@example.test`;
  const projects: string[] = [];
  const messages: string[] = [];

  async function project(label: string): Promise<string> {
    const row = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, $2, 'qa', 'qa') returning id`,
      [qaNumber(label), `__QA ${label}`],
    );
    projects.push(row.rows[0].id);
    return row.rows[0].id;
  }

  async function failedRun(projectId: string): Promise<string> {
    const row = await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, error, created_by, updated_by)
       values ($1, 'spec_document', 'email', 'failed', '__QA failed', 'qa', 'qa') returning id`,
      [projectId],
    );
    return row.rows[0].id;
  }

  async function assigned(projectId: string, subject: string, over: { runId?: string; triage?: string } = {}) {
    const row = await client.query(
      `insert into email_messages (mailbox, origin, routing_status, project_id, assigned_by, assigned_at,
                                   assignment_kind, subject, from_addr, received_at, intake_run_id,
                                   triage, triaged_by, triaged_at, created_by, updated_by)
       values ($1, 'upload', 'assigned', $2, 'qa', now(), 'manual', $3, 'designer@example.test', now(), $4,
               $5, $6, $7, 'qa', 'qa')
       returning id`,
      [
        mailbox,
        projectId,
        subject,
        over.runId ?? null,
        over.triage ?? "open",
        over.triage ? "qa" : null,
        over.triage ? new Date().toISOString() : null,
      ],
    );
    messages.push(row.rows[0].id);
    return row.rows[0].id as string;
  }

  let a = "";
  let b = "";
  let held = "";

  beforeAll(async () => {
    await client.connect();
    a = await project("P90071");
    b = await project("P90072");
    await assigned(a, "__QA a one");
    await assigned(a, "__QA a two", { runId: await failedRun(a) });
    await assigned(a, "__QA a ruled", { triage: "not_specification" });
    await assigned(b, "__QA b one");
    const row = await client.query(
      `insert into email_messages (mailbox, origin, routing_status, subject, from_addr, received_at,
                                   created_by, updated_by)
       values ($1, 'upload', 'unassigned', '__QA held', 'stranger@example.test', now(), 'qa', 'qa')
       returning id`,
      [mailbox],
    );
    held = row.rows[0].id;
    messages.push(held);
  });

  afterAll(async () => {
    if (messages.length) await client.query(`delete from email_messages where id = any($1::uuid[])`, [messages]);
    for (const id of projects) {
      await client.query(`delete from intake_runs where project_id = $1`, [id]);
      await client.query(`delete from projects where id = $1`, [id]);
    }
    await client.end();
  });

  async function inbox(projectId: string | null): Promise<Payload> {
    const { GET } = await import("@/app/api/email-messages/route");
    const query = new URLSearchParams({ includeTriaged: "1" });
    if (projectId) query.set("projectId", projectId);
    const res = await GET(new Request(`http://localhost/api/email-messages?${query.toString()}`));
    return (await res.json()) as Payload;
  }

  it("lists only that project's mail, and counts only it", async () => {
    const view = await inbox(a);
    expect(view.messages.every((message) => message.project_id === a)).toBe(true);
    expect(view.messages).toHaveLength(3);
    expect(view.arrivedToday).toBe(3);
    expect(view.ruledThisWeek).toBe(1);
    expect(view.failedReads).toBe(1);

    const other = await inbox(b);
    expect(other.messages).toHaveLength(1);
    expect(other.arrivedToday).toBe(1);
    expect(other.ruledThisWeek).toBe(0);
    expect(other.failedReads).toBe(0);
  });

  it("puts held mail in no project's list, and still reports how much is held", async () => {
    const view = await inbox(a);
    expect(view.messages.map((message) => message.id)).not.toContain(held);
    // The whole inbox's held count — the project view's one line reads it.
    expect(view.heldCount).toBeGreaterThanOrEqual(1);
    const all = await inbox(null);
    expect(all.messages.map((message) => message.id)).toContain(held);
    expect(all.heldCount).toBe(view.heldCount);
  });
});
