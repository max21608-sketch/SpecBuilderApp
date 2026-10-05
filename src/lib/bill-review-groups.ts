// How the bill review groups its rows — an item and the fabric lines hanging
// off it, and the items of one code that sit together.
//
// ============================================================================
// LAYOUT ONLY. Nothing here decides what a line IS or what the confirm writes.
//
// The kinds are `boq-row-kinds`' (who said a line is a fabric, and for which
// item), and the confirm reads them, not this. What this decides is where the
// screen draws its lines: a physical gap BEFORE each group, a fabric indented
// under its item, a bracket round consecutive items of one code. Four things
// about it are traps rather than preferences:
//
//   * BILL ORDER IS KEPT EXACTLY. Concatenating every member's line and its
//     fabrics in group order gives back the input, row for row. A fabric line
//     the bill printed somewhere other than under its item stays where the bill
//     put it — as a group of its own, `stray`, outside any rail — because moving
//     it under its item would show a layout the bill does not have, and the row
//     number would then point at the wrong place in the spreadsheet.
//   * A FABRIC HANGS OFF THE ITEM DIRECTLY ABOVE IT, and only that one: it must
//     name that item's row (`finishFor.row`) and nothing but its sister fabrics
//     may sit between them. One stray breaks the chain, so a later fabric
//     naming the same item is a stray too rather than reaching back over it.
//   * ONE FOLD, `normaliseRef`, the one every matcher uses — `S.201` and
//     `S-201` are one code here exactly as they are to the confirm. A family is
//     CONSECUTIVE live item lines of one code (Max, 2026-10-05: "if the
//     specifier is using the same code for both, then it's best to keep them
//     grouped"). It is a bracket, never a merge: each line is still its own
//     record. An ignored line is not in the bill, so it joins no family, breaks
//     the run it sits in, and is nobody's "also on".
//   * `alsoOn` IS THE REST OF THE DUPLICATE, NOT THE FAMILY. Two lines of one
//     code that are NOT adjacent keep the amber "same code twice" reading and
//     name each other; inside a family the heading already says it, so the
//     family's own members are left out. Fabric lines are not counted: a
//     fabric's code is not a client ref two records share — the rule the
//     duplicate panel already reads.
//
// Pure and leaf-level, so the screen and a pure-tier test read the same rule.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";

/** As much of a staged bill line as the grouping reads. The review's `Line` satisfies it. */
export type GroupableLine = {
  lineNo: number;
  code: string | null;
  itemDescription: string;
  notes?: string | null;
  ignored: boolean;
  rowKind?: string;
  finishFor?: { row: number; code: string | null } | null;
};

export type BillGroupMember<T> = {
  /** The line that opens this member: an item, a section/subtotal/blank, or a stray fabric. */
  line: T;
  /** The fabric lines directly under `line` that name it, in bill order. */
  fabrics: T[];
  /** True where `line` is a fabric line not hanging off the line above it. */
  stray: boolean;
  /** Rows of the OTHER live lines carrying this code, outside this family. */
  alsoOn: number[];
};

/** Consecutive live item lines of one code. */
export type BillFamily = {
  /** The code as the family's first line prints it. */
  code: string;
  /** How many item lines share it here. */
  lines: number;
  /** Every line's own words say "option" — the bill pricing alternatives. */
  options: boolean;
};

export type BillGroup<T> = {
  members: BillGroupMember<T>[];
  /** Null for an ordinary group: one line and its fabrics. */
  family: BillFamily | null;
};

const isFabric = (line: GroupableLine) => line.rowKind === "finish_for";
const isItem = (line: GroupableLine) => (line.rowKind ?? "item") === "item";

function refOf(code: string | null | undefined): string | null {
  if (!code || !code.trim()) return null;
  const key = normaliseRef(code);
  return key === "" ? null : key;
}

/** The family key of a member, or null where it can join none. */
function familyKey(member: BillGroupMember<GroupableLine>): string | null {
  if (member.stray || member.line.ignored || !isItem(member.line)) return null;
  return refOf(member.line.code);
}

const OPTION_WORD = /\boptions?\b/i;

function saysOption(line: GroupableLine): boolean {
  return OPTION_WORD.test(line.itemDescription ?? "") || OPTION_WORD.test(line.notes ?? "");
}

/**
 * The bill's lines as the review draws them: groups in bill order, a gap
 * before every group but the first.
 */
export function groupBillLines<T extends GroupableLine>(lines: readonly T[]): BillGroup<T>[] {
  // 1. Members: each non-fabric line opens one; a fabric joins the member
  //    above when it names that member's item, and is a stray otherwise.
  const members: BillGroupMember<T>[] = [];
  for (const line of lines) {
    const current = members[members.length - 1];
    if (isFabric(line)) {
      const hangs =
        current !== undefined &&
        !current.stray &&
        isItem(current.line) &&
        line.finishFor != null &&
        line.finishFor.row === current.line.lineNo;
      if (hangs) {
        current.fabrics.push(line);
        continue;
      }
      members.push({ line, fabrics: [], stray: true, alsoOn: [] });
      continue;
    }
    members.push({ line, fabrics: [], stray: false, alsoOn: [] });
  }

  // 2. Families: runs of two or more consecutive members sharing a key.
  const groups: BillGroup<T>[] = [];
  let index = 0;
  while (index < members.length) {
    const first = members[index] as BillGroupMember<T>;
    const key = familyKey(first);
    let end = index + 1;
    if (key !== null) {
      while (end < members.length && familyKey(members[end] as BillGroupMember<T>) === key) end += 1;
    }
    const run = members.slice(index, end);
    if (run.length > 1) {
      groups.push({
        members: run,
        family: {
          code: (first.line.code ?? "").trim(),
          lines: run.length,
          options: run.every((member) => saysOption(member.line)),
        },
      });
    } else {
      groups.push({ members: run, family: null });
    }
    index = end;
  }

  // 3. The duplicates the family does not explain.
  const rowsByKey = new Map<string, number[]>();
  for (const line of lines) {
    if (line.ignored || isFabric(line)) continue;
    const key = refOf(line.code);
    if (!key) continue;
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), line.lineNo]);
  }
  for (const group of groups) {
    const inFamily = new Set(group.family ? group.members.map((member) => member.line.lineNo) : []);
    for (const member of group.members) {
      if (member.line.ignored || isFabric(member.line)) continue;
      const key = refOf(member.line.code);
      if (!key) continue;
      member.alsoOn = (rowsByKey.get(key) ?? []).filter(
        (row) => row !== member.line.lineNo && !inFamily.has(row),
      );
    }
  }
  return groups;
}
