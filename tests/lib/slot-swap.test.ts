// Pointing at a figure and giving it a slot — the pure half (brief F).
//
// The PATCH route plans every swap with `planSlotSwap` inside its locked write
// (the database tier holds that it writes what this plans, all or nothing);
// the cards build the request with `swapSlotRequest`. This file pins the
// plan: which rows a swap displaces, and how, in and out of a configuration's
// scope — plus the readings the card prints beside a figure.
import { describe, expect, it } from "vitest";
import {
  candidateRowFor,
  millimetreReading,
  planSlotSwap,
  readCandidateLine,
  swapSlotRequest,
} from "@/lib/slot-swap";
import {
  drawingItemBlockers,
  uncertainBlockers,
  uncertainNotices,
  type DrawingItem,
  type DrawingObservation,
  type NamedConfigurationPlan,
} from "@/lib/drawing-document";
import { stageItemV4 } from "@/lib/drawing-items";
import { DrawingsItemsOutput } from "@/lib/extraction-schema";

let counter = 0;
function row(over: Partial<DrawingObservation>): DrawingObservation {
  counter += 1;
  return {
    id: `obs-${counter}`,
    version: 1,
    attrGroup: "note",
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

function itemOf(observations: DrawingObservation[], over: Partial<DrawingItem> = {}): DrawingItem {
  return {
    id: "item-1",
    version: 1,
    page: 1,
    itemCodeRaw: "X-1",
    itemNameRaw: "Stool",
    confidence: "high",
    targets: null,
    observations,
    ...over,
  };
}

describe("planSlotSwap, on an item that names no configurations", () => {
  it("returns the row that held the slot to a note, and only that row", () => {
    const depth = row({ attrGroup: "dimension", dimensionSlot: "D", value: "640" });
    const width = row({ attrGroup: "dimension", dimensionSlot: "W", value: "2100" });
    const section = row({ labelRaw: "SECTION B", value: "880", isOverall: false });
    const plan = planSlotSwap(itemOf([width, depth, section]), section.id, "D", null);
    expect(plan).toEqual({ ok: true, displaced: [{ observationId: depth.id, to: "note" }] });
  });

  it("displaces BOTH where two rows already claim the slot — the blocker it ends", () => {
    const one = row({ attrGroup: "dimension", dimensionSlot: "W", value: "760" });
    const two = row({ attrGroup: "dimension", dimensionSlot: "W", value: "740" });
    const mover = row({ value: "750" });
    const plan = planSlotSwap(itemOf([one, two, mover]), mover.id, "W", null);
    expect(plan.ok && plan.displaced.map((entry) => entry.observationId)).toEqual([one.id, two.id]);
  });

  it("refuses a row that states no figure, in words", () => {
    const remark = row({ labelRaw: "REMARKS", value: "SUBMIT SAMPLES", valueRaw: "SUBMIT SAMPLES", unit: null });
    const plan = planSlotSwap(itemOf([remark]), remark.id, "W", null);
    expect(plan).toMatchObject({ ok: false, code: "not_a_figure", status: 400 });
  });

  it("ignores a row already applied or ignored", () => {
    const applied = row({ attrGroup: "dimension", dimensionSlot: "W", reviewStatus: "applied" });
    const mover = row({ value: "750" });
    expect(planSlotSwap(itemOf([applied, mover]), mover.id, "W", null)).toEqual({ ok: true, displaced: [] });
  });
});

describe("planSlotSwap, within a configuration's scope", () => {
  const plan = (rows: Record<string, string[]>): NamedConfigurationPlan => ({
    code: "X-1",
    configurations: [],
    labels: ["TYPE 1", "TYPE 2", "TYPE 3"],
    rows,
    undecided: [],
  });

  it("leaves a width that belongs to another configuration alone", () => {
    const type1 = row({ attrGroup: "dimension", dimensionSlot: "W", value: "550" });
    const mover = row({ value: "600" });
    const planned = planSlotSwap(itemOf([type1, mover]), mover.id, "W", plan({ [type1.id]: ["TYPE 1"], [mover.id]: ["TYPE 2"] }));
    expect(planned).toEqual({ ok: true, displaced: [] });
  });

  it("NARROWS a shared width off the mover's configuration, rather than taking it from the others", () => {
    const shared = row({ attrGroup: "dimension", dimensionSlot: "W", value: "550" });
    const mover = row({ value: "600" });
    const planned = planSlotSwap(
      itemOf([shared, mover]),
      mover.id,
      "W",
      plan({ [shared.id]: ["TYPE 1", "TYPE 2", "TYPE 3"], [mover.id]: ["TYPE 2"] }),
    );
    expect(planned).toEqual({ ok: true, displaced: [{ observationId: shared.id, to: "narrowed", configurations: ["TYPE 1", "TYPE 3"] }] });
  });

  it("returns a holder wholly inside the mover's scope to a note", () => {
    const type2 = row({ attrGroup: "dimension", dimensionSlot: "W", value: "550" });
    const mover = row({ value: "600" });
    const planned = planSlotSwap(itemOf([type2, mover]), mover.id, "W", plan({ [type2.id]: ["TYPE 2"], [mover.id]: ["TYPE 2", "TYPE 3"] }));
    expect(planned).toEqual({ ok: true, displaced: [{ observationId: type2.id, to: "note" }] });
  });
});

describe("swapSlotRequest", () => {
  it("names every pending row holding the slot, at its version — a superset the server narrows", () => {
    const held = row({ attrGroup: "dimension", dimensionSlot: "D", version: 4 });
    const other = row({ attrGroup: "dimension", dimensionSlot: "W" });
    const mover = row({ value: "880" });
    expect(swapSlotRequest(itemOf([held, other, mover]), mover, "D")).toEqual({
      swapSlot: { slot: "D", displaces: [{ id: held.id, version: 4 }] },
    });
  });
});

describe("a candidate, and the row it is", () => {
  it("reads the schema's one-line form apart", () => {
    expect(readCandidateLine({ valueRaw: "740 (SIDE ELEVATION, page 2)", view: null, page: null })).toEqual({
      figure: "740",
      view: "SIDE ELEVATION",
      page: 2,
    });
    expect(readCandidateLine({ valueRaw: `5'-6" (ELEVATION 2)`, view: null, page: null })).toEqual({
      figure: `5'-6"`,
      view: "ELEVATION 2",
      page: null,
    });
    expect(readCandidateLine({ valueRaw: "740", view: null, page: null })).toEqual({ figure: "740", view: null, page: null });
    // A structured candidate is taken as given.
    expect(readCandidateLine({ valueRaw: "740", view: "SIDE", page: 3 })).toEqual({ figure: "740", view: "SIDE", page: 3 });
  });

  it("is found by its link, and by figure, page and view where there is none", () => {
    const holder = row({ attrGroup: "dimension", dimensionSlot: "W", value: "760", page: 1 });
    const side = row({ labelRaw: "SIDE", value: "740", page: 2, view: "SIDE", isOverall: false });
    const other = row({ labelRaw: "FRONT", value: "740", page: 1, view: "FRONT", isOverall: false });
    const item = itemOf([holder, side, other]);
    expect(candidateRowFor(item, holder, { valueRaw: "740", unitRaw: null, view: null, page: null, observationId: side.id })?.id).toBe(side.id);
    expect(candidateRowFor(item, holder, { valueRaw: "740 (SIDE, page 2)", unitRaw: null, view: null, page: null })?.id).toBe(side.id);
    // Two rows state 740 and nothing tells them apart: no answer, not a pick.
    expect(candidateRowFor(item, { ...holder, page: null }, { valueRaw: "740", unitRaw: null, view: null, page: null })).toBeNull();
  });
});

describe("millimetreReading — Show in mm", () => {
  it("converts through the composer's own step, beside what was printed", () => {
    expect(millimetreReading(`5'-7"`, "in")).toEqual({ ok: true, text: `1702 mm (5'-7")` });
    expect(millimetreReading(`5'-7"`, null)).toEqual({ ok: true, text: `1702 mm (5'-7")` });
    expect(millimetreReading("84", "cm")).toEqual({ ok: true, text: "840 mm (84 cm)" });
    expect(millimetreReading("67", "in")).toEqual({ ok: true, text: "1702 mm (67 in)" });
    expect(millimetreReading("760", "mm")).toEqual({ ok: true, text: "760 mm" });
  });

  it("says why it cannot, in the words of the composer's bracket", () => {
    expect(millimetreReading(`5'-7"`, "cm")).toEqual({ ok: false, text: "feet and inches, recorded as cm" });
    expect(millimetreReading("640", null)).toEqual({ ok: false, text: "no unit" });
    expect(millimetreReading(`8'-6" eq`, "in")).toEqual({ ok: false, text: "imperial, not converted" });
    expect(millimetreReading("approx 720-740", "mm")).toEqual({ ok: false, text: "not a number" });
    expect(millimetreReading("TBC", "mm")).toEqual({ ok: false, text: "TBC — no figure to convert" });
  });
});

describe("a doubt about an overall slot holds the card", () => {
  const doubtful = (over: Partial<DrawingItem> = {}) =>
    itemOf([row({ attrGroup: "dimension", dimensionSlot: "W", value: "760" })], {
      uncertain: [
        { about: "width", why: "The plan prints 760 and ELEVATION 2 prints 740." },
        { about: "grouping", why: "Page 3 may be another stool." },
        { about: "seatHeight", why: "" },
      ],
      ...over,
    });

  it("blocks on the slot doubt only — a doubt about grouping is a notice, an empty one nothing", () => {
    const blockers = uncertainBlockers(doubtful());
    expect(blockers).toEqual([
      {
        code: "uncertain_unchecked",
        index: 0,
        message: expect.stringMatching(/^The read was unsure of the width: The plan prints 760 .* press Checked on the notice\.$/),
      },
    ]);
    expect(uncertainNotices(doubtful()).map((notice) => [notice.index, notice.slot, notice.settled])).toEqual([
      [0, "W", null],
      [1, null, null],
    ]);
  });

  it("is settled by Checked, or by touching the slot", () => {
    expect(uncertainBlockers(doubtful({ uncertainChecked: [0] }))).toEqual([]);
    expect(uncertainBlockers(doubtful({ slotsTouched: ["W"] }))).toEqual([]);
    expect(uncertainBlockers(doubtful({ slotsTouched: ["D"] }))).toHaveLength(1);
  });

  it("reaches the blockers the confirm reads", () => {
    const item = doubtful();
    const codes = drawingItemBlockers(item, { runs: [], suggested: [] }, { fields: new Map(), dimensions: new Map() }).map(
      (blocker) => blocker.code,
    );
    expect(codes).toContain("uncertain_unchecked");
  });
});

describe("staging a specification sheet's statements", () => {
  it("marks a LABELLED line a statement, and leaves an unlabelled remark a note", () => {
    const raw = DrawingsItemsOutput.parse({
      documentNotes: null,
      nonItemPages: [],
      items: [
        {
          codes: ["X-1"],
          name: "Stool",
          pages: [1],
          statements: [
            { label: "FILLING", value: "Feathers", page: 1, configurations: [] },
            { label: "", value: "REMARKS: SUBMIT SAMPLES.", page: 1, configurations: [] },
          ],
        },
      ],
    });
    const staged = stageItemV4(raw.items[0]!, [], null);
    const filling = staged.observations.find((o) => o.labelRaw === "FILLING")!;
    expect(filling.statement).toBe(true);
    const remark = staged.observations.find((o) => o.value?.includes("SUBMIT SAMPLES"))!;
    expect(remark.statement).toBeUndefined();
  });
});
