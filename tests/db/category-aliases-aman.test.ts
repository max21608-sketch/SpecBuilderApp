// Database tier — the item words the Aman Miami Beach bill used reach a sheet
// (2026-09-30).
//
// Skips silently without DATABASE_URL. Run against the local stack with:
//   node --env-file=.env.localstack.local ~/dev/localstack/one-db-test.mjs tests/db/category-aliases-aman.test.ts
//
// On pilot eleven records had no category. Four of the words were missing from
// `item_category_aliases`, and `db/seed/0004` now carries them, each on the
// sheet whose questions fit it. This reads them through the REAL suggester
// (`loadLineSuggester`, the one registration uses) over the SEEDED registers,
// so it fails if the seed did not run, and it holds the two traps beside them:
// a whole-word match is not a substring ("Chair" does not reach "Chaise
// Lounge"), and a line naming two things stays a question. Writes nothing.
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

describeIfDb("the Aman bill's item words", () => {
  async function sheetFor(name: string) {
    const suggest = await loadLineSuggester(sql);
    const staged = suggest(line(name), 0);
    const slug = staged.categoryId
      ? String((await sql`select slug from item_categories where id = ${staged.categoryId}`)[0]?.slug)
      : null;
    return { status: staged.categoryStatus, slug };
  }

  it("files each word the bill used on the sheet chosen for it", async () => {
    expect(await sheetFor("Drawers")).toEqual({ status: "suggested", slug: "sideboards-dressers" });
    expect(await sheetFor("Pouf @ Lounge")).toEqual({ status: "suggested", slug: "ottomans-storage-boxes" });
    expect(await sheetFor("Pouf @ Bedroom")).toEqual({ status: "suggested", slug: "ottomans-storage-boxes" });
    expect(await sheetFor("Bench Ottoman")).toEqual({ status: "suggested", slug: "ottomans-storage-boxes" });
    expect(await sheetFor("Chaise Lounge")).toEqual({ status: "suggested", slug: "sofas-bed-daybeds" });
    // Already there: the miss on pilot was the whole description cell.
    expect(await sheetFor("Desk Chair")).toEqual({ status: "suggested", slug: "desk-chair-cinema-chair" });
  });

  it("does not turn a word into a substring, and leaves a line naming two things to a person", async () => {
    // "Chair" is still a question (three chair sheets), and never the chaise.
    expect((await sheetFor("Chair")).status).toBe("ambiguous");
    // Sharing one word of two with "Chaise Lounge" is under the cutoff.
    expect(await sheetFor("Lounge Chair")).toEqual({ status: "none", slug: null });
    expect((await sheetFor("Side Table @ Lounge")).slug).toBe("side-coffee-bedside-tables");
    // A bed base AND a headboard, whole words each: two sheets tie.
    expect(
      (await sheetFor("Bedframe & Headboard - TWIN (X18 = BED BASES - X1 HEADBOARD PER X2 BED BASES)")).status,
    ).toBe("ambiguous");
    expect((await sheetFor("Bedframe & Headboard")).slug).toBe("headboards-wall-fixed");
  });
});
