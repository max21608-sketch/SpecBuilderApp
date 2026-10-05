// How the bill review groups its rows: an item and its fabrics, a family of one
// code, and the duplicates a family does not explain. Pure; synthetic codes.
import { describe, expect, it } from "vitest";
import { groupBillLines, type GroupableLine } from "@/lib/bill-review-groups";

type L = GroupableLine & { tag?: string };

const item = (lineNo: number, code: string | null, over: Partial<L> = {}): L => ({
  lineNo,
  code,
  itemDescription: `Item ${lineNo}`,
  ignored: false,
  rowKind: "item",
  ...over,
});

const fabric = (lineNo: number, forRow: number | null, over: Partial<L> = {}): L => ({
  lineNo,
  code: "ZZ-FAB-01",
  itemDescription: `Fabric ${lineNo}`,
  ignored: false,
  rowKind: "finish_for",
  finishFor: forRow === null ? null : { row: forRow, code: null },
  ...over,
});

/** Each group as the rows it draws, in order — the shape the screen walks. */
const shape = (lines: L[]) =>
  groupBillLines(lines).map((group) => ({
    family: group.family,
    members: group.members.map((member) => ({
      row: member.line.lineNo,
      fabrics: member.fabrics.map((line) => line.lineNo),
      stray: member.stray,
      alsoOn: member.alsoOn,
    })),
  }));

const rowsInOrder = (lines: L[]) =>
  groupBillLines(lines).flatMap((group) =>
    group.members.flatMap((member) => [member.line.lineNo, ...member.fabrics.map((line) => line.lineNo)]),
  );

describe("groupBillLines", () => {
  it("hangs the fabric lines under the item they follow and name, one group each", () => {
    const lines = [item(9, "ZZ-FUR-10"), fabric(10, 9), fabric(11, 9), item(12, "ZZ-FUR-26")];
    expect(shape(lines)).toEqual([
      { family: null, members: [{ row: 9, fabrics: [10, 11], stray: false, alsoOn: [] }] },
      { family: null, members: [{ row: 12, fabrics: [], stray: false, alsoOn: [] }] },
    ]);
  });

  it("keeps a fabric naming some OTHER row where the bill put it, as a stray group of its own", () => {
    const lines = [item(9, "ZZ-FUR-10"), item(10, "ZZ-FUR-26"), fabric(11, 9), fabric(12, 10)];
    expect(shape(lines)).toEqual([
      { family: null, members: [{ row: 9, fabrics: [], stray: false, alsoOn: [] }] },
      { family: null, members: [{ row: 10, fabrics: [], stray: false, alsoOn: [] }] },
      { family: null, members: [{ row: 11, fabrics: [], stray: true, alsoOn: [] }] },
      // A stray breaks the chain: row 12 does not reach back over it.
      { family: null, members: [{ row: 12, fabrics: [], stray: true, alsoOn: [] }] },
    ]);
  });

  it("treats a fabric line naming no item, or under a section, as a stray", () => {
    const lines = [
      fabric(5, null),
      item(6, null, { rowKind: "section", ignored: true }),
      fabric(7, 6),
    ];
    expect(shape(lines).map((group) => group.members[0]!.stray)).toEqual([true, false, true]);
  });

  it("brackets consecutive items of one code as a family, and calls them options only when every line says so", () => {
    const lines = [
      item(12, "ZZ-FUR-03", { notes: "OPTION 1" }),
      fabric(13, 12),
      item(14, "zz.fur.03", { itemDescription: "Sofa (Option 2)" }),
      fabric(15, 14),
      item(16, "ZZ-FUR-40"),
    ];
    const groups = shape(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      family: { code: "ZZ-FUR-03", lines: 2, options: true },
      members: [
        { row: 12, fabrics: [13], stray: false, alsoOn: [] },
        { row: 14, fabrics: [15], stray: false, alsoOn: [] },
      ],
    });
  });

  it("says a family is not options where one line's words do not say option", () => {
    const lines = [item(12, "ZZ-FUR-03", { notes: "OPTION 1" }), item(13, "ZZ-FUR-03")];
    expect(shape(lines)[0]!.family).toEqual({ code: "ZZ-FUR-03", lines: 2, options: false });
  });

  it("does not bracket non-adjacent lines of one code; each names the other", () => {
    const lines = [item(12, "ZZ-FUR-03"), item(13, "ZZ-FUR-26"), item(14, "ZZ-FUR-03")];
    expect(shape(lines)).toEqual([
      { family: null, members: [{ row: 12, fabrics: [], stray: false, alsoOn: [14] }] },
      { family: null, members: [{ row: 13, fabrics: [], stray: false, alsoOn: [] }] },
      { family: null, members: [{ row: 14, fabrics: [], stray: false, alsoOn: [12] }] },
    ]);
  });

  it("names only the occurrences OUTSIDE a family as also-on", () => {
    const lines = [item(12, "ZZ-FUR-03"), item(13, "ZZ-FUR-03"), item(14, "ZZ-FUR-26"), item(15, "ZZ-FUR-03")];
    const groups = shape(lines);
    expect(groups[0]!.members.map((member) => member.alsoOn)).toEqual([[15], [15]]);
    expect(groups[2]!.members[0]!.alsoOn).toEqual([12, 13]);
  });

  it("leaves an ignored line out of every family and every also-on", () => {
    const lines = [
      item(12, "ZZ-FUR-03"),
      item(13, "ZZ-FUR-03", { ignored: true }),
      item(14, "ZZ-FUR-03"),
      item(15, "ZZ-FUR-26", { ignored: true }),
      item(16, "ZZ-FUR-26"),
    ];
    const groups = shape(lines);
    // The ignored row 13 breaks the run, so 12 and 14 are not a family.
    expect(groups.every((group) => group.family === null)).toBe(true);
    expect(groups.map((group) => group.members[0]!.alsoOn)).toEqual([[14], [], [12], [], []]);
  });

  it("does not count a fabric's code as a client ref two lines share", () => {
    const lines = [item(9, "ZZ-FUR-10"), fabric(10, 9, { code: "ZZ-FUR-10" })];
    expect(shape(lines)[0]!.members[0]!.alsoOn).toEqual([]);
  });

  it("keeps bill order exactly, row for row", () => {
    const lines = [
      item(9, "ZZ-FUR-10"),
      fabric(10, 9),
      item(11, "ZZ-FUR-03", { notes: "OPTION 1" }),
      fabric(12, 11),
      item(13, "ZZ-FUR-03", { notes: "OPTION 2" }),
      fabric(14, 9),
      fabric(15, 13),
      item(16, null, { rowKind: "subtotal", ignored: true }),
    ];
    expect(rowsInOrder(lines)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
