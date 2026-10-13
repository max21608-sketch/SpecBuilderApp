// Which library row a twin merges into (db/backfill-finish-twins.ts). Pure.
import { describe, expect, it } from "vitest";
import { canonicalTwinOf, type LibraryRow } from "@/lib/finish-twin-backfill";

let n = 0;
const row = (code: string, over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: `fin-${(n += 1)}`,
  code,
  codeNorm: code.toUpperCase(),
  codeOrigin: "client",
  kind: null,
  description: null,
  supplierRaw: null,
  reference: null,
  colour: null,
  state: "tbc",
  swatch: null,
  standardValue: null,
  itemCodes: [],
  uses: 1,
  ...over,
});

describe("canonicalTwinOf", () => {
  it("moves a bare code onto its one zoned twin, never the reverse", () => {
    const bare = row("MTL-01");
    const zoned = row("GR-MTL-01");
    expect(canonicalTwinOf(bare, [bare, zoned])).toEqual({ canonical: zoned, why: "zone" });
    expect(canonicalTwinOf(zoned, [bare, zoned])).toBeNull();
  });

  it("names a bare code two zones carry, and merges nothing", () => {
    const bare = row("MTL-01");
    expect(canonicalTwinOf(bare, [bare, row("GR-MTL-01"), row("PL-MTL-01")])).toEqual({
      ambiguous: "MTL-01: GR-MTL-01 and PL-MTL-01 both carry it",
    });
  });

  it("strips the item's code where every item it is on carries it", () => {
    const twin = row("ZZ-FAB-13 ZZ-FUR-04", { itemCodes: ["ZZ-FUR-04"] });
    const canonical = row("ZZ-FAB-13");
    expect(canonicalTwinOf(twin, [twin, canonical])).toEqual({ canonical, why: "item_code" });
    // Items that disagree about it: nothing.
    const mixed = row("ZZ-FAB-13 ZZ-FUR-04", { itemCodes: ["ZZ-FUR-04", "ZZ-FUR-05"] });
    expect(canonicalTwinOf(mixed, [mixed, canonical])).toBeNull();
    // No stripped row in the library: nothing.
    expect(canonicalTwinOf(twin, [twin])).toBeNull();
  });

  it("leaves a pointed code and two zoned codes alone", () => {
    const pointed = row("CH-01.1");
    expect(canonicalTwinOf(pointed, [pointed, row("ZZ-CH-01")])).toBeNull();
    const gr = row("GR-MTL-01");
    expect(canonicalTwinOf(gr, [gr, row("PL-MTL-01")])).toBeNull();
  });
});
