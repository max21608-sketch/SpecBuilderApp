// Reading a dimension out of an email, which writes prose.
//
// Every case here is taken from the real Panther email of 16 Sept 2026, or is
// a rule CLAUDE.md names as a trap.
import { describe, expect, it } from "vitest";
import { readDimension, sizeLineRefusal } from "@/lib/spec-dimensions";

describe("readDimension", () => {
  it("reads a labelled slot, its unit and the wording that qualifies it", () => {
    const reading = readDimension("Seat height", "445mm (measured to top of cushion, compressed)");
    expect(reading?.parts).toEqual([{ slot: "SH", figure: "445", slotSuggested: false }]);
    expect(reading?.unit).toBe("mm");
    expect(reading?.unitSource).toBe("stated");
    // Specification content. The figure is the derived reading; this is the
    // evidence, and dropping it would lose what "445" actually measures.
    expect(reading?.qualifier).toBe("(measured to top of cushion, compressed)");
  });

  it("reads an overall line into its three slots", () => {
    const reading = readDimension("Overall", "W660 x D685 x H680mm");
    expect(reading?.parts).toEqual([
      { slot: "W", figure: "660", slotSuggested: false },
      { slot: "D", figure: "685", slotSuggested: false },
      { slot: "H", figure: "680", slotSuggested: false },
    ]);
    expect(reading?.unit).toBe("mm");
    // Every slot was PREFIXED, so none of them is a positional guess.
    expect(reading?.parts.every((part) => !part.slotSuggested)).toBe(true);
  });

  it("badges a bare three-figure line as positional, never as stated", () => {
    const reading = readDimension("Overall dimensions", "80 x 70 x 90 cm");
    expect(reading?.parts.map((part) => part.slot)).toEqual(["W", "D", "H"]);
    expect(reading?.parts.every((part) => part.slotSuggested)).toBe(true);
    expect(reading?.unit).toBe("cm");
  });

  it("refuses ARM HEIGHT, which is a note and not a height", () => {
    // CLAUDE.md names this exactly: a substring rule maps ARM HEIGHT onto the
    // real height and destroys it. Null keeps it on the ordinary path.
    expect(readDimension("Arm height", "520mm from FFL")).toBeNull();
    expect(readDimension("Width seat", "420mm")).toBeNull();
  });

  it("never reads a unit from a figure's size", () => {
    // The whole dimension model exists to stop this. No unit stated, no unit.
    const reading = readDimension("Seat height", "445");
    expect(reading?.parts[0]?.figure).toBe("445");
    expect(reading?.unit).toBeNull();
    expect(reading?.unitSource).toBeNull();
  });

  it("does not mistake a following word for a unit", () => {
    const reading = readDimension("Seat height", "445 measured to the top");
    expect(reading?.unit).toBeNull();
    expect(reading?.qualifier).toBe("measured to the top");
  });

  it("keeps a whole-token unit apart from the wording after it", () => {
    const reading = readDimension("Height", "520mm from FFL");
    expect(reading?.unit).toBe("mm");
    expect(reading?.qualifier).toBe("from FFL");
  });

  it("records a TBC dimension as a real state, not a blank", () => {
    // S-101 prints "SH TBC" and CLAUDE.md keeps it as the page states it.
    const reading = readDimension("Seat height", "TBC");
    expect(reading?.tbc).toBe(true);
    expect(reading?.parts).toEqual([{ slot: "SH", figure: null, slotSuggested: false }]);
    expect(reading?.unit).toBeNull();
  });

  it("returns null for anything that is not a dimension", () => {
    expect(readDimension("Timber (legs and front rail)", "WD-05 ceruse finish oak")).toBeNull();
    expect(readDimension("Outside back", "UPH-07")).toBeNull();
    expect(readDimension("Fabric (A configuration)", "CLO003 A (Tibor Blob Amber Fern)")).toBeNull();
    expect(readDimension(null, "445mm")).toBeNull();
    expect(readDimension("Seat height", "")).toBeNull();
  });

  it("refuses a labelled slot whose value states no figure", () => {
    // "as existing" is an answer, but it is not a measurement, and inventing a
    // dimension row for it would put unparseable text in the millimetre group.
    expect(readDimension("Seat height", "as existing")).toBeNull();
    expect(readDimension("Width", "match the sofa")).toBeNull();
  });

  it("places nothing when an overall line claims one slot twice", () => {
    expect(readDimension("Overall", "W660 x W685")).toBeNull();
  });

  it("places nothing for two bare figures, which have no convention", () => {
    // Could be W x H, W x D or Dia x H. A 60/40 guess writes a height into a
    // depth and nothing downstream questions it.
    expect(readDimension("Overall", "660 x 685")).toBeNull();
  });

  it("does not read a value that merely contains an x as a dimension", () => {
    expect(readDimension("Outside back", "UPH-07 x 2 panels")).toBeNull();
  });
});

// ============================================================================
// IMPERIAL — Stage 2 variance row 1, the email half.
//
// An email writes prose, so this is the path where a compound was actually
// half-read: `splitFigure` takes a leading figure and then an optional unit
// word, and `1'6"` matched as a figure of ONE with `' 6"` kept as the
// qualifier. Plain inches are a different case and still proceed.
// ============================================================================
describe("readDimension and imperial", () => {
  it("reads plain inches as the unit they are", () => {
    const reading = readDimension("Seat height", '18" from FFL');
    expect(reading?.parts).toEqual([{ slot: "SH", figure: "18", slotSuggested: false }]);
    expect(reading?.unit).toBe("in");
    expect(reading?.unitSource).toBe("stated");
    expect(reading?.qualifier).toBe("from FFL");

    const spelt = readDimension("Width", "30 inches");
    expect(spelt?.parts[0]?.figure).toBe("30");
    expect(spelt?.unit).toBe("in");
  });

  it("refuses a feet-and-inches compound whole, rather than reading its feet", () => {
    // 1'6" is 457mm. Read as a 1 it is whatever unit somebody picks next.
    expect(readDimension("Seat height", "1'6\"")).toBeNull();
    expect(readDimension("Width", "5' 6\"")).toBeNull();
    expect(readDimension("Height", "4 ft 6 in")).toBeNull();
    expect(readDimension("Depth", "2ft")).toBeNull();
  });

  it("refuses a compound on an overall line too, and places nothing from it", () => {
    // Every part fails `parseDimensionFigure`, so no slot is placed and the
    // wording stays on the ordinary path for a person to re-state.
    expect(readDimension("Overall", "5'6\" x 2'4\" x 3'")).toBeNull();
  });
});

// ============================================================================
// A BILL'S SIZE LINE (plan any-bill, Step 8). The shapes are a pricing
// document's — "Sizes (mm):", "Spec size:", "Sizes(ft-in):" — and every value
// here is invented.
// ============================================================================
describe("readDimension — a bill's size line", () => {
  it("reads a size label with its unit in brackets, and prefixed parts in any order", () => {
    const reading = readDimension("Spec size", "D 410 X H 395 mm");
    expect(reading?.parts).toEqual([
      { slot: "D", figure: "410", slotSuggested: false },
      { slot: "H", figure: "395", slotSuggested: false },
    ]);
    expect(reading?.unit).toBe("mm");
    expect(readDimension("Sizes (mm)", "D310 x W870 x H790")?.parts.map((part) => part.slot)).toEqual(["D", "W", "H"]);
    expect(readDimension("Sizes(mm)", "W 610 x D 640 x H 720")?.unit).toBe("mm");
    expect(readDimension("Sizes (cm) - Overall", "Dia 118 x H 71")?.unit).toBe("cm");
  });

  it("reads SH 440/H 690 as two statements, a seat height and a height", () => {
    const reading = readDimension("Sizes (mm)", "W 612 x D 655 x SH 440/H 690");
    expect(reading?.parts.map((part) => [part.slot, part.figure])).toEqual([
      ["W", "612"],
      ["D", "655"],
      ["SH", "440"],
      ["H", "690"],
    ]);
    expect(readDimension("Sizes (mm)", "W 700 x D 690 x SH 430/ H 720")?.parts).toHaveLength(4);
  });

  it("keeps a prefix the five slots do not have as a note, never mapping it", () => {
    // L is not W. The W beside it is placed; the L is kept, verbatim.
    const reading = readDimension("Sizes(mm)", "L 520 x W 330 x H440");
    expect(reading?.parts.map((part) => part.slot)).toEqual(["W", "H"]);
    expect(reading?.qualifier).toBe("L 520");
    const oah = readDimension("Sizes(mm)", "W 1600 x D 470 x OAH 400 x SH 350");
    expect(oah?.parts.map((part) => part.slot)).toEqual(["W", "D", "SH"]);
    expect(oah?.qualifier).toBe("OAH 400");
  });

  it("stops at a component named partway along the line", () => {
    // The base's own W and D are not the table's: a D beside a Dia would be a conflict nobody meant.
    const reading = readDimension("Sizes (cm) - Overall", "Dia 118 x H 71 x Base: W 60 x D 60");
    expect(reading?.parts.map((part) => part.slot)).toEqual(["DIA", "H"]);
    expect(reading?.qualifier).toBe("Base: W 60 x D 60");
  });

  it("refuses a feet-and-inches line whole, and says why", () => {
    expect(readDimension("Sizes (ft-in)", 'W 3\'5" X D 1\'-9 1/2" X H 2\'-4"')).toBeNull();
    expect(readDimension("Sizes(ft-in)", "W 5'-6'' X D TBC X H 2'-4''")).toBeNull();
    expect(sizeLineRefusal("Sizes (ft-in)", 'W 3\'5" X D 1\'-9 1/2" X H 2\'-4"')).toMatch(/Feet and inches are not converted/);
    // Not a size line, or one that read: nothing to say.
    expect(sizeLineRefusal("Arm height", "1'6\"")).toBeNull();
    expect(sizeLineRefusal("Sizes (mm)", "W 600 x D 600 x H 700")).toBeNull();
  });

  it("converts plain inches, however the model escaped the inch mark", () => {
    for (const value of ['W 20" x D 23" x SH 17"', 'W 20"" x D 23"" x SH 17""']) {
      const reading = readDimension("Sizes (ft-in)", value);
      expect(reading?.parts.map((part) => [part.slot, part.figure])).toEqual([
        ["W", "20"],
        ["D", "23"],
        ["SH", "17"],
      ]);
      expect(reading?.unit).toBe("in");
      expect(reading?.imperial).toBe(true);
    }
    expect(readDimension("Sizes (mm)", "W 600 x D 600 x H 700")?.imperial).toBe(false);
  });

  it("refuses a line that states two units", () => {
    expect(readDimension("Sizes (mm)", 'W 20" x D 23"')).toBeNull();
  });

  it("does not read a size measured in another position as the item's size", () => {
    expect(readDimension("Sizes (cm) - Fully reclined", "W 190cm x D 70cm x H 25cm")).toBeNull();
  });

  it("never reads a proportion as a length", () => {
    // A fabric's "Width" row carrying its composition.
    expect(readDimension("Width", "24% PC, 20% WV, 56% CO")).toBeNull();
  });
});
