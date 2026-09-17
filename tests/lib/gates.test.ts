// Pure tier — the gate function reads STATE, and three of its five outcomes
// exist to stop it lying.
import { describe, it, expect } from "vitest";
import { gateStatus, type GateField, type GateFieldStatus, type GateStatus } from "@/lib/gates";

const field = (over: Partial<GateField> = {}): GateField => ({
  matrixRow: 1,
  gate: "TG0",
  capture: "input",
  fieldName: "COM 1 + location",
  specFieldJsonId: 1,
  localKey: null,
  dimensionSlot: null,
  valueType: "free_text",
  paletteKey: null,
  paletteRaw: null,
  conditionalOnKey: null,
  conditionalOnValue: null,
  notes: null,
  ...over,
});

const asked = (...ids: number[]) => new Set(ids);

/** The first status, asserted present — every case below checks exactly one field. */
function only(s: GateStatus): GateFieldStatus {
  const first = s.fields[0];
  if (!first) throw new Error("expected one field status");
  return first;
}

describe("gateStatus — the four states are four different things", () => {
  it("a confirmed answer satisfies", () => {
    const s = gateStatus("TG0", [field()], {
      answers: [{ specFieldJsonId: 1, state: "confirmed", value: "FB-001; 12m" }],
      slots: [],
      askedFieldIds: asked(1),
    });
    expect(s.satisfied).toBe(true);
    expect(only(s).outcome).toBe("satisfied");
  });

  it("TBC BLOCKS — it is an answer, not an absence", () => {
    const s = gateStatus("TG0", [field()], {
      answers: [{ specFieldJsonId: 1, state: "tbc", value: "TBC – Yarn Collective" }],
      slots: [],
      askedFieldIds: asked(1),
    });
    expect(s.satisfied).toBe(false);
    expect(only(s).outcome).toBe("blocking");
    expect(only(s).reason).toContain("not decided");
  });

  it("a non-empty string is not the test — na satisfies the gate and tbc does not, both carrying text", () => {
    const na = gateStatus("TG0", [field()], {
      answers: [{ specFieldJsonId: 1, state: "na", value: null }],
      slots: [],
      askedFieldIds: asked(1),
    });
    expect(only(na).outcome).toBe("not_applicable");
    expect(na.satisfied).toBe(true);
  });

  it("missing blocks, and so does no answer row at all", () => {
    const none = gateStatus("TG0", [field()], { answers: [], slots: [], askedFieldIds: asked(1) });
    expect(only(none).outcome).toBe("blocking");
    expect(only(none).state).toBe("missing");
  });
});

describe("gateStatus — unanswerable is not the reviewer's fault", () => {
  it("a field the matrix wants and this category's checklist cannot ask", () => {
    const s = gateStatus("TG0", [field()], { answers: [], slots: [], askedFieldIds: asked() });
    expect(only(s).outcome).toBe("unanswerable");
    expect(s.satisfied).toBe(false);
  });

  it("one of the ten rows with no BWS field and no home yet", () => {
    const s = gateStatus("TGQ", [field({ specFieldJsonId: null, localKey: "product_code" })], {
      answers: [],
      slots: [],
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("unanswerable");
  });

  it("but a local key the record CAN answer is judged like any other", () => {
    const s = gateStatus("TGQ", [field({ specFieldJsonId: null, localKey: "designer_reference" })], {
      answers: [],
      slots: [],
      locals: { designer_reference: { state: "confirmed", value: "LCS" } },
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("satisfied");
  });
});

describe("gateStatus — a dimension slot is settled by an attribute, not an answer", () => {
  const sh = field({ gate: "TGQ", specFieldJsonId: 3, dimensionSlot: "SH", fieldName: "Seat height - SH" });

  it("a confirmed slot satisfies", () => {
    const s = gateStatus("TGQ", [sh], {
      answers: [],
      slots: [{ dimensionSlot: "SH", state: "confirmed", value: "440" }],
      askedFieldIds: asked(3),
    });
    expect(only(s).outcome).toBe("satisfied");
    expect(only(s).value).toBe("440");
  });

  it("a TBC slot blocks", () => {
    const s = gateStatus("TGQ", [sh], {
      answers: [],
      slots: [{ dimensionSlot: "SH", state: "tbc", value: null }],
      askedFieldIds: asked(3),
    });
    expect(only(s).outcome).toBe("blocking");
  });

  it("a different slot does not stand in for it", () => {
    const s = gateStatus("TGQ", [sh], {
      answers: [],
      slots: [{ dimensionSlot: "H", state: "confirmed", value: "720" }],
      askedFieldIds: asked(3),
    });
    expect(only(s).outcome).toBe("blocking");
  });

  it("and a confirmed ANSWER on field 3 does not satisfy a slot, because the cell is not the figure", () => {
    const s = gateStatus("TGQ", [sh], {
      answers: [{ specFieldJsonId: 3, state: "confirmed", value: "W840 x D790 x H720mm" }],
      slots: [],
      askedFieldIds: asked(3),
    });
    expect(only(s).outcome).toBe("blocking");
  });
});

describe("gateStatus — a conditional whose controller is unanswered is UNKNOWN, never satisfied", () => {
  const socket = field({
    matrixRow: 28,
    fieldName: "Socket spec + positions",
    specFieldJsonId: null,
    localKey: "socket_spec",
    conditionalOnKey: "headboard_fitted",
    conditionalOnValue: "Yes",
  });

  it("nobody has said whether the headboard is fitted", () => {
    const s = gateStatus("TG0", [socket], { answers: [], slots: [], askedFieldIds: asked() });
    expect(only(s).outcome).toBe("unknown");
    expect(s.satisfied).toBe(false);
  });

  it("controller says No — genuinely not applicable", () => {
    const s = gateStatus("TG0", [socket], {
      answers: [],
      slots: [],
      locals: { headboard_fitted: { state: "confirmed", value: "No" } },
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("not_applicable");
    expect(s.satisfied).toBe(true);
  });

  it("controller says Yes — now it is judged, and it has nowhere to be recorded", () => {
    const s = gateStatus("TG0", [socket], {
      answers: [],
      slots: [],
      locals: { headboard_fitted: { state: "confirmed", value: "Yes" } },
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("unanswerable");
  });

  it("controller is TBC — still unknown, not applicable-by-default", () => {
    const s = gateStatus("TG0", [socket], {
      answers: [],
      slots: [],
      locals: { headboard_fitted: { state: "tbc", value: null } },
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("unknown");
  });
});

describe("gateStatus — satisfaction", () => {
  it("an empty field list is never satisfied, because nothing was checked", () => {
    const s = gateStatus("TG0", [], { answers: [], slots: [], askedFieldIds: asked() });
    expect(s.satisfied).toBe(false);
  });

  it("counts every outcome", () => {
    const s = gateStatus(
      "TG0",
      [field({ matrixRow: 1, specFieldJsonId: 1 }), field({ matrixRow: 2, specFieldJsonId: 2 })],
      {
        answers: [
          { specFieldJsonId: 1, state: "confirmed", value: "x" },
          { specFieldJsonId: 2, state: "tbc", value: null },
        ],
        slots: [],
        askedFieldIds: asked(1, 2),
      },
    );
    expect(s.counts).toMatchObject({ satisfied: 1, blocking: 1 });
  });
});
