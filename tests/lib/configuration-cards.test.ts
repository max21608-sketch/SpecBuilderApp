// Pure tier. The fixtures reproduce the SHAPE of the AP364 seating drawings —
// one code drawn on several pages, same geometry, different fabric callouts —
// with invented codes and materials. No client document content is in this
// repo.
import { describe, expect, it } from "vitest";
import { cardHasPending, compareGeometry, configurationCards, sharedTargets } from "@/lib/configuration-cards";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";

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
