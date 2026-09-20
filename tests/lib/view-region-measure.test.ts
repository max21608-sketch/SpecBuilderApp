// Pure tier. The reading behind `measure:drawings`' view-region columns.
//
// The tool itself needs a database, so the rule it counts by lives here and is
// tested here: item 1.9 turns on telling two failures apart that look identical
// on a card — the model reporting NOTHING (the whole-page fallback, which is
// the design) and the model reporting a box the crop then draws wrong. A
// measurement that could not tell those apart would send the fix to the wrong
// place, and the wrong place costs a re-read of every document already read.
//
// Fixtures are invented boxes on an invented page. No client document is in
// this repo.
import { describe, expect, it } from "vitest";
import {
  addRegionCounts,
  blankRegionCounts,
  countRegions,
  readRegion,
  readViewRegions,
} from "@/lib/view-region-measure";

const region = (bbox: unknown, over: Record<string, unknown> = {}) => ({
  viewType: "3d",
  page: 5,
  bbox,
  ...over,
});

describe("reading one reported region", () => {
  it("accepts a box inside the page and calls it usable", () => {
    const read = readRegion(region([0.1, 0.1, 0.6, 0.5]), 5);
    expect(read.faults).toEqual([]);
    expect(read.usable).toBe(true);
    expect(read.coverage).toBeCloseTo(0.2, 6);
  });

  it("flags a coordinate outside the page", () => {
    // The model is asked for PAGE FRACTIONS. A figure above 1 is either points
    // or pixels, and the crop would silently clamp it to the page edge.
    expect(readRegion(region([0.1, 0.1, 1.4, 0.5]), 5).faults).toContain("out_of_bounds");
  });

  it("flags a box with no inside", () => {
    const read = readRegion(region([0.6, 0.1, 0.2, 0.5]), 5);
    expect(read.faults).toContain("inverted");
    expect(read.usable).toBe(false);
  });

  it("flags a box below the cropper's own 2% floor", () => {
    // `PageCropper` refuses a hand-drawn box this small because it is a smear
    // somebody would have to notice and undo. A reported one is the same thing.
    expect(readRegion(region([0.4, 0.4, 0.41, 0.9]), 5).faults).toContain("degenerate");
  });

  it("flags a box on a page this item is not on", () => {
    // The crop would render a stranger, which on a shop drawing set is another
    // item's sheet — the failure nobody would spot from the picture alone.
    expect(readRegion(region([0.1, 0.1, 0.6, 0.5], { page: 7 }), 5).faults).toContain("other_page");
  });

  it("counts a whole-page box apart, and still calls it usable", () => {
    // It renders exactly what it says. It is counted separately because it is
    // the same picture the no-region fallback already offers, so it says
    // nothing about whether the model placed a box.
    const read = readRegion(region([0, 0, 1, 1]), 5);
    expect(read.faults).toEqual(["whole_page"]);
    expect(read.usable).toBe(true);
  });

  it("reads staged rubbish as a finding rather than throwing", () => {
    // `assertStagedDrawings` casts rather than validates and this shape has
    // already changed once, so a read-only report must survive the past.
    expect(readRegion(region("0,0,1,1"), 5).faults).toEqual(["unreadable"]);
    expect(readRegion(region([0.1, 0.1, 0.6]), 5).faults).toEqual(["unreadable"]);
    expect(readRegion(region([0.1, 0.1, 0.6, Number.NaN]), 5).faults).toEqual(["unreadable"]);
    expect(readRegion(undefined, 5).faults).toEqual(["unreadable"]);
  });

  it("says nothing about the page when the item has none", () => {
    // A version 1 run stages no page. "Different from nothing" is not a fault.
    expect(readRegion(region([0.1, 0.1, 0.6, 0.5], { page: 7 }), null).faults).toEqual([]);
  });
});

describe("reading one item's regions", () => {
  it("separates what was reported from what the card will actually crop", () => {
    const reading = readViewRegions({
      page: 5,
      viewRegions: [
        { viewType: "3d", page: 5, bbox: [0.1, 0.1, 0.6, 0.5] },
        { viewType: "front", page: 5, bbox: [0.7, 0.1, 0.9, 0.5] },
      ],
      imageProposal: { viewType: "3d", page: 5, bbox: [0.1, 0.1, 0.6, 0.5] },
    });
    expect(reading.reported).toBe(2);
    expect(reading.usable).toBe(2);
    expect(reading.proposed).toBe(true);
    expect(reading.proposal?.usable).toBe(true);
  });

  it("reports an item that reported nothing, which is the fallback case", () => {
    const reading = readViewRegions({ page: 5, viewRegions: [], imageProposal: null });
    expect(reading.reported).toBe(0);
    expect(reading.proposed).toBe(false);
    expect(reading.proposal).toBeNull();
  });

  it("reads a run staged before pictures existed without inventing any", () => {
    // `viewRegions` is optional on `DrawingItem` precisely so a version 1 run
    // keeps reading. Absent means "never asked", not "none found".
    const reading = readViewRegions({ page: 5 });
    expect(reading.reported).toBe(0);
    expect(reading.proposed).toBe(false);
  });
});

describe("counting across items", () => {
  it("counts the fallback, the faults and the view types, and sums", () => {
    const counts = blankRegionCounts();
    countRegions(
      counts,
      readViewRegions({
        page: 5,
        viewRegions: [
          { viewType: "3d", page: 5, bbox: [0.1, 0.1, 0.6, 0.5] },
          { viewType: "front", page: 9, bbox: [0.1, 0.1, 0.6, 0.5] },
        ],
        imageProposal: { viewType: "front", page: 9, bbox: [0.1, 0.1, 0.6, 0.5] },
      }),
    );
    countRegions(counts, readViewRegions({ page: 6, viewRegions: [], imageProposal: null }));

    expect(counts.itemsWithRegions).toBe(1);
    expect(counts.itemsWithoutRegions).toBe(1);
    // BOTH items needed a hand-drawn box or the whole page: one reported
    // nothing, and the other's proposal is on the wrong page.
    expect(counts.itemsFallingBack).toBe(1);
    expect(counts.proposalsFaulty).toBe(1);
    expect(counts.regions).toBe(2);
    expect(counts.regionsUsable).toBe(1);
    expect(counts.faults.other_page).toBe(1);
    expect(counts.byViewType).toEqual({ "3d": 1, front: 1 });

    const total = blankRegionCounts();
    addRegionCounts(total, counts);
    addRegionCounts(total, counts);
    expect(total.regions).toBe(4);
    expect(total.faults.other_page).toBe(2);
    expect(total.byViewType).toEqual({ "3d": 2, front: 2 });
  });
});
