// Database tier — the overview's three new numbers, against the screens that
// already report them.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/project-payload.test.ts
//
// THE ASSERTION THAT MATTERS is not that "Owes us" is 3. It is that it is the
// same 3 the chase screen shows for the same contact, so both routes are driven
// through their REAL handlers and compared against each other. A hand count
// would pass while the two screens disagreed, which is the only failure worth
// catching here.
//
// Rows are prefixed `__QA ` and deleted FK-safe; the PROJECT goes last and
// takes its change sets with it (0014 refuses a direct delete).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Bucket = { toQuote: number; alsoOutstanding: number; noTier: number; records?: number };
type ProjectPayload = {
  ok: boolean;
  contactsOutstanding: {
    byContact: (Bucket & { contactId: string; contactName: string })[];
    unassigned: Bucket;
    noLevel: Bucket;
  };
  unlinkedFinishCodes: { code: string; records: number }[];
  failedDocuments: number;
};

type DraftsPayload = {
  ok: boolean;
  inventory: {
    groups: { contact: { id: string }; questions: { tier: string | null }[] }[];
  };
};

describeIfDb("project payload — owes us, unlinked codes, failed reads", () => {
  const client = new pg.Client({ connectionString: databaseUrl });

  let projectId = "";
  let runId = "";
  let contactId = "";
  let categoryId = "";

  async function nextRecordNo(): Promise<number> {
    const row = await client.query(
      `select coalesce(max(record_no), 0) + 1 as n from spec_records where project_id = $1`,
      [projectId],
    );
    return Number(row.rows[0].n);
  }

  beforeAll(async () => {
    await client.connect();

    const project = await client.query(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ('__QA P00098', '__QA Project payload', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;

    const run = await client.query(
      `insert into spec_runs (project_id, name, created_by, updated_by)
       values ($1, '__QA Main run', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run.rows[0].id;

    const contact = await client.query(
      `insert into project_contacts (project_id, name, email, role, designer_code, created_by, updated_by)
       values ($1, '__QA Hayley', 'hayley@example.test', 'designer', 'QAHAY', 'qa', 'qa') returning id`,
      [projectId],
    );
    contactId = contact.rows[0].id;

    const category = await client.query(
      `select c.id from item_categories c
         join requirements q on q.category_id = c.id
        group by c.id having count(q.id) >= 3
        order by c.id limit 1`,
    );
    categoryId = category.rows[0].id;

    // One record this contact owes us answers on.
    const owed = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', '__QA Armchair', 'qahay', 'qa', 'qa') returning id`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );

    // One whose designer nobody has been named for — the `unassigned` bucket.
    await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, 'complex', '__QA Stool', 'QANOBODY', 'qa', 'qa')`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );

    // One that belongs to the contact and has NO LEVEL — its own bucket,
    // because it is neither unassigned nor chaseable.
    await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, category_id, level,
                                 item_description, designer, created_by, updated_by)
       values ($1, $2, $3, 'active', $4, null, '__QA Bench', 'qahay', 'qa', 'qa')`,
      [projectId, runId, await nextRecordNo(), categoryId],
    );

    // A drawing's own finish code, carried by an attribute and linked to
    // nothing: the library has never been told what `__QAMOR005` is.
    await client.query(
      `insert into record_attributes (record_id, attr_group, label, value, material_code, state, status,
                                      sort_order, created_by, updated_by)
       values ($1, 'material', '__QA Fabric', '__QA some cloth', '__qamor005', 'confirmed', 'active', 1, 'qa', 'qa')`,
      [owed.rows[0].id],
    );

    // A document that could not be read.
    await client.query(
      `insert into intake_runs (project_id, source_kind, document_kind, status, error, created_by, updated_by)
       values ($1, 'spec_document', 'shop_drawings', 'failed', '__QA the model timed out', 'qa', 'qa')`,
      [projectId],
    );
  });

  afterAll(async () => {
    await client.query(
      `delete from record_attributes where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(
      `delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`,
      [projectId],
    );
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  async function readProject(): Promise<ProjectPayload> {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const response = await GET(new Request("http://localhost/test"), params(projectId));
    const body = (await response.json()) as ProjectPayload;
    expect(body.ok).toBe(true);
    return body;
  }

  async function readDrafts(): Promise<DraftsPayload> {
    const { GET } = await import("@/app/api/drafts/route");
    const response = await GET(new Request(`http://localhost/api/drafts?projectId=${projectId}`));
    const body = (await response.json()) as DraftsPayload;
    expect(body.ok).toBe(true);
    return body;
  }

  it("owes the same number the chase screen shows for the same contact", async () => {
    const [project, drafts] = await Promise.all([readProject(), readDrafts()]);

    const group = drafts.inventory.groups.find((g) => g.contact.id === contactId);
    expect(group).toBeTruthy();
    const row = project.contactsOutstanding.byContact.find((entry) => entry.contactId === contactId);
    expect(row).toBeTruthy();

    // The same grouping and the same tiers, reached by two routes. A copy of
    // either rule in SQL is what this would catch.
    expect(row?.toQuote).toBe(group?.questions.filter((q) => q.tier === "to_quote").length);
    expect(row?.alsoOutstanding).toBe(group?.questions.filter((q) => q.tier === "later").length);
    expect(row?.toQuote).toBeGreaterThan(0);
  });

  it("keeps unassigned and level-less apart, and neither is a contact's debt", async () => {
    const project = await readProject();
    // A designer code nobody has been named for: a real question with nobody
    // to ask, which is a blocker rather than a contact's column.
    expect(project.contactsOutstanding.unassigned.records).toBe(1);
    expect(
      project.contactsOutstanding.unassigned.toQuote + project.contactsOutstanding.unassigned.alsoOutstanding,
    ).toBeGreaterThan(0);
    // And a record with a contact and no level. Folding it into `unassigned`
    // would say nobody owns it; dropping it would leave the table short of the
    // project's own total.
    expect(project.contactsOutstanding.noLevel.records).toBe(1);
    // Its questions may be TIERED even so: where Matthew's matrix covers the
    // category it answers without a level, because his matrix carries no level
    // column. `groupByContact` still holds the record back — the level is what
    // the BWS boilerplate reads — so the bucket has to count all three columns
    // rather than assume a level-less record is untiered.
    const bucket = project.contactsOutstanding.noLevel;
    expect(bucket.toQuote + bucket.alsoOutstanding + bucket.noTier).toBeGreaterThan(0);
  });

  it("names the unlinked finish codes the library page names", async () => {
    const [project, { GET }] = await Promise.all([readProject(), import("@/app/api/projects/[id]/finishes/route")]);
    const library = (await (await GET(new Request("http://localhost/test"), params(projectId))).json()) as {
      unlinked: { code: string; records: number }[];
    };
    // One function, two screens. The codes are normalised the library's way —
    // upper-cased — so a drawing writing `__qamor005` and a schedule writing
    // `__QAMOR005` are one code on both pages.
    expect(project.unlinkedFinishCodes).toEqual(library.unlinked);
    expect(project.unlinkedFinishCodes.map((row) => row.code)).toContain("__QAMOR005");
  });

  it("counts the documents that could not be read", async () => {
    const project = await readProject();
    expect(project.failedDocuments).toBe(1);
  });
});
