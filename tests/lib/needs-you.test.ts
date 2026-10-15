// The needs-you list's words and addresses, pure (2026-10-15). Nothing here
// decides whether a confirm can go — that stays the blockers' — so these hold
// that every blocker becomes a short next step with a place to go.
import { describe, expect, it } from "vitest";
import { billNeedsYou, drawingNeedsYou, sheetsWaiting } from "@/lib/needs-you";
import { recordedFrom, sourceSays, sourceWords } from "@/lib/source-words";
import { replaceComparison } from "@/lib/replace-words";

describe("a drawing card's list", () => {
  const rows = [
    { id: "w", attrGroup: "dimension", dimensionSlot: "W", labelRaw: "LENGTH" },
    { id: "f", attrGroup: "fabric", dimensionSlot: null, labelRaw: "Material 1" },
  ];

  it("puts the read's doubts first, then the records, then the rows", () => {
    const items = drawingNeedsYou({
      itemId: "i1",
      rows,
      slots: new Map([[0, "W"]]),
      blockers: [
        { code: "unit_missing", observationId: "w", message: "These drawings do not print their units." },
        { code: "no_targets", message: "No record carries this code." },
        { code: "uncertain_unchecked", index: 0, message: "The read was unsure of the width." },
      ],
    });
    expect(items.map((entry) => [entry.words, entry.target])).toEqual([
      ["Check the width — then press “Mark checked”", "uncertain-i1-0"],
      ["Choose the record this page is for", "runs-i1"],
      ["Width: choose a unit", "row-w"],
    ]);
    expect(items.every((entry) => entry.why)).toBe(true);
  });

  it("sends a held value to its replace box, not to the row", () => {
    const [entry] = drawingNeedsYou({
      itemId: "i1",
      rows,
      slots: new Map(),
      blockers: [{ code: "slot_taken", observationId: "f", message: "That BWS field already holds a value from the bill." }],
    });
    expect(entry).toMatchObject({ words: "Material 1: field already held — use this drawing's, or ignore the row", target: "replace-f" });
  });

  it("says an unknown blocker by its first sentence, rather than dropping it", () => {
    const [entry] = drawingNeedsYou({
      itemId: "i1",
      rows,
      slots: new Map(),
      blockers: [{ code: "configuration_name", message: "That name cannot be stored. Use letters and numbers." }],
    });
    expect(entry?.words).toBe("That name cannot be stored.");
  });
});

describe("a bill's list", () => {
  it("names each tab that waits, and the lines with no item, each on its tab", () => {
    const items = billNeedsYou({
      single: false,
      reading: false,
      noLiveLines: false,
      sheets: [
        { index: 0, tab: "CASEGOODS", unmapped: false, unchecked: false, problems: [] },
        { index: 1, tab: "UPHOLSTERED", unmapped: false, unchecked: true, problems: [{ lineNo: 14, problem: "Row 14 is a fabric line that names no item." }] },
        { index: 2, tab: "MIRRORS", unmapped: true, unchecked: false, problems: [] },
      ],
    });
    expect(items.map((entry) => [entry.words, entry.target, entry.sheetIndex])).toEqual([
      ["Set the columns on “MIRRORS”, or drop the sheet", "sheet-2-columns", 2],
      ["Check the columns on “UPHOLSTERED”, then press “The columns are right”", "sheet-1-columns", 1],
      ["Row 14 on “UPHOLSTERED”: say which item this fabric belongs to", "bill-line-1-14", 1],
    ]);
    expect([...sheetsWaiting(items)].sort()).toEqual([1, 2]);
  });

  it("names no tab on a bill of one sheet, and says a read in progress with nowhere to go", () => {
    const items = billNeedsYou({
      single: true,
      reading: true,
      noLiveLines: false,
      sheets: [{ index: 0, tab: "Sheet1", unmapped: false, unchecked: true, problems: [] }],
    });
    expect(items.map((entry) => entry.words)).toEqual([
      "Check the columns, then press “The columns are right”",
      "Wait — the model is still reading the columns",
    ]);
    expect(items[1]?.target).toBeNull();
  });
});

describe("where a value came from", () => {
  it("never calls the bill another page", () => {
    const bill = { sourceFilename: "Bill.xlsx", sourcePage: null, sourceIsBill: true };
    expect(sourceWords(bill)).toBe("the bill");
    expect(recordedFrom(bill)).toBe("from the bill");
    expect(sourceSays(bill)).toBe("The bill says");
  });

  it("names a document by its file and page, and a typed value as typed", () => {
    expect(sourceWords({ sourceFilename: "TB-08.pdf", sourcePage: 1 })).toBe("TB-08.pdf p1");
    expect(recordedFrom({ sourceFilename: null, sourcePage: null })).toBe("by hand");
  });

  it("puts the bill's figure beside the drawing's, slot on both", () => {
    expect(
      replaceComparison(
        { slot: "W", value: "900", unit: "mm", sourceFilename: "Bill.xlsx", sourcePage: null, sourceIsBill: true },
        { slot: "W", value: "3500", unit: "mm" },
      ),
    ).toBe("The bill says W 900mm · this drawing says W 3500mm");
    expect(
      replaceComparison(
        { slot: null, value: "PL DINING TABLE TO BE EXTENDABLE TIMBER", unit: null, sourceFilename: "Bill.xlsx", sourcePage: null, sourceIsBill: true },
        { slot: null, value: "Sienna Walnut", unit: null },
      ),
    ).toBe("The bill says “PL DINING TABLE TO BE EXTENDABLE TIMBER” · this drawing says “Sienna Walnut”");
  });
});
