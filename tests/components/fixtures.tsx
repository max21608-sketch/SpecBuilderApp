// Builders for the drawings-review component tier.
//
// The shapes here reproduce the AP364 seating set's STRUCTURE -- pages that
// label their figures by view, one code drawn on several pages, fabric
// callouts carrying a client material code -- with invented codes and
// materials. No client document content is in this repo.
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import type { ItemResolution, RecordChoice, SpecField } from "@/components/imports/DrawingItemCard";

export const specFields: SpecField[] = [
  { id: "field-com1", json_id: 21, name: "COM 1", field_category: "Upholstery" },
  { id: "field-timber", json_id: 7, name: "Main timber finish", field_category: "Timber" },
];

export const records: RecordChoice[] = [
  { id: "rec-main", label: "AP364c-011", itemDescription: "Armchair", runName: "MAIN RUN" },
  { id: "rec-ve", label: "AP364c-025", itemDescription: "Armchair", runName: "MAIN RUN - VE" },
];

let counter = 0;
/** Ids that are stable within a test and unique across one. */
export function resetIds() {
  counter = 0;
}

export function observation(over: Partial<DrawingObservation> = {}): DrawingObservation {
  counter += 1;
  return {
    id: `obs-${counter}`,
    version: 1,
    attrGroup: "note",
    labelRaw: "FRONT",
    valueRaw: "640",
    materialCodeRaw: null,
    value: "640",
    unit: null,
    unitSuggested: false,
    dimensionSlot: null,
    slotSuggested: false,
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

/** A figure drawn on a named view, exactly as a shop drawing stages one. */
export function figure(labelRaw: string, value: string, over: Partial<DrawingObservation> = {}) {
  return observation({ labelRaw, value, valueRaw: value, ...over });
}

/** A fabric or timber callout: a value, a client code, no figure. */
export function callout(labelRaw: string, value: string | null, materialCodeRaw: string | null, over: Partial<DrawingObservation> = {}) {
  return observation({
    labelRaw,
    value,
    valueRaw: value,
    materialCodeRaw,
    attrGroup: "finish",
    state: value === null ? "tbc" : "confirmed",
    ...over,
  });
}

export function item(over: Partial<DrawingItem> = {}): DrawingItem {
  return {
    id: "item-1",
    version: 1,
    page: 5,
    itemCodeRaw: "S-201",
    itemNameRaw: "ARMCHAIR",
    confidence: "high",
    targets: null,
    observations: [],
    ...over,
  };
}

export function resolution(over: Partial<ItemResolution> = {}): ItemResolution {
  return {
    id: "item-1",
    resolution: {
      runs: [
        { runId: "run-main", runName: "MAIN RUN", status: "matched", record: records[0]! },
        { runId: "run-ve", runName: "MAIN RUN - VE", status: "matched", record: records[1]! },
      ],
      suggested: ["rec-main", "rec-ve"],
    },
    targets: ["rec-main", "rec-ve"],
    variantLabel: null,
    writesTo: {},
    blockers: [],
    occupants: {},
    warnings: [],
    ...over,
  };
}

/** Every callback a card takes, each a spy that records what it was asked. */
export function callbacks() {
  const calls: { name: string; args: unknown[] }[] = [];
  const spy = (name: string) => async (...args: unknown[]) => {
    calls.push({ name, args });
  };
  return {
    calls,
    of: (name: string) => calls.filter((call) => call.name === name),
    onSaveObservation: spy("onSaveObservation") as never,
    onSaveObservations: spy("onSaveObservations") as never,
    onSaveTargets: spy("onSaveTargets") as never,
    onSetBulkUnit: spy("onSetBulkUnit") as never,
    onReview: spy("onReview") as never,
    onReviewMany: spy("onReviewMany") as never,
    onImage: (() => undefined) as never,
    onSwatch: (() => undefined) as never,
  };
}
