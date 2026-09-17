// What the app is willing to guess about an item's level, and what it refuses.
//
// The rules are this repo's judgement — nothing in the 17 cheat sheets defines
// simple / complex / hero — so these tests are as much a statement of the
// model as a check on it. See src/lib/level-guess.ts.
import { describe, it, expect } from "vitest";
import { guessLevelFromAttributes, guessLevelFromBill } from "@/lib/level-guess";

describe("guessLevelFromBill", () => {
  it("reads metalwork as complex, which is what the BWS boilerplates split on", () => {
    const guess = guessLevelFromBill({ itemDescription: "Sofa with brass base" });
    expect(guess?.level).toBe("complex");
    expect(guess?.reason).toContain("brass");
  });

  it("reads the word hero as hero", () => {
    expect(guessLevelFromBill({ itemDescription: "Hero armchair, lounge" })?.level).toBe("hero");
  });

  it("falls back to simple, and says it found nothing rather than claiming a finding", () => {
    const guess = guessLevelFromBill({ itemDescription: "Armchair" });
    expect(guess?.level).toBe("simple");
    expect(guess?.reason).toMatch(/no metalwork/i);
  });

  it("never reads the area, because a wing is not a level", () => {
    // TA_ISG_30_Signature Suites is a floor in the real pack. A rule reading
    // its name would make every item on it a hero.
    const guess = guessLevelFromBill({ itemDescription: "Armchair", boqCategory: "Signature Suites — feature wing" });
    expect(guess?.level).toBe("simple");
  });
});

describe("guessLevelFromAttributes", () => {
  const attribute = (labelRaw: string, valueRaw: string, sourcePage: number | null = null) => ({
    labelRaw,
    valueRaw,
    sourcePage,
  });

  it("finds the metalwork a bill did not mention, and names the page", () => {
    const guess = guessLevelFromAttributes([
      attribute("SOFA", "Yarn Tessarae YC04158 - 01"),
      attribute("LEGS", "Antique brass", 4),
    ]);
    expect(guess?.level).toBe("complex");
    expect(guess?.reason).toContain("page 4");
  });

  it("returns nothing rather than simple, because silence is not evidence", () => {
    // Overwriting the bill's reading with "these pages named no metal" would
    // throw away the only thing anybody has looked at.
    expect(guessLevelFromAttributes([attribute("SOFA FEET", "Dark tinted wood")])).toBeNull();
    expect(guessLevelFromAttributes([])).toBeNull();
  });

  it("prefers hero over complex when a drawing says both", () => {
    const guess = guessLevelFromAttributes([
      attribute("LEGS", "Antique brass"),
      attribute("ITEM", "Hero piece for the lobby"),
    ]);
    expect(guess?.level).toBe("hero");
  });
});
