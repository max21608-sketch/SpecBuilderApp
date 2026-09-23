import readExcelFile, { type SheetData } from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import { inflateSync } from "node:zlib";
import { intakeSourceKind } from "@/lib/intake-source-types";
import { MAX_MODEL_PDF_PAGES } from "@/lib/upload-limits";

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
// MEASURED FIRST, as the row asked, and the answer for 120 pages is PROCEEDS.
// Nothing in this app had ever counted pages, and the first version of this
// cap was set at 100 — which would have REFUSED a 120-page document the API
// accepts. 100 is the per-request page limit for a 200k-context model; the
// extraction model is `claude-sonnet-5`, whose window is 1M, and its limit is
// 600. A wrong cap here is the worst outcome available: a document nobody can
// get into the app at all, refused by us with a confident sentence.
//
// What a 120-page PDF actually does: it is registered (the 20MB byte cap does
// not touch it — a 120-page synthetic is 33KB), base64'd whole, and read. It
// does not hang either way; `MODEL_DEADLINE_MS` bounds the call at 240s inside
// a 270s run abort, and an answer too long for one extraction is already
// reported as `truncated` with "Split it into smaller documents".
//
// So the cap is the REAL limit, stated here where the bytes are already in hand
// and BEFORE the call, so a 700-page file gets a sentence naming the number
// instead of the API's bare "The request was refused (400)." — which is what it
// got until now, after an attempt had been spent on a charged request.
//
// IT IS NOT ENFORCED AT REGISTRATION, and that is deliberate.
// `registerSpecDocument` reads only the store's METADATA — `headTrustedBlob` —
// precisely so registering an eleven-document pack does not pull eleven PDFs of
// up to 20MB each through a serverless request. Counting pages needs the bytes.
// ============================================================================

// The most pages one extraction can carry: the model's own ceiling. It lives in
// the leaf `upload-limits.ts` so the upload screen can refuse a document before
// a byte is stored without importing this server module. In practice the 20MB
// cap bites first on any real drawing set of this length; this is the gate for
// a file with a great many small pages.
export { MAX_MODEL_PDF_PAGES };

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

/** Codecs that carry a picture. Known NOT to be text, rather than unreadable. */
const IMAGE_FILTERS = new Set(["/DCTDecode", "/JPXDecode", "/JBIG2Decode", "/CCITTFaxDecode"]);

/**
 * Does this PDF carry a TEXT LAYER, or is it pictures of pages? NULL where this
 * cannot tell.
 *
 * ============================================================================
 * A SCANNED DRAWING SET IS A FOUR-MINUTE READ THAT RETURNS NOTHING.
 *
 * Plan §6.10.b: a PDF with no text layer is a photograph of a document. The
 * model is shown it, spends the whole deadline on it, and comes back with
 * nothing to review — a charged read whose result is an empty screen. Answering
 * before the call costs one pass over the bytes.
 *
 * CERTAIN OR PROCEED, and the naive version is the trap. "No `Tj` anywhere in
 * the raw bytes" calls EVERY modern PDF scanned, because an exporter compresses
 * its content streams and the operators are inside a Flate payload: that test
 * would refuse the whole Panther pack. So each stream is decoded where it can
 * be — `inflateSync` on `FlateDecode`, which is what Node gives us for nothing
 * — and anything else makes the answer NULL. A wrong refusal is a document
 * nobody can get into the app at all, which is the same reasoning
 * `countPdfPages` above is built on.
 *
 * WHY SCANNING EVERY STREAM OBJECT IS SOUND. A content stream is always its own
 * indirect object: the format forbids a stream inside an object stream, so a
 * compressed catalogue can hide the page TREE from `countPdfPages` and cannot
 * hide a page's CONTENTS from this. An image's own stream is known not to be
 * text and is skipped rather than counted as unreadable — that is the whole
 * shape of a scan, and reading it as "cannot tell" would make every scanned
 * document proceed.
 *
 * AT LEAST ONE PAGE HAS TO BE VISIBLE. "No text and no pages" is an empty or
 * unreadable file, and this must not be the thing that tells somebody about it.
 * ============================================================================
 */
export function pdfHasTextLayer(bytes: Buffer): boolean | null {
  // latin1 so every byte maps to one character; the structure is ASCII.
  const text = bytes.toString("latin1");

  // A page tree count, or failing that a page object we can see. Either is
  // evidence of a page; neither is evidence of none.
  const counted = countPdfPages(bytes);
  const pageObjects = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  if ((counted === null || counted <= 0) && pageObjects === 0) return null;

  let unreadable = false;
  let streams = 0;

  // Every `stream` keyword, with the dictionary that precedes it. Read BACKWARD
  // to the object header rather than matching `<< ... >>` forward, because a
  // stream dictionary nests (`/DecodeParms << … >>`) and a non-greedy match
  // would stop at the inner brace and mis-read the filter.
  const keyword = /\bstream\r?\n/g;
  let hit: RegExpExecArray | null;
  while ((hit = keyword.exec(text)) !== null) {
    const objStart = text.lastIndexOf(" obj", hit.index);
    if (objStart < 0) continue;
    const dict = text.slice(objStart, hit.index);
    const end = text.indexOf("endstream", keyword.lastIndex);
    if (end < 0) {
      unreadable = true;
      continue;
    }
    const payload = text.slice(keyword.lastIndex, end);

    // A cross-reference stream and an object stream hold structure, never a
    // content stream, so neither can carry a text operator and neither is
    // evidence of anything missing.
    if (/\/Type\s*\/(XRef|ObjStm)\b/.test(dict)) continue;

    const filters = dict.match(/\/(FlateDecode|DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode|LZWDecode|ASCII85Decode|ASCIIHexDecode|RunLengthDecode|Crypt)\b/g) ?? [];
    // An image. Known NOT to be text, which is the point: a scan is pages of
    // these, and treating them as unreadable would make every scan proceed.
    if (/\/Subtype\s*\/Image\b/.test(dict) || filters.some((f) => IMAGE_FILTERS.has(f))) continue;

    streams += 1;
    let content: string;
    if (filters.length === 0) {
      content = payload;
    } else if (filters.length === 1 && filters[0] === "/FlateDecode") {
      try {
        content = inflateSync(Buffer.from(payload, "latin1")).toString("latin1");
      } catch {
        // An encrypted or truncated payload. Not evidence of no text.
        unreadable = true;
        continue;
      }
    } else {
      // A filter chain, or a codec this does not decode. Say so.
      unreadable = true;
      continue;
    }
    if (showsText(content)) return true;
  }

  // Nothing read at all is not the same as nothing found.
  if (unreadable || streams === 0) return null;
  return false;
}

/**
 * Does this content stream SHOW text? A text object that shows nothing does
 * not count: a `BT`/`ET` pair with no `Tj` sets up a font and draws nothing,
 * which is what an OCR-less scan's content stream can still contain.
 */
function showsText(content: string): boolean {
  const blocks = content.match(/\bBT\b[\s\S]*?\bET\b/g) ?? [];
  return blocks.some((block) => /\bT[jJ]\b|\)\s*['"]/.test(block));
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
