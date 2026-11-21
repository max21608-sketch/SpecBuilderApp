// ============================================================================
// A READ OF PART OF A FILE KEEPS ONLY WHAT ITS PART SAID (open intake,
// 2026-11-20; the design's trap 2).
//
// A read of pages 1–11 and 31–44 of a PDF is SENT THE WHOLE FILE, because the
// file's page numbers are what every staged page, swatch crop and page link
// reads (`source-part.ts`). It is told which pages are its own; it is not
// trusted to keep to them. Without this filter an item from another part of
// the file stages, previews and confirms as if it belonged here — and the same
// item is staged by two reads of one file, once by each, for a person to
// notice or not.
//
// So, on the RAW output and before any staging function sees it, everything
// reported from a page outside the part is dropped, and the drop is
// SAID: counted, named and put in one line of the document's notes. The
// precedent is `mergeWindowProposals` (`spreadsheet-windows.ts`), which drops
// a row window's proposals from outside its rows.
//
// TWO RULES A "TIDIER" VERSION WOULD BREAK:
//
//   * A ROW WITH NO PAGE IS KEPT. The model leaves a page out where it could
//     not say one, and an absent page is not evidence the row came from
//     elsewhere. Dropping it would lose real readings to protect against a
//     guess.
//   * AN ITEM IS DROPPED ONLY WHEN EVERY PAGE IT NAMES IS OUTSIDE. An item
//     with one page in and one out is this read's item that the model also
//     saw elsewhere — the S-200 sheet in the part and its shop drawing beyond
//     it. It keeps its inside pages and loses the rows citing the others, and
//     says so in its own `uncertain` list, on the card a person reviews.
//
// Exhaustive over the output kinds: a new kind is a type error in `restrict`,
// never a payload that slips through unfiltered.
// ============================================================================
import type { ExtractionPayload, RawDrawingItemV4, RawOverall, RawOverallFigure } from "@/lib/extraction-schema";
import { normalisePart, pageInPart, partLabel, type SourcePart } from "@/lib/source-part";

export type PartRestriction = {
  output: ExtractionPayload;
  /** The line for the document's notes, or null when nothing was left out. */
  leftOut: string | null;
};

/** What was dropped, of one sort, for the sentence. */
type Dropped = { noun: [string, string]; names: string[]; pages: Set<number>; sheets: Set<string>; count: number };

class Tally {
  readonly groups = new Map<string, Dropped>();

  /** One thing dropped, from these pages or this sheet, under this name. */
  add(
    key: string,
    noun: [string, string],
    where: { pages?: Iterable<number | null>; sheet?: string | null },
    name: string | null,
  ) {
    const group = this.groups.get(key) ?? { noun, names: [], pages: new Set(), sheets: new Set(), count: 0 };
    group.count += 1;
    for (const page of where.pages ?? []) if (page != null) group.pages.add(page);
    if (where.sheet != null) group.sheets.add(where.sheet);
    if (name && !group.names.includes(name)) group.names.push(name);
    this.groups.set(key, group);
  }

  get empty(): boolean {
    return this.groups.size === 0;
  }
}

const MAX_NAMED = 10;

function placesOf(group: Dropped): string | null {
  if (group.pages.size > 0) {
    const ranges = [...group.pages].sort((a, b) => a - b).map((page) => ({ from: page, to: page }));
    const normal = normalisePart({ kind: "pages", ranges });
    return normal.ok ? partLabel(normal.part) : null;
  }
  if (group.sheets.size > 0) return partLabel({ kind: "sheets", sheets: [...group.sheets] });
  return null;
}

/**
 * "Left out: 2 items reported from pages 12–30 (S-500, S-501); 3 lines of kept
 * items reported from page 45. None of that is part of this read (pages 1–11
 * and 31–44)."
 */
function sentence(tally: Tally, part: SourcePart): string | null {
  if (tally.empty) return null;
  const clauses = [...tally.groups.values()].map((group) => {
    const noun = group.count === 1 ? group.noun[0] : group.noun[1];
    const places = placesOf(group);
    const named =
      group.names.length === 0
        ? ""
        : ` (${group.names.slice(0, MAX_NAMED).join(", ")}${group.names.length > MAX_NAMED ? ` and ${group.names.length - MAX_NAMED} more` : ""})`;
    return `${group.count} ${noun}${places ? ` reported from ${places}` : ""}${named}`;
  });
  return `Left out: ${clauses.join("; ")}. None of that is part of this read (${partLabel(part)}).`;
}

/** Inside the part, or no page to judge by. */
const keeps = (part: SourcePart, page: number | null | undefined) => page == null || pageInPart(part, page);

function restrictFigure(
  part: SourcePart,
  figure: RawOverallFigure,
  outside: Set<number>,
): RawOverallFigure {
  if (!figure) return figure;
  if (!keeps(part, figure.page)) {
    outside.add(figure.page!);
    return null;
  }
  const candidates = figure.candidates.filter((candidate) => {
    if (keeps(part, candidate.page)) return true;
    outside.add(candidate.page!);
    return false;
  });
  return candidates.length === figure.candidates.length ? figure : { ...figure, candidates };
}

function restrictOverall(part: SourcePart, overall: RawOverall, outside: Set<number>): RawOverall {
  return {
    width: restrictFigure(part, overall.width, outside),
    depth: restrictFigure(part, overall.depth, outside),
    height: restrictFigure(part, overall.height, outside),
    seatHeight: restrictFigure(part, overall.seatHeight, outside),
    diameter: restrictFigure(part, overall.diameter, outside),
  };
}

/** Rows of a list whose page is outside, dropped, their pages noted. */
function within<T extends { page: number | null }>(part: SourcePart, rows: T[], outside: Set<number>): T[] {
  return rows.filter((row) => {
    if (keeps(part, row.page)) return true;
    outside.add(row.page!);
    return false;
  });
}

function itemName(item: { codes: string[]; name: string | null }): string {
  return item.codes[0] ?? item.name ?? "an item with no code";
}

/** Every page an item's rows cite, from its figures, configurations, finishes, swatches and lists. */
function citedPages(item: RawDrawingItemV4): number[] {
  const pages: (number | null | undefined)[] = [];
  const figures = (overall: RawOverall) => {
    for (const figure of Object.values(overall)) {
      if (!figure) continue;
      pages.push(figure.page, ...figure.candidates.map((candidate) => candidate.page));
    }
  };
  figures(item.overall);
  for (const configuration of item.configurations) {
    pages.push(...configuration.pages);
    figures(configuration.overall);
  }
  for (const finish of item.finishes) pages.push(finish.page, finish.swatch?.page);
  for (const rows of [item.statements, item.otherDimensions, item.notes, item.pictures]) pages.push(...rows.map((row) => row.page));
  return pages.filter((page): page is number => page != null);
}

/**
 * One v4 item: dropped (null) when every page it names is outside, otherwise
 * trimmed and said. AN ITEM THAT NAMES NO PAGES OF ITS OWN is judged by the
 * pages its rows cite: where every one of them is outside, it is another
 * part's item, and kept it would stage as an empty card carrying that item's
 * codes. Where none of its rows cites a page either, there is nothing to
 * judge by, and it is kept, as a row with no page is.
 */
function restrictItemV4(part: SourcePart, item: RawDrawingItemV4, tally: Tally): RawDrawingItemV4 | null {
  if (item.pages.length > 0 && item.pages.every((page) => !pageInPart(part, page))) {
    tally.add("items", ["item", "items"], { pages: item.pages }, itemName(item));
    return null;
  }
  if (item.pages.length === 0) {
    const cited = citedPages(item);
    if (cited.length > 0 && cited.every((page) => !pageInPart(part, page))) {
      tally.add("items", ["item", "items"], { pages: cited }, itemName(item));
      return null;
    }
  }
  const outside = new Set<number>();
  const pages = item.pages.filter((page) => {
    if (pageInPart(part, page)) return true;
    outside.add(page);
    return false;
  });
  const rowsBefore = countRows(item);
  const kept: RawDrawingItemV4 = {
    ...item,
    pages,
    overall: restrictOverall(part, item.overall, outside),
    // A CONFIGURATION SEEN ONLY OUTSIDE THE PART is another part's, and kept
    // with no pages it would stage as a variant of this item nobody drew
    // here. One that named no pages to begin with is kept: nothing to judge.
    configurations: item.configurations.flatMap((configuration) => {
      if (configuration.pages.length > 0 && configuration.pages.every((page) => !pageInPart(part, page))) {
        for (const page of configuration.pages) outside.add(page);
        tally.add("configurations", ["configuration", "configurations"], { pages: configuration.pages }, `${itemName(item)} ${configuration.name}`);
        return [];
      }
      return [
        {
          ...configuration,
          pages: configuration.pages.filter((page) => {
            if (pageInPart(part, page)) return true;
            outside.add(page);
            return false;
          }),
          overall: restrictOverall(part, configuration.overall, outside),
        },
      ];
    }),
    finishes: within(part, item.finishes, outside).map((finish) => {
      if (!finish.swatch || keeps(part, finish.swatch.page)) return finish;
      outside.add(finish.swatch.page!);
      return { ...finish, swatch: null };
    }),
    statements: within(part, item.statements, outside),
    otherDimensions: within(part, item.otherDimensions, outside),
    notes: within(part, item.notes, outside),
    pictures: within(part, item.pictures, outside),
  };
  if (outside.size === 0) return item;
  const rowsDropped = rowsBefore - countRows(kept);
  for (let index = 0; index < rowsDropped; index += 1) {
    tally.add("rows", ["line of a kept item", "lines of kept items"], { pages: outside }, itemName(item));
  }
  const where = normalisePart({ kind: "pages", ranges: [...outside].map((page) => ({ from: page, to: page })) });
  const said = where.ok ? partLabel(where.part) : "other pages";
  return {
    ...kept,
    uncertain: [
      ...kept.uncertain,
      {
        about: "other",
        why: `The read also reported this item on ${said}, which ${outside.size === 1 ? "is" : "are"} not part of this read (${partLabel(part)}); what ${outside.size === 1 ? "it" : "they"} said was left out.`,
      },
    ],
  };
}

/** Every row of an item a page can be cited on, for counting what was dropped. */
function countRows(item: RawDrawingItemV4): number {
  const figures = (overall: RawOverall) =>
    Object.values(overall).reduce((total, figure) => total + (figure ? 1 + figure.candidates.length : 0), 0);
  return (
    figures(item.overall) +
    item.configurations.reduce((total, configuration) => total + figures(configuration.overall), 0) +
    item.finishes.length +
    item.statements.length +
    item.otherDimensions.length +
    item.notes.length +
    item.pictures.length
  );
}

function restrict(output: ExtractionPayload, part: SourcePart, tally: Tally): ExtractionPayload {
  switch (output.outputKind) {
    case "observations": {
      // BY PAGE ONLY. A part of a workbook is read from its own sheets and
      // nothing else (`prepareDocumentSource` keeps only them), so a reading
      // whose sheet is not a name in the part is the model SPELLING a sheet
      // it was shown — "BOQ" for "BOQ " — not a reading from elsewhere, and
      // dropping it would lose a real reading to a typo.
      const proposals = output.data.proposals.filter((proposal) => {
        if (keeps(part, proposal.page)) return true;
        tally.add("observations", ["reading", "readings"], { pages: [proposal.page] }, proposal.refRaw);
        return false;
      });
      return { outputKind: "observations", data: { ...output.data, proposals } };
    }
    case "drawing_items": {
      // The page-centric v3 read: nothing in the app asks for it any more, and
      // a harness re-read can. One item is one page, so it is in or out.
      const items = output.data.items
        .filter((item) => {
          if (keeps(part, item.page)) return true;
          tally.add("items", ["item", "items"], { pages: [item.page] }, item.itemCodeRaw ?? "an item with no code");
          return false;
        })
        .map((item) =>
          item.viewRegions === undefined ? item : { ...item, viewRegions: item.viewRegions.filter((region) => keeps(part, region.page)) },
        );
      const codeGroups = output.data.codeGroups?.map((group) => ({ ...group, pages: group.pages.filter((page) => pageInPart(part, page)) }));
      return {
        outputKind: "drawing_items",
        data: { ...output.data, items, ...(codeGroups === undefined ? {} : { codeGroups }) },
      };
    }
    case "drawing_items_v4": {
      const items: RawDrawingItemV4[] = [];
      for (const item of output.data.items) {
        const kept = restrictItemV4(part, item, tally);
        if (kept) items.push(kept);
      }
      const nonItemPages = output.data.nonItemPages.filter((entry) => {
        if (pageInPart(part, entry.page)) return true;
        tally.add("nonItemPages", ["page said to describe no item", "pages said to describe no item"], { pages: [entry.page] }, null);
        return false;
      });
      return { outputKind: "drawing_items_v4", data: { ...output.data, items, nonItemPages } };
    }
    case "preamble_notes": {
      const notes = output.data.notes.filter((note) => {
        if (keeps(part, note.page)) return true;
        tally.add("notes", ["note", "notes"], { pages: [note.page] }, note.titleRaw ?? note.topicRaw);
        return false;
      });
      return { outputKind: "preamble_notes", data: { ...output.data, notes } };
    }
    case "finish_entries": {
      const entries = output.data.entries.filter((entry) => {
        if (keeps(part, entry.page)) return true;
        tally.add("finishes", ["finish", "finishes"], { pages: [entry.page] }, entry.codeRaw ?? entry.nameRaw);
        return false;
      });
      return { outputKind: "finish_entries", data: { ...output.data, entries } };
    }
    default: {
      const unreachable: never = output;
      throw new Error(`No part filter for ${(unreachable as { outputKind: string }).outputKind}.`);
    }
  }
}

/**
 * The model's output with everything outside `part` dropped, and the line
 * that says what was. A whole file (`part` null) passes through untouched —
 * the same object, so a read registered before parts stages exactly as before.
 */
export function restrictOutputToPart(output: ExtractionPayload, part: SourcePart | null): PartRestriction {
  if (!part) return { output, leftOut: null };
  const tally = new Tally();
  const restricted = restrict(output, part, tally);
  return { output: restricted, leftOut: sentence(tally, part) };
}

/** The document's notes with the left-out line after them. */
export function withLeftOutNote(notes: string | null, leftOut: string | null): string | null {
  if (!leftOut) return notes;
  return notes ? `${notes}\n${leftOut}` : leftOut;
}
