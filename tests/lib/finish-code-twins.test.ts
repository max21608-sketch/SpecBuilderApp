// A bare code and its zone-prefixed twin are one finish (Max, 2026-10-13).
// Pure: findFinishByCode, resolveFinishCode, the bill walk, and the drawings
// card's sameFinish / alreadyRecorded.
import { describe, expect, it } from "vitest";
import { findFinishByCode, resolveFinishCode, resolveFinishCodeInWalk, type Finish } from "@/lib/finishes";
import { alreadyRecorded, sameFinish } from "@/lib/drawing-document";
import { decideFabricFiling, describeFiling } from "@/lib/bill-fabric-filing";

let n = 0;
const finish = (code: string, over: Partial<Finish> = {}): Finish => ({
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
  ...over,
});

describe("findFinishByCode", () => {
  it("takes the exact code first", () => {
    const bare = finish("ZZM-01");
    const zoned = finish("GR-ZZM-01");
    expect(findFinishByCode("zzm-01", [bare, zoned])).toEqual({ finish: bare, readAs: null });
  });

  it("reads a bare code as its one zoned twin, and says so", () => {
    const zoned = finish("GR-MTL-01");
    expect(findFinishByCode("MTL-01", [zoned])).toEqual({
      finish: zoned,
      readAs: "read as GR-MTL-01: MTL-01 is written without its GR",
    });
  });

  it("reads nothing where two zones carry the bare code", () => {
    expect(findFinishByCode("MTL-01", [finish("GR-MTL-01"), finish("PL-MTL-01")])).toBeNull();
  });

  it("reads a zoned code as the library's bare twin, and says so", () => {
    const bare = finish("FAB-14");
    expect(findFinishByCode("GR-FAB-14", [bare])).toEqual({
      finish: bare,
      readAs: "read as FAB-14: the same code without its GR",
    });
  });

  it("never folds two zoned codes, directly or through their bare twin", () => {
    // Directly.
    expect(findFinishByCode("PL-MTL-01", [finish("GR-MTL-01")])).toBeNull();
    // Through the bare twin, where another zone is in the library…
    expect(findFinishByCode("PL-MTL-01", [finish("MTL-01"), finish("GR-MTL-01")])).toBeNull();
    // …or already read onto it by an item.
    expect(findFinishByCode("PL-MTL-01", [finish("MTL-01", { zonesOnItems: ["GR"] })])).toBeNull();
    expect(findFinishByCode("GR-MTL-01", [finish("MTL-01", { zonesOnItems: ["GR"] })])?.finish.code).toBe("MTL-01");
  });

  it("never reads a pointed or sub-part code either way", () => {
    expect(findFinishByCode("CH-01.1", [finish("ZZ-CH-01")])).toBeNull();
    expect(findFinishByCode("GR-TIM-08.1", [finish("TIM-08")])).toBeNull();
    expect(findFinishByCode("TIM-08", [finish("GR-TIM-08.1")])).toBeNull();
  });
});

describe("resolveFinishCode", () => {
  it("links a twin and carries the sentence; the CONFLICT rule still holds", () => {
    const zoned = finish("GR-TIM-13", { description: "Example oak" });
    expect(resolveFinishCode("TIM-13", null, [zoned])).toMatchObject({ status: "matched", finish: zoned, readAs: expect.stringContaining("GR-TIM-13") });
    expect(resolveFinishCode("TIM-13", "Example walnut", [zoned])).toMatchObject({ status: "conflict", readAs: expect.any(String) });
    expect(resolveFinishCode("PL-TIM-13", null, [finish("GR-TIM-13")])).toMatchObject({ status: "new", code: "PL-TIM-13" });
  });

  it("in a walk, remembers the zone it read onto a bare twin", () => {
    const bare = finish("TIM-13");
    const library = [bare];
    expect(resolveFinishCodeInWalk("GR-TIM-13", null, library)).toMatchObject({ status: "matched", finish: bare });
    expect(resolveFinishCodeInWalk("PL-TIM-13", null, library)).toMatchObject({ status: "new" });
  });

  it("is what the bill's filing says on the review", () => {
    const zoned = finish("GR-FAB-14");
    const filing = decideFabricFiling({ materialCode: "FAB-14", says: "Example linen", words: "Example linen", parentName: null, library: [zoned] });
    expect(filing).toMatchObject({ outcome: "matched", finish: zoned });
    expect(describeFiling(filing, new Map(), "BW-F-", 3)).toBe(
      "matches GR-FAB-14 in the library — read as GR-FAB-14: FAB-14 is written without its GR",
    );
  });
});

describe("the drawings card: the same finish", () => {
  it("reads GR-FAB-14 over the bill's FAB-14 as the same finish, given the library", () => {
    const library = [finish("FAB-14")];
    const drawing = { code: "GR-FAB-14", words: "GR FAB 14" };
    const bill = { code: "FAB-14", words: "Fabric @ Stool Collection: Example" };
    expect(sameFinish(drawing, bill, library)).toBe(true);
    expect(sameFinish(drawing, bill)).toBe(false);
    expect(sameFinish({ code: "GR-MTL-01", words: null }, { code: "PL-MTL-01", words: null }, [finish("MTL-01")])).toBe(false);
  });

  it("writes nothing over it: already recorded, not a replace", () => {
    const observation = {
      attrGroup: "material" as const,
      dimensionSlot: null,
      value: "GR FAB 14",
      valueRaw: "GR FAB 14",
      unit: null,
      state: "confirmed" as const,
      specFieldId: "field-com1",
      materialCodeRaw: "GR-FAB-14",
    };
    const occupant = { value: "Fabric @ Stool Collection: Example", unit: null, state: "confirmed", materialCode: "FAB-14" };
    expect(alreadyRecorded(observation, occupant, [finish("FAB-14")])).toBe(true);
    expect(alreadyRecorded(observation, occupant)).toBe(false);
  });
});
