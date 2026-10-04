// Pure tier. A drawing the PAGE marks as mock-up resolves among the mock-up
// phase's records only (0043, brief E); one that is not marked fans out by the
// per-phase rule exactly as before, mock-up phase included. And the sentence the
// phase table's selection bar prints after "Also in a mock-up phase".
//
// The shape is the Aman pack's: a mock-up drawing whose code matches a Guest
// Suites line AND a Presidential Suites line. Every code and name is invented.
import { describe, expect, it } from "vitest";
import {
  drawingItemBlockers,
  isMockupDrawing,
  resolveDrawingItem,
  type DrawingItem,
  type OccupiedSlots,
  type StagedDrawings,
} from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/record-refs";
import { describeMockupResult, MOCKUP_NO_SPECS_SENTENCE } from "@/lib/mockup-phase";

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };
const STAGED: Pick<StagedDrawings, "schemaVersion" | "codeGroups" | "filename"> = {
  schemaVersion: 2,
  codeGroups: [],
  filename: "AB-CD-MUR-ZQ-08.pdf",
};

function record(id: string, code: string, runId: string, runName: string, over: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id,
    recordNo: 1,
    label: `P00001-${id}`,
    itemDescription: "Dresser stool",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId,
    runName,
    parentId: null,
    variantLabel: null,
    version: 1,
    ...over,
  };
}

const GR = record("gr", "GR-ZQ-08", "run-gr", "Guest Suites");
const PL = record("pl", "PL-ZQ-08", "run-pl", "Presidential Suites");
const MOCK_GR = record("mu-gr", "GR-ZQ-08", "run-mu", "Mock-up", { onMockupPhase: true });

function item(code: string | null, mockup?: DrawingItem["mockup"]): DrawingItem {
  return {
    id: "i1",
    version: 1,
    page: 1,
    itemCodeRaw: code,
    itemNameRaw: null,
    confidence: "high",
    targets: null,
    observations: [],
    ...(mockup ? { mockup } : {}),
  };
}

describe("isMockupDrawing", () => {
  it("is true only on an explicit yes from the page", () => {
    expect(isMockupDrawing(item("GR-ZQ-08", { is: true, evidence: "MUR in the drawing number" }), "AB-CD-MUR-ZQ-08.pdf")).toBe(true);
    // A yes resting on a caption alone is not enough (the Aman PL sheets, 2026-10-04).
    expect(isMockupDrawing(item("GR-ZQ-08", { is: true, evidence: 'caption "STOOL (MUR)"' }), "AB-CD-PL-ZQ-08.pdf")).toBe(false);
    expect(isMockupDrawing(item("GR-ZQ-08", { is: false, evidence: null }))).toBe(false);
    expect(isMockupDrawing(item("GR-ZQ-08"))).toBe(false);
  });
});

describe("resolveDrawingItem — a mock-up drawing", () => {
  it("lands on the mock-up record only, never on the bill line it was added from", () => {
    const resolution = resolveDrawingItem(
      STAGED,
      item("GR-ZQ-08", { is: true, evidence: "MOCKUP ROOM in the title block" }),
      [GR, PL, MOCK_GR],
    );
    expect(resolution.suggested).toEqual(["mu-gr"]);
    expect(resolution.runs.map((run) => run.runId)).toEqual(["run-mu"]);
    expect(resolution.mockup?.message).toBe(
      "This is a mock-up drawing (MOCKUP ROOM in the title block), so it lands on the mock-up phase only.",
    );
  });

  it("with no mock-up record for its code, matches nothing and says what to press", () => {
    const mockupItem = item("GR-ZQ-08", { is: true, evidence: "MUR in the drawing number" });
    const resolution = resolveDrawingItem(STAGED, mockupItem, [GR, PL]);
    expect(resolution.runs).toEqual([]);
    expect(resolution.suggested).toEqual([]);
    expect(resolution.mockup?.message).toMatch(/no mock-up record carries GR-ZQ-08 yet/);
    expect(resolution.mockup?.message).toMatch(/Also in a mock-up phase/);

    // The card's blocker says the same sentence, never "confirm the BOQ" --
    // the bill IS confirmed; what is missing is the mock-up item.
    const blockers = drawingItemBlockers(mockupItem, resolution, NO_OCCUPANCY);
    const noTargets = blockers.find((blocker) => blocker.code === "no_targets");
    expect(noTargets?.message).toBe(resolution.mockup?.message);
    expect(noTargets?.message).not.toMatch(/Confirm the BOQ/);
  });

  it("never reaches a record whose loader did not say it is on a mock-up phase", () => {
    const unknown = record("mu-unknown", "GR-ZQ-08", "run-mu", "Mock-up");
    const resolution = resolveDrawingItem(STAGED, item("GR-ZQ-08", { is: true, evidence: null }), [GR, unknown]);
    expect(resolution.suggested).toEqual([]);
    expect(resolution.mockup?.message).toBe(
      'This is a mock-up drawing, and no mock-up record carries GR-ZQ-08 yet. On the phase table, tick the bill line it belongs to and press "Also in a mock-up phase", then reload.',
    );
  });

  it("reads a code off the END of a mock-up record's code, among mock-up records only", () => {
    // The page prints ZQ-08; the bill has GR- and PL-. On the whole project
    // that is two candidate codes and a question. Among mock-up records there
    // is one, so it settles.
    const resolution = resolveDrawingItem(
      { ...STAGED, filename: "AB-CD-MUR-SHEET-1.pdf" },
      item("ZQ-08", { is: true, evidence: "MUR" }),
      [GR, PL, MOCK_GR],
    );
    expect(resolution.suggested).toEqual(["mu-gr"]);
    expect(resolution.matchedBy?.code).toBe("GR-ZQ-08");
  });

  it("asks, as now, when two mock-up records carry the code", () => {
    const MOCK_GR_2 = record("mu-gr-2", "GR-ZQ-08", "run-mu", "Mock-up", { onMockupPhase: true });
    const resolution = resolveDrawingItem(STAGED, item("GR-ZQ-08", { is: true, evidence: "MUR" }), [
      GR,
      MOCK_GR,
      MOCK_GR_2,
    ]);
    expect(resolution.suggested).toEqual([]);
    expect(resolution.runs).toHaveLength(1);
    expect(resolution.runs[0]?.status).toBe("ambiguous");
  });
});

describe("resolveDrawingItem — a drawing NOT marked mock-up", () => {
  it("lists the mock-up phase but never suggests it (2026-10-04: a person ticks it)", () => {
    // REVISED after the Aman pack: a PL drawing fanned out onto the GR mock-up
    // copy (same code ending) and the real mock-up drawing then had to ask to
    // replace it. The mock-up phase is still listed, so ticking it is one click.
    const resolution = resolveDrawingItem(STAGED, item("GR-ZQ-08"), [GR, PL, MOCK_GR]);
    expect(new Set(resolution.suggested)).toEqual(new Set(["gr"]));
    expect(resolution.runs.some((run) => run.status === "matched" && run.record.id === "mu-gr")).toBe(true);
    expect(resolution.mockup?.message).toMatch(/left unticked/);
  });

  it("is the same for a page that said it is not mock-up", () => {
    const resolution = resolveDrawingItem(STAGED, item("GR-ZQ-08", { is: false, evidence: null }), [GR, MOCK_GR]);
    expect(new Set(resolution.suggested)).toEqual(new Set(["gr"]));
    expect(resolution.mockup?.message).toMatch(/left unticked/);
  });
});

describe("describeMockupResult", () => {
  const added = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ sourceId: `s${index}`, recordId: `m${index}`, recordNo: 100 + index }));

  it("says what it added, what was already there, and that no specs were copied", () => {
    expect(
      describeMockupResult({
        runName: "Mock-up",
        phaseCreated: false,
        added: added(3),
        already: [{ sourceId: "x", recordId: "y" }],
        skipped: [],
        sharedCodes: [],
      }),
    ).toBe(`Added 3 items to Mock-up; 1 was already there. ${MOCKUP_NO_SPECS_SENTENCE}`);
  });

  it("names a phase it made, a configuration it left out, and a code now on two items", () => {
    const sentence = describeMockupResult({
      runName: "Mock-up",
      phaseCreated: true,
      added: added(2),
      already: [],
      skipped: [{ recordId: "c", reason: "configuration" }],
      sharedCodes: ["GR-ZQ-08"],
    });
    expect(sentence).toMatch(/^Added 2 items to Mock-up; 1 configuration left out — add its bill line instead\./);
    expect(sentence).toMatch(/The Mock-up phase was created\./);
    expect(sentence).toMatch(/GR-ZQ-08 is now on more than one Mock-up item, so a mock-up drawing of it will ask which\./);
  });

  it("adds nothing and copies nothing when everything was already there", () => {
    const sentence = describeMockupResult({
      runName: "Mock-up",
      phaseCreated: false,
      added: [],
      already: [
        { sourceId: "a", recordId: "b" },
        { sourceId: "c", recordId: "d" },
      ],
      skipped: [{ recordId: "e", reason: "retired_there" }],
      sharedCodes: [],
    });
    expect(sentence).toBe(
      "Nothing was added to Mock-up; 2 were already there; 1 was retired there — put it back on the record rather than adding again.",
    );
  });
});
