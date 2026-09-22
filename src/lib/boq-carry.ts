// A decision taken on one phase's tab reaches the same client ref on the others.
//
// ============================================================================
// WHY THIS EXISTS
//
// A bill has tabs and each tab is a PHASE — `MUR`, `MAIN RUN`, a
// value-engineered phase — quoting the SAME codes at different quantities. So
// `S-100` is a line on every tab, and accepting its level on one left the same
// item on the next still reading the dashed suggestion, with *Accept all 12*
// above it. Max, 2026-09-22: *"when I've confirmed the level in the first phase
// they don't automatically fill in on the next phase — if they're the same
// reference number they should automatically be filled in, and any adjustment
// to a category or a level should affect that item no matter where it was."*
//
// The two tabs already AGREE about the guess: `level-guess` runs per bill line
// and both print `Simple` with the same reason. What does not carry is the
// AGREEMENT. Nothing here makes a second inference — it moves a decision a
// person took, and the receiving row says where it came from.
//
// THE CAVEAT, RECORDED RATHER THAN RE-ARGUED: a value-engineered phase may
// legitimately be a cheaper build, so *hero on MAIN RUN, simple on VE* can be a
// true statement rather than a missed tick — and the level is what picks the
// BWS boilerplate the item is priced against. Max chose on 2026-09-22 to carry
// both the category and the level outright anyway. The mitigation he did not
// rule out is the one this module implements: the receiving row SAYS it was
// carried, from which tab, and can be changed there.
//
// AT EDIT TIME, IN THE STAGED JSON — never inside the confirm. Writing into
// phases the reviewer never opened is *never commit a card somebody did not see
// whole* in a new place, and the confirm already re-checks what the reviewer
// submitted rather than what a fresh match would produce now.
//
// A LEAF: `record-refs` (itself a leaf) and nothing else, because the review
// SCREEN and the PATCH route both read it and a client component must not pull
// the database driver into the browser bundle.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";

/**
 * A staged line, as much of one as the carry needs.
 *
 * Structural and permissive on purpose: `StagedBoqLine` is the canonical shape,
 * and the review screen declares its own `Line` because it renders fields the
 * confirm has no use for. Both satisfy this.
 */
export type CarryLine = {
  index: number;
  lineNo?: number;
  code?: string | null;
  ignored?: boolean;
  level?: string | null;
  levelStatus?: string | null;
  levelCarriedFrom?: string | null;
  categoryId?: string | null;
  categoryStatus?: string | null;
  categoryCarriedFrom?: string | null;
};

export type CarrySheet = {
  sheetName?: string | null;
  proposedRunName?: string | null;
  ignored?: boolean;
  lines: CarryLine[];
};

/** What one press decided. A CLEAR never carries — see `planCarry`. */
export type CarryDecision =
  | { field: "level"; level: string }
  | { field: "category"; categoryId: string };

/** One receiving row, and the patch that lands on it. */
export type CarryTarget = {
  sheetIndex: number;
  index: number;
  /** The tab it landed on, for the sentence a caller reports. */
  tab: string;
  patch: Record<string, unknown>;
};

/**
 * The tab's name, as the tab strip prints it.
 *
 * The receiving row quotes this, so a reviewer looking at *carried from MUR*
 * can find MUR in the strip above. Falling back the other way round — the sheet
 * name first — would name a tab the screen does not show.
 */
export function tabLabel(sheet: CarrySheet): string {
  return (sheet.proposedRunName || sheet.sheetName || "another tab").trim() || "another tab";
}

/**
 * ONE FOLD, AND IT IS `normaliseRef`.
 *
 * The fold `findRecordsByRef` matches on, never `boq-import`'s looser one.
 * CLAUDE.md records what that difference already cost once: `S.201` against
 * `S-201` read as a new line beside a retired one, and confirming that revision
 * would have retired a record with its drawings, specs and picture over a dot.
 *
 * Null where there is nothing to match on. A line with no code reaches nothing
 * and is reached by nothing — a blank is not a ref every other blank shares.
 */
export function refKey(code: string | null | undefined): string | null {
  if (!code || !code.trim()) return null;
  const key = normaliseRef(code);
  return key === "" ? null : key;
}

/** The live lines of a sheet: an ignored line is not in the bill. */
function liveLines(sheet: CarrySheet): CarryLine[] {
  return (sheet.lines ?? []).filter((line) => !line.ignored);
}

/**
 * The normalised refs this sheet carries on more than one live line.
 *
 * THE `SX11A` CASE. The pilot bill carries `SX11A` twice at different
 * quantities, and `findRecordsByRef`'s rule is the one that applies: offer the
 * candidates, choose none. A ref repeated inside a tab therefore fans out to
 * NOTHING, in both directions — it cannot send a decision, because which of the
 * two rows was decided says nothing about the other, and it cannot receive one,
 * because there is no single row to put it on.
 */
export function duplicateRefs(sheet: CarrySheet): Set<string> {
  const counts = new Map<string, number>();
  for (const line of liveLines(sheet)) {
    const key = refKey(line.code);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

/**
 * The duplicate refs of one sheet, with the rows that carry each.
 *
 * The ROWS are the point. "One client ref appears on more than one line" sends
 * somebody hunting up the table; "Rows 17 and 18 carry the same ref" is the
 * answer, and it goes under the rows it is about rather than in a banner at the
 * top of the page.
 *
 * It lives HERE, beside the carry, rather than on the screen where it was
 * written: the set of refs that fan out to nothing is exactly this set, and two
 * implementations of it is how the amber panel and the carry come to disagree
 * about which rows are ambiguous. The fold moved to `normaliseRef` with it, so
 * `S-100` and `S.100` on one tab are now named as the duplicates they are —
 * which is what the pairing in `boq-reconcile` has always read them as.
 */
export function duplicateGroups(sheet: CarrySheet): { code: string; lineNos: number[] }[] {
  const seen = new Map<string, { code: string; lineNos: number[] }>();
  for (const line of liveLines(sheet)) {
    const key = refKey(line.code);
    if (!key) continue;
    const entry = seen.get(key) ?? { code: (line.code ?? "").trim(), lineNos: [] };
    entry.lineNos.push(line.lineNo ?? line.index + 1);
    seen.set(key, entry);
  }
  return [...seen.values()].filter((entry) => entry.lineNos.length > 1);
}

/** Does this line share its ref with another live line of the same sheet? */
export function isDuplicated(sheet: CarrySheet, line: CarryLine): boolean {
  if (line.ignored) return false;
  const key = refKey(line.code);
  if (!key) return false;
  return duplicateRefs(sheet).has(key);
}

/**
 * Has a PERSON settled this field on this row, here, themselves?
 *
 * A carried value is chosen too — that is the whole point, it arrives as the
 * decision it is — so `chosen` alone cannot tell the two apart, and the marker
 * is what does. A row somebody decided on ITS OWN tab wins over an incoming
 * carry: that is the trap this module exists inside, and the reason a later
 * decision on one tab does not silently rewrite an earlier one on another.
 *
 * A parser SUGGESTION is not a decision and is overwritten without ceremony.
 */
function decidedHere(line: CarryLine, field: CarryDecision["field"]): boolean {
  if (field === "level") {
    return line.levelStatus === "chosen" && !line.levelCarriedFrom;
  }
  return line.categoryStatus === "chosen" && !line.categoryCarriedFrom;
}

/** Does this row already hold exactly what the carry would write? */
function alreadyHolds(line: CarryLine, decision: CarryDecision, from: string): boolean {
  if (decision.field === "level") {
    return line.level === decision.level && line.levelCarriedFrom === from;
  }
  return line.categoryId === decision.categoryId && line.categoryCarriedFrom === from;
}

function patchFor(decision: CarryDecision, from: string): Record<string, unknown> {
  if (decision.field === "level") {
    return {
      level: decision.level,
      // `chosen` is what tells the confirm to write `spec_records.level` — the
      // column the quote gate reads — rather than the advisory
      // `level_suggested`. A carried level IS a person's decision, so it
      // arrives as one; `levelCarriedFrom` is what keeps it honest about whose
      // tab they took it on.
      levelStatus: "chosen",
      levelReason: null,
      levelCarriedFrom: from,
    };
  }
  return {
    categoryId: decision.categoryId,
    categoryStatus: "chosen",
    categoryCarriedFrom: from,
  };
}

/**
 * Every row a decision reaches, with the patch that lands on it.
 *
 * PURE, and the testable core of this item: staged sheets plus one decision in,
 * a list of `(sheetIndex, index)` out. The caller writes them.
 *
 * It returns nothing at all — which is a normal answer, not a failure — when:
 *
 *   - the source sheet or line is gone, or either is ignored;
 *   - the source line carries no client ref to match on;
 *   - the source sheet carries that ref on more than one live line (`SX11A`);
 *   - no other tab lists the ref, which is the ordinary one-phase bill.
 *
 * And it skips an individual receiving tab where that tab is ignored, carries
 * the ref twice, has already been decided on by a person, or already holds
 * exactly this carry.
 *
 * A CLEAR IS NOT CARRIED, and the caller enforces that by never building a
 * decision from one. "— not set —" is *I do not know yet*, and pushing that
 * across the bill would destroy values on tabs nobody opened with no decision
 * behind it. The person who cleared it cleared one row.
 */
export function planCarry(
  sheets: CarrySheet[],
  source: { sheetIndex: number; index: number },
  decision: CarryDecision,
): CarryTarget[] {
  const sourceSheet = sheets?.[source.sheetIndex];
  if (!sourceSheet || sourceSheet.ignored) return [];
  const sourceLine = (sourceSheet.lines ?? []).find((line) => line.index === source.index);
  if (!sourceLine || sourceLine.ignored) return [];

  const key = refKey(sourceLine.code);
  if (!key) return [];
  if (duplicateRefs(sourceSheet).has(key)) return [];

  const from = tabLabel(sourceSheet);
  const targets: CarryTarget[] = [];

  sheets.forEach((sheet, sheetIndex) => {
    if (sheetIndex === source.sheetIndex || sheet.ignored) return;
    if (duplicateRefs(sheet).has(key)) return;
    const match = liveLines(sheet).find((line) => refKey(line.code) === key);
    if (!match) return;
    if (decidedHere(match, decision.field)) return;
    if (alreadyHolds(match, decision, from)) return;
    targets.push({ sheetIndex, index: match.index, tab: tabLabel(sheet), patch: patchFor(decision, from) });
  });

  return targets;
}

/**
 * "and MAIN RUN - VE", for the sentence the screen reports after a press.
 */
export function listTabs(targets: CarryTarget[]): string {
  const names = [...new Set(targets.map((target) => target.tab))];
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
