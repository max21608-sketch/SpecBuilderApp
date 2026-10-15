// Which items a finish line is written to (`finishLineTargets`, 2026-10-15):
// a line NAMING a code that other lines of the phase carry goes on each of
// them that has no finish line of its own.
//
// Pure tier. Every code is invented (`Z…`).
import { describe, expect, it } from "vitest";
import { boqConfirmCounts, finishLineTargets } from "@/lib/boq-row-kinds";

type L = {
  lineNo: number;
  code: string | null;
  ignored?: boolean;
  rowKind?: string;
  rowKindSource?: string;
  finishFor?: { row: number; code: string | null } | null;
};
const item = (lineNo: number, code: string | null, extra: Partial<L> = {}): L => ({ lineNo, code, ...extra });
const finish = (lineNo: number, code: string | null, row: number, source: string, extra: Partial<L> = {}): L => ({
  lineNo,
  code,
  rowKind: "finish_for",
  rowKindSource: source,
  finishFor: { row, code: null },
  ...extra,
});

describe("finishLineTargets", () => {
  it("a line whose own code names the item goes on the twin with no finish of its own", () => {
    const lines = [item(17, "ZC-03"), item(18, "ZC-03"), finish(19, "ZB-ZC-03", 18, "person")];
    const targets = finishLineTargets(lines, lines[2]!);
    expect(targets.rows).toEqual([17, 18]);
    expect(targets.code).toBe("ZC-03");
    expect(targets.sentence).toBe(
      "For rows 17 and 18 — ZC-03, both: its code ZB-ZC-03 names it, and row 17 carries ZC-03 with no finish line of its own.",
    );
  });

  it("a bracket naming the item fans out; a bracket naming something else does not", () => {
    const named = [item(2, "ZZ-FUR-04"), item(5, "ZZ-FUR-04"), finish(6, "ZZ-FAB-1 (ZZ-FUR-04)", 5, "bill")];
    expect(finishLineTargets(named, named[2]!).rows).toEqual([2, 5]);
    const zone = [item(2, "ZZ-FUR-04"), item(5, "ZZ-FUR-04"), finish(6, "ZZ-FAB-1 (GR / MUR-FUR-04)", 5, "bill")];
    expect(finishLineTargets(zone, zone[2]!).rows).toEqual([5]);
  });

  it("where the line sits names no code — the model's reading or a person's, under the second of two OPTION lines", () => {
    for (const source of ["model", "person"]) {
      const lines = [item(12, "ZZ-FUR-03"), item(13, "ZZ-FUR-03"), finish(14, "N/A", 13, source), finish(15, null, 13, source)];
      expect(finishLineTargets(lines, lines[2]!).rows).toEqual([13]);
      expect(finishLineTargets(lines, lines[3]!).rows).toEqual([13]);
    }
    // The same reading, where the line's own code names the item: both.
    const named = [item(2, "ZC-03"), item(3, "ZC-03"), finish(4, "ZB-ZC-03", 3, "model")];
    expect(finishLineTargets(named, named[2]!).rows).toEqual([2, 3]);
  });

  it("a layout's category rule names no code and stays on the item above", () => {
    const lines = [item(2, "ZZ-FUR-22"), item(3, "ZZ-FUR-22"), finish(4, "ZZ-FAB-9", 3, "bill")];
    expect(finishLineTargets(lines, lines[2]!).rows).toEqual([3]);
  });

  it("a twin with its OWN finish line takes none from another", () => {
    const lines = [
      item(11, "ZC-02"),
      finish(12, "ZB-ZC-02", 11, "model"),
      item(14, "ZC-02"),
      finish(15, "ZB-ZC-02", 14, "model"),
    ];
    expect(finishLineTargets(lines, lines[1]!).rows).toEqual([11]);
    expect(finishLineTargets(lines, lines[3]!).rows).toEqual([14]);
  });

  it("an ignored twin, or one that is not an item, is not written to", () => {
    const lines = [
      item(2, "ZC-03", { ignored: true }),
      item(3, "ZC-03", { rowKind: "section" }),
      item(4, "ZC-03"),
      finish(5, "ZB-ZC-03", 4, "model"),
    ];
    expect(finishLineTargets(lines, lines[3]!).rows).toEqual([4]);
  });

  it("three lines read 'all 3', and the confirm counts a spec per item", () => {
    const lines = [item(2, "ZC-03"), item(3, "ZC-03"), item(4, "ZC-03"), finish(5, "ZB-ZC-03", 4, "model")];
    expect(finishLineTargets(lines, lines[3]!).sentence).toMatch(/^For rows 2, 3 and 4 — ZC-03, all 3: /);
    expect(boqConfirmCounts([{ ignored: false, lines }])).toMatchObject({ records: 3, fabricSpecs: 3 });
  });
});
