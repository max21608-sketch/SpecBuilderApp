import readExcelFile, { type SheetData } from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import { intakeSourceKind } from "@/lib/intake-source-types";

export type DocumentSource =
  | { type: "pdf"; base64: string }
  | { type: "spreadsheet"; text: string }
  // An email reaches the model as text: headers, then the body, with any quoted
  // history marked. Attachments are NOT inlined — a file's kind is declared by
  // a person, never inferred, so registering one is its own deliberate act.
  | { type: "email"; text: string };

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

// ============================================================================
// HOW MANY PAGES ONE READ TAKES — Stage 2 variance row 6.
//
// MEASURED FIRST, as the row asked, and the finding is that nothing in this app
// had ever counted. A 120-page PDF is registered (the 20MB byte cap does not
// touch it — a 120-page synthetic is 33KB and even a real drawing set of that
// length is usually under the cap), base64'd whole, and sent. It does not hang:
// `MODEL_DEADLINE_MS` bounds it at 240s inside a 270s run abort. What it does
// is come back from the API as a 400, which `classifyTransportFailure` reports
// as `invalid_request` — "The request was refused (400)." — so the run goes
// terminal, an attempt is spent on a charged request, and the sentence in front
// of the person says nothing about pages.
//
// So the cap is stated here, where the bytes are already in hand and BEFORE the
// call. A refusal at this point costs nothing: `extraction-run.ts` catches it
// and fails the run with these words, which is the same treatment an encrypted
// or unparseable file already gets.
//
// IT IS NOT ENFORCED AT REGISTRATION, and that is deliberate.
// `registerSpecDocument` reads only the store's METADATA — `headTrustedBlob` —
// precisely so registering an eleven-document pack does not pull eleven PDFs of
// up to 20MB each through a serverless request. Counting pages needs the bytes.
// ============================================================================

/**
 * The most pages one extraction can carry.
 *
 * The model's own documented ceiling for a PDF in one request, not a number
 * this app chose. Stated rather than discovered, so the sentence a person reads
 * says what to do.
 */
export const MAX_MODEL_PDF_PAGES = 100;

/**
 * How many pages a PDF has, or NULL where this cannot tell.
 *
 * NULL MEANS PROCEED, and that is the whole design of this function. It reads
 * the `/Count` off the document's page tree, which is legible in an
 * uncompressed catalogue and is NOT legible in a PDF whose catalogue sits
 * inside a compressed object stream — which is what most modern exporters
 * write. A reader that guessed at those would refuse real documents on a
 * misparse, and a wrong refusal here means a document nobody can get into the
 * app at all. So an unreadable count is not a refusal; it falls through to the
 * API's own limit, which is where it has always fallen.
 *
 * The MAXIMUM `/Count` across every `/Pages` node is the root's, because a page
 * tree's interior nodes each count their own subtree. Taking the first would
 * read a branch on a linearised file.
 */
export function countPdfPages(bytes: Buffer): number | null {
  // latin1 so every byte maps to one character: the structure is ASCII and the
  // stream payloads in between are never matched.
  const text = bytes.toString("latin1");
  let best: number | null = null;
  for (const object of text.split("endobj")) {
    if (!/\/Type\s*\/Pages\b/.test(object)) continue;
    const count = /\/Count\s+(\d+)/.exec(object);
    if (!count || !count[1]) continue;
    const pages = Number(count[1]);
    if (!Number.isFinite(pages) || pages <= 0) continue;
    if (best === null || pages > best) best = pages;
  }
  return best;
}

export async function prepareDocumentSource(bytes: Buffer, filename: string, contentType: string): Promise<DocumentSource> {
  const kind = intakeSourceKind(filename, contentType);
  if (kind === "pdf") {
    const pages = countPdfPages(bytes);
    // Null falls through on purpose — see `countPdfPages`.
    if (pages !== null && pages > MAX_MODEL_PDF_PAGES) {
      throw new Error(
        `This PDF has ${pages} pages. One read takes at most ${MAX_MODEL_PDF_PAGES}, which is the model's own limit — split it and upload the parts separately.`,
      );
    }
    return { type: "pdf", base64: bytes.toString("base64") };
  }
  if (kind === "eml") {
    const { parseEnvelope, buildEmailModelText } = await import("@/lib/email-envelope");
    return { type: "email", text: buildEmailModelText(await parseEnvelope(bytes)).text };
  }
  if (kind === "xlsx" || kind === "csv" || kind === "tsv") {
    return { type: "spreadsheet", text: spreadsheetSheetsToText(await readSpreadsheetSheets(bytes, filename, contentType)) };
  }
  throw new Error("Unsupported intake file. Upload a PDF, .xlsx, .csv, .tsv or .eml file.");
}
