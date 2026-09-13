import { describe, it, expect } from "vitest";
import { normaliseName, scoreMatch, wordSet, findBestMatches, matchName } from "@/lib/matching";

describe("normaliseName", () => {
  it("folds punctuation, case and the Limited/Ltd variants", () => {
    expect(normaliseName("Romo Limited")).toBe("romo ltd");
    expect(normaliseName("MARKS & SPENCER,")).toBe("marks spencer");
  });
  it("strips a c/o distributor tail", () => {
    expect(normaliseName("Villa Nova UK - C/O Romo UK")).toBe("villa nova uk");
  });
});

describe("scoreMatch", () => {
  it("divides by the smaller word count, so a contained name scores 1", () => {
    expect(scoreMatch(wordSet("romo"), wordSet("romo fabrics ltd"))).toBe(1);
  });
});

describe("findBestMatches", () => {
  const candidates = [
    { id: "1", name: "Ian Sanderson" },
    { id: "2", name: "Sanderson Design Group" },
    { id: "3", name: "Romo Ltd" },
  ];

  it("short-circuits on an exact normalised match", () => {
    expect(findBestMatches("romo limited", candidates)).toEqual([{ id: "3", name: "Romo Ltd" }]);
  });

  it("returns EVERY tied candidate rather than picking one", () => {
    // This is the safety property. "Sanderson" is genuinely two businesses;
    // silently choosing either links a record to the wrong real company.
    const found = findBestMatches("Sanderson", candidates);
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("returns nothing below the cutoff", () => {
    expect(findBestMatches("Zimmer Rohde", candidates)).toEqual([]);
  });
});

describe("matchName", () => {
  const candidates = [
    { id: "1", name: "Ian Sanderson" },
    { id: "2", name: "Sanderson Design Group" },
    { id: "3", name: "Romo Ltd" },
  ];

  it("is confident only when exactly one candidate clears the cutoff", () => {
    expect(matchName("Romo Limited", candidates)).toEqual({ status: "confident", id: "3", name: "Romo Ltd" });
  });

  it("reports ambiguity instead of guessing", () => {
    const result = matchName("Sanderson", candidates);
    expect(result.status).toBe("ambiguous");
  });

  it("refuses placeholder values that look like names", () => {
    expect(matchName("TBC", candidates)).toEqual({ status: "none" });
    expect(matchName("   ", candidates)).toEqual({ status: "none" });
    expect(matchName(null, candidates)).toEqual({ status: "none" });
  });
});

describe("exact matches do not silently break a tie", () => {
  // Two requirements legitimately share a prompt ("Other notes"); two spec
  // fields share a name. `find` returned the first and discarded the rest,
  // which is the one thing this module exists to prevent.
  it("returns every candidate whose name matches exactly", () => {
    const result = matchName("Frame finish", [
      { id: "a", name: "Frame finish" },
      { id: "b", name: "frame  finish" },
      { id: "c", name: "Seat fabric" },
    ]);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(["a", "b"]);
    }
  });

  it("still resolves a unique exact match confidently", () => {
    const result = matchName("Frame finish", [
      { id: "a", name: "Frame finish" },
      { id: "c", name: "Seat fabric" },
    ]);
    expect(result).toMatchObject({ status: "confident", id: "a" });
  });
});
