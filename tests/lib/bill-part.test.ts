// Pure tier — a BILL that is part of a file (open intake, 2026-11-20).
//
// THE TRAPS PINNED HERE:
//   * a PDF bill read by its part's pages keeps every row's page in the WHOLE
//     file, and another document in the same PDF printing a table of its own
//     does not refuse the bill as "the columns change" (the design's trap 6);
//   * the workbook a part builds is stored at a pathname naming its pages, so
//     two bills from one PDF never share one (trap 5);
//   * a workbook part stages EVERY sheet — the structure read pairs staged
//     sheets to source sheets by index — and stages the others ignored, with a
//     reason that says why (trap 9); a whole workbook stages as before;
//   * a transcription of a part windows over the part's pages only, tells the
//     model which pages are the document, and is capped on the part's pages.
import { describe, it, expect } from "vitest";
import { readPdfBillPages, pdfBillWorkbookPathname, type PdfTextItem } from "@/lib/pdf-bill";
import { parseBoqSheets, NOT_IN_BILL_PART_REASON } from "@/lib/boq-import";
import {
  MAX_WINDOWS,
  PAGES_PER_WINDOW,
  TranscribeOutput,
  mergeTranscription,
  partTranscriptionRefusal,
  planPartWindows,
  transcribePdfBill,
} from "@/lib/pdf-bill-transcribe";
import { partInstruction, type SourcePart } from "@/lib/source-part";

const at = (x: number, y: number, str: string): PdfTextItem => ({ str, x, y, w: str.length * 4, h: 7 });

/** A bill page: CODE | DESCRIPTION | QTY and one line under it. */
const billPage = (code: string, description: string, qty: string): PdfTextItem[] => [
  at(40, 100, "CODE"),
  at(120, 100, "DESCRIPTION"),
  at(400, 100, "QTY"),
  at(40, 112, code),
  at(120, 112, description),
  at(402, 112, qty),
];

/** Another document's table in the same PDF: a different header, with a quantity. */
const otherTablePage = (): PdfTextItem[] => [
  at(40, 100, "REF"),
  at(120, 100, "FINISH"),
  at(300, 100, "SUPPLIER"),
  at(400, 100, "QTY"),
  at(40, 112, "FAB-01"),
  at(120, 112, "__QA BOUCLE"),
  at(300, 112, "__QA MILL"),
  at(402, 112, "40"),
];

const drawingPage = (): PdfTextItem[] => [at(40, 100, "__QA ELEVATION 1:10")];

describe("a PDF bill read from part of a PDF", () => {
  // Pages 1–2 a drawing, 3–4 the bill, 5 a finishes schedule with its own table.
  const pages = [drawingPage(), drawingPage(), billPage("QA-CH-01", "ARMCHAIR", "9"), billPage("QA-TB-01", "TABLE", "2"), otherTablePage()];
  const part: SourcePart = { kind: "pages", ranges: [{ from: 3, to: 4 }] };

  it("reads only the part's pages, and each row keeps its page in the whole file", () => {
    const read = readPdfBillPages(pages, { part });
    if (!read.ok) throw new Error(read.detail);
    expect(read.rows.map((row) => [row.page, row.cells[0]])).toEqual([
      [3, "QA-CH-01"],
      [4, "QA-TB-01"],
    ]);
    expect(read.pageCount).toBe(5);
  });

  it("is not refused by another document's table on a page outside the part", () => {
    // The same pages read WHOLE are refused, which is the trap.
    expect(readPdfBillPages(pages)).toMatchObject({ ok: false, code: "columns_change" });
    expect(readPdfBillPages(pages, { part }).ok).toBe(true);
  });

  it("says its pages carry no text when only the part's pages are empty", () => {
    const empty = [billPage("QA-CH-01", "ARMCHAIR", "9"), []];
    expect(readPdfBillPages(empty, { part: { kind: "pages", ranges: [{ from: 2, to: 2 }] } })).toMatchObject({ ok: false, code: "no_text" });
  });

  it("names the part's pages in the workbook's pathname, and only then", () => {
    expect(pdfBillWorkbookPathname("projects/p/Pack.pdf")).toBe("projects/p/Pack (read from PDF).xlsx");
    expect(pdfBillWorkbookPathname("projects/p/Pack.pdf", part)).toBe("projects/p/Pack (read from PDF, pages 3-4).xlsx");
    expect(pdfBillWorkbookPathname("projects/p/Pack.pdf", { kind: "pages", ranges: [{ from: 1, to: 2 }, { from: 9, to: 9 }] })).toBe(
      "projects/p/Pack (read from PDF, pages 1-2 and 9).xlsx",
    );
  });
});

describe("a workbook bill of some of its sheets", () => {
  const bill = [
    ["Code", "Description", "Qty"],
    ["QA-CH-01", "Armchair", 9],
  ];
  const finishes = [
    ["Code", "Description", "Qty"],
    ["FAB-01", "Bouclé", 40],
  ];
  const notes = [["__QA a note with no columns"]];

  it("stages every sheet in order, the ones outside the part ignored with the reason", () => {
    const parsed = parseBoqSheets(
      [
        { sheet: "Bill", data: bill },
        { sheet: "Finishes", data: finishes },
      ],
      {},
      { part: { kind: "sheets", sheets: ["Bill"] } },
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.sheets?.map((sheet) => [sheet.sheetName, sheet.ignored, sheet.ignoredReason])).toEqual([
      ["Bill", false, null],
      ["Finishes", true, NOT_IN_BILL_PART_REASON],
    ]);
    // Read in full, so "Include this sheet" brings back real lines.
    expect(parsed.sheets?.[1]?.lines.map((line) => line.code)).toEqual(["FAB-01"]);
  });

  it("does not set aside the part's own sheet because a sheet outside it read", () => {
    const parsed = parseBoqSheets(
      [
        { sheet: "Notes", data: notes },
        { sheet: "Finishes", data: finishes },
      ],
      {},
      { part: { kind: "sheets", sheets: ["Notes"] } },
    );
    const [own, other] = parsed.sheets ?? [];
    // The part's sheet waits for its columns, live; it is not "No bill columns found".
    expect(own).toMatchObject({ sheetName: "Notes", ignored: false, needsColumns: true });
    expect(other).toMatchObject({ ignored: true, ignoredReason: NOT_IN_BILL_PART_REASON });
    expect(parsed.ok).toBe(false);
  });

  it("stages a whole workbook exactly as with no part, and a part of pages changes nothing", () => {
    const sheets = [
      { sheet: "Bill", data: bill },
      { sheet: "Notes", data: notes },
    ];
    const whole = parseBoqSheets(sheets);
    expect(parseBoqSheets(sheets, {}, {})).toEqual(whole);
    expect(parseBoqSheets(sheets, {}, { part: { kind: "pages", ranges: [{ from: 1, to: 2 }] } })).toEqual(whole);
    expect(whole.sheets?.[1]).toMatchObject({ ignored: true, ignoredReason: "No bill columns found on this sheet." });
  });
});

describe("a transcription of part of a PDF", () => {
  const part: SourcePart = { kind: "pages", ranges: [{ from: 3, to: 5 }, { from: 9, to: 9 }] };

  it("windows each range on its own, in the file's pages", () => {
    expect(planPartWindows(part).map((w) => [w.index, w.firstPage, w.lastPage])).toEqual([
      [0, 3, 4],
      [1, 5, 5],
      [2, 9, 9],
    ]);
    expect(planPartWindows({ kind: "sheets", sheets: ["A"] })).toEqual([]);
  });

  it("caps the part's pages, not the file's, and refuses pages past the end", () => {
    const most = MAX_WINDOWS * PAGES_PER_WINDOW;
    expect(partTranscriptionRefusal({ kind: "pages", ranges: [{ from: 101, to: 100 + most }] }, 200)).toBeNull();
    expect(partTranscriptionRefusal({ kind: "pages", ranges: [{ from: 1, to: most + 1 }] }, 200)).toMatch(/at most 24\. Split it/);
    expect(partTranscriptionRefusal(part, 6)).toMatch(/the PDF has 6 pages/);
    // Uncounted pages (0) proceed, as `countPdfPages`' abstention does.
    expect(partTranscriptionRefusal(part, 0)).toBeNull();
    const scattered: SourcePart = { kind: "pages", ranges: Array.from({ length: MAX_WINDOWS + 1 }, (_, i) => ({ from: i * 3 + 1, to: i * 3 + 1 })) };
    expect(partTranscriptionRefusal(scattered, 100)).toMatch(/it would take 13 calls/);
  });

  it("sends the whole PDF, the part's instruction and each window's pages, and keeps the file's pages", async () => {
    const answer = (value: unknown) => ({
      message: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], usage: {}, model: "claude-opus-5-5" },
      requestId: "req_test",
    });
    const sent: string[][] = [];
    const result = await transcribePdfBill({
      base64: "JVBERi0=",
      pageCount: 12,
      part,
      stream: async ({ body }) => {
        const content = (body.messages as { content: { type: string; text?: string; source?: { data: string } }[] }[])[0]!.content;
        expect(content[0]?.source?.data).toBe("JVBERi0=");
        sent.push(content.slice(1).map((block) => block.text ?? ""));
        const window = content[3]?.text ?? "";
        const page = window.includes("pages 3 to 4") ? 3 : window.includes("page 5") ? 5 : 9;
        return answer({
          notABill: false,
          notABillEvidence: "",
          columns: ["CODE", "DESCRIPTION", "QTY"],
          aboveHeader: [{ page: 3, text: "Revision: B" }],
          rows: [{ page, cells: [`QA-${page}`, "Chair", "1"], unclear: [] }],
          totals: [],
          note: "",
        });
      },
    });
    expect(sent).toHaveLength(3);
    for (const blocks of sent) expect(blocks[1]).toBe(partInstruction(part));
    if (!result.ok) throw new Error(result.error);
    expect(result.transcription.rows.map((row) => row.page)).toEqual([3, 5, 9]);
    expect(result.calls.map((call) => call.pages)).toEqual(["3-4", "5-5", "9-9"]);
    // The lines above the table come off the part's first page.
    expect(result.transcription.aboveHeader).toEqual([{ page: 3, text: "Revision: B" }]);
  });

  it("refuses a part over the cap before any call", async () => {
    let called = false;
    const result = await transcribePdfBill({
      base64: "JVBERi0=",
      pageCount: 100,
      part: { kind: "pages", ranges: [{ from: 1, to: 30 }] },
      stream: async () => {
        called = true;
        throw new Error("not reached");
      },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, charged: false });
  });

  it("merges a whole file's windows as before: the lines above the table come off page 1", () => {
    const output = TranscribeOutput.parse({
      notABill: false,
      notABillEvidence: "",
      columns: ["CODE", "QTY"],
      aboveHeader: [
        { page: 1, text: "Revision: A" },
        { page: 3, text: "not above the table" },
      ],
      rows: [],
      totals: [],
      note: "",
    });
    expect(mergeTranscription([{ index: 0, firstPage: 1, lastPage: 2 }], [output]).aboveHeader).toEqual([{ page: 1, text: "Revision: A" }]);
  });
});

describe("the part the bill's own specification read is for", () => {
  const staged = (sheets: { sheetName: string; ignored: boolean }[]) => ({
    schemaVersion: 4,
    filename: "__QA bill.xlsx",
    sourcePreserved: true,
    sheets: sheets.map((sheet) => ({ ...sheet, ignoredReason: null, proposedRunName: sheet.sheetName, headerRow: 1, skippedRows: 0, metadata: { revision: null, date: null, notes: [] }, lines: [] })),
  });

  it("is the bill's sheets, widened by a sheet a person included on the review", async () => {
    const { billSpecsPart } = await import("@/lib/bill-specifications");
    const part = { kind: "sheets", sheets: ["Bill"] };
    expect(billSpecsPart(part, staged([{ sheetName: "Bill", ignored: false }, { sheetName: "Finishes", ignored: true }]))).toEqual(part);
    expect(billSpecsPart(part, staged([{ sheetName: "Bill", ignored: false }, { sheetName: "VE", ignored: false }]))).toEqual({
      kind: "sheets",
      sheets: ["Bill", "VE"],
    });
  });

  it("is the whole workbook for a whole bill and for a bill read from a PDF's pages", async () => {
    const { billSpecsPart } = await import("@/lib/bill-specifications");
    expect(billSpecsPart(null, staged([{ sheetName: "Bill", ignored: false }]))).toBeNull();
    expect(billSpecsPart({ kind: "pages", ranges: [{ from: 2, to: 3 }] }, staged([{ sheetName: "Sheet1", ignored: false }]))).toBeNull();
  });
});
