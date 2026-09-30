// A seeded layout's row rule: a line whose category begins `FBX-` is a fabric
// line for the item line above it (0042, 2026-09-30). Pure, synthetic lines.
//
// The Aman pricing document writes `FBX-SEA-IN` in the Category Code of every
// fabric line and prints each under its item; only five of its 34 name their
// item in brackets. The bracket rule alone therefore staged 29 fabric lines as
// ITEMS. The rule reads the bill's own category column, and every case below
// is a trap it must not fall into.
import { describe, expect, it } from "vitest";
import {
  applyBracketRule,
  applyCategoryFinishRule,
  boqConfirmCounts,
  parseRowRules,
  rowKindProblems,
  type RowKindFields,
} from "@/lib/boq-row-kinds";
import { parseBoqSheets, type BoqLayout } from "@/lib/boq-import";
import { pricingDoc } from "../fixtures/boq-shapes";

type Line = RowKindFields & {
  lineNo: number;
  code: string | null;
  boqCategory: string | null;
  ignored?: boolean;
};

const RULE = { finishForCategoryPrefix: "FBX-" };
const item = (lineNo: number, code: string, extra: Partial<Line> = {}): Line => ({ lineNo, code, boqCategory: "SEA-IN", ...extra });
const fabric = (lineNo: number, code: string | null, extra: Partial<Line> = {}): Line => ({
  lineNo,
  code,
  boqCategory: "FBX-SEA-IN",
  ...extra,
});
/** What staging does: the bracket rule, then the layout's rule. */
const stage = (lines: Line[], rules = RULE) => applyCategoryFinishRule(applyBracketRule(lines), rules);

describe("the category rule", () => {
  it("puts a fabric line under the item line above it, with the bill's words as evidence", () => {
    const [, fab] = stage([item(9, "ZZ-FUR-10"), fabric(10, "ZZ-FAB-13")]);
    expect(fab).toMatchObject({
      rowKind: "finish_for",
      rowKindSource: "bill",
      rowKindFlag: null,
      finishFor: { row: 9, code: "ZZ-FUR-10" },
    });
    expect(fab!.rowKindEvidence).toBe("Category Code FBX-SEA-IN — the bill's fabric line; under row 9, ZZ-FUR-10.");
  });

  it("puts every fabric line in a run under the same item, skipping the fabric lines between", () => {
    const staged = stage([item(27, "ZZ-FUR-01"), fabric(28, "ZZ-FAB-19"), fabric(29, "ZZ-FAB-20"), item(30, "ZZ-FUR-02")]);
    expect(staged.map((line) => line.finishFor?.row ?? null)).toEqual([null, 27, 27, null]);
    expect(boqConfirmCounts([{ ignored: false, lines: staged }])).toEqual({ records: 2, fabricSpecs: 2, phases: 1 });
    expect(rowKindProblems(staged)).toEqual([]);
  });

  it("keeps a bracket that names the item above, and says both agree", () => {
    const [, fab] = stage([item(9, "ZZ-FUR-10"), fabric(10, "ZZ-FAB-13 (ZZ-FUR-10)")]);
    expect(fab).toMatchObject({ rowKind: "finish_for", rowKindFlag: null, finishFor: { row: 9 } });
    expect(fab!.rowKindEvidence).toMatch(/names ZZ-FUR-10 in brackets.*Category Code FBX-SEA-IN — the bill's fabric line, under it\./);
  });

  it("keeps a bracket that names a DIFFERENT line, and flags it naming both — never a silent pick", () => {
    const [, , , fab] = stage([item(9, "ZZ-FUR-10"), item(11, "ZZ-FUR-26"), item(12, "ZZ-FUR-30"), fabric(13, "ZZ-FAB-13 (ZZ-FUR-10)")]);
    expect(fab!.finishFor).toEqual({ row: 9, code: "ZZ-FUR-10" });
    expect(fab!.rowKindFlag).toBe(
      "The bracket names row 9, ZZ-FUR-10, but the item line above this fabric line is row 12, ZZ-FUR-30. " +
        "The bracket is kept; check which item it belongs to.",
    );
  });

  it("places a line whose bracket names nothing on the sheet by its category, and says what the bracket said", () => {
    const [, fab] = stage([item(20, "ZZ-FUR-04"), fabric(21, "ZZ-FAB-13 (ZZ / MUR-FUR--04)")]);
    expect(fab).toMatchObject({ rowKind: "finish_for", rowKindSource: "bill", finishFor: { row: 20 } });
    expect(fab!.rowKindFlag).toMatch(/names ZZ \/ MUR-FUR--04 in brackets, and no one item line on this sheet carries it; placed under row 20, ZZ-FUR-04/);
  });

  it("gives a fabric line with no item above it no parent, and a flag — it is never a fabric spec on a guess", () => {
    const first = stage([fabric(9, "ZZ-FAB-13"), item(10, "ZZ-FUR-10")]);
    expect(first[0]!.rowKind).toBeUndefined();
    expect(first[0]!.finishFor).toBeUndefined();
    expect(first[0]!.rowKindFlag).toMatch(/no item line above it/);

    // Only fabric lines and an IGNORED item above: still none.
    const [, , third] = stage([item(8, "ZZ-FUR-01", { ignored: true }), fabric(9, null), fabric(10, "N/A")]);
    expect(third!.rowKind).toBeUndefined();
    expect(third!.rowKindFlag).toMatch(/no item line above it/);
  });

  it("does nothing without a rule, and never touches a kind a person or a model set", () => {
    const lines = [item(9, "ZZ-FUR-10"), fabric(10, "ZZ-FAB-13")];
    expect(applyCategoryFinishRule(lines, null)).toEqual(lines);
    expect(applyCategoryFinishRule(lines, undefined)).toEqual(lines);
    const person = fabric(10, "ZZ-FAB-13", { rowKind: "item", rowKindSource: "person" });
    expect(stage([item(9, "ZZ-FUR-10"), person])[1]).toEqual(person);
  });

  it("reads the prefix case-blind and as a PREFIX, never anywhere in the code", () => {
    expect(stage([item(9, "ZZ-FUR-10"), fabric(10, "ZZ-FAB-13", { boqCategory: " fbx-sea-out" })])[1]!.rowKind).toBe(
      "finish_for",
    );
    // A category merely CONTAINING the prefix is not a fabric line.
    expect(stage([item(9, "ZZ-FUR-10"), fabric(10, "ZZ-FAB-13", { boqCategory: "SEA-FBX-IN" })])[1]!.rowKind).toBeUndefined();
  });
});

describe("the stored rule", () => {
  it("validates what the column holds", () => {
    expect(parseRowRules({ finishForCategoryPrefix: "FBX-" })).toEqual({ finishForCategoryPrefix: "FBX-" });
    expect(parseRowRules({ finishForCategoryPrefix: "  " })).toBeNull();
    expect(parseRowRules({ somethingElse: true })).toBeNull();
    expect(parseRowRules(null)).toBeNull();
    expect(parseRowRules("FBX-")).toBeNull();
    expect(parseRowRules([])).toBeNull();
  });
});

describe("through the reader, with a layout that carries it", () => {
  const MAPPING: BoqLayout["mapping"] = {
    sourceLine: "line",
    area: "area",
    subArea: "sub-area",
    boqCategory: "category code",
    code: "spec code",
    itemDescription: "item description",
    qtyUnit: "unit",
    qty: "total qty",
    notes: "notes",
  };
  /** The synthetic pricing document with its fabric lines categorised the way the real bill does it. */
  const data = () =>
    pricingDoc({ titled: true }).map((row) => row.map((cell) => (cell === "FAB-SEAT-X" ? "FBX-SEAT-X" : cell)));
  const read = (rowRules: BoqLayout["rowRules"]) =>
    parseBoqSheets([{ sheet: "BILL", data: data() }], {
      layouts: [{ id: "l1", name: "Example", headerRows: 1, mapping: MAPPING, origin: "seed", rowRules }],
    }).sheets![0]!;

  it("makes every FBX line a fabric spec on its item", () => {
    const sheet = read(RULE);
    expect(boqConfirmCounts([sheet])).toEqual({ records: 5, fabricSpecs: 3, phases: 1 });
    expect(sheet.lines.filter((line) => line.rowKind === "finish_for").map((line) => [line.lineNo, line.finishFor?.row])).toEqual([
      [10, 9],
      [14, 13],
      [15, 13],
    ]);
    expect(rowKindProblems(sheet.lines)).toEqual([]);
  });

  it("reads exactly as before on a layout with no rule — only the bracket places a fabric", () => {
    expect(boqConfirmCounts([read(null)])).toEqual({ records: 7, fabricSpecs: 1, phases: 1 });
  });
});
