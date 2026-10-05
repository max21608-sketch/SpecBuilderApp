// Pure tier — where an item's picture came from, and which other picture a
// person is offered (2026-10-05: a photo or a render beats a drawing).
import { describe, expect, it } from "vitest";
import {
  ITEM_IMAGE_ALTERNATIVE_KIND,
  ITEM_IMAGE_KIND,
  currentPicture,
  itemImageCaption,
  itemImageFilename,
  itemImageSource,
  offeredPicture,
  offeredPictureWords,
  type ItemPictureRow,
} from "@/lib/item-image";
import { picturesKeptNote } from "@/lib/confirm-drawings";

const P = "projects/00000000-0000-0000-0000-0000000000aa";

describe("itemImageSource", () => {
  it("reads a bill's picture off its path, and its row off its name", () => {
    expect(itemImageSource({ storagePath: `${P}/bill-images/run/abc.png`, filename: "bill row 36.png" })).toEqual({
      kind: "bill",
      row: 36,
    });
    expect(itemImageSource({ storagePath: `${P}/bill-images/run/abc.jpg`, filename: "bill row 4.jpg" })).toEqual({
      kind: "bill",
      row: 4,
    });
  });

  it("keeps a bill picture a bill picture when the name says nothing", () => {
    expect(itemImageSource({ storagePath: `${P}/bill-images/run/abc.png`, filename: null })).toEqual({ kind: "bill", row: null });
    expect(itemImageSource({ storagePath: `${P}/bill-images/run/abc.png`, filename: "row 0.png" })).toEqual({ kind: "bill", row: null });
  });

  it("reads a drawing crop's page off its name, and none from an older crop", () => {
    expect(itemImageSource({ storagePath: `${P}/item-images/item-1-1700.png`, filename: "item-1-page-4.png" })).toEqual({
      kind: "drawing",
      page: 4,
    });
    expect(itemImageSource({ storagePath: `${P}/item-images/item-1-1700.png`, filename: "item-1.png" })).toEqual({
      kind: "drawing",
      page: null,
    });
  });

  it("lets the PATH decide the kind, never the name", () => {
    // A client named crops for years: a crop called "bill row 3.png" is still a crop.
    expect(itemImageSource({ storagePath: `${P}/item-images/x.png`, filename: "bill row 3.png" })).toEqual({
      kind: "drawing",
      page: null,
    });
    expect(itemImageSource({ storagePath: `${P}/demo/picture-s-100.png`, filename: "item-page-2.png" })).toEqual({ kind: "other" });
  });

  it("reads a stored URL the same as a pathname", () => {
    expect(
      itemImageSource({ storagePath: `https://x.blob.vercel-storage.com/${P}/bill-images/r/a.png`, filename: "bill row 9.png" }),
    ).toEqual({ kind: "bill", row: 9 });
  });
});

describe("itemImageFilename", () => {
  it("names the page the crop was taken from, and invents none", () => {
    expect(itemImageFilename("item-1", 4)).toBe("item-1-page-4.png");
    expect(itemImageFilename("item-1", null, "item-1.png")).toBe("item-1.png");
    expect(itemImageFilename("item-1", 0, null)).toBe("item.png");
    expect(itemImageFilename("item-1", 2.5, "x.png")).toBe("x.png");
  });

  it("round-trips through itemImageSource", () => {
    expect(itemImageSource({ storagePath: `${P}/item-images/a.png`, filename: itemImageFilename("abc", 7) })).toEqual({
      kind: "drawing",
      page: 7,
    });
  });
});

describe("itemImageCaption", () => {
  it("says what is known and nothing more", () => {
    expect(itemImageCaption({ kind: "bill", row: 36 })).toBe("From the bill, row 36");
    expect(itemImageCaption({ kind: "bill", row: null })).toBe("From the bill");
    expect(itemImageCaption({ kind: "drawing", page: 4 })).toBe("Cropped off the drawings, page 4");
    expect(itemImageCaption({ kind: "drawing", page: null })).toBe("Cropped off the drawings");
    expect(itemImageCaption({ kind: "other" })).toBe("Where this picture came from is not recorded");
  });
});

let n = 0;
const row = (overrides: Partial<ItemPictureRow> & Pick<ItemPictureRow, "storagePath">): ItemPictureRow => ({
  id: `id-${(n += 1)}`,
  kind: ITEM_IMAGE_KIND,
  filename: null,
  createdAt: "2026-10-05 10:00:00+00",
  supersededAt: null,
  ...overrides,
});
const bill = (at: string, more: Partial<ItemPictureRow> = {}) =>
  row({ storagePath: `${P}/bill-images/r/${at}.png`, filename: "bill row 3.png", createdAt: at, ...more });
const crop = (at: string, more: Partial<ItemPictureRow> = {}) =>
  row({ storagePath: `${P}/item-images/${at}.png`, filename: "i-page-2.png", createdAt: at, ...more });

describe("currentPicture", () => {
  it("is the newest item_image nobody superseded, never an alternative", () => {
    const old = bill("2026-10-01", { supersededAt: "2026-10-02" });
    const now = crop("2026-10-02");
    const offer = crop("2026-10-03", { kind: ITEM_IMAGE_ALTERNATIVE_KIND });
    expect(currentPicture([old, now, offer])?.id).toBe(now.id);
    expect(currentPicture([offer])).toBeNull();
    expect(currentPicture([])).toBeNull();
  });
});

describe("offeredPicture", () => {
  it("offers the drawing's crop beside a bill's picture", () => {
    const current = bill("2026-10-01");
    const offer = crop("2026-10-02", { kind: ITEM_IMAGE_ALTERNATIVE_KIND });
    expect(offeredPicture([current, offer])?.id).toBe(offer.id);
  });

  it("offers nothing where nothing else is on the record", () => {
    expect(offeredPicture([bill("2026-10-01")])).toBeNull();
    expect(offeredPicture([crop("2026-10-01")])).toBeNull();
    expect(offeredPicture([])).toBeNull();
  });

  it("offers the bill's picture back once a crop has taken its place", () => {
    const was = bill("2026-10-01", { supersededAt: "2026-10-03" });
    const offerTaken = crop("2026-10-02", { kind: ITEM_IMAGE_ALTERNATIVE_KIND, supersededAt: "2026-10-03" });
    const now = crop("2026-10-03", { storagePath: offerTaken.storagePath });
    expect(currentPicture([was, offerTaken, now])?.id).toBe(now.id);
    expect(offeredPicture([was, offerTaken, now])?.id).toBe(was.id);
  });

  it("offers the crop again after the bill's picture is chosen back", () => {
    const first = bill("2026-10-01", { supersededAt: "2026-10-03" });
    const cropNow = crop("2026-10-03", { supersededAt: "2026-10-04" });
    const billAgain = bill("2026-10-04", { storagePath: first.storagePath });
    expect(offeredPicture([first, cropNow, billAgain])?.id).toBe(cropNow.id);
  });

  it("never offers another row of the file already on screen", () => {
    const first = bill("2026-10-01", { supersededAt: "2026-10-03" });
    const billAgain = bill("2026-10-04", { storagePath: first.storagePath });
    expect(offeredPicture([first, billAgain])).toBeNull();
  });

  it("offers the NEWEST drawing crop, a waiting alternative before an older swapped-out crop", () => {
    const current = bill("2026-10-05");
    const olderCrop = crop("2026-10-02", { supersededAt: "2026-10-05" });
    const offer = crop("2026-10-06", { kind: ITEM_IMAGE_ALTERNATIVE_KIND });
    expect(offeredPicture([current, olderCrop, offer])?.id).toBe(offer.id);
  });

  it("does not offer a superseded alternative, or an older crop over a drawing crop", () => {
    const current = crop("2026-10-03");
    const goneOffer = crop("2026-10-02", { kind: ITEM_IMAGE_ALTERNATIVE_KIND, supersededAt: "2026-10-03" });
    const olderCrop = crop("2026-10-01", { supersededAt: "2026-10-03" });
    expect(offeredPicture([current, goneOffer, olderCrop])).toBeNull();
  });

  it("offers a waiting alternative where the record has no picture at all", () => {
    const offer = crop("2026-10-02", { kind: ITEM_IMAGE_ALTERNATIVE_KIND });
    expect(offeredPicture([offer])?.id).toBe(offer.id);
  });
});

describe("the words", () => {
  it("names the offer by where it came from", () => {
    expect(offeredPictureWords({ kind: "drawing", page: 2 })).toEqual({
      note: "The drawings offer this picture",
      action: "Use the drawing's picture",
    });
    expect(offeredPictureWords({ kind: "bill", row: 3 }).action).toBe("Use the bill's picture");
  });

  it("says what the confirm kept", () => {
    expect(picturesKeptNote(1)).toBe("Kept the bill's picture; the drawing's crop is offered on the record.");
    expect(picturesKeptNote(3)).toMatch(/on 3 records/);
  });
});
