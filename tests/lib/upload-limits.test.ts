import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_PDF_BYTES,
  MAX_MODEL_PDF_PAGES,
  WARN_PDF_PAGES,
  isPdfUpload,
  pdfUploadVerdict,
} from "@/lib/upload-limits";
import { MAX_MODEL_PDF_PAGES as SERVER_PAGES } from "@/lib/intake-source";

describe("the upload limits", () => {
  it("are one copy of each number", () => {
    expect(MAX_MODEL_PDF_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_MODEL_PDF_PAGES).toBe(600);
    expect(SERVER_PAGES).toBe(MAX_MODEL_PDF_PAGES);
    expect(WARN_PDF_PAGES).toBe(70);
  });

  it("refuses a PDF over the byte cap without needing a page count", () => {
    const verdict = pdfUploadVerdict({ bytes: MAX_MODEL_PDF_BYTES + 1, pages: null });
    expect(verdict).toMatchObject({ kind: "refuse" });
    if (verdict.kind === "refuse") expect(verdict.message).toContain("one read takes at most 20 MB");
  });

  it("refuses over the page cap, with the number", () => {
    expect(pdfUploadVerdict({ bytes: 1000, pages: 734 })).toEqual({
      kind: "refuse",
      message: "This PDF has 734 pages; one read takes at most 600 — split it into smaller documents.",
    });
  });

  it("warns over the provisional threshold and still proceeds", () => {
    expect(pdfUploadVerdict({ bytes: 1000, pages: 72 })).toEqual({
      kind: "warn",
      message: "72 pages — this may be too large to read in one go; if the read fails, split it.",
    });
    expect(pdfUploadVerdict({ bytes: 1000, pages: MAX_MODEL_PDF_PAGES }).kind).toBe("warn");
  });

  it("proceeds at or under the threshold", () => {
    expect(pdfUploadVerdict({ bytes: 1000, pages: 44 })).toEqual({ kind: "proceed" });
    expect(pdfUploadVerdict({ bytes: 1000, pages: WARN_PDF_PAGES })).toEqual({ kind: "proceed" });
  });

  it("PROCEEDS on an unknown count — refusing on one has no way round it", () => {
    expect(pdfUploadVerdict({ bytes: 1000, pages: null })).toEqual({ kind: "proceed" });
    expect(pdfUploadVerdict({ bytes: 1000, pages: Number.NaN })).toEqual({ kind: "proceed" });
    expect(pdfUploadVerdict({ bytes: 1000, pages: 0 })).toEqual({ kind: "proceed" });
  });

  it("counts only a PDF", () => {
    expect(isPdfUpload("Drawings.PDF")).toBe(true);
    expect(isPdfUpload("scan", "application/pdf")).toBe(true);
    expect(isPdfUpload("Bill.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
    expect(isPdfUpload("Email.eml")).toBe(false);
  });
});
