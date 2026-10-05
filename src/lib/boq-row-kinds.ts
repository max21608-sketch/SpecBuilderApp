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
//     model may cite and a person may accept, never a rule — EXCEPT where a
//     seeded layout carries a row rule (0042, `applyCategoryFinishRule`): the
//     Aman bill's own Category Code says `FBX-` on every fabric line, and for
//     that one layout, the category plus the item above is the document
//     speaking too. It runs after the bracket, which still wins.
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
 * Who said what kind a row is. `bill` is the bracket rule, or a seeded
 * layout's category rule — the document's own words — and is the only one that
 * needs neither a model nor a person.
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

// ---- a layout's row rule -------------------------------------------------------

/**
 * WHAT A SEEDED LAYOUT MAY SAY ABOUT ROWS (`boq_layouts.row_rules`, 0042).
 *
 * `finishForCategoryPrefix`: a line whose category column (`boqCategory`)
 * begins with this is a fabric line for the nearest item line above it. The
 * Aman pricing document writes `FBX-SEA-IN` in the Category Code of every
 * fabric line and prints it under its item — the bill's own column saying so,
 * which is why it can be a rule for THAT layout and never a global one.
 */
export type BoqLayoutRowRules = { finishForCategoryPrefix?: string };

/**
 * A stored `row_rules` value, validated. Anything unrecognised is dropped, and
 * a value that leaves nothing is null — "has a rule" is then one test.
 */
export function parseRowRules(value: unknown): BoqLayoutRowRules | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prefix = (value as Record<string, unknown>).finishForCategoryPrefix;
  if (typeof prefix !== "string" || prefix.trim() === "") return null;
  return { finishForCategoryPrefix: prefix.trim() };
}

type CategoryLine = KindLine & { boqCategory?: string | null };

const describeRow = (line: { lineNo: number; code: string | null }) =>
  `row ${line.lineNo}, ${line.code ?? "no code"}`;

/**
 * THE CATEGORY RULE, applied at staging AFTER the bracket rule and only where a
 * layout carries one. Returns a new list.
 *
 * "The item line above" is the nearest line above that is still an item: not
 * a fabric line by either rule, not ignored, and not itself in the fabric
 * category. Four outcomes, each a trap:
 *
 *   * THE BRACKET NAMED ONE ITEM LINE AND IT IS THE ONE ABOVE: kept, and the
 *     evidence says both agree.
 *   * THE BRACKET NAMED A DIFFERENT LINE: the bracket is kept — it is the
 *     document naming its item — and the row is flagged naming BOTH, because
 *     two readings of one bill that disagree are a person's to settle.
 *   * THE BRACKET NAMED NOTHING USABLE (no line carries it, or several and
 *     none above): the line goes under the item above by its category, and
 *     the flag says what the bracket said, so it is checked rather than
 *     silently read past.
 *   * NO ITEM LINE ABOVE IT: no parent, and a flag. It stays a line for a
 *     person to place or leave — never a fabric spec on a guessed item.
 *
 * A kind a person or a model set is never touched.
 */
export function applyCategoryFinishRule<T extends CategoryLine>(
  lines: readonly T[],
  rules: BoqLayoutRowRules | null | undefined,
): T[] {
  const prefix = rules?.finishForCategoryPrefix?.trim();
  if (!prefix) return [...lines];
  const want = prefix.toUpperCase();
  const isFabricCategory = (line: CategoryLine) => (line.boqCategory ?? "").trim().toUpperCase().startsWith(want);

  let above: T | null = null;
  return lines.map((line) => {
    if (!isFabricCategory(line)) {
      if (!line.ignored && (line.rowKind ?? "item") === "item") above = line;
      return line;
    }
    if (line.rowKind && line.rowKindSource !== "bill") return line;

    const category = (line.boqCategory ?? "").trim();
    const said = `Category Code ${category} — the bill's fabric line`;
    const parent = above as T | null;

    // The bracket placed it.
    if (line.rowKind === "finish_for" && line.finishFor) {
      if (parent && line.finishFor.row === parent.lineNo) {
        return { ...line, rowKindEvidence: `${line.rowKindEvidence ?? ""} ${said}, under it.`.trim() };
      }
      const bracketRow = `row ${line.finishFor.row}, ${line.finishFor.code ?? "no code"}`;
      return {
        ...line,
        rowKindFlag:
          `The bracket names ${bracketRow}, but the item line above this fabric line is ` +
          `${parent ? describeRow(parent) : "none"}. The bracket is kept; check which item it belongs to.`,
      };
    }

    if (!parent) {
      return {
        ...line,
        rowKindFlag: `${said}, and there is no item line above it. Say which item it belongs to, or leave it as a line.`,
      };
    }

    const bracket = parseBracketCode(line.code);
    return {
      ...line,
      rowKind: "finish_for" as const,
      rowKindSource: "bill" as const,
      rowKindEvidence: `${said}; under ${describeRow(parent)}.`,
      rowKindFlag: bracket
        ? `The code names ${bracket.itemRef} in brackets, and no one item line on this sheet carries it; placed ` +
          `under ${describeRow(parent)}, the item line above, by its category. Check it.`
        : null,
      finishFor: { row: parent.lineNo, code: parent.code },
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

// ---- a fabric line that names no fabric ------------------------------------------

/**
 * Words a fabric line uses to SAY WHERE a fabric goes or WHAT a field is,
 * which name no fabric. Folded (lower case, punctuation as spaces).
 *
 *   * The bill's own lead and its position words — "Fabric Main Upholstery @
 *     Armchair (Option 1)": the item's name is taken off separately, and
 *     these are the rest of it.
 *   * Field labels — "Collection & Pattern Ref:", "Colour Ref:". A label with
 *     a VALUE after it is substance and stays; a label whose value is TBC
 *     leaves nothing, which is the point.
 *   * Filler — "technical details", "information".
 *
 * Deliberately a closed list of words that carry nothing, never a list of
 * words that DO: a fabric line that says anything this list does not know is
 * read as real, filed as an in-house fabric, and shown on the review before
 * anything is written. Missing a placeholder costs a TBC library row a person
 * can see; reading a real fabric as a placeholder loses it silently.
 */
const PLACEHOLDER_FILLER = new Set([
  // the lead, and where on the item
  "fabric", "fabrics", "main", "upholstery", "upholstered", "seat", "seats", "back", "backs", "inner", "outer",
  "arm", "arms", "cushion", "cushions", "piping", "contrast", "body", "base", "option", "options", "opt",
  // field labels
  "collection", "pattern", "ref", "refs", "reference", "colour", "colours", "color", "colors", "composition",
  "supplier", "width", "repeat", "code", "name", "no", "number", "weight", "quality", "design", "manufacturer",
  "brand", "type",
  // filler
  "technical", "details", "detail", "specification", "specifications", "spec", "specs", "information", "info",
  "to", "be", "the", "of", "for", "and", "as", "per", "see", "n", "a", "na", "tbd",
]);

function foldTokens(value: string): string[] {
  const folded = fold(value);
  return folded === "" ? [] : folded.split(" ");
}

/**
 * WHETHER A FABRIC LINE IS A PLACEHOLDER — "Fabric @ Armchair (Option 1)
 * Technical details TBC" — rather than a fabric (Max, 2026-10-05: "if they
 * haven't given it a code … it's probably bespoke", and a placeholder is never
 * filed and never matched).
 *
 * The bill's own lead is taken off first: everything up to an `@` (where
 * that is only lead words), then the item's NAME where it opens what is left
 * (`parentName`, the item line's first line — matched word by word, and "Arm
 * Chair" against "Armchair" as one word), then position words and the option
 * number. What is left is a placeholder when it
 * is nothing but TBC tokens (`TBC_TOKENS`, the one list) and the filler above.
 *
 * "Collection & Pattern Ref: <a collection> … Pattern Repeat: TBC" is NOT a
 * placeholder: it names a collection, and a TBC on one field does not undo
 * that. Pure, so the review's sentence and the confirm read one answer.
 */
/**
 * The fabric's OWN code: the bracket removed, `N/A` and blank as none, and NONE
 * where it is the item's own code — a fabric line whose code is its item's
 * names no fabric at all. The confirm files by it and the review's chip prints
 * it, so the two cannot disagree (2026-10-05: the chip printed `GR-FUR-22 →
 * next free COM` on a line the confirm filed as uncoded).
 */
export function fabricOwnCode(line: { code: string | null; finishFor?: { code: string | null } | null }): string | null {
  let ownCode = fabricCodeOf(line.code);
  const parentCode = line.finishFor?.code ?? null;
  if (!ownCode || !parentCode) return ownCode;
  if (normaliseRef(ownCode) === normaliseRef(parentCode)) return null;
  // THE ITEM'S CODE WRITTEN AFTER THE FABRIC'S, WITHOUT THE BRACKET. The Aman
  // bill writes `GR-FAB-13 (PL-FUR-10)` on most fabric lines and
  // `GR-FAB-13 PL-FUR-04` on one, which filed a second library entry called
  // "GR-FAB-13 PL-FUR-04" beside GR-FAB-13. Only the item's OWN code is taken
  // off, matched whole on the last word — never "a second word that looks
  // like a code", which would cut a client code that genuinely has a space.
  const words = ownCode.split(/\s+/);
  if (words.length > 1 && normaliseRef(words[words.length - 1] as string) === normaliseRef(parentCode)) {
    ownCode = words.slice(0, -1).join(" ");
  }
  return ownCode;
}

export function fabricLineIsPlaceholder(text: string | null | undefined, parentName: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (raw === "") return true;

  // 1. The lead: "Fabric … @" — everything before the first `@` is the bill
  //    saying this is a fabric line, and where it goes.
  const at = raw.indexOf("@");
  const leadBefore = at >= 0 ? raw.slice(0, at) : "";
  const leadIsTheBills =
    at >= 0 && foldTokens(leadBefore).every((token) => PLACEHOLDER_FILLER.has(token) || /^\d+$/.test(token));
  let tokens = foldTokens(leadIsTheBills ? raw.slice(at + 1) : raw);

  // 2. The item's name, where it OPENS what is left ("Fabric for Armchair …"
  //    as much as "Fabric @ Armchair …"). Only at the start: the same word
  //    later in the line may be the fabric's own name.
  const parent = new Set(foldTokens(parentName ?? ""));
  const phrases = TBC_TOKENS.map((token) => token.split(" ")).sort((a, b) => b.length - a.length);
  const phraseAt = (at: number) => phrases.find((words) => words.every((word, k) => tokens[at + k] === word));
  let start = 0;
  while (start < tokens.length) {
    const token = tokens[start] as string;
    const next = tokens[start + 1];
    // A TBC phrase ends the lead: "to" and "be" are filler words on their own,
    // and stripping them would leave "confirmed" to read as a fabric.
    if (phraseAt(start)) break;
    // Two words that make the item's one ("Arm Chair" for "Armchair") first:
    // `arm` alone is a position word and would leave `chair` behind.
    if (next !== undefined && parent.has(`${token}${next}`)) start += 2;
    else if (parent.has(token) || PLACEHOLDER_FILLER.has(token) || /^\d+$/.test(token)) start += 1;
    else break;
  }
  tokens = tokens.slice(start);

  // 3. The TBC phrases, as whole words, then the option number and filler.
  const left: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const phrase = phraseAt(i);
    if (phrase) {
      i += phrase.length;
      continue;
    }
    const token = tokens[i] as string;
    const previous = tokens[i - 1];
    const optionNumber = /^\d+$/.test(token) && (previous === "option" || previous === "opt" || previous === "no");
    if (!optionNumber && !PLACEHOLDER_FILLER.has(token)) left.push(token);
    i += 1;
  }
  return left.length === 0;
}
