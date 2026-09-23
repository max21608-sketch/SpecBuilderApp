// Pure tier. The fixtures reproduce the SHAPE of the AP364 seating drawings —
// one code drawn on several pages, same geometry, different fabric callouts —
// with invented codes and materials. No client document content is in this
// repo.
import { describe, expect, it } from "vitest";
import {
  cardHasPending,
  compareGeometry,
  configurationCards,
  naturalConfigurationOrder,
  pagesOfCard,
  tabMeasurements,
  sharedTargets,
} from "@/lib/configuration-cards";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { namedSheetRun } from "../fixtures/named-configurations";

let counter = 0;
const observation = (over: Partial<DrawingObservation> = {}): DrawingObservation => {
  counter += 1;
  return {
    id: `obs-${counter}`,
    version: 1,
    attrGroup: "note",
    labelRaw: "FRONT",
    valueRaw: "640",
    materialCodeRaw: null,
    value: "640",
    unit: "mm",
    unitSuggested: true,
    dimensionSlot: null,
    slotSuggested: false,
    specFieldId: null,
    state: "confirmed",
    stateReason: null,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...over,
  };
};

const slot = (label: string, value: string, dimensionSlot: DrawingObservation["dimensionSlot"]) =>
  observation({ labelRaw: label, value, valueRaw: value, attrGroup: "dimension", dimensionSlot, slotSuggested: true });

const item = (over: Partial<DrawingItem> = {}): DrawingItem => ({
  id: "item-1",
  version: 1,
  page: 5,
  itemCodeRaw: "S-201",
  itemNameRaw: "ARMCHAIR",
  confidence: "high",
  targets: null,
  observations: [],
  ...over,
});

/** Two pages of one chair: the same four slots, different fabric. */
const pageOf = (id: string, page: number, fabric: string, code = "S-201") =>
  item({
    id,
    page,
    itemCodeRaw: code,
    observations: [
      slot("FRONT", "640", "W"),
      slot("SIDE", "685", "D"),
      slot("FRONT", "680", "H"),
      observation({ labelRaw: "ARMCHAIR", value: fabric, valueRaw: fabric, attrGroup: "finish", materialCodeRaw: "UPH-07" }),
    ],
  });

const resolved = (ids: string[], letters: (string | null)[]) =>
  new Map(ids.map((id, index) => [id, { variantLabel: letters[index] ?? null, targets: ["rec-main"] }]));

describe("configurationCards", () => {
  it("makes one card per code drawn more than once, and a single card otherwise", () => {
    const items = [
      pageOf("a", 5, "Raffia"),
      pageOf("b", 6, "Linen"),
      item({ id: "c", page: 7, itemCodeRaw: "S-400", itemNameRaw: "FOOTSTOOL" }),
    ];
    const cards = configurationCards(items, resolved(["a", "b", "c"], ["A", "B", null]));
    expect(cards.map((card) => card.kind)).toEqual(["configurations", "single"]);
    const first = cards[0]!;
    if (first.kind !== "configurations") throw new Error("expected a configuration card");
    expect(first.members.map((member) => member.letter)).toEqual(["A", "B"]);
    expect(first.codeRaw).toBe("S-201");
  });

  it("groups on the FOLDED code, the one the letters and the resolver use", () => {
    // `configurationGroup` compared `itemCodeRaw` raw while the letters folded
    // it, so `S-201` and `s 201` were lettered A and B and then printed under
    // two separate headings.
    const cards = configurationCards(
      [pageOf("a", 5, "Raffia", "S-201"), pageOf("b", 6, "Linen", "s 201")],
      resolved(["a", "b"], ["A", "B"]),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe("configurations");
  });

  it("gives a codeless page its own card", () => {
    const cards = configurationCards([item({ id: "a", itemCodeRaw: null })], new Map());
    expect(cards.map((card) => card.kind)).toEqual(["single"]);
  });

  it("orders cards by page and keeps a configuration card at its first page", () => {
    const cards = configurationCards(
      [item({ id: "z", page: 1, itemCodeRaw: "S-100" }), pageOf("a", 5, "Raffia"), pageOf("b", 6, "Linen")],
      resolved(["z", "a", "b"], [null, "A", "B"]),
    );
    expect(cards.map((card) => card.page)).toEqual([1, 5]);
  });

  it("keeps a reviewed page as a member, because letters ignore review state", () => {
    // If dismissing page 5 turned page 6 from B into A, every letter anybody
    // had written down would mean something else.
    const applied = pageOf("a", 5, "Raffia");
    applied.observations = applied.observations.map((o) => ({ ...o, reviewStatus: "applied" as const }));
    const cards = configurationCards([applied, pageOf("b", 6, "Linen")], resolved(["a", "b"], ["A", "B"]));
    const card = cards[0]!;
    if (card.kind !== "configurations") throw new Error("expected a configuration card");
    expect(card.members.map((member) => member.state)).toEqual(["applied", "pending"]);
    expect(card.members.map((member) => member.letter)).toEqual(["A", "B"]);
    expect(cardHasPending(card)).toBe(true);
  });

  it("has nothing pending once every configuration is reviewed", () => {
    const pages = [pageOf("a", 5, "Raffia"), pageOf("b", 6, "Linen")].map((page) => ({
      ...page,
      observations: page.observations.map((o) => ({ ...o, reviewStatus: "ignored" as const })),
    }));
    expect(cardHasPending(configurationCards(pages, resolved(["a", "b"], ["A", "B"]))[0]!)).toBe(false);
  });
});

describe("compareGeometry", () => {
  const members = (...pages: DrawingItem[]) =>
    pages.map((page, index) => ({ item: page, letter: String.fromCharCode(65 + index) }));

  it("matches each page's row to the leader's, so an edit can reach both", () => {
    const result = compareGeometry(members(pageOf("a", 5, "Raffia"), pageOf("b", 6, "Linen")));
    if (result.status !== "shared") throw new Error("expected shared geometry");
    expect(result.rows).toHaveLength(3);
    expect(Object.keys(result.rows[0]!.byMember).sort()).toEqual(["a", "b"]);
    expect(result.rows.every((row) => row.missingOn.length === 0)).toBe(true);
  });

  it("names the letters a measurement is missing on", () => {
    const b = pageOf("b", 6, "Linen");
    b.observations = b.observations.filter((o) => o.dimensionSlot !== "D");
    // B now states only W and H, so the slot signatures differ and this is a
    // disagreement rather than a missing row — which is the honest reading.
    const result = compareGeometry(members(pageOf("a", 5, "Raffia"), b));
    expect(result.status).toBe("disagree");
  });

  it("keeps a row only one page measures as that page's extra", () => {
    const b = pageOf("b", 6, "Linen");
    b.observations = [...b.observations, observation({ labelRaw: "SIDE", value: "50", valueRaw: "50" })];
    const result = compareGeometry(members(pageOf("a", 5, "Raffia"), b));
    if (result.status !== "shared") throw new Error("expected shared geometry");
    expect(result.extras["b"]?.map((row) => row.value)).toEqual(["50"]);
  });

  it("reports a genuine size difference per slot, and never averages it", () => {
    const b = pageOf("b", 6, "Linen");
    b.observations = b.observations.map((o) => (o.dimensionSlot === "H" ? { ...o, value: "720", valueRaw: "720" } : o));
    const result = compareGeometry(members(pageOf("a", 5, "Raffia"), b));
    if (result.status !== "disagree") throw new Error("expected a disagreement");
    expect(result.differences).toEqual([{ slot: "H", byLetter: { A: "680mm", B: "720mm" } }]);
  });

  it("names a page that measures nothing rather than dropping it", () => {
    const b = item({ id: "b", page: 6, observations: [observation({ attrGroup: "finish", value: "Linen", valueRaw: "Linen" })] });
    const result = compareGeometry(members(pageOf("a", 5, "Raffia"), b));
    if (result.status !== "shared") throw new Error("expected shared geometry");
    expect(result.withoutGeometry).toEqual(["B"]);
    expect(result.leaderId).toBe("a");
  });
});

describe("sharedTargets", () => {
  it("ticks a run every configuration applies to, and flags one they disagree on", () => {
    const cards = configurationCards(
      [pageOf("a", 5, "Raffia"), pageOf("b", 6, "Linen")],
      new Map([
        ["a", { variantLabel: "A", targets: ["rec-main", "rec-ve"] }],
        ["b", { variantLabel: "B", targets: ["rec-main"] }],
      ]),
    );
    const card = cards[0]!;
    if (card.kind !== "configurations") throw new Error("expected a configuration card");
    const { ticked, mixed } = sharedTargets(card.members);
    expect([...ticked]).toEqual(["rec-main"]);
    expect([...mixed]).toEqual(["rec-ve"]);
  });
});

/**
 * Every page of one item — what the swatch picker may crop from.
 *
 * The finish chip is printed on whichever page prints it, and on this set that
 * is routinely the SECOND one: a shop drawing, then the finishes sheet.
 */
describe("pagesOfCard", () => {
  const doc = (pages: unknown[]) => ({
    schemaVersion: 2 as const,
    codeGroups: [
      {
        itemCodes: ["S-201"],
        pages: pages as number[],
        relationship: "configurations" as const,
        evidence: null,
      },
    ],
  });

  it("unions the staged pages with the pages the model says carry the code", () => {
    // Page 7 staged nothing a reviewer has to rule on — it is the finishes
    // sheet — and it is exactly the page a swatch has to be cropped from.
    expect(pagesOfCard([pageOf("a", 5, "Raffia"), pageOf("b", 6, "Linen")], doc([5, 6, 7]))).toEqual([5, 6, 7]);
  });

  it("is the item's own page where the run predates code groups", () => {
    expect(pagesOfCard([pageOf("a", 5, "Raffia")])).toEqual([5]);
  });

  it("drops a page a staged group does not state as a whole number", () => {
    // Staged JSON is data from the past: `assertStagedDrawings` casts rather
    // than validates, and a button for page "two" cannot render anything.
    expect(pagesOfCard([pageOf("a", 5, "Raffia")], doc([5, "two", 0, null, 6.5, 8]))).toEqual([5, 8]);
  });

  it("is empty for an item whose page is unknown", () => {
    expect(pagesOfCard([item({ id: "z", page: null, itemCodeRaw: "S-999" })])).toEqual([]);
  });
});

describe("the order configuration tabs are shown in", () => {
  it("counts the way a person does, not the way a page first mentioned them", () => {
    expect(naturalConfigurationOrder(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"])).toEqual([
      "TYPE 1",
      "TYPE 2",
      "TYPE 3",
      "TYPE 4",
      "TYPE 5",
    ]);
    expect(naturalConfigurationOrder(["TYPE 10", "TYPE 2"])).toEqual(["TYPE 2", "TYPE 10"]);
    expect(naturalConfigurationOrder(["C", "A", "B"])).toEqual(["A", "B", "C"]);
    // Numbered first, then letters, then anything else in document order.
    expect(naturalConfigurationOrder(["SUITE", "B", "TYPE 2", "LOBBY", "A", "TYPE 1"])).toEqual([
      "TYPE 1",
      "TYPE 2",
      "A",
      "B",
      "SUITE",
      "LOBBY",
    ]);
  });
});

describe("one row per measurement in a tab", () => {
  const cardOf = (doc: ReturnType<typeof namedSheetRun>) => {
    const card = configurationCards(doc.items, new Map(), doc)[0]!;
    if (card.kind !== "configurations" || !card.named) throw new Error("expected a named card");
    return card.named;
  };
  const tabOf = (doc: ReturnType<typeof namedSheetRun>, label: string) => cardOf(doc).tabs.find((tab) => tab.label === label)!;

  it("folds a later page stating the same figure into the first page's row", () => {
    const doc = namedSheetRun();
    const tab = tabOf(doc, "TYPE 1");
    const measured = tabMeasurements(tab);
    const drawing = doc.items.find((item) => item.page === 2)!;
    const sheet = doc.items.find((item) => item.page === 1)!;
    const dims = (item: DrawingItem) => item.observations.filter((o) => o.dimensionSlot).map((o) => o.id);
    expect([...measured.hidden].sort()).toEqual(dims(drawing).sort());
    for (const id of dims(sheet)) expect(measured.sameOn.get(id)).toEqual([2]);
    expect(measured.disagree.size).toBe(0);
    // A configuration only page 1 reaches has nothing to fold.
    expect(tabMeasurements(tabOf(doc, "TYPE 2")).hidden.size).toBe(0);
  });

  it("keeps both rows, each saying so, where the figures differ", () => {
    const doc = namedSheetRun();
    const drawing = doc.items.find((item) => item.page === 2)!;
    const changed = {
      ...doc,
      items: doc.items.map((item) =>
        item.id !== drawing.id
          ? item
          : { ...item, observations: item.observations.map((o) => (o.dimensionSlot === "H" ? { ...o, value: "800" } : o)) },
      ),
    };
    const measured = tabMeasurements(tabOf(changed, "TYPE 5"));
    expect(measured.hidden.size).toBe(2);
    const messages = [...new Set(measured.disagree.values())];
    expect(messages).toEqual(["Page 1 and page 2 disagree about the height: page 1 says 790mm, page 2 says 800mm. Correct one, or ignore it."]);
    expect(measured.disagree.size).toBe(2);
  });

  it("compares in millimetres, not as text", () => {
    const doc = namedSheetRun();
    const drawing = doc.items.find((item) => item.page === 2)!;
    const inCm = {
      ...doc,
      items: doc.items.map((item) =>
        item.id !== drawing.id
          ? item
          : { ...item, observations: item.observations.map((o) => (o.dimensionSlot === "W" ? { ...o, value: "55", unit: "cm" as const } : o)) },
      ),
    };
    expect(tabMeasurements(tabOf(inCm, "TYPE 1")).hidden.size).toBe(3);
  });
});
