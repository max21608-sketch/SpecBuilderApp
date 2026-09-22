// Pure tier — the exact step, kept apart from the fuzzy one.
import { describe, it, expect } from "vitest";
import {
  comparisonKey,
  defaultOption,
  isOffPalette,
  isOfferable,
  normalisePaletteValue,
  offPaletteNote,
  paletteForField,
  paletteFromRow,
  unheldPaletteNote,
  sentenceCasePaletteName,
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

describe("sentenceCasePaletteName", () => {
  it("lower-cases a name so it reads mid-sentence", () => {
    expect(sentenceCasePaletteName("Swivel mechanism")).toBe("swivel mechanism");
    expect(sentenceCasePaletteName("Indoor / Outdoor")).toBe("indoor / outdoor");
  });

  it("leaves a leading acronym alone, because BWS owns five of the eleven", () => {
    // "Not one of the bws timber finish palette options" is a typo on screen,
    // and this branch was unreachable for those five until they were seeded.
    expect(sentenceCasePaletteName("BWS timber finish palette")).toBe("BWS timber finish palette");
    expect(sentenceCasePaletteName("BWS stud palette")).toBe("BWS stud palette");
  });

  it("does not mistake a one-letter or empty first word for an acronym", () => {
    expect(sentenceCasePaletteName("A list")).toBe("a list");
    expect(sentenceCasePaletteName("")).toBe("");
  });
});

describe("paletteFromRow", () => {
  it("is the one fold from the database's column names to the domain type", () => {
    const palette = paletteFromRow({
      key: "bws_metal_finish",
      name: "BWS metal finish palette",
      owner: "bws",
      allows_free_text: true,
      source_note: "Captured 2026-09-22.",
      synced_at: "2026-09-22T00:00:00.000Z",
      options: [{ value: "BW Antiqued Brass", label: "BW Antiqued Brass", sortOrder: 1, isDefault: false, code: null }],
    });
    expect(palette.allowsFreeText).toBe(true);
    expect(palette.syncedAt).toBe("2026-09-22T00:00:00.000Z");
    expect(palette.options).toHaveLength(1);
  });

  it("reads a null option list as an empty one, not as undefined", () => {
    // A palette with no options is a real state every screen has to say out
    // loud. `undefined` there would make `isOfferable` throw instead of
    // answering, which is the branch that renders the sentence.
    const palette = paletteFromRow({
      key: "bws_glass_mirror",
      name: "BWS glass and mirror palette",
      owner: "bws",
      allows_free_text: true,
      source_note: null,
      synced_at: null,
      options: null,
    });
    expect(palette.options).toEqual([]);
    expect(isOfferable(palette)).toBe(false);
  });
});

describe("offPaletteNote", () => {
  it("is ONE sentence, said the same on the record screen and at intake", () => {
    expect(offPaletteNote(swivel)).toBe("Not one of the swivel mechanism options. Kept as written.");
  });

  it("keeps a leading acronym, because BWS owns the five the drawings reach", () => {
    expect(offPaletteNote(stud)).toBe("Not one of the BWS stud palette options. Kept as written.");
  });
});

// ============================================================================
// THE LINK: a staged drawing row carries a `spec_fields.id` and nothing else.
//
// The palette rides on the FIELD register the drawings screens already thread,
// because that is where the gate overlay keys it. Every row of brief 2.2's
// variance table is here.
// ============================================================================
describe("paletteForField", () => {
  const timber: Palette = {
    key: "bws_timber_finish",
    name: "BWS timber finish palette",
    owner: "bws",
    allowsFreeText: true,
    sourceNote: "Captured 2026-09-22.",
    syncedAt: "2026-09-22T00:00:00.000Z",
    options: [
      { value: "BW Oak Natural", label: "BW Oak Natural", sortOrder: 1, isDefault: false, code: null },
      { value: "BW Antiqued Brass", label: "BW Antiqued Brass", sortOrder: 2, isDefault: false, code: null },
    ],
  };
  const fields = [
    { id: "field-timber", palette: timber },
    { id: "field-stud", palette: stud },
    // COM 1 carries NO palette in the register, correctly: COM is free text in
    // BWS. A row on it must render as untouched free text.
    { id: "field-com1", palette: null },
    // A register a caller never read: `palette` absent is "this loader did not
    // look", which is not the same statement as "this field has no list".
    { id: "field-unknown" },
  ];

  it("finds the palette the field points at", () => {
    expect(paletteForField(fields, "field-timber")?.key).toBe("bws_timber_finish");
    expect(paletteForField(fields, "field-stud")?.key).toBe("bws_stud");
  });

  it("gives nothing for a row with no field at all — a note, an unplaced callout", () => {
    expect(paletteForField(fields, null)).toBeNull();
    expect(paletteForField(fields, undefined)).toBeNull();
    expect(paletteForField(fields, "")).toBeNull();
  });

  it("gives nothing for COM, and nothing for a field the register never described", () => {
    expect(paletteForField(fields, "field-com1")).toBeNull();
    expect(paletteForField(fields, "field-unknown")).toBeNull();
    expect(paletteForField(fields, "field-nowhere")).toBeNull();
  });

  it("degrades to nothing when the register was unavailable", () => {
    // `upgradeCalloutGuesses`' rule about an empty `fields` list, one layer
    // out: a caller with no register to hand renders the row as it did before
    // palettes reached this screen, rather than disagreeing with the confirm.
    expect(paletteForField([], "field-timber")).toBeNull();
  });
});

// ============================================================================
// THE MATCH AT INTAKE — the exact step, on the words real drawings print.
//
// Measured by `npm run palette:gap` on the sandbox, 2026-09-22: 0 of 81
// value-bearing callouts match. These are the ones it counted, and the point
// of the assertions is that NULL is the answer -- not the nearest option.
// ============================================================================
describe("a drawing's words against a BWS palette", () => {
  const metal: Palette = {
    key: "bws_metal_finish",
    name: "BWS metal finish palette",
    owner: "bws",
    allowsFreeText: true,
    sourceNote: "Captured 2026-09-22.",
    syncedAt: "2026-09-22T00:00:00.000Z",
    options: [
      { value: "BW Antiqued Brass", label: "BW Antiqued Brass", sortOrder: 1, isDefault: false, code: null },
      { value: "BW Polished Nickel", label: "BW Polished Nickel", sortOrder: 2, isDefault: false, code: null },
    ],
  };

  it("returns NULL for the designer's own wording, never the nearest option", () => {
    // The whole thesis. `Antique brass, machined` shares a word with
    // `BW Antiqued Brass` and is a different statement: one is a designer's
    // intent, the other is BW's manufacturing range. A fuzzy step here writes
    // a BW finish code the designer never specified into a field that ships to
    // BWS, and nothing downstream questions it.
    expect(normalisePaletteValue(metal, "Antique brass, machined")).toBeNull();
    expect(normalisePaletteValue(metal, "Antique brass, screw fixed")).toBeNull();
    expect(normalisePaletteValue(metal, "Powder coated steel, RAL 9005")).toBeNull();
    expect(normalisePaletteValue(metal, "Dark tinted wood")).toBeNull();
    expect(normalisePaletteValue(metal, "Ceruse finish oak")).toBeNull();
  });

  it("matches BWS's own wording whatever case and spacing it arrives in", () => {
    expect(normalisePaletteValue(metal, "BW ANTIQUED BRASS")).toBe("BW Antiqued Brass");
    expect(normalisePaletteValue(metal, "  bw  antiqued   brass ")).toBe("BW Antiqued Brass");
  });

  it("says nothing about a row that states nothing", () => {
    // A TBC callout carries no words to match. Not a miss, and nothing for a
    // screen to flag.
    expect(normalisePaletteValue(metal, null)).toBeNull();
    expect(isOffPalette(metal, null)).toBe(false);
    expect(isOffPalette(metal, "   ")).toBe(false);
  });
});
