// Pure tier. Which rows one fanned-out answer touches (`planProjectWide`), on
// the project card and the area card alike.
//
// CHASE REVIEW C1, 2026-11-21: the BWS file ships a record's SPEC before its
// checklist answer, so an item whose field a spec holds — the answer is a
// projection (`source_kind = 'attribute'`), or a spec ships for the field —
// was written like any unsettled row and the checklist then said "Indoor"
// while the file shipped "Outdoor TBC". Such a row is now treated like a
// settled different answer: listed, unticked, left alone unless ticked.
import { describe, expect, it } from "vitest";
import { planProjectWide, type ProjectWideRow } from "@/lib/project-wide-plan";

let n = 0;
function row(over: Partial<ProjectWideRow> = {}): ProjectWideRow {
  n += 1;
  return {
    recordId: `rec-${n}`,
    recordLabel: `T1-00${n}`,
    itemDescription: "Chair",
    requirementId: "req-1",
    answerId: `ans-${n}`,
    answerVersion: 1,
    state: "missing",
    value: null,
    tier: "to_quote",
    specShips: null,
    projection: false,
    ...over,
  };
}

const plan = (rows: ProjectWideRow[], overrides: string[] = []) =>
  planProjectWide({ rows }, { value: "Indoor", state: "confirmed", overrides: new Set(overrides) });

describe("a fanned-out answer never disagrees silently with the file", () => {
  it("writes an unanswered row nobody's spec holds", () => {
    const plain = row();
    expect(plan([plain]).write).toEqual([plain]);
  });

  it("leaves alone a TBC row whose field a spec fills, unless ticked", () => {
    const held = row({ state: "tbc", value: "Outdoor TBC", specShips: "Outdoor TBC", projection: true });
    expect(plan([held]).write).toEqual([]);
    expect(plan([held]).leftAlone).toEqual([held]);
    expect(plan([held], [held.answerId!]).override).toEqual([held]);
  });

  it("leaves alone a MISSING row where a spec ships for the field anyway", () => {
    const held = row({ specShips: "Outdoor" });
    expect(plan([held]).leftAlone).toEqual([held]);
  });

  it("leaves alone a projection whose spec no longer ships", () => {
    const held = row({ state: "tbc", value: "Outdoor", projection: true });
    expect(plan([held]).leftAlone).toEqual([held]);
  });

  it("calls it the same where the file already ships exactly this", () => {
    const agreeing = row({ state: "confirmed", value: "Indoor", specShips: "Indoor", projection: true });
    expect(plan([agreeing]).same).toEqual([agreeing]);
  });
});
