// Database tier — PATCH /api/projects/[id]/contacts/[contactId], editing one
// contact under the optimistic lock.
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/contact-edit-route.test.ts
//
// What it holds (review 5.1; the route's header):
//  - an edit at the version read writes, uppercases the designer code, and
//    moves the version; a field left out is left alone, a blank one cleared;
//  - an edit at an older version is a 409 naming who changed it, and writes
//    nothing;
//  - a contact is addressed through ITS project — another project's URL is a 404;
//  - two contacts cannot both be the default for one designer code;
//  - correcting an address does not re-address a draft already written.
//
// The route has no DELETE: a contact is removed by nothing in this app, and
// the generic contract test is what says an unknown verb is refused.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "00000000-0000-0000-0000-000000000000", email: "__qa-editor@example.test", name: "QA User", role: "admin" }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string, contactId: string) => ({ params: Promise.resolve({ id, contactId }) });
const patch = (body: unknown) =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describeIfDb("editing a contact", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let otherProjectId = "";
  let contactId = "";
  let siblingId = "";
  let draftId = "";

  beforeAll(async () => {
    await client.connect();
    const project = async (base: string, name: string) =>
      (
        await client.query(
          `insert into projects (bws_project_number, name, created_by, updated_by)
           values ('${qaNumber(base)}', $1, 'qa', 'qa') returning id`,
          [name],
        )
      ).rows[0].id as string;
    projectId = await project("P90205", "__QA contact edit");
    otherProjectId = await project("P90206", "__QA contact edit elsewhere");
    const contact = async (name: string, email: string, code: string | null) =>
      (
        await client.query(
          `insert into project_contacts (project_id, name, email, organisation, role, designer_code, created_by, updated_by)
           values ($1, $2, $3, '__QA Studio', 'designer', $4, 'qa', 'qa') returning id`,
          [projectId, name, email, code],
        )
      ).rows[0].id as string;
    contactId = await contact("__QA Designer", "old@example.test", "QAA");
    siblingId = await contact("__QA Other designer", "other@example.test", "QAB");
    draftId = (
      await client.query(
        `insert into email_drafts (project_id, contact_id, subject, body, project_label, recipient_name, recipient_email,
                                   created_by, updated_by)
         values ($1, $2, '__QA chase', '<p>invented</p>', '__QA', '__QA Designer', 'old@example.test', 'qa', 'qa') returning id`,
        [projectId, contactId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from email_drafts where project_id = $1`, [projectId]);
      await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    }
    for (const id of [projectId, otherProjectId]) if (id) await client.query(`delete from projects where id = $1`, [id]);
    await client.end();
  });

  const row = async (id: string) =>
    (await client.query(`select name, email, organisation, designer_code, version, updated_by from project_contacts where id = $1`, [id]))
      .rows[0];

  it("writes an edit at the version read, keeps what it was not sent, and clears a blank", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/contacts/[contactId]/route");
    const before = await row(contactId);
    const res = await PATCH(
      patch({ version: before.version, email: "  new@example.test ", organisation: "  ", designerCode: "qac" }),
      params(projectId, contactId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contact.version).toBe(before.version + 1);
    const after = await row(contactId);
    expect(after.email).toBe("new@example.test");
    expect(after.organisation).toBeNull();
    // An equality join against the BOQ's own wording, so uppercased here.
    expect(after.designer_code).toBe("QAC");
    expect(after.name).toBe("__QA Designer");
    expect(after.updated_by).toBe("__qa-editor@example.test");

    // The draft keeps the address it was reviewed with.
    const draft = (await client.query(`select recipient_email from email_drafts where id = $1`, [draftId])).rows[0];
    expect(draft.recipient_email).toBe("old@example.test");
  });

  it("refuses an edit made against an older version, naming who changed it, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/contacts/[contactId]/route");
    const current = await row(contactId);
    const res = await PATCH(patch({ version: current.version - 1, name: "__QA Overwritten" }), params(projectId, contactId));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("contact_version_stale");
    expect(body.error).toContain("__qa-editor@example.test");
    expect(await row(contactId)).toEqual(current);
  });

  it("refuses a designer code another contact already holds", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/contacts/[contactId]/route");
    const current = await row(contactId);
    const res = await PATCH(patch({ version: current.version, designerCode: "qab" }), params(projectId, contactId));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/__QA Other designer is already the default contact for QAB/);
    expect(await row(contactId)).toEqual(current);
    expect((await row(siblingId)).designer_code).toBe("QAB");
  });

  it("refuses a contact addressed through another project, and an address that is not one", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/contacts/[contactId]/route");
    const current = await row(contactId);
    const foreign = await PATCH(patch({ version: current.version, name: "__QA Hijacked" }), params(otherProjectId, contactId));
    expect(foreign.status).toBe(404);
    const bad = await PATCH(patch({ version: current.version, email: "a@b.test, c@d.test" }), params(projectId, contactId));
    expect(bad.status).toBe(400);
    expect(await row(contactId)).toEqual(current);
  });
});
