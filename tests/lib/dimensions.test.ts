// Pure tier. Every string in this file is Matthew's ruling of 2026-09-15,
// pinned. The fixtures reproduce the SHAPE of the Panther specification sheets
// with invented figures; no client document content is in this repo.
import { describe, it, expect } from "vitest";
import {
  composeDimensionCell,
  parseCombinedDimensions,
  parseDimensionFigure,
  toMillimetres,
  type DimensionRow,
} from "@/lib/dimensions";
import { normaliseDimensionSlot } from "@/lib/spec-vocab";
import type { AttributeUnit } from "@/lib/spec-vocab";
import type { DimensionSlot } from "@/lib/spec-vocab";

const row = (
  slot: DimensionSlot,
  value: string | null,
  unit: AttributeUnit | null = "mm",
  overrides: Partial<DimensionRow> = {},
): DimensionRow => ({ slot, value, unit, state: "confirmed", sortOrder: 0, ...overrides });

const cell = (rows: DimensionRow[]) => composeDimensionCell(rows.map((r, i) => ({ ...r, sortOrder: r.sortOrder || i })));

describe("normaliseDimensionSlot", () => {
  it("folds the spellings the real documents use", () => {
    expect(normaliseDimensionSlot("WIDTH")).toBe("W");
    expect(normaliseDimensionSlot("w")).toBe("W");
    expect(normaliseDimensionSlot("Overall Width")).toBe("W");
    expect(normaliseDimensionSlot("DEPTH")).toBe("D");
    expect(normaliseDimensionSlot("HEIGHT")).toBe("H");
    expect(normaliseDimensionSlot("Ht")).toBe("H");
  });

  it("maps both spellings of seat height", () => {
    // The Panther S-100 template prints "HEIGHT SEAT"; the trade says "seat height".
    expect(normaliseDimensionSlot("HEIGHT SEAT")).toBe("SH");
    expect(normaliseDimensionSlot("Seat Height")).toBe("SH");
    expect(normaliseDimensionSlot("SH")).toBe("SH");
  });

  it("reads the diameter symbols", () => {
    expect(normaliseDimensionSlot("Dia.")).toBe("DIA");
    expect(normaliseDimensionSlot("DIAMETER")).toBe("DIA");
    expect(normaliseDimensionSlot("Ø")).toBe("DIA");
    expect(normaliseDimensionSlot("⌀")).toBe("DIA");
  });

  it("refuses the labels a substring rule would destroy a real dimension with", () => {
    // All five are printed verbatim on the Panther S-100 sheet, beside the
    // width and height a substring match would overwrite with them.
    expect(normaliseDimensionSlot("WIDTH SEAT")).toBeNull();
    expect(normaliseDimensionSlot("DEPTH SEAT")).toBeNull();
    expect(normaliseDimensionSlot("WIDTH BACK")).toBeNull();
    expect(normaliseDimensionSlot("DEPTH BACK")).toBeNull();
    expect(normaliseDimensionSlot("ARM HEIGHT")).toBeNull();
  });

  it("refuses a positional placeholder and anything unrecognised", () => {
    expect(normaliseDimensionSlot("Dimension 3")).toBeNull();
    expect(normaliseDimensionSlot("")).toBeNull();
    expect(normaliseDimensionSlot(null)).toBeNull();
    expect(normaliseDimensionSlot(42)).toBeNull();
  });
});

describe("parseDimensionFigure", () => {
  it("reads one figure, with or without a TBC beside it", () => {
    expect(parseDimensionFigure("1900")).toEqual({ figure: 1900, tbcInline: false });
    expect(parseDimensionFigure("1520 TBC")).toEqual({ figure: 1520, tbcInline: true });
    expect(parseDimensionFigure("TBC")).toEqual({ figure: null, tbcInline: true });
  });

  it("refuses a combined line rather than inventing a number from it", () => {
    // The trap: stripping non-digits turned "190 x 79" into 19079, which is
    // large enough to vote millimetres and flip a whole page to the wrong unit.
    expect(parseDimensionFigure("190 x 79")).toEqual({ figure: null, tbcInline: false });
    expect(parseDimensionFigure("approx 720-740")).toEqual({ figure: null, tbcInline: false });
    expect(parseDimensionFigure(null)).toEqual({ figure: null, tbcInline: false });
  });
});

describe("parseCombinedDimensions", () => {
  it("reads three bare figures as W x D x H in printed order, and says it assumed", () => {
    // The Panther S-203 template: no labels, centimetres, order carries the
    // meaning. The badge is what makes the assumption checkable.
    const parsed = parseCombinedDimensions("80 x 70 x 90 cm");
    expect(parsed.unitRaw).toBe("cm");
    expect(parsed.parts.map((p) => [p.slot, p.value, p.slotSuggested])).toEqual([
      ["W", "80", true],
      ["D", "70", true],
      ["H", "90", true],
    ]);
  });

  it("takes a printed prefix exactly, and does not call it a guess", () => {
    const parsed = parseCombinedDimensions("W1520 TBC x D560 x H1005 mm");
    expect(parsed.unitRaw).toBe("mm");
    expect(parsed.parts.map((p) => [p.slot, p.value, p.tbc, p.slotSuggested])).toEqual([
      ["W", "1520 TBC", true, false],
      ["D", "560", false, false],
      ["H", "1005", false, false],
    ]);
  });

  it("keeps Dia. as a slot rather than mistaking it for a unit", () => {
    const parsed = parseCombinedDimensions("Dia.460 x H450mm");
    expect(parsed.unitRaw).toBe("mm");
    expect(parsed.parts.map((p) => [p.slot, p.value])).toEqual([
      ["DIA", "460"],
      ["H", "450"],
    ]);
  });

  it("refuses two bare figures, which could be W x H, W x D or Dia x H", () => {
    const parsed = parseCombinedDimensions("80 x 90");
    expect(parsed.parts.map((p) => p.slot)).toEqual([null, null]);
  });

  it("refuses four or more bare figures, which have no convention at all", () => {
    const parsed = parseCombinedDimensions("80 x 70 x 90 x 60");
    expect(parsed.parts.map((p) => p.slot)).toEqual([null, null, null, null]);
  });

  it("resolves only the prefixed parts of a mixed line", () => {
    // Mixing an explicit reading with a positional one is how the positional
    // half inherits the explicit half's credibility.
    const parsed = parseCombinedDimensions("W1520 x 560 x H1005");
    expect(parsed.parts.map((p) => p.slot)).toEqual(["W", null, "H"]);
    expect(parsed.parts.every((p) => !p.slotSuggested)).toBe(true);
  });

  it("returns nothing for an empty line", () => {
    expect(parseCombinedDimensions("")).toEqual({ parts: [], unitRaw: null });
  });
});

describe("toMillimetres", () => {
  it("converts each unit in the vocabulary", () => {
    expect(toMillimetres("1900", "mm")).toEqual({ ok: true, mm: 1900 });
    expect(toMillimetres("190", "cm")).toEqual({ ok: true, mm: 1900 });
    expect(toMillimetres("2.5", "m")).toEqual({ ok: true, mm: 2500 });
    expect(toMillimetres("18", "in")).toEqual({ ok: true, mm: 457 });
  });

  it("refuses what it cannot read", () => {
    expect(toMillimetres("approx 720-740", "mm")).toEqual({ ok: false, reason: "not_numeric" });
  });
});

describe("composeDimensionCell", () => {
  it("writes W x D x H with the unit once at the end", () => {
    expect(cell([row("W", "1900"), row("D", "790"), row("H", "720")]).text).toBe("W1900 x D790 x H720mm");
  });

  it("converts centimetres and metres to millimetres", () => {
    expect(cell([row("W", "190", "cm"), row("D", "79", "cm"), row("H", "72", "cm")]).text).toBe("W1900 x D790 x H720mm");
    expect(cell([row("W", "2.5", "m"), row("D", "0.79", "m"), row("H", "0.72", "m")]).text).toBe("W2500 x D790 x H720mm");
  });

  it("appends seat height as SH", () => {
    expect(cell([row("W", "2925"), row("D", "1685"), row("H", "825"), row("SH", "420")]).text).toBe(
      "W2925 x D1685 x H825 x SH420mm",
    );
  });

  it("writes a round item as Dia. in place of W x D", () => {
    expect(cell([row("DIA", "460"), row("H", "450")]).text).toBe("Dia.460 x H450mm");
  });

  it("keeps TBC against the dimension it belongs to", () => {
    expect(cell([row("W", "1520", "mm", { state: "tbc" }), row("D", "560"), row("H", "1005")]).text).toBe(
      "W1520 TBC x D560 x H1005mm",
    );
    // The page's own word, not a reviewer's state.
    expect(cell([row("W", "1520 TBC"), row("D", "560"), row("H", "1005")]).text).toBe("W1520 TBC x D560 x H1005mm");
  });

  it("keeps the unit against the last FIGURE, not the end of the string", () => {
    // Found in the browser, not here: every fixture above happens to put the
    // TBC first, and appending "mm" to the finished string then read
    // "SH440 TBCmm". The unit belongs to the number.
    expect(cell([row("W", "190", "cm"), row("D", "79", "cm"), row("H", "72", "cm"), row("SH", "440", "mm", { state: "tbc" })]).text).toBe(
      "W1900 x D790 x H720 x SH440mm TBC",
    );
  });

  it("writes a TBC with no figure as the slot and TBC", () => {
    expect(cell([row("W", null, "mm", { state: "tbc" }), row("D", "560"), row("H", "1005")]).text).toBe(
      "W TBC x D560 x H1005mm",
    );
  });

  it("never converts a value that is not a measurement, and says so", () => {
    const result = cell([row("W", "1900"), row("D", "790"), row("H", "approx 720-740")]);
    expect(result.text).toBe('W1900 x D790mm [H "approx 720-740" — not a number]');
    expect(result.problems.map((p) => p.code)).toEqual(["not_numeric"]);
  });

  it("never claims millimetres for a figure with no unit", () => {
    const result = cell([row("W", "1900"), row("D", "790"), row("H", "720", null)]);
    expect(result.text).toBe("W1900 x D790mm [H 720 — no unit]");
    expect(result.problems.map((p) => p.code)).toEqual(["no_unit"]);
  });

  it("suppresses a width and depth recorded alongside a diameter, and names the conflict", () => {
    // Suppressed here, still listed long-form on the export's second sheet.
    const result = cell([row("DIA", "460"), row("W", "500"), row("D", "500"), row("H", "450")]);
    expect(result.text).toBe("Dia.460 x H450mm [conflict: W500mm, D500mm also recorded — Dia. replaces W and D]");
    expect(result.problems.map((p) => p.code)).toEqual(["dia_conflict"]);
  });

  it("takes the first of two values in one slot and flags it", () => {
    const result = composeDimensionCell([
      { slot: "W", value: "1900", unit: "mm", state: "confirmed", sortOrder: 0 },
      { slot: "W", value: "1850", unit: "mm", state: "confirmed", sortOrder: 1 },
    ]);
    expect(result.text).toBe("W1900mm");
    expect(result.problems.map((p) => p.code)).toEqual(["duplicate_slot"]);
  });

  it("renders a lone dimension, and nothing at all for no dimensions", () => {
    expect(cell([row("SH", "420")]).text).toBe("SH420mm");
    expect(cell([row("H", "720")]).text).toBe("H720mm");
    expect(cell([]).text).toBe("");
  });
});

// ---- the note a person types beside the five slots (0034) ------------------
//
// Matthew, 2026-09-18: "you could say L, 1250 bracket L-shaped return ... a
// text box for qualifying stuff, or for adding in stuff that doesn't quite fit
// into the structured boxes". One per record, about the WHOLE cell, never read
// off a page and never parsed back.
describe("composeDimensionCell with a typed note", () => {
  const note = (rows: DimensionRow[], text: string | null) =>
    composeDimensionCell(rows.map((r, i) => ({ ...r, sortOrder: r.sortOrder || i })), text);

  it("writes it in brackets after the millimetre group", () => {
    expect(note([row("W", "1900"), row("D", "790"), row("H", "720")], "1250 L-shaped return").text).toBe(
      "W1900 x D790 x H720mm (1250 L-shaped return)",
    );
  });

  it("goes after the seat height, not between the figures", () => {
    expect(note([row("W", "2925"), row("D", "1685"), row("H", "825"), row("SH", "420")], "left hand facing").text).toBe(
      "W2925 x D1685 x H825 x SH420mm (left hand facing)",
    );
  });

  it("is the whole cell where no dimension has been recorded, and says so", () => {
    const result = note([], "1250 L-shaped return");
    expect(result.text).toBe("(1250 L-shaped return)");
    expect(result.problems.map((p) => p.code)).toEqual(["note_only"]);
    expect(result.problems[0]?.message).toMatch(/not yet recorded/i);
  });

  it("does not flag note_only where there are figures to qualify", () => {
    expect(note([row("W", "1900")], "front edge only").problems).toEqual([]);
  });

  it("keeps a TBC slot beside it", () => {
    expect(
      note([row("W", "1900"), row("D", null, "mm", { state: "tbc" }), row("H", "720")], "seat depth still open").text,
    ).toBe("W1900 x D TBC x H720mm (seat depth still open)");
  });

  it("keeps a note verbatim, brackets and all — it is never parsed", () => {
    // A note clever enough to be re-read is a note this app can rewrite. The
    // person's own punctuation reaches BWS exactly as typed.
    expect(note([row("W", "1900")], "1250 (measured to the return)").text).toBe(
      "W1900mm (1250 (measured to the return))",
    );
  });

  it("trims the ends and nothing else, and an empty note changes nothing", () => {
    expect(note([row("W", "1900")], "  L-shaped  return  ").text).toBe("W1900mm (L-shaped  return)");
    expect(note([row("W", "1900")], "   ").text).toBe("W1900mm");
    expect(note([row("W", "1900")], null).text).toBe("W1900mm");
    expect(note([], null).text).toBe("");
  });

  it("goes last, after a bracket saying what could not be derived", () => {
    // The square brackets are this app reporting a problem; the round ones are
    // a person speaking. The note qualifies the whole statement, so it ends it.
    expect(note([row("W", "1900"), row("H", "720", null)], "returns at 90 degrees").text).toBe(
      "W1900mm [H 720 — no unit] (returns at 90 degrees)",
    );
  });
});
