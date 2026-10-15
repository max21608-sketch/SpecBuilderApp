// A bill that arrived as a PDF, read by CODE from the PDF's own text layer.
//
// ============================================================================
// WHY THIS EXISTS (workstream C1, docs/plans/ronnie-scotts-followups-2026-10-15.md)
//
// The Ronnie Scott's tender (P16717) sent its bill ONLY as "Procurement
// Schedule" PDFs printed from the procurement company's workbook, and the app
// refused a bill inside a PDF — rightly, because a bill is read by code, cell
// by cell, and the model may read a bill's STRUCTURE but never transcribe its
// cells (Max, 2026-09-23). Max converted them by hand with `npm run
// pdf:schedule`. Claudia asked for PDF bills and Max said yes (2026-10-15):
// first by code, from the text layer, exactly as that tool did.
//
// A PDF PRINTED FROM A SPREADSHEET STILL CARRIES ITS CELLS AS TEXT. Every
// cell's words are a string the PDF prints at a position, so the grid can be
// put back by position with no model and no OCR — and every value staged from
// it is a string the PDF printed, which is what keeps the rule above whole:
//
//   * the COLUMNS are the header's own labels. The header is found by its
//     QUANTITY heading ("ORDER QTY", "QTY", "Total quantity"), because the
//     quantity is the one column every bill has and the one rows hang on; a
//     label stacked over two or three lines ("ORDER" / "QTY") is one label,
//     joined by the column it sits in. A piece of body text belongs to the
//     column whose label centre is nearest;
//   * the ROWS are anchored on the quantity column — one figure per line,
//     printed centred in its row — and a line of text belongs to the row whose
//     anchor is nearest, within reach of it.
//
// WHAT IT CANNOT DO, said on the screen as well as here: it carries NO
// pictures (a PDF's pictures are not cells), and it works on a PDF PRINTED
// FROM A SPREADSHEET. A laid-out designer's sheet, or a scan, has no grid to
// put back; it is refused in one sentence, and the native workbook is the way
// out. (C2, queued: such a PDF may be transcribed by the model, every line
// marked — `PdfBillRead`'s failure `code` is what that route reads.)
//
// The workbook this builds is an ordinary bill from then on: registration
// stores it beside the PDF and parses it through the same reader as any
// uploaded .xlsx — the Columns panel, the model's structure read, the review
// and the confirm are all unchanged. Each workbook row remembers the PDF page
// it came from (`rowPages`), which the review prints beside the line.
// ============================================================================
import ExcelJS from "exceljs";
import { foldHeading } from "@/lib/boq-roles";
import { REFERENCE_BOQ_ALIASES, type BoqAlias } from "@/lib/boq-import";

import { type PdfBillFailureCode } from "@/lib/pdf-bill-source";

export { pdfBillRefusal, pdfPageOfLine, type PdfBillFailureCode, type PdfBillSource } from "@/lib/pdf-bill-source";

/** One piece of text the PDF prints, in page units, y growing DOWN the page. */
export type PdfTextItem = { str: string; x: number; y: number; w: number; h: number };

/** One line of the bill as the PDF printed it: its page and its cells, in header order. */
export type PdfBillRow = { page: number; cells: string[] };

export type PdfBillRead =
  | {
      ok: true;
      /** The header's labels, in column order, stacked lines joined. */
      header: string[];
      /** Which of them is the quantity the rows were anchored on. */
      quantityColumn: number;
      rows: PdfBillRow[];
      pageCount: number;
    }
  | { ok: false; code: PdfBillFailureCode; detail: string };

/** The sheet the workbook holds, a default name so the PHASE is named after the PDF (`proposePhaseNames`). */
export const PDF_BILL_SHEET = "Sheet1";

/** Written beside the PDF's own name, so every list that names the run says where it came from. */
export const PDF_BILL_WORKBOOK_SUFFIX = " (read from PDF).xlsx";

/** The workbook's header row; its lines start on the row after it. */
const HEADER_ROW = 1;

const fold = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();

/** A quantity as a bill prints one: `9`, `13.5`, `1,200`. Never a code, never a range. */
const QUANTITY = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

/** The words a quantity heading is made of, whole words only. */
const QUANTITY_WORDS = new Set(["QTY", "QTY.", "QUANTITY", "QUANTITIES", "Q-TY", "QTE", "QTÉ"]);
/** A heading carrying one of these is a price, whatever else it says ("QTY RATE"). */
const PRICE_WORDS = new Set(["RATE", "PRICE", "COST", "VALUE", "AMOUNT", "£", "$", "€"]);

/**
 * Is this header label a quantity? A whole heading the registers know as one
 * (`boq_column_aliases`, role qty), or a short heading built round the word
 * QTY / QUANTITY and naming no price. The second half is wider than the
 * aliases on purpose — "ORDER QTY" is no synonym and the model read it on the
 * real bill — and it decides only which column the ROWS hang on: the column's
 * ROLE is still mapped by the ordinary bill path, synonym, model or person.
 */
function quantityLabel(label: string, vocabulary: Vocabulary): "alias" | "word" | null {
  if (vocabulary.quantity.has(foldHeading(label))) return "alias";
  const words = fold(label).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (words.some((word) => PRICE_WORDS.has(word))) return null;
  return words.some((word) => QUANTITY_WORDS.has(word)) ? "word" : null;
}

type Column = { label: string; centre: number };

/** Centres closer than this (page units) are one column's stacked label. */
const STACK_GAP = 12;
/** How far above and below a header's quantity label its other labels may sit, in line heights. */
const HEADER_REACH = 2.6;

function centreOf(item: PdfTextItem): number {
  return item.x + item.w / 2;
}

/** Labels grouped by column centre, each column's lines read top to bottom. */
function composeColumns(items: PdfTextItem[]): Column[] {
  const groups: { items: PdfTextItem[]; centre: number }[] = [];
  for (const item of [...items].sort((a, b) => centreOf(a) - centreOf(b))) {
    const centre = centreOf(item);
    const near = groups.find((group) => Math.abs(group.centre - centre) < STACK_GAP);
    if (near) {
      near.items.push(item);
      near.centre = near.items.reduce((sum, i) => sum + centreOf(i), 0) / near.items.length;
    } else groups.push({ items: [item], centre });
  }
  return groups
    .map((group) => ({
      label: group.items
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      centre: group.centre,
    }))
    .sort((a, b) => a.centre - b.centre);
}

function columnOf(columns: Column[], item: PdfTextItem): number {
  const centre = centreOf(item);
  let best = 0;
  for (let c = 1; c < columns.length; c++) {
    if (Math.abs(columns[c]!.centre - centre) < Math.abs(columns[best]!.centre - centre)) best = c;
  }
  return best;
}

type Header = { columns: Column[]; quantityColumn: number; bottom: number };

/** The folded headings the registers know, by role: what tells a table's header from a label on a sheet. */
type Vocabulary = { quantity: ReadonlySet<string>; other: ReadonlySet<string> };

/**
 * A HEADER NAMES TWO MORE COLUMNS A BILL HAS, besides its quantity, and is
 * made of labels rather than sentences. Both were measured on real PDFs that
 * are not bills, on the local stack, 2026-10-15:
 *
 *   * a specification sheet prints "QUANTITY : 2" over a drawing whose
 *     figures sit below it in a column (Ronnie Scott's CH-02), and read as
 *     three lines of a bill;
 *   * a preamble's prose — "quantities and dimensions supplied by the
 *     Interior Designer" — grouped word by word into "columns" (the merged
 *     Panther pack), and read as two.
 *
 * So two other labels must be headings the registers know WHOLE (a code, a
 * description, a unit, an area) — the app's own vocabulary, matched exactly,
 * never a substring — and no piece of text in the band may be a line of prose.
 * A spreadsheet wraps a long heading inside its cell, so a printed header is
 * short pieces: the longest on the Ronnie Scott's schedules is 27 characters.
 * Checked against 47 real PDFs that are not bills (Aman, Panther, the bills of
 * 2026-10-06) and 26 Ronnie Scott's sheets: none reads as a bill.
 */
const MAX_HEADER_PIECE = 40;
function looksLikeAHeader(band: PdfTextItem[], columns: Column[], quantityColumn: number, vocabulary: Vocabulary): boolean {
  if (band.some((item) => item.str.trim().length > MAX_HEADER_PIECE)) return false;
  const known = columns.filter((column, index) => index !== quantityColumn && vocabulary.other.has(foldHeading(column.label)));
  return known.length >= 2;
}

type HeaderSearch =
  | { found: Header }
  | { found: null; several: string[] | null };

/**
 * The page's header: the TOPMOST band, round a piece of text carrying a
 * quantity word, whose columns hold exactly one quantity heading, at least
 * three columns in all, and a quantity printed beneath it.
 *
 * The band is the tool's: everything within `HEADER_REACH` line heights of
 * that text, cut halfway to the first quantity below it so a dense table's
 * first line is never read as part of its header.
 */
function findHeader(items: PdfTextItem[], vocabulary: Vocabulary): HeaderSearch {
  const keys = items
    .filter((item) => {
      const words = fold(item.str).split(" ");
      return words.some((word) => QUANTITY_WORDS.has(word)) || vocabulary.quantity.has(foldHeading(item.str));
    })
    .sort((a, b) => a.y - b.y);
  let several: string[] | null = null;
  // A header with nothing under it is still a header — "no line has a
  // quantity" is a truer sentence than "no quantity column" — but it is kept
  // only as a last resort: a header with a figure under it is the stronger
  // reading, and a stray "QTY" in a description has none.
  let empty: Header | null = null;
  for (const key of keys) {
    const reach = key.h * HEADER_REACH;
    let band = items.filter((item) => Math.abs(item.y - key.y) <= reach);
    let columns = composeColumns(band);
    const quantity = pickQuantity(columns, vocabulary);
    if (quantity === null) continue;
    if (Array.isArray(quantity)) {
      several ??= quantity;
      continue;
    }
    // Cut the band at the first quantity printed under the heading.
    const below = items
      .filter((item) => item.y > key.y && QUANTITY.test(item.str.trim()) && columnOf(columns, item) === quantity)
      .sort((a, b) => a.y - b.y)[0];
    if (!below) {
      if (!empty && columns.length >= 3 && looksLikeAHeader(band, columns, quantity, vocabulary)) {
        empty = { columns, quantityColumn: quantity, bottom: key.y + reach };
      }
      continue;
    }
    const cut = Math.min(key.y + reach, (key.y + below.y) / 2);
    band = band.filter((item) => item.y <= cut);
    columns = composeColumns(band);
    const settled = pickQuantity(columns, vocabulary);
    if (typeof settled !== "number" || columns.length < 3 || !looksLikeAHeader(band, columns, settled, vocabulary)) continue;
    return { found: { columns, quantityColumn: settled, bottom: cut } };
  }
  return empty ? { found: empty } : { found: null, several };
}

/** The one quantity column, its index; several → their labels; none → null. */
function pickQuantity(columns: Column[], vocabulary: Vocabulary): number | string[] | null {
  const readings = columns.map((column) => quantityLabel(column.label, vocabulary));
  const aliases = readings.flatMap((reading, index) => (reading === "alias" ? [index] : []));
  if (aliases.length === 1) return aliases[0]!;
  const any = readings.flatMap((reading, index) => (reading ? [index] : []));
  if (any.length === 1) return any[0]!;
  if (any.length > 1) return any.map((index) => columns[index]!.label);
  return null;
}

/** A page's lines, as cell strings in the header's column order. */
function pageRows(items: PdfTextItem[], header: Header, top: number): string[][] {
  const { columns, quantityColumn } = header;
  const body = items.filter((item) => item.y > top);
  const anchors = body
    .filter((item) => columnOf(columns, item) === quantityColumn && QUANTITY.test(item.str.trim()))
    .map((item) => item.y)
    .sort((a, b) => a - b);
  if (anchors.length === 0) return [];
  // THE REACH OF A ROW: half the widest gap between two anchors, or a few
  // lines where there is one row. Beyond it a piece of text belongs to no line
  // — a footer's date and page number, a note under the table — and is left
  // out rather than glued onto the last line's cells.
  const lineHeight = median(body.map((item) => item.h)) || 7;
  let widest = 0;
  for (let r = 1; r < anchors.length; r++) widest = Math.max(widest, anchors[r]! - anchors[r - 1]!);
  const reach = Math.max(widest / 2, lineHeight * 4);
  const cells: PdfTextItem[][][] = anchors.map(() => columns.map(() => [] as PdfTextItem[]));
  for (const item of body) {
    let row = 0;
    for (let r = 1; r < anchors.length; r++) {
      if (Math.abs(anchors[r]! - item.y) < Math.abs(anchors[row]! - item.y)) row = r;
    }
    if (Math.abs(anchors[row]! - item.y) > reach) continue;
    cells[row]![columnOf(columns, item)]!.push(item);
  }
  return cells.map((row) => row.map(cellText));
}

/** A cell's text: pieces within half a line height share a line, read left to right. */
function cellText(cell: PdfTextItem[]): string {
  const sorted = [...cell].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) < item.h * 0.5) last.push(item);
    else lines.push([item]);
  }
  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * THE READER, over text already taken off the pages. Pure, so every rule above
 * is provable on synthetic pages without a PDF parser in the test.
 *
 * Pages before the first header are skipped (a cover sheet); a later page
 * with no header of its own continues the last one's columns, which is how a
 * spreadsheet prints without repeated titles; a later page printing a
 * DIFFERENT header is refused, because two tables in one file are two bills.
 */
export function readPdfBillPages(
  pages: PdfTextItem[][],
  options: { aliases?: readonly BoqAlias[] } = {},
): PdfBillRead {
  const aliases = options.aliases ?? REFERENCE_BOQ_ALIASES;
  const vocabulary: Vocabulary = {
    quantity: new Set(aliases.filter((alias) => alias.role === "qty").map((alias) => foldHeading(alias.term))),
    other: new Set(aliases.filter((alias) => alias.role !== "qty").map((alias) => foldHeading(alias.term))),
  };
  if (pages.every((items) => items.length === 0)) {
    return { ok: false, code: "no_text", detail: "None of its pages carries any text." };
  }
  let header: Header | null = null;
  let firstHeaderPage = 0;
  let several: string[] | null = null;
  const rows: PdfBillRow[] = [];
  for (let index = 0; index < pages.length; index++) {
    const items = pages[index]!;
    const search = findHeader(items, vocabulary);
    if (!search.found) several ??= search.several;
    let top = Number.NEGATIVE_INFINITY;
    if (search.found) {
      if (header && search.found.columns.map((c) => fold(c.label)).join("|") !== header.columns.map((c) => fold(c.label)).join("|")) {
        return {
          ok: false,
          code: "columns_change",
          detail: `Page ${index + 1} prints the columns ${search.found.columns.map((c) => c.label).join(" | ")}, and page ${firstHeaderPage} printed ${header.columns.map((c) => c.label).join(" | ")}.`,
        };
      }
      if (!header) firstHeaderPage = index + 1;
      // A repeated header keeps page 1's centres; its own band is cut away.
      header = header ?? search.found;
      top = search.found.bottom;
    }
    if (!header) continue;
    for (const cells of pageRows(items, header, top)) rows.push({ page: index + 1, cells });
  }
  if (!header) {
    if (several) {
      return { ok: false, code: "several_quantity_columns", detail: `It prints ${several.join(", ")}, and which one counts is not something code can tell.` };
    }
    return { ok: false, code: "no_quantity_column", detail: "No page prints a header with one quantity column above a quantity." };
  }
  if (rows.length === 0) {
    return { ok: false, code: "no_rows", detail: `The columns ${header.columns.map((c) => c.label).join(" | ")} were found, with nothing under them.` };
  }
  return {
    ok: true,
    header: header.columns.map((column) => column.label),
    quantityColumn: header.quantityColumn,
    rows,
    pageCount: pages.length,
  };
}

/**
 * The text on every page, by position. pdfjs's legacy build, the fake worker
 * handed to it as a module — on the server a bundler moves pdfjs into a
 * vendor chunk, where its own lookup of `pdf.worker.mjs` beside itself finds
 * nothing (next.config.ts says why the package is not marked external).
 */
export async function pdfTextItems(bytes: Uint8Array): Promise<PdfTextItem[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const holder = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!holder.pdfjsWorker) holder.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  // A copy: pdfjs transfers the buffer it is given, and the caller still holds it.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages: PdfTextItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        if (!raw.str.trim()) continue;
        const h = Math.abs(raw.transform[3]) || raw.height || 5;
        // PDF y grows upwards; flip so a larger y is further DOWN the page.
        items.push({ str: raw.str, x: raw.transform[4], y: -raw.transform[5], w: raw.width, h });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** `readPdfBillPages` over a PDF's bytes. Never throws: a PDF it cannot open is `unreadable`. */
export async function readPdfBill(bytes: Uint8Array, options: { aliases?: readonly BoqAlias[] } = {}): Promise<PdfBillRead> {
  let pages: PdfTextItem[][];
  try {
    pages = await pdfTextItems(bytes);
  } catch (cause) {
    return { ok: false, code: "unreadable", detail: cause instanceof Error ? cause.message : String(cause) };
  }
  return readPdfBillPages(pages, options);
}

/**
 * The read put back into a workbook: the header on row 1, a line per row
 * under it. The QUANTITY cell is written as a number — it is a figure the PDF
 * printed, commas taken out — and every other cell as the text it printed, so
 * a code such as `0012` keeps its zeros.
 */
export async function pdfBillWorkbook(
  read: Extract<PdfBillRead, { ok: true }>,
  sheetName: string = PDF_BILL_SHEET,
): Promise<{ bytes: Buffer; rowPages: number[]; firstRow: number }> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName);
  sheet.addRow(read.header);
  for (const row of read.rows) {
    sheet.addRow(
      row.cells.map((cell, index) => {
        if (!cell) return null;
        if (index === read.quantityColumn && QUANTITY.test(cell)) return Number(cell.replace(/,/g, ""));
        return cell;
      }),
    );
  }
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  return { bytes, rowPages: read.rows.map((row) => row.page), firstRow: HEADER_ROW + 1 };
}

/** The workbook's pathname, BESIDE the PDF's: same project prefix, the PDF's name and the suffix. */
export function pdfBillWorkbookPathname(pdfPathname: string): string {
  return `${pdfPathname.replace(/\.pdf$/i, "")}${PDF_BILL_WORKBOOK_SUFFIX}`;
}

/** The workbook's filename, from the PDF's. */
export function pdfBillWorkbookFilename(pdfFilename: string): string {
  return `${pdfFilename.replace(/\.pdf$/i, "")}${PDF_BILL_WORKBOOK_SUFFIX}`;
}
