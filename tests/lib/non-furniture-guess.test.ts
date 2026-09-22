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

// ============================================================================
// A SUBTOTAL ROW THAT CARRIES TEXT — FIU 2026-09-21.
//
// A code-less subtotal row is already skipped and counted. One that carries
// text in the description column became a spec record with the subtotal's own
// FIGURE as its quantity, and nothing suggested ignoring it — on a 300-line
// bill, the Include checkbox one line at a time was the only way out.
//
// It is still a SUGGESTION. These tests are as much about what must NOT fire:
// `total` is a word real furniture descriptions use, and a rule that read it
// bare would put a real bench behind a button somebody presses in bulk.
// ============================================================================
describe("guessNonFurniture — a subtotal row that carries a description", () => {
  const guess = (itemDescription: string) => guessNonFurniture({ code: null, itemDescription });

  it("reads the wording a bill actually prints on a totals row", () => {
    for (const wording of [
      "Subtotal",
      "SUBTOTAL",
      "Sub-total",
      "Sub total carried",
      "Section total",
      "Page total",
      "Carried forward",
      "Total carried forward",
      "Brought forward",
      "Carried to collection",
      "Carried to summary",
      "Collection total",
      "Subtotal — Bedroom seating",
      "TOTAL",
      "Total £12,450.00",
    ]) {
      expect(guess(wording), wording).not.toBeNull();
      expect(guess(wording)?.reason, wording).toContain("totals row");
    }
  });

  it("names exactly the phrase it matched, so the reviewer can check it", () => {
    expect(guess("Carried forward")?.matched).toEqual(["carried forward"]);
    expect(guess("Section total")?.matched).toEqual(["section total"]);
    expect(guess("TOTAL")?.matched).toEqual(["total"]);
  });

  it("NEVER fires on a real item whose description merely contains the word", () => {
    // Every one of these is a thing somebody ordered. A bare `total` rule puts
    // all of them behind *Ignore all suggested*, which is pressed in bulk.
    for (const wording of [
      "Sofa, total width 2400",
      "Armchair — total height 900mm",
      "Total Look dining chair",
      "Sectional sofa, three parts",
      "Section of banquette seating",
      "Forward facing armchair",
      "Occasional table, sub assembly",
      "Totally bespoke headboard",
      "Bench with collection of cushions",
    ]) {
      expect(guess(wording), wording).toBeNull();
    }
  });

  it("matches a PHRASE, never its words apart", () => {
    // `carried` and `forward` each appear; the sequence does not.
    expect(guess("Chair carried by two, forward tilt")).toBeNull();
    expect(guess("Page of the bill, total shown elsewhere")).toBeNull();
  });

  it("still lets the first rule that decided do the talking", () => {
    // A line reading "Delivery subtotal" is a delivery line before it is a
    // totals row, and the reason a reviewer reads should be the nearer one.
    const both = guessNonFurniture({ code: null, itemDescription: "Delivery subtotal" });
    expect(both?.matched).toEqual(["delivery"]);
    // And the CODE still beats both.
    expect(guessNonFurniture({ code: "PACK-01", itemDescription: "Subtotal" })?.rule).toBe("code");
  });

  it("is a suggestion, not a decision: nothing is ignored and the line stays included", () => {
    // The whole point. `linesToIgnore` names it for the button; the line's own
    // `ignored` flag is untouched until somebody presses it.
    const line = { code: null, itemDescription: "Subtotal", ignored: false };
    expect(linesToIgnore([line])).toEqual([line]);
    expect(line.ignored).toBe(false);
    // Already unticked, so it is out of the set rather than sent again.
    expect(linesToIgnore([{ ...line, ignored: true }])).toEqual([]);
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
  // MEASURED RATHER THAN ASSUMED. `parseBoqSheets` skips a row carrying
  // neither a code nor a description — so a bare totals row never reaches the
  // guess at all. A totals row whose DESCRIPTION column says "TOTAL" is staged
  // as a line, and always has been (`boq-import.test.ts`: "four items + the
  // TOTAL row, which has a description").
  //
  // THIS TEST USED TO ASSERT THAT THE SUGGESTER FIRED ON NEITHER SHAPE, and
  // that assertion was the gap rather than the guarantee: the staged one became
  // a spec record with the subtotal's own figure as its quantity, with nothing
  // offering to ignore it (FIU 2026-09-21). The skipped shape is still skipped;
  // the staged one is now SUGGESTED, and still only suggested.
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

  it("and the staged totals rows are suggested, while the sofa is not", () => {
    const parsed = parseBoqSheets([{ sheet: "Bill", data }]);
    if (!parsed.ok) throw new Error(parsed.error);
    const lines = parsed.sheets[0]?.lines ?? [];
    expect(lines.map((line) => line.itemDescription)).toEqual(["Sofa", "TOTAL", "Subtotal — seating"]);
    expect(lines.map((line) => guessNonFurniture(line)?.matched ?? null)).toEqual([null, ["total"], ["subtotal"]]);
    // Suggested, never decided: both are still included until somebody presses.
    expect(linesToIgnore(lines.map((line) => ({ ...line, ignored: false }))).map((line) => line.itemDescription)).toEqual([
      "TOTAL",
      "Subtotal — seating",
    ]);
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
