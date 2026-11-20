// A bill line that is a SECTION HEADING or a FINISH LINE, said as a question.
//
// ============================================================================
// A SUGGESTION, NEVER A DECISION (2026-11-20, an invented specifier's bill).
//
// A bill read by known headings (no model, no person) stages every row as an
// Item. Two shapes then become records nobody wanted:
//
//   * A SECTION HEADING — `GUEST ROOM TYPE A`, `BAR`, `RESTAURANT` — printed
//     in the code column with nothing else on the row. Confirmed, it is a
//     record called nothing, with no quantity, on the phase and in the file.
//   * A FINISH LINE — `FAB-01` / `Finish: Kvadrat Hallingdal 65…`, no
//     quantity — printed directly under its item. Confirmed, it is a record
//     called "Finish: …", and the item it describes carries no such finish.
//
// The simplest version decides both at parse time. The trap is the one
// `non-furniture-guess.ts` names: a rule is a guess, and a real item read as a
// heading is silently absent from the phase, the export and the quote. So, in
// that module's shape: a QUESTION with its evidence beside it, one click to
// accept, and nothing set on its own. Accepting writes the row's kind through
// the existing staged-row write (`kindChoicePatch`, the document's version
// sent with it), exactly as a person choosing it in the Kind control would,
// and that control is the way back.
//
// ---- WHAT EACH READS, AND WHAT IT NEVER DOES ---------------------------------
//
//   * ONLY A LINE NOBODY HAS GIVEN A KIND. A kind the bracket rule, a seeded
//     layout's row rule, a model's reading or a person set is never asked
//     about again — the bracket and the row rules still win, and what a seeded
//     layout or a model read stages is untouched. A bracketed code is left to
//     the bracket rule, and an ignored line is already out.
//   * SECTION HEADING: text in EXACTLY ONE of the code and description cells,
//     no quantity (not even a word, `TBC`), no unit, and NO OTHER CELL the
//     sheet's columns read. Never a line that looks like a finish (below), and
//     never one already asked about as not furniture — a subtotal's words are
//     that question, and two buttons on one row are one too many.
//   * FINISH LINE: no quantity, AND its code is a finish code by the readers
//     the app already has (`codeIsAFinishCode`: `FAB-01`, `GR-MTL-03`,
//     `F-WD-02`) OR its description BEGINS with a finish label (`Finish:`,
//     `Fabric:`, `Timber:` …). Its item is the nearest line ABOVE that is not
//     itself a finish line, a blank or another suggested finish line — and
//     only where that line is a live item. A section heading on the way up
//     (set, or suggested) stops the walk: a parent is NEVER guessed across a
//     heading, because the finish under `BAR` belongs to nothing above it.
//
// Computed on read, never stored, like `rowKindProblems`: accepting one
// suggestion changes the next (a heading accepted stops a walk), and a stored
// answer would be stale the moment that happened.
// ============================================================================
import { codeIsAFinishCode, parseBracketCode } from "@/lib/boq-row-kinds";
import { nonFurnitureOf, type NonFurnitureGuess } from "@/lib/non-furniture-guess";

/** The parts of a staged line this reads. Loose, so the review's and a tool's line types both fit. */
export type GuessLine = {
  lineNo: number;
  code: string | null;
  itemDescription: string;
  itemDescriptionRaw?: string | null;
  qty: number | null;
  qtyRaw?: string | null;
  qtyUnit?: string | null;
  area?: string | null;
  subArea?: string | null;
  boqCategory?: string | null;
  designer?: string | null;
  productReference?: string | null;
  sourceLine?: string | null;
  notes?: string | null;
  dimensionsRaw?: string | null;
  finishRaw?: string | null;
  finishCode?: string | null;
  mockupQtyRaw?: string | null;
  kept?: readonly { value?: string | null }[] | null;
  ignored?: boolean;
  rowKind?: string | null;
  categoryStatus?: string | null;
  nonFurnitureSuggested?: NonFurnitureGuess | null;
};

export type RowKindGuess =
  | {
      kind: "section";
      /** One sentence, for printing beside the button. */
      reason: string;
    }
  | {
      kind: "finish_for";
      /** The item line it is suggested for: its row and its code. */
      parent: { row: number; code: string | null };
      reason: string;
    };

/**
 * The words a finish line's description opens with, before a colon. The
 * generic finish nouns of `boq-row-kinds`' bracket test, plus the kinds a bill
 * labels a finish with. A cloth's name is not here: "Velvet:" is not a label
 * this app has seen, and a widened list widens what a reviewer is asked.
 */
const FINISH_LABELS = new Set([
  "finish",
  "finishes",
  "fabric",
  "fabrics",
  "com",
  "col",
  "leather",
  "textile",
  "trim",
  "trims",
  "vinyl",
  "timber",
  "wood",
  "metal",
  "material",
  "materials",
]);

const text = (value: string | null | undefined) => (typeof value === "string" ? value.trim() : "");

/** The description's first line, as printed. */
function firstLine(line: GuessLine): string {
  const raw = text(line.itemDescriptionRaw) || text(line.itemDescription);
  return (raw.split(/\r\n|\r|\n/).find((part) => part.trim() !== "") ?? "").trim();
}

/** "Finish" in `Finish: Kvadrat …`, where the label is a finish label — or null. One to three words, the last a finish noun. */
function finishLabelOf(line: GuessLine): string | null {
  const match = /^([A-Za-z][A-Za-z ]{0,30}?)\s*:/.exec(firstLine(line));
  if (!match) return null;
  const words = (match[1] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  return FINISH_LABELS.has(words[words.length - 1] as string) ? (match[1] as string).trim() : null;
}

/** The quantity cell printed nothing at all — no count, and no word. */
function noQuantity(line: GuessLine): boolean {
  return line.qty === null && text(line.qtyRaw) === "";
}

/** A line nobody has said the kind of, still included, and not the bracket rule's to read. */
function open(line: GuessLine): boolean {
  return !line.rowKind && !line.ignored && parseBracketCode(line.code) === null;
}

/** Why a line looks like a finish line, in words — or null. */
function finishShape(line: GuessLine): string | null {
  if (!noQuantity(line)) return null;
  const code = text(line.code);
  if (codeIsAFinishCode(code)) return `the code ${code} is a finish code`;
  const label = finishLabelOf(line);
  return label ? `it begins “${label}:”` : null;
}

/** Every other cell the sheet's columns read, besides the code, the description and the quantity. */
function otherCells(line: GuessLine): boolean {
  const cells = [
    line.qtyUnit,
    line.area,
    line.subArea,
    line.boqCategory,
    line.designer,
    line.productReference,
    line.sourceLine,
    line.notes,
    line.dimensionsRaw,
    line.finishRaw,
    line.finishCode,
    line.mockupQtyRaw,
  ];
  return cells.some((cell) => text(cell) !== "") || (line.kept ?? []).some((cell) => text(cell.value) !== "");
}

/** Why a line looks like a section heading, in words — or null. */
function sectionShape(line: GuessLine): string | null {
  const code = text(line.code);
  const description = firstLine(line);
  if ((code === "") === (description === "")) return null;
  if (!noQuantity(line) || otherCells(line)) return null;
  if (finishShape(line) !== null) return null;
  return `text in the ${code !== "" ? "code" : "description"} column only — no quantity, unit or anything else on the row`;
}

/**
 * THE SUGGESTED KIND OF EVERY LINE THAT HAS ONE, by row. Lines in sheet
 * order; a line with no suggestion is absent.
 */
export function guessRowKinds<T extends GuessLine>(lines: readonly T[]): Map<number, RowKindGuess> {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  const out = new Map<number, RowKindGuess>();
  // Sections first: the finish walk stops at one.
  for (const line of ordered) {
    if (!open(line) || nonFurnitureOf(line) !== null) continue;
    const reason = sectionShape(line);
    if (reason) out.set(line.lineNo, { kind: "section", reason });
  }
  const finishShaped = new Set(ordered.filter((line) => open(line) && finishShape(line) !== null).map((line) => line.lineNo));

  ordered.forEach((line, at) => {
    if (!finishShaped.has(line.lineNo)) return;
    const parent = itemAbove(ordered, at, out, finishShaped);
    if (!parent) return;
    out.set(line.lineNo, {
      kind: "finish_for",
      parent: { row: parent.lineNo, code: parent.code },
      reason: `no quantity, ${finishShape(line)}, and row ${parent.lineNo} (${parent.code ?? "no code"}) is the item above`,
    });
  });
  return out;
}

/**
 * The item a finish-shaped line sits under: walking up past finish lines
 * (set, or finish-shaped), and blank rows; stopping — with no parent — at a
 * section or subtotal (set, or a suggested section), at an ignored line, and
 * at anything else that is not a live item.
 */
function itemAbove<T extends GuessLine>(
  ordered: readonly T[],
  at: number,
  guesses: ReadonlyMap<number, RowKindGuess>,
  finishShaped: ReadonlySet<number>,
): T | null {
  for (let k = at - 1; k >= 0; k -= 1) {
    const above = ordered[k] as T;
    if (above.rowKind === "finish_for" || finishShaped.has(above.lineNo)) continue;
    if (above.rowKind === "blank" || (!above.rowKind && text(above.code) === "" && firstLine(above) === "")) continue;
    if (above.ignored) return null;
    if (guesses.get(above.lineNo)?.kind === "section") return null;
    return (above.rowKind ?? "item") === "item" ? above : null;
  }
  return null;
}

/**
 * The lines an "Accept all" on a tab acts on, for one kind: suggested, and
 * still a line nobody has given a kind. ONE function behind the count on the
 * button and the loop behind it — the `linesToIgnore` rule.
 */
export function linesToAcceptAs<T extends GuessLine & { index: number }>(
  lines: readonly T[],
  guesses: ReadonlyMap<number, RowKindGuess>,
  kind: RowKindGuess["kind"],
): { line: T; guess: RowKindGuess }[] {
  return lines.flatMap((line) => {
    const guess = guesses.get(line.lineNo);
    return guess && guess.kind === kind && open(line) ? [{ line, guess }] : [];
  });
}
