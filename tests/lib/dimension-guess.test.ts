import { describe, expect, it } from "vitest";
import { guessSlotsFromViews, viewFamily, type MeasuredRow } from "@/lib/dimension-guess";

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

describe("guessSlotsFromViews — where it must not guess", () => {
  it("refuses a page that labels no view, and says to read the drawing", () => {
    // The real S-100 sofa sheet: eight bare figures, no view anywhere. There is
    // no convention that puts a column of eight figures in order.
    const s100 = rows([
      ["Dimension 1", "190"], ["Dimension 2", "72"], ["Dimension 3", "79"], ["Dimension 4", "72"],
      ["Dimension 5", "52"], ["Dimension 6", "44"], ["Dimension 7", "10"], ["Dimension 8", "79"],
    ]);
    const out = guessSlotsFromViews(s100);
    expect(out.guesses).toEqual([]);
    expect(out.dispute).toContain("labels none of its figures");
  });

  it("refuses when the views share nothing, naming what is on each", () => {
    const out = guessSlotsFromViews(rows([["FRONT", "840"], ["SIDE", "790"]]));
    expect(out.guesses).toEqual([]);
    expect(out.dispute).toContain("the height");
    expect(out.dispute).toContain("front 840");
  });

  it("refuses when the plan and the front disagree about the width", () => {
    // The plan states 800 and the front states it too, so 800 is a width — but
    // the front also carries a LARGER 800-and-something the plan never shows.
    // Both readings are defensible and the page is contradicting itself.
    const out = guessSlotsFromViews(
      rows([
        ["FRONT", "840"], ["FRONT", "800"], ["FRONT", "720"],
        ["SIDE", "720"], ["SIDE", "790"],
        ["TOP", "800"], ["TOP", "790"],
      ]),
    );
    expect(out.guesses).toEqual([]);
    expect(out.dispute).toContain("Both should be the width");
  });

  it("guesses all of them or none — never three of four", () => {
    const out = guessSlotsFromViews(rows([["FRONT", "840"], ["SIDE", "790"]]));
    expect(out.guesses).toEqual([]);
  });

  it("stays quiet on a page with almost nothing on it", () => {
    // Not a dispute: one unlabelled figure is not a page stating its size.
    expect(guessSlotsFromViews(rows([["Dimension 1", "440"]]))).toEqual({ guesses: [], dispute: null });
  });

  it("leaves the seat height out rather than inventing a proportion", () => {
    // 620 of 680 is 91% of the height: a back rail, not a seat.
    const out = guessSlotsFromViews(
      rows([["FRONT", "660"], ["FRONT", "680"], ["FRONT", "620"], ["SIDE", "680"], ["SIDE", "620"], ["SIDE", "685"]]),
    );
    expect(out.guesses.some((g) => g.slot === "SH")).toBe(false);
  });
});
