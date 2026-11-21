// Which of Matthew's types an item is, on a cheat sheet that covers several.
//
// ============================================================================
// A SUGGESTION, COMPUTED AT READ, NEVER STORED (decision B, 2026-11-20).
//
// `armchairs-benches-stools-sofas` receives his S, A and B, and a sheet
// answers for the UNION of its types (0005's decision): a sofa is asked about
// a swivel base because an armchair is. `spec_records.matrix_type` (0061) is a
// PERSON'S accepted type within the sheet, and only their press writes it
// (`matrix-type-set.ts`). This file only reads an item's name and suggests,
// with the words it read, the way `suggestCategory` and the level guess do —
// and, unlike the level, it is a pure function of the name and the seed, so
// there is not even a column for it: it is computed wherever it is shown.
//
// THE RULE, in order:
//   1. Whole words or phrases from `spec_matrix_categories.suggest_words`, a
//      plural `s` / `es` allowed ("Benches"), never a substring ("Benchmark").
//   2. A phrase inside a longer matched phrase does not count: "bar stool"
//      is A, and its "stool" is not also B.
//   3. Two types still named abstain ("Sofa bench"). Picking one would be the
//      app deciding what the document did not say.
//   4. Nothing named takes the sheet's default (`suggest_default`), and says
//      so; a sheet with no default suggests nothing.
// A sheet with ONE type has nothing to choose and suggests nothing.
//
// `effectiveMatrixType` is the other half: an accepted type the sheet does
// not map (the record changed category, a re-seed renamed a type) is ignored,
// and the union applies. Never an empty set of rows: that would read as
// "nothing blocks a quote".
// ============================================================================

export type SuggestableType = {
  code: string;
  name: string;
  suggestWords: readonly string[];
  suggestDefault: boolean;
};

export type MatrixTypeSuggestion = {
  code: string;
  name: string;
  /** One sentence, the evidence: which word, or that the sheet's default was taken. */
  reason: string;
};

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Span = { start: number; end: number; code: string; phrase: string };

export function suggestMatrixType(
  description: string | null | undefined,
  types: readonly SuggestableType[],
): MatrixTypeSuggestion | null {
  if (types.length < 2) return null;
  const text = fold(description ?? "");

  const spans: Span[] = [];
  for (const type of types) {
    for (const word of type.suggestWords) {
      const phrase = fold(word);
      if (!phrase) continue;
      const pattern = new RegExp(`(?<![a-z0-9])${escape(phrase)}(?:e?s)?(?![a-z0-9])`, "g");
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        spans.push({ start, end: start + match[0].length, code: type.code, phrase });
      }
    }
  }

  // A phrase inside a longer matched phrase is that phrase's word, not a
  // second claim: "bar stool" is one statement, not "bar stool" and "stool".
  const kept = spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other !== span &&
          other.start <= span.start &&
          other.end >= span.end &&
          other.end - other.start > span.end - span.start,
      ),
  );
  const codes = [...new Set(kept.map((span) => span.code))];

  if (codes.length === 1) {
    const type = types.find((candidate) => candidate.code === codes[0])!;
    const words = [...new Set(kept.map((span) => span.phrase))];
    return {
      code: type.code,
      name: type.name,
      reason: `The name says “${words.join("”, “")}”.`,
    };
  }
  if (codes.length > 1) return null;

  const fallback = types.find((type) => type.suggestDefault);
  if (!fallback) return null;
  return {
    code: fallback.code,
    name: fallback.name,
    reason: `The name names no type, and ${fallback.name} is what this sheet usually holds.`,
  };
}

/**
 * The type a record is judged as: its accepted type where its sheet maps it,
 * otherwise null — and null means the union of the sheet's types, which is
 * how every record was judged before 0061.
 */
export function effectiveMatrixType(
  accepted: string | null | undefined,
  types: readonly { code: string }[],
): string | null {
  if (!accepted) return null;
  return types.some((type) => type.code === accepted) ? accepted : null;
}
