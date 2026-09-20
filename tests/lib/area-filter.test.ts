// The area filter, as a pure function.
//
// The one defect worth code here is the fold: a bill that writes `Living Room`
// on one line and `living room` on the next would otherwise offer two options,
// so choosing either hides half the room. Everything else asserts that the
// fold stops exactly there.
import { describe, expect, it } from "vitest";
import { NO_AREA, NO_AREA_LABEL, areaOptions, foldArea, matchesArea } from "@/lib/area-filter";

const row = (area: string | null) => ({ area });

describe("folding an area", () => {
  it("folds case and whitespace, and nothing else", () => {
    expect(foldArea("Living Room")).toBe("living room");
    expect(foldArea("  living   room ")).toBe("living room");
    expect(foldArea("LIVING ROOM")).toBe("living room");
  });

  it("keeps two areas a document spelled differently apart", () => {
    // A normaliser clever enough to merge these is clever enough to merge two
    // rooms somebody meant to keep apart, and there is no way back from that.
    expect(foldArea("Bedroom 1")).not.toBe(foldArea("Bedroom 01"));
    expect(foldArea("Level 4 Corridor")).not.toBe(foldArea("Corridor"));
  });

  it("reads a blank area as no area at all", () => {
    expect(foldArea(null)).toBeNull();
    expect(foldArea("")).toBeNull();
    expect(foldArea("   ")).toBeNull();
  });
});

describe("the options the select offers", () => {
  it("merges spellings into one option and labels it as the document first wrote it", () => {
    const options = areaOptions([row("Living Room"), row("living room"), row("LIVING  ROOM")]);
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({ key: "living room", label: "Living Room", count: 3 });
  });

  it("sorts by the label and puts no-area last", () => {
    const options = areaOptions([
      row("Pool"),
      row(null),
      row("Dressing area"),
      row("Lobby"),
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Dressing area",
      "Lobby",
      "Pool",
      NO_AREA_LABEL,
    ]);
    expect(options.at(-1)?.key).toBe(NO_AREA);
  });

  it("counts an area carried by one record as one, rather than dropping it", () => {
    const options = areaOptions([row("Pool"), row("Lobby"), row("Lobby")]);
    expect(options.find((option) => option.label === "Pool")?.count).toBe(1);
  });

  it("offers every area on a 300-line phase", () => {
    // DEMO-300's shape: thirty-five areas across three hundred lines. The
    // select renders them all — the search box beside it is what makes them
    // findable, which is why there is no combobox.
    const rows = Array.from({ length: 300 }, (_, index) => row(`Area ${String(index % 35).padStart(2, "0")}`));
    const options = areaOptions(rows);
    expect(options).toHaveLength(35);
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(300);
  });
});

describe("matching a row against the chosen area", () => {
  it("passes everything when no area is chosen", () => {
    expect(matchesArea(row("Pool"), "")).toBe(true);
    expect(matchesArea(row(null), null)).toBe(true);
  });

  it("matches across spellings", () => {
    expect(matchesArea(row("Living Room"), "living room")).toBe(true);
    expect(matchesArea(row(" living   ROOM "), "living room")).toBe(true);
    expect(matchesArea(row("Lobby"), "living room")).toBe(false);
  });

  it("finds the records nobody has placed under the no-area key", () => {
    expect(matchesArea(row(null), NO_AREA)).toBe(true);
    expect(matchesArea(row("  "), NO_AREA)).toBe(true);
    expect(matchesArea(row("Pool"), NO_AREA)).toBe(false);
  });

  it("lists nothing for a key this phase does not carry", () => {
    // It arrives from the URL. Listing everything as though the key had been
    // honoured would be the screen quietly ignoring a link somebody sent.
    expect(matchesArea(row("Pool"), "basement")).toBe(false);
  });
});
