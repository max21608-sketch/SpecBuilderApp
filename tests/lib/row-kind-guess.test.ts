// A section heading and a finish line, suggested and never set.
//
// Pure tier. Every row is SYNTHETIC — an invented specifier's layout (the
// Harbour House bill, 2026-11-20: Ref | Location | Description | Unit | Qty,
// headings in the code column, finish lines under their item) with invented
// codes and words. Nothing here is client material.
import { describe, expect, it } from "vitest";
import { parseBoqSheets } from "@/lib/boq-import";
import { codeIsAFinishCode, kindChoicePatch } from "@/lib/boq-row-kinds";
import { guessRowKinds, linesToAcceptAs, type GuessLine } from "@/lib/row-kind-guess";

const ALIASES = [
  { role: "code" as const, term: "ref" },
  { role: "area" as const, term: "location" },
  { role: "itemDescription" as const, term: "description" },
  { role: "qtyUnit" as const, term: "unit" },
  { role: "qty" as const, term: "qty" },
];

function staged(rows: (string | number | null)[][]) {
  const read = parseBoqSheets([{ sheet: "Guest Rooms", data: [["Ref", "Location", "Description", "Unit", "Qty"], ...rows] }], {
    aliases: ALIASES,
  });
  if (!read.ok) throw new Error(read.error);
  return read.sheets[0]!.lines.map((line, index) => ({ ...line, index, ignored: false }));
}

const BILL = staged([
  ["GUEST ROOM TYPE A", null, null, null, null],
  ["ZZ-SF-01", "Room A", "Three seat sofa\nW2100 x D950 x H820mm", "nr", 24],
  ["FAB-01", null, "Finish: Example cloth 65, col. 130", null, null],
  ["FAB-02", null, "Finish: Example linen, natural", null, null],
  ["MTL-01", null, "Finish: Example brass, lacquered", null, null],
  ["ZZ-CH-02", "Room A", "Lounge chair", "nr", 48],
  [null, null, "Fabric: example boucle, ivory", null, null],
  ["BAR", null, null, null, null],
  ["FAB-09", null, "Finish: Example velvet", null, null],
  ["ZZ-BS-01", "Bar", "Bar stool", "nr", "TBC"],
  [null, null, "Subtotal carried to summary", null, null],
]);
const row = (lineNo: number) => BILL.find((line) => line.lineNo === lineNo)!;

describe("guessRowKinds — a section heading", () => {
  const guesses = guessRowKinds(BILL);

  it("asks about text in the code column with nothing else on the row, and says why", () => {
    expect(guesses.get(2)).toEqual({
      kind: "section",
      reason: "text in the code column only — no quantity, unit or anything else on the row",
    });
    expect(guesses.get(9)?.kind).toBe("section");
  });

  it("never asks about an item, a TBC quantity, or a subtotal already asked about as not furniture", () => {
    expect(guesses.has(3)).toBe(false);
    // `TBC` in the quantity cell is a quantity the bill did not give, not an empty cell.
    expect(guesses.has(11)).toBe(false);
    // "Subtotal carried to summary" is the non-furniture question's; one button per row.
    expect(guesses.has(12)).toBe(false);
  });

  it("never asks where any other cell the sheet reads carries text, or both code and description do", () => {
    const lines = staged([
      ["LOBBY", "Lobby", null, null, null],
      ["LOBBY", null, "Lobby seating", null, null],
      ["LOBBY", null, null, "nr", null],
      [null, null, "RESTAURANT", null, null],
    ]);
    const out = guessRowKinds(lines);
    expect([...out.keys()]).toEqual([5]);
    expect(out.get(5)?.kind === "section" && out.get(5)?.reason).toMatch(/description column only/);
  });

  it("never asks about a line somebody, a rule or a model already gave a kind, or an ignored one", () => {
    const lines: GuessLine[] = [
      { ...row(2), rowKind: "item" },
      { ...row(9), ignored: true },
    ];
    expect(guessRowKinds(lines).size).toBe(0);
  });
});

describe("guessRowKinds — a finish line", () => {
  const guesses = guessRowKinds(BILL);

  it("suggests the item above for a finish code with no quantity, past the finish lines between", () => {
    for (const lineNo of [4, 5, 6]) {
      const guess = guesses.get(lineNo);
      expect(guess?.kind, String(lineNo)).toBe("finish_for");
      expect(guess?.kind === "finish_for" && guess.parent).toEqual({ row: 3, code: "ZZ-SF-01" });
    }
    expect(guesses.get(4)?.reason).toBe(
      "no quantity, the code FAB-01 is a finish code, and row 3 (ZZ-SF-01) is the item above",
    );
  });

  it("reads a description that begins with a finish label, where the line has no code", () => {
    const guess = guesses.get(8);
    expect(guess?.kind === "finish_for" && guess.parent).toEqual({ row: 7, code: "ZZ-CH-02" });
    expect(guess?.reason).toMatch(/it begins “Fabric:”/);
  });

  it("never guesses a parent across a section heading, set or suggested", () => {
    expect(guesses.has(10)).toBe(false);
    const accepted = BILL.map((line) => (line.lineNo === 9 ? { ...line, ...kindChoicePatch("section", null) } : line));
    expect(guessRowKinds(accepted).has(10)).toBe(false);
  });

  it("never suggests a parent that is ignored, and walks past a line already made a finish line", () => {
    const ignoredItem = BILL.map((line) => (line.lineNo === 3 ? { ...line, ignored: true } : line));
    expect(guessRowKinds(ignoredItem).has(4)).toBe(false);
    const first = BILL.map((line) => (line.lineNo === 4 ? { ...line, ...kindChoicePatch("finish_for", { row: 3, code: "ZZ-SF-01" }) } : line));
    const after = guessRowKinds(first);
    expect(after.has(4)).toBe(false);
    expect(after.get(5)?.kind === "finish_for" && after.get(5)).toMatchObject({ parent: { row: 3 } });
  });

  it("leaves a line with a quantity, or a bracket the bracket rule reads, alone", () => {
    const lines = staged([
      ["ZZ-SF-01", "Room A", "Sofa", "nr", 2],
      ["FAB-01", null, "Finish: Example cloth", "m", 12],
      ["FAB-02 (ZZ-XX-99)", null, "Fabric @ Sofa", null, null],
    ]);
    expect(guessRowKinds(lines).size).toBe(0);
  });

});

describe("codeIsAFinishCode", () => {
  it("reads a finish code exactly, never a prefix of the letters", () => {
    for (const code of ["FAB-01", "MTL 02", "WD01", "GR-FAB-13", "F-WD-02", "COM-1"]) expect(codeIsAFinishCode(code), code).toBe(true);
    for (const code of ["COMMODE-01", "WDR-01", "HH-SF-01", "CH-01.2", "FABRIC", "", null]) expect(codeIsAFinishCode(code), String(code)).toBe(false);
  });

  it("keeps a finish-shaped line out of the section question", () => {
    const lines = staged([["FAB-07", null, null, null, null], ["TIMBER", null, null, null, null]]);
    expect([...guessRowKinds(lines).keys()]).toEqual([3]);
  });
});

describe("linesToAcceptAs", () => {
  it("is the set each tab button counts and writes, by kind", () => {
    const guesses = guessRowKinds(BILL);
    expect(linesToAcceptAs(BILL, guesses, "section").map(({ line }) => line.lineNo)).toEqual([2, 9]);
    expect(linesToAcceptAs(BILL, guesses, "finish_for").map(({ line }) => line.lineNo)).toEqual([4, 5, 6, 8]);
  });

  it("drops a line somebody has since given a kind", () => {
    const guesses = guessRowKinds(BILL);
    const after = BILL.map((line) => (line.lineNo === 2 ? { ...line, ...kindChoicePatch("item", null) } : line));
    expect(linesToAcceptAs(after, guesses, "section").map(({ line }) => line.lineNo)).toEqual([9]);
  });
});
