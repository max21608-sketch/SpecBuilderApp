// Pure tier — which of his types an item on a multi-type sheet is, SUGGESTED
// from its name (decision B, 2026-11-20). A suggestion only: nothing here is
// written, and `effectiveMatrixType` is what decides which rows apply.
import { describe, it, expect } from "vitest";
import { effectiveMatrixType, suggestMatrixType, type SuggestableType } from "@/lib/matrix-type";

// The armchairs sheet as seed 0014 leaves it: S, A and B, A the default.
const armchairsSheet: SuggestableType[] = [
  { code: "S", name: "Sofas", suggestWords: ["sofa", "settee", "loveseat"], suggestDefault: false },
  { code: "A", name: "Armchairs & Occasional Chairs", suggestWords: ["bar stool", "counter stool"], suggestDefault: true },
  { code: "B", name: "Benches", suggestWords: ["bench", "stool"], suggestDefault: false },
];
// The sofas-and-daybeds sheet: S and D, no default.
const sofaBedSheet: SuggestableType[] = [
  { code: "S", name: "Sofas", suggestWords: ["sofa", "settee", "loveseat"], suggestDefault: false },
  { code: "D", name: "Daybeds", suggestWords: ["daybed", "chaise"], suggestDefault: false },
];

describe("suggestMatrixType", () => {
  it("a sofa is S, and says which word it read", () => {
    const s = suggestMatrixType("Three seat sofa", armchairsSheet);
    expect(s?.code).toBe("S");
    expect(s?.reason).toContain("sofa");
  });

  it("a plural still names the type", () => {
    expect(suggestMatrixType("Sofas, pair", armchairsSheet)?.code).toBe("S");
    expect(suggestMatrixType("End of bed benches", armchairsSheet)?.code).toBe("B");
  });

  it("a bar stool is A: the longer phrase wins over the word inside it", () => {
    expect(suggestMatrixType("Bar stool", armchairsSheet)?.code).toBe("A");
    expect(suggestMatrixType("Counter stool, swivel", armchairsSheet)?.code).toBe("A");
    expect(suggestMatrixType("Piano stool", armchairsSheet)?.code).toBe("B");
  });

  it("a name naming two types abstains rather than picking one", () => {
    expect(suggestMatrixType("Sofa bench", armchairsSheet)).toBeNull();
  });

  it("a name naming none takes the sheet's default, and says so", () => {
    const s = suggestMatrixType("Lobby armchair", armchairsSheet);
    expect(s?.code).toBe("A");
    expect(s?.reason).toMatch(/names no type/i);
    // No default on the sheet: nothing to suggest.
    expect(suggestMatrixType("Lounge piece", sofaBedSheet)).toBeNull();
  });

  it("whole words only: a word inside another word is not a match", () => {
    // "sofabed" is not "sofa"; "benchmark" is not "bench".
    expect(suggestMatrixType("Benchmark lounge piece", sofaBedSheet)).toBeNull();
    expect(suggestMatrixType("Chaise longue", sofaBedSheet)?.code).toBe("D");
  });

  it("a sheet with one type has nothing to choose, so nothing is suggested", () => {
    expect(suggestMatrixType("Side table", [{ code: "ST", name: "Side tables", suggestWords: [], suggestDefault: false }])).toBeNull();
    expect(suggestMatrixType("Three seat sofa", [])).toBeNull();
  });
});

describe("effectiveMatrixType", () => {
  it("is the accepted type where the sheet maps it, null otherwise (the union applies)", () => {
    expect(effectiveMatrixType("S", armchairsSheet)).toBe("S");
    expect(effectiveMatrixType(null, armchairsSheet)).toBeNull();
    // A type the sheet does not map — the record changed category, or a
    // re-seed renamed it — is ignored, never an empty set of rows.
    expect(effectiveMatrixType("D", armchairsSheet)).toBeNull();
    expect(effectiveMatrixType("S", [])).toBeNull();
  });
});
