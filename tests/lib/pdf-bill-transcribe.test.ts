// A PDF bill with no text layer, transcribed by the model (workstream C2).
// Pure: the windows, the schema's size, the merge, the sheet it becomes (read
// by the REAL bill reader), the cross-checks, and the call with the model
// faked. Invented codes and figures throughout.
import { describe, expect, it } from "vitest";
import { buildPdf } from "../fixtures/build-pdf.mjs";
import { parseBoqSheets } from "@/lib/boq-import";
import { toOutputSchema } from "@/lib/model-request";
import {
  MAX_WINDOWS,
  PAGES_PER_WINDOW,
  TRANSCRIBE_TOOL,
  TRANSCRIBE_TOOL_NAME,
  TranscribeOutput,
  mergeTranscription,
  planPageWindows,
  transcribePdfBill,
  transcribeWindowInstruction,
  transcriptionToSheet,
  transcriptionWorkbook,
  stageTranscribedBill,
} from "@/lib/pdf-bill-transcribe";
import { printedNumber, transcriptionChecks, type CheckedLine, type PdfTranscription } from "@/lib/pdf-bill-checks";
import { readSpreadsheetSheets } from "@/lib/intake-source";

const HEADINGS = ["FF&E CODE", "DESCRIPTION", "QTY", "UOM"];

function output(partial: Partial<TranscribeOutput>): TranscribeOutput {
  return TranscribeOutput.parse({ notABill: false, notABillEvidence: "", columns: HEADINGS, aboveHeader: [], rows: [], totals: [], note: "", ...partial });
}

const row = (page: number, cells: string[], unclear: string[] = []) => ({ page, cells, unclear });

describe("the page windows", () => {
  it("reads pages in windows of two, the last one short", () => {
    expect(planPageWindows(5).map((w) => [w.firstPage, w.lastPage])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
    expect(PAGES_PER_WINDOW).toBe(2);
  });

  it("has no windows for a PDF whose pages could not be counted", () => {
    expect(planPageWindows(0)).toEqual([]);
    expect(planPageWindows(Number.NaN)).toEqual([]);
  });

  it("tells a part which pages are its own, and a whole read that it is whole", () => {
    expect(transcribeWindowInstruction({ index: 0, firstPage: 1, lastPage: 1 }, 1, 1)).toMatch(/every page .*one page/);
    const part = transcribeWindowInstruction({ index: 1, firstPage: 3, lastPage: 4 }, 3, 5);
    expect(part).toMatch(/pages 3 to 4 of 5/);
    expect(part).toMatch(/report only the rows and totals printed on pages 3 to 4/);
  });
});

describe("the tool fits structured outputs", () => {
  it("has no nullable field and stays well under the field limit", () => {
    const schema = toOutputSchema(TRANSCRIBE_TOOL.input_schema);
    let nullable = 0;
    let fields = 0;
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.type) && record.type.includes("null")) nullable += 1;
      if (Array.isArray(record.anyOf)) nullable += 1;
      if (record.properties && typeof record.properties === "object") {
        for (const sub of Object.values(record.properties as Record<string, unknown>)) {
          fields += 1;
          walk(sub);
        }
      }
      if (record.items) walk(record.items);
    };
    walk(schema);
    expect(nullable).toBe(0);
    // Measured: the compiled grammar refuses somewhere between 43 and 47.
    expect(fields).toBeLessThanOrEqual(25);
    expect(TRANSCRIBE_TOOL.name).toBe(TRANSCRIBE_TOOL_NAME);
  });
});

describe("mergeTranscription", () => {
  const windows = planPageWindows(3);

  it("joins the windows in page order, each row keeping its page", () => {
    const merged = mergeTranscription(windows, [
      output({
        aboveHeader: [{ page: 1, text: "Revision: B" }],
        rows: [row(1, ["ZZ-01", "Chair", "4", "nr"]), row(2, ["ZZ-02", "Table", "2", "nr"])],
      }),
      output({ rows: [row(3, ["ZZ-03", "Sofa", "1", "nr"])] }),
    ]);
    expect(merged.columns).toEqual(HEADINGS);
    expect(merged.aboveHeader).toEqual([{ page: 1, text: "Revision: B" }]);
    expect(merged.rows.map((r) => [r.page, r.cells[0]])).toEqual([
      [1, "ZZ-01"],
      [2, "ZZ-02"],
      [3, "ZZ-03"],
    ]);
    expect(merged.notABill).toBeNull();
  });

  it("keeps a row on a page outside its window, on the window's first page, and says so", () => {
    const merged = mergeTranscription(windows, [output({}), output({ rows: [row(1, ["ZZ-09", "Stool", "3", "nr"])] })]);
    expect(merged.rows[0]?.page).toBe(3);
    expect(merged.rows[0]?.unclear.join()).toMatch(/its page \(the model gave 1; read as 3\)/);
  });

  it("never drops a cell in a column nobody named, and flags its row", () => {
    const merged = mergeTranscription([windows[0]!], [output({ rows: [row(1, ["ZZ-01", "Chair", "4", "nr", "extra"])] })]);
    expect(merged.columns).toHaveLength(5);
    expect(merged.rows[0]?.cells[4]).toBe("extra");
    expect(merged.rows[0]?.unclear.join()).toMatch(/no heading/);
  });

  it("pads a short row, and flags it", () => {
    const merged = mergeTranscription([windows[0]!], [output({ rows: [row(1, ["ZZ-01", "Chair"])] })]);
    expect(merged.rows[0]?.cells).toEqual(["ZZ-01", "Chair", "", ""]);
    expect(merged.rows[0]?.unclear.join()).toMatch(/2 given for 4 columns/);
  });

  it("matches a later part's columns by heading where the count differs, adding the new one at the end", () => {
    const merged = mergeTranscription(windows, [
      output({ rows: [row(1, ["ZZ-01", "Chair", "4", "nr"])] }),
      output({ columns: ["FF&E CODE", "DESCRIPTION", "FINISH", "QTY", "UOM"], rows: [row(3, ["ZZ-03", "Sofa", "Oak", "1", "nr"])] }),
    ]);
    expect(merged.columns).toEqual([...HEADINGS, "FINISH"]);
    expect(merged.rows[1]?.cells).toEqual(["ZZ-03", "Sofa", "1", "nr", "Oak"]);
    expect(merged.notes.join()).toMatch(/read columns the first part did not \(FINISH\)/);
  });

  it("drops a row with nothing in it, and a total on a page outside its window", () => {
    const merged = mergeTranscription([windows[0]!], [
      output({ rows: [row(1, ["", " ", "", ""])], totals: [{ page: 4, label: "TOTAL", column: 2, value: "9", scope: "page" }] }),
    ]);
    expect(merged.rows).toEqual([]);
    expect(merged.totals).toEqual([]);
  });

  it("keeps the model's reading that a document is not a bill, and its note", () => {
    const merged = mergeTranscription([windows[0]!], [output({ notABill: true, notABillEvidence: "A cover letter.", note: "Page 1 is cut off." })]);
    expect(merged.notABill).toBe("A cover letter.");
    expect(merged.notes).toEqual(["Page 1 is cut off."]);
  });
});

describe("the sheet a transcription becomes", () => {
  const merged = mergeTranscription(planPageWindows(2), [
    output({
      aboveHeader: [{ page: 1, text: "Revision: 0" }],
      rows: [
        row(1, ["ZZ-01", "Lounge chair", "14", "nr"]),
        row(1, ["ZZ-02", "Side table", "6", "nr"], ["QTY"]),
        row(2, ["ZZ-03", "Sofa", "2", "nr"]),
      ],
      totals: [{ page: 1, label: "Page total", column: 2, value: "20", scope: "page" }],
    }),
  ]);
  const sheet = transcriptionToSheet(merged);

  it("is the lines above the header, the header, then the rows, each row's page beside it", () => {
    expect(sheet.data[0]).toEqual(["Revision: 0"]);
    expect(sheet.headerRow).toBe(2);
    expect(sheet.data[1]).toEqual(HEADINGS);
    expect(sheet.firstRow).toBe(3);
    expect(sheet.pages).toEqual([1, 1, 2]);
    expect(sheet.rowUnclear).toEqual({ "4": ["QTY"] });
  });

  it("survives the round trip through the .xlsx stored beside the PDF", async () => {
    const bytes = await transcriptionWorkbook(sheet, "Sheet1");
    const sheets = await readSpreadsheetSheets(bytes, "bill (transcribed from PDF).xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const parsed = parseBoqSheets(sheets);
    expect(parsed.ok && parsed.sheets[0]!.lines.map((line) => [line.lineNo, line.code, line.qty])).toEqual([
      [3, "ZZ-01", 14],
      [4, "ZZ-02", 6],
      [5, "ZZ-03", 2],
    ]);
    expect(parsed.ok && parsed.sheets[0]!.metadata.revision).toBe("0");
  });

  it("is read by the ordinary bill reader exactly as a workbook is", () => {
    const parsed = parseBoqSheets([{ sheet: "Bill", data: sheet.data }]);
    expect(parsed.ok).toBe(true);
    const lines = parsed.ok ? parsed.sheets[0]!.lines : [];
    expect(lines.map((line) => [line.lineNo, line.code, line.qty])).toEqual([
      [3, "ZZ-01", 14],
      [4, "ZZ-02", 6],
      [5, "ZZ-03", 2],
    ]);
  });
});

describe("stageTranscribedBill", () => {
  it("stages the sheet read back out of the stored workbook, the phase named after the PDF", async () => {
    const transcription = mergeTranscription(planPageWindows(1), [
      output({ rows: [row(1, ["ZZ-01", "Lounge chair", "14", "nr"]), row(1, ["ZZ-02", "Side table", "6", "nr"])] }),
    ]);
    const staged = await stageTranscribedBill({
      transcription,
      sheetName: "Sheet1",
      pdfFilename: "__QA invented schedule.pdf",
      registers: {},
      suggest: (line, index) => ({ ...line, index, categoryId: null, categoryStatus: "none", ignored: false }),
    });
    expect(staged.sheets).toHaveLength(1);
    expect(staged.sheets[0]?.proposedRunName).toBe("__QA invented schedule");
    expect(staged.sheets[0]?.lines.map((line) => [line.lineNo, line.code, line.qty])).toEqual([
      [2, "ZZ-01", 14],
      [3, "ZZ-02", 6],
    ]);
    expect(staged.sheet.firstRow).toBe(2);
    expect(staged.workbook.length).toBeGreaterThan(0);
  });
});

describe("transcriptionChecks", () => {
  const pages: Record<number, number> = { 3: 1, 4: 1, 5: 2 };
  const pageOf = (lineNo: number) => pages[lineNo] ?? null;
  const transcription = (overrides: Partial<PdfTranscription> = {}) => ({ totals: [], pageText: [null, null], rowUnclear: {}, ...overrides });
  const lines: CheckedLine[] = [
    { lineNo: 3, code: "ZZ-01", qty: 14 },
    { lineNo: 4, code: "ZZ-02", qty: 6 },
    { lineNo: 5, code: "ZZ-03", qty: 2 },
  ];
  const check = (overrides: Partial<PdfTranscription>, qtyColumn: number | null = 2, withLines: CheckedLine[] = lines) =>
    transcriptionChecks({ lines: withLines, qtyColumn, pageOf, transcription: transcription(overrides) });

  it("passes a page total that equals its lines", () => {
    const result = check({ totals: [{ page: 1, label: "Page total", column: 2, valueRaw: "20", scope: "page" }] });
    expect(result.byLine.size).toBe(0);
    expect(result.summary.join()).toMatch(/equals the quantities transcribed under it/);
  });

  it("flags every line a mis-added total covers, and no other", () => {
    const result = check({ totals: [{ page: 1, label: "Page total", column: 2, valueRaw: "21", scope: "page" }] });
    expect([...result.byLine.keys()]).toEqual([3, 4]);
    expect(result.byLine.get(3)?.[0]).toMatchObject({ code: "total_mismatch", words: "Quantities on p.1 add to 20, not 21" });
    expect(result.byLine.get(3)?.[0]?.why).toMatch(/check each against page 1/);
  });

  it("adds a document total over every line, and leaves out section and subtotal rows", () => {
    const result = check(
      { totals: [{ page: 2, label: "TOTAL", column: 2, valueRaw: "1,022", scope: "document" }] },
      2,
      [...lines, { lineNo: 6, code: null, qty: 22, rowKind: "subtotal" }],
    );
    expect(result.byLine.get(5)?.[0]?.words).toBe("Quantities on the bill add to 22, not 1,022");
    expect(result.byLine.has(6)).toBe(false);
  });

  it("adds a section total from the last section heading", () => {
    const result = check(
      { totals: [{ page: 2, label: "Sub-total", column: 2, valueRaw: "8", scope: "section" }] },
      2,
      [{ lineNo: 3, code: "ZZ-01", qty: 14 }, { lineNo: 4, code: null, qty: null, rowKind: "section" }, { lineNo: 5, code: "ZZ-02", qty: 6 }],
    );
    expect([...result.byLine.keys()]).toEqual([5]);
  });

  it("checks only the quantity column's totals, and says so when the quantity is not mapped", () => {
    const priceTotal = { totals: [{ page: 1, label: "TOTAL", column: 3, valueRaw: "999", scope: "page" as const }] };
    expect(check(priceTotal).byLine.size).toBe(0);
    expect(check(priceTotal, null).summary.join()).toMatch(/quantity column is not set/);
  });

  it("checks a code against its page's text, only where that text covers the table", () => {
    const result = check({ pageText: ["FF&E CODE DESCRIPTION zz-01 Lounge chair 14 ZZ-O2 Side table 6", "Title block only"] });
    // ZZ-02 was transcribed; the page's text says ZZ-O2.
    expect([...result.byLine.keys()]).toEqual([4]);
    expect(result.byLine.get(4)?.[0]).toMatchObject({ code: "code_not_in_text", words: "Code ZZ-02 is not in p.1's text" });
    expect(result.summary.join()).toMatch(/page 2 holds none of the transcribed codes/);
  });

  it("says a scanned PDF's codes could not be checked, and flags nothing for it", () => {
    const result = check({});
    expect(result.byLine.size).toBe(0);
    expect(result.summary.join()).toMatch(/No page of this PDF carries text a program can read/);
  });

  it("flags every line the model could not read with certainty", () => {
    const result = check({ rowUnclear: { "4": ["QTY"] } });
    expect(result.byLine.get(4)?.[0]).toMatchObject({ code: "unclear", words: "Unclear: QTY" });
    expect(result.byLine.get(4)?.[0]?.why).toMatch(/check it against page 1/);
  });
});

describe("printedNumber", () => {
  it.each([
    ["1,240", 1240],
    ["12 nr", 12],
    ["7.5", 7.5],
    ["", null],
    ["TBC", null],
    ["12 / 14", null],
  ])("%j → %j", (raw, expected) => expect(printedNumber(raw)).toBe(expected));
});

describe("transcribePdfBill, the model faked", () => {
  const pdf = buildPdf([{ image: true }, { image: true }, { image: true }]).toString("base64");
  const answer = (value: unknown) => ({
    message: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-opus-5-5" },
    requestId: "req_test",
  });

  it("sends the whole PDF to each window with its pages, and merges the answers", async () => {
    const seen: string[] = [];
    const result = await transcribePdfBill({
      base64: pdf,
      pageCount: 3,
      stream: async ({ body }) => {
        const content = (body.messages as { content: { type: string; text?: string; source?: { data: string } }[] }[])[0]!.content;
        expect(content[0]?.source?.data).toBe(pdf);
        const instruction = content[2]?.text ?? "";
        seen.push(instruction);
        return instruction.includes("pages 1 to 2")
          ? answer({ notABill: false, notABillEvidence: "", columns: HEADINGS, aboveHeader: [], rows: [row(1, ["ZZ-01", "Chair", "4", "nr"])], totals: [], note: "" })
          : answer({ notABill: false, notABillEvidence: "", columns: HEADINGS, aboveHeader: [], rows: [row(3, ["ZZ-03", "Sofa", "1", "nr"])], totals: [], note: "" });
      },
    });
    expect(seen).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcription.rows.map((r) => r.cells[0])).toEqual(["ZZ-01", "ZZ-03"]);
    expect(result.calls.map((call) => [call.pages, call.ok, call.requestId])).toEqual([
      ["1-2", true, "req_test"],
      ["3-3", true, "req_test"],
    ]);
  });

  it("fails the whole read when one window fails, saying which part and that it was charged", async () => {
    const result = await transcribePdfBill({
      base64: pdf,
      pageCount: 3,
      stream: async ({ body }) => {
        const content = (body.messages as { content: { text?: string }[] }[])[0]!.content;
        if ((content[2]?.text ?? "").includes("page 3 of 3")) {
          return { message: { stop_reason: "max_tokens", content: [], usage: {} }, requestId: "req_cut" };
        }
        return answer({ notABill: false, notABillEvidence: "", columns: HEADINGS, aboveHeader: [], rows: [], totals: [], note: "" });
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^Part 2 of 2: The transcription of page 3 was cut off/);
    expect(result.charged).toBe(true);
  });

  it("refuses a PDF longer than the windows allow before any call", async () => {
    let called = false;
    const result = await transcribePdfBill({
      base64: pdf,
      pageCount: MAX_WINDOWS * PAGES_PER_WINDOW + 1,
      stream: async () => {
        called = true;
        throw new Error("not reached");
      },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, charged: false });
    expect(result.ok ? "" : result.error).toMatch(/at most 24\. Split it/);
  });
});

describe("the claim on a transcription", () => {
  it("outlives the model's deadline by a minute, and no more", async () => {
    const { MODEL_DEADLINE_MS } = await import("@/lib/extraction-claim");
    const { TRANSCRIPTION_CLAIM_MS, transcriptionPending } = await import("@/lib/pdf-bill-checks");
    expect(TRANSCRIPTION_CLAIM_MS).toBe(MODEL_DEADLINE_MS + 60_000);
    const now = Date.parse("2026-10-15T20:00:00Z");
    expect(transcriptionPending({ pending: { requestId: "r", at: "2026-10-15T19:59:00Z" } }, now)).toBe(true);
    expect(transcriptionPending({ pending: { requestId: "r", at: "2026-10-15T19:40:00Z" } }, now)).toBe(false);
    expect(transcriptionPending({ pending: null }, now)).toBe(false);
  });
});
