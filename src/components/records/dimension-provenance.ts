// Where the composed dimensions cell came from, in one sentence.
//
// ============================================================================
// THE CELL IS A SUMMARY, AND THE SENTENCE IS WHAT MAKES IT CHECKABLE.
//
// `composeDimensionCell` prints `W1900 x D790 x H720 x SH440mm` whether the
// page said 190 or 1900, so a reader who has the drawing open needs to know
// which page it was read off and whether anything was converted on the way.
// Without that the cell is a number to be believed rather than checked, which
// is the failure the whole dimension model exists to prevent.
//
// Three things about it are deliberate.
//
//  - THE PAGE IS COUNTED, NEVER PICKED. The (document, page) accounting for
//    most of the slots goes first, ties breaking on the lower page, so the
//    sentence is stable between visits — the costing sheet's rule, for the
//    same reason: somebody who wrote down "the width is on page 7" must not
//    find it saying page 11 next week.
//  - A MIXED PAGE SAYS SO. Two units among four slots is not a detail: it is
//    either a real mixed set or a misread, and both are worth a second look.
//  - THE BILL IS NAMED, NEVER COUNTED AS A PAGE (2026-10-15). A bill row has
//    no page, and TB-08's caption read "and 1 other page" for a height that
//    was the bill's own row — Max went looking for a second page of the
//    drawing. A row off the bill says "from the bill"; a document with no
//    page (an email, a schedule) is named by its file.
//  - A ROW WITH NO SOURCE IS NAMED AS TYPED. A hand-typed spec carries no run
//    and no page, deliberately (0028), and calling that "off the drawings"
//    would be a false provenance rather than a missing one.
//
// Pure, and exported on its own so the wording can be tested without a DOM.
// ============================================================================
import { ATTRIBUTE_UNIT_LABELS, normaliseUnit } from "@/lib/spec-vocab";

export type ProvenanceRow = {
  unit: string | null;
  sourceFilename: string | null;
  sourcePage: number | null;
  /** Written by a bill of quantities' run. Absent: not known to be the bill's. */
  sourceIsBill?: boolean;
};

/** "centimetres", not "Centimetres (cm)". The label spells it for a select. */
function unitWord(unit: string): string {
  const known = normaliseUnit(unit);
  if (!known) return unit;
  return ATTRIBUTE_UNIT_LABELS[known].replace(/\s*\(.*\)$/, "").toLowerCase();
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The provenance sentence, or null where there is nothing measured to explain.
 *
 * Takes the rows that actually COMPOSE the cell — the slotted dimension
 * attributes — not every measured figure on the item, because the sentence is
 * about the cell above it.
 */
export function dimensionProvenance(rows: readonly ProvenanceRow[]): string | null {
  if (rows.length === 0) return null;

  // ---- which page, counted --------------------------------------------------
  const pages = new Map<string, { filename: string; page: number | null; bill: boolean; count: number }>();
  let typed = 0;
  for (const row of rows) {
    if (!row.sourceFilename) {
      typed += 1;
      continue;
    }
    // Keyed as JSON rather than a joined string: a filename can contain
    // anything, and a separator that can appear in the data is a key that
    // can collide.
    const bill = row.sourceIsBill === true;
    const key = JSON.stringify([row.sourceFilename, row.sourcePage, bill]);
    const seen = pages.get(key);
    if (seen) seen.count += 1;
    else pages.set(key, { filename: row.sourceFilename, page: row.sourcePage, bill, count: 1 });
  }
  const ordered = [...pages.values()].sort(
    (a, b) => b.count - a.count || (a.page ?? 0) - (b.page ?? 0) || (a.filename < b.filename ? -1 : 1),
  );

  const parts: string[] = [`Composed from ${plural(rows.length, "measured row", "measured rows")}`];
  const first = ordered[0];
  if (first) {
    parts.push(first.bill ? ` off the bill (${first.filename})` : ` off ${first.filename}${first.page ? ` p${first.page}` : ""}`);
    const rest = ordered.slice(1);
    const clauses: string[] = [];
    // Pages of documents, counted as pages — what this always said.
    const otherPages = rest.filter((entry) => !entry.bill && entry.page !== null).length;
    if (otherPages > 0) clauses.push(plural(otherPages, "other page", "other pages"));
    // The bill, by its ROWS, because it has no pages to count.
    const billRows = rest.filter((entry) => entry.bill).reduce((total, entry) => total + entry.count, 0);
    if (billRows > 0) clauses.push(`${plural(billRows, "row", "rows")} from the bill`);
    // A document with no page (an email, a schedule): by name.
    for (const entry of rest.filter((other) => !other.bill && other.page === null)) {
      clauses.push(`${plural(entry.count, "row", "rows")} from ${entry.filename}`);
    }
    if (clauses.length > 0) {
      parts.push(` and ${clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`}`);
    }
  }
  if (typed > 0) parts.push(`${first ? ", with " : ", "}${plural(typed, "typed by hand", "typed by hand")}`);

  // ---- and what was converted ----------------------------------------------
  const units = [...new Set(rows.map((row) => row.unit).filter((unit): unit is string => Boolean(unit)))];
  if (units.length === 0) {
    parts.push(". None of them states a unit, so the cell prints what it could not derive in brackets");
  } else if (units.length > 1) {
    parts.push(
      `. They are not all in the same unit — ${units.map(unitWord).join(" and ")} — and each is converted to millimetres`,
    );
  } else if (units[0] !== "mm") {
    parts.push(`, converted from ${unitWord(units[0]!)}`);
  } else {
    parts.push(", already in millimetres");
  }

  return `${parts.join("")}.`;
}
