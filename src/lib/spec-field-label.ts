// What a BWS spec field is CALLED on a screen, where that differs from BWS.
//
// Matthew, 2026-10-15 (Ronnie Scott's part 2, 26:56–27:07), with Max the same
// evening (Q9): "Main metal finish" should read "Metal finish 1", and "Main
// timber finish" "Timber finish 1" — beside BWS's own "Metal Finish 2" and
// "Timber Finish 2/3" the word "Main" reads as a different kind of thing,
// where it is only the first of a numbered run.
//
// ---- WHAT DOES NOT CHANGE, AND WHY ------------------------------------------
//
//   * `spec_fields.name` and `name_norm` are BWS's register
//     (`external-vocabulary-sync`): a document's own label is matched against
//     `name_norm`, so a drawing saying "main metal finish" must still land on
//     field 5. Nothing here is written anywhere.
//   * The export's 109 headers are a static constant in `bws-export.ts` and
//     stay BWS's: they are the file BWS reads.
//   * The check sheet prints BOTH (`fieldDisplayNameWithBws`), because a
//     reviewer reads it against the BWS file, whose header says the BWS name.
//
// ONE map, a leaf with no imports, so a client component and a server sentence
// call the same function. Keyed on `json_id`, the register's key. Where a
// payload carries only the name, BWS's exact name (folded by case and
// whitespace) finds the same row, and `tests/lib/spec-field-label.test.ts`
// holds both halves against `db/seed/0001_spec_fields.sql`: a BWS rename fails
// it rather than quietly putting the old name back on screen.

export const SPEC_FIELD_DISPLAY_NAMES: readonly { jsonId: number; bwsName: string; displayName: string }[] = [
  { jsonId: 4, bwsName: "Main timber finish", displayName: "Timber finish 1" },
  { jsonId: 5, bwsName: "Main metal finish", displayName: "Metal finish 1" },
];

const fold = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

function entryFor(jsonId: number | null | undefined, name: string | null | undefined) {
  if (typeof jsonId === "number") return SPEC_FIELD_DISPLAY_NAMES.find((entry) => entry.jsonId === jsonId) ?? null;
  if (!name) return null;
  const folded = fold(name);
  return SPEC_FIELD_DISPLAY_NAMES.find((entry) => fold(entry.bwsName) === folded) ?? null;
}

/**
 * The name a screen prints for a BWS field: ours where the map has one,
 * otherwise the register's own name, trimmed. Pass the json id where the
 * payload has it; the name alone is enough where it does not.
 */
export function fieldDisplayName(name: string, jsonId?: number | null): string;
export function fieldDisplayName(name: string | null | undefined, jsonId?: number | null): string | null;
export function fieldDisplayName(name: string | null | undefined, jsonId?: number | null): string | null {
  const entry = entryFor(jsonId, name);
  if (entry) return entry.displayName;
  return name ? name.trim() : null;
}

/** For a file read against BWS's: "Metal finish 1 (BWS: Main metal finish)", or the BWS name alone. */
export function fieldDisplayNameWithBws(name: string | null | undefined, jsonId?: number | null): string | null {
  const entry = entryFor(jsonId, name);
  if (entry) return `${entry.displayName} (BWS: ${name?.trim() || entry.bwsName})`;
  return name ? name.trim() : null;
}
