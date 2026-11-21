// Pure tier. The part of a file one read is for (open intake, 2026-11-20):
// its one canonical form, its words on screen, its key, and the refusals a
// registration prints. Every filename and sheet name is invented.
import { describe, expect, it } from "vitest";
import {
  SourcePartSchema,
  documentLabel,
  normalisePart,
  pageInPart,
  partInstruction,
  partKey,
  partLabel,
  partPageCount,
  partPathSuffix,
  partRefusal,
  readStoredPart,
  sheetInPart,
  unionParts,
  type SourcePart,
} from "@/lib/source-part";

const pages = (...ranges: [number, number][]): SourcePart => ({ kind: "pages", ranges: ranges.map(([from, to]) => ({ from, to })) });
const sheets = (...names: string[]): SourcePart => ({ kind: "sheets", sheets: names });

function normal(part: SourcePart): SourcePart {
  const result = normalisePart(part);
  if (!result.ok) throw new Error(result.error);
  return result.part;
}

describe("normalisePart", () => {
  it("sorts ranges and merges the ones that overlap or touch", () => {
    expect(normal(pages([31, 44], [1, 11], [5, 12]))).toEqual(pages([1, 12], [31, 44]));
    expect(normal(pages([4, 6], [1, 3]))).toEqual(pages([1, 6]));
    expect(normal(pages([1, 3], [5, 6]))).toEqual(pages([1, 3], [5, 6]));
    expect(normal(pages([7, 7], [7, 7]))).toEqual(pages([7, 7]));
  });

  it("de-duplicates sheets by EXACT name and keeps the order given", () => {
    expect(normal(sheets("VE", "BOQ", "VE"))).toEqual(sheets("VE", "BOQ"));
    // Two sheets a workbook can really hold, never folded into one.
    expect(normal(sheets("BOQ", "BOQ "))).toEqual(sheets("BOQ", "BOQ "));
  });

  it("refuses an empty part, an inverted range, a page below 1 and a blank sheet, in words", () => {
    const refusal = (part: SourcePart) => {
      const result = normalisePart(part);
      return result.ok ? null : result.error;
    };
    expect(refusal(pages())).toBe("A part of a PDF must name at least one page.");
    expect(refusal(pages([9, 3]))).toBe("Pages 9 to 3 run backwards. Give the first page first.");
    expect(refusal(pages([0, 3]))).toBe("Pages are counted from 1, the first page of the file.");
    expect(refusal(pages([-2, 3]))).toBe("Pages are counted from 1, the first page of the file.");
    expect(refusal(sheets())).toBe("A part of a workbook must name at least one sheet.");
    expect(refusal(sheets("  "))).toBe("A sheet in a part must be named.");
  });

  it("does not change the part it was given", () => {
    const given = pages([31, 44], [1, 11]);
    normal(given);
    expect(given).toEqual(pages([31, 44], [1, 11]));
  });
});

describe("in, count", () => {
  const part = pages([1, 11], [31, 44]);

  it("reads pages in the FILE's numbering, ends included", () => {
    expect(pageInPart(part, 1)).toBe(true);
    expect(pageInPart(part, 11)).toBe(true);
    expect(pageInPart(part, 12)).toBe(false);
    expect(pageInPart(part, 31)).toBe(true);
    expect(pageInPart(part, 45)).toBe(false);
  });

  it("answers yes for the other kind's question", () => {
    expect(pageInPart(sheets("BOQ"), 99)).toBe(true);
    expect(sheetInPart(part, "anything")).toBe(true);
    expect(sheetInPart(sheets("BOQ"), "BOQ")).toBe(true);
    expect(sheetInPart(sheets("BOQ"), "boq")).toBe(false);
  });

  it("counts a part's pages", () => {
    expect(partPageCount(part)).toBe(25);
    expect(partPageCount(pages([7, 7]))).toBe(1);
    expect(partPageCount(sheets("BOQ"))).toBeNull();
  });
});

describe("words", () => {
  it("labels a part as the screens print it", () => {
    expect(partLabel(pages([1, 11], [31, 44]))).toBe("pages 1–11 and 31–44");
    expect(partLabel(pages([7, 7]))).toBe("page 7");
    expect(partLabel(pages([3, 3], [7, 7]))).toBe("pages 3 and 7");
    expect(partLabel(pages([1, 2], [5, 5], [8, 9]))).toBe("pages 1–2, 5 and 8–9");
    expect(partLabel(sheets("Finishes"))).toBe("sheet “Finishes”");
    expect(partLabel(sheets("BOQ", "VE"))).toBe("sheets “BOQ” and “VE”");
    expect(partLabel(sheets("A", "B", "C"))).toBe("sheets “A”, “B” and “C”");
  });

  it("names a document by its file and, where it is part of one, the part", () => {
    expect(documentLabel("Pack.pdf", pages([1, 11], [31, 44]))).toBe("Pack.pdf — pages 1–11 and 31–44");
    expect(documentLabel("Schedules.xlsx", sheets("Finishes"))).toBe("Schedules.xlsx — sheet “Finishes”");
    expect(documentLabel("Pack.pdf", null)).toBe("Pack.pdf");
    expect(documentLabel("Pack.pdf", undefined)).toBe("Pack.pdf");
  });

  it("makes a filename-safe suffix with a hyphen and no unsafe character", () => {
    expect(partPathSuffix(pages([1, 12]))).toBe("pages 1-12");
    expect(partPathSuffix(pages([1, 11], [31, 44]))).toBe("pages 1-11 and 31-44");
    expect(partPathSuffix(pages([7, 7]))).toBe("page 7");
    expect(partPathSuffix(sheets("BOQ", "VE"))).toBe("sheets BOQ and VE");
    expect(partPathSuffix(sheets('A/B: "x"?'))).toBe("sheet A_B_ _x__");
  });
});

describe("partKey", () => {
  it("is one string per part, whatever order the sheets came in", () => {
    expect(partKey(pages([1, 11], [31, 44]))).toBe("pages:1-11,31-44");
    expect(partKey(sheets("VE", "BOQ"))).toBe(partKey(sheets("BOQ", "VE")));
    expect(partKey(sheets("BOQ"))).not.toBe(partKey(sheets("BOQ ")));
    expect(partKey(pages([1, 2]))).not.toBe(partKey(pages([1, 3])));
  });
});

describe("unionParts", () => {
  it("merges two parts of one kind into the canonical form", () => {
    expect(unionParts(pages([31, 44]), pages([1, 11], [12, 12]))).toEqual(pages([1, 12], [31, 44]));
    expect(unionParts(sheets("BOQ"), sheets("VE", "BOQ"))).toEqual(sheets("BOQ", "VE"));
  });

  it("refuses to make one read of pages and sheets", () => {
    expect(() => unionParts(pages([1, 2]), sheets("BOQ"))).toThrow("cannot be one read");
  });
});

describe("partInstruction", () => {
  it("is null for a whole file and for a part of a workbook", () => {
    expect(partInstruction(null)).toBeNull();
    expect(partInstruction(undefined)).toBeNull();
    expect(partInstruction(sheets("Finishes"))).toBeNull();
  });

  it("names the part's pages, counted in the file, and nothing else", () => {
    const sentence = partInstruction(pages([1, 11], [31, 44]))!;
    expect(sentence).toContain("THE DOCUMENT is pages 1–11 and 31–44 of the file");
    expect(sentence).toContain("counting the first page of the file as page 1");
    expect(sentence).toContain("not by any sheet or page numbers printed on the pages");
    expect(sentence).toContain("report nothing from them");
    expect(sentence).toContain("as its number in the whole file");
    expect(partInstruction(pages([7, 7]))).toContain("THE DOCUMENT is page 7 of the file");
  });
});

describe("SourcePartSchema", () => {
  it("takes the two shapes, strictly", () => {
    expect(SourcePartSchema.safeParse({ kind: "pages", ranges: [{ from: 1, to: 2 }] }).success).toBe(true);
    expect(SourcePartSchema.safeParse({ kind: "sheets", sheets: ["BOQ"] }).success).toBe(true);
    expect(SourcePartSchema.safeParse({ kind: "pages", ranges: [{ from: 1, to: 2 }], extra: 1 }).success).toBe(false);
    expect(SourcePartSchema.safeParse({ kind: "pages", ranges: [{ from: 1, to: 2, page: 3 }] }).success).toBe(false);
    expect(SourcePartSchema.safeParse({ kind: "rows", rows: [] }).success).toBe(false);
  });

  it("refuses with sentences a person can act on", () => {
    const first = (value: unknown) => {
      const parsed = SourcePartSchema.safeParse(value);
      return parsed.success ? null : parsed.error.issues[0]?.message;
    };
    expect(first({ kind: "rows" })).toBe("A part is either some pages of a PDF or some sheets of a workbook.");
    expect(first({ kind: "pages", ranges: [{ from: 1.5, to: 2 }] })).toBe("A page range must give its first page as a whole number.");
    expect(first({ kind: "pages", ranges: [{ from: 1, to: "2" }] })).toBe("A page range must give its last page as a whole number.");
    // Fix 8c (2026-11-21): every other page of a 600-page PDF is the most a
    // union of parts can name, so the upload can never be refused for it.
    const alternate = (count: number) => Array.from({ length: count }, (_, index) => ({ from: 2 * index + 1, to: 2 * index + 1 }));
    expect(first({ kind: "pages", ranges: alternate(300) })).toBeNull();
    expect(first({ kind: "pages", ranges: alternate(301) })).toBe("A part of a PDF can name at most 300 page ranges.");
    expect(first({ kind: "sheets", sheets: Array.from({ length: 201 }, (_, index) => `S${index}`) })).toBe(
      "A part of a workbook can name at most 200 sheets.",
    );
  });
});

describe("readStoredPart", () => {
  it("reads a stored part, as an object or as JSON text", () => {
    expect(readStoredPart({ kind: "pages", ranges: [{ from: 1, to: 2 }] })).toEqual(pages([1, 2]));
    expect(readStoredPart(JSON.stringify({ kind: "sheets", sheets: ["BOQ"] }))).toEqual(sheets("BOQ"));
  });

  it("reads the whole file as null, and a malformed part as null rather than throwing", () => {
    expect(readStoredPart(null)).toBeNull();
    expect(readStoredPart(undefined)).toBeNull();
    expect(readStoredPart({ kind: "pages", ranges: [] })).toBeNull();
    expect(readStoredPart({ kind: "pages" })).toBeNull();
    expect(readStoredPart("{not json")).toBeNull();
  });
});

describe("partRefusal", () => {
  const pdf = { sourceKind: "pdf", documentKind: "shop_drawings", pageCount: 44 };

  it("lets pages of a PDF and sheets of a workbook through", () => {
    expect(partRefusal(pages([1, 44]), pdf)).toBeNull();
    expect(partRefusal(sheets("BOQ"), { sourceKind: "xlsx", documentKind: "ffe_schedule", pageCount: null })).toBeNull();
  });

  it("refuses a part of an email, pages of a workbook and sheets of anything but .xlsx", () => {
    expect(partRefusal(pages([1, 2]), { ...pdf, documentKind: "email" })).toBe(
      "An email is read whole. A part of one cannot be read on its own.",
    );
    expect(partRefusal(pages([1, 2]), { sourceKind: "xlsx", documentKind: null, pageCount: null })).toBe(
      "Only a PDF is read by its pages. Upload this file without naming pages.",
    );
    expect(partRefusal(sheets("BOQ"), { sourceKind: "csv", documentKind: null, pageCount: null })).toBe(
      "Only an .xlsx workbook is read by its sheets. Upload this file without naming sheets.",
    );
    expect(partRefusal(sheets("BOQ"), pdf)).toBe("Only an .xlsx workbook is read by its sheets. Upload this file without naming sheets.");
  });

  it("refuses pages past the end where they were counted, and proceeds where they were not", () => {
    expect(partRefusal(pages([1, 11], [31, 45]), pdf)).toBe(
      "This PDF has 44 pages, so page 45 is not in it. Check the pages and upload it again.",
    );
    expect(partRefusal(pages([1, 2]), { ...pdf, pageCount: 1 })).toBe(
      "This PDF has 1 page, so page 2 is not in it. Check the pages and upload it again.",
    );
    expect(partRefusal(pages([1, 450]), { ...pdf, pageCount: null })).toBeNull();
  });
});
