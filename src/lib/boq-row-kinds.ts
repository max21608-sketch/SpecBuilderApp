// What KIND of row a bill line is, and the one rule code applies on its own.
//
// ============================================================================
// A BILL IS NOT ONE ITEM PER ROW (plan any-bill, Step 2, 2026-09-23).
//
// The Aman pricing document puts each item's fabric on its OWN line directly
// under it: category `FBX-…`, unit `m`, no quantity, and a code that names the
// fabric with the item in brackets — `GR-FAB-13 (GR-FUR-10)`. Read as items,
// those 34 lines became 34 records called "Fabric @ Stool", each with no
// quantity, and the item they describe carried no fabric at all. Max, the same
// day: a fabric line becomes a COM spec on its item, not a record.
//
// So every staged line may carry a KIND, and four things about it are traps
// rather than preferences:
//
//   * THE BRACKET IS THE DOCUMENT SPEAKING, so it is the ONE rule applied
//     without a model or a person (`applyBracketRule`). `<X> (<Y>)` where `<Y>`
//     folds — `record-refs`' `normaliseRef`, the one fold every matcher uses —
//     to exactly ONE item line's code on the sheet is a fabric line for that
//     line, unflagged. Where `<Y>` is on two lines (OPTION 1 / OPTION 2 carry
//     one code), the NEARER ONE ABOVE is proposed and flagged amber; where it
//     is on none, nothing is inferred and the row says so. A plain fabric code
//     on the line under an item is NOT read as one: position is evidence the
//     model may cite and a person may accept, never a rule.
//   * A FABRIC LINE ALWAYS NAMES ITS ITEM. `rowKind: "finish_for"` without a
//     `finishFor` is unrepresentable by the writers here, and `rowKindProblems`
//     refuses one on the review and at the confirm with the same sentence.
//   * SECTION, SUBTOTAL AND BLANK DEFAULT TO IGNORED, and say why. Nothing
//     sets those kinds by rule — a model reads them with evidence or a person
//     picks them — and the Include box puts one back in one click.
//   * THE KIND IS STORED ON THE STAGED LINE, like the category and the level,
//     so the confirm writes what the reviewer saw. The PROBLEMS are computed,
//     never stored (the `proposalBlockers()` rule): an item line changed to a
//     section orphans the fabric under it, and a stored blocker would be stale
//     the moment that happened.
//
// A leaf, and pure: the review screen, the confirm and `npm run boq:gap` all
// read the same rule, and a client component can import it.
// ============================================================================
import { normaliseRef } from "@/lib/record-refs";
import { TBC_TOKENS, containsPhrase } from "@/lib/spec-vocab";

/** What a row of a bill IS. Order is the review's select order. */
export const BOQ_ROW_KINDS = ["item", "finish_for", "section", "subtotal", "blank"] as const;
export type BoqRowKind = (typeof BOQ_ROW_KINDS)[number];

export function isBoqRowKind(value: unknown): value is BoqRowKind {
  return typeof value === "string" && (BOQ_ROW_KINDS as readonly string[]).includes(value);
}

export const BOQ_ROW_KIND_LABELS: Record<BoqRowKind, string> = {
  item: "Item",
  finish_for: "Fabric for…",
  section: "Section heading",
  subtotal: "Subtotal",
  blank: "Blank",
};

/** The kinds that are not a thing to make, and are ignored until somebody says otherwise. */
export const IGNORED_ROW_KINDS: readonly BoqRowKind[] = ["section", "subtotal", "blank"];

/** Why such a line is ignored, printed where the Include box is. */
export const IGNORED_BECAUSE: Record<"section" | "subtotal" | "blank", string> = {
  section: "a section heading, not an item",
  subtotal: "a subtotal, not an item",
  blank: "a blank row, not an item",
};

/**
 * Who said what kind a row is. `bill` is the bracket rule — the document's own
 * words — and is the only one that needs neither a model nor a person.
 */
export type BoqRowKindSource = "bill" | "model" | "person";

/** The item line a fabric line belongs to: its ROW on the sheet, and its code. */
export type FinishFor = { row: number; code: string | null };

/** The kind fields a staged line may carry. All optional: a v3/v4 line before Step 2 has none. */
export type RowKindFields = {
  rowKind?: BoqRowKind;
  rowKindSource?: BoqRowKindSource;
  /** What the kind was read from, in words. */
  rowKindEvidence?: string | null;
  /** Amber: a reading a person has to check, or a question nothing answered. */
  rowKindFlag?: string | null;
  finishFor?: FinishFor | null;
  /** Why an ignored line is ignored, where it was not a person's untick. */
  ignoredBecause?: string | null;
};

type KindLine = RowKindFields & { lineNo: number; code: string | null; ignored?: boolean };

// ---- the bracket rule --------------------------------------------------------

const BRACKETED = /^(.*?)\s*\(([^()]+)\)\s*$/;

/**
 * `GR-FAB-13 (GR-FUR-10)` → the fabric's code and the item it names. Null for
 * a code with no trailing bracket. The fabric half may be empty (`(GR-FUR-10)`
 * alone), which is still the bill naming its item.
 */
export function parseBracketCode(code: string | null | undefined): { fabricCode: string | null; itemRef: string } | null {
  const match = BRACKETED.exec((code ?? "").trim());
  if (!match) return null;
  const itemRef = (match[2] ?? "").trim();
  if (normaliseRef(itemRef) === "") return null;
  const fabric = (match[1] ?? "").trim();
  return { fabricCode: fabric === "" ? null : fabric, itemRef };
}

/** What a fabric line's own code is as a finish code: the bracket removed, `N/A` and blank as none. */
export function fabricCodeOf(code: string | null | undefined): string | null {
  const bracket = parseBracketCode(code);
  const raw = (bracket ? (bracket.fabricCode ?? "") : (code ?? "")).trim();
  if (raw === "") return null;
  if (/^n\s*\/?\s*a$/i.test(raw) || /^-+$/.test(raw)) return null;
  return raw;
}

/** An item line: anything not already a fabric line and not bracketed itself. */
function isItemCandidate(line: KindLine): boolean {
  if (line.rowKind && line.rowKind !== "item") return false;
  return parseBracketCode(line.code) === null;
}

/**
 * THE ONE RULE CODE APPLIES ON ITS OWN. Returns a new list; a line that already
 * carries a kind (a person's, a model's) is left exactly as it is.
 */
export function applyBracketRule<T extends KindLine>(lines: readonly T[]): T[] {
  const byRef = new Map<string, T[]>();
  for (const line of lines) {
    if (!line.code || !isItemCandidate(line)) continue;
    const ref = normaliseRef(line.code);
    if (!ref) continue;
    byRef.set(ref, [...(byRef.get(ref) ?? []), line]);
  }

  return lines.map((line) => {
    if (line.rowKind) return line;
    const bracket = parseBracketCode(line.code);
    if (!bracket) return line;
    const candidates = (byRef.get(normaliseRef(bracket.itemRef)) ?? []).filter((other) => other !== line);

    if (candidates.length === 1) {
      const parent = candidates[0] as T;
      return {
        ...line,
        rowKind: "finish_for" as const,
        rowKindSource: "bill" as const,
        rowKindEvidence: `The code names ${bracket.itemRef} in brackets, and row ${parent.lineNo} carries it.`,
        rowKindFlag: null,
        finishFor: { row: parent.lineNo, code: parent.code },
      };
    }
    if (candidates.length > 1) {
      const above = candidates.filter((other) => other.lineNo < line.lineNo).sort((a, b) => b.lineNo - a.lineNo)[0];
      if (above) {
        return {
          ...line,
          rowKind: "finish_for" as const,
          rowKindSource: "bill" as const,
          rowKindEvidence: `The code names ${bracket.itemRef} in brackets.`,
          rowKindFlag:
            `${candidates.length} lines carry ${bracket.itemRef} — this is the nearer one above (row ${above.lineNo}); ` +
            "check it.",
          finishFor: { row: above.lineNo, code: above.code },
        };
      }
      return {
        ...line,
        rowKindFlag:
          `The code names ${bracket.itemRef} in brackets, and ${candidates.length} lines carry it, none of them above ` +
          "this one. Say which item this fabric belongs to.",
      };
    }
    return {
      ...line,
      rowKindFlag:
        `The code names ${bracket.itemRef} in brackets, and no line on this sheet carries it. Say which item this ` +
        "fabric belongs to, or leave it as a line.",
    };
  });
}

// ---- what a person may choose ------------------------------------------------

/**
 * The item lines a fabric line can belong to: the ones ABOVE it, nearest
 * first, that are items and still live. A fabric printed under its item is the
 * layout that asked for this; an item BELOW is not offered, because offering
 * every line on a 300-line sheet is a select nobody can use.
 */
export function fabricParentOptions<T extends KindLine>(lines: readonly T[], line: KindLine): T[] {
  return lines
    .filter((other) => other.lineNo < line.lineNo && !other.ignored && (other.rowKind ?? "item") === "item")
    .sort((a, b) => b.lineNo - a.lineNo);
}

/**
 * The patch a person's choice of kind writes. One implementation, so the route
 * and a test cannot disagree about what "Section" does to the Include box.
 */
export function kindChoicePatch(kind: BoqRowKind, parent: { row: number; code: string | null } | null): RowKindFields & {
  ignored: boolean;
} {
  const base = { rowKind: kind, rowKindSource: "person" as const, rowKindEvidence: null, rowKindFlag: null };
  if (kind === "finish_for") return { ...base, finishFor: parent, ignored: false, ignoredBecause: null };
  if (kind === "item") return { ...base, finishFor: null, ignored: false, ignoredBecause: null };
  return { ...base, finishFor: null, ignored: true, ignoredBecause: IGNORED_BECAUSE[kind] };
}

// ---- what stops a confirm ----------------------------------------------------

/**
 * Every fabric line that cannot be written, with the sentence saying why.
 * Computed on every read and at the confirm — never stored — because an item
 * line changed to a section, or unticked, orphans the fabric under it.
 */
export function rowKindProblems(lines: readonly KindLine[]): { lineNo: number; problem: string }[] {
  const byRow = new Map(lines.map((line) => [line.lineNo, line]));
  const out: { lineNo: number; problem: string }[] = [];
  for (const line of lines) {
    if (line.ignored || line.rowKind !== "finish_for") continue;
    if (!line.finishFor) {
      out.push({ lineNo: line.lineNo, problem: `Row ${line.lineNo} is a fabric line that names no item. Say which item it belongs to.` });
      continue;
    }
    const parent = byRow.get(line.finishFor.row);
    if (!parent) {
      out.push({
        lineNo: line.lineNo,
        problem: `Row ${line.lineNo}'s fabric belongs to row ${line.finishFor.row}, which is not a line of this sheet.`,
      });
    } else if ((parent.rowKind ?? "item") !== "item") {
      out.push({
        lineNo: line.lineNo,
        problem: `Row ${line.lineNo}'s fabric belongs to row ${parent.lineNo}, which is no longer an item. Choose its item again.`,
      });
    } else if (parent.ignored) {
      out.push({
        lineNo: line.lineNo,
        problem:
          `Row ${line.lineNo}'s fabric belongs to row ${parent.lineNo}, which is not being imported. Include row ` +
          `${parent.lineNo}, or leave the fabric out.`,
      });
    }
  }
  return out;
}

// ---- what a confirm will do ---------------------------------------------------

/** Records and fabric specs a confirm writes, over the LIVE sheets. */
export function boqConfirmCounts(sheets: readonly { ignored: boolean; lines: readonly KindLine[] }[]): {
  records: number;
  fabricSpecs: number;
  phases: number;
} {
  let records = 0;
  let fabricSpecs = 0;
  let phases = 0;
  for (const sheet of sheets) {
    if (sheet.ignored) continue;
    let live = 0;
    for (const line of sheet.lines) {
      if (line.ignored) continue;
      if (line.rowKind === "finish_for") fabricSpecs += 1;
      else {
        records += 1;
        live += 1;
      }
    }
    if (live > 0) phases += 1;
  }
  return { records, fabricSpecs, phases };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The header's Confirm label. It says what the press writes — records AND
 * fabric specs — and, while a sheet still needs its columns, the one thing to
 * do first instead of "creates 0 records on 2 phases".
 */
export function boqConfirmLabel(input: {
  counts: { records: number; fabricSpecs: number; phases: number };
  revising: boolean;
  unmapped: number;
  busy: boolean;
}): string {
  if (input.busy) return "Importing…";
  if (input.unmapped > 0) return "Set the columns first";
  const { records, fabricSpecs, phases } = input.counts;
  const fabrics = fabricSpecs > 0 ? ` and ${plural(fabricSpecs, "fabric spec", "fabric specs")}` : "";
  if (input.revising) return `Confirm · updates this phase from ${plural(records, "line", "lines")}${fabrics}`;
  return `Confirm · creates ${plural(records, "record", "records")}${fabrics} on ${plural(phases, "phase", "phases")}`;
}

// ---- a fabric line's state -------------------------------------------------------

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * `tbc` WHEREVER THE BILL WRITES A TBC TOKEN ON THE FABRIC, and confirmed
 * otherwise. A fabric line packs several statements into one cell ("Fabric @
 * Armchair (Option 1) Technical details TBC"), and the only safe reading of a
 * TBC anywhere in it is that the fabric is not settled: a confirmed state over
 * a value somebody has not decided is the one wrong answer a gate cannot see.
 * The value itself is always the bill's words, verbatim.
 */
export function fabricLineState(value: string): "tbc" | "confirmed" {
  const folded = fold(value);
  if (folded === "") return "tbc";
  return TBC_TOKENS.some((token) => containsPhrase(folded, token)) ? "tbc" : "confirmed";
}
