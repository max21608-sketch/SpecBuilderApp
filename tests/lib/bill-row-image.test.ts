// The ONE answer to "this row's picture" (2026-10-05): a person's crop or
// "no picture" on the review, the bill's own picture otherwise. Every reader —
// the thumbnail route, the confirm's item picture, the fabric-swatch filing,
// the review's swatch sentence and the backfill — asks `effectiveRowImage`.
//
// Pure tier. Pathnames are invented.
import { describe, expect, it } from "vitest";
import {
  billPicturePrefix,
  effectiveRowImage,
  isNoPicture,
  isPictureCrop,
  type BillRowImage,
} from "@/lib/bill-row-image";

const printed: BillRowImage = {
  pathname: "projects/p/bill-images/r/abc.png",
  contentType: "image/png",
  size: 100,
  width: 40,
  height: 30,
  pictures: 1,
};
const twoPictures: BillRowImage = { pathname: null, contentType: null, size: null, width: null, height: null, pictures: 2 };
const parsed = { rowImages: { Bill: { "3": printed, "5": twoPictures } } };
const crop = {
  pathname: "projects/p/bill-images/r/crop-0-3-1.png",
  contentType: "image/png",
  size: 55,
  width: 20,
  height: 10,
};

describe("effectiveRowImage", () => {
  it("falls back to the bill's own picture where nobody chose", () => {
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 3 })).toEqual(printed);
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 3, picture: null })).toEqual(printed);
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 9 })).toBeNull();
    expect(effectiveRowImage(parsed, "Other", { lineNo: 3 })).toBeNull();
    expect(effectiveRowImage(null, "Bill", { lineNo: 3 })).toBeNull();
  });

  it("gives a person's crop in place of the bill's picture, as one picture taken", () => {
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 3, picture: crop })).toEqual({ ...crop, pictures: 1 });
  });

  it("gives nothing where a person chose no picture", () => {
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 3, picture: { none: true } })).toBeNull();
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 5, picture: { none: true } })).toBeNull();
  });

  it("leaves a row printing two pictures as it was read: nothing taken, the count kept", () => {
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 5 })).toEqual(twoPictures);
  });

  it("reads a malformed choice from the past as no choice", () => {
    const odd = { pathname: "", contentType: "image/png", size: null, width: null, height: null };
    expect(effectiveRowImage(parsed, "Bill", { lineNo: 3, picture: odd })).toEqual(printed);
    expect(isPictureCrop(odd)).toBe(false);
    expect(isNoPicture({ none: false } as unknown as { none: true })).toBe(false);
  });

  it("spells the run's picture prefix once", () => {
    expect(billPicturePrefix("p", "r")).toBe("projects/p/bill-images/r/");
  });
});
