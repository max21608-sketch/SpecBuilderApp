// A drawing's values over the bill's — the pure half (brief G).
//
// `billReplacements` decides what the card's one press acknowledges; the
// blockers decide whether the card can then confirm. This pins the two
// together: the press clears exactly the bill's slot clashes and the
// diameter's `dia_conflict`, and never touches a value a person typed or
// another drawing gave. Synthetic throughout.
import { describe, expect, it } from "vitest";
import {
  billReplacements,
  describeBillReplacements,
  withBillAcknowledgements,
} from "@/lib/bill-over-drawing";
import {
  acknowledgedReplacements,
  acknowledgedSquareRetirements,
  drawingItemBlockers,
  type DrawingItem,
  type DrawingObservation,
  type OccupiedSlot,
  type OccupiedSlots,
} from "@/lib/drawing-document";
import type { DimensionSlot } from "@/lib/spec-vocab";

const RECORD = "00000000-0000-4000-8000-000000000001";
const METAL = "00000000-0000-4000-8000-0000000000aa";

let counter = 0;
function row(over: Partial<DrawingObservation>): DrawingObservation {
  counter += 1;
  return {
    id: `obs-${counter}`,
    version: 1,
    attrGroup: "dimension",
    labelRaw: "FIGURE",
    valueRaw: "100",
    materialCodeRaw: null,
    value: "100",
    unit: "mm",
    unitSuggested: false,
    dimensionSlot: null,
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
  itemNameRaw: "Stool",
  confidence: "high",
  targets: null,
  observations,
});

function occupant(id: string, value: string, unit: string | null, over: Partial<OccupiedSlot> = {}): OccupiedSlot {
  return {
    attributeId: id,
    attributeVersion: 1,
    label: "Size",
    value,
    unit,
    state: "confirmed",
    materialCode: null,
    sourceFilename: "__QA pricing.xlsx",
    sourcePage: null,
    fromBill: true,
    ...over,
  };
}

function occupied(dimensions: Partial<Record<DimensionSlot, OccupiedSlot>>, fields: Record<string, OccupiedSlot> = {}): OccupiedSlots {
  return {
    dimensions: new Map([[RECORD, new Map(Object.entries(dimensions) as [DimensionSlot, OccupiedSlot][])]]),
    fields: new Map([[RECORD, new Map(Object.entries(fields))]]),
  };
}

const resolution = { runs: [], suggested: [RECORD] };
const codes = (item: DrawingItem, slots: OccupiedSlots) => drawingItemBlockers(item, resolution, slots).map((b) => b.code);

/** What the card's press sends, applied to the staged rows. */
function press(item: DrawingItem, slots: OccupiedSlots): DrawingItem {
  const entries = billReplacements(item, [RECORD], slots);
  return {
    ...item,
    observations: item.observations.map((observation) => {
      const mine = entries.filter((entry) => entry.observationId === observation.id);
      return mine.length ? { ...observation, replaces: withBillAcknowledgements(observation, mine, true) } : observation;
    }),
  };
}

describe("the stool: a bill D and H, a drawing Dia and H, a bill metal finish", () => {
  const dia = row({ dimensionSlot: "DIA", value: `1'-6"`, valueRaw: `1'-6"`, unit: "in" });
  const height = row({ dimensionSlot: "H", value: `1'-4 3/4"`, valueRaw: `1'-4 3/4"`, unit: "in" });
  const metal = row({
    attrGroup: "finish",
    labelRaw: "METAL",
    value: "Example bronze",
    valueRaw: "Example bronze",
    materialCodeRaw: "GR MTL 01",
    unit: null,
    specFieldId: METAL,
  });
  const item = itemOf([dia, height, metal]);
  const slots = occupied(
    { D: occupant("att-d", "460", "mm"), H: occupant("att-h", "450", "mm") },
    { [METAL]: occupant("att-m", "MTL-01", null, { label: "Finish", materialCode: "MTL-01" }) },
  );

  it("is held today by the dia conflict and a tick per row", () => {
    expect(codes(item, slots).sort()).toEqual(["dia_conflict", "dimension_slot_taken", "slot_taken"]);
  });

  it("lists every value of the bill's the press would replace, before the press", () => {
    const entries = billReplacements(item, [RECORD], slots);
    expect(entries.map((entry) => [entry.observationId, entry.kind, entry.occupant.attributeId])).toEqual([
      [dia.id, "retire_square", "att-d"],
      [height.id, "replace", "att-h"],
      [metal.id, "replace", "att-m"],
    ]);
    expect(entries.every((entry) => !entry.acknowledged)).toBe(true);
    const lines = describeBillReplacements(item, entries, (id) => (id === METAL ? "Main metal finish" : null));
    expect(lines.map((line) => line.text)).toEqual([
      `D 460mm → Dia 1'-6"`,
      `H 450mm → 1'-4 3/4"`,
      "Main metal finish MTL-01 → GR MTL 01",
    ]);
  });

  it("the press clears every one of those blockers, and records each at the version shown", () => {
    const after = press(item, slots);
    expect(codes(after, slots)).toEqual([]);
    const [d, h, m] = after.observations;
    expect(acknowledgedSquareRetirements(d!).get(RECORD)?.get("D")).toEqual({ attributeId: "att-d", attributeVersion: 1 });
    // A retirement is not the row's OWN replacement.
    expect(acknowledgedReplacements(d!).size).toBe(0);
    expect(acknowledgedReplacements(h!).get(RECORD)).toEqual({ attributeId: "att-h", attributeVersion: 1 });
    expect(acknowledgedReplacements(m!).get(RECORD)).toEqual({ attributeId: "att-m", attributeVersion: 1 });
    // And it reads as done: nothing left for the press to do.
    expect(billReplacements(after, [RECORD], slots).every((entry) => entry.acknowledged)).toBe(true);
  });

  it("an acknowledgement at a version since moved reads as not done, so the press can refresh it", () => {
    const after = press(item, slots);
    const moved = occupied(
      { D: occupant("att-d", "460", "mm", { attributeVersion: 2 }), H: occupant("att-h", "450", "mm") },
      { [METAL]: occupant("att-m", "MTL-01", null, { label: "Finish", materialCode: "MTL-01" }) },
    );
    const entries = billReplacements(after, [RECORD], moved);
    expect(entries.filter((entry) => !entry.acknowledged).map((entry) => entry.occupant.attributeId)).toEqual(["att-d"]);
  });

  it("clearing puts the bill's values back and keeps any other tick on the row", () => {
    const other = "00000000-0000-4000-8000-000000000002";
    const after = press(item, slots);
    const h = after.observations[1]!;
    const withOther = { ...h, replaces: [...(h.replaces ?? []), { recordId: other, attributeId: "att-x", attributeVersion: 3 }] };
    const entries = billReplacements(itemOf([withOther]), [RECORD], slots);
    expect(withBillAcknowledgements(withOther, entries, false)).toEqual([
      { recordId: other, attributeId: "att-x", attributeVersion: 3 },
    ]);
  });
});

describe("never a person's value, never another drawing's", () => {
  it("leaves a typed or drawn occupant to its own tick, and the dia conflict standing", () => {
    const dia = row({ dimensionSlot: "DIA", value: "460" });
    const seat = row({ dimensionSlot: "SH", value: "420" });
    const slots = occupied({
      W: occupant("att-w", "460", "mm", { fromBill: false, sourceFilename: "__QA other drawing.pdf", sourcePage: 2 }),
      SH: occupant("att-sh", "400", "mm", { fromBill: false, sourceFilename: null }),
    });
    const item = itemOf([dia, seat]);
    expect(billReplacements(item, [RECORD], slots)).toEqual([]);
    expect(codes(press(item, slots), slots).sort()).toEqual(["dia_conflict", "dimension_slot_taken"]);
  });

  it("an occupant whose provenance is unknown is not the bill's", () => {
    const height = row({ dimensionSlot: "H", value: "720" });
    const slots = occupied({ H: occupant("att-h", "700", "mm", { fromBill: undefined }) });
    expect(billReplacements(itemOf([height]), [RECORD], slots)).toEqual([]);
  });

  it("the same figure already recorded is not a replacement", () => {
    const height = row({ dimensionSlot: "H", value: "45", unit: "cm" });
    const slots = occupied({ H: occupant("att-h", "450", "mm") });
    expect(billReplacements(itemOf([height]), [RECORD], slots)).toEqual([]);
  });

  it("a retirement left on a row since moved off the diameter retires nothing", () => {
    const moved = row({
      dimensionSlot: "H",
      value: "450",
      replaces: [{ recordId: RECORD, attributeId: "att-d", attributeVersion: 1, retiresSlot: "D" }],
    });
    expect(acknowledgedSquareRetirements(moved).size).toBe(0);
  });
});
