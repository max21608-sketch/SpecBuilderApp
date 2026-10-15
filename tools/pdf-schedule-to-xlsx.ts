// npm run pdf:schedule -- <out.xlsx> <schedule.pdf> [<schedule.pdf> ...]
//
// ============================================================================
// A SCHEDULE THAT ARRIVED AS A PDF PRINTED FROM EXCEL, PUT BACK INTO A SHEET.
// Read only: it writes one workbook, OUTSIDE the repo, and touches nothing else.
//
// Found 2026-10-15 on the Ronnie Scott's tender (LBPCo, P16717), where the bill
// arrived only as "Procurement Schedule" PDFs and was converted by hand with
// this tool. Since workstream C1 the APP reads such a PDF itself at upload,
// through the same reader (`src/lib/pdf-bill.ts`), so this tool is now what it
// is for: printing every line a PDF reads as, to be checked against the PDF
// before or after an upload, and producing a workbook with one sheet per file.
//
// It reads the PDF's own TEXT LAYER by position — no model, no OCR — so every
// cell is a string the PDF printed. Pictures are not carried. Real schedules
// never enter the repo and neither does this tool's output.
// ============================================================================
import path from "node:path";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { pdfBillRefusal, readPdfBill } from "@/lib/pdf-bill";

function usage(): never {
  console.error("usage: npm run pdf:schedule -- <out.xlsx> <schedule.pdf> [...]");
  process.exit(2);
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

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
    const read = await readPdfBill(new Uint8Array(await readFile(input)));
    if (!read.ok) throw new Error(`${file}: ${pdfBillRefusal(read.code)} ${read.detail}`);
    const name = (file.match(/ST4_(.+)\.pdf$/i)?.[1] ?? file.replace(/\.pdf$/i, "")).slice(0, 31);
    const sheet = book.addWorksheet(name);
    sheet.addRow(read.header);
    for (const row of read.rows) {
      sheet.addRow(row.cells.map((cell) => (/^\d+(\.\d+)?$/.test(cell) ? Number(cell) : cell || null)));
    }
    console.log(`\n== ${file} → sheet "${name}": ${read.rows.length} rows over ${read.pageCount} page(s)`);
    console.log(`   columns: ${read.header.join(" | ")}`);
    const at = (label: string) => read.header.findIndex((h) => fold(h) === label);
    const [code, desc, uom, dims] = ["FF&E CODE", "DESCRIPTION", "UOM", "DIMENSIONS CM / MM L X W X H"].map(at);
    for (const row of read.rows) {
      const pick = (i: number) => (i >= 0 ? (row.cells[i] ?? "").replace(/\n/g, " ⏎ ") : "?");
      console.log(
        `   p${row.page} ${pick(code!).padEnd(28)} ${pick(read.quantityColumn).padStart(5)} ${pick(uom!).padEnd(6)} ${pick(desc!).slice(0, 40).padEnd(40)} ${pick(dims!).slice(0, 50)}`,
      );
    }
  }
  await book.xlsx.writeFile(out);
  console.log(`\nwrote ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
