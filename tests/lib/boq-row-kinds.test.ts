// A bill line's KIND — item, fabric for an item, section, subtotal, blank —
// and the one rule code applies on its own (plan any-bill, Step 2).
//
// Pure tier. Every code is invented (`ZZ-`); the shapes are the Aman pricing
// document's: a fabric line directly under its item, naming it in brackets.
import { describe, expect, it } from "vitest";
import {
  applyBracketRule,
  boqConfirmCounts,
  boqConfirmLabel,
  fabricCodeOf,
  fabricLineState,
  fabricParentOptions,
  kindChoicePatch,
  parseBracketCode,
  rowKindProblems,
  type RowKindFields,
} from "@/lib/boq-row-kinds";
import { parseBoqSheets } from "@/lib/boq-import";
import { pricingDoc } from "../fixtures/boq-shapes";

type L = RowKindFields & { lineNo: number; code: string | null; itemDescription: string; ignored: boolean };
const line = (lineNo: number, code: string | null, extra: Partial<L> = {}): L => ({
  lineNo,
  code,
  itemDescription: `line ${lineNo}`,
  ignored: false,
  ...extra,
});

describe("the bracket in a fabric line's code", () => {
  it("reads the fabric's code and the item it names", () => {
    expect(parseBracketCode("ZZ-FAB-13 (ZZ-FUR-10)")).toEqual({ fabricCode: "ZZ-FAB-13", itemRef: "ZZ-FUR-10" });
    expect(parseBracketCode("ZZ-FAB-13   (ZZ / YY-FUR--04)")).toEqual({ fabricCode: "ZZ-FAB-13", itemRef: "ZZ / YY-FUR--04" });
    expect(parseBracketCode("(ZZ-FUR-10)")).toEqual({ fabricCode: null, itemRef: "ZZ-FUR-10" });
  });

  it("finds no bracket where there is none, or an empty one", () => {
    expect(parseBracketCode("ZZ-FAB-13")).toBeNull();
    expect(parseBracketCode("N/A")).toBeNull();
    expect(parseBracketCode(null)).toBeNull();
    expect(parseBracketCode("ZZ-FAB-13 ( )")).toBeNull();
  });

  it("files the fabric's own code without the bracket, and N/A or blank as none", () => {
    expect(fabricCodeOf("ZZ-FAB-13 (ZZ-FUR-10)")).toBe("ZZ-FAB-13");
    expect(fabricCodeOf("ZZ-FAB-11")).toBe("ZZ-FAB-11");
    expect(fabricCodeOf("N/A")).toBeNull();
    expect(fabricCodeOf("n/a")).toBeNull();
    expect(fabricCodeOf("")).toBeNull();
    expect(fabricCodeOf(null)).toBeNull();
    expect(fabricCodeOf("(ZZ-FUR-10)")).toBeNull();
  });
});

describe("the bracket rule", () => {
  it("makes a line naming exactly one item line its fabric line, unflagged", () => {
    const out = applyBracketRule([line(9, "ZZ-FUR-10"), line(10, "ZZ-FAB-13 (ZZ-FUR-10)"), line(11, "ZZ-FUR-26")]);
    expect(out[1]).toMatchObject({
      rowKind: "finish_for",
      rowKindSource: "bill",
      rowKindFlag: null,
      finishFor: { row: 9, code: "ZZ-FUR-10" },
    });
    expect(out[0]!.rowKind).toBeUndefined();
    expect(out[2]!.rowKind).toBeUndefined();
  });

  it("folds the bracket the way every matcher does — punctuation and case do not matter", () => {
    const out = applyBracketRule([line(4, "ZZ-FUR-08A"), line(5, "ZZ-FAB-04 (zz fur 08a)")]);
    expect(out[1]).toMatchObject({ rowKind: "finish_for", finishFor: { row: 4 } });
  });

  it("proposes the nearer item ABOVE where two lines carry the code, and flags it amber", () => {
    const out = applyBracketRule([
      line(20, "ZZ-FUR-22"),
      line(21, "ZZ-FUR-06"),
      line(22, "ZZ-FUR-22"),
      line(23, "ZZ-FAB-02 (ZZ-FUR-22)"),
      line(40, "ZZ-FUR-22"),
    ]);
    expect(out[3]).toMatchObject({ rowKind: "finish_for", finishFor: { row: 22 } });
    expect(out[3]!.rowKindFlag).toMatch(/3 lines carry ZZ-FUR-22 — this is the nearer one above \(row 22\); check it/);
  });

  it("infers nothing where the code is on two lines and neither is above", () => {
    const out = applyBracketRule([line(3, "ZZ-FAB-02 (ZZ-FUR-22)"), line(4, "ZZ-FUR-22"), line(6, "ZZ-FUR-22")]);
    expect(out[0]!.rowKind).toBeUndefined();
    expect(out[0]!.rowKindFlag).toMatch(/none of them above this one/);
  });

  it("infers nothing where no line carries the code, and says so", () => {
    const out = applyBracketRule([line(27, "ZZ-FUR-01"), line(28, "ZZ-FAB-19 (YY-FUR-01.1)")]);
    expect(out[1]!.rowKind).toBeUndefined();
    expect(out[1]!.finishFor).toBeUndefined();
    expect(out[1]!.rowKindFlag).toMatch(/no line on this sheet carries it/);
  });

  it("reads NOTHING from position: a plain fabric code under an item is still a line", () => {
    const out = applyBracketRule([line(14, "ZZ-FUR-03A"), line(15, "ZZ-FAB-13"), line(16, "N/A"), line(17, null)]);
    expect(out.every((entry) => entry.rowKind === undefined && entry.rowKindFlag === undefined)).toBe(true);
  });

  it("never touches a line somebody already gave a kind", () => {
    const person = line(10, "ZZ-FAB-13 (ZZ-FUR-10)", { rowKind: "item", rowKindSource: "person" });
    const out = applyBracketRule([line(9, "ZZ-FUR-10"), person]);
    expect(out[1]).toBe(person);
  });

  it("runs on every reading of a bill — the pricing document's fabric row names its item", () => {
    const result = parseBoqSheets([{ sheet: "BILL", data: pricingDoc({ titled: true }) }], {
      aliases: [
        { role: "code", term: "spec code" },
        { role: "itemDescription", term: "item description" },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    const lines = result.sheets[0]!.lines;
    const fabric = lines.find((entry) => entry.code === "ZZ-FAB-13 (ZZ-FUR-10)");
    const stool = lines.find((entry) => entry.code === "ZZ-FUR-10");
    expect(fabric).toMatchObject({ rowKind: "finish_for", finishFor: { row: stool!.lineNo, code: "ZZ-FUR-10" } });
  });
});

describe("what a person may choose", () => {
  it("offers the live item lines ABOVE a fabric line, nearest first", () => {
    const lines = [
      line(9, "ZZ-FUR-10"),
      line(10, "ZZ-FAB-13 (ZZ-FUR-10)", { rowKind: "finish_for", finishFor: { row: 9, code: "ZZ-FUR-10" } }),
      line(11, "ZZ-FUR-26", { ignored: true }),
      line(12, null, { rowKind: "section" }),
      line(13, "ZZ-FUR-03"),
      line(14, "ZZ-FAB-01"),
      line(15, "ZZ-FUR-40"),
    ];
    expect(fabricParentOptions(lines, lines[5]!).map((option) => option.lineNo)).toEqual([13, 9]);
  });

  it("ignores a section, a subtotal and a blank by the same press, and says why", () => {
    expect(kindChoicePatch("section", null)).toMatchObject({ rowKind: "section", ignored: true, ignoredBecause: "a section heading, not an item" });
    expect(kindChoicePatch("subtotal", null)).toMatchObject({ ignored: true, ignoredBecause: "a subtotal, not an item" });
    expect(kindChoicePatch("blank", null)).toMatchObject({ ignored: true });
  });

  it("includes an item and a fabric line, and records who said so", () => {
    expect(kindChoicePatch("item", null)).toMatchObject({ rowKind: "item", rowKindSource: "person", ignored: false, finishFor: null });
    expect(kindChoicePatch("finish_for", { row: 9, code: "ZZ-FUR-10" })).toMatchObject({
      rowKind: "finish_for",
      finishFor: { row: 9, code: "ZZ-FUR-10" },
      ignored: false,
      rowKindFlag: null,
    });
  });
});

describe("what stops a fabric line", () => {
  const fabric = (lineNo: number, row: number | null) =>
    line(lineNo, "ZZ-FAB-01", { rowKind: "finish_for", finishFor: row === null ? null : { row, code: "ZZ-FUR-10" } });

  it("passes a fabric line whose item is a live item line", () => {
    expect(rowKindProblems([line(9, "ZZ-FUR-10"), fabric(10, 9)])).toEqual([]);
  });

  it("refuses a fabric line that names no item, or an item that is not being imported", () => {
    expect(rowKindProblems([fabric(10, null)])[0]!.problem).toMatch(/names no item/);
    expect(rowKindProblems([line(9, "ZZ-FUR-10", { ignored: true }), fabric(10, 9)])[0]!.problem).toMatch(
      /not being imported\. Include row 9, or leave the fabric out/,
    );
    expect(rowKindProblems([line(9, null, { rowKind: "section" }), fabric(10, 9)])[0]!.problem).toMatch(/no longer an item/);
    expect(rowKindProblems([fabric(10, 99)])[0]!.problem).toMatch(/not a line of this sheet/);
  });

  it("says nothing about a fabric line that is itself left out", () => {
    expect(rowKindProblems([{ ...fabric(10, null), ignored: true }])).toEqual([]);
  });
});

describe("the Confirm label", () => {
  const sheet = {
    ignored: false,
    lines: [
      line(9, "ZZ-FUR-10"),
      line(10, "ZZ-FAB-13 (ZZ-FUR-10)", { rowKind: "finish_for", finishFor: { row: 9, code: "ZZ-FUR-10" } }),
      line(11, "ZZ-FUR-26"),
      line(12, "ZZ-FAB-01", { rowKind: "finish_for", finishFor: { row: 11, code: "ZZ-FUR-26" } }),
      line(13, null, { rowKind: "section", ignored: true }),
    ],
  };

  it("counts records AND fabric specs, never a fabric line as a record", () => {
    expect(boqConfirmCounts([sheet, { ignored: true, lines: [line(1, "X")] }])).toEqual({ records: 2, fabricSpecs: 2, phases: 1 });
    expect(boqConfirmLabel({ counts: boqConfirmCounts([sheet]), revising: false, unmapped: 0, busy: false })).toBe(
      "Confirm · creates 2 records and 2 fabric specs on 1 phase",
    );
  });

  it("says nothing about fabric specs on a bill with none", () => {
    expect(boqConfirmLabel({ counts: { records: 67, fabricSpecs: 0, phases: 2 }, revising: false, unmapped: 0, busy: false })).toBe(
      "Confirm · creates 67 records on 2 phases",
    );
  });

  it("says to set the columns first while a sheet needs them, never 'creates 0 records'", () => {
    expect(boqConfirmLabel({ counts: { records: 0, fabricSpecs: 0, phases: 0 }, revising: false, unmapped: 2, busy: false })).toBe(
      "Set the columns first",
    );
  });

  it("says a revision updates, and what it is doing while it does", () => {
    expect(boqConfirmLabel({ counts: { records: 1, fabricSpecs: 1, phases: 1 }, revising: true, unmapped: 0, busy: false })).toBe(
      "Confirm · updates this phase from 1 line and 1 fabric spec",
    );
    expect(boqConfirmLabel({ counts: { records: 1, fabricSpecs: 0, phases: 1 }, revising: false, unmapped: 0, busy: true })).toBe(
      "Importing…",
    );
  });
});

describe("a fabric line's state", () => {
  it("is TBC wherever the bill writes TBC on it, and confirmed otherwise", () => {
    expect(fabricLineState("Fabric @ Armchair (Option 1) Technical details TBC")).toBe("tbc");
    expect(fabricLineState("Fabric @ Stool Collection: Example weave Colour: T.B.C.")).toBe("tbc");
    expect(fabricLineState("Fabric @ Stool Collection & Pattern: Example weave")).toBe("confirmed");
    expect(fabricLineState("   ")).toBe("tbc");
  });
});
