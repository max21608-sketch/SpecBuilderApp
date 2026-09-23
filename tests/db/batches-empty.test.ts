// A pack with nothing in it is not a delivery.
//
// FIU 2026-09-23: a thirty-file upload onto pilot whose every classify call
// failed left two intake batches holding no document at all. The upload now
// creates a batch only when a file registers into it; this proves the batches
// route no longer LISTS one that nothing registered into, which is what the
// two already on pilot are.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

describeIfDb("the batches route", () => {
  let projectId = "";
  let emptyBatch = "";
  let fullBatch = "";
  const number = qaNumber("P90061");

  beforeAll(async () => {
    const { sql } = await import("@/lib/db");
    const rows = await sql`
      insert into projects (name, bws_project_number, created_by, updated_by)
      values (${`__QA ${number}`}, ${`__QA ${number}`}, '__qa@example.test', '__qa@example.test')
      returning id
    `;
    projectId = String(rows[0]!.id);
    const empty = await sql`
      insert into intake_batches (project_id, label, created_by, updated_by)
      values (${projectId}, '__QA empty', 'qa', 'qa') returning id
    `;
    emptyBatch = String(empty[0]!.id);
    const full = await sql`
      insert into intake_batches (project_id, label, created_by, updated_by)
      values (${projectId}, '__QA full', 'qa', 'qa') returning id
    `;
    fullBatch = String(full[0]!.id);
    await sql`
      insert into intake_runs (project_id, batch_id, source_kind, document_kind, status, created_by, updated_by)
      values (${projectId}, ${fullBatch}, 'spec_document', 'shop_drawings', 'pending', 'qa', 'qa')
    `;
  });

  afterAll(async () => {
    const { sql } = await import("@/lib/db");
    if (projectId) {
      await sql`delete from intake_runs where project_id = ${projectId}`;
      await sql`delete from intake_batches where project_id = ${projectId}`;
      await sql`delete from projects where id = ${projectId}`;
    }
  });

  it("lists a pack that holds a document and hides one that holds none", async () => {
    const { GET } = await import("@/app/api/projects/[id]/batches/route");
    const res = await GET(new Request(`http://localhost/api/projects/${projectId}/batches`), {
      params: Promise.resolve({ id: projectId }),
    });
    const body = (await res.json()) as { batches: { id: string }[] };
    const ids = body.batches.map((batch) => batch.id);
    expect(ids).toContain(fullBatch);
    expect(ids).not.toContain(emptyBatch);
  });
});
