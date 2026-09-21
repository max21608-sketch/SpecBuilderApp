// Synthetic bills of quantities — the SHAPES a real bill arrives in, none of
// its content.
//
// ============================================================================
// MODELLED, NEVER COPIED.
//
// `CLAUDE.md`: real client material never enters this repo, a fixture or a
// seed. A real bill's SHAPE may be modelled — a title block, a late header,
// per-level quantity columns, a totals row, forty areas, a packaging line —
// and its content may not. So every code here is invented (`ZZ-`), every
// description is a generic piece of furniture and every area is "Example
// <something>".
//
// ONE DEFINITION, TWO CONSUMERS. These functions return `SheetData` — the
// positional rows `read-excel-file` hands the parser — and `build-boq.ts`
// writes the same rows into real `.xlsx` workbooks beside this file. A shape
// that only ever exists as an array of arrays cannot prove anything about
// merged cells, which is why row 3's fixture has to survive a real workbook.
// ============================================================================
import type { SheetData } from "read-excel-file/node";

/**
 * A bill with per-level quantity columns and NO total.
 *
 * The trap this one carries: `L1`..`L6` are quantities and are deliberately
 * absent from the header synonyms, because a bill that read `L1` where `qty`
 * belonged would order 3 sofas instead of 14. With no `TOTAL Q-ty` column
 * there is no quantity at all, and the only honest answer is null — never 1,
 * and never the first level's figure.
 */
export function noQtyColumn(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null, null, null, null, null, null],
    ["TENDER - EXAMPLE PACKAGE", null, null, null, null, null, null, null, null],
    ["Area", "FF&E code", "Item description", "unit", "L1", "L2", "L3", "L4", "L5"],
    ["Example lounge", "ZZ-101", "Sofa", "pcs", 3, 1, 4, 3, 2],
    ["Example lounge", "ZZ-102", "Armchair", "pcs", 14, 13, 11, 12, 6],
    ["Example suite", "ZZ-103", "Side table", "pcs", 1, null, null, null, null],
  ];
}

/**
 * A bill with a quantity column that some rows leave blank.
 *
 * Different from the above and it must read the same way: "the bill gave no
 * quantity for this line" is one statement whether the column is missing or
 * the cell is empty, and neither is a reason to write a number nobody stated.
 */
export function blankQtyCells(): SheetData {
  return [
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty"],
    ["Example lounge", "ZZ-201", "Sofa", 4],
    ["Example lounge", "ZZ-202", "Armchair", null],
    ["Example suite", "ZZ-203", "Bench", ""],
  ];
}

/**
 * A two-row header: "FF&E" over "code", "Item" over "description", "Total"
 * over "Q-ty", with the Area heading merged down both rows.
 *
 * Neither row is a header on its own — the upper names an area and an item and
 * no code, the lower names a code and a description and no total — and the
 * pair completes. `build-boq.ts` writes this same shape as a real workbook with
 * A3:A4 merged, because a merged cell is only a merged cell in a file: as an
 * array of arrays it is indistinguishable from a blank.
 */
export function twoRowHeader(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null],
    ["Revision: ", "2", null, null],
    ["Area", "FF&E", "Item", "Total"],
    [null, "code", "description", "Q-ty"],
    ["Example lounge", "ZZ-101", "Sofa", 14],
    ["Example lounge", "ZZ-102", "Armchair", 58],
    ["Example suite", "ZZ-103", "Side table", 2],
  ];
}

/**
 * A two-row header that does NOT complete: the lower row names the quantity
 * and nothing names a code.
 *
 * The expected behaviour is a refusal that says which rows it read together,
 * because a person looking at a split heading needs to know that reading was
 * tried before they go hunting for a different cause.
 */
export function twoRowHeaderIncomplete(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null],
    ["Room", "Item", "Nr", null],
    [null, "description", "Total Q-ty", null],
    ["Example lounge", "Sofa", 14, null],
  ];
}
