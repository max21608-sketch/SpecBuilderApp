// What a record is called, in one place.
//
// ============================================================================
// TWO NUMBERS, AND ONLY ONE OF THEM IS A NAME.
//
// `record_no` is the project-wide surrogate: unique per project, never reused,
// and what every link, snapshot and chase coverage row already points at. A
// configuration is given the next free one when it is made (0024), so S-301 on
// bill line 12 split into TYPE 1 to TYPE 5 used to read 34, 36, 37, 38 and 35
// — a number that says nothing about the line it belongs to.
//
// 0039 gave a configuration its own number UNDER the line, `variant_ordinal`,
// and this is where the two are turned into what a person reads: `12.1` on a
// screen, `P18181-012.1` in a file. Max, 2026-09-23.
//
// ONE HELPER, because the old template was written out in some twenty places
// (`${number}-${String(no).padStart(3, "0")}`) and a configuration read one
// way on the spec table and another in the export's Specs sheet the moment
// any one of them was changed. A leaf: no database, no React, so a component,
// a route and a composer can all import it.
//
// A CONFIGURATION WITH NO ORDINAL falls back to its own `record_no`. 0039's
// CHECK makes that unreachable on a migrated database; the fallback is for a
// payload that predates it (a cached response, a snapshot) so it renders as
// what it said rather than as `12.undefined`.
// ============================================================================

export type RecordNumbering = {
  /** The record's own project-wide number. */
  recordNo: number;
  /** The bill line's `record_no`, where this record is one of its configurations. */
  parentRecordNo?: number | null;
  /** 0039: the 3 in 12.3. Null on a bill line. */
  variantOrdinal?: number | null;
};

function isConfiguration(numbering: RecordNumbering): numbering is RecordNumbering & {
  parentRecordNo: number;
  variantOrdinal: number;
} {
  return (
    typeof numbering.parentRecordNo === "number" &&
    Number.isFinite(numbering.parentRecordNo) &&
    typeof numbering.variantOrdinal === "number" &&
    Number.isFinite(numbering.variantOrdinal)
  );
}

function asNumbering(numbering: RecordNumbering | number): RecordNumbering {
  return typeof numbering === "number" ? { recordNo: numbering } : numbering;
}

/** `12`, or `12.3` for a configuration of line 12. What a screen prints. */
export function recordShortLabel(numbering: RecordNumbering | number): string {
  const n = asNumbering(numbering);
  return isConfiguration(n) ? `${n.parentRecordNo}.${n.variantOrdinal}` : String(n.recordNo);
}

/**
 * `P18181-012`, or `P18181-012.3` for a configuration of line 12. What a file,
 * an email or a history row prints — the project number is part of it because
 * those leave the screen that says which project they are.
 *
 * Accepts a bare `record_no` too, which is every caller that predates 0039 and
 * every bill line.
 */
export function recordLabel(projectNumber: string, numbering: RecordNumbering | number): string {
  const n = asNumbering(numbering);
  if (isConfiguration(n)) return `${projectNumber}-${String(n.parentRecordNo).padStart(3, "0")}.${n.variantOrdinal}`;
  return recordNoLabel(projectNumber, n.recordNo);
}

/**
 * The label AS IT READ BEFORE 0039, from `record_no` alone: `P18181-034`.
 *
 * Not for display. A chase coverage row froze the label its draft was written
 * with, and `coverageStaleReasons` compares that whole snapshot — so the
 * renumbering alone would have made every unsent draft covering a
 * configuration read as stale, for a reason that has nothing to do with any
 * answer (the `chased_at` trap). This is what lets the comparison forgive
 * exactly that renumbering and nothing else.
 */
export function recordNoLabel(projectNumber: string, recordNo: number): string {
  return `${projectNumber}-${String(recordNo).padStart(3, "0")}`;
}

/**
 * BILL ORDER, with each configuration directly under its line: line 12, then
 * 12.1 … 12.5, then line 13. The order every export and sheet lists records
 * in.
 *
 * Row order changes nothing about what a BWS import replaces — the import is
 * keyed by the job, not by the row — so this is for the person reading the
 * file, who would otherwise find 12.1 at the bottom beside the last new line.
 * The record's own `record_no` breaks any remaining tie so the order is stable.
 */
export function compareRecordOrder(a: RecordNumbering, b: RecordNumbering): number {
  const lineA = a.parentRecordNo ?? a.recordNo;
  const lineB = b.parentRecordNo ?? b.recordNo;
  if (lineA !== lineB) return lineA - lineB;
  // The line itself (no ordinal) first, then its configurations by number.
  const ordA = a.variantOrdinal ?? 0;
  const ordB = b.variantOrdinal ?? 0;
  if (ordA !== ordB) return ordA - ordB;
  return a.recordNo - b.recordNo;
}

/**
 * A database row's numbering, for the helpers above. Every query that names a
 * record selects the same three columns — `record_no`, `variant_ordinal` and
 * the bill line's `record_no` as `parent_record_no` — so the row is read in
 * one place rather than twenty.
 */
export function numberingFromRow(row: Record<string, unknown>): RecordNumbering {
  const n = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
  return {
    recordNo: Number(row.record_no),
    parentRecordNo: n(row.parent_record_no),
    variantOrdinal: n(row.variant_ordinal),
  };
}
