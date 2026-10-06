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
import JSZip from "jszip";
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

/** The swatches `fabricSwatchBillWorkbook` anchors on its fabric lines. */
export const FABRIC_SWATCHES = {
  velvet: flatPng(3, 3, [150, 30, 60]),
  linenA: flatPng(3, 2, [200, 190, 160]),
  linenB: flatPng(2, 3, [180, 170, 150]),
  boucle: flatPng(4, 4, [240, 235, 220]),
  placeholder: flatPng(2, 2, [10, 200, 10]),
  mohair: flatPng(5, 2, [90, 60, 40]),
} as const;

/** The words of the uncoded, real fabric `fabricSwatchBillWorkbook` prints twice. */
export const FABRIC_SWATCH_BOUCLE =
  "Fabric @ Sofa Collection: Example Boucle, Colour: Ivory, Composition: 100% wool";

/**
 * A BILL WHOSE FABRIC LINES CARRY THEIR SWATCHES (2026-10-05) — invented, in
 * the pricing document's shape: each fabric on its own line under its item,
 * naming it in brackets, a picture on the row. One sheet, a title row, the
 * header on row 2:
 *
 *   3  ZZ-FUR-10 Stool          4  ZZ-FAB-13 (ZZ-FUR-10)   velvet, picture A
 *   5  ZZ-FUR-26 Drawers        6  ZZ-FAB-13 (ZZ-FUR-26)   velvet, picture A again
 *   7  ZZ-FUR-04 Armchair       8  ZZ-FAB-14 (ZZ-FUR-04)   linen, picture B
 *   9  ZZ-FUR-05 Side chair    10  ZZ-FAB-14 (ZZ-FUR-05)   linen, picture C — differs
 *  11  ZZ-FUR-06 Sofa          12  (ZZ-FUR-06)            boucle, NO CODE, picture D
 *  13  ZZ-FUR-07 Bench         14  (ZZ-FUR-07)            the same boucle words, no picture
 *  15  ZZ-FUR-08 Ottoman       16  (ZZ-FUR-08)            a PLACEHOLDER, picture E
 *  17  ZZ-FUR-09 Pouf          18  ZZ-FAB-15 (ZZ-FUR-09)   mohair, picture F
 */
export async function fabricSwatchBillWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const velvet = "Fabric @ Stool Collection: Example Velvet, Colour: Claret";
  const linen = "Fabric @ Armchair Collection: Example Linen, Colour: Sand";
  const sheet = addSheet(book, "Bill", [
    ["Example pricing document", null, null, null, null],
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Image"],
    ["Example Lounge", "ZZ-FUR-10", "Stool", 2, null],
    ["Example Lounge", "ZZ-FAB-13 (ZZ-FUR-10)", velvet, null, null],
    ["Example Lounge", "ZZ-FUR-26", "Drawers", 1, null],
    ["Example Lounge", "ZZ-FAB-13 (ZZ-FUR-26)", velvet, null, null],
    ["Example Lounge", "ZZ-FUR-04", "Armchair", 4, null],
    ["Example Lounge", "ZZ-FAB-14 (ZZ-FUR-04)", linen, null, null],
    ["Example Lounge", "ZZ-FUR-05", "Side chair", 2, null],
    ["Example Lounge", "ZZ-FAB-14 (ZZ-FUR-05)", linen, null, null],
    ["Example Lounge", "ZZ-FUR-06", "Sofa", 1, null],
    ["Example Lounge", "(ZZ-FUR-06)", FABRIC_SWATCH_BOUCLE, null, null],
    ["Example Lounge", "ZZ-FUR-07", "Bench", 1, null],
    ["Example Lounge", "(ZZ-FUR-07)", FABRIC_SWATCH_BOUCLE, null, null],
    ["Example Lounge", "ZZ-FUR-08", "Ottoman", 2, null],
    ["Example Lounge", "(ZZ-FUR-08)", "Fabric @ Ottoman (Option 1) Technical details TBC", null, null],
    ["Example Lounge", "ZZ-FUR-09", "Pouf", 1, null],
    ["Example Lounge", "ZZ-FAB-15 (ZZ-FUR-09)", "Fabric @ Pouf Collection: Example Mohair", null, null],
  ]);
  const id = (bytes: Buffer) => book.addImage({ buffer: bytes as unknown as ExcelJS.Buffer, extension: "png" });
  const at = (imageId: number, row: number) =>
    sheet.addImage(imageId, { tl: { col: 4.1, row: row - 1 + 0.1 }, ext: { width: 40, height: 40 } });
  const velvetId = id(FABRIC_SWATCHES.velvet);
  at(velvetId, 4);
  at(velvetId, 6);
  at(id(FABRIC_SWATCHES.linenA), 8);
  at(id(FABRIC_SWATCHES.linenB), 10);
  at(id(FABRIC_SWATCHES.boucle), 12);
  at(id(FABRIC_SWATCHES.placeholder), 16);
  at(id(FABRIC_SWATCHES.mohair), 18);
  return bytes(book);
}

/** The words of `finishLinesBillWorkbook`'s finish lines, by row — invented, every one. */
export const FINISH_LINES = {
  4: { code: "F-FA-05", words: "EXAMPLE MILL | ZX-1 / ALPHA | MOHAIR | IVORY" },
  5: { code: "F-FA-07", words: "EXAMPLE TANNERY | ZX-2 | LEATHER | OXBLOOD" },
  6: { code: "F-FA-08", words: "EXAMPLE TANNERY | ZX-3 | LEATHER | SAND" },
  7: { code: "F-FA-18", words: "EXAMPLE MILL | ZX-4 / BETA | FABRIC | STONE" },
  8: { code: "F-MT-03", words: "TO ELECT | POLISHED NICKEL | CLEAR LACQUERED" },
  9: { code: "F-WD-02", words: "EXAMPLE SAPELE, SATIN" },
  10: { code: "F-TR-01", words: "EXAMPLE TRIMS | ZX-9 CORD WITH TAPE | CORD" },
  12: { code: null, words: "BED - LEATHER BW" },
} as const;

/**
 * A BILL WHOSE ITEM CARRIES SEVEN FINISH LINES (2026-10-06) — invented, in a
 * specifier's shape: the item, then one coded finish per line under it, no
 * unit and no quantity. Four fabrics, a metal, a timber and a trim; then a
 * second item with a contractor's UNCODED fabric line. Which item each finish
 * belongs to is said by the test (the structure read's `finish_for`), as a
 * person or the model would say it:
 *
 *   3  ZZ-SE-03.A  Banquette     4–10  its finishes (`FINISH_LINES`)
 *  11  ZZ-FUR-30   Bed             12  BED - LEATHER BW, no code
 */
export async function finishLinesBillWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const finish = (row: keyof typeof FINISH_LINES) => ["Example Bar", FINISH_LINES[row].code, FINISH_LINES[row].words, null];
  addSheet(book, "Bill", [
    ["Example specification bill", null, null, null],
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty"],
    ["Example Bar", "ZZ-SE-03.A", "Banquette", 1],
    finish(4),
    finish(5),
    finish(6),
    finish(7),
    finish(8),
    finish(9),
    finish(10),
    ["Example Bar", "ZZ-FUR-30", "Bed", 2],
    finish(12),
  ]);
  return bytes(book);
}

/**
 * A BILL WITH PICTURES PLACED IN ITS CELLS (2026-10-06) — Excel's "Place in
 * Cell", which is not an anchor: the cell holds the picture and reads
 * `#VALUE!`. The Butler Arms bedrooms bill's shape, invented: one sheet, a
 * title row, the header on row 2, the pictures in the Image column (E):
 *
 *   row 3  ZZ-FUR-10 Stool        in-cell stool
 *   row 4  ZZ-FUR-11 Ottoman      nothing
 *   row 5  ZZ-FUR-26 Drawers      in-cell stool again — the SAME rich value
 *   row 6  ZZ-FUR-12 Pouffe       nothing
 *   row 7  ZZ-FUR-04 Armchair     a FLOATING alternative
 *   row 8  ZZ-FUR-13 Bench        nothing
 *   row 9  ZZ-FUR-05 Side table   in-cell drawers AND a floating alternative — two, so none
 *
 * Written by hand on top of what `exceljs` writes, because nothing in this
 * repo can write an in-cell picture. EVERY INDIRECTION IS DELIBERATELY NOT
 * THE IDENTITY, so a reader that assumes one reads the wrong picture or none:
 * the cell's `vm` is 1-based; the picture's metadata type is the SECOND one
 * declared (a decoy first); the future-metadata blocks point at the rich
 * values crossed over; the structure puts `CalcOrigin` BEFORE the image key,
 * so the picture is the value's second `<v>`; and the relationship list is in
 * the opposite order from the pictures.
 *
 * `brokenMetadata` writes a `metadata.xml` that is not well formed — the
 * lines must stage, the floating picture must stand, and the in-cell ones
 * must be reported unread rather than guessed.
 */
export async function inCellPictureBillWorkbook({ brokenMetadata = false }: { brokenMetadata?: boolean } = {}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = addSheet(book, "Bill", [
    ["Example bedroom schedule", null, null, null, null],
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty", "Image"],
    ["Example Bedroom", "ZZ-FUR-10", "Stool", 2, null],
    ["Example Bedroom", "ZZ-FUR-11", "Ottoman", 1, null],
    ["Example Bedroom", "ZZ-FUR-26", "Drawers", 1, null],
    ["Example Bedroom", "ZZ-FUR-12", "Pouffe", 2, null],
    ["Example Suite", "ZZ-FUR-04", "Armchair", 4, null],
    ["Example Suite", "ZZ-FUR-13", "Bench", 1, null],
    ["Example Suite", "ZZ-FUR-05", "Side table", 2, null],
  ]);
  // What every older reader sees in a cell holding a picture.
  for (const row of [3, 5, 9]) sheet.getCell(`E${row}`).value = { error: "#VALUE!" } as ExcelJS.CellErrorValue;
  const alternative = book.addImage({ buffer: BILL_PICTURES.alternative as unknown as ExcelJS.Buffer, extension: "png" });
  for (const row of [7, 9]) sheet.addImage(alternative, { tl: { col: 4.1, row: row - 1 + 0.1 }, ext: { width: 40, height: 40 } });

  const zip = await JSZip.loadAsync(await bytes(book));
  const workbookRels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  // exceljs writes its first sheet here; the READER finds it through the
  // workbook's relationships, which is what the test is about.
  const sheetPath = "xl/worksheets/sheet1.xml";
  let sheetXml = (await zip.file(sheetPath)?.async("string")) ?? "";
  // rows 3 and 5 share vm 1 (the stool); row 9 is vm 2 (the drawers).
  for (const [cell, vm] of [["E3", 1], ["E5", 1], ["E9", 2]] as const) {
    if (!sheetXml.includes(`<c r="${cell}"`)) throw new Error(`exceljs wrote no ${cell}`);
    sheetXml = sheetXml.replace(`<c r="${cell}"`, `<c r="${cell}" vm="${vm}"`);
  }
  zip.file(sheetPath, sheetXml);

  const RD = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
  zip.file("xl/media/cellpicture-drawers.png", BILL_PICTURES.drawers);
  zip.file("xl/media/cellpicture-stool.png", BILL_PICTURES.stool);
  zip.file(
    "xl/metadata.xml",
    brokenMetadata
      ? `<?xml version="1.0" encoding="UTF-8"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes><metadataType name="XLRICHVALUE"/></metadataTypes><valueMetadata><bk><rc t="1" v="0"/></valueMetadata>`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="${RD}">
<metadataTypes count="2"><metadataType name="XLDAPR" minSupportedVersion="120000"/><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>
<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"/></extLst></bk></futureMetadata>
<futureMetadata name="XLRICHVALUE" count="2">
<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="1"/></ext></extLst></bk>
<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk>
</futureMetadata>
<valueMetadata count="2"><bk><rc t="2" v="1"/></bk><bk><rc t="2" v="0"/></bk></valueMetadata>
</metadata>`,
  );
  // rv 0 is the stool (relationship 1), rv 1 the drawers (relationship 0).
  zip.file(
    "xl/richData/rdrichvalue.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rvData xmlns="${RD}" count="2"><rv s="0"><v>5</v><v>1</v></rv><rv s="0"><v>5</v><v>0</v></rv></rvData>`,
  );
  zip.file(
    "xl/richData/rdrichvaluestructure.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rvStructures xmlns="${RD}" count="1"><s t="_localImage"><k n="CalcOrigin" t="i"/><k n="_rvRel:LocalImageIdentifier" t="i"/></s></rvStructures>`,
  );
  zip.file(
    "xl/richData/richValueRel.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rIdPic2"/><rel r:id="rIdPic1"/></richValueRels>`,
  );
  zip.file(
    "xl/richData/_rels/richValueRel.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPic1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cellpicture-stool.png"/><Relationship Id="rIdPic2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cellpicture-drawers.png"/></Relationships>`,
  );
  const extraRels = [
    ["rIdMeta", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata", "metadata.xml"],
    ["rIdRv", "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue", "richData/rdrichvalue.xml"],
    ["rIdRvs", "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure", "richData/rdrichvaluestructure.xml"],
    ["rIdRvRel", "http://schemas.microsoft.com/office/2022/10/relationships/richValueRel", "richData/richValueRel.xml"],
  ]
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("");
  zip.file("xl/_rels/workbook.xml.rels", workbookRels.replace("</Relationships>", `${extraRels}</Relationships>`));
  const types = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  const overrides = [
    ["/xl/metadata.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"],
    ["/xl/richData/rdrichvalue.xml", "application/vnd.ms-excel.rdrichvalue+xml"],
    ["/xl/richData/rdrichvaluestructure.xml", "application/vnd.ms-excel.rdrichvaluestructure+xml"],
    ["/xl/richData/richValueRel.xml", "application/vnd.ms-excel.richvaluerel+xml"],
  ]
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join("");
  zip.file("[Content_Types].xml", types.replace("</Types>", `${overrides}</Types>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * A BILL WITH A PROTOTYPE QUANTITY AND TWO COLUMNS TO KEEP (2026-10-06) —
 * invented, in the shape of a specifier's bill that quotes a rollout and a
 * prototype quantity side by side and phases its items itself. "Rollout
 * Quantity" is no synonym, so the test says which column is the quantity, as
 * a person would on the Columns panel; "Prototype Quantity" is.
 *
 *   3  ZZ-PR-01  Armchair     rollout 40, prototype 1        PHASE 2, Zone note
 *   4  FAB-01 (ZZ-PR-01)      its fabric — prototype 1, never a mock-up item
 *   5  ZZ-PR-02  Side table   rollout 20, prototype PARTIAL  PHASE 3
 *   6  ZZ-PR-03  Bed          rollout 12, prototype N/A
 *   7  ZZ-PR-04  Desk         rollout 12, prototype blank    PHASE 5, Zone note
 */
export async function prototypeBillWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  addSheet(book, "Bill", [
    ["Example Hotel — FF&E", null, null, null, null, null],
    ["Code", "Description", "Rollout Quantity", "Prototype Quantity", "PHASE", "Zone note"],
    ["ZZ-PR-01", "Armchair", 40, 1, 2, "near the window"],
    ["FAB-01 (ZZ-PR-01)", "EXAMPLE MILL | BOUCLE | IVORY", null, 1, null, null],
    ["ZZ-PR-02", "Side table", 20, "PARTIAL", 3, null],
    ["ZZ-PR-03", "Bed", 12, "N/A", null, null],
    ["ZZ-PR-04", "Desk", 12, null, 5, "by the door"],
  ]);
  return bytes(book);
}

/** A BILL WITH NO CODES AT ALL — invented: a description, a quantity and the client's own phasing. */
export async function codelessBillWorkbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  addSheet(book, "Public areas", [
    ["Description", "Qty", "PHASE"],
    ["Example lounge chair", 6, 2],
    ["Example coffee table", 2, 3],
  ]);
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
  "bill-fabric-swatches.xlsx": fabricSwatchBillWorkbook,
  "bill-finish-lines.xlsx": finishLinesBillWorkbook,
  "bill-in-cell-pictures.xlsx": inCellPictureBillWorkbook,
  "bill-prototype-quantity.xlsx": prototypeBillWorkbook,
  "bill-codeless.xlsx": codelessBillWorkbook,
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
