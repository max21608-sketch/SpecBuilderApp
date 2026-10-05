// Where an item's picture came from, and which one a person may swap in.
//
// ============================================================================
// A PHOTO OR A RENDER BEATS A DRAWING (Max, 2026-10-05).
//
// "We always prefer a picture over a drawing … a 3D render over a drawing."
// Until then a drawings confirm DELETED whatever `item_image` a record held and
// put its crop in its place — so the picture a bill printed beside an item, the
// one thing in the pack that looks like the finished piece, was replaced by a
// line drawing the moment the drawings were confirmed, and it was gone for
// good. Two rules came out of that, and this file is the pure half of both:
//
// - A picture is never deleted, only SUPERSEDED (0013: "an attachment is never
//   deleted from here on"). Every reader takes the CURRENT one — `superseded_at
//   is null`, newest — and a version keeps the one it was taken with.
// - A drawing crop does not displace a bill's picture on its own. It is stored
//   beside it as an ALTERNATIVE, and a person swaps it in on the record if they
//   want it. The reverse is offered too, so the choice is always reversible.
//
// ---- WHERE A PICTURE CAME FROM IS DERIVED, NOT STORED ---------------------
//
// `attachments` has no source column, and this is deliberately not the
// migration that adds one. The two writers already say it: a bill's picture is
// stored under `bill-images/` and named `bill row N.<ext>` (`confirm-boq.ts`),
// a drawing crop under `item-images/` and — from this change — named
// `<itemId>-page-N.png`, the way `swatchFilename` keeps a swatch's page. A
// column would be a second statement of a fact the path already makes, and the
// two could disagree. A row matching neither is `other` and the screen says
// that in words rather than guessing — the demo's drawn pictures are `other`,
// and so is a crop confirmed before the page reached the filename (it is still
// under `item-images/`, so it reads as a drawing crop with no page).
//
// Pure, and imported by the record screen, so it holds no database import.
// ============================================================================

/** The record's picture. Exactly one CURRENT row per record is the intent. */
export const ITEM_IMAGE_KIND = "item_image";

/**
 * A picture a document OFFERED for the record and nobody has chosen yet.
 *
 * `attachments.kind` carries NO CHECK constraint (0001: polymorphic on
 * purpose; no migration since has added one), so a new kind needs no
 * migration — which is also why nothing but this constant stops a typo, and
 * why every writer and reader names it from here.
 */
export const ITEM_IMAGE_ALTERNATIVE_KIND = "item_image_alternative";

export type ItemImageSource =
  | { kind: "bill"; row: number | null }
  | { kind: "drawing"; page: number | null }
  | { kind: "other" };

const BILL_ROW_FILENAME = /^bill row (\d+)\.[a-z0-9]+$/i;
const DRAWING_PAGE_FILENAME = /-page-(\d+)\.[a-z0-9]+$/i;

function positiveInt(text: string | undefined): number | null {
  if (!text) return null;
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Where a stored picture came from, read off its path and its name.
 *
 * The PREFIX decides the kind and the FILENAME only adds the row or the page:
 * a filename is the less trustworthy of the two (a client sent it, for years),
 * so a file called `bill row 3.png` under `item-images/` is a drawing crop with
 * no page, never a bill picture. Matched as a path SEGMENT, so a stored URL
 * (older rows hold one) and a bare pathname read the same.
 */
export function itemImageSource(attachment: { storagePath: string; filename: string | null }): ItemImageSource {
  const path = attachment.storagePath;
  const filename = (attachment.filename ?? "").trim();
  if (path.includes("/bill-images/")) {
    return { kind: "bill", row: positiveInt(BILL_ROW_FILENAME.exec(filename)?.[1]) };
  }
  if (path.includes("/item-images/")) {
    return { kind: "drawing", page: positiveInt(DRAWING_PAGE_FILENAME.exec(filename)?.[1]) };
  }
  return { kind: "other" };
}

/**
 * What a drawing crop is CALLED, which is the only place its page survives.
 *
 * The page the crop was TAKEN from, as the picker reports it — on a two-page
 * item that need not be the card's first page, and a crop citing the wrong page
 * would be a false provenance rather than a missing one. With no page the old
 * name stands, so nothing is invented. The storage PATH scheme is unchanged.
 */
export function itemImageFilename(itemId: string, page: number | null | undefined, fallback?: string | null): string {
  if (typeof page === "number" && Number.isInteger(page) && page > 0) return `${itemId}-page-${page}.png`;
  return fallback?.trim() || "item.png";
}

/** The sentence under the picture. Says what is known and nothing more. */
export function itemImageCaption(source: ItemImageSource): string {
  switch (source.kind) {
    case "bill":
      return source.row ? `From the bill, row ${source.row}` : "From the bill";
    case "drawing":
      return source.page ? `Cropped off the drawings, page ${source.page}` : "Cropped off the drawings";
    default:
      return "Where this picture came from is not recorded";
  }
}

/** One of a record's picture rows, as the readers load it. */
export type ItemPictureRow = {
  id: string;
  kind: string;
  storagePath: string;
  filename: string | null;
  /** ISO text. Compared as a string, which orders ISO timestamps correctly. */
  createdAt: string;
  supersededAt: string | null;
};

function newestFirst(a: ItemPictureRow, b: ItemPictureRow): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1;
}

/** The record's CURRENT picture: an `item_image` nobody superseded, the newest. */
export function currentPicture(rows: readonly ItemPictureRow[]): ItemPictureRow | null {
  return [...rows].filter((row) => row.kind === ITEM_IMAGE_KIND && !row.supersededAt).sort(newestFirst)[0] ?? null;
}

/**
 * The ONE other picture a person is offered in place of the current one.
 *
 * - The current picture is the bill's (or of no known source): the newest
 *   DRAWING crop — an alternative a drawings confirm stored beside it, or a
 *   crop that was current once and was swapped out. "Use the drawing's
 *   picture".
 * - The current picture is a drawing crop: the newest BILL picture it took the
 *   place of. "Use the bill's picture" — so the choice is always reversible.
 * - No current picture: an alternative still waiting, if there is one.
 *
 * Never the current row, and never another row of the SAME file: a swap back
 * and forth writes a new row per choice (rows are never re-pointed), so an old
 * row naming the file on screen now is no choice at all.
 */
export function offeredPicture(rows: readonly ItemPictureRow[]): ItemPictureRow | null {
  const current = currentPicture(rows);
  const candidates = [...rows]
    .filter((row) => row.id !== current?.id && row.storagePath !== current?.storagePath)
    .filter(
      (row) =>
        (row.kind === ITEM_IMAGE_ALTERNATIVE_KIND && !row.supersededAt) ||
        (row.kind === ITEM_IMAGE_KIND && Boolean(row.supersededAt)),
    )
    .sort(newestFirst);
  if (!current) return candidates.find((row) => row.kind === ITEM_IMAGE_ALTERNATIVE_KIND) ?? null;
  const want: ItemImageSource["kind"] = itemImageSource(current).kind === "drawing" ? "bill" : "drawing";
  return candidates.find((row) => itemImageSource(row).kind === want) ?? null;
}

/** The words beside an offered picture, and on the button that takes it. */
export function offeredPictureWords(source: ItemImageSource): { note: string; action: string } {
  return source.kind === "bill"
    ? { note: "The bill printed this picture", action: "Use the bill's picture" }
    : source.kind === "drawing"
      ? { note: "The drawings offer this picture", action: "Use the drawing's picture" }
      : { note: "An earlier picture of this item", action: "Use this picture" };
}
