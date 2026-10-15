// Database tier — the item words the Ronnie Scott's procurement schedule used
// reach the sheet a person put them on (2026-10-15).
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/category-aliases-ronnie.test.ts
//
// On pilot Matthew set the category of every P16717 line the matcher left
// blank, and Max confirmed what pilot holds (plan A1,
// docs/plans/ronnie-scotts-followups-2026-10-15.md). `db/seed/0004` now
// carries those names. Read through the REAL suggester over the SEEDED
// registers, so it fails if the seed did not run. Writes nothing.
import { expect, it } from "vitest";
import { describeIfDb } from "./db-tier";
import { sql } from "@/lib/db";
import { loadLineSuggester } from "@/lib/boq-stage";
import type { BoqLine } from "@/lib/boq-import";

const line = (itemDescription: string): BoqLine => ({
  lineNo: 9,
  designer: null,
  boqCategory: null,
  area: null,
  code: "ZZ-FUR-01",
  itemDescription,
  productReference: null,
  qty: 1,
  qtyUnit: "ea",
});

describeIfDb("the Ronnie Scott's bill's item words", () => {
  async function sheetFor(name: string) {
    const suggest = await loadLineSuggester(sql);
    const staged = suggest(line(name), 0);
    const slug = staged.categoryId
      ? String((await sql`select slug from item_categories where id = ${staged.categoryId}`)[0]?.slug)
      : null;
    return { status: staged.categoryStatus, slug };
  }

  it("files each name on the sheet Matthew chose for it", async () => {
    for (const name of ["POUFEE", "POUFFE", "Pouf"]) {
      expect(await sheetFor(name)).toEqual({ status: "suggested", slug: "armchairs-benches-stools-sofas" });
    }
    for (const name of ["LOUNGE TABLE", "BAR HEIGHT TABLE", "DINING TABLE"]) {
      expect(await sheetFor(name)).toEqual({ status: "suggested", slug: "dining-tables" });
    }
    for (const name of ["GREETER", "Greeter station", "DJ TABLE", "DJ booth"]) {
      expect(await sheetFor(name)).toEqual({ status: "suggested", slug: "drinks-cabinets-service-stations" });
    }
  });

  it("matches a name written `<item> @ <where>` on the item", async () => {
    // Without that, "Lounge table" as a term ties the Aman bill's side tables.
    expect((await sheetFor("Side Table @ Lounge")).slug).toBe("side-coffee-bedside-tables");
    expect((await sheetFor("Coffee Table @ Lounge")).slug).toBe("side-coffee-bedside-tables");
    expect((await sheetFor("BAR STOOL @")).slug).toBe("bar-counter-stools");
  });

  it("still asks about a line named only TABLE", async () => {
    // Only the bill's own category column ("TABLE - LOUNGE") says which, and
    // nothing reads it (plan A1b, undecided).
    expect(await sheetFor("TABLE")).toMatchObject({ status: "ambiguous", slug: null });
  });
});
