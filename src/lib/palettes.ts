// The closed lists a spec field offers, and the five this app does not hold.
//
// ============================================================================
// THE MODEL NEVER PICKS AN OPTION.
//
// house/conventions.md §6: the fuzzy step and the exact step are separate. The
// model reads a document and decides nothing; resolving what it read to a
// palette value happens afterwards, deterministically, in code, against this
// app's own register. `normalisePaletteValue` is that step, and it returns
// NULL on anything it does not recognise rather than reaching for the nearest
// option — an unresolved value is a visible flag, never a plausible-looking
// wrong answer.
//
// ---- FIVE PALETTES ARE EMPTY AND THAT IS THE HONEST STATE ---------------
//
// Matthew's matrix names "From BWS timber finish palette" and four more like
// it. This app holds none of them. They are seeded as rows with zero options
// and a null `synced_at`, the field stays free text, and the screen says so in
// words rather than offering an empty dropdown, which reads as broken. Do not
// invent them: FMT-GEN-01, and a guessed finish list is the one kind of wrong
// answer nothing downstream would question.
// ============================================================================

export type PaletteOwner = "app" | "bws";

export type PaletteOption = {
  value: string;
  label: string;
  sortOrder: number;
  isDefault: boolean;
};

export type Palette = {
  key: string;
  name: string;
  owner: PaletteOwner;
  allowsFreeText: boolean;
  sourceNote: string | null;
  /** Null means never synced. For a BWS-owned palette that is the point. */
  syncedAt: string | null;
  options: PaletteOption[];
};

/** A palette this app can actually offer as a list. */
export function isOfferable(palette: Palette): boolean {
  return palette.options.length > 0;
}

/**
 * What a screen says where a palette exists and its options do not.
 *
 * Said in words rather than shown as an empty dropdown: a select with one
 * option reads as broken, and a reviewer who thinks the control is broken
 * types something into the next box instead of asking for the list.
 */
export function unheldPaletteNote(palette: Palette): string {
  return `${palette.name} — BWS owns this list and it is not loaded here, so this stays free text.`;
}

/** The value a control preselects. NEVER an answer: `missing` means nobody has looked. */
export function defaultOption(palette: Palette): PaletteOption | null {
  return palette.options.find((option) => option.isDefault) ?? null;
}

/**
 * Fold a written value onto a palette option, or return null.
 *
 * Case and whitespace only, plus the punctuation a person types differently
 * from the way it was seeded — an en dash for a hyphen, a degree sign, a
 * doubled space. Deliberately NOT clever: `normaliseFinishCode` keeps
 * `CH-01.1` and `CH-01-1` apart for the same reason, because a normaliser
 * clever enough to merge two spellings is clever enough to merge two things
 * somebody meant to keep separate, and there is no way back.
 */
export function normalisePaletteValue(palette: Palette, raw: string | null): string | null {
  const wanted = comparisonKey(raw);
  if (!wanted) return null;
  const hit = palette.options.find((option) => comparisonKey(option.value) === wanted || comparisonKey(option.label) === wanted);
  return hit ? hit.value : null;
}

/** The single comparison key. Every call site uses this rather than `===` on a raw string. */
export function comparisonKey(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/[‐-―]/g, "-")   // every dash BWS, Word and a designer can produce
    .replace(/°/g, "")              // 360° and 360 are the same mechanism
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this written value one the palette holds?
 *
 * Used by a screen to decide whether to show the select on the option or to
 * show it as "Other". A value outside a palette that ALLOWS free text is fine
 * and is shown as itself; one outside a palette that does not is a flag.
 */
export function isOffPalette(palette: Palette, raw: string | null): boolean {
  if (!raw?.trim()) return false;
  if (!isOfferable(palette)) return false;
  return normalisePaletteValue(palette, raw) === null;
}
