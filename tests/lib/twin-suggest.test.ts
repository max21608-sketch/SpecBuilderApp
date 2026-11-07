// Pure tier — the bill review's twin suggestion (T3: zone prefixes and the
// same ref only), and the pairs an accepted set of suggestions links.
import { describe, expect, it } from "vitest";
import { acceptedTwinPairs, suggestTwins } from "@/lib/twin-suggest";

describe("suggestTwins", () => {
  it("suggests one code under two zones, naming both zones", () => {
    const suggested = suggestTwins([
      { lineNo: 24, code: "GR-FUR-13" },
      { lineNo: 25, code: "GR-FUR-14" },
      { lineNo: 61, code: "PL-FUR-13" },
    ]);
    expect([...suggested.keys()]).toEqual([61]);
    expect(suggested.get(61)).toEqual({
      twinOf: 24,
      evidence: "PL-FUR-13 and GR-FUR-13 (row 24) are one code, FUR-13, under two zones (PL, GR).",
    });
  });

  it("suggests the same ref on two lines", () => {
    const suggested = suggestTwins([
      { lineNo: 7, code: "SX11A" },
      { lineNo: 9, code: "sx 11a" },
    ]);
    expect(suggested.get(9)).toEqual({ twinOf: 7, evidence: "Row 7 carries the same code, SX11A." });
  });

  it("points every later line of a group at its first", () => {
    const suggested = suggestTwins([
      { lineNo: 30, code: "MUR-FUR-05" },
      { lineNo: 10, code: "GR-FUR-05" },
      { lineNo: 20, code: "PL-FUR-05" },
    ]);
    expect(suggested.get(20)?.twinOf).toBe(10);
    expect(suggested.get(30)?.twinOf).toBe(10);
    expect(suggested.has(10)).toBe(false);
  });

  it("never reads a description, a bare code beside a zoned one, a fabric line or an ignored line", () => {
    const suggested = suggestTwins([
      { lineNo: 1, code: "GR-FUR-13" },
      { lineNo: 2, code: "FUR-13" },
      { lineNo: 3, code: "PL-FUR-13", ignored: true },
      { lineNo: 4, code: "PL-FUR-13", rowKind: "finish_for" },
      { lineNo: 5, code: null },
      { lineNo: 6, code: "   " },
    ]);
    expect(suggested.size).toBe(0);
  });

  it("does not fold two different numbers or a sub-part", () => {
    expect(
      suggestTwins([
        { lineNo: 1, code: "GR-FUR-13" },
        { lineNo: 2, code: "PL-FUR-13A" },
        { lineNo: 3, code: "PL-FUR-31" },
      ]).size,
    ).toBe(0);
  });
});

describe("acceptedTwinPairs", () => {
  it("links every pair of a group, so three stools are three pairs", () => {
    expect(
      acceptedTwinPairs([
        { lineNo: 20, twinOf: 10 },
        { lineNo: 30, twinOf: 10 },
      ]),
    ).toEqual([
      [10, 20],
      [10, 30],
      [20, 30],
    ]);
  });

  it("keeps two groups apart and ignores a line named as its own twin", () => {
    expect(
      acceptedTwinPairs([
        { lineNo: 2, twinOf: 1 },
        { lineNo: 9, twinOf: 8 },
        { lineNo: 5, twinOf: 5 },
      ]),
    ).toEqual([
      [1, 2],
      [8, 9],
    ]);
  });
});
