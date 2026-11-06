// Pure tier. Audit D2 and D3 (2026-11-06): a decision about a row follows the
// row, and the records a card was shown are the records it writes to.
//
// D2. A "Use this drawing's" tick names the attribute it replaces on a record,
// and nothing else. Ticked, then moved to a note or another slot, it used to
// survive, describe nothing on the screen (no clash, no panel) and still
// retire the bill's width at confirm, superseded by a note.
//
// D3. An untouched card has no `targets`, so the confirm used to take the LIVE
// suggestion; a record that appeared after page load was written unseen.
//
// Synthetic throughout.
import { describe, expect, it } from "vitest";
import {
  drawingItemBlockers,
  onRowRetargeted,
  replaceTargetOf,
  shownTargetsDiffer,
  type DrawingItem,
  type DrawingObservation,
  type OccupiedSlot,
  type OccupiedSlots,
} from "@/lib/drawing-document";
import type { DimensionSlot } from "@/lib/spec-vocab";

const RECORD = "00000000-0000-4000-8000-000000000001";
const COM1 = "00000000-0000-4000-8000-0000000000c1";
const COM2 = "00000000-0000-4000-8000-0000000000c2";

function row(over: Partial<DrawingObservation>): DrawingObservation {
  return {
    id: "obs-1",
    version: 1,
    attrGroup: "dimension",
    labelRaw: "W",
    valueRaw: "900",
    materialCodeRaw: null,
    value: "900",
    unit: "mm",
    unitSuggested: false,
    dimensionSlot: "W",
    specFieldId: null,
    state: "confirmed",
    stateReason: null,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...over,
  };
}

const itemOf = (observations: DrawingObservation[]): DrawingItem => ({
  id: "item-1",
  version: 1,
  page: 1,
  itemCodeRaw: "ZZ-FUR-01",
  itemNameRaw: "Desk",
  confidence: "high",
  targets: null,
  observations,
});

function occupant(id: string, value: string): OccupiedSlot {
  return {
    attributeId: id,
    attributeVersion: 1,
    label: "Size",
    value,
    unit: "mm",
    state: "confirmed",
    materialCode: null,
    sourceFilename: "__QA bill.xlsx",
    sourcePage: null,
    fromBill: true,
  };
}

function occupied(dimensions: Partial<Record<DimensionSlot, OccupiedSlot>>, fields: Record<string, OccupiedSlot> = {}): OccupiedSlots {
  return {
    dimensions: new Map([[RECORD, new Map(Object.entries(dimensions) as [DimensionSlot, OccupiedSlot][])]]),
    fields: new Map([[RECORD, new Map(Object.entries(fields))]]),
  };
}

const resolution = { runs: [], suggested: [RECORD] };
const billW = "00000000-0000-4000-8000-0000000000b1";
const ticked = [{ recordId: RECORD, attributeId: billW, attributeVersion: 1 }];

describe("replaceTargetOf — what a replace tick on this row would retire", () => {
  it("is the slot of a dimension, the field of anything else, and nothing for a bare note", () => {
    expect(replaceTargetOf(row({}))).toEqual({ kind: "slot", slot: "W" });
    expect(replaceTargetOf(row({ attrGroup: "finish", dimensionSlot: null, specFieldId: COM1 }))).toEqual({
      kind: "field",
      fieldId: COM1,
    });
    expect(replaceTargetOf(row({ attrGroup: "note", dimensionSlot: null }))).toBeNull();
  });
});

describe("onRowRetargeted — the rule the autosave applies on every move", () => {
  it("drops the replace tick when the row becomes a note", () => {
    const before = row({ replaces: ticked });
    const after = { ...before, attrGroup: "note" as const, dimensionSlot: null };
    expect(onRowRetargeted(before, after)).toEqual({ replaces: [] });
  });

  it("drops it on a move to another slot", () => {
    const before = row({ replaces: ticked });
    expect(onRowRetargeted(before, { ...before, dimensionSlot: "D" })).toEqual({ replaces: [] });
  });

  it("drops it, and the BW standard, on a move from COM 1 to COM 2", () => {
    const before = row({
      attrGroup: "finish",
      dimensionSlot: null,
      specFieldId: COM1,
      replaces: ticked,
      standard: { state: "tbc", value: null, optionId: null },
    });
    expect(onRowRetargeted(before, { ...before, specFieldId: COM2 })).toEqual({ replaces: [], standard: null });
  });

  it("changes nothing when the target did not move", () => {
    const before = row({ replaces: ticked });
    const edited: DrawingObservation = { ...before, value: "910", unit: "cm", state: "tbc" };
    expect(onRowRetargeted(before, edited)).toEqual({});
  });

  it("a group change alone drops it too: the reviewer is asked again rather than trusted to mean the same", () => {
    const finish = row({ attrGroup: "finish", dimensionSlot: null, specFieldId: COM1, replaces: ticked });
    expect(onRowRetargeted(finish, { ...finish, attrGroup: "material" })).toEqual({ replaces: [] });
  });

  it("an empty tick list needs no clearing", () => {
    const before = row({});
    expect(onRowRetargeted(before, { ...before, dimensionSlot: "D" })).toEqual({});
  });
});

describe("a tick that no longer describes the row's target holds the card", () => {
  it("a note still carrying a tick for the bill's width is a blocker, named for what to do", () => {
    const stale = row({ attrGroup: "note", dimensionSlot: null, replaces: ticked });
    const blockers = drawingItemBlockers(itemOf([stale]), resolution, occupied({ W: occupant(billW, "900") }));
    expect(blockers.map((b) => b.code)).toEqual(["replace_stale"]);
    expect(blockers[0]!.message).toMatch(/no longer/);
  });

  it("a tick moved with the row onto an EMPTY slot is a blocker too", () => {
    const stale = row({ dimensionSlot: "D", replaces: ticked });
    const blockers = drawingItemBlockers(itemOf([stale]), resolution, occupied({ W: occupant(billW, "900") }));
    expect(blockers.map((b) => b.code)).toEqual(["replace_stale"]);
  });

  it("a tick on the slot it was ticked for is not", () => {
    const live = row({ value: "950", valueRaw: "950", replaces: ticked });
    expect(drawingItemBlockers(itemOf([live]), resolution, occupied({ W: occupant(billW, "900") }))).toEqual([]);
  });
});

describe("shownTargetsDiffer — the card's records against the live resolution", () => {
  it("is null when the two sets agree, in any order", () => {
    expect(shownTargetsDiffer(["b", "a"], ["a", "b"])).toBeNull();
  });

  it("names a record that appeared and one that went", () => {
    expect(shownTargetsDiffer(["a"], ["a", "b"])).toEqual({ appeared: ["b"], gone: [] });
    expect(shownTargetsDiffer(["a", "b"], ["a"])).toEqual({ appeared: [], gone: ["b"] });
  });
});
