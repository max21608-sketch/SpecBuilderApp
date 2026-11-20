// Database tier — the seeded gate overlay, and the one assertion that matters:
// a category the matrix gates must be able to ANSWER every field it gates.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// This test creates NOTHING. It reads seed data, so there is nothing to clean
// up — which is the point: every assertion here is about what a re-seed would
// break, and a re-seed is how this model is meant to change.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;

describeIfDb("the seeded gate overlay", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  beforeAll(async () => { await client.connect(); });
  afterAll(async () => { await client.end(); });
  const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows;

  it("holds Matthew's 35 rows and the 21 AI-drafted cabinetry rows, split across the three gates", async () => {
    const rows = await q("select gate, count(*)::int n from spec_field_gates group by gate order by gate");
    expect(rows).toEqual([
      { gate: "TG0", n: 34 },
      { gate: "TG1", n: 4 },
      { gate: "TGQ", n: 18 },
    ]);
    const ranges = await q(`
      select count(*) filter (where matrix_row between 1 and 35)::int as his,
             count(*) filter (where matrix_row between 101 and 121)::int as drafted,
             count(*)::int as total
        from spec_field_gates`);
    expect(ranges).toEqual([{ his: 35, drafted: 21, total: 56 }]);
  });

  it("his rows 1-35 are exactly what db/seed/0006 says, column for column", async () => {
    // 0014 must never edit his rows: the cabinetry types receive his "All
    // categories" rows through the GENERATED applies_to_all (0061), not by a
    // seed widening his arrays. Re-running 0006 inside a transaction that is
    // rolled back proves the live rows are the file's: an upsert that changes
    // nothing but the bookkeeping leaves every compared column where it was.
    const columns = `matrix_row, gate, capture, field_name, spec_field_id, local_key, dimension_slot, applies_to,
                     applies_to_raw, applies_to_all, value_type, palette_key, palette_raw, conditional_on_key,
                     conditional_on_value, notes`;
    const before = await q(`select ${columns} from spec_field_gates where matrix_row <= 35 order by matrix_row`);
    expect(before).toHaveLength(35);
    const seed = readFileSync(path.join(process.cwd(), "db/seed/0006_spec_field_gates.sql"), "utf8");
    await client.query("begin");
    try {
      await client.query(seed);
      const after = await q(`select ${columns} from spec_field_gates where matrix_row <= 35 order by matrix_row`);
      expect(after).toEqual(before);
    } finally {
      await client.query("rollback");
    }
    // And the phrase, not the array, is what widens: exactly his "All
    // categories" rows reach every type.
    const all = await q("select matrix_row from spec_field_gates where applies_to_all order by matrix_row");
    expect(all.map((r) => r.matrix_row)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 32, 33, 34, 35]);
  });

  it("refuses two rows for one field at one gate for a shared type, by the constraint's name", async () => {
    // The per-TYPE identity rule that replaced 0026's global unique index.
    // Row 18 is Timber finish 1 at TG0 for his nine; row 106 is the same field
    // and gate for the eight cabinetry types, and both are allowed. A second
    // row for a seating code is not.
    await client.query("begin");
    try {
      await expect(
        client.query(`
          insert into spec_field_gates (matrix_row, gate, capture, field_name, spec_field_id, applies_to, applies_to_raw,
                                        value_type, created_by, updated_by)
          select 9001, 'TG0', 'input', '__QA timber twice', f.id, array['S'], 'S', 'free_text', 'qa', 'qa'
            from spec_fields f where f.json_id = 4`),
      ).rejects.toMatchObject({ code: "23514", constraint: "spec_field_gates_identity_overlap" });
    } finally {
      await client.query("rollback");
    }
    // An "All categories" row overlaps every type, a type it never named
    // included.
    await client.query("begin");
    try {
      await expect(
        client.query(`
          insert into spec_field_gates (matrix_row, gate, capture, field_name, spec_field_id, applies_to, applies_to_raw,
                                        value_type, created_by, updated_by)
          select 9002, 'TGQ', 'question', '__QA outdoor again', f.id, array['__QA'], '__QA', 'free_text', 'qa', 'qa'
            from spec_fields f where f.json_id = 130`),
      ).rejects.toMatchObject({ code: "23514", constraint: "spec_field_gates_identity_overlap" });
    } finally {
      await client.query("rollback");
    }
  });

  it("every AI-drafted row says so in its notes, and its types carry the provisional note", async () => {
    const sentence = "Provisional cabinetry gate model, drafted by AI on 20 Nov 2026, not yet confirmed by Matthew";
    const unlabelled = await q(
      `select matrix_row from spec_field_gates where matrix_row between 101 and 121 and position($1 in coalesce(notes, '')) <> 1`,
      [sentence],
    );
    expect(unlabelled).toEqual([]);
    const types = await q(
      "select code, family, provisional_note from spec_matrix_categories order by sort_order",
    );
    expect(types.map((t) => t.code)).toEqual(["S", "A", "DC", "BS", "B", "D", "O", "BH", "BQ", "CD", "DT", "DS", "MR", "SB", "ST", "SD", "WR"]);
    for (const type of types) {
      if (type.family === "upholstery") expect(type.provisional_note).toBeNull();
      else expect(type.provisional_note).toBe(sentence);
    }
    // His rows say nothing of the kind.
    const his = await q(
      `select matrix_row from spec_field_gates where matrix_row <= 35 and position('drafted by AI' in coalesce(notes, '')) > 0`,
    );
    expect(his).toEqual([]);
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
        join spec_matrix_category_map m on g.applies_to_all or g.applies_to && array[m.matrix_code]
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

  it("each of the eight cabinetry sheets is ONE provisional type, and answers every row that reaches it", async () => {
    // 0014 (2026-11-20). Until then the cabinetry sheets had no gate view.
    // Now each is exactly one AI-drafted type, so there is no union to widen.
    const mapped = await q(`
      select c.slug, array_agg(m.matrix_code order by m.matrix_code) as codes,
             bool_and(t.provisional_note is not null) as provisional
        from item_categories c
        join spec_matrix_category_map m on m.item_category_id = c.id
        join spec_matrix_categories t on t.code = m.matrix_code
       where c.family = 'cabinetry' and c.created_by = 'seed'
       group by c.slug order by c.slug`);
    expect(mapped).toEqual([
      { slug: "consoles-desks-dressing-tables", codes: ["CD"], provisional: true },
      { slug: "dining-tables", codes: ["DT"], provisional: true },
      { slug: "drinks-cabinets-service-stations", codes: ["DS"], provisional: true },
      { slug: "mirrors", codes: ["MR"], provisional: true },
      { slug: "shelves-bookcase", codes: ["SB"], provisional: true },
      { slug: "side-coffee-bedside-tables", codes: ["ST"], provisional: true },
      { slug: "sideboards-dressers", codes: ["SD"], provisional: true },
      { slug: "wardrobes", codes: ["WR"], provisional: true },
    ]);
    // Every LOCAL-KEY row that reaches a cabinetry type has its readiness
    // question too, so a controller is never "nowhere to record it". His four
    // record-column rows (item name, designer reference, spec notes) and
    // product code are read off the record or are the known gap (finding 7),
    // not questions.
    const localGaps = await q(`
      select c.slug, g.local_key
        from spec_field_gates g
        join spec_matrix_category_map m on g.applies_to_all or g.applies_to && array[m.matrix_code]
        join item_categories c on c.id = m.item_category_id
       where c.family = 'cabinetry' and g.local_key is not null
         and g.local_key not in ('product_code', 'item_name', 'designer_reference', 'spec_notes')
         and not exists (select 1 from requirements r where r.category_id = c.id and r.local_key = g.local_key)
       order by 1, 2`);
    expect(localGaps).toEqual([]);
  });

  it("every conditional's controller is a TGQ row asked of every type its dependent reaches", async () => {
    // Row 120 (socket / wire access) reaches dining tables, so row 103 (the
    // lighting-or-power controller) must too, or a dining table's TG0 waits
    // for ever on a question nobody asks it (design finding 3).
    const orphans = await q(`
      select d.matrix_row, code
        from spec_field_gates d
        cross join lateral unnest(d.applies_to) as code
       where d.conditional_on_key is not null
         and not exists (
           select 1 from spec_field_gates c
            where c.local_key = d.conditional_on_key and c.gate = 'TGQ'
              and (c.applies_to_all or code = any(c.applies_to)))
       order by 1, 2`);
    expect(orphans).toEqual([]);
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

  it("the five BWS-owned palettes are synced from BWS, not invented", async () => {
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

    // These were EMPTY on purpose until 2026-09-22 — a row with no options and
    // a null `synced_at` said "this vocabulary exists, BWS owns it, we have
    // never had it", which is a question somebody can answer, where five
    // invented finish lists is the one kind of wrong answer nothing downstream
    // would question (FMT-GEN-01). Max got a BWS account and they were
    // captured read-only from the Palette options box on each field's /edit
    // page (db/seed/0011, docs/plans/bws-palette-capture-2026-09-22.json).
    //
    // So the assertion inverts, and what it now holds is the SYNC: the counts
    // are the capture's, and a re-seed that quietly drops or invents options
    // fails here. A number moving is not a bug to fix by editing this test —
    // it means BWS changed, and the sync rule is that a person reads the diff
    // and decides. An option a live answer already uses is kept and flagged,
    // never deleted.
    const owned = await q(`
      select p.key, p.synced_at, count(o.id)::int as options
        from spec_palettes p left join spec_palette_options o on o.palette_key = p.key
       where p.owner = 'bws' group by p.key, p.synced_at order by p.key`);
    expect(owned.map((r) => ({ key: r.key, options: r.options }))).toEqual([
      { key: "bws_back_cushion", options: 6 },
      { key: "bws_metal_finish", options: 15 },
      { key: "bws_seat_build", options: 27 },
      { key: "bws_stud", options: 13 },
      { key: "bws_timber_finish", options: 35 },
    ]);
    for (const row of owned) {
      // A claim of a sync with nothing behind it is the thing the old
      // emptiness rule was really guarding against, and it still fails.
      expect(row.synced_at).not.toBeNull();
      expect(new Date(row.synced_at as string).toISOString().slice(0, 10)).toBe("2026-09-22");
    }

    // The divider BWS uses to separate the indoor block from the OUTDOOR one
    // is a rule in a textarea, not an option. If one is ever seeded it appears
    // in a dropdown as "------" and nothing else would catch it.
    const dividers = await q(
      `select palette_key, value from spec_palette_options where btrim(value) ~ '^-{3,}$'`,
    );
    expect(dividers).toEqual([]);

    // Only Stud spec prints a BWE code inside its label, 8 of 13. The label
    // keeps the whole string; `code` carries the code as well, for a document
    // that quotes it alone. A code appearing on another palette means the
    // parse widened.
    const coded = await q(`
      select palette_key, count(*)::int as n from spec_palette_options
       where code is not null group by palette_key order by palette_key`);
    expect(coded).toEqual([{ palette_key: "bws_stud", n: 8 }]);

    // Every palette the matrix names has a row, so a gate can never point at a
    // key nothing holds.
    const dangling = await q(`
      select distinct g.palette_key from spec_field_gates g
       where g.palette_key is not null
         and not exists (select 1 from spec_palettes p where p.key = g.palette_key)`);
    expect(dangling).toEqual([]);

    // And still no BW standard finish register: that one is blocked on
    // Matthew's list and must not be guessed either.
    const tables = await q(
      "select table_name from information_schema.tables where table_name = 'bw_standard_finishes'",
    );
    expect(tables).toEqual([]);
  });

  it("a reused prompt is byte-identical, so one question stays one question", async () => {
    // 728 rows were 62 distinct prompts because a question shared across
    // cheat sheets is worded identically. 0007 adds six new questions and
    // reuses two existing ones; a paraphrase would make it 70 and silently
    // break the TGQ interview's hoist.
    // 62 from the cheat sheets, +6 from db/seed/0007 (BWS fields no sheet
    // asked for), +6 from db/seed/0009 (Matthew's rows with no BWS field at
    // all), +5 from db/seed/0014 (the four cabinetry controllers and socket /
    // wire access; its lighting spec reuses 0009's wording). This number moves only when a seed adds a question, and it should
    // fail when one is paraphrased instead of reused.
    // ======================================================================
    // SEEDED ROWS ONLY, AND THAT IS THE POINT OF THE PREDICATE.
    //
    // Everything above is about the seed files, and this counted every row in
    // the table. A db-tier fixture that creates its own category and its own
    // questions — `tests/db/chase-drafts.test.ts` does, correctly, per-process
    // suffixed — therefore moved a number this test reads as seed state, and a
    // run whose teardown failed left them behind and failed THIS test on every
    // later run, in every worktree, for every agent: 77 where it expects 74,
    // reading as a seed regression in whatever commit happened to be under
    // test. It cost five runs on 2026-09-23 before the chain was understood.
    //
    // A `__QA ` category is not seed data, so it is not what this assertion is
    // about. Scoping it here removes the whole class rather than the one
    // instance — `db:qa-clean` sweeping those categories (fixed the same day)
    // is the other half, and neither replaces the other: the sweep stops the
    // litter accumulating, this stops litter ever being read as seed.
    // ======================================================================
    const [{ n }] = await q(`
      select count(distinct r.prompt)::int n
        from requirements r
        join item_categories c on c.id = r.category_id
       where left(c.name, 5) <> '__QA '`);
    expect(n).toBe(79);
    const perField = await q(`
      select f.json_id, count(distinct r.prompt)::int n
        from requirements r
        join spec_fields f on f.id = r.spec_field_id
        join item_categories c on c.id = r.category_id
       where left(c.name, 5) <> '__QA '
       group by f.json_id having count(distinct r.prompt) > 1`);
    expect(perField).toEqual([]);
  });
});
