// Database tier — the seeded gate overlay, and the one assertion that matters:
// a category the matrix gates must be able to ANSWER every field it gates.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// This test creates NOTHING. It reads seed data, so there is nothing to clean
// up — which is the point: every assertion here is about what a re-seed would
// break, and a re-seed is how this model is meant to change.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("the seeded gate overlay", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows;

  it("holds Matthew's 35 rows, split across his three gates", async () => {
    const rows = await q("select gate, count(*)::int n from spec_field_gates group by gate order by gate");
    expect(rows).toEqual([
      { gate: "TG0", n: 17 },
      { gate: "TG1", n: 4 },
      { gate: "TGQ", n: 14 },
    ]);
  });

  it("every row lands on a BWS field or names an app-local key, never neither", async () => {
    const orphans = await q(
      "select matrix_row, field_name from spec_field_gates where spec_field_id is null and local_key is null",
    );
    expect(orphans).toEqual([]);
  });

  it("the same field at two gates is representable, and both are present", async () => {
    // Assembly guide (191) is TGQ — Question AND TG1. Dimensions (3) is TGQ
    // (four slots) AND TG1 (the whole cell). This is the fact that ruled out
    // `requirements.required_at_gate`, so it is asserted rather than assumed.
    const assembly = await q(`
      select g.gate from spec_field_gates g join spec_fields f on f.id = g.spec_field_id
       where f.json_id = 191 order by g.gate`);
    expect(assembly.map((r) => r.gate)).toEqual(["TG1", "TGQ"]);

    const dims = await q(`
      select g.gate, g.dimension_slot from spec_field_gates g join spec_fields f on f.id = g.spec_field_id
       where f.json_id = 3 order by g.gate, g.dimension_slot nulls first`);
    expect(dims).toEqual([
      { gate: "TG1", dimension_slot: null },
      { gate: "TGQ", dimension_slot: "D" },
      { gate: "TGQ", dimension_slot: "H" },
      { gate: "TGQ", dimension_slot: "SH" },
      { gate: "TGQ", dimension_slot: "W" },
    ]);
  });

  it("EVERY mapped category can answer every field its gates name", async () => {
    // The load-bearing one. A gate over a field this category's checklist
    // cannot ask is a question nobody can answer and a gate nobody can pass —
    // reported as `unanswerable` by src/lib/gates.ts, which is honest but
    // useless. db/seed/0007 closes the gap; this fails if a re-seed reopens it.
    const gaps = await q(`
      select c.slug, f.json_id, f.name
        from spec_field_gates g
        join spec_fields f on f.id = g.spec_field_id
        join spec_matrix_category_map m on g.applies_to && array[m.matrix_code]
        join item_categories c on c.id = m.item_category_id
       where not exists (
         select 1 from requirements r where r.category_id = c.id and r.spec_field_id = f.id)
       group by c.slug, f.json_id, f.name order by c.slug, f.json_id`);
    expect(gaps).toEqual([]);
  });

  it("nothing writes required_at_gate — the overlay is the only gate model", async () => {
    const [{ n }] = await q("select count(*)::int n from requirements where required_at_gate is not null");
    expect(n).toBe(0);
  });

  it("the eight cabinetry sheets get NO gate view, because his matrix does not cover them", async () => {
    const mapped = await q(`
      select c.slug from item_categories c
       where c.family = 'cabinetry'
         and exists (select 1 from spec_matrix_category_map m where m.item_category_id = c.id)`);
    expect(mapped).toEqual([]);
  });

  it("the two deliberate widenings are real, so changing the mapping fails here first", async () => {
    // Our `armchairs-benches-stools-sofas` is one sheet receiving his S, A and
    // B. He asks swivel of A and not of S or B, so mapping them together asks
    // it of all three. Recorded as a decision in db/seed/0005, asserted here.
    const swivel = await q(`
      select distinct c.slug from spec_field_gates g
        join spec_fields f on f.id = g.spec_field_id
        join spec_matrix_category_map m on g.applies_to && array[m.matrix_code]
        join item_categories c on c.id = m.item_category_id
       where f.json_id = 232 order by c.slug`);
    expect(swivel.map((r) => r.slug)).toContain("armchairs-benches-stools-sofas");

    // He asks seat height of S and explicitly NOT of D; our `sofas-bed-daybeds`
    // receives both.
    const seatHeight = await q(`
      select distinct c.slug from spec_field_gates g
        join spec_matrix_category_map m on g.applies_to && array[m.matrix_code]
        join item_categories c on c.id = m.item_category_id
       where g.dimension_slot = 'SH' order by c.slug`);
    expect(seatHeight.map((r) => r.slug)).toContain("sofas-bed-daybeds");
  });

  it("the five BWS-owned palettes are named and EMPTY, not invented", async () => {
    const palettes = await q(
      "select distinct palette_key from spec_field_gates where palette_key like 'bws_%' order by palette_key",
    );
    expect(palettes.map((r) => r.palette_key)).toEqual([
      "bws_back_cushion",
      "bws_metal_finish",
      "bws_seat_build",
      "bws_stud",
      "bws_timber_finish",
    ]);
    // Nothing in the schema holds their options. When that changes, this test
    // is the reminder that FMT-GEN-01 was satisfied until then.
    const tables = await q(
      "select table_name from information_schema.tables where table_name in ('spec_palettes','bw_standard_finishes')",
    );
    expect(tables).toEqual([]);
  });

  it("a reused prompt is byte-identical, so one question stays one question", async () => {
    // 728 rows were 62 distinct prompts because a question shared across
    // cheat sheets is worded identically. 0007 adds six new questions and
    // reuses two existing ones; a paraphrase would make it 70 and silently
    // break the TGQ interview's hoist.
    const [{ n }] = await q("select count(distinct prompt)::int n from requirements");
    expect(n).toBe(68);
    const perField = await q(`
      select f.json_id, count(distinct r.prompt)::int n
        from requirements r join spec_fields f on f.id = r.spec_field_id
       group by f.json_id having count(distinct r.prompt) > 1`);
    expect(perField).toEqual([]);
  });
});
