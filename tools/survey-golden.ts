// The pack survey's answer key and its scorer. PURE: no database, no model, no files.
//
// ============================================================================
// WHAT THIS MEASURES: whether each part of each file would reach the RIGHT
// READER, at the right place, with the codes it prints.
//
// A key (`SurveyGolden`, `src/lib/pack-survey-types.ts`) says what a person
// would write down about a pack: per file, its parts — a PDF's page range, a
// workbook sheet, an email's body — each with its trade genre and the item
// and finish codes it prints; per item, which files describe it. Real packs'
// keys live OUTSIDE the repo (`~/dev/localstack/survey-golden/`) because they
// hold real codes. Nothing here holds a real value.
//
// THE TRAP IS SCORING THE WORD INSTEAD OF THE ROUTE. `specification_sheets`
// and `shop_drawings` are two genres and ONE reader; a scorer comparing
// genres would mark a survey wrong for a distinction the app throws away, and
// "improve" it toward guessing a label nobody acts on. So a part is right when
// its genre lands on the same reader as the key's — `KIND_FROM_GENRE`, the
// app's own one map, compared on both `importType` and `documentKind` — and
// never by a second table here. The same rule settles doubt: a part the app
// would HOLD for a person (`partIsHeld`, the survey's own rule — genre
// `unclear`, or not certain and not settled by `fileDocument`'s
// `weighedAgainst` rule — imported, never copied) is HELD, a cost of a press,
// which is a different failure from WRONG, a charged read under the wrong
// prompt. A part the survey says has NOTHING TO READ (a cover, a blank page)
// is set aside entirely, and a key never lists one.
//
// THE SECOND TRAP IS CREDITING A CUT DRAWING SET. Two pages of one drawing
// set said as two parts both land on the drawings reader, and a scorer that
// unioned them would call the set found — the exact cut the v4 item read
// retired (an item is drawn across pages). So matching is ONE surveyed part
// to ONE expected part, by overlap (pages by intersection-over-union, the
// threshold a parameter), and a set said in pieces, or swallowed into a
// larger part on the same reader, is its own outcome, BOUNDARY: the reader
// was right and the cut was not. It is never FOUND, and its pieces are not
// counted again as extras.
//
// ONLY VERIFIED KEYS ARE THE SCORE. A key drafted by Claude and not yet
// checked by a person is totalled beside the verified total, never inside
// it — the `eval:drawings` rule, for the same reason: an unverified key
// scores the model against Claude's opinion of the document.
// ============================================================================
import { z } from "zod";
import { DOCUMENT_GENRES, KIND_FROM_GENRE, type DocumentGenre } from "../src/lib/document-kinds";
import { partIsHeld } from "../src/lib/pack-survey";
import { normaliseRef } from "../src/lib/record-refs";
import type { GoldenPart, PartPlace, SurveyFile, SurveyGolden } from "../src/lib/pack-survey-types";

/** The default overlap a page or row range needs to count as the same part. */
export const DEFAULT_MIN_IOU = 0.8;

// ---- the key ----------------------------------------------------------------

type KeyGenre = Exclude<DocumentGenre, "unclear">;
const KEY_GENRES = DOCUMENT_GENRES.filter((genre): genre is KeyGenre => genre !== "unclear") as [KeyGenre, ...KeyGenre[]];

const row = z.number().int().positive();
const PlaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pages"), from: z.number().int().positive(), to: z.number().int().positive() }),
  z.object({ kind: z.literal("sheet"), sheet: z.string().trim().min(1), fromRow: row.nullable().optional(), toRow: row.nullable().optional() }),
  z.object({ kind: z.literal("body") }),
  z.object({ kind: z.literal("whole") }),
]);
const codes = z.array(z.string().trim().min(1)).optional().default([]);
const PartSchema = z.object({
  place: PlaceSchema,
  genre: z.enum(KEY_GENRES),
  itemCodes: codes,
  finishCodes: codes,
  // A key lists what is to be READ; a cover or a blank page is left out.
  nothingToRead: z
    .unknown()
    .optional()
    .refine((value) => value !== true, { message: "a key never lists a part with nothing to read; leave covers and blank pages out" }),
});
const KeySchema = z.object({
  pack: z.string().trim().min(1),
  verified: z.boolean(),
  files: z
    .array(z.object({ file: z.string().trim().min(1), pageCount: z.number().int().positive().nullable(), parts: z.array(PartSchema).min(1) }))
    .min(1),
  items: z.array(z.object({ code: z.string().trim().min(1), files: z.array(z.string().trim().min(1)) })).default([]),
});

/**
 * A key, checked STRICTLY, and thrown in words.
 *
 * Strict where the survey's own answer is lenient, on purpose: a key is what
 * the survey is judged against, and a key that silently dropped a malformed
 * part would score every survey against a smaller pack than the person wrote.
 * So an inverted range, a page past the count, a file named twice, or an item
 * pointing at a file the key does not list is an error, not a `.catch()`.
 */
export function parseGolden(json: unknown, source = "key"): SurveyGolden {
  const parsed = KeySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`${source}: ${issue.path.join(".") || "(top)"}: ${issue.message}`);
  }
  const key = parsed.data;
  const seen = new Set<string>();
  for (const entry of key.files) {
    if (seen.has(entry.file)) throw new Error(`${source}: "${entry.file}" is listed twice`);
    seen.add(entry.file);
    entry.parts.forEach((part, index) => {
      const where = `${source}: ${entry.file} part ${index + 1}`;
      const place = part.place;
      if (place.kind === "pages") {
        if (place.from > place.to) throw new Error(`${where}: pages ${place.from}-${place.to} run backwards`);
        if (entry.pageCount !== null && place.to > entry.pageCount) {
          throw new Error(`${where}: page ${place.to} is past the file's ${entry.pageCount} pages`);
        }
      }
      if (place.kind === "sheet" && place.fromRow != null && place.toRow != null && place.fromRow > place.toRow) {
        throw new Error(`${where}: rows ${place.fromRow}-${place.toRow} run backwards`);
      }
    });
  }
  for (const item of key.items) {
    for (const file of item.files) {
      if (!seen.has(file)) throw new Error(`${source}: item ${item.code} names "${file}", which the key does not list`);
    }
  }
  return key;
}

// ---- places -----------------------------------------------------------------

type Span = { from: number; to: number };
type RowRange = { from: number | null; to: number | null };

/**
 * A place, put where it can be compared. A `whole` PDF with a known page count
 * IS pages 1..N — the same statement in two forms, so a key written either way
 * meets a survey answered either way. Anything else stays what it said.
 */
type Extent =
  | { kind: "pages"; span: Span }
  | { kind: "sheet"; sheet: string; rows: RowRange | null }
  | { kind: "text" }
  | { kind: "whole" };

function extentOf(place: PartPlace, pageCount: number | null): Extent {
  switch (place.kind) {
    case "pages":
      return { kind: "pages", span: { from: place.from, to: place.to } };
    case "sheet": {
      const from = place.fromRow ?? null;
      const to = place.toRow ?? null;
      return { kind: "sheet", sheet: place.sheet, rows: from === null && to === null ? null : { from, to } };
    }
    case "body":
      return { kind: "text" };
    case "whole":
      return pageCount !== null ? { kind: "pages", span: { from: 1, to: pageCount } } : { kind: "whole" };
  }
}

const size = (span: Span) => Math.max(0, span.to - span.from + 1);
const intersect = (a: Span, b: Span): number => size({ from: Math.max(a.from, b.from), to: Math.min(a.to, b.to) });
const iou = (a: Span, b: Span): number => {
  const both = intersect(a, b);
  const either = size(a) + size(b) - both;
  return either === 0 ? 0 : both / either;
};
/** How much of `piece` lies inside `container`, 0..1. */
const within = (piece: Span, container: Span): number => (size(piece) === 0 ? 0 : intersect(piece, container) / size(piece));

/**
 * Two row ranges as closed spans. An open start is row 1; an open end is the
 * furthest row EITHER range names, because neither side knows how long the
 * sheet is and that is the most the two of them can agree on.
 */
function closeRows(a: RowRange, b: RowRange): [Span, Span] {
  const bounds = [a.from, a.to, b.from, b.to].filter((value): value is number => value !== null);
  const end = bounds.length ? Math.max(...bounds) : 1;
  return [
    { from: a.from ?? 1, to: a.to ?? end },
    { from: b.from ?? 1, to: b.to ?? end },
  ];
}

// Excel refuses two sheet names that differ only by case, so folding case
// cannot make two sheets of one workbook meet; trimming forgives a model that
// copied a trailing space off a tab.
const sameSheet = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One file's places, per side, so a row rule can ask "is this the only part on that sheet?". */
type SheetCounts = { key: Map<string, number>; survey: Map<string, number> };
function countSheets(places: PartPlace[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const place of places) {
    if (place.kind !== "sheet") continue;
    const name = place.sheet.trim().toLowerCase();
    out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

/**
 * How far a key part and a surveyed part are the same place, 0..1.
 *
 * Pages by intersection-over-union. A sheet by name, then rows: by IoU when
 * both give a range; when only one side does, fully the same only where that
 * range is the only part its side puts on that sheet (it is then precision
 * the other side did not need), and not at all where the sheet holds several
 * parts (which rows is then the whole question). An email's body and a
 * `whole` that cannot be counted in pages are the same thing. Anything else —
 * a sheet against a `whole` workbook, pages against a sheet — is not, and is
 * left to the BOUNDARY reading below.
 */
function overlap(key: Extent, survey: Extent, sheets: SheetCounts): number {
  if (key.kind === "pages" && survey.kind === "pages") return iou(key.span, survey.span);
  if (key.kind === "sheet" && survey.kind === "sheet") {
    if (!sameSheet(key.sheet, survey.sheet)) return 0;
    if (key.rows === null && survey.rows === null) return 1;
    if (key.rows !== null && survey.rows !== null) {
      const [a, b] = closeRows(key.rows, survey.rows);
      return iou(a, b);
    }
    const name = key.sheet.trim().toLowerCase();
    const alone = key.rows !== null ? sheets.key.get(name) === 1 : sheets.survey.get(name) === 1;
    return alone ? 1 : 0;
  }
  const textual = (extent: Extent) => extent.kind === "text" || extent.kind === "whole";
  return textual(key) && textual(survey) ? 1 : 0;
}

/**
 * How much of `inner` lies inside `outer`, 0..1 — for the BOUNDARY reading
 * only. A `whole` that could not be counted in pages holds anything in its
 * file; an email's body holds nothing finer than itself.
 */
function containment(inner: Extent, outer: Extent): number {
  if (outer.kind === "whole") return 1;
  if (outer.kind === "text") return inner.kind === "text" || inner.kind === "whole" ? 1 : 0;
  if (inner.kind === "pages" && outer.kind === "pages") return within(inner.span, outer.span);
  if (inner.kind === "sheet" && outer.kind === "sheet") {
    if (!sameSheet(inner.sheet, outer.sheet)) return 0;
    if (outer.rows === null) return 1;
    if (inner.rows === null) return 0;
    const [a, b] = closeRows(inner.rows, outer.rows);
    return within(a, b);
  }
  return 0;
}

/**
 * How much of `container` its pieces cover together, 0..1. Pages and rows by
 * the union of the pieces' spans; anything that has no finer unit — a whole
 * workbook, a sheet with no rows given — is covered by any two pieces inside
 * it, because there is nothing to count it in.
 */
function coverage(pieces: Extent[], container: Extent): number {
  let spans: Span[];
  let outer: Span;
  if (container.kind === "pages") {
    outer = container.span;
    spans = pieces.flatMap((piece) => (piece.kind === "pages" ? [piece.span] : []));
  } else if (container.kind === "sheet" && container.rows !== null) {
    const rows = pieces.flatMap((piece) => (piece.kind === "sheet" && piece.rows !== null ? [piece.rows] : []));
    const bounds = [container.rows, ...rows].flatMap((range) => [range.from, range.to]).filter((value): value is number => value !== null);
    const end = bounds.length ? Math.max(...bounds) : 1;
    outer = { from: container.rows.from ?? 1, to: container.rows.to ?? end };
    spans = rows.map((range) => ({ from: range.from ?? 1, to: range.to ?? end }));
  } else {
    return 1;
  }
  const clipped = spans
    .map((span) => ({ from: Math.max(span.from, outer.from), to: Math.min(span.to, outer.to) }))
    .filter((span) => span.from <= span.to)
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let reach = outer.from - 1;
  for (const span of clipped) {
    const from = Math.max(span.from, reach + 1);
    if (span.to >= from) covered += span.to - from + 1;
    reach = Math.max(reach, span.to);
  }
  return size(outer) === 0 ? 0 : covered / size(outer);
}

export function describePlace(place: PartPlace): string {
  switch (place.kind) {
    case "pages":
      return place.from === place.to ? `page ${place.from}` : `pages ${place.from}-${place.to}`;
    case "sheet": {
      const rows = place.fromRow != null || place.toRow != null ? ` rows ${place.fromRow ?? 1}-${place.toRow ?? "end"}` : "";
      return `sheet "${place.sheet}"${rows}`;
    }
    case "body":
      return "the body";
    case "whole":
      return "the whole file";
  }
}

// ---- readers and holding ----------------------------------------------------

/** Both genres reach the same reader: `KIND_FROM_GENRE`, both fields. `unclear` reaches none. */
export function sameReader(a: DocumentGenre, b: DocumentGenre): boolean {
  if (a === "unclear" || b === "unclear") return false;
  const x = KIND_FROM_GENRE[a];
  const y = KIND_FROM_GENRE[b];
  return x.importType === y.importType && x.documentKind === y.documentKind;
}


// ---- codes ------------------------------------------------------------------

export type CodeRecall = {
  expected: number;
  found: number;
  /** As the key prints them. */
  missing: string[];
  /** As the survey printed them: codes the matched part named that the key does not. Counted, never penalised. */
  extra: string[];
};

/** Folded with `normaliseRef`, the app's own fallback fold — `FU 209 15` meets `FU-209-15`. */
export function recallCodes(expected: readonly string[], read: readonly string[]): CodeRecall {
  const wanted = new Map<string, string>();
  for (const code of expected) {
    const fold = normaliseRef(code);
    if (fold && !wanted.has(fold)) wanted.set(fold, code);
  }
  const got = new Map<string, string>();
  for (const code of read) {
    const fold = normaliseRef(code);
    if (fold && !got.has(fold)) got.set(fold, code);
  }
  const missing = [...wanted].filter(([fold]) => !got.has(fold)).map(([, code]) => code);
  return {
    expected: wanted.size,
    found: wanted.size - missing.length,
    missing,
    extra: [...got].filter(([fold]) => !wanted.has(fold)).map(([, code]) => code),
  };
}

// ---- one file ---------------------------------------------------------------

export const PART_OUTCOMES = ["found", "held", "wrong_kind", "boundary", "missed"] as const;
export type PartOutcome = (typeof PART_OUTCOMES)[number];

export type ExpectedPartScore = {
  place: PartPlace;
  genre: KeyGenre;
  outcome: PartOutcome;
  /** Indices into the file's surveyed parts that this part was matched to (pieces, for a split). */
  surveyed: number[];
  /** The genre the first matched surveyed part gave. */
  surveyedGenre: DocumentGenre | null;
  /** Overlap with the matched part, for found / held / wrong_kind. */
  overlap: number | null;
  /** Pages the boundaries are off by, start plus end. Found PDF parts only. */
  pageError: number | null;
  note: string | null;
  itemCodes: CodeRecall;
  finishCodes: CodeRecall;
};

export type ExtraPart = { index: number; place: PartPlace; genre: DocumentGenre; held: boolean };

export type PartCounts = Record<PartOutcome, number> & { expected: number; extra: number };

export type FileScore = {
  file: string;
  /** False when the survey of this file failed: every expected part is then missed. */
  surveyed: boolean;
  parts: ExpectedPartScore[];
  /** Surveyed parts that match nothing in the key and are no piece of a boundary. */
  extraParts: ExtraPart[];
  /** Surveyed parts marked as having nothing to read, set aside uncounted. */
  skipped: PartPlace[];
  counts: PartCounts;
  pageError: number;
  itemCodes: { expected: number; found: number; extra: number };
  finishCodes: { expected: number; found: number; extra: number };
};

const emptyCounts = (): PartCounts => ({ expected: 0, found: 0, held: 0, wrong_kind: 0, boundary: 0, missed: 0, extra: 0 });

/** The order a pair is preferred in: the best thing the survey said about a part wins it. */
const RANK: Record<"found" | "held" | "wrong_kind", number> = { found: 0, held: 1, wrong_kind: 2 };

export function scoreFile(
  key: { file: string; pageCount: number | null; parts: GoldenPart[] },
  survey: SurveyFile | null,
  options: { minIoU?: number } = {},
): FileScore {
  const minIoU = options.minIoU ?? DEFAULT_MIN_IOU;
  // The key's count is a person's; the survey's is off the bytes. Either makes
  // a `whole` comparable with a page range.
  const pageCount = key.pageCount ?? survey?.pageCount ?? null;
  const surveyed = survey?.parts ?? [];
  const keyExtents = key.parts.map((part) => extentOf(part.place, pageCount));
  const surveyExtents = surveyed.map((part) => extentOf(part.place, pageCount));
  const held = surveyed.map(partIsHeld);
  // NOTHING TO READ — a cover, a title page, a blank page, a workbook's cover
  // sheet — is SKIPPED: not a candidate, not held, not wrong, not extra. A key
  // never lists one (parseGolden refuses it), so a page the key leaves out and
  // the survey calls empty is the two of them agreeing.
  // Optional on the type: an answer saved before it existed reads as false.
  const skipped = surveyed.map((part) => part.nothingToRead === true);
  const sheets: SheetCounts = {
    key: countSheets(key.parts.map((part) => part.place)),
    survey: countSheets(surveyed.filter((_, s) => !skipped[s]).map((part) => part.place)),
  };

  // ONE surveyed part to ONE expected part. Every overlapping pair is ranked —
  // found, then held, then wrong — then by overlap, then by position, and taken
  // greedily, so the result does not depend on the order either side listed.
  type Pair = { k: number; s: number; outcome: keyof typeof RANK; overlap: number };
  const pairs: Pair[] = [];
  key.parts.forEach((part, k) => {
    surveyed.forEach((candidate, s) => {
      if (skipped[s]) return;
      const amount = overlap(keyExtents[k]!, surveyExtents[s]!, sheets);
      if (amount < minIoU || amount === 0) return;
      const outcome = held[s] ? "held" : sameReader(part.genre, candidate.genre) ? "found" : "wrong_kind";
      pairs.push({ k, s, outcome, overlap: amount });
    });
  });
  pairs.sort((a, b) => RANK[a.outcome] - RANK[b.outcome] || b.overlap - a.overlap || a.k - b.k || a.s - b.s);
  const byKey = new Map<number, Pair>();
  const used = new Set<number>();
  for (const pair of pairs) {
    if (byKey.has(pair.k) || used.has(pair.s)) continue;
    byKey.set(pair.k, pair);
    used.add(pair.s);
  }

  const parts = key.parts.map((part, k): ExpectedPartScore => {
    const pair = byKey.get(k);
    const base = { place: part.place, genre: part.genre };
    const codesOf = (indices: number[]) => ({
      itemCodes: recallCodes(part.itemCodes ?? [], indices.flatMap((s) => surveyed[s]!.itemCodes)),
      finishCodes: recallCodes(part.finishCodes ?? [], indices.flatMap((s) => surveyed[s]!.finishCodes)),
    });
    if (pair) {
      const candidate = surveyed[pair.s]!;
      const keyExtent = keyExtents[k]!;
      const surveyExtent = surveyExtents[pair.s]!;
      const pageError =
        pair.outcome === "found" && keyExtent.kind === "pages" && surveyExtent.kind === "pages"
          ? Math.abs(keyExtent.span.from - surveyExtent.span.from) + Math.abs(keyExtent.span.to - surveyExtent.span.to)
          : null;
      const note =
        pair.outcome === "held"
          ? candidate.genre === "unclear"
            ? "held: unclear"
            : `held: ${candidate.genre}, not certain${candidate.weighedAgainst ? ` (weighed against ${candidate.weighedAgainst})` : ""}`
          : pair.outcome === "wrong_kind"
            ? `read as ${candidate.genre}`
            : null;
      return { ...base, outcome: pair.outcome, surveyed: [pair.s], surveyedGenre: candidate.genre, overlap: pair.overlap, pageError, note, ...codesOf([pair.s]) };
    }
    return { ...base, outcome: "missed", surveyed: [], surveyedGenre: null, overlap: null, pageError: null, note: null, ...codesOf([]) };
  });

  // BOUNDARY: the reader was right, the cut was not. Read only for parts the
  // one-to-one pass left missed, in key order, and never over a held part — a
  // held part is a person's press, not a boundary.
  const settles = (k: number, s: number) => !skipped[s] && !held[s] && sameReader(key.parts[k]!.genre, surveyed[s]!.genre);
  parts.forEach((score, k) => {
    if (score.outcome !== "missed") return;
    const keyExtent = keyExtents[k]!;
    // Said in pieces: two or more unclaimed parts on its reader, each mostly
    // inside it, together covering it.
    const pieces = surveyed
      .map((_, s) => s)
      .filter((s) => !used.has(s) && settles(k, s) && containment(surveyExtents[s]!, keyExtent) >= minIoU);
    if (pieces.length >= 2) {
      if (coverage(pieces.map((s) => surveyExtents[s]!), keyExtent) >= minIoU) {
        pieces.forEach((s) => used.add(s));
        parts[k] = {
          ...score,
          outcome: "boundary",
          surveyed: pieces,
          surveyedGenre: surveyed[pieces[0]!]!.genre,
          note: `said in ${pieces.length} pieces: ${pieces.map((s) => describePlace(surveyed[s]!.place)).join(", ")}`,
          itemCodes: recallCodes(key.parts[k]!.itemCodes ?? [], pieces.flatMap((s) => surveyed[s]!.itemCodes)),
          finishCodes: recallCodes(key.parts[k]!.finishCodes ?? [], pieces.flatMap((s) => surveyed[s]!.finishCodes)),
        };
        return;
      }
    }
    // Swallowed: one part on its reader holds most of it, claimed or not.
    const container = surveyed
      .map((_, s) => s)
      .filter((s) => settles(k, s) && containment(keyExtent, surveyExtents[s]!) >= minIoU)
      .sort((a, b) => (used.has(a) ? 1 : 0) - (used.has(b) ? 1 : 0) || a - b)[0];
    if (container !== undefined) {
      used.add(container);
      parts[k] = {
        ...score,
        outcome: "boundary",
        surveyed: [container],
        surveyedGenre: surveyed[container]!.genre,
        note: `inside ${describePlace(surveyed[container]!.place)}`,
        itemCodes: recallCodes(key.parts[k]!.itemCodes ?? [], surveyed[container]!.itemCodes),
        finishCodes: recallCodes(key.parts[k]!.finishCodes ?? [], surveyed[container]!.finishCodes),
      };
    }
  });

  const extraParts: ExtraPart[] = surveyed
    .map((part, index) => ({ index, place: part.place, genre: part.genre, held: held[index]! }))
    .filter((entry) => !used.has(entry.index) && !skipped[entry.index]);

  const counts = emptyCounts();
  counts.expected = parts.length;
  for (const score of parts) counts[score.outcome] += 1;
  counts.extra = extraParts.length;
  const sum = (pick: (score: ExpectedPartScore) => CodeRecall) => ({
    expected: parts.reduce((total, score) => total + pick(score).expected, 0),
    found: parts.reduce((total, score) => total + pick(score).found, 0),
    extra: parts.reduce((total, score) => total + pick(score).extra.length, 0),
  });

  return {
    file: key.file,
    surveyed: survey !== null,
    parts,
    extraParts,
    skipped: surveyed.filter((_, s) => skipped[s]).map((part) => part.place),
    counts,
    pageError: parts.reduce((total, score) => total + (score.pageError ?? 0), 0),
    itemCodes: sum((score) => score.itemCodes),
    finishCodes: sum((score) => score.finishCodes),
  };
}

// ---- items across the pack --------------------------------------------------

/**
 * The pack pass's grouping, as far as the scorer reads it. Structural, so the
 * survey's own `groupPack` result is accepted as it is without this file
 * importing the survey (which a pure test would then have to mock).
 */
export type PackGroups = { items: { code: string; parts: { file: string; part: number }[] }[] };

export type ItemLinks = {
  expected: number;
  found: number;
  missing: { code: string; file: string }[];
  /** Links the grouping made that the key does not, in files that were surveyed. Counted, never penalised. */
  extra: { code: string; file: string }[];
};

/**
 * An item's link to a file is FOUND when the survey's grouping puts a part of
 * that file under the item's code, both folded with `normaliseRef`. Only files
 * in `scope` count, on both sides — a file `--only` left out is not a miss.
 */
export function scoreItemLinks(keyItems: SurveyGolden["items"], groups: PackGroups, scope: ReadonlySet<string>): ItemLinks {
  const grouped = new Map<string, { code: string; files: Set<string> }>();
  for (const item of groups.items) {
    const fold = normaliseRef(item.code);
    if (!fold) continue;
    const entry = grouped.get(fold) ?? { code: item.code, files: new Set<string>() };
    for (const part of item.parts) entry.files.add(part.file);
    grouped.set(fold, entry);
  }
  const expectedLinks = new Set<string>();
  const missing: ItemLinks["missing"] = [];
  let expected = 0;
  let found = 0;
  for (const item of keyItems) {
    const fold = normaliseRef(item.code);
    for (const file of new Set(item.files)) {
      if (!scope.has(file)) continue;
      const link = `${fold}\u0000${file}`;
      if (expectedLinks.has(link)) continue;
      expectedLinks.add(link);
      expected += 1;
      if (grouped.get(fold)?.files.has(file)) found += 1;
      else missing.push({ code: item.code, file });
    }
  }
  const extra: ItemLinks["extra"] = [];
  for (const [fold, entry] of grouped) {
    for (const file of entry.files) {
      if (scope.has(file) && !expectedLinks.has(`${fold}\u0000${file}`)) extra.push({ code: entry.code, file });
    }
  }
  return { expected, found, missing, extra };
}

// ---- one pack ---------------------------------------------------------------

export type PackScore = {
  pack: string;
  verified: boolean;
  files: FileScore[];
  /** Key files neither surveyed nor failed in this run (narrowed out by --only, or absent from --files). Not counted. */
  notSurveyed: string[];
  /** Surveyed files the key does not list. Not counted. */
  unkeyed: string[];
  items: ItemLinks;
};

/**
 * One pack. `results` are the surveys that answered; `failed` names files
 * whose survey was attempted and failed, which are scored with every part
 * missed — a survey that could not answer did not find the parts.
 */
export function scoreSurvey(
  golden: SurveyGolden,
  results: SurveyFile[],
  packGroups: PackGroups,
  options: { minIoU?: number; failed?: readonly string[] } = {},
): PackScore {
  const byFile = new Map(results.map((result) => [result.file, result]));
  const failed = new Set(options.failed ?? []);
  const files: FileScore[] = [];
  const notSurveyed: string[] = [];
  for (const entry of golden.files) {
    const survey = byFile.get(entry.file) ?? null;
    if (!survey && !failed.has(entry.file)) {
      notSurveyed.push(entry.file);
      continue;
    }
    files.push(scoreFile(entry, survey, options));
  }
  const keyed = new Set(golden.files.map((entry) => entry.file));
  const scope = new Set(files.map((score) => score.file));
  return {
    pack: golden.pack,
    verified: golden.verified,
    files,
    notSurveyed,
    unkeyed: results.map((result) => result.file).filter((file) => !keyed.has(file)),
    items: scoreItemLinks(golden.items, packGroups, scope),
  };
}

// ---- totals -----------------------------------------------------------------

export type SurveyTotals = {
  packs: number;
  files: number;
  failedFiles: number;
  parts: PartCounts;
  /** Surveyed parts set aside as having nothing to read. */
  skipped: number;
  pageError: number;
  itemCodes: { expected: number; found: number; extra: number };
  finishCodes: { expected: number; found: number; extra: number };
  links: { expected: number; found: number; extra: number };
};

export function emptyTotals(): SurveyTotals {
  return {
    packs: 0,
    files: 0,
    failedFiles: 0,
    parts: emptyCounts(),
    skipped: 0,
    pageError: 0,
    itemCodes: { expected: 0, found: 0, extra: 0 },
    finishCodes: { expected: 0, found: 0, extra: 0 },
    links: { expected: 0, found: 0, extra: 0 },
  };
}

/** Totals over many packs, VERIFIED and draft kept apart: a pack's key decides its side. */
export function totalSurveyScores(scores: PackScore[]): { verified: SurveyTotals; unverified: SurveyTotals } {
  const verified = emptyTotals();
  const unverified = emptyTotals();
  for (const score of scores) {
    const side = score.verified ? verified : unverified;
    side.packs += 1;
    for (const file of score.files) {
      side.files += 1;
      if (!file.surveyed) side.failedFiles += 1;
      for (const key of Object.keys(side.parts) as (keyof PartCounts)[]) side.parts[key] += file.counts[key];
      side.pageError += file.pageError;
      side.skipped += file.skipped.length;
      for (const which of ["itemCodes", "finishCodes"] as const) {
        side[which].expected += file[which].expected;
        side[which].found += file[which].found;
        side[which].extra += file[which].extra;
      }
    }
    side.links.expected += score.items.expected;
    side.links.found += score.items.found;
    side.links.extra += score.items.extra.length;
  }
  return { verified, unverified };
}
