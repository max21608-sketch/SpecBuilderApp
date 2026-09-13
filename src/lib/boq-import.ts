// Parsing a client Bill of Quantities spreadsheet into staged lines.
//
// Deterministic on purpose: a BOQ is a grid, so reading it needs no model, no
// queue and no spend. `prepareDocumentSource` in intake-source.ts is NOT the
// right tool here — it flattens every sheet into one text blob for a model to
// read, and parsing back out of that would be inventing a second, worse CSV.
// This works on `read-excel-file`'s positional rows instead.
//
// What it must survive, taken from the pilot project's real BOQ:
//   * Three title rows and a blank row before the header. The header is found,
//     never assumed to be row 1.
//   * A client code that repeats. `SX11A` is two separate lines with different
//     quantities, and they are two separate records. Nothing here deduplicates.
//   * Free-text item descriptions ("Bench @entrance", "Chair @ desk",
//     "Coffee Table incl GLASS"), which is why category matching happens later,
//     against a human, rather than here.
//   * Trailing blank rows, and stray totals rows with no code.
//
// It deliberately does NOT: assign categories, resolve refs, deduplicate,
// or write anything. It returns what the sheet said, with the row number it
// said it on, so a reviewer can go and look.
import type { SheetData } from "read-excel-file";

export type BoqLine = {
  /** 1-based row number in the source sheet, for "go and look at line 34". */
  lineNo: number;
  designer: string | null;
  /** The BOQ's own grouping word ("Furniture" / "Seating"), not our category. */
  boqCategory: string | null;
  /** The client's code. NOT unique — see the SX11A note above. */
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
};

export type BoqParseResult =
  | { ok: true; sheet: string; headerRow: number; lines: BoqLine[]; skippedRows: number }
  | { ok: false; error: string };

/** Header synonyms, normalised. The pilot BOQ uses the first of each. */
const COLUMNS = {
  designer: ["designer"],
  boqCategory: ["category"],
  code: ["code", "client ref", "client reference", "ref"],
  itemDescription: ["item description", "description", "item"],
  productReference: ["product reference", "product ref", "reference"],
  qty: ["total qty updated", "total qty", "qty", "quantity"],
} as const;

type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: ColumnKey[] = ["code", "itemDescription"];

function norm(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = (value instanceof Date ? value.toISOString() : String(value)).replace(/\s+/g, " ").trim();
  return out === "" ? null : out;
}

function quantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Finds the header row and maps each wanted column to its index.
 * Returns null if this row is not a header.
 */
function mapHeader(row: readonly unknown[]): Partial<Record<ColumnKey, number>> | null {
  const found: Partial<Record<ColumnKey, number>> = {};
  row.forEach((cell, index) => {
    const value = norm(cell);
    if (!value) return;
    for (const [key, synonyms] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
      // First match wins: "Product Reference" must not be claimed by `code`'s
      // "reference" synonym once a real "Code" column has been seen.
      if (found[key] === undefined && synonyms.includes(value)) found[key] = index;
    }
  });
  return REQUIRED.every((key) => found[key] !== undefined) ? found : null;
}

/**
 * Parses the first sheet that looks like a BOQ. Multi-sheet workbooks are
 * common and the data is rarely on sheet 1.
 */
export function parseBoqSheets(sheets: { sheet: string; data: SheetData }[]): BoqParseResult {
  if (sheets.length === 0) return { ok: false, error: "The file has no sheets." };

  for (const { sheet, data } of sheets) {
    for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
      const row = data[rowIndex];
      if (!row) continue;
      const header = mapHeader(row);
      if (!header) continue;
      return readRows(sheet, data, rowIndex, header);
    }
  }

  return {
    ok: false,
    error:
      "Could not find a header row. A BOQ needs a row naming at least its code column " +
      `(one of: ${COLUMNS.code.join(", ")}) and its description column ` +
      `(one of: ${COLUMNS.itemDescription.join(", ")}).`,
  };
}

function readRows(
  sheet: string,
  data: SheetData,
  headerIndex: number,
  header: Partial<Record<ColumnKey, number>>,
): BoqParseResult {
  const at = (row: readonly unknown[], key: ColumnKey): unknown => {
    const index = header[key];
    return index === undefined ? null : row[index];
  };

  const lines: BoqLine[] = [];
  let skippedRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex];
    if (!row) continue;

    const itemDescription = text(at(row, "itemDescription"));
    const code = text(at(row, "code"));

    // A row with neither a code nor a description is a spacer or a totals row.
    // Counted rather than silently dropped, so the reviewer is told.
    if (!itemDescription && !code) {
      if (row.some((cell) => text(cell) !== null)) skippedRows += 1;
      continue;
    }

    lines.push({
      lineNo: rowIndex + 1,
      designer: text(at(row, "designer")),
      boqCategory: text(at(row, "boqCategory")),
      code,
      itemDescription: itemDescription ?? "",
      productReference: text(at(row, "productReference")),
      qty: quantity(at(row, "qty")),
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: `Found a header on sheet "${sheet}" but no rows under it.` };
  }
  return { ok: true, sheet, headerRow: headerIndex + 1, lines, skippedRows };
}

/**
 * Normalised form of a client reference, for the ref_value_norm column.
 * `FU06C-CG27.2` and `FU06C - CG27.2` are the same reference written twice;
 * this is what makes them compare equal. The original is always kept alongside.
 */
export function normaliseRef(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
}
