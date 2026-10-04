// Pure tier. The drawings scorer (tools/drawings-golden.ts) on SYNTHETIC
// goldens and synthetic model outputs: invented codes, invented figures. No
// client document content is in this repo — the real goldens live outside it.
import { describe, expect, it } from "vitest";
import { DrawingsOutput } from "@/lib/extraction-schema";
import {
  parseGolden,
  readFromModelOutput,
  scoreDrawingRead,
  totalScores,
  type GoldenDocument,
} from "../../tools/drawings-golden";

type Dim = { labelRaw?: string | null; valueRaw: string; unitRaw?: string | null; slot?: string | null; isOverall?: boolean; configurations?: string[] };
type Mat = { labelRaw: string; valueRaw: string; materialCodeRaw?: string | null; configurations?: string[] };

function page(code: string | null, pageNo: number, dims: Dim[], mats: Mat[] = [], extra: Record<string, unknown> = {}) {
  return {
    itemCodeRaw: code,
    itemNameRaw: "Chair",
    page: pageNo,
    dimensions: dims.map((d) => ({
      labelRaw: d.labelRaw ?? null,
      valueRaw: d.valueRaw,
      unitRaw: d.unitRaw ?? null,
      slot: d.slot ?? null,
      slotEvidence: d.slot ? "spans the whole item on the front elevation" : null,
      isOverall: d.isOverall ?? Boolean(d.slot),
      configurations: d.configurations ?? [],
    })),
    materials: mats.map((m) => ({
      labelRaw: m.labelRaw,
      valueRaw: m.valueRaw,
      materialCodeRaw: m.materialCodeRaw ?? null,
      configurations: m.configurations ?? [],
    })),
    dimensionsCombinedRaw: [],
    notesRaw: [],
    confidence: "high",
    configurations: [],
    depictsConfigurations: [],
    ...extra,
  };
}

function output(items: unknown[], codeGroups: unknown[] = []) {
  return DrawingsOutput.parse({ items, codeGroups, documentNotes: null });
}

function golden(doc: Partial<GoldenDocument> & { items: GoldenDocument["items"] }): GoldenDocument {
  return parseGolden({ file: "X.pdf", verified: true, nonItemPages: [], ...doc });
}

const CHAIR_MM: Dim[] = [
  { labelRaw: "Width", valueRaw: "840", unitRaw: "mm", slot: "width" },
  { labelRaw: "Depth", valueRaw: "790", unitRaw: "mm", slot: "depth" },
  { labelRaw: "Height", valueRaw: "720", unitRaw: "mm", slot: "height" },
  { labelRaw: "ARM HEIGHT", valueRaw: "610", unitRaw: "mm", isOverall: false },
];

const chairGolden = (pages: number[]) =>
  golden({
    items: [
      {
        codes: ["X-200"],
        pages,
        configurations: [],
        overall: {
          W: { mm: 840 },
          D: { mm: 790 },
          H: { mm: 720 },
          SH: null,
          Dia: null,
        },
        finishCodes: ["FAB-01"],
      },
    ],
  });

describe("an item drawn over two pages", () => {
  it("is one item when the document groups the pages, whatever the second page is titled", () => {
    const read = readFromModelOutput(
      output(
        [
          page("X-200", 1, CHAIR_MM, [{ labelRaw: "FABRIC", valueRaw: "Invented cloth", materialCodeRaw: "FAB-01" }]),
          page("MUR.9 CHAIR", 2, [{ valueRaw: "840", slot: "width" }]),
        ],
        [{ itemCodes: ["X-200", "MUR.9 CHAIR"], pages: [1, 2], relationship: "one_item", evidence: "same chair" }],
      ),
      "X.pdf",
    );
    expect(read.items).toHaveLength(1);
    const score = scoreDrawingRead(chairGolden([1, 2]), read);
    const item = score.items[0]!;
    expect(item.groupingExact).toBe(true);
    expect(item.slots.W.outcome).toBe("correct");
    expect(item.slots.D.outcome).toBe("correct");
    expect(item.slots.H.outcome).toBe("correct");
    expect(item.slots.SH.outcome).toBe("absent_ok");
    expect(item.finishes).toEqual({ golden: 1, found: 1, missing: [] });
    expect(item.cell).toBe("W840 x D790 x H720mm");
    expect(score.extraItems).toEqual([]);
  });

  it("is two items when the document does not group them, and the grouping score says so", () => {
    const read = readFromModelOutput(
      output([page("X-200", 1, CHAIR_MM), page("MUR.9 CHAIR", 2, [{ valueRaw: "840", slot: "width" }])]),
      "X.pdf",
    );
    const score = scoreDrawingRead(chairGolden([1, 2]), read);
    expect(score.items[0]!.groupingExact).toBe(false);
    expect(score.items[0]!.matched).toEqual(["X-200"]);
    expect(score.extraItems).toEqual(["MUR.9 CHAIR"]);
  });

  it("counts the rows a reviewer reads, and folds the arm height away", () => {
    const read = readFromModelOutput(output([page("X-200", 1, CHAIR_MM)]), "X.pdf");
    // W, D and H inline; ARM HEIGHT is not overall and folds.
    expect(read.items[0]!.rowsToReview).toBe(3);
  });
});

describe("a codeless page", () => {
  const read = () =>
    readFromModelOutput(output([page("X-200", 1, CHAIR_MM), page(null, 2, [{ valueRaw: "12" }])]), "X.pdf");

  it("is not an extra item where the golden calls it a non-item page", () => {
    const score = scoreDrawingRead({ ...chairGolden([1]), nonItemPages: [{ page: 2, why: "legend" }] }, read());
    expect(score.items[0]!.groupingExact).toBe(true);
    expect(score.extraItems).toEqual([]);
    expect(score.nonItemPagesWithItems).toEqual([]);
  });

  it("breaks the grouping where the golden says the page belongs to the item", () => {
    const score = scoreDrawingRead(chairGolden([1, 2]), read());
    expect(score.items[0]!.groupingExact).toBe(false);
    expect(score.extraItems).toEqual(["page 2 (no code)"]);
  });
});

describe("configurations", () => {
  it("scores the names the app would make records of, folded", () => {
    const read = readFromModelOutput(
      output([
        page(
          "X-301",
          1,
          [{ labelRaw: "Width", valueRaw: "600", unitRaw: "mm", slot: "width" }],
          [
            { labelRaw: "FABRIC", valueRaw: "Cloth one", materialCodeRaw: "FAB-01", configurations: ["Type 1"] },
            { labelRaw: "FABRIC", valueRaw: "Cloth two", materialCodeRaw: "FAB-02", configurations: ["Type 2"] },
          ],
          {
            configurations: [
              { name: "Type 1", nameRaw: "Type 1", evidence: "as per room type" },
              { name: "Type 2", nameRaw: "Type 2", evidence: "as per room type" },
            ],
          },
        ),
      ]),
      "X.pdf",
    );
    expect(read.items[0]!.configurations).toEqual(["TYPE 1", "TYPE 2"]);
    const score = scoreDrawingRead(
      golden({
        items: [
          {
            codes: ["X-301"],
            pages: [1],
            configurations: ["type 1", "Type 2"],
            overall: { W: { mm: 600 } },
            finishCodes: ["FAB-01", "FAB-02", "FAB-03"],
          },
        ],
      }),
      read,
    );
    expect(score.items[0]!.configurations).toMatchObject({ countExact: true, namesExact: true });
    expect(score.items[0]!.finishes).toEqual({ golden: 3, found: 2, missing: ["FAB-03"] });
  });
});

describe("imperial, and a page code that is the end of the bill code", () => {
  it("converts feet and inches through the app's own conversion and resolves the bill code", () => {
    const read = readFromModelOutput(
      output([
        page("FUR-33", 1, [
          { valueRaw: `5'-7"`, slot: "width" },
          { valueRaw: `2'-6"`, slot: "depth" },
          { valueRaw: `2'-6 1/2"`, slot: "height" },
        ]),
      ]),
      "AM-ID-PL-FUR-33 Desk.pdf",
    );
    const score = scoreDrawingRead(
      golden({
        file: "AM-ID-PL-FUR-33 Desk.pdf",
        items: [
          {
            codes: ["AM-ID-PL-FUR-33"],
            billCode: "PL-FUR-33",
            pages: [1],
            configurations: [],
            // 67in, 30in, 30.5in.
            overall: { W: { mm: 1702 }, D: { mm: 762 }, H: { mm: 775 } },
            finishCodes: [],
          },
        ],
      }),
      read,
    );
    const item = score.items[0]!;
    expect(item.matched).toEqual(["FUR-33"]);
    expect(item.billCodeResolved).toBe(true);
    expect(item.slots.W.outcome).toBe("correct");
    expect(item.slots.D.outcome).toBe("correct");
    // 30.5 x 25.4 = 774.7, rounded to 775 by toMillimetres.
    expect(item.slots.H.outcome).toBe("correct");
  });
});

describe("a figure in the wrong slot", () => {
  it("is wrong, not missing, and a slot the golden leaves empty is extra", () => {
    const read = readFromModelOutput(
      output([
        page("X-200", 1, [
          { valueRaw: "790", unitRaw: "mm", slot: "width" },
          { valueRaw: "840", unitRaw: "mm", slot: "depth" },
          { valueRaw: "720", unitRaw: "mm", slot: "height" },
          { valueRaw: "450", unitRaw: "mm", slot: "seat_height" },
          { valueRaw: "330", slot: "diameter" },
        ]),
      ]),
      "X.pdf",
    );
    const score = scoreDrawingRead(chairGolden([1]), read);
    const slots = score.items[0]!.slots;
    expect(slots.W.outcome).toBe("wrong_slot");
    expect(slots.D.outcome).toBe("wrong_slot");
    expect(slots.H.outcome).toBe("correct");
    expect(slots.SH.outcome).toBe("extra");
    // No unit printed: the page's other overall figures vote mm, as on the
    // card, so it converts -- and the golden has no diameter.
    expect(slots.Dia.outcome).toBe("extra");
    expect(slots.Dia.note).toMatch(/read 330 /);
  });

  it("reports a figure the card could not give a unit as unconverted rather than wrong", () => {
    // Two overall figures on two scales: the unit vote abstains, as on the card.
    const read = readFromModelOutput(
      output([page("X-200", 1, [{ valueRaw: "84", slot: "width" }, { valueRaw: "790", slot: "depth" }])]),
      "X.pdf",
    );
    const slots = scoreDrawingRead(chairGolden([1]), read).items[0]!.slots;
    expect(slots.W.outcome).toBe("unconverted");
    expect(slots.W.note).toMatch(/84 \(no unit\)/);
  });

  it("takes the unit the page's own figures vote for, as the card does", () => {
    const read = readFromModelOutput(output([page("X-200", 1, [{ valueRaw: "84", slot: "width" }])]), "X.pdf");
    expect(scoreDrawingRead(chairGolden([1]), read).items[0]!.slots.W.outcome).toBe("correct");
  });
});

describe("totals", () => {
  it("keeps unverified entries out of the verified score", () => {
    const read = readFromModelOutput(output([page("X-200", 1, CHAIR_MM)]), "X.pdf");
    const verified = scoreDrawingRead(chairGolden([1]), read);
    const draft = scoreDrawingRead({ ...chairGolden([1]), verified: false }, read);
    const totals = totalScores([verified, draft]);
    expect(totals.verified).toMatchObject({ documents: 1, items: 1, groupingExact: 1 });
    expect(totals.verified.slots.correct).toBe(3);
    expect(totals.unverified).toMatchObject({ documents: 1, items: 1 });
  });

  it("refuses a golden with a slot that carries no millimetres", () => {
    expect(() =>
      parseGolden({ file: "X.pdf", verified: false, items: [{ codes: ["X"], pages: [1], overall: { W: { printed: "84" } } }] }),
    ).toThrow(/overall\.W has no numeric "mm"/);
  });
});
