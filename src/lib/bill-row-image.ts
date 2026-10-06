// The picture a bill prints on an item's row — the staged shape, and where to
// find one. A LEAF: types and one lookup, no database, no blob store, no
// workbook reader, so the review screen can import it without pulling any of
// those into the browser bundle. The reading and the storing are in
// `bill-images.ts`, which is server-only.
//
// The Aman pricing document carries an "Image" column with a picture anchored
// on each item's row (measured 2026-10-04 on the real copy: 107 anchors on 100
// of its 101 lines, 45 distinct pictures). `read-excel-file` cannot see them;
// `exceljs` can, and that is all `bill-images.ts` uses it for. A picture Excel
// PLACES IN A CELL is invisible to both and is read off the workbook's own
// parts (`bill-cell-pictures.ts`, 2026-10-06) into the same per-row shape.

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

// ---- a person's choice of picture, over the bill's -----------------------------
//
// ============================================================================
// THE BILL'S PICTURE CAN BE CROPPED, OR REFUSED, ON THE REVIEW (Max,
// 2026-10-05): "the option to kind of crop on the image has been lost … it's
// quite useful, especially because for some of them, I don't know what's going
// on". A pricing document prints a render beside a drawing in one picture, and
// the item is half of it.
//
// So a staged line may carry `picture`, set by a person on the review:
//
//   * absent or null — the bill's own picture, as read at registration;
//   * `{ none: true }` — no picture: the record gets none, the code no swatch;
//   * a stored crop — a PNG the browser cut out of the bill's picture and
//     uploaded under this run's own prefix (`billPicturePrefix`).
//
// ONE ANSWER TO "THIS ROW'S PICTURE". `effectiveRowImage` is what every reader
// asks — the thumbnail and swatch route, the confirm's item picture, the
// fabric-swatch filing (whose "the same picture on every line of a code" then
// compares what each line will REALLY give), the review's swatch sentence and
// `db:backfill-bill-swatches`. Two of those reading `rowImageFor` directly is
// how the review shows a crop and the confirm files the uncropped picture.
//
// A crop is a different file from the picture it was cut from, so two lines of
// one code cropped separately are two different pictures to the swatch rule —
// which is the truth: they are different pixels, and which is the swatch is a
// person's call. Taking "The whole picture" on both puts them back the same.
// ============================================================================

/** A crop a person stored for a row, in place of the bill's own picture. */
export type BillPictureCrop = {
  /** Under `billPicturePrefix(projectId, runId)` — a PATHNAME, never a URL. */
  pathname: string;
  contentType: string;
  size: number | null;
  width: number | null;
  height: number | null;
};

/** What a person chose for a row's picture. Null (or absent): the bill's own. */
export type BillPictureOverride = BillPictureCrop | { none: true };

/** Where a run's row pictures and their crops are stored. The one place the prefix is spelt. */
export function billPicturePrefix(projectId: string, runId: string): string {
  return `projects/${projectId}/bill-images/${runId}/`;
}

/** Whether an override is "no picture". Data from the past: read defensively. */
export function isNoPicture(picture: BillPictureOverride | null | undefined): picture is { none: true } {
  return Boolean(picture && typeof picture === "object" && "none" in picture && picture.none === true);
}

/** Whether an override is a stored crop. */
export function isPictureCrop(picture: BillPictureOverride | null | undefined): picture is BillPictureCrop {
  return Boolean(
    picture && typeof picture === "object" && "pathname" in picture && typeof picture.pathname === "string" && picture.pathname,
  );
}

/**
 * THE PICTURE A ROW WILL GIVE — the person's choice where they made one, the
 * bill's own otherwise. Every reader of a row's picture calls this, never
 * `rowImageFor` on its own. Pure.
 *
 * A crop reads as one picture taken (`pictures: 1`), whatever the row printed:
 * a row with two different pictures stored neither, so nothing on it can be
 * cropped (`stageBillRowImages`), and a crop's `pictures` would otherwise say a
 * picture was refused that was in fact chosen.
 */
export function effectiveRowImage(
  parsed: { rowImages?: BoqRowImages | null } | null | undefined,
  sheetName: string,
  line: { lineNo: number; picture?: BillPictureOverride | null },
): BillRowImage | null {
  const picture = line.picture;
  if (isNoPicture(picture)) return null;
  if (isPictureCrop(picture)) {
    return {
      pathname: picture.pathname,
      contentType: picture.contentType || "image/png",
      size: typeof picture.size === "number" ? picture.size : null,
      width: typeof picture.width === "number" ? picture.width : null,
      height: typeof picture.height === "number" ? picture.height : null,
      pictures: 1,
    };
  }
  return rowImageFor(parsed?.rowImages, sheetName, line.lineNo);
}
