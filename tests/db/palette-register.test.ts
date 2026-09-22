// Database tier — the palette register as `loadPalettes` actually returns it.
//
// Skips silently without DATABASE_URL. Run with:
//   node --env-file=.env.local ./node_modules/.bin/vitest run
//
// ============================================================================
// THIS TEST CREATES NOTHING, AND THAT IS THE POINT.
//
// Everything asserted here is SEED data — db/seed/0008 and db/seed/0011 — so
// every assertion is about what a re-seed would break, and a re-seed is how
// this register is meant to change. No project is created, so no
// `qaNumber()` is needed: nothing here can collide with another agent's run of
// the tier.
//
// ---- WHY THE COUNTS ARE PINNED -------------------------------------------
//
// The five BWS palettes are a READ of BWS's own Palette options box, captured
// 2026-09-22 into docs/plans/bws-palette-capture-2026-09-22.json. A count
// moving is NOT a number to edit here: it means BWS changed, or a re-seed
// dropped or invented options, and a person reads the diff against the
// capture. `tests/db/vocabulary-sync.test.ts` already asserts the counts off
// the tables; this asserts them through the LOADER, which is what the three
// screens see -- including `code`, whose absence from the infill route's own
// copy of this query was invisible for as long as there were two copies.
// ============================================================================
import { it, expect } from "vitest";
import { describeIfDb } from "./db-tier";
import { sql } from "@/lib/db";
import { loadPalettes, palettesByFieldJsonId, withPalettes } from "@/lib/palette-load";
import { isOfferable, normalisePaletteValue } from "@/lib/palettes";

/** The capture's own counts, per db/seed/0011's header. */
const BWS_OPTION_COUNTS: Record<string, number> = {
  bws_timber_finish: 35,
  bws_metal_finish: 15,
  bws_seat_build: 27,
  bws_back_cushion: 6,
  bws_stud: 13,
};

describeIfDb("the palette register, through loadPalettes", () => {
  it("returns the five BWS palettes with the capture's exact option counts", async () => {
    const register = await loadPalettes(sql);
    const byKey = new Map(register.palettes.map((row) => [row.key, row]));

    for (const [key, expected] of Object.entries(BWS_OPTION_COUNTS)) {
      const palette = byKey.get(key);
      expect(palette, `${key} is missing from the register`).toBeDefined();
      expect(palette?.owner).toBe("bws");
      // A sync cannot be claimed by a run that inserted no options: 0011 sets
      // `synced_at` in the same file as the options, and 0008's guard refuses
      // options on a BWS palette without one.
      expect(palette?.synced_at, `${key} has options and no synced_at`).not.toBeNull();
      expect(palette?.options ?? [], `${key} option count moved -- read the capture diff`).toHaveLength(expected);
    }
  });

  it("carries `code` on the options BWS printed one on — 8 of the stud's 13", async () => {
    // 0035, and the column the infill route's copy of this query never gained.
    // Storing only the code loses the half a reviewer recognises; storing only
    // the prose loses the half a purchase order is raised against.
    const register = await loadPalettes(sql);
    const stud = register.palettes.find((row) => row.key === "bws_stud");
    const coded = (stud?.options ?? []).filter((option) => option.code !== null);
    expect(coded).toHaveLength(8);
    for (const option of coded) {
      // The label keeps BWS's line whole; the code is parsed out AS WELL.
      expect(option.label).toContain(option.code as string);
    }
  });

  it("resolves a value that quotes a BWS option code and nothing else", async () => {
    // End to end through the loader: this is the case `code` exists for, and
    // it silently could not happen on the infill screen while there were two
    // copies of the query.
    const register = await loadPalettes(sql);
    const stud = register.palettes.find((row) => row.key === "bws_stud");
    const withCode = (stud?.options ?? []).find((option) => option.code !== null);
    expect(withCode).toBeDefined();

    const palette = palettesByFieldJsonId(register).get(16); // Stud spec
    expect(palette?.key).toBe("bws_stud");
    expect(normalisePaletteValue(palette!, withCode!.code as string)).toBe(withCode!.value);
  });

  it("a palette no option belongs to still comes back, so a screen can say so", async () => {
    // `unheldPaletteNote`'s branch. Nothing is unheld today, so this asserts
    // the SHAPE the branch depends on rather than the state: every palette
    // arrives with an options array, never undefined, or `isOfferable` throws
    // instead of answering.
    const register = await loadPalettes(sql);
    expect(register.palettes.length).toBeGreaterThan(0);
    for (const row of register.palettes) {
      expect(Array.isArray(row.options), `${row.key} came back with no options array`).toBe(true);
    }
  });

  it("every gate's palette_key resolves to a palette in the register", async () => {
    // The assertion that catches a seed landing a gate row against a palette
    // that does not exist. A screen would then render a field with no list and
    // no sentence explaining why -- the empty-dropdown failure, arrived at
    // from the other end.
    const register = await loadPalettes(sql);
    const keys = new Set(register.palettes.map((row) => row.key));
    const orphans = register.paletteByQuestion.filter((link) => !keys.has(link.palette_key));
    expect(orphans).toEqual([]);
    expect(register.paletteByQuestion.length).toBeGreaterThan(0);
  });

  it("no BWS field carries two palettes, so the drawings link has no tie to break", async () => {
    // `palettesByFieldJsonId` keeps the last link it reads for a field. That is
    // only safe because no field carries two, which is a fact about the seed
    // and not about the code -- so it is asserted here rather than assumed
    // there.
    const rows = await sql`
      select f.json_id, count(distinct g.palette_key) as keys
        from spec_field_gates g
        join spec_fields f on f.id = g.spec_field_id
       where g.palette_key is not null
       group by f.json_id
      having count(distinct g.palette_key) > 1
    `;
    expect(rows).toEqual([]);
  });

  it("attaches a list to the five finish fields the drawings path can assign", async () => {
    // Main timber finish (4), Timber Finish 2 (31), Timber Finish 3 (143),
    // Main metal finish (5), Metal Finish 2 (35) -- the slots `suggestSpecField`
    // hands a timber or metal callout. COM 1/2/3 carry none, correctly: COM is
    // free text in BWS, and a list offered there would be an invented one.
    const register = await loadPalettes(sql);
    const fields = withPalettes(
      await sql`select id, json_id, name from spec_fields order by sort_order`,
      register,
    );
    const keyOf = (jsonId: number) => fields.find((field) => Number(field.json_id) === jsonId)?.palette?.key ?? null;

    expect(keyOf(4)).toBe("bws_timber_finish");
    expect(keyOf(31)).toBe("bws_timber_finish");
    expect(keyOf(143)).toBe("bws_timber_finish");
    expect(keyOf(5)).toBe("bws_metal_finish");
    expect(keyOf(35)).toBe("bws_metal_finish");

    expect(keyOf(1)).toBeNull(); // COM 1
    expect(keyOf(2)).toBeNull(); // COM 2
    expect(keyOf(14)).toBeNull(); // COM 3

    // And all five are lists this app can actually offer.
    for (const jsonId of [4, 31, 143, 5, 35]) {
      const palette = fields.find((field) => Number(field.json_id) === jsonId)?.palette;
      expect(palette && isOfferable(palette), `field ${jsonId} points at an empty list`).toBe(true);
    }
  });
});
