// What the model reported as a PICTURE of an item, and whether it is usable.
//
// ============================================================================
// WHY THIS IS A MEASUREMENT AND NOT A FIX
//
// Reported on the real pack (FIU 6, item 1.9): *"the picture extract hasn't
// worked very well this time."* Max drew the box by hand. Two completely
// different failures look identical on that screen:
//
//   1. THE MODEL REPORTED NOTHING, so `ItemImagePicker` proposes the whole page
//      — which is the design, not a bug ("A page that reported no picture
//      proposes the page itself"), and the fix for it would be the PROMPT,
//      which costs a re-read of every document already read.
//   2. THE MODEL REPORTED A BOX AND THE CROP DREW THE WRONG ONE — coordinates
//      out of bounds, a box on another page, a box so small it renders as a
//      smear, or one covering the whole sheet. The fix for that is in
//      `pdf-crop.ts` or in the picker, and costs nothing.
//
// Deciding between them by looking at cards is how the dimension overhaul went
// wrong for months: every rule was tuned against one pack. So this counts, and
// `measure:drawings` prints it beside the dimension columns because it is the
// same pack.
//
// IT DECIDES NOTHING AND CHANGES NOTHING. No screen calls it, no route calls
// it; it is read by the measurement tool, and by its own test. That is also why
// it lives here rather than inside the tool: the tool needs a database and a
// rule nobody can test is a rule nobody can trust.
//
// IT READS STAGED JSON DEFENSIVELY. `assertStagedDrawings` casts rather than
// validates, so a `viewRegions` entry is whatever was written on the day it was
// staged — the shape has already changed once. A region this cannot read is
// counted as `unreadable`, which is a finding, rather than throwing inside a
// read-only report.
// ============================================================================
import type { DrawingItem } from "@/lib/drawing-document";

/**
 * What is wrong with one reported region.
 *
 * A region may carry several: a box on the wrong page can also be out of
 * bounds. They are counted, not ranked.
 */
export type RegionFault =
  /** The entry is not four numbers. Staged JSON from a shape that has changed. */
  | "unreadable"
  /** A coordinate outside [0, 1]. The model was asked for page fractions. */
  | "out_of_bounds"
  /** x1 <= x0 or y1 <= y0 — the box has no inside. */
  | "inverted"
  /** Smaller than the cropper's own 2% minimum in either direction. */
  | "degenerate"
  /** A page this item was not staged on. The crop would render a stranger. */
  | "other_page"
  /**
   * Covering essentially the whole sheet. NOT a fault in the crop — it renders
   * fine — but it is the same picture the no-region fallback already offers, so
   * counting it apart is what tells us whether the model is placing boxes or
   * merely agreeing that the page exists.
   */
  | "whole_page";

/** The minimum a crop can use, matching `PageCropper`'s own 2% floor. */
const MIN_SIDE = 0.02;
/** At or above this, a box is the page. */
const WHOLE_PAGE_COVERAGE = 0.95;

export type RegionReading = {
  viewType: string;
  page: number | null;
  bbox: [number, number, number, number] | null;
  /** How much of the page it covers, 0..1, or null where it cannot be read. */
  coverage: number | null;
  faults: RegionFault[];
  /** No fault that would make the crop draw the wrong thing. `whole_page` is not one. */
  usable: boolean;
};

export type ItemRegionReading = {
  reported: number;
  usable: number;
  /** Whether `pickItemView` had anything to choose and chose it. */
  proposed: boolean;
  /** The reading of the region the card will ACTUALLY crop, or null where there is none. */
  proposal: RegionReading | null;
  regions: RegionReading[];
};

function readBbox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const numbers = raw.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
  if (numbers.some((value) => value === null)) return null;
  return numbers as [number, number, number, number];
}

/** One reported region, read against the page the item is staged on. */
export function readRegion(raw: unknown, itemPage: number | null): RegionReading {
  const entry = (raw ?? {}) as { viewType?: unknown; page?: unknown; bbox?: unknown };
  const viewType = typeof entry.viewType === "string" && entry.viewType ? entry.viewType : "(none)";
  const page = typeof entry.page === "number" && Number.isFinite(entry.page) ? entry.page : null;
  const bbox = readBbox(entry.bbox);
  const faults: RegionFault[] = [];

  if (page !== null && itemPage !== null && page !== itemPage) faults.push("other_page");

  if (!bbox) {
    faults.push("unreadable");
    return { viewType, page, bbox: null, coverage: null, faults, usable: false };
  }

  const [x0, y0, x1, y1] = bbox;
  if ([x0, y0, x1, y1].some((value) => value < 0 || value > 1)) faults.push("out_of_bounds");
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) faults.push("inverted");
  else if (width < MIN_SIDE || height < MIN_SIDE) faults.push("degenerate");

  const coverage = width > 0 && height > 0 ? width * height : 0;
  if (coverage >= WHOLE_PAGE_COVERAGE) faults.push("whole_page");

  return {
    viewType,
    page,
    bbox,
    coverage,
    faults,
    // `whole_page` is a finding about the MODEL, not about the crop: the box
    // renders exactly what it says it does. Counting it as unusable would say
    // the picker is broken on the pages where it is behaving as designed.
    usable: faults.every((fault) => fault === "whole_page"),
  };
}

/**
 * Every region one staged item reported, and the one its card will crop.
 *
 * `imageProposal` is the one that matters: it is what `ItemImagePicker` renders
 * before anybody drags a box, so a fault there is a fault somebody SAW. A fault
 * on a region nobody selected is a fault nobody met.
 */
export function readViewRegions(
  item: Pick<DrawingItem, "page" | "viewRegions" | "imageProposal">,
): ItemRegionReading {
  const raw = Array.isArray(item.viewRegions) ? item.viewRegions : [];
  const regions = raw.map((entry) => readRegion(entry, item.page ?? null));
  const proposalRaw = item.imageProposal ?? null;
  return {
    reported: regions.length,
    usable: regions.filter((region) => region.usable).length,
    proposed: Boolean(proposalRaw),
    proposal: proposalRaw ? readRegion(proposalRaw, item.page ?? null) : null,
    regions,
  };
}

/** The columns `measure:drawings` prints. Every field is a count. */
export type RegionCounts = {
  /** Items whose run carried a `viewRegions` field at all (version 2 and later). */
  itemsWithRegions: number;
  itemsWithoutRegions: number;
  /** Items where the card falls back to offering the whole page. */
  itemsFallingBack: number;
  regions: number;
  regionsUsable: number;
  /** The one the card actually crops, where a proposal exists. */
  proposalsFaulty: number;
  faults: Record<RegionFault, number>;
  byViewType: Record<string, number>;
  /** Summed coverage of usable regions, for a mean the report can print. */
  coverageSum: number;
  coverageCount: number;
};

export function blankRegionCounts(): RegionCounts {
  return {
    itemsWithRegions: 0,
    itemsWithoutRegions: 0,
    itemsFallingBack: 0,
    regions: 0,
    regionsUsable: 0,
    proposalsFaulty: 0,
    faults: {
      unreadable: 0,
      out_of_bounds: 0,
      inverted: 0,
      degenerate: 0,
      other_page: 0,
      whole_page: 0,
    },
    byViewType: {},
    coverageSum: 0,
    coverageCount: 0,
  };
}

/** Count one item's reading into a running total. */
export function countRegions(counts: RegionCounts, reading: ItemRegionReading): void {
  if (reading.reported === 0) counts.itemsWithoutRegions += 1;
  else counts.itemsWithRegions += 1;
  // WHAT THE REVIEWER SEES. The card proposes the whole page when nothing was
  // picked, so this is the count that answers "how often did the picture have
  // to be drawn by hand".
  if (!reading.proposed) counts.itemsFallingBack += 1;

  for (const region of reading.regions) {
    counts.regions += 1;
    if (region.usable) counts.regionsUsable += 1;
    for (const fault of region.faults) counts.faults[fault] += 1;
    counts.byViewType[region.viewType] = (counts.byViewType[region.viewType] ?? 0) + 1;
    if (region.coverage !== null) {
      counts.coverageSum += region.coverage;
      counts.coverageCount += 1;
    }
  }

  if (reading.proposal && !reading.proposal.usable) counts.proposalsFaulty += 1;
}

export function addRegionCounts(into: RegionCounts, from: RegionCounts): void {
  into.itemsWithRegions += from.itemsWithRegions;
  into.itemsWithoutRegions += from.itemsWithoutRegions;
  into.itemsFallingBack += from.itemsFallingBack;
  into.regions += from.regions;
  into.regionsUsable += from.regionsUsable;
  into.proposalsFaulty += from.proposalsFaulty;
  into.coverageSum += from.coverageSum;
  into.coverageCount += from.coverageCount;
  for (const key of Object.keys(from.faults) as RegionFault[]) into.faults[key] += from.faults[key];
  for (const [type, n] of Object.entries(from.byViewType)) {
    into.byViewType[type] = (into.byViewType[type] ?? 0) + n;
  }
}
