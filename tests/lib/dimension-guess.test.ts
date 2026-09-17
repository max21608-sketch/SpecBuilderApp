import { describe, expect, it } from "vitest";
import { guessSlotsFromViews, hasASeat, viewFamily, type MeasuredRow } from "@/lib/dimension-guess";

/** The rows as the real pack stages them: the view label, and a bare figure. */
const rows = (pairs: [string | null, string][]): MeasuredRow[] =>
  pairs.map(([labelRaw, value], index) => ({ id: `obs-${index}`, labelRaw, value }));

const slotOf = (result: ReturnType<typeof guessSlotsFromViews>, rowsIn: MeasuredRow[], slot: string) => {
  const guess = result.guesses.find((entry) => entry.slot === slot);
  return guess ? rowsIn.find((row) => row.id === guess.observationId)?.value : undefined;
};

describe("viewFamily", () => {
  it("groups the back with the front, and the section with the side", () => {
    // A back elevation states the same width and height as the front, which is
    // what makes it evidence. A section is a cut through the side.
    expect(viewFamily("FRONT")).toBe("front");
    expect(viewFamily("BACK")).toBe("front");
    expect(viewFamily("SIDE")).toBe("side");
    expect(viewFamily("SIDE SECTION")).toBe("side");
    expect(viewFamily("TOP")).toBe("plan");
    expect(viewFamily("Dimension 3")).toBe("unknown");
    expect(viewFamily(null)).toBe("unknown");
  });

  it("matches whole words, so LEGEND is not a side elevation", () => {
    // `end` and `face` are keywords, and a substring test put LEGEND on the
    // side and SURFACE on the front. A mis-sorted label is worse than an
    // unknown one: the guess reads agreement ACROSS families as its evidence,
    // so it invents a view that agrees with nothing.
    expect(viewFamily("LEGEND")).toBe("unknown");
    expect(viewFamily("SURFACE")).toBe("unknown");
    expect(viewFamily("END VIEW")).toBe("side");
    expect(viewFamily("SIDE-SECTION")).toBe("side");
    expect(viewFamily("BIRD'S EYE")).toBe("plan");
  });
});

// ============================================================================
// A CONFIRMED FIGURE STILL HAS TO BE AT THE PAGE'S SCALE.
//
// Two views stating the same figure is strong evidence the figure is real. It
// is NOT evidence that it is an OVERALL dimension: a drawing prints its gaps
// and reveals on every view too.
// ============================================================================
describe("guessSlotsFromViews — the real S-201 armchair page", () => {
  // Every figure below is the real staged output of the AP364 seating set, as
  // read on 2026-09-16. Its plan view shares exactly one figure with its side
  // elevation, and that figure is a 42mm reveal.
  const s201 = rows([
    ["FRONT", "660"], ["FRONT", "640"], ["FRONT", "680"], ["FRONT", "570"], ["FRONT", "160"],
    ["FRONT", "465"], ["FRONT", "170"], ["FRONT", "135"], ["FRONT", "80"], ["FRONT", "55"],
    ["FRONT", "5"], ["FRONT", "27"], ["FRONT", "42"], ["FRONT", "556"],
    ["BACK", "660"], ["BACK", "640"], ["BACK", "27"], ["BACK", "42"], ["BACK", "556"],
    ["SIDE", "685"], ["SIDE", "680"], ["SIDE", "570"], ["SIDE", "80"], ["SIDE", "55"],
    ["SIDE", "5"], ["SIDE", "15"], ["SIDE", "50"], ["SIDE", "445"], ["SIDE", "27"], ["SIDE", "42"],
    ["TOP", "640"], ["TOP", "556"], ["TOP", "42"], ["TOP", "740"], ["TOP", "535"], ["TOP", "505"],
  ]);

  it("refuses a 42mm reveal as the depth of a 680mm chair", () => {
    // The plan and the side elevation have exactly one figure in common, 42.
    // Taken as the depth it is both wrong and self-sealing: 42 and 680 cannot
    // be in the same unit, so the whole placed set then failed `suggestUnit`
    // and the card carried four `unit_missing` blockers and could not commit.
    const result = guessSlotsFromViews(s201, "ARMCHAIR");
    expect(slotOf(result, s201, "D")).toBe("685");
  });

  it("reads a set that shares one scale, so the unit can still be derived", () => {
    const result = guessSlotsFromViews(s201, "ARMCHAIR");
    const placed = ["W", "D", "H", "SH"].map((slot) => Number(slotOf(result, s201, slot)));
    expect(placed).toEqual([640, 685, 680, 445]);
    expect(placed.every((figure) => figure >= 300)).toBe(true);
  });

  it("says the seat height came from one view only", () => {
    // S-201 prints 445 on the side elevation alone; the elevations share
    // nothing in the seat window.
    const result = guessSlotsFromViews(s201, "ARMCHAIR");
    expect(result.dispute).toMatch(/seat height/i);
  });
});

// Every figure below is the real staged output of the AP364 seating set.
describe("guessSlotsFromViews — the real S-200 armchair page", () => {
  const s200 = rows([
    ["FRONT", "110"], ["FRONT", "100"], ["FRONT", "460"], ["FRONT", "125"], ["FRONT", "240"],
    ["FRONT", "420"], ["FRONT", "520"], ["FRONT", "720"], ["FRONT", "50"], ["FRONT", "5"],
    ["FRONT", "840"],
    ["SIDE", "650"], ["SIDE", "790"],
    ["BACK", "520"], ["BACK", "840"],
    ["TOP", "540"], ["TOP", "790"], ["TOP", "840"],
    ["SIDE SECTION", "540"], ["SIDE SECTION", "720"], ["SIDE SECTION", "300"],
    ["SIDE SECTION", "460"], ["SIDE SECTION", "650"], ["SIDE SECTION", "790"],
  ]);

  it("reads W840 x D790 x H720 x SH460 off twenty-four unplaceable figures", () => {
    const out = guessSlotsFromViews(s200);
    expect(out.dispute).toBeNull();
    expect(slotOf(out, s200, "W")).toBe("840"); // front, back AND plan
    expect(slotOf(out, s200, "D")).toBe("790"); // side, section AND plan
    expect(slotOf(out, s200, "H")).toBe("720"); // front and section, never plan
    expect(slotOf(out, s200, "SH")).toBe("460");
  });

  it("says which views carried each one, in the page's own terms", () => {
    const out = guessSlotsFromViews(s200);
    expect(out.guesses.find((g) => g.slot === "W")?.why).toContain("plan");
  });

  it("ignores the twenty component figures entirely", () => {
    // 110, 125, 240, 420, 50, 5, 300 are parts of the chair, not its size.
    const out = guessSlotsFromViews(s200);
    expect(out.guesses).toHaveLength(4);
  });
});

describe("guessSlotsFromViews — a page with no plan", () => {
  // S-201: front, back and side only. Height is what the two elevations share.
  const s201 = rows([
    ["FRONT", "660"], ["FRONT", "640"], ["FRONT", "680"], ["FRONT", "570"], ["FRONT", "465"],
    ["BACK", "660"], ["BACK", "640"],
    ["SIDE", "685"], ["SIDE", "680"], ["SIDE", "570"], ["SIDE", "445"],
  ]);

  it("still places all three from the elevations alone", () => {
    const out = guessSlotsFromViews(s201);
    expect(out.dispute).toBeNull();
    expect(slotOf(out, s201, "H")).toBe("680"); // the only large shared figure
    expect(slotOf(out, s201, "W")).toBe("660");
    expect(slotOf(out, s201, "D")).toBe("685");
  });
});

// Asked for by Max on 2026-09-16: guess even when unsure, and flag it, because
// an empty Dimensions question helps nobody and a wrong one he can see does.
describe("guessSlotsFromViews — the weak path", () => {
  const s100 = rows([
    ["Dimension 1", "190"], ["Dimension 2", "72"], ["Dimension 3", "79"], ["Dimension 4", "72"],
    ["Dimension 5", "52"], ["Dimension 6", "44"], ["Dimension 7", "10"], ["Dimension 8", "79"],
  ]);

  it("still fills all four on a page that labels no view at all", () => {
    // The real S-100 sofa sheet: eight bare figures, no view anywhere. The
    // three largest read as W >= D >= H, which for this sofa is right.
    const out = guessSlotsFromViews(s100);
    expect(slotOf(out, s100, "W")).toBe("190");
    expect(slotOf(out, s100, "D")).toBe("79");
    expect(slotOf(out, s100, "H")).toBe("72");
    expect(slotOf(out, s100, "SH")).toBe("44");
  });

  it("says the ordering is an assumption and not something the page states", () => {
    expect(guessSlotsFromViews(s100).dispute).toContain("assumption about the item");
  });

  it("falls back the same way when the views share nothing", () => {
    const out = guessSlotsFromViews(
      rows([["FRONT", "840"], ["FRONT", "300"], ["SIDE", "790"]]),
    );
    expect(out.guesses).toHaveLength(3);
    expect(out.dispute).toContain("front 840");
  });

  it("uses the plan's width where the plan and the front disagree, and says which", () => {
    // Both readings are defensible; a plan states width and depth together, so
    // that one wins — and the reviewer is told the front said otherwise.
    const page = rows([
      ["FRONT", "840"], ["FRONT", "800"], ["FRONT", "720"],
      ["SIDE", "720"], ["SIDE", "790"],
      ["TOP", "800"], ["TOP", "790"],
    ]);
    const out = guessSlotsFromViews(page);
    expect(slotOf(out, page, "W")).toBe("800");
    expect(out.dispute).toContain("both should be the width");
  });

  it("fills nothing below three figures, and still says why", () => {
    // Two figures could be W x H, W x D or Dia x H with nothing to choose
    // between them. A third slot invented from two numbers is not a guess a
    // reviewer could check — it is one they would have to undo.
    const out = guessSlotsFromViews(rows([["Dimension 1", "440"], ["Dimension 2", "700"]]));
    expect(out.guesses).toEqual([]);
    expect(out.dispute).toContain("labels none of its figures");
  });

  it("stays silent on a single figure", () => {
    expect(guessSlotsFromViews(rows([["Dimension 1", "440"]])).guesses).toEqual([]);
  });

  it("leaves the seat height out rather than inventing a proportion", () => {
    // 620 of 680 is 91% of the height: a back rail, not a seat.
    const out = guessSlotsFromViews(
      rows([["FRONT", "660"], ["FRONT", "680"], ["FRONT", "620"], ["SIDE", "680"], ["SIDE", "620"], ["SIDE", "685"]]),
    );
    expect(out.guesses.some((g) => g.slot === "SH")).toBe(false);
  });
});

// Asked for on 2026-09-16 looking at the real S-201: an armchair with no seat
// height. Its 465 is on the front elevation ALONE, and the original rule only
// accepted a figure both elevations stated — so it came back silent on an item
// that certainly has a seat.
describe("the seat height, and items that must have one", () => {
  it("knows from the page's own name for the item", () => {
    expect(hasASeat("ARMCHAIR")).toBe(true);
    expect(hasASeat("SOFA, 2 seater")).toBe(true);
    expect(hasASeat("Bed bench")).toBe(true);
    expect(hasASeat("Desk chair")).toBe(true);
    expect(hasASeat("MUR 1 HEADBOARD")).toBe(false);
    expect(hasASeat("Ottoman")).toBe(true);
    expect(hasASeat(null)).toBe(false);
  });

  it("prefers a figure both elevations state", () => {
    // S-200's 460 is on the front AND the section: strong evidence.
    const page = rows([
      ["FRONT", "840"], ["FRONT", "720"], ["FRONT", "460"], ["FRONT", "420"],
      ["SIDE", "790"], ["SIDE SECTION", "720"], ["SIDE SECTION", "460"],
      ["TOP", "840"], ["TOP", "790"],
    ]);
    const out = guessSlotsFromViews(page, "ARMCHAIR");
    expect(slotOf(out, page, "SH")).toBe("460");
    expect(out.guesses.find((g) => g.slot === "SH")?.why).toContain("both elevations");
    expect(out.dispute).toBeNull();
  });

  it("takes a one-view figure rather than going silent, and says it did", () => {
    // S-201's real figures: front and side share nothing in the seat window.
    const page = rows([
      ["FRONT", "660"], ["FRONT", "680"], ["FRONT", "570"], ["FRONT", "465"],
      ["SIDE", "685"], ["SIDE", "680"], ["SIDE", "445"],
    ]);
    const out = guessSlotsFromViews(page, "ARMCHAIR");
    expect(slotOf(out, page, "SH")).toBe("445");
    expect(out.guesses.find((g) => g.slot === "SH")?.why).toContain("only one view");
    expect(out.dispute).toContain("one view only");
  });

  it("names the item when a seat height cannot be found at all", () => {
    const out = guessSlotsFromViews(
      rows([["FRONT", "660"], ["FRONT", "680"], ["SIDE", "680"], ["SIDE", "685"]]),
      "ARMCHAIR",
    );
    expect(out.guesses.some((g) => g.slot === "SH")).toBe(false);
    expect(out.dispute).toContain("ARMCHAIR");
  });

  it("says nothing about a seat on something that has none", () => {
    const out = guessSlotsFromViews(
      rows([["FRONT", "2000"], ["FRONT", "1500"], ["SIDE", "1500"], ["SIDE", "180"]]),
      "MUR 1 HEADBOARD",
    );
    expect(out.dispute).toBeNull();
  });

  it("chooses the candidate nearest a real seat height, not the first reported", () => {
    // 300 and 470 are both in the window; 470 is nearer 60% of 700.
    const page = rows([
      ["FRONT", "900"], ["FRONT", "700"], ["FRONT", "300"], ["FRONT", "470"],
      ["SIDE", "700"], ["SIDE", "800"],
    ]);
    const out = guessSlotsFromViews(page, "Armchair");
    expect(slotOf(out, page, "SH")).toBe("470");
  });
});
