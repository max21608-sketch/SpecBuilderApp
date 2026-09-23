// Builds the synthetic BOQ workbooks the variance tests read.
//
//   npx tsx tests/fixtures/build-boq.ts [directory]
//
// ============================================================================
// WHY A WORKBOOK AND NOT ONLY AN ARRAY OF ARRAYS.
//
// Two of the variance matrix's shapes do not exist as arrays:
//
//   * A MERGED CELL. `read-excel-file` puts a merged region's value in its
//     top-left cell and nothing in the others — which is what makes a heading
//     merged down two rows look like half a header. Hand-written as an array
//     that is an ASSUMPTION about the reader; written as a workbook it is the
//     reader's own behaviour.
//   * THREE HUNDRED LINES. §6.10.a's claim is that the review renders a
//     300-line bill in under two seconds, and a number measured against a
//     fixture somebody typed by hand is a number about the typing.
//
// The shapes come from `boq-shapes.ts`, so the array the pure tier parses and
// the workbook a person can open are the same bill. Nothing here is a client
// document: the codes are invented (`ZZ-`), the descriptions are generic
// furniture and the areas are "Example <something>" — `CLAUDE.md`'s rule, which
// allows a real bill's shape to be modelled and never its content.
//
// ============================================================================
// THE BYTES ARE BUILT, NEVER COMMITTED.
//
// `.gitignore` refuses `*BOQ*.xlsx` outright, because "NDA-covered material in
// a repo is still NDA-covered material, and history is forever". A synthetic
// fixture is not that material — and committing a spreadsheet under a name
// chosen to slip past that rule is how the rule stops meaning anything. So the
// tests ask this module for BYTES and no workbook is written to the repo at
// all: nothing to commit, nothing to keep in step with the shapes, and the
// fixture is provably synthetic because it is built from source every run.
//
// The command line is for a person who wants to open one in Excel. It writes
// to the system temp directory, or to a directory given as its first argument,
// and prints where.
// ============================================================================
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import type { SheetData } from "read-excel-file/node";
import { bill300, pricingDoc, programmeDatesSheet, tenderSummarySheet, twoRowHeader } from "./boq-shapes";

/** One sheet of positional rows, written as itself. */
function addSheet(book: ExcelJS.Workbook, name: string, rows: SheetData): ExcelJS.Worksheet {
  const sheet = book.addWorksheet(name);
  for (const row of rows) sheet.addRow([...row] as ExcelJS.CellValue[]);
  return sheet;
}

async function bytes(book: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * A two-row header with the Area heading GENUINELY merged down both rows.
 *
 * This is the one fixture that has to be a file: the array in `boq-shapes.ts`
 * writes the second row's cell as null on the assumption that a merged region
 * reads that way, and this is where that assumption meets the library.
 */
export async function twoRowHeaderWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = addSheet(book, "Bill", twoRowHeader());
  sheet.mergeCells("A3:A4");
  return bytes(book);
}

/** 300 lines, 40 areas, 60 that are not furniture, as a real workbook. */
export async function bill300Workbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  addSheet(book, "MAIN", bill300());
  return bytes(book);
}

/**
 * THE PRICING-DOCUMENT LAYOUT AS A REAL WORKBOOK — the bill refused on
 * 2026-09-23, with invented rows (see `pricingDoc` in boq-shapes.ts).
 *
 * Three things only a file can carry, each of which the real copies have:
 *
 *   * "Spec Code", "Item Description" and "Target Unit Cost" MERGED across two
 *     columns in the header, which `read-excel-file` reads as the heading in
 *     the first column and nothing in the second.
 *   * The `Line` column as FORMULAS (`=ROW()-8`), a shared formula whose
 *     cells carry their cached results — and, with `sharedFormulaGap`, ONE
 *     cell with no cached result at all, the way one real copy saved it. That
 *     cell must read as blank, never as `[object Object]`.
 *   * A tender-summary sheet beside the bill, which is not a bill.
 *
 * `titled` is the original with its title block (header on row 8); untitled
 * is the copy with the title rows deleted (header on row 1). A layout saved
 * from one has to read the other.
 */
export async function pricingDocWorkbook({
  titled,
  sharedFormulaGap = false,
  codeHeading,
}: {
  titled: boolean;
  sharedFormulaGap?: boolean;
  /**
   * The code column's heading. A database-tier test passes a per-run heading:
   * layouts are GLOBAL, so a layout somebody saved from the real bill (whose
   * headings this fixture copies) would otherwise read the fixture, and a
   * test asserting "nobody could read this" would fail for a reason that has
   * nothing to do with the code under test.
   */
  codeHeading?: string;
}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const rows = pricingDoc({ titled, codeHeading });
  const sheet = addSheet(book, "CASEGOODS+SEATING+TABLES", rows);
  const headerRow = titled ? 8 : 1;
  for (const [from, to] of [["E", "F"], ["H", "I"], ["J", "K"]] as const) {
    sheet.mergeCells(`${from}${headerRow}:${to}${headerRow}`);
  }
  // The Line column, as the formula the real sheet carries. The master cell
  // owns the shared formula; every other data cell points at it.
  const first = headerRow + 1;
  const last = rows.length;
  for (let rowNo = first; rowNo <= last; rowNo += 1) {
    const result = rowNo - 8;
    const cell = sheet.getCell(`A${rowNo}`);
    if (rowNo === first) {
      cell.value = { formula: "ROW()-8", result, shareType: "shared", ref: `A${first}:A${last}` } as ExcelJS.CellValue;
    } else if (sharedFormulaGap && rowNo === first + 3) {
      // NO cached result: what a copy saved by some other tool looks like.
      cell.value = { sharedFormula: `A${first}` } as unknown as ExcelJS.CellValue;
    } else {
      cell.value = { sharedFormula: `A${first}`, result } as ExcelJS.CellValue;
    }
  }
  addSheet(book, "LOGISTICS", tenderSummarySheet());
  return bytes(book);
}

/** A programme-dates workbook: nobody would declare it a bill, and it must not crash the reader. */
export async function programmeDatesWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  addSheet(book, "FF&E Critical Path", programmeDatesSheet());
  return bytes(book);
}

/** Every workbook this module can build, by the filename the CLI gives it. */
export const WORKBOOKS: Record<string, () => Promise<Buffer>> = {
  "bill-two-row-header.xlsx": twoRowHeaderWorkbook,
  "bill-300-lines.xlsx": bill300Workbook,
  "bill-pricing-document.xlsx": () => pricingDocWorkbook({ titled: true }),
  "bill-pricing-document-untitled.xlsx": () => pricingDocWorkbook({ titled: false, sharedFormulaGap: true }),
  "programme-dates.xlsx": programmeDatesWorkbook,
};

async function main(): Promise<void> {
  const into = process.argv[2] ?? tmpdir();
  for (const [filename, build] of Object.entries(WORKBOOKS)) {
    const target = path.join(into, filename);
    await writeFile(target, await build());
    console.log(`wrote ${target}`);
  }
}

// Only when run as a command. Imported by the tests, it writes nothing.
if (process.argv[1] && path.basename(process.argv[1]).startsWith("build-boq")) await main();
