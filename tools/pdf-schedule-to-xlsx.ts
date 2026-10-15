// npm run pdf:schedule -- <out.xlsx> <schedule.pdf> [<schedule.pdf> ...]
//
// ============================================================================
// A SCHEDULE THAT ARRIVED AS A PDF PRINTED FROM EXCEL, PUT BACK INTO A SHEET.
//
// Found 2026-10-15 on the Ronnie Scott's tender (LBPCo, P16717): the line
// items, quantities and COM lines arrive ONLY as "Procurement Schedule" PDFs
// printed from the procurement company's workbook, and the app refuses a bill
// inside a PDF (a bill is read by code, cell by cell). The native workbook is
// the right input and should be asked for; this is the way through until it
// arrives.
//
// It reads the PDF's own TEXT LAYER by position — no model, no OCR — so every
// cell is a string the PDF printed:
//
//   * the COLUMNS are the header row's own labels (found by "FF&E CODE"), and
//     a piece of text belongs to the column whose label centre is nearest;
//   * the ROWS are anchored on the ORDER QTY column — one figure per line,
//     printed centred in its row — and a line of text belongs to the row
//     whose anchor is nearest. A page with no ORDER QTY column is refused.
//
// The picture column is EMPTY in the output: a PDF's pictures are not cells.
// One sheet per input file, named after it. Real schedules never enter the
// repo and neither does this tool's output: write it outside the repo.
// It prints every row it made so the result can be read against the PDF.
// ============================================================================
import path from "node:path";
import ExcelJS from "exceljs";

type Item = { str: string; x: number; y: number; w: number; h: number };

const HEADER_KEY = "FF&E CODE";
const ANCHOR_LABEL = "ORDER QTY";

function usage(): never {
  console.error("usage: npm run pdf:schedule -- <out.xlsx> <schedule.pdf> [...]");
  process.exit(2);
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

async function pageItems(pdfPath: string): Promise<Item[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { readFile } = await import("node:fs/promises");
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: Item[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const str = raw.str;
      if (!str.trim()) continue;
      const h = Math.abs(raw.transform[3]) || raw.height || 5;
      // PDF y grows upwards; flip so a larger y is further DOWN the page.
      items.push({ str, x: raw.transform[4], y: -raw.transform[5], w: raw.width, h });
    }
    pages.push(items);
  }
  return pages;
}

type Column = { label: string; centre: number };

/** The header's columns: every label on the band around "FF&E CODE", stacked lines joined. */
function headerColumns(items: Item[]): { columns: Column[]; bottom: number } | null {
  const key = items.find((i) => fold(i.str) === HEADER_KEY);
  if (!key) return null;
  const band = items.filter((i) => Math.abs(i.y - key.y) <= key.h * 2.6);
  // The super-header "FF&E SPECIFICATION" sits above STATUS, outside the row.
  const labels = band.filter((i) => !/^FF&E$|^SPECIFICATION$/.test(fold(i.str)));
  const groups: { items: Item[]; centre: number }[] = [];
  for (const item of labels.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2))) {
    const centre = item.x + item.w / 2;
    const near = groups.find((g) => Math.abs(g.centre - centre) < 12);
    if (near) {
      near.items.push(item);
      near.centre = near.items.reduce((s, i) => s + i.x + i.w / 2, 0) / near.items.length;
    } else groups.push({ items: [item], centre });
  }
  const columns = groups
    .map((g) => ({
      label: g.items
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      centre: g.centre,
    }))
    .sort((a, b) => a.centre - b.centre);
  const bottom = Math.max(...band.map((i) => i.y));
  return { columns, bottom };
}

function columnOf(columns: Column[], item: Item): number {
  const centre = item.x + item.w / 2;
  let best = 0;
  for (let c = 1; c < columns.length; c++) {
    if (Math.abs(columns[c]!.centre - centre) < Math.abs(columns[best]!.centre - centre)) best = c;
  }
  return best;
}

/** One page's rows as cell strings, in the header's column order. */
function pageRows(items: Item[], pageNo: number, file: string): { header: string[]; rows: string[][] } {
  const head = headerColumns(items);
  if (!head) throw new Error(`${file} page ${pageNo}: no "${HEADER_KEY}" header`);
  const { columns, bottom } = head;
  const anchorCol = columns.findIndex((c) => fold(c.label) === ANCHOR_LABEL);
  if (anchorCol < 0) throw new Error(`${file} page ${pageNo}: no "${ANCHOR_LABEL}" column in ${columns.map((c) => c.label).join(" | ")}`);
  // Body: below the header, above the page footer (the date line at the foot).
  const footer = Math.max(...items.map((i) => i.y));
  const body = items.filter((i) => i.y > bottom + 1 && i.y < footer - 1);
  const anchors = body
    .filter((i) => columnOf(columns, i) === anchorCol && /^\d+(\.\d+)?$/.test(i.str.trim()))
    .map((i) => i.y)
    .sort((a, b) => a - b);
  if (anchors.length === 0) return { header: columns.map((c) => c.label), rows: [] };
  const cells: Item[][][] = anchors.map(() => columns.map(() => [] as Item[]));
  for (const item of body) {
    let row = 0;
    for (let r = 1; r < anchors.length; r++) {
      if (Math.abs(anchors[r]! - item.y) < Math.abs(anchors[row]! - item.y)) row = r;
    }
    cells[row]![columnOf(columns, item)]!.push(item);
  }
  const rows = cells.map((row) =>
    row.map((cell) => {
      // Lines: items within half a line height share a line, read left to right.
      const sorted = [...cell].sort((a, b) => a.y - b.y || a.x - b.x);
      const lines: Item[][] = [];
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
    }),
  );
  return { header: columns.map((c) => c.label), rows };
}

async function main() {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) usage();
  if (path.resolve(out).startsWith(process.cwd())) {
    console.error("Write the workbook OUTSIDE the repo: a real schedule never enters it.");
    process.exit(2);
  }
  const book = new ExcelJS.Workbook();
  for (const input of inputs) {
    const file = path.basename(input);
    const pages = await pageItems(input);
    let header: string[] | null = null;
    const all: string[][] = [];
    pages.forEach((items, index) => {
      const page = pageRows(items, index + 1, file);
      if (header && page.header.join("|") !== header.join("|")) {
        throw new Error(`${file} page ${index + 1}: header differs from page 1`);
      }
      header ??= page.header;
      all.push(...page.rows);
    });
    const name = (file.match(/ST4_(.+)\.pdf$/i)?.[1] ?? file.replace(/\.pdf$/i, "")).slice(0, 31);
    const sheet = book.addWorksheet(name);
    sheet.addRow(header ?? []);
    for (const row of all) sheet.addRow(row.map((cell) => (/^\d+(\.\d+)?$/.test(cell) ? Number(cell) : cell || null)));
    console.log(`\n== ${file} → sheet "${name}": ${all.length} rows`);
    console.log(`   columns: ${(header ?? []).join(" | ")}`);
    const at = (label: string) => (header ?? []).findIndex((h) => fold(h) === label);
    const [code, desc, qty, uom, dims] = ["FF&E CODE", "DESCRIPTION", "ORDER QTY", "UOM", "DIMENSIONS CM / MM L X W X H"].map(at);
    for (const row of all) {
      const pick = (i: number) => (i >= 0 ? (row[i] ?? "").replace(/\n/g, " ⏎ ") : "?");
      console.log(`   ${pick(code!).padEnd(28)} ${pick(qty!).padStart(5)} ${pick(uom!).padEnd(6)} ${pick(desc!).slice(0, 40).padEnd(40)} ${pick(dims!).slice(0, 50)}`);
    }
  }
  await book.xlsx.writeFile(out);
  console.log(`\nwrote ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
