// Pure tier. A read of part of a file keeps only what its part said, and says
// what it left out (open intake; the design's trap 2). The raw outputs are
// built through the REAL schemas, so the filter sees exactly the shapes a
// paid read produces. Every code, page and name is invented.
import { describe, expect, it } from "vitest";
import {
  DrawingsItemsOutput,
  DrawingsOutput,
  ExtractionOutput,
  FinishesScheduleOutput,
  PreambleOutput,
  type ExtractionPayload,
} from "@/lib/extraction-schema";
import { restrictOutputToPart, withLeftOutNote } from "@/lib/part-filter";
import type { SourcePart } from "@/lib/source-part";

const PART: SourcePart = { kind: "pages", ranges: [{ from: 1, to: 11 }, { from: 31, to: 44 }] };

const figure = (valueRaw: string, page: number | null, candidates: { valueRaw: string; page: number | null }[] = []) => ({
  valueRaw,
  page,
  evidence: "labelled",
  candidates,
});

function v4(items: unknown[], nonItemPages: unknown[] = []): ExtractionPayload {
  return {
    outputKind: "drawing_items_v4",
    data: DrawingsItemsOutput.parse({ documentNotes: "A drawing set.", nonItemPages, items }),
  };
}

describe("restrictOutputToPart — a whole file", () => {
  it("passes the SAME object through and says nothing", () => {
    const output = v4([{ codes: ["S-100"], pages: [50] }]);
    const restricted = restrictOutputToPart(output, null);
    expect(restricted.output).toBe(output);
    expect(restricted.leftOut).toBeNull();
  });
});

describe("restrictOutputToPart — drawings, items (v4)", () => {
  it("drops an item whose every page is outside, and names it", () => {
    const output = v4([
      { codes: ["S-100"], pages: [2, 3] },
      { codes: ["S-500"], pages: [12, 13] },
      { codes: [], name: "Side table", pages: [30] },
    ]);
    const { output: kept, leftOut } = restrictOutputToPart(output, PART);
    if (kept.outputKind !== "drawing_items_v4") throw new Error("kind changed");
    expect(kept.data.items.map((item) => item.codes[0] ?? item.name)).toEqual(["S-100"]);
    expect(leftOut).toBe(
      "Left out: 2 items reported from pages 12–13 and 30 (S-500, Side table). None of that is part of this read (pages 1–11 and 31–44).",
    );
  });

  it("keeps an item partly inside, trims its outside pages and rows, and says so on the item", () => {
    const output = v4([
      {
        codes: ["S-200"],
        pages: [2, 20, 34],
        overall: [
          { slot: "width", ...figure("840", 34, [{ valueRaw: "850", page: 20 }]) },
          { slot: "height", ...figure("790", 20) },
          { slot: "depth", ...figure("700", null) },
        ],
        finishes: [
          { part: "SEAT", spec: "Fabric A", code: "FAB-01", page: 34, swatchBox: [0.1, 0.1, 0.2, 0.2], swatchPage: 34 },
          { part: "LEG", spec: "Oak", code: "TIM-01", page: 20 },
          { part: "ARM", spec: "Brass", code: "MTL-01", page: 2, swatchBox: [0.1, 0.1, 0.2, 0.2], swatchPage: 20 },
        ],
        statements: [
          { label: "FR", value: "BS 5852", page: 34 },
          { label: "FR", value: "CAL 117", page: 21 },
        ],
        otherDimensions: [{ label: "ARM HEIGHT", valueRaw: "620", page: 22 }],
        notes: [
          { text: "kept", page: 2 },
          { text: "no page", page: null },
        ],
        pictures: [
          { kind: "3d", page: 2, box: [0, 0, 1, 1] },
          { kind: "front", page: 20, box: [0, 0, 1, 1] },
        ],
        configurations: [{ name: "Type 1", pages: [2, 20] }],
      },
    ]);
    const { output: kept, leftOut } = restrictOutputToPart(output, PART);
    if (kept.outputKind !== "drawing_items_v4") throw new Error("kind changed");
    const item = kept.data.items[0]!;
    expect(item.pages).toEqual([2, 34]);
    expect(item.overall.width).toMatchObject({ valueRaw: "840", candidates: [] });
    expect(item.overall.height).toBeNull();
    // No page is not evidence of another part: kept.
    expect(item.overall.depth).toMatchObject({ valueRaw: "700" });
    expect(item.finishes.map((finish) => finish.code)).toEqual(["FAB-01", "MTL-01"]);
    expect(item.finishes[0]!.swatch).not.toBeNull();
    // Its swatch was cropped off an outside page: the finish stays, the chip goes.
    expect(item.finishes[1]!.swatch).toBeNull();
    expect(item.statements.map((statement) => statement.value)).toEqual(["BS 5852"]);
    expect(item.otherDimensions).toEqual([]);
    expect(item.notes.map((note) => note.text)).toEqual(["kept", "no page"]);
    expect(item.pictures.map((picture) => picture.page)).toEqual([2]);
    expect(item.configurations[0]!.pages).toEqual([2]);
    expect(item.uncertain.at(-1)).toEqual({
      about: "other",
      why: "The read also reported this item on pages 20–22, which are not part of this read (pages 1–11 and 31–44); what they said was left out.",
    });
    // height, the 850 candidate, the oak leg, CAL 117, the arm height and the front view.
    expect(leftOut).toBe(
      "Left out: 6 lines of kept items reported from pages 20–22 (S-200). None of that is part of this read (pages 1–11 and 31–44).",
    );
  });

  it("keeps an item with no pages at all, and an item wholly inside untouched", () => {
    const output = v4([{ codes: ["S-300"], pages: [] }, { codes: ["S-301"], pages: [5] }]);
    const { output: kept, leftOut } = restrictOutputToPart(output, PART);
    if (kept.outputKind !== "drawing_items_v4" || output.outputKind !== "drawing_items_v4") throw new Error("kind changed");
    expect(kept.data.items).toHaveLength(2);
    expect(kept.data.items[1]).toBe(output.data.items[1]);
    expect(leftOut).toBeNull();
  });

  it("drops the pages said to describe no item that are outside, and counts them", () => {
    const output = v4([{ codes: ["S-100"], pages: [2] }], ["3: general notes", "15: preamble"]);
    const { output: kept, leftOut } = restrictOutputToPart(output, PART);
    if (kept.outputKind !== "drawing_items_v4") throw new Error("kind changed");
    expect(kept.data.nonItemPages.map((entry) => entry.page)).toEqual([3]);
    expect(leftOut).toBe("Left out: 1 page said to describe no item reported from page 15. None of that is part of this read (pages 1–11 and 31–44).");
  });
});

describe("restrictOutputToPart — the other kinds", () => {
  it("drops a v3 drawing item on an outside page", () => {
    const output: ExtractionPayload = {
      outputKind: "drawing_items",
      data: DrawingsOutput.parse({
        items: [
          { itemCodeRaw: "S-100", page: 2, dimensions: [], materials: [] },
          { itemCodeRaw: "S-500", page: 12, dimensions: [], materials: [] },
        ],
        codeGroups: [{ itemCodes: ["S-100"], pages: [2, 12], relationship: "one_item" }],
        documentNotes: null,
      }),
    };
    const { output: kept, leftOut } = restrictOutputToPart(output, PART);
    if (kept.outputKind !== "drawing_items") throw new Error("kind changed");
    expect(kept.data.items.map((item) => item.itemCodeRaw)).toEqual(["S-100"]);
    expect(kept.data.codeGroups?.[0]?.pages).toEqual([2]);
    expect(leftOut).toContain("1 item reported from page 12 (S-500)");
  });

  it("drops preamble notes and finish entries from outside pages, keeping the ones with no page", () => {
    const preamble: ExtractionPayload = {
      outputKind: "preamble_notes",
      data: PreambleOutput.parse({
        notes: [
          { topicRaw: "FR", titleRaw: "Flame", bodyRaw: "x", page: 20 },
          { topicRaw: "Tol", titleRaw: null, bodyRaw: "y", page: 5 },
          { topicRaw: null, titleRaw: null, bodyRaw: "z", page: null },
        ],
        documentNotes: null,
      }),
    };
    const restricted = restrictOutputToPart(preamble, PART);
    if (restricted.output.outputKind !== "preamble_notes") throw new Error("kind changed");
    expect(restricted.output.data.notes.map((note) => note.bodyRaw)).toEqual(["y", "z"]);
    expect(restricted.leftOut).toContain("1 note reported from page 20 (Flame)");

    const finishes: ExtractionPayload = {
      outputKind: "finish_entries",
      data: FinishesScheduleOutput.parse({
        entries: [
          { codeRaw: "FAB-01", page: 32 },
          { codeRaw: "FAB-02", page: 29 },
          { codeRaw: "FAB-03", page: 28 },
        ],
        documentNotes: null,
      }),
    };
    const kept = restrictOutputToPart(finishes, PART);
    if (kept.output.outputKind !== "finish_entries") throw new Error("kind changed");
    expect(kept.output.data.entries.map((entry) => entry.codeRaw)).toEqual(["FAB-01"]);
    expect(kept.leftOut).toBe(
      "Left out: 2 finishes reported from pages 28–29 (FAB-02, FAB-03). None of that is part of this read (pages 1–11 and 31–44).",
    );
  });

  it("drops a reading by page for a PDF part, and by sheet for a workbook part", () => {
    const observations = (proposals: unknown[]): ExtractionPayload => ({
      outputKind: "observations",
      data: ExtractionOutput.parse({ proposals, documentNotes: null }),
    });
    const byPage = restrictOutputToPart(
      observations([
        { refRaw: "SX11A", attributeRaw: "W", valueRaw: "900", page: 3 },
        { refRaw: "SX12A", attributeRaw: "W", valueRaw: "800", page: 13 },
      ]),
      PART,
    );
    if (byPage.output.outputKind !== "observations") throw new Error("kind changed");
    expect(byPage.output.data.proposals.map((proposal) => proposal.refRaw)).toEqual(["SX11A"]);
    expect(byPage.leftOut).toContain("1 reading reported from page 13 (SX12A)");

    const bySheet = restrictOutputToPart(
      observations([
        { refRaw: "SX11A", valueRaw: "900", sourceSheet: "Furniture", sourceRow: 4 },
        { refRaw: "SX12A", valueRaw: "800", sourceSheet: "Finishes", sourceRow: 9 },
        { refRaw: "SX13A", valueRaw: "700", sourceSheet: null },
      ]),
      { kind: "sheets", sheets: ["Furniture"] },
    );
    if (bySheet.output.outputKind !== "observations") throw new Error("kind changed");
    expect(bySheet.output.data.proposals.map((proposal) => proposal.refRaw)).toEqual(["SX11A", "SX13A"]);
    expect(bySheet.leftOut).toBe(
      "Left out: 1 reading reported from sheet “Finishes” (SX12A). None of that is part of this read (sheet “Furniture”).",
    );
  });

  it("names at most ten things, and counts the rest", () => {
    const output = v4(Array.from({ length: 12 }, (_, index) => ({ codes: [`X-${index + 1}`], pages: [20] })));
    expect(restrictOutputToPart(output, PART).leftOut).toBe(
      "Left out: 12 items reported from page 20 (X-1, X-2, X-3, X-4, X-5, X-6, X-7, X-8, X-9, X-10 and 2 more). None of that is part of this read (pages 1–11 and 31–44).",
    );
  });
});

describe("withLeftOutNote", () => {
  it("puts the line after the document's own notes, or alone", () => {
    expect(withLeftOutNote("A drawing set.", "Left out: x.")).toBe("A drawing set.\nLeft out: x.");
    expect(withLeftOutNote(null, "Left out: x.")).toBe("Left out: x.");
    expect(withLeftOutNote("A drawing set.", null)).toBe("A drawing set.");
  });
});
