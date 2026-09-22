// A decision on one phase's tab reaches the same client ref on the others.
//
// The testable core of found-in-use "A level accepted on one phase's tab is
// still an unaccepted suggestion on the next, for the same client ref": staged
// sheets plus one decision in, the rows it should reach out. No database, and
// no screen — the route writes what this returns, and the review screen reads
// the same module's duplicate helpers, so the rows it calls ambiguous and the
// rows the carry refuses are one set.
import { describe, expect, it } from "vitest";
import {
  duplicateGroups,
  duplicateRefs,
  isDuplicated,
  listTabs,
  planCarry,
  refKey,
  tabLabel,
  type CarrySheet,
} from "@/lib/boq-carry";

function line(index: number, code: string | null, extra: Record<string, unknown> = {}) {
  return { index, lineNo: index + 1, code, ignored: false, ...extra };
}

/** MUR, MAIN RUN and MAIN RUN - VE, each quoting S-100 and S-201. */
function threeTabs(): CarrySheet[] {
  return [
    { sheetName: "MUR", proposedRunName: "MUR", lines: [line(0, "S-100"), line(1, "S-201")] },
    { sheetName: "Sheet2", proposedRunName: "MAIN RUN", lines: [line(0, "S-100"), line(1, "S-201")] },
    { sheetName: "Sheet3", proposedRunName: "MAIN RUN - VE", lines: [line(0, "S-100"), line(1, "S-201")] },
  ];
}

describe("refKey", () => {
  it("is normaliseRef's fold, not the looser one", () => {
    // `S.201` against `S-201` reading as a new line is what the looser fold
    // already cost once (CLAUDE.md, the bills variance row).
    expect(refKey("S-201")).toBe(refKey("S.201"));
    expect(refKey("s 201")).toBe(refKey("S-201"));
    expect(refKey("FU-209-15")).toBe("FU20915");
  });

  it("is null where there is nothing to match on", () => {
    expect(refKey(null)).toBeNull();
    expect(refKey("   ")).toBeNull();
    expect(refKey("---")).toBeNull();
  });
});

describe("duplicates within one tab", () => {
  const sheet: CarrySheet = {
    proposedRunName: "MAIN RUN",
    lines: [line(0, "SX11A"), line(1, "SX11A"), line(2, "S-100"), line(3, null), line(4, null)],
  };

  it("names the rows, not just the ref", () => {
    expect(duplicateGroups(sheet)).toEqual([{ code: "SX11A", lineNos: [1, 2] }]);
  });

  it("folds two spellings of one ref together", () => {
    const folded: CarrySheet = { lines: [line(0, "S-201"), line(1, "S.201")] };
    expect(duplicateRefs(folded).has("S201")).toBe(true);
  });

  it("never groups the blank rows, which share no ref at all", () => {
    expect(isDuplicated(sheet, sheet.lines[3]!)).toBe(false);
    expect(isDuplicated(sheet, sheet.lines[0]!)).toBe(true);
    expect(isDuplicated(sheet, sheet.lines[2]!)).toBe(false);
  });

  it("ignores an ignored line, which is not in the bill", () => {
    const withIgnored: CarrySheet = { lines: [line(0, "SX11A"), line(1, "SX11A", { ignored: true })] };
    expect(duplicateGroups(withIgnored)).toEqual([]);
  });
});

describe("planCarry", () => {
  it("carries an accepted level to the same ref on every other tab", () => {
    const sheets = threeTabs();
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets.map((target) => [target.sheetIndex, target.index])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(targets[0]!.patch).toEqual({
      level: "simple",
      levelStatus: "chosen",
      levelReason: null,
      levelCarriedFrom: "MUR",
    });
    expect(listTabs(targets)).toBe("MAIN RUN and MAIN RUN - VE");
  });

  it("arrives as a DECISION, because that is what it is", () => {
    // `chosen` is what tells the confirm to write `spec_records.level` — the
    // column the quote gate reads — rather than the advisory suggestion.
    const targets = planCarry(threeTabs(), { sheetIndex: 0, index: 1 }, { field: "level", level: "hero" });
    expect(targets.every((target) => target.patch.levelStatus === "chosen")).toBe(true);
    expect(targets.every((target) => target.patch.levelCarriedFrom === "MUR")).toBe(true);
  });

  it("carries a category the same way", () => {
    const targets = planCarry(threeTabs(), { sheetIndex: 1, index: 0 }, { field: "category", categoryId: "cat-1" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([0, 2]);
    expect(targets[0]!.patch).toEqual({
      categoryId: "cat-1",
      categoryStatus: "chosen",
      categoryCarriedFrom: "MAIN RUN",
    });
  });

  it("matches a ref the other tab spells differently", () => {
    const sheets: CarrySheet[] = [
      { proposedRunName: "MUR", lines: [line(0, "S-201")] },
      { proposedRunName: "MAIN RUN", lines: [line(0, "S.201")] },
    ];
    expect(planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toHaveLength(1);
  });

  // ---- the SX11A case ------------------------------------------------------

  it("fans out to NOTHING from a ref this tab carries twice", () => {
    const sheets: CarrySheet[] = [
      { proposedRunName: "MUR", lines: [line(0, "SX11A"), line(1, "SX11A")] },
      { proposedRunName: "MAIN RUN", lines: [line(0, "SX11A")] },
    ];
    expect(planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
  });

  it("skips a RECEIVING tab that carries the ref twice, and reaches the others", () => {
    const sheets: CarrySheet[] = [
      { proposedRunName: "MUR", lines: [line(0, "SX11A")] },
      { proposedRunName: "MAIN RUN", lines: [line(0, "SX11A"), line(1, "SX11A")] },
      { proposedRunName: "VE", lines: [line(0, "SX11A")] },
    ];
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([2]);
  });

  it("carries nothing from a line with no client ref", () => {
    const sheets: CarrySheet[] = [
      { proposedRunName: "MUR", lines: [line(0, null)] },
      { proposedRunName: "MAIN RUN", lines: [line(0, null)] },
    ];
    expect(planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
  });

  // ---- what a person decided here wins ------------------------------------

  it("never overwrites a level a person set on the receiving tab", () => {
    const sheets = threeTabs();
    sheets[1]!.lines[0] = line(0, "S-100", { level: "hero", levelStatus: "chosen" });
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([2]);
  });

  it("never overwrites a category a person set on the receiving tab", () => {
    const sheets = threeTabs();
    sheets[2]!.lines[0] = line(0, "S-100", { categoryId: "theirs", categoryStatus: "chosen" });
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "category", categoryId: "mine" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([1]);
  });

  it("DOES overwrite a value that was itself carried, and a parser suggestion", () => {
    const sheets = threeTabs();
    sheets[1]!.lines[0] = line(0, "S-100", { level: "hero", levelStatus: "chosen", levelCarriedFrom: "VE" });
    sheets[2]!.lines[0] = line(0, "S-100", { level: "hero", levelStatus: "suggested" });
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([1, 2]);
  });

  it("writes nothing where the row already holds exactly this carry", () => {
    const sheets = threeTabs();
    sheets[1]!.lines[0] = line(0, "S-100", { level: "simple", levelStatus: "chosen", levelCarriedFrom: "MUR" });
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets.map((target) => target.sheetIndex)).toEqual([2]);
  });

  // ---- lines and tabs nobody is importing ---------------------------------

  it("skips an ignored tab and an ignored line", () => {
    const sheets = threeTabs();
    sheets[1]!.ignored = true;
    sheets[2]!.lines[0] = line(0, "S-100", { ignored: true });
    expect(planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
  });

  it("carries nothing from an ignored source line or an ignored source tab", () => {
    const fromIgnoredLine = threeTabs();
    fromIgnoredLine[0]!.lines[0] = line(0, "S-100", { ignored: true });
    expect(planCarry(fromIgnoredLine, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);

    const fromIgnoredTab = threeTabs();
    fromIgnoredTab[0]!.ignored = true;
    expect(planCarry(fromIgnoredTab, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
  });

  it("is empty on a one-tab bill, and on a source that is not there", () => {
    const one: CarrySheet[] = [{ proposedRunName: "MAIN RUN", lines: [line(0, "S-100")] }];
    expect(planCarry(one, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
    expect(planCarry(one, { sheetIndex: 4, index: 0 }, { field: "level", level: "simple" })).toEqual([]);
    expect(planCarry(one, { sheetIndex: 0, index: 9 }, { field: "level", level: "simple" })).toEqual([]);
  });

  it("addresses a line by its own index, not by its position in the array", () => {
    // The staged list is fixed and `index` is its address; a receiving tab that
    // lists the codes in another order must still be patched at the right one.
    const sheets: CarrySheet[] = [
      { proposedRunName: "MUR", lines: [line(0, "S-100")] },
      { proposedRunName: "MAIN RUN", lines: [line(0, "S-400"), line(1, "S-201"), line(2, "S-100")] },
    ];
    const targets = planCarry(sheets, { sheetIndex: 0, index: 0 }, { field: "level", level: "simple" });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.index).toBe(2);
  });
});

describe("tabLabel", () => {
  it("is what the tab strip prints, so a reviewer can find the tab it names", () => {
    expect(tabLabel({ sheetName: "Sheet2", proposedRunName: "MAIN RUN", lines: [] })).toBe("MAIN RUN");
    expect(tabLabel({ sheetName: "Sheet2", proposedRunName: "", lines: [] })).toBe("Sheet2");
    expect(tabLabel({ lines: [] })).toBe("another tab");
  });
});
