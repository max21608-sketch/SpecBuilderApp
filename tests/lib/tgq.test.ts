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

describe("questionTier with Matthew's matrix", () => {
  // His matrix puts these at TGQ for the seating categories, read off the
  // sandbox on 2026-09-18: BWS fields 3, 6, 130, 191, 232 and four id-less
  // questions that live on `requirements.local_key`.
  const matrix = {
    fields: new Set([3, 6, 130, 191, 232]),
    localKeys: new Set(["product_code", "item_name", "designer_reference", "spec_notes"]),
  };

  it("uses HIS matrix where he wrote one, and ignores tgq_levels there", () => {
    // `tgq_levels` still says all three levels — the 0019 placeholder — and is
    // not consulted, which is the whole point.
    const dimensions = { tgqLevels: ["simple", "complex", "hero"], jsonId: 3, localKey: null };
    expect(questionTier(dimensions, "complex", matrix)).toBe("to_quote");

    // A field the placeholder marks as blocking and HIS matrix does not.
    const stitching = { tgqLevels: ["simple", "complex", "hero"], jsonId: 77, localKey: null };
    expect(questionTier(stitching, "complex", matrix)).toBe("later");
  });

  it("reaches his matrix by local key as well as by BWS field", () => {
    // `kind = 'readiness'` questions have no BWS column, which is what
    // `requirements.local_key` is for (db/seed/0009).
    const readiness = { tgqLevels: [], jsonId: null, localKey: "product_code" };
    expect(questionTier(readiness, "simple", matrix)).toBe("to_quote");

    const other = { tgqLevels: ["simple"], jsonId: null, localKey: "headboard_fitted" };
    expect(questionTier(other, "simple", matrix)).toBe("later");
  });

  it("needs no level where his matrix applies", () => {
    // His matrix is per CATEGORY and carries no level column, so a record
    // nobody has levelled yet is still tiered — and a chase for it is no
    // longer blocked for a reason that does not apply to it.
    const dimensions = { tgqLevels: [], jsonId: 3, localKey: null };
    expect(questionTierOrNull(dimensions, null, matrix)).toBe("to_quote");
  });

  it("falls back to tgq_levels for a category he has not written", () => {
    // Null matrix is the discriminator, and it means "he has not covered this
    // category" — NEVER "nothing blocks a quote here". A cabinetry item
    // reporting zero blockers would not be ready, it would be unwritten.
    const q = { tgqLevels: ["hero"], jsonId: 3, localKey: null };
    expect(questionTier(q, "hero", null)).toBe("to_quote");
    expect(questionTier(q, "simple", null)).toBe("later");
    // And the fallback still refuses to answer without a level.
    expect(questionTierOrNull(q, null, null)).toBeNull();
  });

  it("treats a covered category with nothing at TGQ as an answer, not a gap", () => {
    // `loadTgqMatrices` puts every mapped category in the map even when none
    // of its rows is at TGQ, because "he wrote this one and nothing in it
    // blocks a quote" is a real statement.
    const empty = { fields: new Set<number>(), localKeys: new Set<string>() };
    const q = { tgqLevels: ["simple", "complex", "hero"], jsonId: 3, localKey: null };
    expect(questionTier(q, "simple", empty)).toBe("later");
  });

  it("is unchanged when no matrix is passed at all", () => {
    // Every existing caller that has not been given a matrix keeps the 0019
    // behaviour, so adding the parameter changed nothing by itself.
    const q = { tgqLevels: ["simple"] };
    expect(questionTier(q, "simple")).toBe("to_quote");
    expect(questionTier(q, "hero")).toBe("later");
  });
});
