// The BOQ's fourth column, as a filter.
//
// ============================================================================
// WHY A FOLD, AND WHY NOTHING CLEVERER THAN THIS ONE
//
// `spec_records.area` is free text a bill printed — "Signature Suites",
// "Dressing area", "Level 4 Corridor". A select over `distinct area` is the
// simple version and it has one defect worth code: a bill that writes
// `Living Room` on one line and `living room` on the next produces TWO
// options, so choosing either hides half the room. Folding case and
// whitespace merges those.
//
// It folds EXACTLY that much. A normaliser clever enough to merge
// `Bedroom 1` with `Bedroom 01`, or to strip a `Level 4` prefix, is clever
// enough to merge two areas a document deliberately kept apart — the
// `normaliseFinishCode` rule, and there is no way back from a filter that
// silently welds two rooms together.
//
// The fold is for GROUPING ONLY. The label on the option is the area as the
// document first wrote it, because a screen printing `living room` where the
// bill says `Living Room` is a screen quietly correcting a client's document.
//
// Everything here is pure and client-side: this narrows what is LISTED and
// never what is asked, counted or exported — the rule the chase screen, the
// phase table and the finishes library each state in their own words.
// ============================================================================

/**
 * The option key for records whose area is blank.
 *
 * A key of its own, rather than an empty string, because an empty string is
 * also what "All areas" sends and the two must never collide: a record with no
 * area has to be REACHABLE, not dropped, or somebody narrows the screen and
 * quietly loses the lines nobody has placed yet.
 */
export const NO_AREA = "__none__";

/** The label that key carries, in one place so the select and a test agree. */
export const NO_AREA_LABEL = "No area given";

export type AreaOption = {
  /** The folded area, or `NO_AREA`. What the select and the URL carry. */
  key: string;
  /** The area as the document first wrote it. Never the folded string. */
  label: string;
  count: number;
};

/** Anything carrying the BOQ's area column. Structural on purpose. */
export type HasArea = { area: string | null };

/**
 * Case and whitespace, and nothing else. Blank is null rather than "".
 */
export function foldArea(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const folded = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return folded === "" ? null : folded;
}

/**
 * The areas present on what is loaded, each with how many rows carry it.
 *
 * Ordered by the label the document wrote, with the no-area option LAST: it is
 * not an area, and sorting it in among them by its own first letter puts
 * "No area given" between "Lobby" and "Pool" where it reads as a room.
 */
export function areaOptions(rows: readonly HasArea[]): AreaOption[] {
  const byKey = new Map<string, AreaOption>();
  for (const row of rows) {
    const folded = foldArea(row.area);
    const key = folded ?? NO_AREA;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(key, {
      key,
      // FIRST spelling wins, which is what makes the label stable: taking the
      // longest or the most common would make the option rename itself as
      // rows arrive, and somebody reading a link would find a different word.
      label: folded === null ? NO_AREA_LABEL : (row.area ?? "").replace(/\s+/g, " ").trim(),
      count: 1,
    });
  }
  const options = [...byKey.values()];
  options.sort((a, b) => {
    if (a.key === NO_AREA) return 1;
    if (b.key === NO_AREA) return -1;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  });
  return options;
}

/**
 * Does this row belong under the chosen area?
 *
 * A null or empty key is "all areas" — the filter is off, so everything
 * passes. An unknown key passes NOTHING, deliberately: it arrives from the
 * URL, and a link naming an area this phase does not carry must show an empty
 * list rather than silently listing everything as though it had been honoured.
 * The screens resolve the URL against the options they actually have before
 * they ever reach here, so this only sees a key somebody typed.
 */
export function matchesArea(row: HasArea, key: string | null | undefined): boolean {
  if (key == null || key === "") return true;
  const folded = foldArea(row.area);
  if (key === NO_AREA) return folded === null;
  return folded === key;
}
