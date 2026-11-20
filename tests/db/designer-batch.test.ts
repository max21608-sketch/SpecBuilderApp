// Database tier — "Set designer…" on a phase's ticked items (2026-11-20, U2).
//
//   node --env-file=.env.localstack.local ~/dev/localstack/db-test-shared.mjs tests/db/designer-batch.test.ts
//
// What it holds:
//  - every item is written through `editRecordDetails`, the record Edit
//    panel's own path: its version moves, its change set says "Edited
//    designer", its audit rows and its version (snapshot) exist;
//  - one change set PER RECORD, because that function opens its own;
//  - a stale, a retired and another project's item are refused one by one,
//    in words, and cost the others nothing — and a refused one leaves no
//    change set behind (its savepoint rolled back);
//  - a line's configurations follow it where they had no designer, and one
//    with a designer of its own is kept and named.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";
import { deleteProjectRows } from "../../db/project-delete.mjs";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-4000-8000-0000000000d2",
    email: "__qa-designer-batch@example.test",
    name: "QA User",
    role: "editor",
  }),
}));

const ACTOR = "__qa-designer-batch@example.test";

describeIfDb("POST /api/projects/[id]/designer", () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let projectId = "";
  let otherProjectId = "";
  let runId = "";
  const ids: Record<string, string> = {};

  async function record(
    key: string,
    no: number,
    over: { designer?: string | null; status?: string; parent?: string; label?: string; project?: string; run?: string } = {},
  ) {
    const row = await client.query(
      `insert into spec_records (project_id, run_id, record_no, status, item_description, designer,
                                 parent_id, depth, split_reason, variant_label, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qa', 'qa') returning id`,
      [
        over.project ?? projectId,
        over.run ?? runId,
        no,
        over.status ?? "active",
        `__QA item ${key}`,
        over.designer ?? null,
        over.parent ?? null,
        over.parent ? 1 : 0,
        over.parent ? "fabric" : null,
        over.label ?? null,
      ],
    );
    ids[key] = row.rows[0].id;
    return row.rows[0].id as string;
  }

  async function state(key: string) {
    const row = await client.query(`select designer, version from spec_records where id = $1`, [ids[key]]);
    return row.rows[0] as { designer: string | null; version: number };
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA designer batch', 'qa', 'qa') returning id`,
        [qaNumber("P90410")],
      )
    ).rows[0].id;
    otherProjectId = (
      await client.query(
        `insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA designer batch other', 'qa', 'qa') returning id`,
        [qaNumber("P90411")],
      )
    ).rows[0].id;
    runId = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Main phase', 'qa', 'qa') returning id`,
        [projectId],
      )
    ).rows[0].id;
    const otherRun = (
      await client.query(
        `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA Their phase', 'qa', 'qa') returning id`,
        [otherProjectId],
      )
    ).rows[0].id;

    await record("plain", 1);
    const split = await record("split", 2);
    await record("empty config", 3, { parent: split, label: "A" });
    await record("own config", 4, { parent: split, label: "B", designer: "TH" });
    await record("already", 5, { designer: "LCS" });
    await record("stale", 6);
    await record("retired", 7);
    await client.query(
      `update spec_records set status = 'retired', retired_at = now(), retired_by = 'qa', updated_by = 'qa' where id = $1`,
      [ids.retired],
    );
    await record("theirs", 1, { project: otherProjectId, run: otherRun });
  });

  afterAll(async () => {
    if (projectId) await deleteProjectRows(client, projectId).catch(() => undefined);
    if (otherProjectId) await deleteProjectRows(client, otherProjectId).catch(() => undefined);
    await client.end();
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/projects/[id]/designer/route");
    return POST(
      new Request("http://localhost/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
  }

  it("sets the ticked items through the Edit panel's path, refuses the rest one by one, and says which", async () => {
    const before = Object.fromEntries(
      await Promise.all(Object.keys(ids).map(async (key) => [key, await state(key)] as const)),
    );
    const res = await post({
      designer: "  LCS ",
      records: [
        { id: ids.plain, version: before.plain!.version },
        { id: ids.split, version: before.split!.version },
        { id: ids.already, version: before.already!.version },
        // The screen loaded an older version than the row holds now.
        { id: ids.stale, version: before.stale!.version + 3 },
        { id: ids.retired, version: before.retired!.version },
        { id: ids.theirs, version: before.theirs!.version },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      designer: string;
      set: number;
      unchanged: number;
      configurations: number;
      keptOwn: { label: string; designer: string }[];
      refused: { recordId: string; label: string | null; code: string; error: string }[];
      message: string;
    };
    expect(body.ok).toBe(true);
    expect(body.designer).toBe("LCS");
    expect(body.set).toBe(2);
    expect(body.unchanged).toBe(1);
    expect(body.configurations).toBe(1);
    expect(body.keptOwn).toEqual([expect.objectContaining({ designer: "TH" })]);
    expect(body.message).toMatch(/^LCS set on 2 items and 1 configuration of theirs\./);
    expect(body.message).toMatch(/1 item already had it\./);
    expect(body.message).toMatch(/1 configuration kept a designer of its own\./);
    expect(body.message).toMatch(/3 items not changed — listed below\./);

    const refused = new Map(body.refused.map((row) => [row.recordId, row]));
    expect(refused.get(ids.stale!)).toEqual(
      expect.objectContaining({ code: "record_version_stale", error: expect.stringMatching(/-006: This item changed since this screen loaded/) }),
    );
    expect(refused.get(ids.retired!)).toEqual(expect.objectContaining({ code: "record_not_live" }));
    // Another project's item is refused WITHOUT its label.
    expect(refused.get(ids.theirs!)).toEqual(expect.objectContaining({ code: "record_not_on_project", label: null }));

    // What the table holds now.
    expect((await state("plain")).designer).toBe("LCS");
    expect((await state("split")).designer).toBe("LCS");
    expect((await state("empty config")).designer).toBe("LCS");
    expect((await state("own config")).designer).toBe("TH");
    expect((await state("stale")).designer).toBeNull();
    expect((await state("retired")).designer).toBeNull();
    expect((await state("theirs")).designer).toBeNull();
    expect((await state("plain")).version).toBe(before.plain!.version + 1);
    expect((await state("stale")).version).toBe(before.stale!.version);

    // ONE CHANGE SET PER RECORD written, each the Edit panel's own, and none
    // for a refused one.
    const changes = await client.query(
      `select kind, reason, actor from change_sets where project_id = $1 order by created_at`,
      [projectId],
    );
    const written = [ids.plain, ids.split, ids["empty config"]];
    // Three: the two lines and the configuration that followed. The one that
    // already had LCS records nothing, as the Edit panel's no-op does not.
    expect(changes.rows).toHaveLength(written.length);
    for (const change of changes.rows) {
      expect(change).toEqual({ kind: "manual_edit", reason: "Edited designer", actor: ACTOR });
    }

    // A VERSION of each written record, and audit rows under its change set.
    for (const recordId of written) {
      const versions = await client.query(
        `select s.change_set_id from record_snapshots s where s.record_id = $1`,
        [recordId],
      );
      expect(versions.rows.length, recordId).toBe(1);
      const audited = await client.query(
        `select count(*)::int as n from audit_log
          where table_name = 'spec_records' and row_id = $1::text and change_set_id = $2`,
        [recordId, versions.rows[0].change_set_id],
      );
      expect(audited.rows[0].n, recordId).toBeGreaterThan(0);
    }
    const staleVersions = await client.query(`select count(*)::int as n from record_snapshots where record_id = $1`, [ids.stale]);
    expect(staleVersions.rows[0].n).toBe(0);
  });

  it("refuses a request with no designer, in words, and writes nothing", async () => {
    const before = await state("stale");
    const res = await post({ designer: "   ", records: [{ id: ids.stale, version: before.version }] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body).toEqual(expect.objectContaining({ ok: false, code: "designer_required", error: "Type the designer code to set." }));
    expect(await state("stale")).toEqual(before);
  });

  it("refuses an empty selection as a whole", async () => {
    const res = await post({ designer: "LCS", records: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("designer_request_invalid");
  });
});
