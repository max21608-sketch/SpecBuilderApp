// The pictures a bill's workbook prints on its item rows, read and stored at
// staging so the review can show each line's thumbnail and the confirm can
// give a record with no picture this one.
//
// ============================================================================
// MEASURED FIRST (2026-10-04), on the real Aman pricing document (4.5MB):
// `exceljs` loads it in ~80ms (`read-excel-file`, which the bill reader uses,
// ~30ms) and `getImages()` costs nothing more. 111 anchors in all: 107 on the
// bill sheet, 100 of its 101 lines carrying one, every one anchored in the
// "Image" column on the line's own row (`tl.nativeRow` is 0-based, so row
// `nativeRow + 1` is the line's `lineNo`), 45 distinct pictures. One line
// (a stool) carries two different pictures; seven fabric lines carry the same
// picture twice. One logo sits above the header and one picture is anchored
// a thousand rows below the bill, on no line at all.
//
// THE RULES, EACH A TRAP
//
// - A ROW IS ITS PICTURE ONLY WHERE IT CARRIES ONE. The same picture anchored
//   twice is one picture (deduplicated by its bytes). Two DIFFERENT pictures
//   on one row are recorded as a count and NOTHING is taken: which of them is
//   the item is a person's call, and picking the first would be this app
//   choosing a picture of the wrong thing.
// - STORED BY CONTENT, under the project (`blob-source.ts`): one blob per
//   distinct picture per run, `projects/<id>/bill-images/<run>/<sha>.<ext>`,
//   written with no random suffix so a re-read overwrites rather than
//   accumulates. A pathname, never a URL.
// - EVERY ROW WITH A PICTURE IS STORED, not only the rows staged as lines. A
//   sheet nobody could read the headings of stages no lines at all, and is
//   re-staged with lines when a person sets its columns — the rows did not
//   move, so the pictures read at registration are still the right ones. The
//   cost is a logo or two that no line ever shows.
// - NEVER FAILS A BILL. A workbook whose pictures cannot be read stages its
//   lines exactly as before, with a sentence saying why there are no pictures.
//   A picture is an aid to recognising an item; the bill is the data.
// - Only what a browser shows: png, jpeg, gif. Anything else is left in the
//   workbook.
// - A PICTURE PLACED IN A CELL IS THE ROW'S PICTURE TOO (2026-10-06). Excel's
//   "Place in Cell" is not an anchor and `getImages()` never sees it; the
//   Butler Arms bedrooms bill carries 14 of them beside 3 floating ones.
//   `bill-cell-pictures.ts` reads them off the workbook's own parts and they
//   join the SAME per-row list, so every rule above holds for both kinds with
//   no second set: the same bytes floating and in a cell is one picture, and
//   a floating picture beside a DIFFERENT in-cell one is two, so none. A sheet
//   whose in-cell parts cannot be read keeps its floating pictures and says
//   so in a sentence.
// ============================================================================
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { put } from "@vercel/blob";
import { readCellPictures } from "@/lib/bill-cell-pictures";
import { billPicturePrefix, type BillRowImage, type BoqRowImages } from "@/lib/bill-row-image";

/** A single picture larger than this is left in the workbook: it is a thumbnail's source, not a document. */
export const MAX_BILL_PICTURE_BYTES = 5 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" };

export type BillPicture = { bytes: Buffer; extension: string; contentType: string; sha: string };

/** One picture's bytes under the rules both kinds share, or null where the rules leave it in the workbook. */
function pictureOf(raw: Uint8Array | undefined, rawExtension: string): BillPicture | null {
  const extension = rawExtension.toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType || !raw) return null;
  const bytes = Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > MAX_BILL_PICTURE_BYTES) return null;
  const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  return { bytes, extension: extension === "jpg" ? "jpeg" : extension, contentType, sha };
}

/** Put a picture on its row, once: the same bytes twice is one picture, whichever kind each was. */
function hold(rows: Map<number, BillPicture[]>, row: number, picture: BillPicture): void {
  const held = rows.get(row) ?? [];
  if (!held.some((each) => each.sha === picture.sha)) held.push(picture);
  rows.set(row, held);
}

/**
 * Every picture on a row, by sheet name and 1-based row, distinct by bytes —
 * FLOATING pictures (anchored over the sheet, read by `exceljs`) and pictures
 * PLACED IN A CELL (`bill-cell-pictures.ts`) alike, into the one per-row list
 * the rules below read. Pure apart from parsing the workbook: nothing is
 * stored. Where a sheet's in-cell pictures could not be read, a sentence is
 * pushed onto `notes` and that sheet keeps its floating pictures only; a
 * workbook `exceljs` cannot open at all still throws, as it always has.
 */
export async function readBillPictures(
  workbookBytes: Buffer,
  notes: string[] = [],
): Promise<Map<string, Map<number, BillPicture[]>>> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(workbookBytes as unknown as ArrayBuffer);
  const out = new Map<string, Map<number, BillPicture[]>>();
  const rowsOf = (sheetName: string) => {
    const rows = out.get(sheetName) ?? new Map<number, BillPicture[]>();
    out.set(sheetName, rows);
    return rows;
  };
  for (const sheet of book.worksheets) {
    for (const anchor of sheet.getImages()) {
      const nativeRow = anchor.range?.tl?.nativeRow;
      if (typeof nativeRow !== "number" || !Number.isInteger(nativeRow) || nativeRow < 0) continue;
      const media = book.getImage(Number(anchor.imageId));
      // exceljs types its buffer as its own interface; at run time it is a Node Buffer.
      const picture = pictureOf(media?.buffer as unknown as Uint8Array | undefined, String(media?.extension ?? ""));
      if (picture) hold(rowsOf(sheet.name), nativeRow + 1, picture);
    }
  }

  const inCell = await readCellPictures(workbookBytes);
  if (inCell.workbookError) {
    notes.push(`The pictures placed in cells in this workbook could not be read (${inCell.workbookError}), so no line shows one of those.`);
  }
  for (const [sheetName, found] of inCell.bySheet) {
    if ("error" in found) {
      notes.push(`The pictures placed in cells on "${sheetName}" could not be read (${found.error}), so no line shows one of those.`);
      continue;
    }
    for (const cell of found.pictures) {
      const picture = pictureOf(cell.bytes, cell.extension);
      if (picture) hold(rowsOf(sheetName), cell.row, picture);
    }
  }

  for (const [sheetName, rows] of out) if (rows.size === 0) out.delete(sheetName);
  return out;
}

/** A picture's pixel size from its own header, or null. Never guessed. */
export function pictureSize(bytes: Buffer, contentType: string): { width: number; height: number } | null {
  if (contentType === "image/png" && bytes.length >= 24 && bytes.toString("latin1", 12, 16) === "IHDR") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (contentType === "image/gif" && bytes.length >= 10 && bytes.toString("latin1", 0, 3) === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (contentType === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      const length = bytes.readUInt16BE(at + 2);
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
  }
  return null;
}

/** Writes one picture to the store at a pathname. Injected so the tiers below the store can run without one. */
export type PictureStore = (pathname: string, bytes: Buffer, contentType: string) => Promise<void>;

export const blobPictureStore: PictureStore = async (pathname, bytes, contentType) => {
  await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
};

/**
 * Read the workbook's row pictures and store each distinct one under the
 * project. Returns what the staged document carries: `rowImages`, and a
 * sentence where the pictures could not be read or stored. Never throws.
 */
export async function stageBillRowImages(
  workbookBytes: Buffer,
  { projectId, runId }: { projectId: string; runId: string },
  store: PictureStore = blobPictureStore,
): Promise<{ rowImages: BoqRowImages; rowImagesNote: string | null }> {
  let pictures: Map<string, Map<number, BillPicture[]>>;
  const notes: string[] = [];
  try {
    pictures = await readBillPictures(workbookBytes, notes);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { rowImages: {}, rowImagesNote: `The pictures in this workbook could not be read (${why}), so no line shows one.` };
  }

  const prefix = billPicturePrefix(projectId, runId);
  const distinct = new Map<string, BillPicture>();
  for (const rows of pictures.values()) {
    for (const held of rows.values()) {
      if (held.length === 1 && held[0]) distinct.set(held[0].sha, held[0]);
    }
  }
  const stored = new Map<string, string>();
  try {
    // Four at a time: a bill is tens of pictures, and one at a time is seconds
    // of a registration somebody is waiting on.
    const queue = [...distinct.values()];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const pathname = `${prefix}${next.sha}.${next.extension}`;
        await store(pathname, next.bytes, next.contentType);
        stored.set(next.sha, pathname);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { rowImages: {}, rowImagesNote: `The pictures in this workbook could not be stored (${why}), so no line shows one.` };
  }

  const rowImages: BoqRowImages = {};
  for (const [sheetName, rows] of pictures) {
    const bySheet: Record<string, BillRowImage> = {};
    for (const [row, held] of rows) {
      const only = held.length === 1 ? held[0] : undefined;
      const pathname = only ? (stored.get(only.sha) ?? null) : null;
      const size = only ? pictureSize(only.bytes, only.contentType) : null;
      bySheet[String(row)] = {
        pathname,
        contentType: only && pathname ? only.contentType : null,
        size: only && pathname ? only.bytes.length : null,
        width: size?.width ?? null,
        height: size?.height ?? null,
        pictures: held.length,
      };
    }
    rowImages[sheetName] = bySheet;
  }
  return { rowImages, rowImagesNote: notes.length > 0 ? notes.join(" ") : null };
}
