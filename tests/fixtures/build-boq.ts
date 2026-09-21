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
import { twoRowHeader } from "./boq-shapes";

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

/** Every workbook this module can build, by the filename the CLI gives it. */
export const WORKBOOKS: Record<string, () => Promise<Buffer>> = {
  "bill-two-row-header.xlsx": twoRowHeaderWorkbook,
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
