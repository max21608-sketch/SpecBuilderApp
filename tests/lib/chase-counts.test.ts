// The sentence that explains why the record screen's numbers differ.
//
// FIU 13: "5 to answer" beside "Chase the 4", with nothing saying why. The
// numbers stay different — making them agree would mean chasing a designer
// about a field only we can fill in — so each is labelled by what it counts.
//
// THE CAUSE IS COMPUTED FROM THE ROWS, NOT ASSERTED. The explanation given in
// the room ("Spec notes is a manual entry") named the right feeling and the
// wrong mechanism, and a hard-coded reason is a sentence that is wrong on the
// next record. These fixtures are the four ways a TGQ row can fail to be a
// question somebody is asked, and the last one is the real sofa driven on the
// sandbox on 2026-09-19.
//
// The silent case is the one most worth pinning: a screen whose figures agree
// must carry NO sentence, or the line becomes furniture and the record where
// it means something reads like every other.
import { describe, expect, it } from "vitest";
import {
  describeChaseCounts,
  gateRowRole,
  questionForField,
  summariseGateRows,
  type GateQuestion,
  type GateRowOutcome,
} from "@/lib/chase-counts";

type Row = { outcome: GateRowOutcome; field: { specFieldJsonId: number | null; localKey: string | null; dimensionSlot?: string | null } };

const row = (
  outcome: GateRowOutcome,
  field: Partial<Row["field"]> = {},
): Row => ({ outcome, field: { specFieldJsonId: null, localKey: null, dimensionSlot: null, ...field } });

const question = (over: Partial<GateQuestion> & { requirement_id: string }): GateQuestion => ({
  json_id: null,
  local_key: null,
  kind: "spec_field",
  ...over,
});

describe("gateRowRole", () => {
  it("calls a spec-field question a chase", () => {
    const field = { specFieldJsonId: 130, localKey: null, dimensionSlot: null };
    const q = question({ requirement_id: "q1", json_id: 130 });
    expect(gateRowRole({ outcome: "blocking", field }, q)).toBe("chase");
  });

  it("calls a readiness question one we record here", () => {
    const field = { specFieldJsonId: null, localKey: "headboard_fitted", dimensionSlot: null };
    const q = question({ requirement_id: "q2", local_key: "headboard_fitted", kind: "readiness" });
    expect(gateRowRole({ outcome: "blocking", field }, q)).toBe("readiness");
  });

  it("calls a local-key row with no question at all a record-column row", () => {
    // Spec notes and Designer reference: `loadGateContext` reads them off
    // `spec_records`, which is why they are blocking rather than unanswerable,
    // and why neither renders as a link.
    const field = { specFieldJsonId: null, localKey: "spec_notes", dimensionSlot: null };
    expect(gateRowRole({ outcome: "blocking", field }, null)).toBe("details");
  });

  it("calls a dimension slot a slot, although its question exists", () => {
    // Rows 4-7 carry one BWS id and one Dimensions question between them.
    const field = { specFieldJsonId: 3, localKey: null, dimensionSlot: "SH" };
    const q = question({ requirement_id: "q3", json_id: 3 });
    expect(gateRowRole({ outcome: "blocking", field }, q)).toBe("slot");
  });

  it("keeps 'nowhere to record' and the settled rows out of the work", () => {
    const field = { specFieldJsonId: null, localKey: "product_code", dimensionSlot: null };
    expect(gateRowRole({ outcome: "unanswerable", field }, null)).toBe("nowhere");
    expect(gateRowRole({ outcome: "satisfied", field }, null)).toBe("settled");
    expect(gateRowRole({ outcome: "not_applicable", field }, null)).toBe("settled");
  });
});

describe("questionForField", () => {
  it("matches by local key first and by BWS id otherwise", () => {
    const answers = [
      question({ requirement_id: "by-key", local_key: "headboard_fitted", kind: "readiness" }),
      question({ requirement_id: "by-id", json_id: 3 }),
    ];
    expect(questionForField({ specFieldJsonId: null, localKey: "headboard_fitted" }, answers)?.requirement_id).toBe("by-key");
    expect(questionForField({ specFieldJsonId: 3, localKey: null }, answers)?.requirement_id).toBe("by-id");
    expect(questionForField({ specFieldJsonId: 99, localKey: null }, answers)).toBeNull();
  });

  it("reads either shape of a matrix row, so one matcher serves both callers", () => {
    const answers = [question({ requirement_id: "by-id", json_id: 24 })];
    // `MatrixFieldRow` says `jsonId`; `GateField` says `specFieldJsonId`.
    expect(questionForField({ jsonId: 24, localKey: null }, answers)?.requirement_id).toBe("by-id");
    expect(questionForField({ specFieldJsonId: 24, localKey: null }, answers)?.requirement_id).toBe("by-id");
  });
});

describe("summariseGateRows", () => {
  it("counts to-answer as blocking plus unknown, the figure the chip shows", () => {
    const rows = [
      row("blocking", { specFieldJsonId: 130 }),
      row("unknown", { specFieldJsonId: 6 }),
      row("unanswerable", { localKey: "product_code" }),
      row("satisfied", { specFieldJsonId: 191 }),
      row("not_applicable", { specFieldJsonId: 232 }),
    ];
    const answers = [question({ requirement_id: "a", json_id: 130 }), question({ requirement_id: "b", json_id: 6 })];
    const buckets = summariseGateRows(rows, answers);
    // The same number `answerable()` computes off the counts, from the rows.
    const blockingPlusUnknown = rows.filter((r) => r.outcome === "blocking" || r.outcome === "unknown").length;
    expect(buckets.toAnswer).toBe(blockingPlusUnknown);
    expect(buckets.nowhere).toBe(1);
    expect(buckets.chase).toBe(2);
  });
});

describe("describeChaseCounts", () => {
  it("says nothing when every outstanding row is a question somebody is asked", () => {
    const buckets = { toAnswer: 4, chase: 4, details: 0, readiness: 0, slots: 0, nowhere: 1 };
    expect(describeChaseCounts({ buckets, toChase: 4 })).toBeNull();
  });

  it("reads the sofa driven on the sandbox on 2026-09-19", () => {
    // AP364-003 · Sofa: seven TGQ rows — Product code (nowhere), Spec notes and
    // Designer reference (record columns, outstanding, not links), and four
    // real questions. The chip says 6, the button says 4.
    const rows = [
      row("unanswerable", { localKey: "product_code" }),
      row("blocking", { localKey: "spec_notes" }),
      row("blocking", { localKey: "designer_reference" }),
      row("blocking", { specFieldJsonId: 130 }),
      row("blocking", { specFieldJsonId: 6 }),
      row("blocking", { specFieldJsonId: 191 }),
      row("blocking", { specFieldJsonId: 232 }),
    ];
    const answers = [130, 6, 191, 232].map((id, index) => question({ requirement_id: `q${index}`, json_id: id }));
    const buckets = summariseGateRows(rows, answers);
    expect(buckets).toEqual({ toAnswer: 6, chase: 4, details: 2, readiness: 0, slots: 0, nowhere: 1 });
    expect(describeChaseCounts({ buckets, toChase: 4 })).toBe(
      "6 to answer at TGQ · 4 to chase · 2 you record on this item's details",
    );
  });

  it("names a readiness row as one we record here", () => {
    const buckets = { toAnswer: 5, chase: 4, details: 0, readiness: 1, slots: 0, nowhere: 0 };
    expect(describeChaseCounts({ buckets, toChase: 4 })).toBe("5 to answer at TGQ · 4 to chase · 1 you record here");
  });

  it("names the dimension slots when the gate counts four and the checklist asks one", () => {
    const buckets = { toAnswer: 5, chase: 1, details: 0, readiness: 0, slots: 4, nowhere: 0 };
    expect(describeChaseCounts({ buckets, toChase: 1 })).toBe(
      "5 to answer at TGQ · 1 to chase · 4 counted as separate slots",
    );
  });

  it("carries every bucket at once, in one line, in order", () => {
    const buckets = { toAnswer: 8, chase: 3, details: 2, readiness: 1, slots: 2, nowhere: 1 };
    expect(describeChaseCounts({ buckets, toChase: 3 })).toBe(
      "8 to answer at TGQ · 3 to chase · 2 you record on this item's details · 1 you record here · " +
        "2 counted as separate slots",
    );
  });

  it("prints BOTH figures rather than hiding a disagreement with the button", () => {
    // The gate's own chase bucket and the route's `toChase` are two readings of
    // the same population. If they part company that is a finding, not a
    // rounding, and the screen must not pick one.
    const buckets = { toAnswer: 4, chase: 4, details: 0, readiness: 0, slots: 0, nowhere: 0 };
    expect(describeChaseCounts({ buckets, toChase: 3 })).toBe(
      "4 to answer at TGQ · 4 to chase · the button says 3 (differs — see the rows)",
    );
  });

  it("says nothing where Matthew's matrix does not reach the category", () => {
    // `gatesForRecord` returns null there, so there is no second measure.
    expect(describeChaseCounts({ buckets: null, toChase: 4 })).toBeNull();
  });

  it("says nothing where the record has no level, because nothing is tiered", () => {
    const buckets = { toAnswer: 6, chase: 4, details: 2, readiness: 0, slots: 0, nowhere: 1 };
    expect(describeChaseCounts({ buckets, toChase: null })).toBeNull();
  });
});
