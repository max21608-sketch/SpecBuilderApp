// Pure tier — the exact step, kept apart from the fuzzy one.
import { describe, it, expect } from "vitest";
import {
  comparisonKey,
  defaultOption,
  isOffPalette,
  isOfferable,
  normalisePaletteValue,
  unheldPaletteNote,
  type Palette,
} from "@/lib/palettes";

const swivel: Palette = {
  key: "swivel",
  name: "Swivel mechanism",
  owner: "app",
  allowsFreeText: false,
  sourceNote: null,
  syncedAt: null,
  options: [
    { value: "None", label: "None", sortOrder: 1, isDefault: false },
    { value: "360 non-return", label: "360° non-return", sortOrder: 2, isDefault: false },
    { value: "180 return", label: "180° return", sortOrder: 3, isDefault: true },
  ],
};

const timber: Palette = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "NOT HELD.",
  syncedAt: null,
  options: [],
};

describe("normalisePaletteValue — folds spelling, never meaning", () => {
  it("matches on the value and on the label", () => {
    expect(normalisePaletteValue(swivel, "None")).toBe("None");
    expect(normalisePaletteValue(swivel, "360° non-return")).toBe("360 non-return");
  });

  it("folds case, whitespace, the degree sign and every kind of dash", () => {
    expect(normalisePaletteValue(swivel, "  360  NON–RETURN ")).toBe("360 non-return");
    expect(normalisePaletteValue(swivel, "180° RETURN")).toBe("180 return");
  });

  it("does NOT fold a dash into a space, because that would merge two spellings somebody kept apart", () => {
    // "Deliberately not clever" is the rule. normaliseFinishCode keeps CH-01.1
    // and CH-01-1 apart for the same reason: a normaliser clever enough to
    // merge two spellings is clever enough to merge two things somebody meant
    // to keep separate, and there is no way back.
    expect(normalisePaletteValue(swivel, "180—return")).toBeNull();
  });

  it("returns NULL on anything it does not hold, rather than the nearest option", () => {
    // The whole safety property. "Swivel" is nearer to every option than to
    // nothing, and picking one would be a confident wrong answer with a seed
    // file's authority behind it.
    expect(normalisePaletteValue(swivel, "Swivel")).toBeNull();
    expect(normalisePaletteValue(swivel, "360 return")).toBeNull();
    expect(normalisePaletteValue(swivel, "")).toBeNull();
    expect(normalisePaletteValue(swivel, null)).toBeNull();
  });
});

describe("a palette this app does not hold", () => {
  it("is not offerable, and says why in words", () => {
    expect(isOfferable(timber)).toBe(false);
    expect(isOfferable(swivel)).toBe(true);
    expect(unheldPaletteNote(timber)).toContain("BWS owns this list");
  });

  it("never flags a value off-palette, because it has no palette to be off", () => {
    expect(isOffPalette(timber, "Stained oak, 10% sheen")).toBe(false);
    expect(isOffPalette(swivel, "Stained oak")).toBe(true);
    expect(isOffPalette(swivel, "None")).toBe(false);
  });
});

describe("a default preselects a control and is not an answer", () => {
  it("is findable, and is only ever one", () => {
    expect(defaultOption(swivel)?.value).toBe("180 return");
    expect(defaultOption(timber)).toBeNull();
  });
});

describe("comparisonKey", () => {
  it("is the one key every call site uses", () => {
    expect(comparisonKey("  Indoor  ")).toBe("indoor");
    expect(comparisonKey(null)).toBe("");
  });
});
