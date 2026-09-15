// Database tier — the project overview's read and write, through the REAL route.
//
// Skips silently without DATABASE_URL. A green `npm test` in CI does not mean
// these ran; run them with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// What is worth testing here rather than in the pure tier: the date set is
// validated MERGED OVER WHAT IS STORED, so a request that sends one date can
// still be refused by the two it did not send. That merge only exists in the
// route, and a pure test of validateProgramme cannot see it.
//
// Rows are prefixed `__QA ` and deleted FK-safe. audit_log is left alone.
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

function patch(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describeIfDb("project overview", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";

  async function stored() {
    // ::text, not the driver's Date. `pg` parses a date column into LOCAL
    // midnight, so toISOString() reads the day before it in British Summer
    // Time -- which is how the route's own round-trip bug hid, and how this
    // test would have hidden it a second time.
    const rows = await client.query(
      `select name, client, shared_inbox, default_dimension_unit,
              status, archived_at, archived_by,
              order_date::text as order_date,
              specs_agreed_by::text as specs_agreed_by,
              delivery_date::text as delivery_date,
              version
         from projects where id = $1`,
      [projectId],
    );
    return rows.rows[0];
  }

  const iso = (value: string | null) => value;

  beforeAll(async () => {
    await client.connect();
    const project = await client.query(
      `insert into projects (bws_project_number, name, client, created_by, updated_by)
       values ('__QA P90002', '__QA Overview project', '__QA Client', 'qa', 'qa') returning id`,
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    // Children first: intake_runs.batch_id is `on delete restrict`, so a batch
    // cannot be removed while a run still points at it.
    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_batches where project_id = $1`, [projectId]);
    await client.query(`delete from project_contacts where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("reads the project and its documents", async () => {
    const { GET } = await import("@/app/api/projects/[id]/route");
    const body = await (await GET(new Request("http://localhost/test"), params(projectId))).json();
    expect(body.ok).toBe(true);
    expect(body.project.bws_project_number).toBe("__QA P90002");
    expect(body.project.specs_agreed_by).toBeNull();
    expect(Array.isArray(body.documents)).toBe(true);
  });

  it("says which PACK each document arrived in, and tolerates one that has none", async () => {
    // The overview groups documents by delivery so that the pack screens --
    // including the only one that can see a record described by two documents
    // -- are reachable at all. Without the batch on each run it could only
    // list them flat, which is how both screens became unreachable.
    const batch = await client.query(
      `insert into intake_batches (project_id, label, created_by, updated_by)
       values ($1, '__QA 2 documents', 'qa', 'qa') returning id`,
      [projectId],
    );
    const batchId = batch.rows[0].id;
    const inPack = await client.query(
      `insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
       values ($1, $2, 'spec_document', 'shop_drawings', 'pending', 'qa', 'qa') returning id`,
      [projectId, batchId],
    );
    // Pre-0007, and it must still appear: it is a document somebody imported.
    const loose = await client.query(
      `insert into intake_runs (project_id, source_kind, status, created_by, updated_by)
       values ($1, 'boq_xlsx', 'parsed', 'qa', 'qa') returning id`,
      [projectId],
    );

    const { GET } = await import("@/app/api/projects/[id]/route");
    const body = await (await GET(new Request("http://localhost/test"), params(projectId))).json();
    const rows = body.documents as { id: string; batch_id: string | null; batch_label: string | null }[];

    const grouped = rows.find((row) => row.id === inPack.rows[0].id);
    expect(grouped?.batch_id).toBe(batchId);
    expect(grouped?.batch_label).toBe("__QA 2 documents");

    const ungrouped = rows.find((row) => row.id === loose.rows[0].id);
    expect(ungrouped).toBeDefined();
    expect(ungrouped?.batch_id).toBeNull();

    await client.query(`delete from intake_runs where project_id = $1`, [projectId]);
    await client.query(`delete from intake_batches where id = $1`, [batchId]);
  });

  it("stores the three TOE dates as days", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({
        version: before.version,
        orderDate: "2026-02-17",
        specsAgreedBy: "2026-04-01",
        deliveryDate: "2026-06-17",
      }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.project.specs_agreed_by).toBe("2026-04-01");

    const after = await stored();
    expect(iso(after.order_date)).toBe("2026-02-17");
    expect(iso(after.specs_agreed_by)).toBe("2026-04-01");
    expect(iso(after.delivery_date)).toBe("2026-06-17");
    expect(after.version).toBe(before.version + 1);
  });

  // The regression for the day-shift: a PATCH that does not mention the dates
  // still rewrites them, because every field is written on every save. Before
  // the ::text fix this moved each date one day earlier per save.
  it("leaves unsent fields alone", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, client: "__QA New client" }), params(projectId));
    expect(res.status).toBe(200);

    const after = await stored();
    expect(after.client).toBe("__QA New client");
    expect(after.name).toBe(before.name);
    expect(iso(after.specs_agreed_by)).toBe("2026-04-01");
  });

  // The merge case. One date is sent; the two stored ones make the set invalid.
  it("refuses a single date that contradicts the stored ones, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, orderDate: "2026-07-01" }), params(projectId));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/after the/);

    const after = await stored();
    expect(iso(after.order_date)).toBe("2026-02-17");
    expect(after.version).toBe(before.version);
  });

  it("refuses the BWS project number by name, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({ version: before.version, bwsProjectNumber: "__QA P99999" }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/cannot be changed/);

    const rows = await client.query(`select bws_project_number, version from projects where id = $1`, [
      projectId,
    ]);
    expect(rows.rows[0].bws_project_number).toBe("__QA P90002");
    expect(rows.rows[0].version).toBe(before.version);
  });

  // ---- the project's default dimension unit --------------------------------

  it("stores a default dimension unit, in the spelling the app uses", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    // Through normaliseUnit, so a person typing "CM" is not told it is invalid.
    const res = await PATCH(patch({ version: before.version, defaultDimensionUnit: "CM" }), params(projectId));
    expect(res.status).toBe(200);
    expect((await stored()).default_dimension_unit).toBe("cm");
  });

  it("refuses a unit it does not know, and writes nothing", async () => {
    // "cms" is close enough to look right and would reach the check constraint
    // as a 500. It is refused here with a sentence naming the four that work.
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, defaultDimensionUnit: "cms" }), params(projectId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/mm, cm, m, in/);
    expect((await stored()).default_dimension_unit).toBe(before.default_dimension_unit);
  });

  it("clears the default with an explicit null, which is a real answer", async () => {
    // Unset means "ask me per dimension" -- the behaviour before the setting
    // existed -- and a project must be able to go back to it.
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    await PATCH(patch({ version: (await stored()).version, defaultDimensionUnit: "mm" }), params(projectId));
    expect((await stored()).default_dimension_unit).toBe("mm");

    const res = await PATCH(patch({ version: (await stored()).version, defaultDimensionUnit: null }), params(projectId));
    expect(res.status).toBe(200);
    expect((await stored()).default_dimension_unit).toBeNull();
  });

  it("leaves the unit alone when a save does not mention it", async () => {
    // Same trap as the dates: every column is written on every save.
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    await PATCH(patch({ version: (await stored()).version, defaultDimensionUnit: "cm" }), params(projectId));
    // Deliberately NOT `client` or a date: the tests in this file share one
    // project row and assert on those, so touching them here would make this
    // test's side effect somebody else's failure.
    const res = await PATCH(
      patch({ version: (await stored()).version, sharedInbox: "__qa-units@example.com" }),
      params(projectId),
    );
    expect(res.status).toBe(200);
    expect((await stored()).default_dimension_unit).toBe("cm");
  });

  // ---- archived, never deleted ---------------------------------------------

  it("archives a project with an actor and a date, and restores it", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    expect((await stored()).status).toBe("active");

    const archive = await PATCH(patch({ status: "archived", version: (await stored()).version }), params(projectId));
    expect(archive.status).toBe(200);

    let after = await stored();
    expect(after.status).toBe("archived");
    // The constraint refuses an archived row with no actor -- "who archived
    // this, and when" must be answerable later.
    expect(after.archived_at).toBeTruthy();
    expect(after.archived_by).toBeTruthy();

    const restore = await PATCH(patch({ status: "active", version: after.version }), params(projectId));
    expect(restore.status).toBe(200);
    after = await stored();
    expect(after.status).toBe("active");
    // Cleared, so a project archived twice carries the second date, not the first.
    expect(after.archived_at).toBeNull();
    expect(after.archived_by).toBeNull();
  });

  it("does not re-stamp the archive date on a later unrelated save", async () => {
    // Every column is written on every save, which is the trap that moved the
    // TOE dates a day earlier each time. An archived project edited afterwards
    // must keep the moment it was actually archived.
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    await PATCH(patch({ status: "archived", version: (await stored()).version }), params(projectId));
    const archivedAt = (await stored()).archived_at;
    expect(archivedAt).toBeTruthy();

    const res = await PATCH(
      patch({ client: "__QA Archived client", version: (await stored()).version }),
      params(projectId),
    );
    expect(res.status).toBe(200);
    const after = await stored();
    expect(after.status).toBe("archived");
    expect(new Date(after.archived_at).toISOString()).toBe(new Date(archivedAt).toISOString());

    await PATCH(patch({ status: "active", version: after.version }), params(projectId));
    await PATCH(patch({ client: "__QA New client", version: (await stored()).version }), params(projectId));
  });

  it("refuses a status the vocabulary does not have, and writes nothing", async () => {
    // `retired` is what a run and a note are. A project is not, and letting it
    // through would write a value the check constraint refuses.
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ status: "retired", version: before.version }), params(projectId));
    expect(res.status).toBe(400);
    expect((await stored()).status).toBe(before.status);
  });

  it("hides an archived project from the list unless it is asked for", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const { GET } = await import("@/app/api/projects/route");
    const ids = async (url: string) =>
      ((await (await GET(new Request(url))).json()).projects as { id: string }[]).map((p) => p.id);

    expect(await ids("http://localhost/api/projects")).toContain(projectId);

    await PATCH(patch({ status: "archived", version: (await stored()).version }), params(projectId));
    expect(await ids("http://localhost/api/projects")).not.toContain(projectId);
    expect(await ids("http://localhost/api/projects?includeArchived=true")).toContain(projectId);

    await PATCH(patch({ status: "active", version: (await stored()).version }), params(projectId));
    expect(await ids("http://localhost/api/projects")).toContain(projectId);
  });

  it("refuses an unknown field, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, budget: 1000 }), params(projectId));
    expect(res.status).toBe(400);
    expect((await stored()).version).toBe(before.version);
  });

  it("conflicts on a stale version, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(
      patch({ version: before.version - 1, client: "__QA Stale write" }),
      params(projectId),
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("project_version_stale");

    const after = await stored();
    expect(after.client).toBe("__QA New client");
    expect(after.version).toBe(before.version);
  });

  it("clears a date with an explicit null", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, deliveryDate: null }), params(projectId));
    expect(res.status).toBe(200);
    expect(iso((await stored()).delivery_date)).toBeNull();
  });

  it("refuses a date that is not a real day, and writes nothing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version, deliveryDate: "2026-02-30" }), params(projectId));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not a real date/);
    expect((await stored()).version).toBe(before.version);
  });

  it("refuses an empty change", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const before = await stored();
    const res = await PATCH(patch({ version: before.version }), params(projectId));
    expect(res.status).toBe(400);
    expect((await stored()).version).toBe(before.version);
  });
});
