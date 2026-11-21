// Database tier — a question answered ONCE FOR AN AREA, through the real route
// (decision C of 2026-11-20, seed 0015's `answer_scope = 'area'`).
//
// The project-wide mechanism's own rules one level down: the area is folded
// by case and whitespace only (`foldArea`), an item with no area is asked on
// its own and is on no card, the target set is re-derived under the lock and
// the write refused WHOLE if it moved, a settled different answer is never
// overwritten without a tick and a reason, and one change set writes one
// version per record with `spec_records.version` untouched.
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({
    id: "00000000-0000-0000-0000-000000000001",
    email: "__qa-area-wide@example.test",
    name: "QA User",
    role: "admin",
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Row = { recordId: string; requirementId: string; answerId: string | null; answerVersion: number | null; state: string; value: string | null };
type Question = { key: string; area: string | null; heading: string; rows: Row[]; items: number };

describeIfDb("a question answered once for an area", () => {
  const SLOW = 60_000;
  const client = new pg.Client({ connectionString: databaseUrl });
  let projectId = "";
  let runId = "";
  let categoryId = "";
  /** Restaurant (two spellings), Terrace, and no area at all. */
  let restaurant1 = "";
  let restaurant2 = "";
  let terrace = "";
  let nowhere = "";

  async function cards(): Promise<Question[]> {
    const { GET } = await import("@/app/api/projects/[id]/area-wide/route");
    const body = (await (await GET(new Request("http://localhost/test"), params(projectId))).json()) as { questions: Question[] };
    return body.questions.filter((question) => question.key.endsWith("field:130"));
  }
  const cardFor = async (area: string) => (await cards()).find((question) => question.area?.toLowerCase() === area.toLowerCase())!;

  async function answer(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/projects/[id]/area-wide/route");
    const response = await POST(
      new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      params(projectId),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const seen = (question: Question) =>
    question.rows.map((row) => ({ recordId: row.recordId, requirementId: row.requirementId, answerId: row.answerId, version: row.answerVersion }));

  async function record(no: number, area: string | null): Promise<string> {
    const id = (
      await client.query(
        `insert into spec_records (project_id, run_id, record_no, status, category_id, item_description, level, area, created_by, updated_by)
         values ($1, $2, $3, 'active', $4, '__QA Chair', 'simple', $5, 'qa', 'qa') returning id`,
        [projectId, runId, no, categoryId, area],
      )
    ).rows[0].id as string;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
       select $1, q.id, q.spec_field_id, 'missing', 'manual', 'qa', 'qa' from requirements q where q.category_id = $2`,
      [id, categoryId],
    );
    return id;
  }

  async function outdoor(recordId: string) {
    return (
      await client.query(
        `select a.id, a.state, a.value, a.source_kind from spec_answers a
           join requirements q on q.id = a.requirement_id join spec_fields f on f.id = q.spec_field_id
          where a.record_id = $1 and f.json_id = 130 and a.revision_no = 0`,
        [recordId],
      )
    ).rows[0];
  }

  beforeAll(async () => {
    await client.connect();
    projectId = (
      await client.query(`insert into projects (bws_project_number, name, created_by, updated_by) values ($1, '__QA Area-wide', 'qa', 'qa') returning id`, [
        qaNumber("P90064"),
      ])
    ).rows[0].id;
    runId = (
      await client.query(`insert into spec_runs (project_id, name, sort_order, created_by, updated_by) values ($1, '__QA run', 1, 'qa', 'qa') returning id`, [
        projectId,
      ])
    ).rows[0].id;
    // By slug, never uuid order. Seed 0015 makes Indoor/Outdoor an area question on every sheet.
    categoryId = (await client.query(`select id from item_categories where slug = 'dining-chair'`)).rows[0].id;
    restaurant1 = await record(1, "Restaurant");
    restaurant2 = await record(2, "  RESTAURANT ");
    terrace = await record(3, "Terrace");
    nowhere = await record(4, null);
  }, SLOW);

  afterAll(async () => {
    await client.query(`delete from spec_answers where record_id in (select id from spec_records where project_id = $1)`, [projectId]);
    await client.query(`delete from spec_records where project_id = $1`, [projectId]);
    await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
    await client.query(`delete from projects where id = $1`, [projectId]);
    await client.end();
  }, SLOW);

  it("is ONE card per area, folded by case and space, and an item with no area is on none", async () => {
    const all = await cards();
    expect(all).toHaveLength(2);
    const r = await cardFor("restaurant");
    expect(r.area).toBe("Restaurant");
    expect(r.items).toBe(2);
    expect(r.rows.map((row) => row.recordId).sort()).toEqual([restaurant1, restaurant2].sort());
    expect(all.flatMap((question) => question.rows.map((row) => row.recordId))).not.toContain(nowhere);
  });

  it("refuses WHOLE when the area's items moved since the card loaded, and writes nothing", async () => {
    const before = await cardFor("restaurant");
    const late = await record(5, "restaurant");
    try {
      const result = await answer({ key: before.key, value: "Indoor", state: "confirmed", seen: seen(before) });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("project_wide_moved");
      expect((await outdoor(restaurant1)).state).toBe("missing");
    } finally {
      await client.query(`delete from spec_answers where record_id = $1`, [late]);
      await client.query(`delete from spec_records where id = $1`, [late]);
    }
  });

  it("writes every item in the area under ONE change set, ONE version each, and leaves the other areas and the record alone", async () => {
    const question = await cardFor("restaurant");
    const versionsBefore = (await client.query(`select id, version from spec_records where project_id = $1 order by id`, [projectId])).rows;
    const result = await answer({ key: question.key, value: "Indoor", state: "confirmed", seen: seen(question) });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ written: 2, overridden: 0, records: 2 });
    for (const id of [restaurant1, restaurant2]) expect(await outdoor(id)).toMatchObject({ state: "confirmed", value: "Indoor", source_kind: "manual" });
    expect((await outdoor(terrace)).state).toBe("missing");
    expect((await outdoor(nowhere)).state).toBe("missing");
    const snapshots = await client.query(`select record_id from record_snapshots where change_set_id = $1`, [String(result.body.changeSetId)]);
    expect(snapshots.rows.map((row) => row.record_id).sort()).toEqual([restaurant1, restaurant2].sort());
    const reason = (await client.query(`select reason from change_sets where id = $1`, [String(result.body.changeSetId)])).rows[0].reason;
    expect(String(reason)).toMatch(/for Restaurant/);
    expect((await client.query(`select id, version from spec_records where project_id = $1 order by id`, [projectId])).rows).toEqual(versionsBefore);
  });

  it("leaves a settled, different answer in the area alone unless ticked, and a tick needs a reason", async () => {
    const question = await cardFor("restaurant");
    const one = question.rows.find((row) => row.recordId === restaurant1)!;
    const untouched = await answer({ key: question.key, value: "Outdoor", state: "confirmed", seen: seen(question) });
    expect(untouched.status).toBe(409);
    expect(untouched.body.code).toBe("nothing_to_apply");
    const refused = await answer({ key: question.key, value: "Outdoor", state: "confirmed", seen: seen(question), overrides: [one.answerId] });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("reason_required");
    expect((await outdoor(restaurant1)).value).toBe("Indoor");
  });

  // CHASE REVIEW C4, 2026-11-21: the area's set was re-derived under the
  // PROJECT lock, but an area edit takes only the RECORD's lock — so an item
  // moved to another area between the fan-out's read and its record locks got
  // the old area's answer. The records are now locked (id order) BEFORE the
  // set is read again. Forced, never raced: a second connection moves the
  // item and holds its lock; the press is let go only once it is waiting.
  it("never writes the old area's answer to an item moved out of it while the press waited", async () => {
    const lounge1 = await record(21, "Lounge");
    const lounge2 = await record(22, "Lounge");
    const mover = new pg.Client({ connectionString: databaseUrl });
    await mover.connect();
    try {
      const card = await cardFor("lounge");
      expect(card.items).toBe(2);
      const moverPid = Number((await mover.query(`select pg_backend_pid() as pid`)).rows[0].pid);
      await mover.query("begin");
      await mover.query(`update spec_records set area = 'Terrace', updated_by = 'qa' where id = $1`, [lounge1]);
      const press = answer({ key: card.key, value: "Indoor", state: "confirmed", seen: seen(card) });
      const deadline = Date.now() + 15_000;
      for (;;) {
        const waiting = await client.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [moverPid]);
        if (waiting.rows[0].n > 0) break;
        if (Date.now() > deadline) throw new Error("the press never waited on the moved item");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await mover.query("commit");
      const result = await press;
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("project_wide_moved");
      expect((await outdoor(lounge1)).state).toBe("missing");
      expect((await outdoor(lounge2)).state).toBe("missing");
    } finally {
      await mover.query("rollback").catch(() => undefined);
      await mover.end();
      await client.query(`delete from spec_answers where record_id = any($1::uuid[])`, [[lounge1, lounge2]]);
      await client.query(`delete from spec_records where id = any($1::uuid[])`, [[lounge1, lounge2]]);
    }
  }, SLOW);
});
