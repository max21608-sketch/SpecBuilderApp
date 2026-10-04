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
import { deflateSync } from "node:zlib";
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

// ---- pictures on rows -------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real PNG of one flat colour, `width` x `height` — invented, built here, and
 * different bytes for every (size, colour), which is what makes two pictures
 * two pictures.
 */
export function flatPng(width: number, height: number, [r, g, b]: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const scanline = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => [r, g, b][i % 3] as number)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => scanline));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The pictures `picturedBillWorkbook` anchors, so a test can compare bytes. */
export const BILL_PICTURES = {
  logo: flatPng(6, 2, [20, 20, 20]),
  stool: flatPng(4, 3, [200, 120, 40]),
  drawers: flatPng(5, 5, [40, 90, 160]),
  alternative: flatPng(3, 4, [90, 160, 40]),
} as const;

/**
 * A BILL WITH A PICTURE ON ITS ROWS — the Aman pricing document's "Image"
 * column, invented (2026-10-04). One sheet, a title row carrying a logo, the
 * header on row 2, then:
 *
 *   row 3  ZZ-FUR-10 Stool        one picture
 *   row 4  ZZ-FUR-26 Drawers      the SAME picture anchored twice — one picture
 *   row 5  ZZ-FUR-04 Armchair     two DIFFERENT pictures — none is taken
 *   row 6  ZZ-FUR-05 Side table   no picture
 */
export async function picturedBillWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = addSheet(book, "Bill", [
    ["Example pricing document", null, null, null, null],
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Image"],
    ["Example Corridor", "ZZ-FUR-10", "Stool", 2, null],
    ["Example Corridor", "ZZ-FUR-26", "Drawers", 1, null],
    ["Example Lounge", "ZZ-FUR-04", "Armchair", 4, null],
    ["Example Lounge", "ZZ-FUR-05", "Side table", 2, null],
  ]);
  const id = (bytes: Buffer) => book.addImage({ buffer: bytes as unknown as ExcelJS.Buffer, extension: "png" });
  const logo = id(BILL_PICTURES.logo);
  const stool = id(BILL_PICTURES.stool);
  const drawers = id(BILL_PICTURES.drawers);
  const alternative = id(BILL_PICTURES.alternative);
  // `tl` is 0-based: sheet row N is `row: N - 1`. The 0.1 sits the picture a
  // little way inside the cell, which is how Excel places one.
  const at = (imageId: number, row: number) =>
    sheet.addImage(imageId, { tl: { col: 4.1, row: row - 1 + 0.1 }, ext: { width: 40, height: 40 } });
  sheet.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 60, height: 20 } });
  at(stool, 3);
  at(drawers, 4);
  at(drawers, 4);
  at(stool, 5);
  at(alternative, 5);
  return bytes(book);
}

/** Every workbook this module can build, by the filename the CLI gives it. */
export const WORKBOOKS: Record<string, () => Promise<Buffer>> = {
  "bill-two-row-header.xlsx": twoRowHeaderWorkbook,
  "bill-300-lines.xlsx": bill300Workbook,
  "bill-pricing-document.xlsx": () => pricingDocWorkbook({ titled: true }),
  "bill-pricing-document-untitled.xlsx": () => pricingDocWorkbook({ titled: false, sharedFormulaGap: true }),
  "programme-dates.xlsx": programmeDatesWorkbook,
  "bill-with-pictures.xlsx": picturedBillWorkbook,
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
