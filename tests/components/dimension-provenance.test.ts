// The sentence under the composed dimensions cell.
//
// The cell prints `W1900` whether the page said 190 or 1900, so the sentence is
// what makes it checkable against the drawing. These assert the three things
// that would make it misleading rather than merely terse: a page picked instead
// of counted, a conversion that went unsaid, and a hand-typed row described as
// having come off a document.
import { describe, expect, it } from "vitest";
import { dimensionProvenance } from "@/components/records/dimension-provenance";

const row = (unit: string | null, file: string | null, page: number | null) => ({
  unit,
  sourceFilename: file,
  sourcePage: page,
});

describe("the dimensions provenance sentence", () => {
  it("says nothing where nothing is measured", () => {
    expect(dimensionProvenance([])).toBeNull();
  });

  it("names the page and says what was converted", () => {
    const text = dimensionProvenance([
      row("cm", "Apx 1a", 1),
      row("cm", "Apx 1a", 1),
      row("cm", "Apx 1a", 1),
      row("cm", "Apx 1a", 1),
    ]);
    expect(text).toBe("Composed from 4 measured rows off Apx 1a p1, converted from centimetres.");
  });

  it("does not claim a conversion that did not happen", () => {
    expect(dimensionProvenance([row("mm", "S-200", 3)])).toBe(
      "Composed from 1 measured row off S-200 p3, already in millimetres.",
    );
  });

  it("counts the page rather than picking one, and ties break on the lower page", () => {
    // The (document, page) accounting for most of the slots goes first. An
    // estimator who wrote down "the width is on page 7" must not find it
    // saying page 11 next week, which is why ties are broken and not left to
    // the order the rows arrived in.
    const text = dimensionProvenance([
      row("mm", "S-200", 11),
      row("mm", "S-200", 7),
      row("mm", "S-200", 7),
    ]);
    expect(text).toContain("off S-200 p7 and 1 other page");
  });

  it("says when the figures are not all in one unit", () => {
    // Two units among four slots is either a real mixed set or a misread, and
    // both are worth a second look — so it is never silently converted away.
    const text = dimensionProvenance([row("cm", "Apx 1a", 1), row("mm", "Apx 1a", 1)]);
    expect(text).toContain("not all in the same unit — centimetres and millimetres");
  });

  it("says when nothing states a unit at all", () => {
    expect(dimensionProvenance([row(null, "Apx 1a", 1)])).toContain("None of them states a unit");
  });

  it("calls a hand-typed row typed, never off a document", () => {
    // A spec somebody typed carries no run and no page, deliberately (0028).
    // Describing it as coming off the drawings would be a false provenance
    // rather than a missing one.
    const text = dimensionProvenance([row("mm", "Apx 1a", 1), row("mm", null, null)]);
    expect(text).toContain("with 1 typed by hand");
  });

  it("names the bill, never counting its row as another page (2026-10-15, TB-08)", () => {
    // TB-08's height was the bill's own row, kept because the drawing's 710
    // matched it, and the caption said "and 1 other page" — so Max went
    // looking for a second page of the drawing.
    const bill = { unit: "mm", sourceFilename: "RONNIE SCOTTS ST4.xlsx", sourcePage: null, sourceIsBill: true };
    const text = dimensionProvenance([
      row("mm", "TB-08_DINING TABLE.pdf", 1),
      row("mm", "TB-08_DINING TABLE.pdf", 1),
      row("mm", "TB-08_DINING TABLE.pdf", 1),
      bill,
    ]);
    expect(text).toBe(
      "Composed from 4 measured rows off TB-08_DINING TABLE.pdf p1 and 1 row from the bill, already in millimetres.",
    );
    expect(text).not.toContain("other page");
  });

  it("says off the bill where the bill wrote most of it", () => {
    const bill = { unit: "mm", sourceFilename: "Bill.xlsx", sourcePage: null, sourceIsBill: true };
    expect(dimensionProvenance([bill, bill, row("mm", "S-200", 2)])).toBe(
      "Composed from 3 measured rows off the bill (Bill.xlsx) and 1 other page, already in millimetres.",
    );
  });

  it("names a pageless document by its file, not as a page", () => {
    const text = dimensionProvenance([row("mm", "S-200", 2), row("mm", "S-200", 2), row("mm", "Reply from Hayley.eml", null)]);
    expect(text).toContain("off S-200 p2 and 1 row from Reply from Hayley.eml");
  });
});
