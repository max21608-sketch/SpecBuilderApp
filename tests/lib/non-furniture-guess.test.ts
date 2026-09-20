// Pure tier. The fixtures are SYNTHETIC: they reproduce the SHAPE of the real
// pilot bill's packaging and delivery lines — a code prefix, a plain
// description, a totals row under the items — and carry no client data.
import { describe, it, expect } from "vitest";
import type { SheetData } from "read-excel-file/node";
import { guessNonFurniture, nonFurnitureOf, linesToIgnore } from "@/lib/non-furniture-guess";
import { guessLevelFromBill } from "@/lib/level-guess";
import { parseBoqSheets } from "@/lib/boq-import";

describe("guessNonFurniture — the CODE rule", () => {
  it("fires on each listed prefix, and says which one", () => {
    for (const code of ["PACK-01", "DEL 2", "DELIV/3", "INST-1", "FREIGHT1", "SHIP-9", "CRATE-4"]) {
      const guess = guessNonFurniture({ code, itemDescription: "Sundries" });
      expect(guess, code).not.toBeNull();
      expect(guess?.rule).toBe("code");
    }
    expect(guessNonFurniture({ code: "pack-01", itemDescription: "x" })?.matched).toEqual(["PACK"]);
  });

  it("reads the LEADING RUN OF LETTERS, never a `startsWith`", () => {
    // The trap the whole-token rule exists for: `INST` is on the list and
    // `INSTRUMENT` is a real thing to build.
    expect(guessNonFurniture({ code: "INSTRUMENT-1", itemDescription: "Instrument cabinet" })).toBeNull();
    expect(guessNonFurniture({ code: "DESK-01", itemDescription: "Desk" })).toBeNull();
    expect(guessNonFurniture({ code: "PACKARD-2", itemDescription: "Side table" })).toBeNull();
  });

  it("VARIANCE (b): DEL-01 Delivery table fires on the CODE, not the description", () => {
    // A real delivery-area table. The suggestion is right to appear and the
    // reviewer is right to decline it — which only works because the evidence
    // names the code, so what they are declining is visible.
    const guess = guessNonFurniture({ code: "DEL-01", itemDescription: "Delivery table" });
    expect(guess?.rule).toBe("code");
    expect(guess?.matched).toEqual(["DEL"]);
    expect(guess?.reason).toContain("DEL");
    // The description is NOT what fired, so nothing in the reason quotes it.
    expect(guess?.reason).not.toContain("description");
  });
});

describe("guessNonFurniture — the WORDS rule", () => {
  it("matches whole words, folded, and names them", () => {
    const guess = guessNonFurniture({ code: "X-900", itemDescription: "Packaging and Delivery to site" });
    expect(guess?.rule).toBe("words");
    expect(guess?.matched).toEqual(["packaging", "delivery"]);
    expect(guess?.reason).toContain("packaging");
  });

  it("never matches inside a longer word", () => {
    // `storage` is on the list; a storage unit is furniture and a shipping
    // trunk is a thing somebody ordered.
    expect(guessNonFurniture({ code: "X-1", itemDescription: "Transporter bench" })).toBeNull();
    expect(guessNonFurniture({ code: "X-2", itemDescription: "Installations" })).toBeNull();
  });

  it("is the rule ONLY when the code decided nothing", () => {
    expect(guessNonFurniture({ code: null, itemDescription: "Crating for the sofa" })?.rule).toBe("words");
    expect(guessNonFurniture({ code: "12A", itemDescription: "Freight" })?.rule).toBe("words");
  });
});

describe("guessNonFurniture — the category is SUPPORTING evidence only", () => {
  it("never fires on its own", () => {
    // A bench with a name no alias knows. This is the whole reason the third
    // signal cannot decide anything: an unmatched category is the NORMAL state
    // of an unusual piece of furniture.
    expect(guessNonFurniture({ code: "BN-04", itemDescription: "Sgabello", categoryStatus: "none" })).toBeNull();
  });

  it("is appended to a reason that already fired", () => {
    const withIt = guessNonFurniture({ code: "PACK-01", itemDescription: "Sundries", categoryStatus: "none" });
    const without = guessNonFurniture({ code: "PACK-01", itemDescription: "Sundries", categoryStatus: "suggested" });
    expect(withIt?.reason).toContain("no category matched it");
    expect(without?.reason).not.toContain("category");
    // It changes neither the rule nor what was matched.
    expect(withIt?.rule).toBe(without?.rule);
    expect(withIt?.matched).toEqual(without?.matched);
  });
});

describe("VARIANCE (a): a bill where every line is furniture", () => {
  it("suggests nothing, so there is no set to ignore and no control", () => {
    const lines = [
      { index: 0, code: "S-100", itemDescription: "Sofa", ignored: false },
      { index: 1, code: "S-201", itemDescription: "Armchair", ignored: false },
      { index: 2, code: "UP-100", itemDescription: "Headboard", ignored: false },
    ];
    expect(lines.map((line) => guessNonFurniture(line))).toEqual([null, null, null]);
    expect(linesToIgnore(lines)).toEqual([]);
  });
});

describe("VARIANCE (c): a subtotal or section row", () => {
  // MEASURED RATHER THAN ASSUMED, and the answer is half what was expected.
  // `parseBoqSheets` skips a row carrying neither a code nor a description —
  // so a bare totals row never reaches the guess at all. A totals row whose
  // DESCRIPTION column says "TOTAL" is staged as a line, and always has been
  // (`boq-import.test.ts`: "four items + the TOTAL row, which has a
  // description"). That is a separate question from this one, and what matters
  // here is that the suggester fires on NEITHER shape: it suggests only on a
  // packaging code or a packaging word, and "TOTAL" is neither.
  const data: SheetData = [
    ["Code", "Item Description", "Total Qty"],
    ["S-100", "Sofa", 4],
    [null, null, 4],
    [null, "TOTAL", 4],
    [null, "Subtotal — seating", 4],
  ];

  it("the bare totals row never reaches the guess", () => {
    const parsed = parseBoqSheets([{ sheet: "Bill", data }]);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.sheets[0]?.skippedRows).toBe(1);
  });

  it("and the suggester fires on none of what IS staged", () => {
    const parsed = parseBoqSheets([{ sheet: "Bill", data }]);
    if (!parsed.ok) throw new Error(parsed.error);
    const lines = parsed.sheets[0]?.lines ?? [];
    expect(lines.map((line) => line.itemDescription)).toEqual(["Sofa", "TOTAL", "Subtotal — seating"]);
    expect(lines.map((line) => guessNonFurniture(line))).toEqual([null, null, null]);
  });
});

describe("VARIANCE (d): a 300-line bill with 40 suggested", () => {
  const lines = Array.from({ length: 300 }, (_, index) => ({
    index,
    code: index % 15 === 0 ? `DEL-${index}` : `S-${index}`,
    itemDescription: index % 15 === 0 ? "Delivery to site" : "Armchair",
    ignored: false,
  }));

  it("linesToIgnore names exactly the suggested, still-included lines", () => {
    const set = linesToIgnore(lines);
    expect(set).toHaveLength(20);
    expect(set.every((line) => line.index % 15 === 0)).toBe(true);
  });

  it("leaves out a line somebody had already unticked", () => {
    const withUnticked = lines.map((line) => (line.index === 0 ? { ...line, ignored: true } : line));
    const set = linesToIgnore(withUnticked);
    expect(set).toHaveLength(19);
    expect(set.some((line) => line.index === 0)).toBe(false);
  });

  it("leaves out a line nothing was suggested about, however many there are", () => {
    expect(linesToIgnore(lines).some((line) => line.itemDescription === "Armchair")).toBe(false);
  });
});

describe("nonFurnitureOf — the staged JSON is data from the past", () => {
  const line = { index: 0, code: "PACK-01", itemDescription: "Packaging", ignored: false };

  it("answers the question where a bill was staged before it existed", () => {
    expect(nonFurnitureOf(line)?.rule).toBe("code");
  });

  it("uses the stored answer where there is one, including a stored no", () => {
    expect(nonFurnitureOf({ ...line, nonFurnitureSuggested: null })).toBeNull();
    const stored = { reason: "stored", rule: "words" as const, matched: ["delivery"] };
    expect(nonFurnitureOf({ ...line, nonFurnitureSuggested: stored })).toBe(stored);
  });
});

describe("a level is not guessed for a line that may not be furniture", () => {
  it("returns null rather than Simple, so nothing is stored and nothing is offered", () => {
    // The defect this closes: `PACK-01` read "Simple · the bill names no
    // metalwork", which is the app asserting a complexity for a thing that is
    // not an item.
    expect(guessLevelFromBill({ code: "PACK-01", itemDescription: "Packaging" })).toBeNull();
    expect(guessLevelFromBill({ code: "X-1", itemDescription: "Delivery to site" })).toBeNull();
  });

  it("still guesses for everything else, unchanged", () => {
    expect(guessLevelFromBill({ code: "S-100", itemDescription: "Sofa with brass base" })?.level).toBe("complex");
    expect(guessLevelFromBill({ code: "S-201", itemDescription: "Armchair" })?.level).toBe("simple");
    // A delivery TABLE is furniture the reviewer has not ruled on yet, so the
    // level stays unguessed until they decline the other question. That is the
    // cost of reading the code first, and it is one click.
    expect(guessLevelFromBill({ code: "DEL-01", itemDescription: "Delivery table" })).toBeNull();
  });
});
