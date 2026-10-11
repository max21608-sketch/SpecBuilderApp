// Pure tier. One code on two lines of one phase — the reviewer ticks one OR
// BOTH (found on pilot, 2026-10-11).
//
// The Aman bill lists PL-FUR-11 twice in its Main Phase: a stool in the
// Ambassador Suite's bathroom and another in the Presidential Suite's
// wardrobe, and the one drawing's own type schedule names both. Picking a line
// on the card never cleared the block — `ambiguous_run` fired for every
// ambiguous phase whatever was ticked — so no such card could ever be
// confirmed. The shapes are that bill's; every code and name here is invented.
import { describe, it, expect } from "vitest";
import {
  drawingItemBlockers,
  oneLinePerPhase,
  resolveDrawingTargets,
  targetRecordIds,
  toggledTargets,
  type DrawingItem,
  type OccupiedSlots,
} from "@/lib/drawing-document";
import type { RecordEntry } from "@/lib/record-refs";

const NO_OCCUPANCY: OccupiedSlots = { fields: new Map(), dimensions: new Map() };

function record(id: string, code: string, overrides: Partial<RecordEntry> = {}): RecordEntry {
  return {
    id,
    recordNo: 1,
    label: `P00001-${id}`,
    itemDescription: "Stool",
    categoryId: null,
    categoryName: null,
    refs: [code],
    boqCodes: [code],
    runId: "run-main",
    runName: "Main Phase",
    parentId: null,
    variantLabel: null,
    version: 1,
    ...overrides,
  };
}

function card(targets: DrawingItem["targets"], code = "QX-FUR-11"): DrawingItem {
  return { id: "i", version: 1, page: 1, itemCodeRaw: code, itemNameRaw: null, confidence: "high", targets, observations: [] };
}

const ambiguous = (item: DrawingItem, records: RecordEntry[], code = "QX-FUR-11") =>
  drawingItemBlockers(item, resolveDrawingTargets(code, records), NO_OCCUPANCY).filter((b) => b.code === "ambiguous_run");

// Two lines, one code, one phase: the bathroom and the wardrobe.
const TWO_LINES = [record("bath", "QX-FUR-11"), record("wardrobe", "QX-FUR-11")];

describe("two lines carrying one code in one phase", () => {
  it("asks while nothing is ticked, and pre-selects nothing", () => {
    const resolution = resolveDrawingTargets("QX-FUR-11", TWO_LINES);
    expect(resolution.suggested).toEqual([]);
    expect(oneLinePerPhase(resolution)).toBe(false);
    for (const targets of [null, { ticked: [], unticked: [] }]) {
      const blockers = ambiguous(card(targets), TWO_LINES);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]!.message).toBe("Main Phase has 2 lines with this code. Tick the line or lines this drawing is for.");
    }
  });

  it("stops asking once one line is ticked", () => {
    expect(ambiguous(card({ ticked: ["bath"], unticked: [] }), TWO_LINES)).toEqual([]);
    expect(ambiguous(card({ ticked: ["wardrobe"], unticked: [] }), TWO_LINES)).toEqual([]);
  });

  it("takes both lines ticked as an answer, and writes to both", () => {
    const item = card({ ticked: ["bath", "wardrobe"], unticked: [] });
    expect(ambiguous(item, TWO_LINES)).toEqual([]);
    expect(targetRecordIds(item, resolveDrawingTargets("QX-FUR-11", TWO_LINES)).sort()).toEqual(["bath", "wardrobe"]);
    // Nothing else holds the card: no `no_targets` either.
    expect(drawingItemBlockers(item, resolveDrawingTargets("QX-FUR-11", TWO_LINES), NO_OCCUPANCY)).toEqual([]);
  });

  it("does not count a line that was ticked and then unticked", () => {
    expect(ambiguous(card({ ticked: ["bath"], unticked: ["bath"] }), TWO_LINES)).toHaveLength(1);
    expect(ambiguous(card({ ticked: ["bath", "wardrobe"], unticked: ["bath"] }), TWO_LINES)).toEqual([]);
  });

  it("asks per phase: a tick in one phase does not answer another", () => {
    const records = [
      ...TWO_LINES,
      record("ve-1", "QX-FUR-11", { runId: "run-ve", runName: "VE Phase" }),
      record("ve-2", "QX-FUR-11", { runId: "run-ve", runName: "VE Phase" }),
    ];
    const blockers = ambiguous(card({ ticked: ["bath"], unticked: [] }), records);
    expect(blockers.map((b) => b.code === "ambiguous_run" && b.runId)).toEqual(["run-ve"]);
  });
});

describe("a page code that is the END of several different bill codes", () => {
  // The page prints QX-08; the bill lists LV-QX-08 and UP-QX-08 in one phase.
  const ENDS = [record("lv", "LV-QX-08"), record("up", "UP-QX-08")];

  it("is one choice per phase", () => {
    expect(oneLinePerPhase(resolveDrawingTargets("QX-08", ENDS))).toBe(true);
    // A settled code-end match is not: its lines share the settled code.
    expect(oneLinePerPhase(resolveDrawingTargets("QX-08", [record("lv", "LV-QX-08")]))).toBe(false);
  });

  it("still asks with nothing ticked, in the page's own sentence", () => {
    const blockers = ambiguous(card(null, "QX-08"), ENDS, "QX-08");
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.message).toMatch(/^Main Phase: The page names QX-08, which is the end of 2 bill codes/);
  });

  it("clears with one ticked", () => {
    expect(ambiguous(card({ ticked: ["up"], unticked: ["lv"] }, "QX-08"), ENDS, "QX-08")).toEqual([]);
  });

  it("refuses two ticked: the page named one code", () => {
    const blockers = ambiguous(card({ ticked: ["up", "lv"], unticked: [] }, "QX-08"), ENDS, "QX-08");
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.message).toMatch(/the page names one code, QX-08, and 2 lines are ticked/);
  });
});

describe("toggledTargets, as the three cards send a press", () => {
  it("starts an untouched item from what resolved, never from nothing", () => {
    expect(toggledTargets(null, ["mur"], "bath", true)).toEqual({ ticked: ["mur", "bath"], unticked: [] });
  });

  it("keeps the first line when a second is ticked", () => {
    expect(toggledTargets({ ticked: ["bath"], unticked: [] }, [], "wardrobe", true)).toEqual({
      ticked: ["bath", "wardrobe"],
      unticked: [],
    });
  });

  it("records an untick as a decision", () => {
    expect(toggledTargets({ ticked: ["bath", "wardrobe"], unticked: [] }, [], "bath", false)).toEqual({
      ticked: ["wardrobe"],
      unticked: ["bath"],
    });
  });

  it("sends the replaced candidates as unticked on a one-choice pick", () => {
    expect(toggledTargets({ ticked: ["lv"], unticked: [] }, [], "up", true, ["lv"])).toEqual({
      ticked: ["up"],
      unticked: ["lv"],
    });
    // The pick itself is never in the list it unticks.
    expect(toggledTargets(null, [], "up", true, ["lv", "up"])).toEqual({ ticked: ["up"], unticked: ["lv"] });
  });
});
