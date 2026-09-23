// A spreadsheet read in ROW WINDOWS — one charged read made of several calls,
// each over consecutive rows (plan any-bill, Step 8).
//
// ============================================================================
// WHY: ONE CALL CANNOT READ A 300-LINE BILL.
//
// Measured on the local stack, 2026-09-23, on a real 101-line pricing document
// read as an `ffe_schedule` (Opus 5, effort high): 559 proposals, 65,057
// output tokens, 498 s — half the 128K output ceiling and two thirds of the
// 740 s model deadline, for ONE hundred lines. That is about 644 output tokens
// and 4.9 s per row, so a 300-line bill would need ~193K tokens and ~25
// minutes in one call: truncated, or cut off by the deadline, either way after
// it had been paid for.
//
// So a sheet with more data rows than `ROWS_PER_WINDOW` is read as several
// calls over consecutive rows, the header rows repeated in each, and the
// proposals merged in row order — every observation keeping the ABSOLUTE row
// it came from, because each row is sent with its own number in front of it.
//
// THIS IS NOT THE EXCLUDED "SPLITTING AN OVERSIZE DRAWING SET". A page split
// can cut a drawing in half; a spreadsheet has rows, a window boundary falls
// between two of them, and nothing on either side is lost. The one thing a
// boundary could separate — a fabric line from the item above it — is kept
// together (`keepWithPrevious`).
//
// ============================================================================
// THE ARITHMETIC, AND WHY THE WINDOWS RUN THREE AT A TIME.
//
// 40 rows ≈ 26K output tokens ≈ 200 s: a fifth of the output ceiling and well
// under a third of the deadline, leaving room for a bill whose descriptions
// are denser than the measured one. ONE ATTEMPT holds all of a document's
// windows — one claim, one fence, one staged result — and one attempt is one
// invocation bounded by `RUN_ABORT_MS` (770 s). Sequentially that is three
// windows, 120 rows. So the windows run `WINDOWS_IN_FLIGHT` at a time inside
// the one invocation: 9 windows is three waves ≈ 600 s, which is 360 rows,
// and a 300-line bill fits with a wave to spare. No timing constant moved;
// `tests/lib/extraction-timing.test.ts` states the sum.
//
// Past `MAX_WINDOWS` the read is REFUSED before any call, with the number in
// words, the way a PDF over the page ceiling is. The fix that lifts the limit
// — each window its own queue message, merged when the last lands — is a
// change to the attempt protocol and is proposed, not built.
//
// PURE: no database, no model, no clock.
// ============================================================================
import type { SheetData } from "read-excel-file/node";
import type { RawProposal } from "@/lib/extraction-schema";

/** Data rows per call. See the arithmetic above. */
export const ROWS_PER_WINDOW = 40;

/** Calls in flight at once, inside the one invocation. */
export const WINDOWS_IN_FLIGHT = 3;

/** The most windows one read may take: three waves of three. */
export const MAX_WINDOWS = 9;

/** The measurement the three numbers above rest on (2026-09-23, 101 rows). */
export const MEASURED_READ = { rows: 101, outputTokens: 65_057, elapsedMs: 498_334 } as const;

/** The same ceiling `MAX_SPREADSHEET_TEXT_CHARS` sets for a whole workbook, per call. */
const MAX_WINDOW_TEXT_CHARS = 1_500_000;

export type SheetRows = { sheet: string; data: SheetData };

export type WindowSlice = {
  sheet: string;
  /** Row numbers (1-based) sent ahead of the data as headings, for reference. */
  headerRows: number[];
  firstRow: number;
  lastRow: number;
};

export type RowWindow = { index: number; slices: WindowSlice[]; dataRows: number };

export type WindowPlanOptions = {
  /** The sheet's heading rows, where something already knows them (a confirmed bill). */
  headerRowsFor?: (sheet: string) => number[] | null;
  /** A row that must sit in the same window as the row above it (a fabric line). */
  keepWithPrevious?: (sheet: string, row: number) => boolean;
  rowsPerWindow?: number;
};

function isBlank(row: SheetData[number] | undefined): boolean {
  return !row || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

/** The first non-blank row, where nothing says otherwise. */
function defaultHeader(data: SheetData): number[] {
  const index = data.findIndex((row) => !isBlank(row));
  return index === -1 ? [] : [index + 1];
}

/**
 * The windows a workbook is read in. A sheet within the limit is one slice; a
 * longer one is several. Small sheets share a window, so a workbook of five
 * short tabs is still one call.
 */
export function planRowWindows(sheets: SheetRows[], options: WindowPlanOptions = {}): RowWindow[] {
  const limit = options.rowsPerWindow ?? ROWS_PER_WINDOW;
  const windows: RowWindow[] = [];
  let current: RowWindow | null = null;
  const open = (): RowWindow => {
    const window: RowWindow = { index: windows.length, slices: [], dataRows: 0 };
    windows.push(window);
    return window;
  };

  for (const { sheet, data } of sheets) {
    const header = (options.headerRowsFor?.(sheet) ?? null)?.filter((row) => row >= 1 && row <= data.length) ?? defaultHeader(data);
    // Every non-blank row that is not a heading is a row to read — the title
    // block above a late header included, in the first window, because a
    // bill's notes and revision live there.
    const headings = new Set(header);
    const rows: number[] = [];
    for (let row = 1; row <= data.length; row += 1) if (!headings.has(row) && !isBlank(data[row - 1])) rows.push(row);
    if (rows.length === 0) continue;

    let start = 0;
    while (start < rows.length) {
      const room = current ? limit - current.dataRows : 0;
      if (!current || room <= 0) {
        current = open();
      }
      const space = limit - current.dataRows;
      let end = Math.min(rows.length, start + space);
      // A fabric line is never the first row of the next window: it goes with
      // the item above it, even if that makes this window a few rows long.
      while (end < rows.length && options.keepWithPrevious?.(sheet, rows[end]!)) end += 1;
      const slice = rows.slice(start, end);
      current.slices.push({ sheet, headerRows: header, firstRow: slice[0]!, lastRow: slice[slice.length - 1]! });
      current.dataRows += slice.length;
      start = end;
      if (start < rows.length) current = null;
    }
  }
  return windows;
}

function serialiseCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/**
 * One window as the model reads it: every row NUMBERED, so the row an
 * observation names is the sheet's own row whichever window it was read in.
 * Blank rows are left out; the numbers keep their places.
 */
export function windowText(sheets: SheetRows[], window: RowWindow): string {
  const parts = window.slices.map((slice) => {
    const data = sheets.find((entry) => entry.sheet === slice.sheet)?.data ?? [];
    const line = (row: number) => `${row}: ${JSON.stringify((data[row - 1] ?? []).map(serialiseCell))}`;
    // In ROW ORDER, headings included, so a title block above a late header
    // reads above it as it does on the sheet.
    const rows = new Set(slice.headerRows);
    for (let row = slice.firstRow; row <= slice.lastRow; row += 1) if (!isBlank(data[row - 1])) rows.add(row);
    const lines = [...rows].sort((a, b) => a - b).map(line);
    return `<sheet name=${JSON.stringify(slice.sheet)}>\n${lines.join("\n")}\n</sheet>`;
  });
  const text = `<spreadsheet>\n${parts.join("\n")}\n</spreadsheet>`;
  if (text.length > MAX_WINDOW_TEXT_CHARS) {
    throw new Error("The spreadsheet contains too much text for one intake. Split it into smaller files and try again.");
  }
  return text;
}

/**
 * The instruction that goes with a window, AFTER the kind's own prompt. It
 * names no sheet and quotes nothing from the document: it is the app talking,
 * and the document's text stays on the other side of that line.
 */
export function windowInstruction(window: RowWindow, total: number): string {
  const numbered =
    "The spreadsheet is given as numbered rows: each row begins with its own row number and a colon. " +
    "Use that number as sourceRow for anything you read from the row.";
  if (total <= 1) return numbered;
  const ranges = window.slices.map((slice) => `rows ${slice.firstRow}-${slice.lastRow}`).join(", ");
  return (
    `${numbered}\n\nThis is part ${window.index + 1} of ${total} of one document, read in parts: it covers ${ranges}. ` +
    "The heading rows at the top of each sheet are repeated for reference only; record nothing from them. " +
    "Rows outside this part are read separately, so record only what these rows state."
  );
}

/**
 * Every window's proposals as ONE list, in window order.
 *
 * The row a proposal names must be a row its window was sent; one that is not
 * — a heading, or a row from nowhere — loses its row rather than being placed
 * on whatever that row is, and the note says so. A window of one sheet names
 * its sheet for any proposal that did not.
 */
export function mergeWindowProposals(windows: RowWindow[], outputs: RawProposal[][]): RawProposal[] {
  const merged: RawProposal[] = [];
  windows.forEach((window, index) => {
    for (const proposal of outputs[index] ?? []) {
      const fold = (name: string | null | undefined) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
      const named = window.slices.find((slice) => fold(slice.sheet) === fold(proposal.sourceSheet));
      const only = window.slices.length === 1 ? window.slices[0]! : null;
      const slice = named ?? (proposal.sourceSheet ? null : only);
      const sheet = slice ? slice.sheet : proposal.sourceSheet;
      const row = proposal.sourceRow;
      const inside =
        row !== null &&
        row !== undefined &&
        (slice
          ? row >= slice.firstRow && row <= slice.lastRow
          : window.slices.some((entry) => row >= entry.firstRow && row <= entry.lastRow));
      if (row !== null && row !== undefined && !inside) {
        const why = `Read as row ${row}, which is not a row this part of the document was given; the row is not used.`;
        merged.push({ ...proposal, sourceSheet: sheet ?? null, sourceRow: null, note: proposal.note ? `${proposal.note} ${why}` : why });
        continue;
      }
      merged.push({ ...proposal, sourceSheet: sheet ?? null });
    }
  });
  return merged;
}
