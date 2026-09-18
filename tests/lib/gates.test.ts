// Pure tier — the gate function reads STATE, and three of its five outcomes
// exist to stop it lying.
import { describe, it, expect } from "vitest";
import {
  chainGates,
  gateStatus,
  type Gate,
  type GateField,
  type GateFieldStatus,
  type GateFieldsStatus,
} from "@/lib/gates";

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
function only(s: GateFieldsStatus): GateFieldStatus {
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
    expect(s.ownSatisfied).toBe(true);
    expect(only(s).outcome).toBe("satisfied");
  });

  it("TBC BLOCKS — it is an answer, not an absence", () => {
    const s = gateStatus("TG0", [field()], {
      answers: [{ specFieldJsonId: 1, state: "tbc", value: "TBC – Yarn Collective" }],
      slots: [],
      askedFieldIds: asked(1),
    });
    expect(s.ownSatisfied).toBe(false);
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
    expect(na.ownSatisfied).toBe(true);
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
    expect(s.ownSatisfied).toBe(false);
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
    expect(s.ownSatisfied).toBe(false);
  });

  it("controller says No — genuinely not applicable", () => {
    const s = gateStatus("TG0", [socket], {
      answers: [],
      slots: [],
      locals: { headboard_fitted: { state: "confirmed", value: "No" } },
      askedFieldIds: asked(),
    });
    expect(only(s).outcome).toBe("not_applicable");
    expect(s.ownSatisfied).toBe(true);
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
    expect(s.ownSatisfied).toBe(false);
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

// ============================================================================
// THE CHAIN. Asked for on 2026-09-18, on a record whose panel read
// `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓`: "it's impossible to be
// at TG1 if you haven't reached TG0 or TGQ. They build on each other."
// ============================================================================

/** One gate's own verdict, without running the field rules. */
const own = (gate: Gate, ownSatisfied: boolean): GateFieldsStatus => ({
  gate,
  ownSatisfied,
  fields: [],
  counts: { satisfied: 0, blocking: ownSatisfied ? 0 : 1, not_applicable: 0, unknown: 0, unanswerable: 0 },
});

const chain = (tgq: boolean, tg0: boolean, tg1: boolean) =>
  chainGates({ TGQ: own("TGQ", tgq), TG0: own("TG0", tg0), TG1: own("TG1", tg1) });

describe("chainGates — a gate is met only if every gate before it is", () => {
  it("THE REPORTED DEFECT: TG1's own fields all settled, over an unmet TGQ and TG0", () => {
    const g = chain(false, false, true);
    expect(g.TG1.ownSatisfied).toBe(true);
    // The whole point: its own fields say yes and the gate still says no.
    expect(g.TG1.satisfied).toBe(false);
    expect(g.TG1.blockedBy).toEqual(["TGQ", "TG0"]);
  });

  it("names the EARLIEST unmet gate first, because that is the one to do next", () => {
    const g = chain(false, true, true);
    expect(g.TG0.blockedBy).toEqual(["TGQ"]);
    expect(g.TG1.blockedBy).toEqual(["TGQ", "TG0"]);
    expect(g.TG0.satisfied).toBe(false);
    expect(g.TG1.satisfied).toBe(false);
  });

  it("TGQ is first, so nothing can ever block it", () => {
    expect(chain(true, false, false).TGQ.blockedBy).toEqual([]);
    expect(chain(false, false, false).TGQ.blockedBy).toEqual([]);
  });

  it("clearing TGQ hands the work to TG0 and no further", () => {
    const g = chain(true, false, true);
    expect(g.TGQ.satisfied).toBe(true);
    expect(g.TG0.satisfied).toBe(false);
    expect(g.TG0.blockedBy).toEqual([]); // TG0's own work, and it is TG0's turn
    expect(g.TG1.blockedBy).toEqual(["TG0"]);
  });

  it("all three met is all three satisfied", () => {
    const g = chain(true, true, true);
    expect([g.TGQ.satisfied, g.TG0.satisfied, g.TG1.satisfied]).toEqual([true, true, true]);
    expect(g.TG1.blockedBy).toEqual([]);
  });

  it("the OWN reading survives the chain, because they are two different questions", () => {
    // "TG1 has nothing left of its own" and "TG1 is met" must stay
    // distinguishable: collapsing them puts work on a desk that is already
    // done, or claims a gate nobody reached.
    const g = chain(false, true, true);
    expect(g.TG0.ownSatisfied).toBe(true);
    expect(g.TG0.satisfied).toBe(false);
  });

  it("an earlier gate held up by an UNANSWERABLE field blocks the later ones too", () => {
    // The app has nowhere to record it, so no answer clears TGQ — and we still
    // must not claim TG1 over a gate we were never able to judge.
    const tgq = gateStatus("TGQ", [field({ gate: "TGQ", specFieldJsonId: 9 })], {
      answers: [],
      slots: [],
      askedFieldIds: asked(), // the checklist has no question for field 9
    });
    expect(only(tgq).outcome).toBe("unanswerable");
    const g = chainGates({ TGQ: tgq, TG0: own("TG0", true), TG1: own("TG1", true) });
    expect(g.TG1.satisfied).toBe(false);
    expect(g.TG1.blockedBy).toEqual(["TGQ", "TG0"]);
  });
});
