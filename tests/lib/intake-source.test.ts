import { describe, expect, it } from "vitest";
import { prepareDocumentSource, readSpreadsheetSheets, spreadsheetSheetsToText } from "@/lib/intake-source";
import { parseBoqSheets } from "@/lib/boq-import";
import {
  SPREADSHEET_EXTENSIONS,
  intakeSourceKind,
  legacySpreadsheetAdvice,
  spreadsheetRefusal,
} from "@/lib/intake-source-types";

describe("intake spreadsheet sources", () => {
  it("recognises supported extensions without trusting a mismatched MIME type", () => {
    expect(intakeSourceKind("doc.xlsx", "application/octet-stream")).toBe("xlsx");
    expect(intakeSourceKind("doc.csv", "text/plain")).toBe("csv");
    expect(intakeSourceKind("doc.xls", "application/vnd.ms-excel")).toBe("unsupported");
    expect(intakeSourceKind("doc.exe", "application/pdf")).toBe("unsupported");
  });

  it("preserves sheet names, row order, blanks and typed values", () => {
    const text = spreadsheetSheetsToText([
      {
        sheet: "Furniture",
        data: [
          ["Code", "Description", "Quantity"],
          ["01-100", "Lounge chair", 2],
          ["01-100A", null, 14.5],
        ],
      },
      { sheet: "Notes", data: [["FR required", true]] },
    ]);

    expect(text).toContain('<sheet name="Furniture">');
    expect(text).toContain('["01-100A",null,14.5]');
    expect(text).toContain('<sheet name="Notes">\n["FR required",true]');
  });

  it("parses quoted CSV rows into the spreadsheet source format", async () => {
    const source = await prepareDocumentSource(
      Buffer.from('Code,Description,Quantity\r\n01-100,"Chair, lounge",2\r\n'),
      "doc.csv",
      "text/csv",
    );

    expect(source.type).toBe("spreadsheet");
    if (source.type === "spreadsheet") {
      expect(source.text).toContain('["01-100","Chair, lounge","2"]');
    }
  });

  it("keeps PDFs as base64 input", async () => {
    const source = await prepareDocumentSource(Buffer.from("%PDF"), "doc.pdf", "application/pdf");
    expect(source).toEqual({ type: "pdf", base64: Buffer.from("%PDF").toString("base64") });
  });
});

// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 5 — AN `.xls` (BIFF) OR A `.csv` BILL.
//
// The row says MEASURE WHICH, and this is the measurement, pinned:
//
//   .csv, .tsv   PROCEED. `readSpreadsheetSheets` parses both and the bill
//                reads out of them with its quantities.
//   .xls .xlsb   REFUSED, every one of them, before anything is parsed or
//   .xlsm .ods   stored — and now with the way out in words, which is the
//   .numbers     half that was missing. "Not a supported file" does not tell
//                anybody that Save As .xlsx takes ten seconds.
//
// No BIFF file is built here. The refusal happens on the EXTENSION, before a
// byte is read, so a fixture whose bytes were real BIFF would be testing
// `read-excel-file` rather than this app.
// ============================================================================
describe("a bill that is not a spreadsheet this app reads", () => {
  it("proceeds on a .csv bill, quantities and all", async () => {
    const csv =
      "Area,FF&E code,Item description,TOTAL Q-ty\n" +
      "Example lounge,ZZ-101,Sofa,14\n" +
      "Example suite,ZZ-102,Armchair,2\n";
    const sheets = await readSpreadsheetSheets(Buffer.from(csv), "bill.csv", "text/csv");
    const parsed = parseBoqSheets(sheets);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sheets[0]?.lines.map((line) => [line.code, line.qty])).toEqual([
      ["ZZ-101", 14],
      ["ZZ-102", 2],
    ]);
  });

  it("refuses every older spreadsheet format, and says how to get out of it", () => {
    for (const filename of ["bill.xls", "bill.xlsb", "bill.xlsm", "bill.ods", "bill.numbers"]) {
      expect(intakeSourceKind(filename, "")).toBe("unsupported");
      const advice = legacySpreadsheetAdvice(filename);
      expect(advice).toContain("Save As .xlsx");
      expect(advice).toContain("export the bill as .csv");
      expect(advice).toContain(filename);
    }
  });

  it("says nothing of the kind about a file that is not a spreadsheet at all", () => {
    // A PDF bill is row 8's answer, not this one, and a `.docx` is not a bill.
    // Advice that fits every wrong file fits none of them.
    expect(legacySpreadsheetAdvice("bill.pdf")).toBeNull();
    expect(legacySpreadsheetAdvice("bill.docx")).toBeNull();
    expect(legacySpreadsheetAdvice("bill.xlsx")).toBeNull();
  });

  it("names what a bill CAN be read from when the file is something else", () => {
    const refusal = spreadsheetRefusal("drawings.pdf", "pdf");
    for (const extension of SPREADSHEET_EXTENSIONS) expect(refusal).toContain(extension);
    expect(refusal).toContain("a .pdf file");
  });

  it("prefers the way out over the list when there is one", () => {
    expect(spreadsheetRefusal("bill.xls", "unsupported")).toBe(legacySpreadsheetAdvice("bill.xls"));
  });
});
