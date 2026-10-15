// A bill that arrived as a PDF, put back into its cells by code (C1, 2026-10-15).
//
// ============================================================================
// Every PDF here is SYNTHETIC — built by tests/fixtures/build-pdf.mjs from
// invented codes and words placed at positions, the way a spreadsheet prints
// — and is read through the real pdfjs text layer, so what is proved is what
// registration runs. No real schedule enters this repo; the real Ronnie
// Scott's PDFs were checked on the local stack against the hand-converted
// workbook (`npm run pdf:schedule`, `npm run boq:gap`).
// ============================================================================
import { describe, expect, it } from "vitest";
import { buildPdf } from "../fixtures/build-pdf.mjs";
import {
  PDF_BILL_SHEET,
  pdfBillRefusal,
  pdfBillWorkbook,
  pdfBillWorkbookFilename,
  pdfBillWorkbookPathname,
  pdfPageOfLine,
  readPdfBill,
  readPdfBillPages,
  type PdfTextItem,
} from "@/lib/pdf-bill";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { parseBoqSheets } from "@/lib/boq-import";

type Text = { x: number; y: number; str: string; size?: number };

/** Column x positions on a landscape page, and where a centred figure goes. */
const COL = { code: 40, description: 120, dims: 240, qty: 405, uom: 470, notes: 540 };

/** The header, with ORDER over QTY the way the real schedule stacks it. */
function header(y: number, labels: Partial<Record<keyof typeof COL, string | [string, string]>> = {}): Text[] {
  const all: Record<keyof typeof COL, string | [string, string]> = {
    code: "FF&E CODE",
    description: "DESCRIPTION",
    dims: "DIMENSIONS",
    qty: ["ORDER", "QTY"],
    uom: "UOM",
    notes: "NOTES",
    ...labels,
  };
  return (Object.keys(all) as (keyof typeof COL)[]).flatMap((key) => {
    const label = all[key];
    if (Array.isArray(label)) {
      // Two stacked lines, centred on one another: "ORDER" is wider than "QTY".
      return [
        { x: COL[key], y: y + 4, str: label[0] },
        { x: COL[key] + 5, y: y - 4, str: label[1] },
      ];
    }
    return [{ x: COL[key], y, str: label }];
  });
}

/** One bill line, its quantity centred in the row and its description over two lines. */
function line(y: number, cells: { code: string; description: [string, string?]; dims?: string; qty: string; uom?: string; notes?: string }): Text[] {
  const out: Text[] = [{ x: COL.code, y, str: cells.code }];
  if (cells.description[1]) {
    out.push({ x: COL.description, y: y + 4, str: cells.description[0] }, { x: COL.description, y: y - 4, str: cells.description[1] });
  } else out.push({ x: COL.description, y, str: cells.description[0] });
  if (cells.dims) out.push({ x: COL.dims, y, str: cells.dims });
  out.push({ x: COL.qty + 6, y, str: cells.qty });
  if (cells.uom) out.push({ x: COL.uom, y, str: cells.uom });
  if (cells.notes) out.push({ x: COL.notes, y, str: cells.notes });
  return out;
}

/** A page footer: a date under the quantity column and a page number at the far right. */
const footer = (page: number): Text[] => [
  { x: 380, y: 20, str: "13/10/2026" },
  { x: 800, y: 20, str: String(page) },
];

const landscape = (texts: Text[]) => ({ width: 842, height: 595, texts });

function twoPageSchedule(): Buffer {
  return buildPdf([
    landscape([
      { x: 40, y: 570, str: "__QA PROCUREMENT SCHEDULE", size: 10 },
      ...header(530),
      ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR", "WITH ARMS"], dims: "740 X 740 X 720MM", qty: "9", uom: "EACH" }),
      ...line(450, { code: "QA-FB-01", description: ["ARMCHAIR FABRIC"], qty: "13.5", uom: "METRE", notes: "WIDTH: 140CM" }),
      ...footer(1),
    ]),
    landscape([
      ...header(530),
      ...line(490, { code: "0012", description: ["SIDE TABLE"], qty: "1,200", uom: "EACH" }),
      ...footer(2),
    ]),
  ]);
}

describe("a schedule printed from a spreadsheet", () => {
  it("puts back the header, every line, its cells and its page", async () => {
    const read = await readPdfBill(twoPageSchedule());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.header).toEqual(["FF&E CODE", "DESCRIPTION", "DIMENSIONS", "ORDER QTY", "UOM", "NOTES"]);
    expect(read.header[read.quantityColumn]).toBe("ORDER QTY");
    expect(read.pageCount).toBe(2);
    expect(read.rows.map((row) => row.page)).toEqual([1, 1, 2]);
    expect(read.rows[0]!.cells).toEqual(["QA-CH-01", "ARMCHAIR\nWITH ARMS", "740 X 740 X 720MM", "9", "EACH", ""]);
    expect(read.rows[1]!.cells).toEqual(["QA-FB-01", "ARMCHAIR FABRIC", "", "13.5", "METRE", "WIDTH: 140CM"]);
    expect(read.rows[2]!.cells[0]).toBe("0012");
    expect(read.rows[2]!.cells[3]).toBe("1,200");
  });

  it("leaves out the title above the header and the footer under the table", async () => {
    const read = await readPdfBill(twoPageSchedule());
    if (!read.ok) throw new Error(read.detail);
    const everything = read.rows.flatMap((row) => row.cells).join(" ");
    expect(everything).not.toContain("PROCUREMENT SCHEDULE");
    expect(everything).not.toContain("13/10/2026");
  });

  it("continues the columns onto a page printed with no header of its own", async () => {
    const pdf = buildPdf([
      landscape([...header(530), ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], qty: "2", uom: "EACH" })]),
      landscape([...line(530, { code: "QA-CH-02", description: ["STOOL"], qty: "4", uom: "EACH" })]),
    ]);
    const read = await readPdfBill(pdf);
    if (!read.ok) throw new Error(read.detail);
    expect(read.rows.map((row) => [row.page, row.cells[0], row.cells[3]])).toEqual([
      [1, "QA-CH-01", "2"],
      [2, "QA-CH-02", "4"],
    ]);
  });

  it("skips a cover page before the first header", async () => {
    const pdf = buildPdf([
      landscape([{ x: 40, y: 300, str: "__QA COVER SHEET", size: 20 }]),
      landscape([...header(530), ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], qty: "2", uom: "EACH" })]),
    ]);
    const read = await readPdfBill(pdf);
    if (!read.ok) throw new Error(read.detail);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]!.page).toBe(2);
  });

  it("does not take a QTY in a description for the header", async () => {
    const pdf = buildPdf([
      landscape([
        ...header(530),
        ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR", "QTY 2 PER ROOM"], qty: "8", uom: "EACH" }),
      ]),
    ]);
    const read = await readPdfBill(pdf);
    if (!read.ok) throw new Error(read.detail);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]!.cells[1]).toBe("ARMCHAIR\nQTY 2 PER ROOM");
  });
});

describe("which column the lines hang on", () => {
  it("takes the one heading the registers know where several say QTY", async () => {
    const pdf = buildPdf([
      landscape([
        ...header(530, { dims: "QTY L1", notes: "QTY L2", qty: "TOTAL QTY" }),
        ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], dims: "3", qty: "9", notes: "6" }),
      ]),
    ]);
    const read = await readPdfBill(pdf);
    if (!read.ok) throw new Error(read.detail);
    expect(read.header[read.quantityColumn]).toBe("TOTAL QTY");
  });

  it("refuses several quantity columns none of which it knows", async () => {
    // L1 and L2 are per-level quantities: reading either as THE quantity would
    // order a fraction of the job (`COLUMNS` in boq-import.ts).
    const pdf = buildPdf([
      landscape([
        ...header(530, { dims: "QTY L1", qty: "QTY L2" }),
        ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], dims: "3", qty: "9" }),
      ]),
    ]);
    const read = await readPdfBill(pdf);
    expect(read).toMatchObject({ ok: false, code: "several_quantity_columns" });
  });

  it("never takes a price for a quantity", async () => {
    const pdf = buildPdf([
      landscape([
        ...header(530, { qty: "QTY RATE" }),
        ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], qty: "9" }),
      ]),
    ]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_quantity_column" });
  });
});

describe("a PDF that is not a table it can read", () => {
  it("names a header with nothing under it", async () => {
    const pdf = buildPdf([landscape([...header(530), { x: 40, y: 490, str: "QA-CH-01" }])]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_rows" });
  });

  it("does not read a specification sheet's QUANTITY label over a drawing as a bill", async () => {
    // The real Ronnie Scott's CH-02 sheet, in invented words: a label and its
    // value, then a drawing's figures standing in a column under the label.
    const pdf = buildPdf([
      landscape([
        { x: 40, y: 530, str: "QUANTITY" },
        { x: 100, y: 530, str: ":" },
        { x: 110, y: 530, str: "2" },
        { x: 40, y: 520, str: "DRAWINGS" },
        { x: 110, y: 520, str: "__QA SPECIFICATION SHEET" },
        { x: 52, y: 400, str: "580" },
        { x: 52, y: 300, str: "140" },
        { x: 300, y: 400, str: "SEAT TO BE IN __QA FABRIC" },
      ]),
    ]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_quantity_column" });
  });

  it("does not read a preamble's prose about quantities as a header", async () => {
    // The merged Panther pack, in invented words: a sentence whose words line
    // up over figures further down the page.
    // Two of its words are headings the registers know ("dimensions",
    // "description"), so only the prose rule stands between it and a bill.
    const words = "Any dimensions quantities and description supplied by the Designer".split(" ");
    const pdf = buildPdf([
      landscape([
        ...words.map((str, index) => ({ x: 40 + index * 70, y: 530, str })),
        { x: 40, y: 522, str: "All site dimensions, ceiling heights and quantities to be checked on site by the contractor" },
        { x: 182, y: 490, str: "17" },
        { x: 182, y: 450, str: "18" },
      ]),
    ]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_quantity_column" });
  });

  it("names a drawing, which has no quantity column at all", async () => {
    const pdf = buildPdf([{ label: "__QA ELEVATION 1:10" }]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_quantity_column" });
  });

  it("names a scan, which has no text to read", async () => {
    const pdf = buildPdf([{ image: true }]);
    expect(await readPdfBill(pdf)).toMatchObject({ ok: false, code: "no_text" });
  });

  it("names bytes that are not a PDF, and never throws", async () => {
    expect(await readPdfBill(Buffer.from("__QA not a pdf"))).toMatchObject({ ok: false, code: "unreadable" });
  });

  it("refuses a file whose columns change from page to page", async () => {
    const pdf = buildPdf([
      landscape([...header(530), ...line(490, { code: "QA-CH-01", description: ["ARMCHAIR"], qty: "2" })]),
      landscape([...header(530, { notes: "SUPPLIER" }), ...line(490, { code: "QA-CH-02", description: ["STOOL"], qty: "4" })]),
    ]);
    const read = await readPdfBill(pdf);
    expect(read).toMatchObject({ ok: false, code: "columns_change" });
    if (!read.ok) expect(read.detail).toContain("Page 2");
  });

  it("says each in ONE short sentence that names the way out", () => {
    for (const code of ["unreadable", "no_text", "no_quantity_column", "several_quantity_columns", "no_rows", "columns_change"] as const) {
      const sentence = pdfBillRefusal(code);
      expect(sentence.startsWith("This PDF bill could not be read: ")).toBe(true);
      expect(sentence.endsWith("Upload the spreadsheet instead.")).toBe(true);
      expect(sentence.length).toBeLessThan(110);
    }
  });
});

describe("a dense table, one line a row", () => {
  it("never reads its first line as part of the header", () => {
    // Pure: the text items as pdfjs reports them (y grows DOWN the page).
    const at = (x: number, y: number, str: string): PdfTextItem => ({ str, x, y, w: str.length * 4, h: 7 });
    const page = [
      at(40, 100, "CODE"),
      at(120, 100, "DESCRIPTION"),
      at(400, 100, "QTY"),
      at(40, 109, "QA-01"),
      at(120, 109, "CHAIR"),
      at(402, 109, "3"),
      at(40, 118, "QA-02"),
      at(120, 118, "TABLE"),
      at(402, 118, "1"),
    ];
    const read = readPdfBillPages([page]);
    if (!read.ok) throw new Error(read.detail);
    expect(read.header).toEqual(["CODE", "DESCRIPTION", "QTY"]);
    expect(read.rows.map((row) => row.cells)).toEqual([
      ["QA-01", "CHAIR", "3"],
      ["QA-02", "TABLE", "1"],
    ]);
  });
});

describe("the workbook it builds", () => {
  it("is an ordinary bill to the bill reader, each line knowing its page", async () => {
    const read = await readPdfBill(twoPageSchedule());
    if (!read.ok) throw new Error(read.detail);
    const book = await pdfBillWorkbook(read);
    expect(book.firstRow).toBe(2);
    expect(book.rowPages).toEqual([1, 1, 2]);

    const sheets = await readSpreadsheetSheets(book.bytes, "bill (read from PDF).xlsx", "");
    expect(sheets.map((sheet) => sheet.sheet)).toEqual([PDF_BILL_SHEET]);
    const parsed = parseBoqSheets(sheets);
    // The reference synonyms know FF&E CODE and DESCRIPTION; ORDER QTY is the
    // model's (or a person's) to map, which is the ordinary bill path.
    const lines = parsed.sheets?.[0]?.lines ?? [];
    expect(lines.map((l) => l.code)).toEqual(["QA-CH-01", "QA-FB-01", "0012"]);
    const source = { sheet: PDF_BILL_SHEET, firstRow: book.firstRow, pages: book.rowPages };
    expect(lines.map((l) => pdfPageOfLine(source, PDF_BILL_SHEET, l.lineNo))).toEqual([1, 1, 2]);
    expect(pdfPageOfLine(source, "Another tab", 2)).toBeNull();
  });

  it("writes the quantity as a figure and every other cell as the text it printed", async () => {
    const read = await readPdfBill(twoPageSchedule());
    if (!read.ok) throw new Error(read.detail);
    const book = await pdfBillWorkbook(read);
    const sheets = await readSpreadsheetSheets(book.bytes, "bill.xlsx", "");
    const rows = sheets[0]!.data;
    expect(rows[3]?.[0]).toBe("0012");
    expect(rows[3]?.[3]).toBe(1200);
    expect(rows[2]?.[3]).toBe(13.5);
  });

  it("is stored beside the PDF, named after it", () => {
    expect(pdfBillWorkbookPathname("projects/p1/uploads/Schedule.pdf")).toBe(
      "projects/p1/uploads/Schedule (read from PDF).xlsx",
    );
    expect(pdfBillWorkbookFilename("Schedule.PDF")).toBe("Schedule (read from PDF).xlsx");
  });
});
