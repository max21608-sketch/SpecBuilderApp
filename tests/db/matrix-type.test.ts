// Database tier — accepting an item's gate-model TYPE (0061, decision B), and
// what follows it: the category it belongs to, a configuration under it, and
// the version that records it.
//
// THE GATE. The suggestion is computed and never stored, so the route
// re-derives it under the lock and refuses the whole press if anything moved.
// A type is a person's decision; nothing here writes one unseen.
//
// Rows are `__QA `-prefixed and deleted FK-safe. audit_log is left alone.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-matrix-type@example.test",
    name: "QA User",
    role: "admin",
  }),
}));
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { withTransaction } from "@/lib/db-transaction";
import { setRecordCategory } from "@/lib/record-category";
import { insertVariant } from "@/lib/variant-create";
import { loadRecordAtoms } from "@/lib/record-atoms";
import { diffSnapshots, parseAtoms } from "@/lib/snapshot-diff";
import { sql } from "@/lib/db";

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfDb("accepting a suggested matrix type", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let sheetId = "";

  async function record(description: string, slug = "armchairs-benches-stools-sofas"): Promise<{ id: string; version: number }> {
    // Allocated from the database: insertVariant takes max + 1 too.
    const row = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, category_id, item_description, status,
                                   created_by, updated_by)
         select $1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
                c.id, $3, 'active', 'qa', 'qa' from item_categories c where c.slug = $4
         returning id, version`,
        [projectId, runId, description, slug],
      )
    ).rows[0]!;
    return { id: String(row.id), version: Number(row.version) };
  }
  const state = async (id: string) =>
    (await client.query(`select matrix_type, version from spec_records where id = $1`, [id])).rows[0] as {
      matrix_type: string | null;
      version: number;
    };
  async function press(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const { POST } = await import("@/app/api/projects/[id]/matrix-types/route");
    const response = await POST(
      new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) }),
      params(projectId),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by)
         values ($1, '__QA Matrix types', 'qa', 'qa') returning id`,
        [qaNumber("P90062")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    sheetId = (await client.query(`select id from item_categories where slug = 'armchairs-benches-stools-sofas'`)).rows[0].id;
  });

  afterAll(async () => {
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [
      projectId,
    ]);
    await client.query(`delete from spec_records where project_id = $1 and parent_id is not null`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    // The change sets and versions go with the project.
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  });

  it("accepting two suggestions writes both under ONE change set, one version each", async () => {
    const sofa = await record("__QA Three seat sofa");
    const chair = await record("__QA Lobby armchair");
    const result = await press({
      mode: "accept",
      records: [
        { id: sofa.id, version: sofa.version, matrixType: "S" },
        { id: chair.id, version: chair.version, matrixType: "A" },
      ],
    });
    expect(result).toMatchObject({ status: 200, body: { ok: true, set: 2 } });
    expect((await state(sofa.id)).matrix_type).toBe("S");
    expect((await state(chair.id)).matrix_type).toBe("A");
    const versions = await client.query(
      `select s.record_id, s.change_set_id, c.kind
         from record_snapshots s join change_sets c on c.id = s.change_set_id
        where s.record_id = any($1::uuid[])`,
      [[sofa.id, chair.id]],
    );
    expect(versions.rows).toHaveLength(2);
    expect(new Set(versions.rows.map((row) => row.change_set_id)).size).toBe(1);
    expect(versions.rows[0]!.kind).toBe("category_set");
  });

  it("a record that moved refuses the WHOLE press, with nothing written", async () => {
    const sofa = await record("__QA Two seat sofa");
    const bench = await record("__QA End of bed bench");
    await client.query(`update spec_records set area = '__QA Lobby', updated_by = 'qa' where id = $1`, [bench.id]);
    const result = await press({
      mode: "accept",
      records: [
        { id: sofa.id, version: sofa.version, matrixType: "S" },
        { id: bench.id, version: bench.version, matrixType: "B" },
      ],
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("matrix_type_stale");
    expect((await state(sofa.id)).matrix_type).toBeNull();
    expect((await state(bench.id)).matrix_type).toBeNull();
  });

  it("an accept the server would not suggest is refused: the suggestion is re-derived, never trusted", async () => {
    const sofa = await record("__QA Sofa bench"); // names two types: no suggestion
    const result = await press({ mode: "accept", records: [{ id: sofa.id, version: sofa.version, matrixType: "S" }] });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("matrix_type_suggestion_moved");
    expect((await state(sofa.id)).matrix_type).toBeNull();
  });

  it("a person may choose a type the sheet maps, or clear it; never one it does not", async () => {
    const piece = await record("__QA Sofa bench");
    const refused = await press({ mode: "set", records: [{ id: piece.id, version: piece.version, matrixType: "D" }] });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("matrix_type_unknown");
    const chosen = await press({ mode: "set", records: [{ id: piece.id, version: piece.version, matrixType: "B" }] });
    expect(chosen.status).toBe(200);
    const after = await state(piece.id);
    expect(after.matrix_type).toBe("B");
    const cleared = await press({ mode: "set", records: [{ id: piece.id, version: Number(after.version), matrixType: null }] });
    expect(cleared.status).toBe(200);
    expect((await state(piece.id)).matrix_type).toBeNull();
  });

  it("a one-type sheet has no type to choose", async () => {
    const side = await record("__QA Side table", "side-coffee-bedside-tables");
    const result = await press({ mode: "set", records: [{ id: side.id, version: side.version, matrixType: "ST" }] });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("matrix_type_not_offered");
  });

  it("changing the category clears the type, because the old sheet's type means nothing on the new one", async () => {
    const sofa = await record("__QA Lobby sofa");
    await press({ mode: "accept", records: [{ id: sofa.id, version: sofa.version, matrixType: "S" }] });
    const other = (await client.query(`select id from item_categories where slug = 'sofas-bed-daybeds'`)).rows[0].id;
    const { version } = await state(sofa.id);
    await withTransaction((txn) =>
      setRecordCategory(txn, { recordId: sofa.id, categoryId: String(other), expectedVersion: Number(version), actor: "qa" }),
    );
    expect((await state(sofa.id)).matrix_type).toBeNull();
  });

  it("a configuration inherits its line's type, as it inherits the level", async () => {
    const sofa = await record("__QA Corner sofa");
    await press({ mode: "accept", records: [{ id: sofa.id, version: sofa.version, matrixType: "S" }] });
    const child = await withTransaction((txn) =>
      insertVariant(txn, { parentId: sofa.id, label: "A", splitReason: "fabric", dimensionNote: null, actor: "qa" }),
    );
    expect((await state(child.recordId)).matrix_type).toBe("S");
  });

  // THE RECORD PAGE OFFERS WHAT THE ROUTE WOULD WRITE, AND NOTHING ELSE
  // (review 1, finding 5). `setMatrixTypes` refuses a retired item and a
  // split line's heading ("no longer a live item… Reload"), so a suggestion
  // or a "Choose type" there repeated that refusal after every reload. The
  // list route already gated it; the record route now does the same.
  async function recordPayload(id: string): Promise<Record<string, unknown>> {
    const { GET } = await import("@/app/api/records/[id]/route");
    return (await (await GET(new Request("http://localhost/test"), params(id))).json()) as Record<string, unknown>;
  }

  it("the record page offers a type on a live item (the control the next two cases depend on)", async () => {
    const sofa = await record("__QA Reading room sofa");
    const payload = await recordPayload(sofa.id);
    expect(payload.matrixType).toMatchObject({ accepted: null, suggestion: { code: "S" } });
    expect((payload.matrixType as { options: unknown[] }).options.length).toBeGreaterThan(1);
  });

  it("the record page offers no type suggestion and no choice on a retired item", async () => {
    const sofa = await record("__QA Retired sofa");
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa'
        where id = $1`,
      [sofa.id],
    );
    expect((await recordPayload(sofa.id)).matrixType).toBeNull();
  });

  it("the record page offers no type on a split line's heading, only on its configurations", async () => {
    const sofa = await record("__QA Split sofa");
    const child = await withTransaction((txn) =>
      insertVariant(txn, { parentId: sofa.id, label: "A", splitReason: "fabric", dimensionNote: null, actor: "qa" }),
    );
    expect((await recordPayload(sofa.id)).matrixType).toBeNull();
    expect((await recordPayload(child.recordId)).matrixType).toMatchObject({ suggestion: { code: "S" } });
  });

  it("a retired item keeps showing the type a person accepted, with nothing to change it with", async () => {
    const sofa = await record("__QA Typed then retired sofa");
    await press({ mode: "accept", records: [{ id: sofa.id, version: sofa.version, matrixType: "S" }] });
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa'
        where id = $1`,
      [sofa.id],
    );
    expect((await recordPayload(sofa.id)).matrixType).toMatchObject({ accepted: { code: "S" }, suggestion: null, options: [] });
  });

  it("the version records the type, and a diff names it", async () => {
    const chair = await record("__QA Club armchair");
    const before = (await loadRecordAtoms(sql, [chair.id])).get(chair.id)!;
    expect(before.matrixType ?? null).toBeNull();
    await press({ mode: "accept", records: [{ id: chair.id, version: chair.version, matrixType: "A" }] });
    const after = (await loadRecordAtoms(sql, [chair.id])).get(chair.id)!;
    expect(after.matrixType).toBe("A");
    const diff = diffSnapshots(parseAtoms(before), parseAtoms(after));
    expect(diff.core.map((row) => row.label)).toContain("Type");
    expect(sheetId).toBeTruthy();
  });
});
