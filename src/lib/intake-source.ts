import readExcelFile, { type SheetData } from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import { intakeSourceKind } from "@/lib/intake-source-types";

export type DocumentSource =
  | { type: "pdf"; base64: string }
  | { type: "spreadsheet"; text: string };

const MAX_SPREADSHEET_CELLS = 200_000;
const MAX_SPREADSHEET_TEXT_CHARS = 1_500_000;

function textFromBytes(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function serialiseCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function spreadsheetSheetsToText(sheets: { sheet: string; data: SheetData }[]): string {
  let cellCount = 0;
  const parts = sheets.map(({ sheet, data }) => {
    cellCount += data.reduce((total, row) => total + row.length, 0);
    if (cellCount > MAX_SPREADSHEET_CELLS) {
      throw new Error("The spreadsheet contains too many cells for one intake. Split it into smaller files and try again.");
    }
    const rows = data.map((row) => JSON.stringify(row.map(serialiseCell))).join("\n");
    return `<sheet name=${JSON.stringify(sheet)}>\n${rows}\n</sheet>`;
  });
  const text = `<spreadsheet>\n${parts.join("\n")}\n</spreadsheet>`;
  if (text.length > MAX_SPREADSHEET_TEXT_CHARS) {
    throw new Error("The spreadsheet contains too much text for one intake. Split it into smaller files and try again.");
  }
  return text;
}

/**
 * A spreadsheet as positional rows, one entry per sheet.
 *
 * Shared by the two readers that must agree about what a workbook contains:
 * the deterministic BOQ parser and the text flattener that feeds the model. A
 * .csv becomes one pseudo-sheet named after the file — a BOQ is a BOQ whether
 * the client exported it as a workbook or as a single comma-separated tab, and
 * the declared import type, never the extension, is what says so.
 */
export async function readSpreadsheetSheets(
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<{ sheet: string; data: SheetData }[]> {
  const kind = intakeSourceKind(filename, contentType);
  if (kind === "xlsx") return readExcelFile(bytes);
  if (kind === "csv" || kind === "tsv") {
    const data = parse(textFromBytes(bytes), {
      delimiter: kind === "csv" ? "," : "\t",
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as string[][];
    return [{ sheet: filename, data }];
  }
  throw new Error("That file is not a spreadsheet. Upload an .xlsx, .csv or .tsv file.");
}

export async function prepareDocumentSource(bytes: Buffer, filename: string, contentType: string): Promise<DocumentSource> {
  const kind = intakeSourceKind(filename, contentType);
  if (kind === "pdf") return { type: "pdf", base64: bytes.toString("base64") };
  if (kind === "xlsx" || kind === "csv" || kind === "tsv") {
    return { type: "spreadsheet", text: spreadsheetSheetsToText(await readSpreadsheetSheets(bytes, filename, contentType)) };
  }
  throw new Error("Unsupported intake file. Upload a PDF, .xlsx, .csv or .tsv file.");
}
