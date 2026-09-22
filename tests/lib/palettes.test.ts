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
    { value: "None", label: "None", sortOrder: 1, isDefault: false, code: null },
    { value: "360 non-return", label: "360° non-return", sortOrder: 2, isDefault: false, code: null },
    { value: "180 return", label: "180° return", sortOrder: 3, isDefault: true, code: null },
  ],
};

// A BWS palette a gate points at that has NOT been synced yet. The real five
// were captured on 2026-09-22 and are no longer empty, so this stands in for
// the next one — the window between a gate row landing and somebody scraping
// the list. The unheld branch is still live code and still has to say so in
// words rather than render an empty dropdown.
const unsynced: Palette = {
  key: "bws_glass_mirror",
  name: "BWS glass and mirror palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "NOT HELD.",
  syncedAt: null,
  options: [],
};

// Stud spec, as db/seed/0011 seeds it from the capture: BWS prints its own
// code inside the label and the label keeps it whole.
const stud: Palette = {
  key: "bws_stud",
  name: "BWS stud palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "Captured 2026-09-22.",
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    {
      value: "Standard - French Natural | BWE Code: U1660-6031",
      label: "Standard - French Natural | BWE Code: U1660-6031",
      sortOrder: 1,
      isDefault: false,
      code: "U1660-6031",
    },
    {
      value: "Standard - Antique on Brass | BWE Code: U1660-9431 - Shank Oxidized",
      label: "Standard - Antique on Brass | BWE Code: U1660-9431 - Shank Oxidized",
      sortOrder: 2,
      isDefault: false,
      code: "U1660-9431",
    },
    { value: "Large - Polished Nickel", label: "Large - Polished Nickel", sortOrder: 3, isDefault: false, code: null },
  ],
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
    expect(isOfferable(unsynced)).toBe(false);
    expect(isOfferable(swivel)).toBe(true);
    expect(unheldPaletteNote(unsynced)).toContain("BWS owns this list");
  });

  it("never flags a value off-palette, because it has no palette to be off", () => {
    expect(isOffPalette(unsynced, "Antique gold, as sample")).toBe(false);
    expect(isOffPalette(swivel, "Stained oak")).toBe(true);
    expect(isOffPalette(swivel, "None")).toBe(false);
  });
});

describe("a default preselects a control and is not an answer", () => {
  it("is findable, and is only ever one", () => {
    expect(defaultOption(swivel)?.value).toBe("180 return");
    expect(defaultOption(unsynced)).toBeNull();
  });
});

describe("a BWS code inside the label", () => {
  it("resolves a document that quotes the code and nothing else", () => {
    // The reason the code is parsed into its own column at all. A drawing
    // saying "U1660-6031" is naming exactly one stud; this is a lookup on
    // BWS's own identifier, not a guess at the nearest option.
    expect(normalisePaletteValue(stud, "U1660-6031")).toBe(
      "Standard - French Natural | BWE Code: U1660-6031",
    );
    expect(normalisePaletteValue(stud, " u1660-9431 ")).toBe(
      "Standard - Antique on Brass | BWE Code: U1660-9431 - Shank Oxidized",
    );
  });

  it("still matches the whole label, which is what BWS shows", () => {
    expect(normalisePaletteValue(stud, "Standard - French Natural | BWE Code: U1660-6031")).toBe(
      "Standard - French Natural | BWE Code: U1660-6031",
    );
    expect(normalisePaletteValue(stud, "Large - Polished Nickel")).toBe("Large - Polished Nickel");
  });

  it("does not invent a code match for an option that has none", () => {
    // `code: null` must never compare equal to an empty key, or every
    // unrecognised value would resolve to the first uncoded option.
    expect(normalisePaletteValue(stud, "")).toBeNull();
    expect(normalisePaletteValue(stud, "U9999-0000")).toBeNull();
    expect(normalisePaletteValue(stud, "Standard - French Natural")).toBeNull();
  });
});

describe("comparisonKey", () => {
  it("is the one key every call site uses", () => {
    expect(comparisonKey("  Indoor  ")).toBe("indoor");
    expect(comparisonKey(null)).toBe("");
  });
});
