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

/**
 * THE SHAPE `spec_records_variant_shape` ENFORCES, AS ONE CONSTANT IN CODE.
 *
 * The drawings card refuses a configuration name that fails it IN WORDS, before
 * the confirm, because the alternative is a check-constraint violation reaching
 * the reviewer as a 500 with "Nothing was written". Two copies of a CHECK drift
 * — 0028 silently dropped a value 0021 had added — so the card, `ensureVariant`
 * and the tests all read this one.
 *
 * THIS IS 0024's SHAPE, AND IT MUST STAY 0024's UNTIL 0037 IS APPLIED. 0037
 * (`db/migrations/0037_variant_label_names.sql`) widens the database to 24
 * characters with `&` allowed: `^[A-Z0-9][A-Z0-9 ./&-]{0,23}$`. Widening this
 * constant BEFORE the migration is applied would let the card pass a name the
 * database still refuses. Widen it IN THE SAME COMMIT that records 0037 as
 * applied, to exactly the regex in that file.
 */
export const VARIANT_LABEL_SHAPE = /^[A-Z0-9][A-Z0-9 ./-]{0,7}$/;

/** The longest name `VARIANT_LABEL_SHAPE` admits, for the sentence that refuses one. */
export const VARIANT_LABEL_MAX = 8;

/**
 * A configuration's NAME as it is stored: trimmed, whitespace collapsed,
 * upper-cased. `Type 2` and `TYPE  2` are one configuration.
 *
 * Case and whitespace ONLY — the `normaliseFinishCode` rule. A fold clever
 * enough to read `TYPO 5` as `TYPE 5` is clever enough to merge two things a
 * document kept apart, and there is no way back from that. Upper case because
 * 0024's CHECK forbids lower case: a label is read aloud and typed into emails.
 */
export function normaliseVariantLabel(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Why a configuration name cannot be stored, in words, or null when it can.
 * Called by the card's blocker AND by `ensureVariant`, so the two cannot
 * disagree about what the database will accept.
 */
export function variantLabelProblem(label: string): string | null {
  if (VARIANT_LABEL_SHAPE.test(label)) return null;
  if (label.length > VARIANT_LABEL_MAX) {
    return `'${label}' is too long to be a configuration name — it can be at most ${VARIANT_LABEL_MAX} characters today. Rename it on the page's reading, or ask for migration 0037 to be applied.`;
  }
  return `'${label}' cannot be a configuration name — it may use only letters, digits, spaces and . / - today, starting with a letter or digit.`;
}

/**
 * Is this label one of our page LETTERS (A–Z), rather than a name a document
 * gave? A letter colours by its position in the alphabet; a name has no
 * position of its own and is coloured by its place in the list it is shown in.
 */
export function isVariantLetter(label: string | null | undefined): boolean {
  return typeof label === "string" && /^[A-Z]$/.test(label.trim().toUpperCase());
}

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

/**
 * THE ORDER A PERSON COUNTS IN, for display: "configuration one, configuration
 * two, configuration three" — not the order the page happened to mention them
 * (S-301's sheet lists "Type 1 & 5" first, so first mention read TYPE 1, TYPE 5,
 * TYPE 2 …).
 *
 * Numbered names first, numeric-aware (`TYPE 2` before `TYPE 10`), then single
 * letters A–Z, then anything else in the order the document gave it. DISPLAY
 * ONLY: the stored order, the confirm's order and the letters are unchanged.
 */
export function naturalConfigurationOrder(labels: readonly string[]): string[] {
  const numbered: { label: string; head: string; n: number; tail: string }[] = [];
  const letters: string[] = [];
  const rest: string[] = [];
  for (const label of labels) {
    const match = /^(.*?)(\d+)(.*)$/.exec(label);
    if (match) numbered.push({ label, head: match[1]!, n: Number(match[2]), tail: match[3]! });
    else if (/^[A-Z]$/.test(label)) letters.push(label);
    else rest.push(label);
  }
  numbered.sort((a, b) => a.head.localeCompare(b.head) || a.n - b.n || a.tail.localeCompare(b.tail));
  letters.sort();
  return [...numbered.map((entry) => entry.label), ...letters, ...rest];
}
