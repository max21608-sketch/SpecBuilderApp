// Which active phase a bill tab looks like (prod-ready RV0, 2026-11-20), and
// the reason the bill's Confirm gives while nobody has said which it is.
import { describe, expect, it } from "vitest";
import { phaseSuggestionEvidence, phaseUndecided, suggestPhaseRevision } from "@/lib/phase-revision-suggest";
import { boqConfirmBlocker } from "@/lib/boq-row-kinds";
import { billNeedsYou } from "@/lib/needs-you";

const lines = (...codes: (string | null)[]) => codes.map((code) => ({ code, ignored: false }));
const guest = { id: "p-guest", name: "Guest Rooms", sourceSheet: "GUEST ROOMS", codes: ["GR01", "GR02", "GR03"] };
const mockup = { id: "p-mock", name: "Mock-up", sourceSheet: null, codes: ["GR01", "GR02", "GR03"] };
const publicAreas = { id: "p-public", name: "Public Areas", sourceSheet: null, codes: ["PA01"] };

describe("suggestPhaseRevision", () => {
  it("offers the phase a tab is named for, and only that one, with its codes", () => {
    const sheet = { sheetName: "Guest Rooms ", lines: lines("GR-01", "GR-02", "NEW-9") };
    expect(suggestPhaseRevision(sheet, [guest, mockup, publicAreas])).toEqual([
      { runId: "p-guest", runName: "Guest Rooms", sameName: true, codesOnPhase: 2, codesOnSheet: 3 },
    ]);
  });

  it("matches the phase's source sheet as well as its name, folded", () => {
    const sheet = { sheetName: "guest  rooms", proposedRunName: "Rooms rev B", lines: lines() };
    expect(suggestPhaseRevision(sheet, [{ ...guest, name: "Bedrooms" }])[0]?.sameName).toBe(true);
  });

  it("offers every phase holding MORE than half the codes where no name matches, best first", () => {
    const sheet = { sheetName: "Rev B", lines: lines("GR-01", "GR-02", "GR-03", "X1") };
    expect(suggestPhaseRevision(sheet, [publicAreas, mockup, { ...guest, codes: ["GR01", "GR02"] }]).map((s) => s.runId)).toEqual([
      "p-mock",
    ]);
    const twoQuoteTheSame = suggestPhaseRevision({ sheetName: "Rev B", lines: lines("GR-01", "GR-02") }, [guest, mockup]);
    expect(twoQuoteTheSame.map((s) => s.runId)).toEqual(["p-guest", "p-mock"]);
  });

  it("offers nothing for half or fewer, for dropped and fabric lines, or for no codes", () => {
    expect(suggestPhaseRevision({ sheetName: "Rev B", lines: lines("GR-01", "X1") }, [guest])).toEqual([]);
    expect(
      suggestPhaseRevision(
        { sheetName: "Rev B", lines: [{ code: "GR-01", ignored: true }, { code: "GR-02", rowKind: "finish_for" }, { code: "X1" }] },
        [guest],
      ),
    ).toEqual([]);
    expect(suggestPhaseRevision({ sheetName: "Rev B", lines: lines(null, " ") }, [guest])).toEqual([]);
  });
});

describe("phaseUndecided", () => {
  const suggestion = [{ runId: "p-guest", runName: "Guest Rooms", sameName: true, codesOnPhase: 3, codesOnSheet: 3 }];
  const sheet = { sheetName: "Guest Rooms", lines: [] };
  it("waits on a suggested tab until a revision or “a new phase” is stored", () => {
    expect(phaseUndecided(sheet, suggestion)).toBe(true);
    expect(phaseUndecided({ ...sheet, replacesRunId: "p-guest" }, suggestion)).toBe(false);
    expect(phaseUndecided({ ...sheet, newPhaseChosen: true }, suggestion)).toBe(false);
    expect(phaseUndecided({ ...sheet, ignored: true }, suggestion)).toBe(false);
    expect(phaseUndecided(sheet, [])).toBe(false);
  });
  it("says its evidence in words", () => {
    expect(phaseSuggestionEvidence(suggestion[0]!)).toBe("same sheet name · 3 of 3 codes are on it");
    expect(phaseSuggestionEvidence({ ...suggestion[0]!, sameName: false, codesOnPhase: 1, codesOnSheet: 1 })).toBe("1 of 1 code is on it");
  });
});

describe("the reason beside the bill's Confirm, and the place it points", () => {
  const none = { single: false, reading: false, unmapped: [], unchecked: [], kindProblems: [], noLiveLines: false };
  it("names the tabs nobody has said are new or a revision", () => {
    expect(boqConfirmBlocker({ ...none, undecidedPhases: ["Guest Rooms"] })).toBe(
      "Say whether the “Guest Rooms” tab is a new phase or a revision of one.",
    );
    expect(boqConfirmBlocker({ ...none, single: true, undecidedPhases: ["Sheet1"] })).toBe(
      "Say whether this bill is a new phase or a revision of one.",
    );
  });
  it("lists it with a link to the tab's choice", () => {
    const items = billNeedsYou({
      single: false,
      reading: false,
      noLiveLines: false,
      sheets: [{ index: 1, tab: "Guest Rooms", unmapped: false, unchecked: false, problems: [], phaseUndecided: true }],
    });
    expect(items).toEqual([
      expect.objectContaining({
        key: "phase-1",
        words: "Say whether “Guest Rooms” is a new phase or a revision of one",
        target: "sheet-1-phase",
        sheetIndex: 1,
      }),
    ]);
  });
});
