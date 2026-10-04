// The pictures a bill's workbook prints on its rows, read and stored at
// staging. A SYNTHETIC workbook built in memory (`picturedBillWorkbook`): the
// shape is the Aman pricing document's Image column, the pictures and rows
// are invented. The store is a map, so nothing here needs a blob store.
import { describe, expect, it } from "vitest";
import { BILL_PICTURES, picturedBillWorkbook } from "../fixtures/build-boq";
import { pictureSize, readBillPictures, stageBillRowImages, type PictureStore } from "@/lib/bill-images";
import { rowImageFor } from "@/lib/bill-row-image";
import { readSpreadsheetSheets } from "@/lib/intake-source";
import { parseBoqSheets } from "@/lib/boq-import";

const PROJECT = "00000000-0000-0000-0000-0000000000aa";
const RUN = "00000000-0000-0000-0000-0000000000bb";

function memoryStore() {
  const written = new Map<string, { bytes: Buffer; contentType: string }>();
  const store: PictureStore = async (pathname, bytes, contentType) => {
    written.set(pathname, { bytes, contentType });
  };
  return { store, written };
}

describe("readBillPictures", () => {
  it("finds each row's pictures by the row the BILL READER numbers the line with", async () => {
    const bytes = await picturedBillWorkbook();
    const pictures = await readBillPictures(bytes);
    const rows = pictures.get("Bill")!;
    expect([...rows.keys()].sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
    expect(rows.get(3)!.map((picture) => picture.bytes)).toEqual([BILL_PICTURES.stool]);
    // The same picture anchored twice is ONE picture.
    expect(rows.get(4)).toHaveLength(1);
    // Two different pictures stay two.
    expect(rows.get(5)).toHaveLength(2);

    // The row numbers are the line numbers `parseBoqSheets` gives the items.
    const parsed = parseBoqSheets(await readSpreadsheetSheets(bytes, "bill.xlsx", ""));
    const lines = parsed.sheets?.[0]?.lines ?? [];
    expect(lines.map((line) => [line.lineNo, line.code])).toEqual([
      [3, "ZZ-FUR-10"],
      [4, "ZZ-FUR-26"],
      [5, "ZZ-FUR-04"],
      [6, "ZZ-FUR-05"],
    ]);
  });

  it("reads a picture's size from its own header", () => {
    expect(pictureSize(BILL_PICTURES.stool, "image/png")).toEqual({ width: 4, height: 3 });
    expect(pictureSize(Buffer.from("not a picture"), "image/png")).toBeNull();
  });
});

describe("stageBillRowImages", () => {
  it("stores each distinct picture once, under the project, and takes none from a row with two", async () => {
    const { store, written } = memoryStore();
    const { rowImages, rowImagesNote } = await stageBillRowImages(
      await picturedBillWorkbook(),
      { projectId: PROJECT, runId: RUN },
      store,
    );
    expect(rowImagesNote).toBeNull();
    // logo, stool, drawers — the alternative is only ever on a row with two.
    expect(written.size).toBe(3);
    for (const pathname of written.keys()) {
      expect(pathname.startsWith(`projects/${PROJECT}/bill-images/${RUN}/`)).toBe(true);
      expect(pathname.endsWith(".png")).toBe(true);
    }

    const stool = rowImageFor(rowImages, "Bill", 3)!;
    expect(stool).toMatchObject({ contentType: "image/png", width: 4, height: 3, pictures: 1, size: BILL_PICTURES.stool.length });
    expect(written.get(stool.pathname!)?.bytes).toEqual(BILL_PICTURES.stool);
    expect(rowImageFor(rowImages, "Bill", 4)).toMatchObject({ pictures: 1, width: 5, height: 5 });
    expect(rowImageFor(rowImages, "Bill", 5)).toEqual({
      pathname: null,
      contentType: null,
      size: null,
      width: null,
      height: null,
      pictures: 2,
    });
    expect(rowImageFor(rowImages, "Bill", 6)).toBeNull();
    expect(rowImageFor(rowImages, "Another sheet", 3)).toBeNull();
  });

  it("never fails the bill: an unreadable workbook or a refusing store is a sentence", async () => {
    const unreadable = await stageBillRowImages(Buffer.from("not a workbook"), { projectId: PROJECT, runId: RUN });
    expect(unreadable.rowImages).toEqual({});
    expect(unreadable.rowImagesNote).toMatch(/could not be read/);

    const refusing: PictureStore = async () => {
      throw new Error("store unavailable");
    };
    const stored = await stageBillRowImages(await picturedBillWorkbook(), { projectId: PROJECT, runId: RUN }, refusing);
    expect(stored.rowImages).toEqual({});
    expect(stored.rowImagesNote).toMatch(/could not be stored \(store unavailable\)/);
  });
});
