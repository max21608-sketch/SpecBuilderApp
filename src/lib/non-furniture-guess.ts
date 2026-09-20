// A bill line that is not a piece of furniture, and saying so as a question.
//
// ============================================================================
// A SUGGESTION, NEVER A DECISION — AND THE TRAP IS NAMED IN THE CODE.
//
// Seen on the real pilot bill (found-in-use 2): `PACK` and `DEL` came through
// the BOQ import as furniture and became spec records with checklists nobody
// could answer. Matthew: they should not be there. Max: "how easy is it to
// ignore?"
//
// The SIMPLEST version is to drop a line whose code starts `PACK` or `DEL` at
// parse time. The trap it falls into is concrete and somebody would act on it:
// a code list is a guess, so `DEL-01 Delivery table` — a real table, in a real
// bill, for the delivery area — is silently absent from the phase, from the
// export and from the quote, and the first person to notice is the client.
// Nothing downstream ever questions a line that was never there.
//
// So this module produces a QUESTION with its evidence printed beside it, the
// reviewer answers it with one click, and the answer is `ignored` on the staged
// line — which is the existing, reversible ignore path (house/conventions §5:
// every ignore path is reversible; the Include checkbox is the way back).
// Nothing here writes anything, and nothing is ignored on its own.
//
// ---- WHAT IT READS, IN ORDER, STOPPING AT THE FIRST THAT DECIDES ----------
//
//   1. the code's own prefix, against an explicit list
//   2. the description's WORDS, against an explicit list
//   3. NOTHING. A missing category match is SUPPORTING evidence appended to a
//      reason that already fired, and can never fire on its own — a bench with
//      a novel name matches no category alias either, and calling it packaging
//      would be the confident wrong answer this whole design exists to refuse.
//
// Stopping at the first is what makes the evidence honest: `DEL-01 Delivery
// table` fires on the CODE and says so, so the reviewer reads "code DEL" beside
// a description that plainly names a table, and declines. That is the design
// working, not a miss.
// ============================================================================

export type NonFurnitureGuess = {
  /** One sentence, for printing beside the button. */
  reason: string;
  /** Which of the two rules decided. Supporting evidence never appears here. */
  rule: "code" | "words";
  /** Exactly what it matched on: the code prefix, or the words found. */
  matched: string[];
};

/**
 * Code prefixes that are not furniture in any bill this repo has seen.
 *
 * Matched against the code's LEADING RUN OF LETTERS, never `startsWith`:
 * `INSTRUMENT-1` starts with `INST` and is not an installation line, and
 * `DESK-01` is not `DEL`. The whole-token rule is the same discipline as
 * `normaliseDimensionSlot` refusing a substring — a substring rule here would
 * put a real item behind a suggestion nobody expected to see.
 */
const CODE_PREFIXES = ["PACK", "DEL", "DELIV", "INST", "FREIGHT", "SHIP", "CRATE"];

/**
 * Words a bill uses for the things that are not items.
 *
 * Deliberately short and explicit. `packing` is NOT here and `packaging` is:
 * widening this list widens what a reviewer is asked about, and the list Max
 * and Matthew agreed is the list. Adding to it is a decision, not a tidy-up.
 */
const DESCRIPTION_WORDS = [
  "packaging",
  "delivery",
  "installation",
  "freight",
  "shipping",
  "crating",
  "transport",
  "storage",
  "attendance",
];

/** The code's leading run of letters, uppercased. `DEL-01` → `DEL`, `12A` → ``. */
function codePrefix(code: string | null | undefined): string {
  const match = /^[A-Za-z]+/.exec((code ?? "").trim());
  return (match?.[0] ?? "").toUpperCase();
}

/** The description's words, folded, so `Delivery,` and `DELIVERY` are one word. */
function descriptionWords(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
}

/**
 * What this bill line looks like to a reader who has not decided anything.
 *
 * `categoryStatus` is the staged line's own field — `none` means the category
 * matcher found nothing. It is read ONLY as supporting evidence, appended to a
 * reason that has already fired.
 */
export type NonFurnitureInput = {
  code?: string | null;
  itemDescription?: string | null;
  categoryStatus?: string | null;
};

export function guessNonFurniture(line: NonFurnitureInput): NonFurnitureGuess | null {
  const unmatched = (line.categoryStatus ?? "") === "none";
  const supporting = unmatched ? ", and no category matched it" : "";

  const prefix = codePrefix(line.code);
  if (prefix && CODE_PREFIXES.includes(prefix)) {
    return {
      rule: "code",
      matched: [prefix],
      reason: `the code starts ${prefix}${supporting}`,
    };
  }

  const found = descriptionWords(line.itemDescription);
  const words = DESCRIPTION_WORDS.filter((word) => found.has(word));
  if (words.length > 0) {
    return {
      rule: "words",
      matched: words,
      reason: `the description says ${words.map((word) => `“${word}”`).join(" and ")}${supporting}`,
    };
  }

  return null;
}

/**
 * The suggestion to show on a staged line, computed where it was never stored.
 *
 * THE STAGED JSON IS DATA FROM THE PAST. A bill staged before this field
 * existed carries no key at all, and a screen that required one would show
 * nothing on exactly the bills already half-reviewed. `undefined` means "nobody
 * has asked this question of this line" and is answered now, from the same pure
 * function; a stored `null` means it was asked and the answer was no. Same
 * discipline as `upgradeCalloutGuesses`, and for the same reason.
 */
export function nonFurnitureOf(
  line: NonFurnitureInput & { nonFurnitureSuggested?: NonFurnitureGuess | null },
): NonFurnitureGuess | null {
  return line.nonFurnitureSuggested === undefined ? guessNonFurniture(line) : line.nonFurnitureSuggested;
}

/**
 * The lines *Ignore all suggested* acts on: suggested, and still included.
 *
 * ONE function behind the count on the button and the loop behind it. Two
 * readings of "which lines" is how a control comes to ignore something its own
 * label did not count — and the count is the only thing a reviewer reads before
 * pressing it. A line somebody already unticked is not in the set, because it
 * is already out and re-sending it would be a write with nothing to change.
 */
export function linesToIgnore<T extends NonFurnitureInput & { ignored: boolean; nonFurnitureSuggested?: NonFurnitureGuess | null }>(
  lines: T[],
): T[] {
  return lines.filter((line) => !line.ignored && nonFurnitureOf(line) !== null);
}
