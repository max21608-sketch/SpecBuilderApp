// ============================================================================
// THE PART OF A FILE ONE READ IS FOR (open intake, 2026-11-20).
//
// One PDF can hold a bill, its drawings and a preamble; one workbook can hold
// bill sheets and a finishes sheet. A READ is a file, a reader and a place: the
// place is a `SourcePart`, stored on `intake_runs.source_part` (0065), null
// for the whole file — which is every pack before this day and every file with
// one kind in it.
//
// THE TRAPS THIS FILE HOLDS THE LINE ON:
//
//   * PAGE NUMBERS ARE THE FILE'S, NEVER THE PART'S. Every staged page, every
//     `record_attributes.source_page`, every swatch crop and every `#page=N`
//     link is a page of the stored file, served whole. A part says WHICH pages
//     of that file are this read's; it never renumbers them. A helper here
//     that counted from the part's first page would make every one of those
//     wrong, silently and plausibly.
//   * ONE CANONICAL FORM. Ranges are sorted and merged, sheets de-duplicated,
//     so two registrations of the same place compare equal (`partKey`) — the
//     local replay key and the request ids read it, and two spellings of one
//     part would replay one read's answer for another.
//   * A LEAF. Screens import `documentLabel` and `partLabel`, so nothing here
//     may import a server module (`client-server-boundary.test.ts`).
// ============================================================================
import { z } from "zod";

export type PageRange = { from: number; to: number };

export type SourcePart =
  // PDF pages, 1-based and inclusive, in the FILE's numbering; sorted, merged.
  | { kind: "pages"; ranges: PageRange[] }
  // Workbook sheets, by exact name.
  | { kind: "sheets"; sheets: string[] };

export const MAX_PART_RANGES = 50;
export const MAX_PART_SHEETS = 200;
const MAX_SHEET_NAME = 200;
const MAX_PAGE = 100_000;

const pageNumber = (which: "first" | "last") =>
  z
    .number({ message: `A page range must give its ${which} page as a whole number.` })
    .int({ message: `A page range must give its ${which} page as a whole number.` })
    .max(MAX_PAGE, { message: `A page range's ${which} page is past the end of any PDF this app reads.` });

/**
 * The part as a registration carries it. `.strict()` on every object: a field
 * this app does not know is a client that disagrees with the server about
 * what a part is, and guessing which half it meant is the wrong answer. The
 * messages are sentences because the route prints the first one.
 */
export const SourcePartSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("pages"),
        ranges: z
          .array(
            z
              .object({
                from: pageNumber("first"),
                to: pageNumber("last"),
              })
              .strict(),
            { message: "A part of a PDF must list its pages." },
          )
          .max(MAX_PART_RANGES, { message: `A part of a PDF can name at most ${MAX_PART_RANGES} page ranges.` }),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sheets"),
        sheets: z
          .array(z.string({ message: "A sheet is named by its name." }).max(MAX_SHEET_NAME), {
            message: "A part of a workbook must list its sheets.",
          })
          .max(MAX_PART_SHEETS, { message: `A part of a workbook can name at most ${MAX_PART_SHEETS} sheets.` }),
      })
      .strict(),
  ],
  { errorMap: () => ({ message: "A part is either some pages of a PDF or some sheets of a workbook." }) },
);

export type PartCheck = { ok: true; part: SourcePart } | { ok: false; error: string };

/**
 * The canonical form, or a sentence saying why there is none. Ranges sorted,
 * touching and overlapping ones merged (`1–3` and `4–6` are `1–6`: a page
 * cannot fall between them); sheets de-duplicated in the order given, which is
 * the workbook's order wherever the survey wrote it.
 *
 * Refused, never repaired: an empty part (a read of nothing would be charged
 * for nothing), an inverted range (`9–3` is a typo, and `3–9` is a guess at
 * which one), a page below 1, and a blank sheet name.
 */
export function normalisePart(part: SourcePart): PartCheck {
  if (part.kind === "pages") {
    if (part.ranges.length === 0) return { ok: false, error: "A part of a PDF must name at least one page." };
    for (const range of part.ranges) {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to < 1) {
        return { ok: false, error: "Pages are counted from 1, the first page of the file." };
      }
      if (range.to < range.from) {
        return { ok: false, error: `Pages ${range.from} to ${range.to} run backwards. Give the first page first.` };
      }
    }
    const sorted = [...part.ranges].map((range) => ({ from: range.from, to: range.to })).sort((a, b) => a.from - b.from || a.to - b.to);
    const merged: PageRange[] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
      else merged.push(range);
    }
    return { ok: true, part: { kind: "pages", ranges: merged } };
  }
  const sheets: string[] = [];
  for (const sheet of part.sheets) {
    if (typeof sheet !== "string" || sheet.trim() === "") return { ok: false, error: "A sheet in a part must be named." };
    // EXACT names: a workbook may hold "BOQ" and "BOQ " as two sheets, and the
    // read matches on the name as stored. Only a repeat is dropped.
    if (!sheets.includes(sheet)) sheets.push(sheet);
  }
  if (sheets.length === 0) return { ok: false, error: "A part of a workbook must name at least one sheet." };
  return { ok: true, part: { kind: "sheets", sheets } };
}

/** Is this page of the FILE inside the part? Always true for a part that is not pages. */
export function pageInPart(part: SourcePart, page: number): boolean {
  if (part.kind !== "pages") return true;
  return part.ranges.some((range) => page >= range.from && page <= range.to);
}

/** Is this sheet inside the part? Exact name. Always true for a part that is not sheets. */
export function sheetInPart(part: SourcePart, sheet: string): boolean {
  if (part.kind !== "sheets") return true;
  return part.sheets.includes(sheet);
}

/** How many of the file's pages the part covers; null for a part that is not pages. */
export function partPageCount(part: SourcePart): number | null {
  if (part.kind !== "pages") return null;
  return part.ranges.reduce((total, range) => total + (range.to - range.from + 1), 0);
}

/** "A, B and C" — the house list, with "and" before the last and no Oxford comma. */
function listed(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function rangeText(range: PageRange, dash: string): string {
  return range.from === range.to ? String(range.from) : `${range.from}${dash}${range.to}`;
}

/**
 * The part in words, as every screen prints it: `pages 1–11 and 31–44`,
 * `page 7`, `sheet “Finishes”`, `sheets “BOQ” and “VE”`.
 */
export function partLabel(part: SourcePart): string {
  if (part.kind === "pages") {
    const ranges = part.ranges.map((range) => rangeText(range, "–"));
    return `${(partPageCount(part) ?? 0) === 1 ? "page" : "pages"} ${listed(ranges)}`;
  }
  const sheets = part.sheets.map((sheet) => `“${sheet}”`);
  return `${sheets.length === 1 ? "sheet" : "sheets"} ${listed(sheets)}`;
}

/** The document a read is of: `Pack.pdf — pages 1–11 and 31–44`, or the filename alone for a whole file. */
export function documentLabel(filename: string, part: SourcePart | null | undefined): string {
  return part ? `${filename} — ${partLabel(part)}` : filename;
}

/**
 * One canonical string per part, for ids and the replay key. Sheets are SORTED
 * here (and only here): two registrations naming the same sheets in a
 * different order are the same read.
 */
export function partKey(part: SourcePart): string {
  if (part.kind === "pages") return `pages:${part.ranges.map((range) => `${range.from}-${range.to}`).join(",")}`;
  return `sheets:${JSON.stringify([...part.sheets].sort())}`;
}

/**
 * The part as a piece of a stored filename: `pages 1-12`, `sheets BOQ and VE`.
 * A hyphen, not the en dash, and none of the characters a pathname or a
 * Windows filename cannot carry — a person downloads this file.
 */
export function partPathSuffix(part: SourcePart): string {
  const words =
    part.kind === "pages"
      ? `${(partPageCount(part) ?? 0) === 1 ? "page" : "pages"} ${listed(part.ranges.map((range) => rangeText(range, "-")))}`
      : `${part.sheets.length === 1 ? "sheet" : "sheets"} ${listed(part.sheets)}`;
  return words
    .replace(/[\\/:*?"<>|#%\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two parts of one file as one read. A PDF's pages and a workbook's sheets
 * cannot both be parts of one file, so asking for that union is a bug in the
 * caller and throws rather than picks.
 */
export function unionParts(a: SourcePart, b: SourcePart): SourcePart {
  if (a.kind === "pages" && b.kind === "pages") {
    const merged = normalisePart({ kind: "pages", ranges: [...a.ranges, ...b.ranges] });
    if (!merged.ok) throw new Error(merged.error);
    return merged.part;
  }
  if (a.kind === "sheets" && b.kind === "sheets") {
    const merged = normalisePart({ kind: "sheets", sheets: [...a.sheets, ...b.sheets] });
    if (!merged.ok) throw new Error(merged.error);
    return merged.part;
  }
  throw new Error("A part of a PDF and a part of a workbook cannot be one read.");
}

/**
 * What the model is told, after the prompt, when a read is part of a PDF. Null
 * for the whole file (the request is then exactly what it always was) and for
 * a part of a workbook, whose other sheets are never sent.
 *
 * ONE STATIC TEMPLATE, and nothing interpolated but page numbers: the part
 * came from a survey and a person's press, and a sheet name or a filename in
 * the instruction is text a document's author chose.
 *
 * The page numbering sentence is the load-bearing one. A drawing set prints
 * its own sheet numbers (`A-101`, `3 of 12`), and a read that gave those
 * instead of the file's page would put every swatch crop and page link on the
 * wrong page.
 */
export function partInstruction(part: SourcePart | null | undefined): string | null {
  if (!part || part.kind !== "pages") return null;
  const ranges = listed(part.ranges.map((range) => rangeText(range, "–")));
  const pages = `${(partPageCount(part) ?? 0) === 1 ? "page" : "pages"} ${ranges}`;
  return (
    `This file holds several documents. For this read, THE DOCUMENT is ${pages} of the file, ` +
    `counting the first page of the file as page 1 — not by any sheet or page numbers printed on the pages. ` +
    `The other pages are other documents, read separately: report nothing from them. ` +
    `Give every page you report as its number in the whole file.`
  );
}

/**
 * A stored `source_part` as a part, or null. The column's CHECK holds the
 * kind; this holds the rest, so a row written by hand reads as the whole file
 * rather than throwing in a screen.
 */
export function readStoredPart(value: unknown): SourcePart | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const shaped = SourcePartSchema.safeParse(parsed);
  if (!shaped.success) return null;
  const normal = normalisePart(shaped.data);
  return normal.ok ? normal.part : null;
}

/**
 * Why a registration may NOT carry this part, as the sentence the upload
 * prints, or null. `sourceKind` is `intakeSourceKind`'s answer for the file;
 * `pageCount` is the PDF's counted pages where they could be counted, and null
 * PROCEEDS — `countPdfPages` abstains on a file it cannot walk, and refusing
 * on an abstention would refuse real drawings.
 */
export function partRefusal(
  part: SourcePart,
  context: { sourceKind: string; documentKind: string | null | undefined; pageCount: number | null },
): string | null {
  if (context.documentKind === "email") return "An email is read whole. A part of one cannot be read on its own.";
  if (part.kind === "pages") {
    if (context.sourceKind !== "pdf") return "Only a PDF is read by its pages. Upload this file without naming pages.";
    const last = part.ranges[part.ranges.length - 1]?.to ?? 0;
    if (context.pageCount !== null && last > context.pageCount) {
      return `This PDF has ${context.pageCount} page${context.pageCount === 1 ? "" : "s"}, so page ${last} is not in it. Check the pages and upload it again.`;
    }
    return null;
  }
  if (context.sourceKind !== "xlsx") return "Only an .xlsx workbook is read by its sheets. Upload this file without naming sheets.";
  return null;
}
