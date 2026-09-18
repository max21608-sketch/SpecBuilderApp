// What KIND a finish is, read off the code the client gave it and the words
// its description uses.
//
// ============================================================================
// SUGGESTED, NEVER WRITTEN — the `level_suggested` rule in a second place.
//
// CLAUDE.md has said since 0018 that "`kind` is never inferred", and the reason
// stands: `classifyGroup` already guesses a group from words in a label, and a
// second guess stacked silently on top of it produces a register full of
// confident mistakes that nothing on any screen flags.
//
// What changes is not the rule but WHO DECIDES. Nothing here writes anything.
// `suggestFinishKind` returns a kind plus the evidence for it, the row renders
// it as a dashed blue button with that evidence beside it, and a person's click
// is what files it — exactly as `level_suggested` (0025) is shown beside a
// record and only a person's acceptance writes `spec_records.level`.
//
// Asked for on 2026-09-18, looking at the real sandbox library: eleven finishes
// and nine with no kind at all, including `WD-01 — Dark tinted wood`. The kind
// is what every screen groups and filters by, so nine unfiled rows is a filter
// that does nothing and a library nobody can narrow.
//
// ---- THE EVIDENCE, IN ORDER, STOPPING AT THE FIRST THING THAT DECIDES ------
//
//   1. THE CLIENT'S OWN CODE. `WD-05` is the client filing it as a timber in
//      their own vocabulary, on their own schedule. It is the strongest thing
//      here and it is the one the drawings path already trusts (`CODE_PREFIXES`).
//      `CH` stays deliberately unmapped: nothing on any page says what it means.
//   2. THE DESCRIPTION'S MATERIAL WORDS. "Dark tinted wood" is a timber because
//      of the word `wood`, not because this app has heard of the supplier.
//
// Nothing reads a brand or a product reference. "Aissa Dione" is a fabric house
// and "Tessarae" is a fabric, and a list of mill names would be wrong within a
// month — the same reasoning that keeps them out of `classifyCallout`.
//
// ---- WHAT IT REFUSES TO ANSWER --------------------------------------------
//
// A row with no code prefix it knows and no material word gets NULL, and the
// screen says so rather than offering the nearest kind. Six of the sandbox's
// eleven resolve; `CH-01.1` and `CH-01.2` do not, and "we cannot tell from
// what is written down" is the true answer for them. `resolveFinishCode`
// offering candidates and picking none is the same rule.
// ============================================================================
import { FINISH_KINDS, type FinishKind } from "@/lib/finishes";
import { normaliseName } from "@/lib/matching";
import {
  CODE_PREFIXES,
  FABRIC_CALLOUT_WORDS,
  FABRIC_EXTRA_WORDS,
  GLASS_WORDS,
  LEATHER_WORDS,
  METAL_EXTRA_WORDS,
  METAL_WORDS,
  PAINT_WORDS,
  STONE_WORDS,
  TIMBER_EXTRA_WORDS,
  TIMBER_MATERIAL_WORDS,
} from "@/lib/material-words";

export type FinishKindSuggestion = {
  kind: FinishKind;
  /** Why, in the words the screen prints beside the button. */
  reason: string;
};

/**
 * The description's vocabulary, most specific first.
 *
 * LEATHER BEFORE FABRIC, because `FABRIC_CALLOUT_WORDS` contains `leather`,
 * `hide` and `suede` — the drawings path cannot tell the two apart and does not
 * need to, since both land on the same COM field, but `FinishKind` keeps them
 * separate and the library is the one place the distinction is recorded.
 * Reading fabric first would make every hide a fabric.
 *
 * STONE, GLASS AND PAINT BEFORE THE REST, because none of them appears in the
 * callout lists at all: a BWS spec field does not distinguish them, so the
 * drawings path never needed the words.
 */
const DESCRIPTION_WORDS: { kind: FinishKind; words: readonly string[] }[] = [
  { kind: "leather", words: LEATHER_WORDS },
  { kind: "stone", words: STONE_WORDS },
  { kind: "glass", words: GLASS_WORDS },
  { kind: "paint", words: PAINT_WORDS },
  { kind: "metal", words: [...METAL_WORDS, ...METAL_EXTRA_WORDS] },
  // Timber reads its MATERIAL words only. `TIMBER_PART_WORDS` ("legs",
  // "frame") says where a finish goes, not what it is, and a fabric described
  // as "for the legs and front rail" is not a timber.
  { kind: "timber", words: [...TIMBER_MATERIAL_WORDS, ...TIMBER_EXTRA_WORDS] },
  { kind: "fabric", words: [...FABRIC_CALLOUT_WORDS, ...FABRIC_EXTRA_WORDS] },
];

/** Whole words only, so `ash` does not match `Ashcombe` and `ral` does not match `coral`. */
function mentions(text: string, words: readonly string[]): string | null {
  const parts = new Set(normaliseName(text).split(" ").filter(Boolean));
  return words.find((word) => parts.has(word)) ?? null;
}

export function isFinishKindValue(value: unknown): value is FinishKind {
  return typeof value === "string" && (FINISH_KINDS as readonly string[]).includes(value);
}

/**
 * What kind this finish looks like, or null where nothing written down says.
 *
 * Pure, and tested in the pure tier: the screen, the bulk "file them all" route
 * and any future backfill all have to reach the same answer, and a second
 * implementation is how a button starts filing something different from what
 * the row beside it offered.
 */
export function suggestFinishKind(finish: {
  code: string;
  description?: string | null;
}): FinishKindSuggestion | null {
  // 1. The client's own code, read as its letters with everything else
  //    stripped, and matched at the START only. `CLO003 WD` is a real sandbox
  //    code and folds to `clowd`, which matches no prefix — correctly, because
  //    the `WD` there is the client's own suffix convention and reading it as
  //    the BWS-style `WD-nn` prefix would be a rule invented from one example.
  //    Its description says "Dark tinted wood", so step 2 answers it anyway.
  const letters = normaliseName(finish.code).replace(/[^a-z]/g, "");
  const prefix = CODE_PREFIXES.find((entry) => letters.startsWith(entry.prefix));
  if (prefix) {
    return { kind: prefix.kind, reason: `the code ${finish.code.trim()} says so` };
  }

  // 2. The description's own words.
  const description = finish.description?.trim();
  if (description) {
    for (const entry of DESCRIPTION_WORDS) {
      const hit = mentions(description, entry.words);
      if (hit) return { kind: entry.kind, reason: `“${hit}” names a ${entry.kind}` };
    }
  }

  // Nothing written down says. The screen offers the empty picker and says why.
  return null;
}

/**
 * Every suggestion across a library, for the "file them all" control.
 *
 * Only rows that HAVE no kind: a finish somebody has already filed is a
 * decision, and re-suggesting over it would be the app second-guessing a person
 * — the rule `applyViewGuesses` follows when it leaves an item alone the moment
 * any row on it carries a slot.
 */
export function suggestKindsFor(
  finishes: readonly { id: string; code: string; description?: string | null; kind: FinishKind | null }[],
): { id: string; suggestion: FinishKindSuggestion }[] {
  const out: { id: string; suggestion: FinishKindSuggestion }[] = [];
  for (const finish of finishes) {
    if (finish.kind) continue;
    const suggestion = suggestFinishKind(finish);
    if (suggestion) out.push({ id: finish.id, suggestion });
  }
  return out;
}
