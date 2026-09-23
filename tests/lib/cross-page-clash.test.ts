// One fabric stated twice is not a clash; two fabrics are, and the row asks.
//
// ============================================================================
// Plan any-bill, step 4. `crossPageClaims` decided "the same finish" by the
// client's CODE alone, so S-301's specification sheet (the cloth named, no
// code) and its shop drawing (the same cloth, words reordered, a POSITION code)
// always clashed "in different words" — and the advice, "move one to another
// field", put a second, non-existent fabric into COM 2 for anyone who took it.
//
// Proved here, pure: the fold (case, punctuation and word order — and nothing
// that changes a word); that a folded match is the same finish at the card AND
// at the confirm; that a real clash asks the real question and carries its
// three answers; and what each answer writes.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  alreadyRecorded,
  crossPageClaims,
  drawingItemBlockers,
  finishWordsKey,
  namedConfigurationPlans,
  resolveDrawingTargets,
  sameFinish,
  type DrawingItem,
  type OccupiedSlots,
} from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/spec-document";
import { planClashResolution } from "@/lib/clash-resolution";
import { NAMED_FIELDS, namedSheetRun, SHOP_DRAWING, SPEC_SHEET } from "../fixtures/named-configurations";

// Invented words: the sheet names the cloth one way, the drawing names the
// SAME words in another order, and only the drawing prints a code.
const SHEET_WORDS = "Maker A, Pattern X - Raffia, black/straw";
const DRAWING_WORDS = "Maker A black/straw, raffia, Pattern X";
// The REAL S-301 shape, words invented: the sheet adds "Ref." and "col.", the
// drawing does not. Two words different — so it is asked, not folded, which is
// what the plan's own walk expects ("press Same fabric — keep page 1").
const SHEET_WORDS_LABELLED = "Maker A, Ref. Pattern X - Raffia, col. black/straw";

describe("finishWordsKey", () => {
  it("folds case, punctuation and word order", () => {
    expect(finishWordsKey(SHEET_WORDS)).toBe(finishWordsKey(DRAWING_WORDS));
    expect(finishWordsKey("  OAK, dark-tinted ")).toBe(finishWordsKey("dark tinted oak"));
  });

  it("does not fold the S-301 pair, whose sheet adds 'Ref.' and 'col.'", () => {
    expect(finishWordsKey(SHEET_WORDS_LABELLED)).not.toBe(finishWordsKey(DRAWING_WORDS));
  });

  it("keeps every word, and counts one said twice", () => {
    // The near misses that must still ask: one word more, one different, one
    // repeated. `Ref.` on one page and not the other is exactly this.
    expect(finishWordsKey(`${SHEET_WORDS}, woven`)).not.toBe(finishWordsKey(DRAWING_WORDS));
    expect(finishWordsKey("Maker A, Pattern Y - Raffia, col. black/straw")).not.toBe(finishWordsKey(DRAWING_WORDS));
    expect(finishWordsKey("Maker A, Ref. Ref. Pattern X")).not.toBe(finishWordsKey("Maker A, Ref. Pattern X"));
    // Accents are letters, not punctuation: a different spelling is not folded.
    expect(finishWordsKey("Gorée")).not.toBe(finishWordsKey("Goree"));
  });

  it("is empty where there are no words", () => {
    expect(finishWordsKey("")).toBe("");
    expect(finishWordsKey(" - , ")).toBe("");
    expect(finishWordsKey(null)).toBe("");
  });
});

describe("sameFinish", () => {
  it("is decided by the code where both carry one", () => {
    expect(sameFinish({ code: "QW-01", words: "oak" }, { code: " qw-01", words: "walnut" })).toBe(true);
    expect(sameFinish({ code: "QW-01", words: "oak" }, { code: "QW-02", words: "oak" })).toBe(false);
  });

  it("is decided by the words where only one carries a code, or neither", () => {
    // A code on one side is not evidence either way: on the real pack it is a
    // POSITION, shared by four cloths.
    expect(sameFinish({ code: null, words: SHEET_WORDS }, { code: "QQ-01.1", words: DRAWING_WORDS })).toBe(true);
    expect(sameFinish({ code: null, words: SHEET_WORDS }, { code: null, words: DRAWING_WORDS })).toBe(true);
    expect(sameFinish({ code: null, words: `${SHEET_WORDS}, woven` }, { code: "QQ-01.1", words: DRAWING_WORDS })).toBe(false);
    expect(sameFinish({ code: null, words: "" }, { code: null, words: "" })).toBe(false);
  });
});

function withDrawingFabric(value: string, code: string | null = "QQ-01.1") {
  return namedSheetRun([
    {
      ...SPEC_SHEET,
      materials: SPEC_SHEET.materials.map((material, index) => (index === 0 ? { ...material, valueRaw: SHEET_WORDS } : material)),
    },
    {
      ...SHOP_DRAWING,
      materials: SHOP_DRAWING.materials.map((material, index) =>
        index === 0 ? { ...material, valueRaw: value, materialCodeRaw: code } : material,
      ),
    },
  ]);
}

const byPage = (doc: { items: DrawingItem[] }, page: number) => doc.items.find((item) => item.page === page)!;
const fabricOf = (item: DrawingItem) =>
  item.observations.find((o) => o.specFieldId === "f-com1" && (o.labelRaw === "FABRIC" || o.configurations?.includes("Type 1")))!;

function record(overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id: "bill-main",
    recordNo: 1,
    label: "P00001-001",
    itemDescription: "Desk chair",
    categoryId: null,
    categoryName: null,
    refs: ["Q-301"],
    boqCodes: ["Q-301"],
    runId: "run-main",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    ...overrides,
  } as RecordEntry;
}

describe("one fabric, words reordered", () => {
  const doc = withDrawingFabric(DRAWING_WORDS);
  const claims = crossPageClaims(doc.items, doc, NAMED_FIELDS);
  const sheetFabric = fabricOf(byPage(doc, 1));
  const drawingFabric = fabricOf(byPage(doc, 2));

  it("is the same finish — the later page already recorded, and no question", () => {
    expect(claims.get(sheetFabric.id)).toBeUndefined();
    expect(claims.get(drawingFabric.id)).toMatchObject({ kind: "same_finish", keptId: sheetFabric.id });
    expect(claims.get(drawingFabric.id)?.message).toBe(
      "Page 2 names the same finish in the same words — already recorded from page 1.",
    );
  });

  it("is the same finish at the confirm, over the sheet's row already on the record", () => {
    // What the confirm reads: the occupant the sheet wrote, with no code.
    expect(
      alreadyRecorded(drawingFabric, { value: SHEET_WORDS, unit: null, state: "confirmed", materialCode: null }),
    ).toBe(true);
    // One word different is a different statement, at the confirm too.
    expect(
      alreadyRecorded(drawingFabric, { value: `${SHEET_WORDS}, woven`, unit: null, state: "confirmed", materialCode: null }),
    ).toBe(false);
    // Two different codes are two finishes, whatever the words.
    expect(
      alreadyRecorded(drawingFabric, { value: SHEET_WORDS, unit: null, state: "confirmed", materialCode: "QQ-02" }),
    ).toBe(false);
  });
});

describe("two pages that do not say the same thing", () => {
  const doc = withDrawingFabric(`${DRAWING_WORDS}, woven`);
  const claims = crossPageClaims(doc.items, doc, NAMED_FIELDS);
  const sheet = byPage(doc, 1);
  const drawing = byPage(doc, 2);
  const sheetFabric = fabricOf(sheet);
  const drawingFabric = fabricOf(drawing);

  it("asks the real question, on both rows", () => {
    const a = claims.get(sheetFabric.id);
    const b = claims.get(drawingFabric.id);
    expect(a?.kind).toBe("conflict");
    expect(a?.message).toBe(
      "Page 1 and page 2 both give COM 1 for TYPE 1 · TYPE 5. If they are the same fabric, keep one wording; if they are two fabrics, give page 2 its own field.",
    );
    expect(b?.message).toBe(a?.message);
    // No longer the advice that invented a second fabric.
    expect(a?.message).not.toContain("move one to another field");
  });

  it("carries the three answers: either page kept, or page 2 moved to the next free COM", () => {
    const claim = claims.get(drawingFabric.id);
    if (claim?.kind !== "conflict") throw new Error("expected a conflict");
    expect(claim.clash.fabric).toBe(true);
    expect(claim.clash.fieldName).toBe("COM 1");
    expect(claim.clash.rows).toEqual([
      { observationId: sheetFabric.id, itemId: sheet.id, page: 1 },
      { observationId: drawingFabric.id, itemId: drawing.id, page: 2 },
    ]);
    // COM 1 is the sheet's in TYPE 1 / TYPE 5; COM 2 is the next free.
    expect(claim.clash.move).toMatchObject({ observationId: drawingFabric.id, page: 2, fieldId: "f-com2", fieldName: "COM 2" });
  });

  it("moves to a slot the RECORD also leaves free", () => {
    const plans = namedConfigurationPlans(doc.items, doc);
    const resolution = resolveDrawingTargets("Q-301", [record()]);
    const variants = new Map([["bill-main", new Map([["TYPE 1", "v1"], ["TYPE 5", "v5"]])]]);
    const occupant = (id: string) => ({ attributeId: id, attributeVersion: 1, label: "COM", value: "x", unit: null, sourceFilename: null, sourcePage: 1 });
    const blockerWith = (fields: OccupiedSlots["fields"]) =>
      drawingItemBlockers(
        drawing,
        resolution,
        { fields, dimensions: new Map() },
        { plan: plans.get(drawing.id)!, variants, pairs: [
          { recordId: "bill-main", label: "TYPE 1", pairWith: ["TYPE 1"] },
          { recordId: "bill-main", label: "TYPE 5", pairWith: ["TYPE 5"] },
        ] },
        claims,
      ).find((b) => b.code === "field_conflict");

    const free = blockerWith(new Map());
    expect(free?.code === "field_conflict" && free.clash.move.fieldName).toBe("COM 2");
    // An earlier document already wrote COM 2 on TYPE 5: COM 3 is next.
    const com2Held = blockerWith(new Map([["v5", new Map([["f-com2", occupant("a2")]])]]));
    expect(com2Held?.code === "field_conflict" && com2Held.clash.move.fieldName).toBe("COM 3");
    // Every COM slot held: nothing to move to, and the row says so.
    const allHeld = blockerWith(
      new Map([["v1", new Map([["f-com2", occupant("a2")], ["f-com3", occupant("a3")]])]]),
    );
    expect(allHeld?.code === "field_conflict" && allHeld.clash.move.fieldId).toBeNull();
  });
});

describe("what each answer writes", () => {
  const doc = withDrawingFabric(`${DRAWING_WORDS}, woven`);
  const sheetFabric = fabricOf(byPage(doc, 1));
  const drawingFabric = fabricOf(byPage(doc, 2));
  const none = () => false;

  it("keeping page 1 carries page 2's code, then ignores page 2 'same as page 1'", () => {
    const plan = planClashResolution({ kind: "keep", keepId: sheetFabric.id, dropId: drawingFabric.id }, doc.items, none);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.edits.map((edit) => [edit.observation.id, edit.changes])).toEqual([
      [sheetFabric.id, { materialCode: "QQ-01.1" }],
      [drawingFabric.id, { ignoreBecause: "same as page 1" }],
    ]);
    // Each edit carries the version the screen showed, for the autosave's check.
    expect(plan.edits[0]!.observation.version).toBe(sheetFabric.version);
    expect(plan.swatch).toBeNull();
  });

  it("keeping page 2 carries nothing it already has, and ignores page 1 'same as page 2'", () => {
    const plan = planClashResolution({ kind: "keep", keepId: drawingFabric.id, dropId: sheetFabric.id }, doc.items, none);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.edits.map((edit) => [edit.observation.id, edit.changes])).toEqual([
      [sheetFabric.id, { ignoreBecause: "same as page 2" }],
    ]);
  });

  it("re-keys the ignored row's swatch onto the kept row — and never over one it already has", () => {
    const heldOn = (ids: string[]) => (id: string) => ids.includes(id);
    const carried = planClashResolution(
      { kind: "keep", keepId: sheetFabric.id, dropId: drawingFabric.id },
      doc.items,
      heldOn([drawingFabric.id]),
    );
    expect(carried.ok && carried.swatch).toEqual({ from: drawingFabric.id, to: sheetFabric.id });
    const both = planClashResolution(
      { kind: "keep", keepId: sheetFabric.id, dropId: drawingFabric.id },
      doc.items,
      heldOn([drawingFabric.id, sheetFabric.id]),
    );
    expect(both.ok && both.swatch).toBeNull();
  });

  it("moving page 2 sets its field and nothing else", () => {
    const plan = planClashResolution({ kind: "move", observationId: drawingFabric.id, fieldId: "f-com2" }, doc.items, none);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.edits.map((edit) => [edit.observation.id, edit.changes])).toEqual([[drawingFabric.id, { specFieldId: "f-com2" }]]);
  });

  it("refuses a row that is no longer pending, in words", () => {
    const ignored = {
      ...doc,
      items: doc.items.map((item) => ({
        ...item,
        observations: item.observations.map((o) => (o.id === drawingFabric.id ? { ...o, reviewStatus: "ignored" as const } : o)),
      })),
    };
    const plan = planClashResolution({ kind: "keep", keepId: sheetFabric.id, dropId: drawingFabric.id }, ignored.items, none);
    expect(plan).toEqual({ ok: false, error: "This row has changed since the page loaded. Reload and answer again." });
  });
});
