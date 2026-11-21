// A file's parts become one registration per reader, each with its own
// request id, and nothing while a part is unanswered (`upload-reads.ts`).
import { describe, expect, it } from "vitest";
import { nextRequestId, partOfPlace, readsOf, SKIP_PART } from "@/lib/upload-reads";

const pages = (from: number, to: number) => ({ kind: "pages" as const, from, to });

describe("readsOf", () => {
  it("gives a three-part PDF three reads, each with its own pages", () => {
    const result = readsOf([
      { place: pages(1, 12), kind: "boq" },
      { place: pages(13, 30), kind: "shop_drawings" },
      { place: pages(31, 40), kind: "preamble" },
    ]);
    expect(result.blocked).toBe(false);
    expect(result.reads.map((read) => [read.kind, read.part])).toEqual([
      ["boq", { kind: "pages", ranges: [{ from: 1, to: 12 }] }],
      ["shop_drawings", { kind: "pages", ranges: [{ from: 13, to: 30 }] }],
      ["preamble", { kind: "pages", ranges: [{ from: 31, to: 40 }] }],
    ]);
    expect(new Set(result.reads.map((read) => read.key)).size).toBe(3);
  });

  it("puts two parts of one kind into ONE read with both places", () => {
    const result = readsOf([
      { place: pages(1, 11), kind: "shop_drawings" },
      { place: pages(12, 30), kind: "preamble" },
      { place: pages(31, 44), kind: "shop_drawings" },
    ]);
    expect(result.reads[0]).toMatchObject({
      kind: "shop_drawings",
      partIndexes: [0, 2],
      part: { kind: "pages", ranges: [{ from: 1, to: 11 }, { from: 31, to: 44 }] },
    });
    expect(result.reads).toHaveLength(2);
  });

  it("registers the WHOLE file where every part goes to one reader", () => {
    const result = readsOf([
      { place: pages(1, 3), kind: "shop_drawings" },
      { place: pages(4, 9), kind: "shop_drawings" },
    ]);
    expect(result.reads).toEqual([{ kind: "shop_drawings", part: null, partIndexes: [0, 1], key: "shop_drawings|whole" }]);
  });

  it("registers nothing for a part left out, and keeps the rest to their places", () => {
    const result = readsOf([
      { place: pages(1, 1), kind: SKIP_PART },
      { place: pages(2, 9), kind: "shop_drawings" },
    ]);
    expect(result.reads).toEqual([
      { kind: "shop_drawings", part: { kind: "pages", ranges: [{ from: 2, to: 9 }] }, partIndexes: [1], key: "shop_drawings|pages:2-9" },
    ]);
  });

  it("registers nothing at all while any part is unanswered", () => {
    expect(
      readsOf([
        { place: pages(1, 3), kind: "boq" },
        { place: pages(4, 9), kind: "" },
      ]),
    ).toEqual({ blocked: true, reads: [] });
  });

  it("reads sheets as sheets, and a row range of a sheet as the whole sheet", () => {
    const result = readsOf([
      { place: { kind: "sheet", sheet: "MUR" }, kind: "boq" },
      { place: { kind: "sheet", sheet: "MAIN RUN" }, kind: "boq" },
      { place: { kind: "sheet", sheet: "Finishes", fromRow: 1, toRow: 40 }, kind: "finishes_schedule" },
    ]);
    expect(result.reads.map((read) => read.part)).toEqual([
      { kind: "sheets", sheets: ["MUR", "MAIN RUN"] },
      { kind: "sheets", sheets: ["Finishes"] },
    ]);
  });
});

describe("readsOf, once something of the file is sent (fix 1, 2026-11-21)", () => {
  const added = { state: "done" as const, message: null, registered: true, inDoubt: null };

  it("leaves a registered part out of every later read, and never takes the whole-file shortcut again", () => {
    // Drawings 1–11 registered; the bill on 12–30 came back refused and is now answered as drawings.
    const result = readsOf([
      { place: pages(1, 11), kind: "shop_drawings", read: added },
      { place: pages(12, 30), kind: "shop_drawings" },
    ]);
    expect(result.reads).toEqual([
      { kind: "shop_drawings", part: { kind: "pages", ranges: [{ from: 12, to: 30 }] }, partIndexes: [1], key: "shop_drawings|pages:12-30" },
    ]);
  });

  it("ignores a registered part's box: a changed kind is not a new read", () => {
    const result = readsOf([
      { place: pages(1, 11), kind: "preamble", read: added },
      { place: pages(12, 30), kind: SKIP_PART },
    ]);
    expect(result).toEqual({ blocked: false, reads: [] });
  });

  it("re-sends a read in doubt exactly as it was sent, whatever its parts' neighbours now say", () => {
    const sent = { key: "shop_drawings|pages:1-3", kind: "shop_drawings", part: { kind: "pages" as const, ranges: [{ from: 1, to: 3 }] } };
    const doubt = { state: "failed" as const, message: "Could not reach the server.", registered: false, inDoubt: sent };
    const result = readsOf([
      { place: pages(1, 3), kind: "shop_drawings", read: doubt },
      { place: pages(4, 9), kind: "shop_drawings" },
    ]);
    expect(result.reads).toEqual([
      { kind: "shop_drawings", part: sent.part, partIndexes: [0], key: sent.key },
      { kind: "shop_drawings", part: { kind: "pages", ranges: [{ from: 4, to: 9 }] }, partIndexes: [1], key: "shop_drawings|pages:4-9" },
    ]);
  });

  it("does not hold a file for a registered part with an empty box", () => {
    expect(readsOf([{ place: pages(1, 3), kind: "", read: added }]).blocked).toBe(false);
  });
});

describe("partOfPlace", () => {
  it("is null for an email's text and the whole file", () => {
    expect(partOfPlace({ kind: "body" })).toBeNull();
    expect(partOfPlace({ kind: "whole" })).toBeNull();
  });
});

describe("nextRequestId", () => {
  const fresh = () => "new-id";
  it("keeps the id after a success, and after no answer at all", () => {
    expect(nextRequestId("id", { ok: true, status: 200, data: {} }, fresh)).toBe("id");
    expect(nextRequestId("id", { ok: false, status: 0, data: null }, fresh)).toBe("id");
    // A gateway page is not the app's answer: the request may have landed.
    expect(nextRequestId("id", { ok: false, status: 504, data: null }, fresh)).toBe("id");
  });

  it("replaces the id once the server ANSWERED with its own refusal", () => {
    expect(nextRequestId("id", { ok: false, status: 400, data: { ok: false, error: "no" } }, fresh)).toBe("new-id");
    expect(nextRequestId("id", { ok: false, status: 500, data: { ok: false, error: "boom" } }, fresh)).toBe("new-id");
  });
});
