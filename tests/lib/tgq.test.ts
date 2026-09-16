// Which questions hold up a quote. Pure, so this runs in CI without a database.
import { describe, expect, it } from "vitest";
import { questionTier, questionTierOrNull, TIER_LABELS } from "@/lib/tgq";
import { ITEM_LEVELS, normaliseItemLevel } from "@/lib/spec-vocab";

const all = { tgqLevels: ["simple", "complex", "hero"] };
const none = { tgqLevels: [] as string[] };
const heroOnly = { tgqLevels: ["hero"] };
const notHero = { tgqLevels: ["simple", "complex"] };

describe("questionTier", () => {
  it("blocks the quote at every level while the workbook has struck nothing out", () => {
    // Today's position, and the seed default: everything is required of
    // everything. Matthew's answers only ever remove a level.
    for (const level of ITEM_LEVELS) {
      expect(questionTier(all, level)).toBe("to_quote");
    }
  });

  it("never blocks a quote when the question is needed at no level", () => {
    for (const level of ITEM_LEVELS) {
      expect(questionTier(none, level)).toBe("later");
    }
  });

  it("blocks only the levels the question names", () => {
    expect(questionTier(heroOnly, "hero")).toBe("to_quote");
    expect(questionTier(heroOnly, "simple")).toBe("later");
    expect(questionTier(heroOnly, "complex")).toBe("later");

    expect(questionTier(notHero, "simple")).toBe("to_quote");
    expect(questionTier(notHero, "complex")).toBe("to_quote");
    expect(questionTier(notHero, "hero")).toBe("later");
  });
});

describe("questionTierOrNull", () => {
  // The whole reason the strict function refuses a null level: reading an
  // unset level either way is the app answering a question only a person can.
  it("returns null for a record nobody has classified, rather than picking a side", () => {
    expect(questionTierOrNull(all, null)).toBeNull();
    expect(questionTierOrNull(none, null)).toBeNull();
  });

  it("agrees with questionTier once a level is set", () => {
    for (const level of ITEM_LEVELS) {
      expect(questionTierOrNull(heroOnly, level)).toBe(questionTier(heroOnly, level));
    }
  });
});

describe("normaliseItemLevel", () => {
  it("accepts the vocabulary, case and space insensitively", () => {
    expect(normaliseItemLevel(" Hero ")).toBe("hero");
    expect(normaliseItemLevel("SIMPLE")).toBe("simple");
  });

  // BWS's boilerplates call the middle level "with Metalwork" on upholstery.
  // That is a display name for a category, not a fourth level, and guessing
  // which it maps to would put a gate on a guess.
  it("refuses anything outside the three, including a near miss", () => {
    expect(normaliseItemLevel("with Metalwork")).toBeNull();
    expect(normaliseItemLevel("hero-ish")).toBeNull();
    expect(normaliseItemLevel("")).toBeNull();
    expect(normaliseItemLevel(null)).toBeNull();
    expect(normaliseItemLevel(3)).toBeNull();
  });
});

describe("TIER_LABELS", () => {
  it("names both halves the way the screens and the email do", () => {
    expect(TIER_LABELS.to_quote).toBe("Needed to quote");
    expect(TIER_LABELS.later).toBe("Also outstanding");
  });
});
