// The decision table behind `db:backfill-answer-provenance` (0050, audit E1).
//
// Which answers written before 0050 were the checklist's copy of the record's
// attributes (relabel `attribute`, recompose), which were a reviewer's own
// answer off a schedule (leave `document`), and which only a person can tell.
// Pure: the planner loads rows and this decides.
import { describe, it, expect } from "vitest";
import {
  decideAnswerProvenance,
  standsOnNothing,
  type ProvenanceAnswer,
  type ProvenanceRun,
} from "@/lib/answer-provenance-backfill";
import { DIMENSIONS_JSON_ID, type PromotableAttribute } from "@/lib/promote-answers";

const COM1 = "11111111-1111-1111-1111-111111111111";
const DIMS = "33333333-3333-3333-3333-333333333333";

const runs = new Map<string, ProvenanceRun>([
  ["bill", { sourceKind: "boq_xlsx", documentKind: null }],
  ["drawing", { sourceKind: "spec_document", documentKind: "shop_drawings" }],
  ["email", { sourceKind: "spec_document", documentKind: "email" }],
  ["schedule", { sourceKind: "spec_document", documentKind: "ffe_schedule" }],
  ["tracker", { sourceKind: "spec_document", documentKind: "finishes_schedule" }],
]);

const fabric = (value: string, sourceRunId: string | null, over: Partial<PromotableAttribute> = {}): PromotableAttribute => ({
  attrGroup: "material",
  dimensionSlot: null,
  specFieldId: COM1,
  value,
  unit: null,
  state: "confirmed",
  sortOrder: 1,
  sourceRunId,
  ...over,
});

const width = (value: string, sourceRunId: string | null): PromotableAttribute => ({
  attrGroup: "dimension",
  dimensionSlot: "W",
  specFieldId: null,
  value,
  unit: "mm",
  state: "confirmed",
  sortOrder: 1,
  sourceRunId,
});

const answer = (over: Partial<ProvenanceAnswer>): ProvenanceAnswer => ({
  id: "a1",
  fieldId: COM1,
  jsonId: 1,
  sourceKind: "document",
  sourceId: "bill",
  value: "Velvet Rose",
  qualifier: null,
  state: "confirmed",
  ...over,
});

const decide = (attributes: PromotableAttribute[], answers: ProvenanceAnswer[]) =>
  decideAnswerProvenance({ attributes, dimensionNote: null, answers, runs });

describe("decideAnswerProvenance", () => {
  it("relabels a bill's answer that still says what its spec says, and changes nothing", () => {
    expect(decide([fabric("Velvet Rose", "bill")], [answer({})])).toEqual([
      { answerId: "a1", outcome: "projection", change: null },
    ]);
  });

  it("gives a FROZEN bill answer its current value back", () => {
    // The spec was corrected after the bill confirm; the answer could not follow.
    const [decision] = decide([fabric("Velvet Moss", "bill")], [answer({ value: "Velvet Rose" })]);
    expect(decision).toEqual({
      answerId: "a1",
      outcome: "projection",
      change: {
        from: { value: "Velvet Rose", qualifier: null, state: "confirmed" },
        to: { value: "Velvet Moss", qualifier: null, state: "confirmed" },
      },
    });
  });

  it("puts a retired bill fabric's answer back to missing: the file was shipping it", () => {
    const [decision] = decide([], [answer({})]);
    expect(decision).toMatchObject({ outcome: "projection", change: { to: { value: null, state: "missing" } } });
  });

  it("treats a drawing's, an email's and a typed spec's `document` answers as projections", () => {
    for (const sourceId of ["drawing", "email", null]) {
      const [decision] = decide([fabric("Velvet Rose", sourceId)], [answer({ sourceId })]);
      expect(decision?.outcome).toBe("projection");
    }
  });

  it("relabels a schedule's answer composed from the schedule's own spec, even where it has since moved", () => {
    // The spec-document confirm recomposed it; the spec was corrected later
    // (a correction keeps its run), and the answer froze.
    const [decision] = decide([fabric("Boucle Oat", "schedule")], [answer({ sourceId: "schedule", value: "Boucle Ivory" })]);
    expect(decision).toMatchObject({ outcome: "projection", change: { to: { value: "Boucle Oat" } } });
  });

  it("leaves a reviewer's own answer off a schedule alone where no spec holds the field", () => {
    expect(decide([], [answer({ sourceId: "schedule", value: "Reviewer cloth" })])).toEqual([
      { answerId: "a1", outcome: "left_document" },
    ]);
  });

  it("decides a schedule's answer over ANOTHER document's spec by its value", () => {
    // Same value: it is what the specs compose, so it is a projection.
    expect(decide([fabric("Velvet Rose", "bill")], [answer({ sourceId: "tracker" })])[0]).toEqual({
      answerId: "a1",
      outcome: "projection",
      change: null,
    });
    // Different: a reviewer's answer a bill spec landed on, or a frozen
    // projection. Nothing here can say which, so a person does.
    expect(decide([fabric("Bill cloth", "bill")], [answer({ sourceId: "tracker", value: "Tracker cloth" })])[0]).toEqual({
      answerId: "a1",
      outcome: "needs_person",
      held: { value: "Tracker cloth", qualifier: null, state: "confirmed" },
      composed: { value: "Bill cloth", qualifier: null, state: "confirmed" },
    });
  });

  it("reads the composed Dimensions cell by its slots, not by a field", () => {
    const dims = answer({ fieldId: DIMS, jsonId: DIMENSIONS_JSON_ID, value: "W840mm", sourceId: "bill" });
    expect(decide([width("880", "bill")], [dims])[0]).toMatchObject({
      outcome: "projection",
      change: { to: { value: "W880mm", state: "confirmed" } },
    });
  });

  it("never decides a person's answer, a missing one, an already-composed one, or a readiness question", () => {
    expect(
      decide(
        [],
        [
          answer({ id: "m", sourceKind: "manual", sourceId: null }),
          answer({ id: "e", sourceKind: "email", sourceId: "email" }),
          answer({ id: "x", sourceKind: "attribute" }),
          answer({ id: "n", state: "missing", value: null }),
        ],
      ),
    ).toEqual([]);
    expect(decide([], [answer({ id: "r", fieldId: null, jsonId: null })])).toEqual([{ answerId: "r", outcome: "left_document" }]);
  });
});

describe("standsOnNothing", () => {
  it("counts a confirmed answer no spec holds, unless a person owns it", () => {
    expect(standsOnNothing(answer({}), [])).toBe(true);
    expect(standsOnNothing(answer({ sourceKind: "attribute" }), [])).toBe(true);
    expect(standsOnNothing(answer({}), [fabric("Velvet Rose", "bill")])).toBe(false);
    expect(standsOnNothing(answer({ sourceKind: "manual" }), [])).toBe(false);
    expect(standsOnNothing(answer({ sourceKind: "email" }), [])).toBe(false);
    expect(standsOnNothing(answer({ state: "tbc" }), [])).toBe(false);
  });
});
