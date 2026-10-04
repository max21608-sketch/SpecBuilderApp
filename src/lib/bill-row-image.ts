// The picture a bill prints on an item's row — the staged shape, and where to
// find one. A LEAF: types and one lookup, no database, no blob store, no
// workbook reader, so the review screen can import it without pulling any of
// those into the browser bundle. The reading and the storing are in
// `bill-images.ts`, which is server-only.
//
// The Aman pricing document carries an "Image" column with a picture anchored
// on each item's row (measured 2026-10-04 on the real copy: 107 anchors on 100
// of its 101 lines, 45 distinct pictures). `read-excel-file` cannot see them;
// `exceljs` can, and that is all `bill-images.ts` uses it for.

/** One row's picture, as stored at staging. */
export type BillRowImage = {
  /**
   * The stored copy, under `projects/<id>/` — a PATHNAME, never a URL
   * (`blob-source.ts`). Null where the row carries several different pictures:
   * which one is the item's is a person's call, so none is taken.
   */
  pathname: string | null;
  contentType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  /** How many different pictures are anchored on the row. 1 for a picture taken. */
  pictures: number;
};

/**
 * Every row's picture, by SHEET NAME and then by the row's 1-based number — the
 * same number as `BoqLine.lineNo`. Keyed by the sheet's row rather than by a
 * staged line, so a re-read of the columns (which re-stages every line) finds
 * the same pictures: the rows did not move.
 */
export type BoqRowImages = Record<string, Record<string, BillRowImage>>;

/** The picture on one row of one sheet, or null. Data from the past: read defensively. */
export function rowImageFor(
  rowImages: BoqRowImages | null | undefined,
  sheetName: string,
  lineNo: number,
): BillRowImage | null {
  const bySheet = rowImages && typeof rowImages === "object" ? rowImages[sheetName] : undefined;
  const image = bySheet && typeof bySheet === "object" ? bySheet[String(lineNo)] : undefined;
  if (!image || typeof image !== "object") return null;
  return image;
}
