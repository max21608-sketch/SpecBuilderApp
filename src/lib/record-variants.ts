// One bill line, two things to make.
//
// ============================================================================
// WHAT A VARIANT IS, AND WHAT IT IS NOT.
//
// The AP364 set draws S-201 twice with identical geometry and different
// callouts: `Aissa Dione Kolda` over natural oak on one page, `Aissa Dione
// Gorée` over ceruse oak on the other. The bill has ONE line, 45 off. Those
// are not two readings of one fact — they are both true, and they are two
// different chairs to build.
//
// So they become a FABRIC SPLIT: two child records under the bill's record,
// `depth = 1`, `split_reason = 'fabric'`, named A and B. 0002 built that model
// and nothing ever wrote it; 0024 added the only thing it lacked, a name.
//
// A VARIANT IS NOT:
//
//  - A revision. A revised drawing REPLACES a value and the old one is
//    retired with a reason (`attribute-retire.ts`). Confirming page 6 used to
//    offer to retire page 5's fabric, which was the app insisting one of two
//    true statements had to be wrong.
//  - A run. `MUR`, `MAIN RUN` and the VE run quote the SAME codes at different
//    quantities and are `spec_runs` rows with their own records. A variant sits
//    INSIDE one run: S-201 A exists separately on the main run and on the VE
//    run, because each run has its own S-201 to split.
//  - A VE alternative. That is M6 and it is a different question — which
//    version is LIVE. Both variants are live at once.
//
// THE PARENT STOPS BEING EXPORTED, and that is the load-bearing consequence.
// See `parentIsSupersededBy` below: a bill line with live variants is a
// heading, and its variants are the jobs. Shipping all three would put three
// rows in a file that replaces rather than merges — the same class of error as
// a filtered export, on the most dangerous file in the product.
// ============================================================================

/** A–Z, in order. Read aloud and typed into emails, so nothing cleverer. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * The next free letter under a parent, or null when they are all taken.
 *
 * Null rather than rolling over to `AA` or reusing a retired letter. A retired
 * variant keeps its name: somebody quoted "S-201 C" in an email and that has
 * to keep meaning the thing they quoted, which is the same reason a retired
 * record keeps its `record_no`. Twenty-six variants of one bill line is a
 * situation a person should be told about, not one to paper over — the deepest
 * real case in the pilot is S-301 at four.
 */
export function nextVariantLabel(taken: readonly (string | null)[]): string | null {
  const used = new Set(taken.filter((label): label is string => Boolean(label)).map((label) => label.toUpperCase()));
  return LETTERS.find((letter) => !used.has(letter)) ?? null;
}

/**
 * What a person calls this record.
 *
 * `S-201 A` — the client's own ref with our letter after it, which is how it
 * gets said out loud. The ref is NOT modified: `spec_record_refs` holds the
 * same `S-201` on every variant, because the ref is the client's key and the
 * letter is ours. A record with no ref falls back to whatever the caller uses
 * for an unreferenced record (its `record_no` label), still with the letter.
 */
export function variantName(ref: string | null, variantLabel: string | null, fallback: string): string {
  const base = ref?.trim() || fallback;
  return variantLabel ? `${base} ${variantLabel}` : base;
}

/**
 * Is this record a heading rather than an item, because its variants are what
 * gets made?
 *
 * The rule the export, the check sheet and the spec table all have to agree
 * on: a parent with at least one ACTIVE variant is superseded by them.
 *
 * ACTIVE is the whole subtlety. Retire both variants of S-201 and the parent
 * is an item again — it is still a line on the bill, 45 off, and a file that
 * omitted it would wipe every BWS field it had. So this is not "has ever been
 * split"; it is "has a live variant right now".
 */
export function parentIsSupersededBy(activeVariantCount: number): boolean {
  return activeVariantCount > 0;
}

/**
 * The quantity a variant carries, and why it is usually nothing.
 *
 * The bill says 45 of S-201 and never says how many are fabric A. Apportioning
 * it is a decision with a price attached, so a variant is created with
 * `qty = null` and the screens say the parent's 45 is unallocated. This returns
 * what is still unaccounted for, so a screen can say it in numbers.
 *
 * A NEGATIVE result is possible and is not clamped: variants adding up to more
 * than the bill line is a real mistake somebody has made, and hiding it behind
 * a `Math.max` is how it reaches a quotation.
 */
export function unallocatedQty(parentQty: number | null, variantQtys: readonly (number | null)[]): number | null {
  if (parentQty === null) return null;
  const allocated = variantQtys.reduce<number>((total, qty) => total + (qty ?? 0), 0);
  return parentQty - allocated;
}
