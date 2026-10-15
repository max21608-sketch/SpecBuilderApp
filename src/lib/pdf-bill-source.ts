// What a staged bill remembers of the PDF it was read from, how a line finds
// its page, and the one sentence a PDF bill is refused in. A LEAF, apart from `pdf-bill.ts`, because the bill review is
// a client component and the reader pulls exceljs and pdfjs: one import of
// the reader from a screen would put both in the browser bundle.

/**
 * What the staged bill remembers of the PDF it was read from. On the DOCUMENT,
 * not on each line — the `rowImages` rule: re-reading a sheet with a person's
 * columns re-stages its lines, and the pages must survive that.
 */
export type PdfBillSource = {
  /** The PDF's own `attachments` row — what "open the PDF" serves. Never a URL. */
  attachmentId: string;
  filename: string;
  sheet: string;
  /** Workbook row of `pages[0]`. */
  firstRow: number;
  /** The PDF page of each line, in workbook-row order. */
  pages: number[];
};

/** The PDF page a staged line was read from, or null for a line that was not. */
export function pdfPageOfLine(
  source: Pick<PdfBillSource, "sheet" | "firstRow" | "pages"> | null | undefined,
  sheetName: string,
  lineNo: number,
): number | null {
  if (!source || source.sheet !== sheetName) return null;
  const page = source.pages[lineNo - source.firstRow];
  return typeof page === "number" && Number.isFinite(page) ? page : null;
}

/** Why a PDF's text could not be put back into a bill. Stable: C2 reads it. */
export type PdfBillFailureCode =
  | "unreadable"
  | "no_text"
  | "no_quantity_column"
  | "several_quantity_columns"
  | "no_rows"
  | "columns_change";

/**
 * ONE SHORT SENTENCE, for the upload row and the registration's 400.
 *
 * Max, 2026-10-15: a blocker says what is wrong and the next step in a few
 * words. The detail (`PdfBillRead.detail`) names the page and the columns it
 * saw and goes beside it, one click away, never instead of it.
 */
export function pdfBillRefusal(code: PdfBillFailureCode): string {
  const why: Record<PdfBillFailureCode, string> = {
    unreadable: "the PDF could not be opened",
    no_text: "the PDF has no text to read",
    no_quantity_column: "no quantity column was found",
    several_quantity_columns: "it has more than one quantity column",
    no_rows: "no line has a quantity",
    columns_change: "its columns change from page to page",
  };
  return `This PDF bill could not be read: ${why[code]}. Upload the spreadsheet instead.`;
}
