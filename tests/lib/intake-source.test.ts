import { describe, expect, it } from "vitest";
import { prepareDocumentSource, spreadsheetSheetsToText } from "@/lib/intake-source";
import { intakeSourceKind } from "@/lib/intake-source-types";

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
