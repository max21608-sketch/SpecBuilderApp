// Pure tier. The pack survey's scorer (tools/survey-golden.ts) on INVENTED keys
// and invented survey answers: made-up codes, made-up files. No client
// document content is in this repo — the real keys live outside it.
import { describe, expect, it } from "vitest";
import type { DocumentGenre } from "@/lib/document-kinds";
import type { PartPlace, SurveyFile, SurveyPart } from "@/lib/pack-survey-types";
import {
  parseGolden,
  recallCodes,
  scoreFile,
  scoreItemLinks,
  scoreSurvey,
  totalSurveyScores,
  type PackGroups,
} from "../../tools/survey-golden";

const pages = (from: number, to: number): PartPlace => ({ kind: "pages", from, to });
const sheet = (name: string, fromRow?: number | null, toRow?: number | null): PartPlace => ({ kind: "sheet", sheet: name, fromRow, toRow });
const WHOLE: PartPlace = { kind: "whole" };
const BODY: PartPlace = { kind: "body" };

function surveyed(place: PartPlace, genre: DocumentGenre, extra: Partial<SurveyPart> = {}): SurveyPart {
  return { place, genre, certain: true, weighedAgainst: null, evidence: "", itemCodes: [], finishCodes: [], ...extra };
}

function survey(file: string, pageCount: number | null, parts: SurveyPart[]): SurveyFile {
  return { file, pageCount, parts, note: "" };
}

type KeyPart = { place: PartPlace; genre: string; itemCodes?: string[]; finishCodes?: string[] };
function keyFile(file: string, pageCount: number | null, parts: KeyPart[]) {
  return { file, pageCount, parts };
}
function key(files: ReturnType<typeof keyFile>[], items: { code: string; files: string[] }[] = [], verified = true) {
  return parseGolden({ pack: "Invented", verified, files, items });
}

/** One file scored on its own: the key's first file against one survey. */
function one(keyParts: KeyPart[], answer: SurveyPart[] | null, options: { pageCount?: number | null; minIoU?: number } = {}) {
  const pageCount = options.pageCount === undefined ? 10 : options.pageCount;
  const golden = key([keyFile("X.pdf", pageCount, keyParts)]);
  return scoreFile(golden.files[0]!, answer ? survey("X.pdf", pageCount, answer) : null, { minIoU: options.minIoU });
}

describe("parseGolden", () => {
  it("accepts a key and gives every part code lists", () => {
    const golden = key([keyFile("A.pdf", 3, [{ place: pages(1, 3), genre: "shop_drawings" }])]);
    expect(golden.files[0]!.parts[0]).toMatchObject({ itemCodes: [], finishCodes: [] });
    expect(golden.items).toEqual([]);
  });

  it.each([
    ["pages that run backwards", [keyFile("A.pdf", 5, [{ place: pages(4, 2), genre: "preamble" }])], [], /run backwards/],
    ["a page past the count", [keyFile("A.pdf", 5, [{ place: pages(1, 6), genre: "preamble" }])], [], /past the file's 5 pages/],
    ["a file listed twice", [keyFile("A.pdf", 1, [{ place: WHOLE, genre: "preamble" }]), keyFile("A.pdf", 1, [{ place: WHOLE, genre: "preamble" }])], [], /listed twice/],
    ["an item naming an unlisted file", [keyFile("A.pdf", 1, [{ place: WHOLE, genre: "preamble" }])], [{ code: "X-1", files: ["B.pdf"] }], /does not list/],
    ["a key that says unclear", [keyFile("A.pdf", 1, [{ place: WHOLE, genre: "unclear" }])], [], /genre/],
    ["rows that run backwards", [keyFile("A.xlsx", null, [{ place: sheet("BOQ", 9, 3), genre: "bill_of_quantities" }])], [], /rows 9-3/],
    ["a file with no parts", [keyFile("A.pdf", 1, [])], [], /parts/],
    [
      "a part with nothing to read",
      [keyFile("A.pdf", 2, [{ place: pages(1, 1), genre: "preamble", nothingToRead: true } as KeyPart])],
      [],
      /never lists a part with nothing to read/,
    ],
  ])("refuses %s, in words", (_, files, items, message) => {
    expect(() => parseGolden({ pack: "P", verified: true, files, items }, "p.json")).toThrow(message);
  });
});

describe("one file: found, held, wrong, missed, extra", () => {
  it("finds an exact part with no page error", () => {
    const score = one([{ place: pages(1, 10), genre: "shop_drawings" }], [surveyed(pages(1, 10), "shop_drawings")]);
    expect(score.counts).toMatchObject({ expected: 1, found: 1, missed: 0, extra: 0 });
    expect(score.pageError).toBe(0);
  });

  it("counts IoU 0.8 as found and reports the boundary error; 0.7 is missed and the part is extra", () => {
    const at08 = one([{ place: pages(1, 10), genre: "shop_drawings" }], [surveyed(pages(1, 8), "shop_drawings")]);
    expect(at08.parts[0]!.outcome).toBe("found");
    expect(at08.parts[0]!.overlap).toBeCloseTo(0.8);
    expect(at08.pageError).toBe(2);

    const at07 = one([{ place: pages(1, 10), genre: "shop_drawings" }], [surveyed(pages(1, 7), "shop_drawings")]);
    expect(at07.counts).toMatchObject({ found: 0, missed: 1, extra: 1 });
  });

  it("takes the threshold as a parameter", () => {
    const loose = one([{ place: pages(1, 10), genre: "shop_drawings" }], [surveyed(pages(1, 7), "shop_drawings")], { minIoU: 0.7 });
    expect(loose.parts[0]!.outcome).toBe("found");
    expect(loose.pageError).toBe(3);
  });

  it("reads a whole PDF as pages 1..N, either way round", () => {
    expect(one([{ place: pages(1, 10), genre: "preamble" }], [surveyed(WHOLE, "preamble")]).parts[0]!.outcome).toBe("found");
    expect(one([{ place: WHOLE, genre: "preamble" }], [surveyed(pages(1, 10), "preamble")]).parts[0]!.outcome).toBe("found");
    // The survey's own count serves where the key could not count the pages…
    const uncounted = key([keyFile("X.pdf", null, [{ place: pages(1, 10), genre: "preamble" }])]).files[0]!;
    expect(scoreFile(uncounted, survey("X.pdf", 10, [surveyed(WHOLE, "preamble")])).parts[0]!.outcome).toBe("found");
    // …and where neither side counted them, pages inside a whole are a boundary, never a guess at N.
    const neither = scoreFile(uncounted, survey("X.pdf", null, [surveyed(WHOLE, "preamble")]));
    expect(neither.parts[0]).toMatchObject({ outcome: "boundary", note: "inside the whole file" });
  });

  it("scores the READER, not the word: specification sheets found as shop drawings", () => {
    const score = one([{ place: pages(1, 4), genre: "specification_sheets" }], [surveyed(pages(1, 4), "shop_drawings")]);
    expect(score.parts[0]!.outcome).toBe("found");
  });

  it("calls a different reader wrong, and says what it was read as", () => {
    const score = one([{ place: pages(1, 3), genre: "bill_of_quantities" }], [surveyed(pages(1, 3), "ffe_schedule")]);
    expect(score.parts[0]).toMatchObject({ outcome: "wrong_kind", note: "read as ffe_schedule" });
    expect(score.counts.wrong_kind).toBe(1);
  });

  it("counts a part the app would hold as HELD, not wrong", () => {
    const unclear = one([{ place: pages(1, 3), genre: "bill_of_quantities" }], [surveyed(pages(1, 3), "unclear", { certain: false })]);
    expect(unclear.parts[0]).toMatchObject({ outcome: "held", note: "held: unclear" });

    const doubtful = one(
      [{ place: pages(1, 3), genre: "bill_of_quantities" }],
      [surveyed(pages(1, 3), "ffe_schedule", { certain: false, weighedAgainst: "bill_of_quantities" })],
    );
    expect(doubtful.parts[0]!.outcome).toBe("held");
    expect(doubtful.parts[0]!.note).toContain("weighed against bill_of_quantities");
  });

  it("lets the weighed-against rule settle doubt between two genres read the same way", () => {
    const settled = one(
      [{ place: pages(1, 6), genre: "shop_drawings" }],
      [surveyed(pages(1, 6), "shop_drawings", { certain: false, weighedAgainst: "specification_sheets" })],
    );
    expect(settled.parts[0]!.outcome).toBe("found");
  });

  it("gives a part to the best thing the survey said about it, not the biggest overlap", () => {
    const score = one(
      [{ place: pages(1, 10), genre: "shop_drawings" }],
      [surveyed(pages(1, 10), "bill_of_quantities"), surveyed(pages(1, 9), "shop_drawings")],
    );
    expect(score.parts[0]).toMatchObject({ outcome: "found", surveyed: [1] });
    expect(score.extraParts.map((part) => part.index)).toEqual([0]);
  });

  it("matches one surveyed part to one expected part", () => {
    const twice = one([{ place: pages(1, 5), genre: "shop_drawings" }], [surveyed(pages(1, 5), "shop_drawings"), surveyed(pages(1, 5), "shop_drawings")]);
    expect(twice.counts).toMatchObject({ found: 1, extra: 1 });

    const shared = one(
      [
        { place: pages(1, 5), genre: "shop_drawings" },
        { place: pages(1, 5), genre: "preamble" },
      ],
      [surveyed(pages(1, 5), "shop_drawings")],
    );
    expect(shared.counts).toMatchObject({ found: 1, wrong_kind: 0, missed: 1 });
  });

  it("misses everything when the survey failed, and counts extras otherwise", () => {
    const failed = one([{ place: pages(1, 4), genre: "shop_drawings" }, { place: pages(5, 10), genre: "preamble" }], null);
    expect(failed.surveyed).toBe(false);
    expect(failed.counts).toMatchObject({ expected: 2, missed: 2, extra: 0 });

    const extra = one([{ place: pages(1, 10), genre: "shop_drawings" }], [surveyed(pages(1, 10), "shop_drawings"), surveyed(pages(3, 3), "preamble")]);
    expect(extra.counts).toMatchObject({ found: 1, extra: 1 });
    expect(extra.extraParts[0]).toMatchObject({ index: 1, genre: "preamble", held: false });
  });

  it("finds an email's body as the whole text", () => {
    const score = one([{ place: BODY, genre: "email" }], [surveyed(WHOLE, "email")], { pageCount: null });
    expect(score.parts[0]!.outcome).toBe("found");
    expect(score.pageError).toBe(0);
  });
});

describe("one file: nothing to read", () => {
  it("sets a cover aside: not extra, not held, not wrong, and the rest still scored", () => {
    const score = one(
      [{ place: pages(2, 5), genre: "shop_drawings" }],
      [surveyed(pages(1, 1), "unclear", { certain: false, nothingToRead: true }), surveyed(pages(2, 5), "shop_drawings")],
      { pageCount: 5 },
    );
    expect(score.counts).toMatchObject({ expected: 1, found: 1, held: 0, wrong_kind: 0, extra: 0 });
    expect(score.skipped).toEqual([pages(1, 1)]);
  });

  it("never lets an empty part stand for a key part, nor be a piece or a container", () => {
    const score = one(
      [{ place: pages(1, 4), genre: "bill_of_quantities" }],
      [
        surveyed(pages(1, 4), "bill_of_quantities", { nothingToRead: true }),
        surveyed(pages(1, 2), "bill_of_quantities", { nothingToRead: true }),
        surveyed(pages(3, 4), "bill_of_quantities", { nothingToRead: true }),
      ],
      { pageCount: 4 },
    );
    expect(score.counts).toMatchObject({ found: 0, held: 0, boundary: 0, missed: 1, extra: 0 });
    expect(score.skipped).toHaveLength(3);
  });

  it("does not count an empty cover sheet as a second part on its sheet", () => {
    const score = one(
      [{ place: sheet("BOQ", 6, 40), genre: "bill_of_quantities" }],
      [surveyed(sheet("BOQ", 1, 5), "unclear", { nothingToRead: true }), surveyed(sheet("BOQ"), "bill_of_quantities")],
      { pageCount: null },
    );
    expect(score.parts[0]!.outcome).toBe("found");
  });
});

describe("one file: BOUNDARY, the reader right and the cut wrong", () => {
  it("never credits a drawing set said in pieces as found, and does not count the pieces again", () => {
    const score = one(
      [{ place: pages(1, 4), genre: "specification_sheets" }],
      [surveyed(pages(1, 2), "specification_sheets"), surveyed(pages(3, 4), "shop_drawings")],
      { pageCount: 4 },
    );
    expect(score.parts[0]).toMatchObject({ outcome: "boundary", surveyed: [0, 1], note: "said in 2 pieces: pages 1-2, pages 3-4" });
    expect(score.counts).toMatchObject({ found: 0, boundary: 1, missed: 0, extra: 0 });
    expect(score.pageError).toBe(0);
  });

  it("does not take a held piece as part of a split", () => {
    const score = one(
      [{ place: pages(1, 4), genre: "specification_sheets" }],
      [surveyed(pages(1, 2), "specification_sheets"), surveyed(pages(3, 4), "unclear", { certain: false })],
      { pageCount: 4 },
    );
    expect(score.counts).toMatchObject({ boundary: 0, missed: 1, extra: 2 });
  });

  it("does not call pieces that leave too much uncovered a split", () => {
    const score = one(
      [{ place: pages(1, 10), genre: "shop_drawings" }],
      [surveyed(pages(1, 3), "shop_drawings"), surveyed(pages(8, 10), "shop_drawings")],
    );
    expect(score.counts).toMatchObject({ boundary: 0, missed: 1, extra: 2 });
  });

  it("calls a part swallowed into a larger one on its reader a boundary, and the other reader's part missed", () => {
    const score = one(
      [
        { place: pages(1, 3), genre: "bill_of_quantities" },
        { place: pages(4, 4), genre: "finishes_schedule" },
      ],
      [surveyed(pages(1, 4), "bill_of_quantities")],
      { pageCount: 4 },
    );
    expect(score.parts[0]).toMatchObject({ outcome: "boundary", note: "inside pages 1-4" });
    expect(score.parts[1]!.outcome).toBe("missed");
    expect(score.counts.extra).toBe(0);
  });

  it("calls two key parts on one reader inside one surveyed part both boundaries", () => {
    const score = one(
      [
        { place: pages(1, 2), genre: "specification_sheets" },
        { place: pages(3, 4), genre: "shop_drawings" },
      ],
      [surveyed(pages(1, 4), "specification_sheets")],
      { pageCount: 4 },
    );
    expect(score.parts.map((part) => part.outcome)).toEqual(["boundary", "boundary"]);
    expect(score.counts.extra).toBe(0);
  });

  it("reads a bill workbook answered sheet by sheet as a boundary, and one sheet alone as missed", () => {
    const perSheet = one(
      [{ place: WHOLE, genre: "bill_of_quantities" }],
      [surveyed(sheet("Guest Rooms"), "bill_of_quantities"), surveyed(sheet("Public Areas"), "bill_of_quantities")],
      { pageCount: null },
    );
    expect(perSheet.parts[0]).toMatchObject({ outcome: "boundary", note: 'said in 2 pieces: sheet "Guest Rooms", sheet "Public Areas"' });

    const oneSheet = one([{ place: WHOLE, genre: "bill_of_quantities" }], [surveyed(sheet("Guest Rooms"), "bill_of_quantities")], {
      pageCount: null,
    });
    expect(oneSheet.counts).toMatchObject({ missed: 1, extra: 1 });
  });
});

describe("one file: sheets and rows", () => {
  const WORKBOOK: KeyPart[] = [
    { place: sheet("BOQ"), genre: "bill_of_quantities" },
    { place: sheet("Finishes"), genre: "finishes_schedule" },
    { place: sheet("Notes"), genre: "preamble" },
  ];

  it("matches a sheet by name, forgiving case and a trailing space", () => {
    const score = one(
      WORKBOOK,
      [surveyed(sheet("boq "), "bill_of_quantities"), surveyed(sheet("FINISHES"), "finishes_schedule"), surveyed(sheet("Notes"), "ffe_schedule")],
      { pageCount: null },
    );
    expect(score.parts.map((part) => part.outcome)).toEqual(["found", "found", "wrong_kind"]);
  });

  it("compares row ranges by IoU when both sides give them", () => {
    const rows: KeyPart[] = [
      { place: sheet("X", 1, 40), genre: "bill_of_quantities" },
      { place: sheet("X", 41, 60), genre: "finishes_schedule" },
    ];
    const close = one(rows, [surveyed(sheet("X", 1, 38), "bill_of_quantities"), surveyed(sheet("X", 39, 60), "finishes_schedule")], { pageCount: null });
    expect(close.parts.map((part) => part.outcome)).toEqual(["found", "found"]);

    const unsaid = one(rows, [surveyed(sheet("X"), "bill_of_quantities")], { pageCount: null });
    expect(unsaid.parts.map((part) => part.outcome)).toEqual(["boundary", "missed"]);
  });

  it("takes rows given on one side only as precision when they are the only part on that sheet", () => {
    const keyRows = one([{ place: sheet("X", 5, 40), genre: "bill_of_quantities" }], [surveyed(sheet("X"), "bill_of_quantities")], { pageCount: null });
    expect(keyRows.parts[0]!.outcome).toBe("found");
    const surveyRows = one([{ place: sheet("X"), genre: "bill_of_quantities" }], [surveyed(sheet("X", 5, 40), "bill_of_quantities")], { pageCount: null });
    expect(surveyRows.parts[0]!.outcome).toBe("found");
  });

  it("closes an open-ended range at the furthest row either side names", () => {
    const score = one([{ place: sheet("X", 41, null), genre: "finishes_schedule" }], [surveyed(sheet("X", 41, 60), "finishes_schedule")], {
      pageCount: null,
    });
    expect(score.parts[0]!.outcome).toBe("found");
    const disjoint = one([{ place: sheet("X", 41, null), genre: "finishes_schedule" }], [surveyed(sheet("X", 1, 40), "finishes_schedule")], {
      pageCount: null,
    });
    expect(disjoint.parts[0]!.outcome).toBe("missed");
  });

  it("never matches a sheet with pages or another sheet's name", () => {
    const score = one([{ place: sheet("BOQ"), genre: "bill_of_quantities" }], [surveyed(sheet("BOQ 2"), "bill_of_quantities")], { pageCount: null });
    expect(score.counts).toMatchObject({ missed: 1, extra: 1 });
  });
});

describe("codes", () => {
  it("folds with normaliseRef, lists what is missing, and counts extras without penalty", () => {
    const recall = recallCodes(["HH-SF-01", "hh sf 01", "HH-CH-02", "FAB-01"], ["hh sf 01", "FAB 01", "ZZ-9"]);
    expect(recall).toEqual({ expected: 3, found: 2, missing: ["HH-CH-02"], extra: ["ZZ-9"] });
  });

  it("reads codes off whatever part matched — found, held or wrong — and none off a missed part", () => {
    const score = one(
      [
        { place: pages(1, 3), genre: "bill_of_quantities", itemCodes: ["A-1", "A-2"], finishCodes: ["F-1"] },
        { place: pages(4, 6), genre: "shop_drawings", itemCodes: ["A-1"] },
        { place: pages(7, 10), genre: "preamble", itemCodes: ["A-9"] },
      ],
      [
        surveyed(pages(1, 3), "unclear", { certain: false, itemCodes: ["A 1", "A-2", "A-3"], finishCodes: ["F1"] }),
        surveyed(pages(4, 6), "ffe_schedule", { itemCodes: ["A-1"] }),
      ],
    );
    expect(score.parts.map((part) => part.outcome)).toEqual(["held", "wrong_kind", "missed"]);
    expect(score.itemCodes).toEqual({ expected: 4, found: 3, extra: 1 });
    expect(score.finishCodes).toEqual({ expected: 1, found: 1, extra: 0 });
    expect(score.parts[2]!.itemCodes.missing).toEqual(["A-9"]);
  });

  it("reads a split's codes off all its pieces", () => {
    const score = one(
      [{ place: pages(1, 4), genre: "shop_drawings", itemCodes: ["D-1", "D-2"] }],
      [surveyed(pages(1, 2), "shop_drawings", { itemCodes: ["D-1"] }), surveyed(pages(3, 4), "shop_drawings", { itemCodes: ["D-2"] })],
      { pageCount: 4 },
    );
    expect(score.parts[0]!.itemCodes).toMatchObject({ expected: 2, found: 2 });
  });
});

describe("items across the pack", () => {
  const groups: PackGroups = {
    items: [
      { code: "HH-SF-01", parts: [{ file: "bill.xlsx", part: 0 }, { file: "sofa.pdf", part: 0 }, { file: "notes.eml", part: 0 }] },
      { code: "hh ch 02", parts: [{ file: "bill.xlsx", part: 0 }] },
    ],
  };

  it("counts links found against links expected, folded, with extras beside", () => {
    const links = scoreItemLinks(
      [
        { code: "HH-SF-01", files: ["bill.xlsx", "sofa.pdf"] },
        { code: "HH-CH-02", files: ["bill.xlsx", "chair.pdf"] },
        { code: "HH-ZZ-09", files: ["bill.xlsx"] },
      ],
      groups,
      new Set(["bill.xlsx", "sofa.pdf", "chair.pdf", "notes.eml"]),
    );
    expect(links).toMatchObject({ expected: 5, found: 3 });
    expect(links.missing).toEqual([
      { code: "HH-CH-02", file: "chair.pdf" },
      { code: "HH-ZZ-09", file: "bill.xlsx" },
    ]);
    expect(links.extra).toEqual([{ code: "HH-SF-01", file: "notes.eml" }]);
  });

  it("leaves out files that were not in this run, on both sides", () => {
    const links = scoreItemLinks([{ code: "HH-SF-01", files: ["bill.xlsx", "sofa.pdf"] }], groups, new Set(["bill.xlsx"]));
    expect(links).toMatchObject({ expected: 1, found: 1, extra: [{ code: "hh ch 02", file: "bill.xlsx" }] });
  });
});

describe("a pack, and totals", () => {
  const files = [
    keyFile("bill.xlsx", null, [{ place: WHOLE, genre: "bill_of_quantities", itemCodes: ["HH-SF-01"] }]),
    keyFile("sofa.pdf", 1, [{ place: pages(1, 1), genre: "specification_sheets", itemCodes: ["HH-SF-01"], finishCodes: ["FAB-01"] }]),
    keyFile("preamble.pdf", 2, [{ place: pages(1, 2), genre: "preamble" }]),
  ];
  const items = [{ code: "HH-SF-01", files: ["bill.xlsx", "sofa.pdf"] }];
  const results = [
    survey("bill.xlsx", null, [surveyed(WHOLE, "bill_of_quantities", { itemCodes: ["HH-SF-01"] })]),
    survey("sofa.pdf", 1, [surveyed(pages(1, 1), "shop_drawings", { itemCodes: ["HH-SF-01"], finishCodes: [] })]),
    survey("stray.pdf", 1, [surveyed(pages(1, 1), "preamble")]),
  ];
  const groups: PackGroups = { items: [{ code: "HH-SF-01", parts: [{ file: "bill.xlsx", part: 0 }, { file: "sofa.pdf", part: 0 }] }] };

  it("scores surveyed and failed files, and sets aside the rest", () => {
    const score = scoreSurvey(key(files, items), results, groups, { failed: ["preamble.pdf"] });
    expect(score.files.map((file) => [file.file, file.surveyed, file.counts.found, file.counts.missed])).toEqual([
      ["bill.xlsx", true, 1, 0],
      ["sofa.pdf", true, 1, 0],
      ["preamble.pdf", false, 0, 1],
    ]);
    expect(score.notSurveyed).toEqual([]);
    expect(score.unkeyed).toEqual(["stray.pdf"]);
    expect(score.items).toMatchObject({ expected: 2, found: 2 });

    const narrowed = scoreSurvey(key(files, items), results, groups);
    expect(narrowed.notSurveyed).toEqual(["preamble.pdf"]);
    expect(narrowed.files).toHaveLength(2);
  });

  it("totals the parts set aside as having nothing to read", () => {
    const withCover = [survey("sofa.pdf", 2, [surveyed(pages(1, 1), "unclear", { nothingToRead: true }), surveyed(pages(2, 2), "specification_sheets")])];
    const coverKey = key([keyFile("sofa.pdf", 2, [{ place: pages(2, 2), genre: "specification_sheets" }])]);
    const totals = totalSurveyScores([scoreSurvey(coverKey, withCover, { items: [] })]);
    expect(totals.verified).toMatchObject({ skipped: 1, parts: { expected: 1, found: 1, extra: 0 } });
  });

  it("totals verified keys as the score and drafts beside them", () => {
    const verified = scoreSurvey(key(files, items, true), results, groups, { failed: ["preamble.pdf"] });
    const draft = scoreSurvey(key(files, items, false), results, groups);
    const totals = totalSurveyScores([verified, draft]);
    expect(totals.verified).toMatchObject({
      packs: 1,
      files: 3,
      failedFiles: 1,
      parts: { expected: 3, found: 2, missed: 1, extra: 0 },
      itemCodes: { expected: 2, found: 2, extra: 0 },
      finishCodes: { expected: 1, found: 0, extra: 0 },
      links: { expected: 2, found: 2, extra: 0 },
    });
    expect(totals.unverified).toMatchObject({ packs: 1, files: 2, failedFiles: 0, parts: { expected: 2, found: 2 } });
  });
});
