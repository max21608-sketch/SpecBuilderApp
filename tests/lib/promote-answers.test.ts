import { describe, it, expect } from "vitest";
import { planAnswerFills, DIMENSIONS_JSON_ID, type PromotableAttribute } from "@/lib/promote-answers";

const attribute = (over: Partial<PromotableAttribute>): PromotableAttribute => ({
  attrGroup: "dimension",
  dimensionSlot: null,
  specFieldId: null,
  value: null,
  unit: "mm",
  state: "confirmed",
  sortOrder: 1,
  ...over,
});

const dim = (slot: string, value: string, over: Partial<PromotableAttribute> = {}) =>
  attribute({ attrGroup: "dimension", dimensionSlot: slot, value, ...over });

describe("planAnswerFills", () => {
  it("composes the four slots into ONE dimensions answer", () => {
    const fills = planAnswerFills([
      dim("W", "1900"),
      dim("D", "790", { sortOrder: 2 }),
      dim("H", "720", { sortOrder: 3 }),
      dim("SH", "440", { sortOrder: 4 }),
    ]);
    expect(fills).toHaveLength(1);
    // The BWS cell, unit once at the end -- the same composition the export
    // and the record screen render, from the same function.
    expect(fills[0]?.value).toBe("W1900 x D790 x H720 x SH440mm");
    expect(fills[0]?.jsonId).toBe(DIMENSIONS_JSON_ID);
    expect(fills[0]?.state).toBe("confirmed");
    // The originals stay legible beside it, so a converted figure can be
    // re-checked against a page that said 190.
    expect(fills[0]?.valueRaw).toContain("W 1900 mm");
  });

  it("carries TBC THROUGH: a tbc slot cannot make a confirmed answer", () => {
    // The trap this exists for. Promoted as confirmed, a gate reads satisfied
    // over a dimension nobody has decided.
    const fills = planAnswerFills([dim("W", "1900"), dim("H", "720", { state: "tbc", sortOrder: 2 })]);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.state).toBe("tbc");
  });

  it("refuses to confirm a cell it could not derive", () => {
    // No unit is a problem composeDimensionCell reports rather than guesses,
    // and a guessed conversion looks exactly like a measurement.
    const fills = planAnswerFills([dim("W", "190", { unit: null })]);
    expect(fills[0]?.state).toBe("tbc");
  });

  it("does not confirm a diameter recorded beside a width", () => {
    // Cross-row conflict: a round item has no width, so one of the two is
    // wrong and nothing downstream would question either.
    const fills = planAnswerFills([dim("DIA", "600"), dim("W", "1900", { sortOrder: 2 })]);
    expect(fills[0]?.state).toBe("tbc");
  });

  it("writes nothing for a record whose dimensions carry no value", () => {
    // composeDimensionCell renders a valueless slot as [W "" — not a number],
    // which belongs beside the row on the review screen and nowhere near an
    // answer.
    expect(planAnswerFills([dim("W", null as unknown as string)])).toHaveLength(0);
    expect(planAnswerFills([dim("W", "   ")])).toHaveLength(0);
  });

  it("never confirms a cell with no figure in it", () => {
    // "W TBC" composes with no problems at all, so only this guard stops a
    // mislabelled attribute state producing a satisfied answer over a
    // dimension the page said was undecided.
    const fills = planAnswerFills([dim("W", "TBC", { state: "confirmed" })]);
    expect(fills[0]?.value).toBe("W TBC");
    expect(fills[0]?.state).toBe("tbc");
  });

  it("maps a non-dimension attribute straight to its BWS field", () => {
    const fills = planAnswerFills([
      attribute({ attrGroup: "finish", specFieldId: "11111111-1111-1111-1111-111111111111", value: "  Antique brass  " }),
    ]);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.specFieldId).toBe("11111111-1111-1111-1111-111111111111");
    expect(fills[0]?.jsonId).toBeNull();
    expect(fills[0]?.value).toBe("Antique brass");
  });

  it("leaves a note alone -- it answers no question, and that is the point", () => {
    // ARM HEIGHT is a real measurement with no BWS slot. M8 step 3: a
    // statement the matrix has no question for is KEPT, never forced into one.
    expect(planAnswerFills([attribute({ attrGroup: "note", dimensionSlot: null, value: "520" })])).toHaveLength(0);
  });

  it("skips a BWS field two attributes both claim, rather than picking one", () => {
    const field = "22222222-2222-2222-2222-222222222222";
    const fills = planAnswerFills([
      attribute({ attrGroup: "finish", specFieldId: field, value: "Antique brass" }),
      attribute({ attrGroup: "finish", specFieldId: field, value: "Polished chrome", sortOrder: 2 }),
    ]);
    // Choosing silently is how the wrong finish reaches an export.
    expect(fills).toHaveLength(0);
  });

  it("a tbc material becomes a tbc answer, keeping the wording the page used", () => {
    const fills = planAnswerFills([
      attribute({
        attrGroup: "material",
        specFieldId: "33333333-3333-3333-3333-333333333333",
        value: "TBC – Yarn Collective Tessarae YC04158 - 01",
        state: "tbc",
      }),
    ]);
    expect(fills[0]?.state).toBe("tbc");
    expect(fills[0]?.value).toContain("Yarn Collective");
  });
});
