// Database tier — GET /api/drafts/[id]/eml, the chase draft as a FILE.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/draft-eml-route.test.ts
//
// What it holds (review 5.1; the route's header and `email-draft-and-send-gate`):
//  - the response is an Outlook-openable message marked UNSENT, never a send:
//    `message/rfc822`, `X-Unsent: 1`, an attachment disposition, no-store;
//  - outside production To AND Cc go to the signed-in user, and the addresses
//    the real draft would have used travel only in the response headers;
//  - downloading records nothing — the draft's status and version stand;
//  - a stale `?version=` is a 409 naming the current one, an unknown draft a 404.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

const USER_EMAIL = "__qa-eml@example.test";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: USER_EMAIL, name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (query = "") => new Request(`http://localhost/test${query}`);

describeIfDb("the chase draft as an .eml file", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let draftId = "";
  const appEnv = process.env.APP_ENV;

  beforeAll(async () => {
    await client.connect();
    // The non-production rewrite is what this file is mostly about, so the
    // environment is stated rather than inherited.
    process.env.APP_ENV = "development";
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ('${qaNumber("P90201")}', '__QA eml route', 'qa', 'qa') returning id`,
      )
    ).rows[0].id;
    const contactId = (
      await client.query(
        `insert into project_contacts (project_id, name, email, role, created_by, updated_by)
         values ($1, '__QA Designer', 'designer@example.test', 'designer', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    draftId = (
      await client.query(
        `insert into email_drafts (project_id, contact_id, subject, body, body_format, project_label,
                                   recipient_name, recipient_email, cc_email, created_by, updated_by)
         values ($1, $2, '__QA Spec questions — S-100', '<p>Invented question about S-100</p>', 'html', '__QA P90201',
                 '__QA Designer', 'designer@example.test', 'inbox@example.test', 'qa', 'qa') returning id`,
        [projectId, contactId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnv;
    if (projectId) {
      await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
      await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    await client.end();
  });

  const draftRow = async () =>
    (await client.query(`select status, version, sent_at from email_drafts where id = $1`, [draftId])).rows[0];

  it("is a message file marked unsent, addressed to the signed-in user outside production", async () => {
    const before = await draftRow();
    const { GET } = await import("@/app/api/drafts/[id]/eml/route");
    const res = await GET(get(), params(draftId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("message/rfc822");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-draft-version")).toBe(String(before.version));

    const eml = await res.text();
    const head = eml.split("\r\n\r\n")[0]!;
    // A draft Outlook opens for a person to send — never a sent message.
    expect(head).toMatch(/^X-Unsent: 1$/m);
    expect(head).toMatch(/^Subject: /m);
    // STAGING MUST NOT BE ABLE TO EMAIL A CLIENT: both lines go to the user.
    const to = /^To: (.*)$/m.exec(head)?.[1] ?? "";
    const cc = /^Cc: (.*)$/m.exec(head)?.[1] ?? "";
    expect(to).toContain(USER_EMAIL);
    expect(cc).toContain(USER_EMAIL);
    expect(head).not.toContain("designer@example.test");
    expect(head).not.toContain("inbox@example.test");
    // …and the screen is told who the real one would have gone to.
    expect(res.headers.get("x-intended-to")).toBe("designer@example.test");
    expect(res.headers.get("x-intended-cc")).toBe("inbox@example.test");
    // No header a mail client would act on to send or redirect it.
    expect(head).not.toMatch(/^(Bcc|Reply-To|Disposition-Notification-To):/im);

    // Downloading records nothing: telling the app it was sent is its own act.
    const after = await draftRow();
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    expect(after.sent_at).toBeNull();
  });

  it("refuses a stale version with the current one, and an unknown draft with a 404", async () => {
    const { GET } = await import("@/app/api/drafts/[id]/eml/route");
    const current = Number((await draftRow()).version);
    const stale = await GET(get(`?version=${current + 7}`), params(draftId));
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.code).toBe("draft_version_stale");
    expect(body.currentVersion).toBe(current);

    const ok = await GET(get(`?version=${current}`), params(draftId));
    expect(ok.status).toBe(200);

    const missing = await GET(get(), params("00000000-0000-4000-8000-000000000000"));
    expect(missing.status).toBe(404);
  });
});
