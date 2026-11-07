// Which lines of a bill look like ONE item on two lines (0060). A LEAF: the
// bill review reads it in the browser, so it imports nothing that reaches the
// database (the `intake-status.ts` rule).
import { normaliseRef } from "@/lib/record-refs";
import { zonedCodeParts } from "@/lib/finishes";

/** What `suggestTwins` reads off a staged bill line. */
export type TwinCandidateLine = {
  lineNo: number;
  code: string | null;
  ignored?: boolean;
  rowKind?: string;
};

export type TwinSuggestion = {
  /** The row this line is suggested as a twin of: the first line of its group. */
  twinOf: number;
  /** What it was read from, in words, for the `SuggestButton`. */
  evidence: string;
};

/**
 * Which lines of ONE sheet look like one item on two lines. Two rules, and no
 * third (T3, 2026-11-06):
 *
 *   * the same code under different ZONE prefixes — `GR-FUR-13` and
 *     `PL-FUR-13` (`zonedCodeParts`, the finishes library's own reading of a
 *     zone);
 *   * the same code on two lines — `SX11A` twice.
 *
 * NOT identical descriptions: "Armchair" is forty different chairs on a big
 * bill, and a match by accident would put a spec on a chair it was never for
 * the moment somebody accepted it. Only item lines are read; a fabric line,
 * a section row and an ignored line are never anybody's twin.
 *
 * A suggestion decides nothing. The review prints it as a `SuggestButton`,
 * accepting stages `twinOf` on the line, and only the confirm writes a link,
 * from an accepted line.
 */
export function suggestTwins(lines: readonly TwinCandidateLine[]): Map<number, TwinSuggestion> {
  const groups = new Map<string, TwinCandidateLine[]>();
  for (const line of lines) {
    if (line.ignored) continue;
    if (line.rowKind && line.rowKind !== "item") continue;
    const code = line.code?.trim();
    if (!code) continue;
    const zoned = zonedCodeParts(code);
    // Two keys that never meet: a zoned code groups by what follows its zone,
    // anything else by its whole folded ref. A bare `FUR-13` beside
    // `GR-FUR-13` is NOT suggested — the bill writing one without its zone is
    // not evidence that the item is on two floors.
    const key = zoned ? `zone:${zoned.tail}` : `ref:${normaliseRef(code)}`;
    if (key === "ref:") continue;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  const out = new Map<number, TwinSuggestion>();
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.lineNo - b.lineNo);
    const first = sorted[0]!;
    for (const line of sorted.slice(1)) {
      const a = first.code!.trim();
      const b = line.code!.trim();
      const zoneA = zonedCodeParts(a)?.zone;
      const zoneB = zonedCodeParts(b)?.zone;
      const evidence =
        key.startsWith("zone:") && zoneA !== zoneB
          ? `${b} and ${a} (row ${first.lineNo}) are one code, ${key.slice(5)}, under two zones (${zoneB}, ${zoneA}).`
          : `Row ${first.lineNo} carries the same code, ${a}.`;
      out.set(line.lineNo, { twinOf: first.lineNo, evidence });
    }
  }
  return out;
}

/**
 * The pairs to link from the lines a person ACCEPTED, each accepted line
 * naming the row it is a twin of. Three lines of one stool are three pairs,
 * not two: row 30 and row 31 both accepted as twins of row 24 are twins of
 * each other too, or a drawing on rows 30 and 31 would read as SX11A.
 */
export function acceptedTwinPairs(accepted: readonly { lineNo: number; twinOf: number }[]): [number, number][] {
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let root = n;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const { lineNo, twinOf } of accepted) {
    if (lineNo === twinOf) continue;
    if (!parent.has(lineNo)) parent.set(lineNo, lineNo);
    if (!parent.has(twinOf)) parent.set(twinOf, twinOf);
    const a = find(lineNo);
    const b = find(twinOf);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const components = new Map<number, number[]>();
  for (const n of parent.keys()) {
    const root = find(n);
    components.set(root, [...(components.get(root) ?? []), n]);
  }
  const pairs: [number, number][] = [];
  for (const members of components.values()) {
    const sorted = members.sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) pairs.push([sorted[i]!, sorted[j]!]);
    }
  }
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** What the confirm and the review read off a staged line to judge an accepted twin. */
export type TwinStagedLine = {
  lineNo: number;
  ignored?: boolean;
  rowKind?: string;
  twinOf?: { row: number; evidence: string } | null;
};

/**
 * True where this line, or the twin a person accepted for it, will not become
 * an item record (ignored since, or made a finish line). The confirm links
 * nothing for it and the review says so on the row, so a decision taken after
 * accepting never turns into a refused confirm.
 */
export function twinPartnerMissing(lines: readonly TwinStagedLine[], line: TwinStagedLine): boolean {
  if (!line.twinOf) return false;
  const notAnItem = (entry: TwinStagedLine | undefined) =>
    !entry || entry.ignored === true || (entry.rowKind !== undefined && entry.rowKind !== "item");
  return notAnItem(line) || notAnItem(lines.find((entry) => entry.lineNo === line.twinOf!.row));
}
