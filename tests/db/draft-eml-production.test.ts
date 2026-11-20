// Database tier — the chase email AS PRODUCTION WOULD WRITE IT (production
// hardening H6, 2026-11-20).
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/draft-eml-production.test.ts
//
// `draft-eml-route.test.ts` forces APP_ENV=development, because what it holds
// is the non-production rewrite, and nothing anywhere had run the production
// branch: a draft generated with no `[STAGING]` marker, downloaded as a file
// addressed To the real recipient and Cc the project inbox. This file runs
// both routes — generate, then the `.eml` — with APP_ENV and
// DATABASE_ENVIRONMENT both `production`, set in `beforeAll` and put back in
// `afterAll`. Vitest gives every file its own module graph, so `env.ts`'s
// cached answer here is this file's alone; the variables are restored so no
// later file in the same fork inherits them.
//
// The database is still the local stack's (or CI's throwaway one): only the
// LABELS say production, which is all the two routes read. Every row is a
// `__QA` row of this file's own, deleted afterwards.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber, QA_RUN_SUFFIX } from "./db-tier";
import pg from "pg";

const USER_EMAIL = "__qa-eml-production@example.test";
const DESIGNER_EMAIL = `__qa-designer-${QA_RUN_SUFFIX}@example.test`;
const INBOX = `__qa-inbox-production-${QA_RUN_SUFFIX}@example.test`;

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-4000-8000-0000000000a6",
    email: USER_EMAIL,
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const KEYS = ["APP_ENV", "DATABASE_ENVIRONMENT"] as const;

/** One header's value, unfolded and with its RFC 2047 encoded-words decoded. */
function header(head: string, name: string): string | null {
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const value = new RegExp(`^${name}: (.*)$`, "mi").exec(unfolded)?.[1];
  if (value === undefined) return null;
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?utf-8\?B\?([^?]*)\?=/gi, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
}

describeIfDb("the chase email on a production build", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const saved: Record<string, string | undefined> = {};
  let projectId = "";
  let contactId = "";
  let categoryId = "";
  let recordId = "";
  let requirementId = "";
  let draftId = "";

  beforeAll(async () => {
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.APP_ENV = "production";
    process.env.DATABASE_ENVIRONMENT = "production";
    vi.resetModules();

    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, shared_inbox, created_by, updated_by)
         values ($1, '__QA Production chase', $2, 'qa', 'qa') returning id`,
        [qaNumber("P90206"), INBOX],
      )
    ).rows[0].id;
    contactId = (
      await client.query(
        `insert into project_contacts (project_id, name, email, role, created_by, updated_by)
         values ($1, '__QA Designer', $2, 'designer', 'qa', 'qa') returning id`,
        [projectId, DESIGNER_EMAIL],
      )
    ).rows[0].id;
    // This file's own category and question, as `chase-drafts.test.ts` does,
    // so no seeded requirement is read or touched.
    categoryId = (
      await client.query(
        `insert into item_categories (slug, family, name, requirements_authored, sort_order, created_by, updated_by)
         values ($1, 'upholstery', $2, true, 9006, 'qa', 'qa') returning id`,
        [qaNumber("eml-production-category").toLowerCase().replace(/\s+/g, "-"), qaNumber("Eml production category")],
      )
    ).rows[0].id;
    const field = (await client.query(`select id from spec_fields where json_id is not null order by json_id limit 1`)).rows[0];
    requirementId = (
      await client.query(
        `insert into requirements (category_id, kind, spec_field_id, prompt, section, sort_order, created_by, updated_by)
         values ($1, 'spec_field', $2, '__QA production question', '__QA section', 1, 'qa', 'qa') returning id`,
        [categoryId, field.id],
      )
    ).rows[0].id;
    const runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main phase', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    recordId = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, level, item_description, created_by, updated_by)
         values ($1, $2, 9006, 'active', $3, 'complex', '__QA Armchair', 'qa', 'qa') returning id`,
        [projectId, runId, categoryId],
      )
    ).rows[0].id;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'qa', 'qa' from requirements q where q.id = $2`,
      [recordId, requirementId],
    );
  });

  afterAll(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
    try {
      if (projectId) {
        await client.query(
          `delete from email_draft_items where draft_id in (select id from email_drafts where project_id = $1)`,
          [projectId],
        );
        await client.query(
          `delete from status_history where entity_type = 'email_draft'
           and entity_id in (select id from email_drafts where project_id = $1)`,
          [projectId],
        );
        await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
        await client.query(`delete from spec_answers where record_id = $1`, [recordId]);
        await client.query(`delete from spec_record_refs where project_id = $1`, [projectId]);
        await client.query(`delete from spec_records where project_id = $1`, [projectId]);
        await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
        await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
        await client.query(`delete from projects where id = $1`, [projectId]);
      }
    } finally {
      if (categoryId) await client.query(`delete from item_categories where id = $1`, [categoryId]).catch(() => undefined);
      await client.end();
    }
  });

  it("is the production build this file says it is", async () => {
    const { isProduction } = await import("@/lib/env");
    expect(isProduction()).toBe(true);
  });

  it("generates a draft with no environment marker in its subject, addressed to the real people", async () => {
    const { POST } = await import("@/app/api/drafts/generate/route");
    const res = await POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          selections: [{ contactId, questions: [{ recordId, requirementId }] }],
          expectedCurrentDrafts: [],
        }),
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const draft = (
      await client.query(`select id, subject, recipient_email, cc_email from email_drafts where project_id = $1 and status = 'draft'`, [
        projectId,
      ])
    ).rows[0];
    draftId = draft.id;
    expect(String(draft.subject)).not.toMatch(/\[(STAGING|PILOT|DEV)\]/i);
    expect(String(draft.subject)).toMatch(/^__QA P90206.* — outstanding specification information/);
    expect(draft.recipient_email).toBe(DESIGNER_EMAIL);
    expect(draft.cc_email).toBe(INBOX);
  });

  it("downloads as a file To the real recipient and Cc the project inbox, with no x-intended-* header", async () => {
    expect(draftId).not.toBe("");
    const { GET } = await import("@/app/api/drafts/[id]/eml/route");
    const res = await GET(new Request("http://localhost/test"), { params: Promise.resolve({ id: draftId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("message/rfc822");

    // The screen's "who it would have gone to" exists only where the file was
    // readdressed; in production it was not, so neither header is sent at all.
    expect(res.headers.get("x-intended-to")).toBeNull();
    expect(res.headers.get("x-intended-cc")).toBeNull();
    expect([...res.headers.keys()].filter((key) => key.startsWith("x-intended"))).toEqual([]);

    const eml = await res.text();
    const head = eml.split("\r\n\r\n")[0]!;
    expect(head).toMatch(/^X-Unsent: 1$/m);

    const to = header(head, "To") ?? "";
    expect(to).toBe(`__QA Designer <${DESIGNER_EMAIL}>`);
    expect(header(head, "Cc")).toBe(INBOX);
    expect(header(head, "From")).toBe(`QA User <${USER_EMAIL}>`);
    // The signed-in user is the sender, never a recipient, on production.
    expect(to).not.toContain(USER_EMAIL);

    const subject = header(head, "Subject") ?? "";
    expect(subject).toMatch(/— outstanding specification information/);
    expect(subject).not.toMatch(/\[(STAGING|PILOT|DEV)\]/i);
    expect(head).not.toMatch(/STAGING/i);
  });
});
