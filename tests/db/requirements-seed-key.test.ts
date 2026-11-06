// Database tier — 0057: the requirements seed matches a question by what it
// IS, not by where it sits, and refuses to change the meaning of one somebody
// has answered.
//
// ============================================================================
// INSERTING ONE QUESTION WOULD HAVE REWRITTEN EVERY QUESTION BELOW IT (B7).
//
// The three requirement seeds upserted on `(category_id, sort_order)`. A cheat
// sheet revised with one question added at position 21 would then, on the
// next `db:seed`, write the NEW question's prompt over the row that used to be
// 21, that row's prompt over 22, and so on down the sheet -- and every answer
// on those rows would silently become an answer to a different question. The
// composite FK on (requirement, field) catches a FIELD moving, loudly; a
// prompt moving was silent.
//
// The fixture category here is this process's own (`__QA `), and the seed
// shape is exercised on it with a statement written exactly like the seeds'.
// The real seed files are also run twice, against the real categories, to
// hold that a re-seed changes nothing.
// ============================================================================
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { describeIfDb, qaNumber } from "./db-tier";

const databaseUrl = process.env.DATABASE_URL;
const SEEDS = ["0003_requirements.sql", "0007_requirements_gate_fields.sql", "0009_requirements_local_keys.sql"];

type SeedRow = { key: string; prompt: string; sort: number };

describeIfDb("0057 the requirements seed key", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  let categoryId = "";
  let projectId = "";
  let runId = "";

  beforeAll(async () => {
    await client.connect();
    const { rows: category } = await client.query<{ id: string }>(
      `insert into item_categories (slug, family, name, requirements_authored, sort_order, created_by, updated_by)
       values ($1, 'upholstery', $2, true, 9002, 'qa', 'qa') returning id`,
      [qaNumber("seed-key-category").toLowerCase().replace(/\s+/g, "-"), qaNumber("Seed key category")],
    );
    categoryId = category[0]!.id;
    const { rows: project } = await client.query<{ id: string }>(
      `insert into projects (bws_project_number, name, created_by, updated_by)
       values ($1, '__QA seed key', 'qa', 'qa') returning id`,
      [qaNumber("P05701")],
    );
    projectId = project[0]!.id;
    const { rows: run } = await client.query<{ id: string }>(
      `insert into spec_runs (project_id, name, created_by, updated_by) values ($1, '__QA phase', 'qa', 'qa') returning id`,
      [projectId],
    );
    runId = run[0]!.id;
  });

  afterAll(async () => {
    if (projectId) {
      await client.query(`delete from spec_records where project_id = $1`, [projectId]);
      await client.query(`delete from spec_runs where project_id = $1`, [projectId]);
      await client.query(`delete from projects where id = $1`, [projectId]);
    }
    if (categoryId) {
      await client.query(`delete from requirements where category_id = $1`, [categoryId]);
      await client.query(`delete from item_categories where id = $1`, [categoryId]);
    }
    await client.end();
  });

  /** A seed-shaped upsert of readiness questions into the fixture category. */
  async function seed(rows: SeedRow[]): Promise<void> {
    const params: unknown[] = [categoryId];
    const tuples = rows.map((row) => {
      params.push(row.prompt, row.sort, row.key);
      const n = params.length;
      return `($1, 'readiness', $${n - 2}, 'QA section', $${n - 1}::int, '{simple,complex,hero}', 'seed', 'seed', $${n})`;
    });
    await client.query(
      `insert into requirements (category_id, kind, prompt, section, sort_order, tgq_levels, created_by, updated_by, seed_key)
       values ${tuples.join(", ")}
       on conflict (category_id, seed_key) do update set
         kind = excluded.kind, spec_field_id = excluded.spec_field_id, prompt = excluded.prompt,
         section = excluded.section, sort_order = excluded.sort_order, tgq_levels = excluded.tgq_levels,
         updated_by = 'seed'`,
      params,
    );
  }

  async function byKey(): Promise<Map<string, { id: string; prompt: string; sort_order: number }>> {
    const { rows } = await client.query<{ id: string; seed_key: string; prompt: string; sort_order: number }>(
      `select id, seed_key, prompt, sort_order from requirements where category_id = $1`,
      [categoryId],
    );
    return new Map(rows.map((row) => [row.seed_key, row]));
  }

  async function recordWithAnswer(requirementId: string, state: "confirmed" | "missing", value: string | null): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into spec_records (project_id, run_id, record_no, item_description, category_id, created_by, updated_by)
       values ($1, $2, (select coalesce(max(record_no), 0) + 1 from spec_records where project_id = $1),
               'An invented chair', $3, 'qa', 'qa') returning id`,
      [projectId, runId, categoryId],
    );
    const recordId = rows[0]!.id;
    await client.query(
      `insert into spec_answers (record_id, requirement_id, state, value, confirmed_by, confirmed_at, source_kind)
       values ($1, $2, $3::text, $4,
               case when $3::text = 'confirmed' then 'qa' end,
               case when $3::text = 'confirmed' then now() end, 'manual')`,
      [recordId, requirementId, state, value],
    );
    return recordId;
  }

  it("gives every seeded requirement a key, unique in its category", async () => {
    const { rows } = await client.query<{ missing: string; duplicated: string }>(
      `select count(*) filter (where seed_key is null) as missing,
              count(*) - count(distinct (category_id, seed_key)) as duplicated
         from requirements where created_by = 'seed'`,
    );
    expect(rows[0]).toEqual({ missing: "0", duplicated: "0" });
  });

  it("re-runs the real seed files without changing a single requirement", async () => {
    const snapshot = async () =>
      (
        await client.query(
          `select id, category_id, seed_key, kind, spec_field_id, local_key, prompt, help_text, section, sort_order, tgq_levels
             from requirements where created_by = 'seed' order by id`,
        )
      ).rows;
    const before = await snapshot();
    for (const file of SEEDS) {
      await client.query(readFileSync(path.join(process.cwd(), "db/seed", file), "utf8"));
    }
    expect(await snapshot()).toEqual(before);
  });

  it("keeps every question's id and answers when one is added in the middle", async () => {
    await seed([
      { key: "q:first", prompt: "First invented question", sort: 1 },
      { key: "q:second", prompt: "Second invented question", sort: 2 },
      { key: "q:third", prompt: "Third invented question", sort: 3 },
    ]);
    const before = await byKey();
    const answered = await recordWithAnswer(before.get("q:second")!.id, "confirmed", "An invented answer");

    // The revised sheet: a new question at 2, everything below it one lower.
    await seed([
      { key: "q:first", prompt: "First invented question", sort: 1 },
      { key: "q:inserted", prompt: "An inserted question", sort: 2 },
      { key: "q:second", prompt: "Second invented question", sort: 3 },
      { key: "q:third", prompt: "Third invented question", sort: 4 },
    ]);
    const after = await byKey();
    for (const key of ["q:first", "q:second", "q:third"]) {
      expect(after.get(key)?.id, key).toBe(before.get(key)?.id);
      expect(after.get(key)?.prompt, key).toBe(before.get(key)?.prompt);
    }
    expect(after.get("q:second")?.sort_order).toBe(3);
    expect(after.get("q:inserted")?.sort_order).toBe(2);
    const { rows } = await client.query<{ requirement_id: string; value: string }>(
      `select requirement_id, value from spec_answers where record_id = $1`,
      [answered],
    );
    expect(rows).toEqual([{ requirement_id: before.get("q:second")!.id, value: "An invented answer" }]);
  });

  it("refuses to change what an answered question asks, and says how many answers stand on it", async () => {
    await seed([{ key: "q:answered", prompt: "An answered question", sort: 20 }]);
    const id = (await byKey()).get("q:answered")!.id;
    await recordWithAnswer(id, "confirmed", "Yes");
    await expect(client.query(`update requirements set prompt = 'A different question' where id = $1`, [id]))
      .rejects.toThrow(/1 answer/);
    // What does not change the question still saves.
    await expect(client.query(`update requirements set section = 'Moved', sort_order = 21 where id = $1`, [id]))
      .resolves.toBeTruthy();
  });

  it("lets a question nobody has answered be reworded", async () => {
    await seed([{ key: "q:unanswered", prompt: "An unanswered question", sort: 30 }]);
    const id = (await byKey()).get("q:unanswered")!.id;
    await recordWithAnswer(id, "missing", null);
    await client.query(`update requirements set prompt = 'An unanswered question, reworded' where id = $1`, [id]);
    expect((await byKey()).get("q:unanswered")?.prompt).toBe("An unanswered question, reworded");
  });
});
