// Parsing a client Bill of Quantities spreadsheet into staged lines.
//
// Deterministic on purpose: a BOQ is a grid, so reading it needs no model, no
// queue and no spend. `prepareDocumentSource` in intake-source.ts is NOT the
// right tool here — it flattens every sheet into one text blob for a model to
// read, and parsing back out of that would be inventing a second, worse CSV.
// This works on `read-excel-file`'s positional rows instead.
//
// What it must survive, taken from the pilot projects' real BOQs:
//   * Title rows and a blank row before the header. The header is found, never
//     assumed to be row 1.
//   * A client code that repeats. `SX11A` is two separate lines with different
//     quantities, and they are two separate records. Nothing here deduplicates.
//   * Free-text item descriptions ("Bench @entrance", "Chair @ desk",
//     "Coffee Table incl GLASS"), which is why category matching happens later,
//     against a human, rather than here.
//   * Trailing blank rows, and stray totals rows with no code.
//   * SEVERAL SHEETS THAT ARE ALL REAL. AP364 carries a mock-up run, a main run
//     and a value-engineered run as tabs, with the SAME codes and DIFFERENT
//     quantities. The old version returned on the first sheet with a header and
//     dropped the rest with no warning anywhere — the reviewer saw a clean
//     import of a third of their bill. Every sheet with a header is now staged,
//     and each becomes a run.
//   * PER-LEVEL QUANTITY COLUMNS (`L1`..`L6`) that must NOT be mistaken for the
//     total. They are deliberately unlisted below, so they match no synonym and
//     fall through; only `TOTAL Q-ty` is read.
//
// It deliberately does NOT: assign categories, resolve refs, deduplicate,
// or write anything. It returns what the sheet said, with the row number it
// said it on, so a reviewer can go and look.
import type { SheetData } from "read-excel-file/node";
import type { ItemLevel } from "@/lib/spec-vocab";
import type { NonFurnitureGuess } from "@/lib/non-furniture-guess";

export type BoqLine = {
  /** 1-based row number in the source sheet, for "go and look at line 34". */
  lineNo: number;
  designer: string | null;
  /** The BOQ's own grouping word ("Furniture" / "Seating"), not our category. */
  boqCategory: string | null;
  /** The area/zone column where the client's template has one ("Rooms"). */
  area: string | null;
  /** The client's code. NOT unique — see the SX11A note above. */
  code: string | null;
  itemDescription: string;
  productReference: string | null;
  qty: number | null;
  /** The unit of measure as written ("pcs"). Retained, not yet acted on. */
  qtyUnit: string | null;
};

/**
 * A staged line: the parsed row plus everything the reviewer decides about it.
 *
 * `index` is its position in the sheet, which is a stable address HERE and
 * nowhere else in the app: the BOQ's staged list is fixed — reviewing a line
 * flips a flag rather than removing it — so nothing renumbers underneath an
 * open tab. Extraction proposals are the opposite case and are addressed by
 * id; see src/lib/spec-document.ts.
 */
export type StagedBoqLine = BoqLine & {
  index: number;
  categoryId: string | null;
  categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[];
  /**
   * The item's level: simple, complex or hero — guessed at parse time and
   * shown on the review table for a person to correct.
   *
   * `levelStatus` is the difference between the app's reading and somebody's
   * decision, and it decides which COLUMN the confirm writes: `chosen` fills
   * `spec_records.level`, which the quote gate reads; `suggested` fills
   * `level_suggested`, which nothing reads until a person accepts it. See
   * db/migrations/0025_level_suggestion.sql.
   *
   * OPTIONAL: every one of these keys is absent on a bill staged before
   * 2026-09-17, and a reader that required them would refuse to open a run
   * somebody is halfway through reviewing.
   */
  level?: ItemLevel | null;
  levelStatus?: "suggested" | "chosen";
  levelReason?: string | null;
  /**
   * "This does not look like furniture" — a question, with what it was read
   * from, stored at staging so the review screen and anything reading the
   * staged bill see the same one. It decides NOTHING: `ignored` below is the
   * only thing the confirm reads, and only a reviewer's click sets it.
   *
   * OPTIONAL, and the absence is meaningful: `undefined` is a bill staged
   * before the question existed, and `src/lib/non-furniture-guess.ts` answers
   * it at read time for those. `null` is the question asked and answered no.
   */
  nonFurnitureSuggested?: NonFurnitureGuess | null;
  ignored: boolean;
  /** The record this line continues, at the version the reviewer was shown. */
  replaces?: { recordId: string; recordVersion: number } | null;
};

/**
 * The rows ABOVE the header. They carry the revision, the date and the terms
 * the whole run is priced under ("*All fabrics are COM and should not be
 * included in the unit costs"). Retained verbatim: a value whose source
 * caveats were thrown away at parse time is one nobody can re-check.
 */
export type BoqSheetMetadata = {
  revision: string | null;
  date: string | null;
  notes: string[];
};

export type StagedBoqSheet = {
  sheetName: string;
  /**
   * The run this sheet REVISES, or null for a new run.
   *
   * Set by the reviewer, never inferred at confirm: pairing a revised bill to
   * an existing run is matching, and confirm-boq.ts writes what the reviewer
   * approved rather than what a fresh match would produce now.
   */
  replacesRunId?: string | null;
  /** Defaulted from the sheet name, edited by the reviewer, becomes the run. */
  proposedRunName: string;
  headerRow: number;
  /**
   * How many rows the header spans: 1, or 2 where the second completes the
   * first ("FF&E" over "code"). `headerRow` is always the LAST of them, so
   * the items start after it either way.
   *
   * OPTIONAL, and absent means one: the staged JSON is data from the past and
   * every bill staged before two-row headers were read carries no such key.
   */
  headerRows?: number;
  skippedRows: number;
  ignored: boolean;
  ignoredReason: string | null;
  metadata: BoqSheetMetadata;
  lines: StagedBoqLine[];
};

/**
 * The staged shape of a BOQ intake run.
 *
 * v1 held ONE sheet; 0007 upgraded it to a list. v3 (0017) adds the reviewer's
 * revision decisions: `replacesRunId` per sheet and `replaces` per line.
 */
export type BoqDocument = {
  schemaVersion: 3;
  filename: string | null;
  sourcePreserved: boolean;
  sheets: StagedBoqSheet[];
};

/**
 * What the PARSER produces, before a reviewer has decided anything about it.
 *
 * Separate from StagedBoqSheet because the two are genuinely different: this
 * is what the spreadsheet says, and the staged shape is that plus every
 * decision made since. One type for both meant the parser looked as though it
 * emitted category choices and revision pairings.
 */
export type ParsedBoqSheet = Omit<StagedBoqSheet, "lines" | "replacesRunId"> & { lines: BoqLine[] };

export type BoqParseResult = { ok: true; sheets: ParsedBoqSheet[] } | { ok: false; error: string };

/**
 * Header synonyms, normalised. `L1`..`L6` are absent on purpose: a per-level
 * quantity is not the total, and a BOQ that put `L1` where `qty` looked for it
 * would produce an order for a fraction of the job.
 */
const COLUMNS = {
  designer: ["designer"],
  boqCategory: ["category"],
  area: ["area", "zone", "location"],
  code: ["code", "ff&e code", "ffe code", "ff&e ref", "client ref", "client reference", "ref"],
  itemDescription: ["item description", "description", "item"],
  productReference: ["product reference", "product ref", "reference"],
  qty: ["total q-ty", "total qty updated", "total qty", "total quantity", "qty", "quantity"],
  qtyUnit: ["unit", "uom", "unit of measure"],
} as const;

type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: ColumnKey[] = ["code", "itemDescription"];

/** What one row of a sheet looked like to the header reader. */
type HeaderReading = {
  /** Which wanted column each recognised heading sat in. */
  found: Partial<Record<ColumnKey, number>>;
  /** The headings on the row that matched no synonym at all, in printed order. */
  unrecognised: string[];
  /** True when both required columns are there, which makes this row the header. */
  complete: boolean;
};

/** The nearest thing to a header the reader saw, for a refusal that can be acted on. */
type HeaderAttempt = HeaderReading & {
  sheetName: string;
  rowNo: number;
  /** The row below that was read together with it, where one was tried. */
  pairedWith?: number;
};

const COLUMN_LABEL: Record<ColumnKey, string> = {
  designer: "designer",
  boqCategory: "category",
  area: "area",
  code: "code",
  itemDescription: "description",
  productReference: "product reference",
  qty: "quantity",
  qtyUnit: "unit",
};

/**
 * A DATE-TYPED CELL, AS A PERSON READING THE WORKBOOK WOULD SEE IT.
 *
 * `toISOString()` was what both readers did with one, so the Panther bill's
 * revision arrived as `0 · 2026-09-15T00:00:00.000Z` on the review screen and
 * in the phase subtitle, over a cell the workbook prints as `15/09/2026`. A
 * timestamp, to the millisecond, on a value nothing computes with.
 *
 * TWO THINGS ABOUT IT ARE TRAPS RATHER THAN PREFERENCES.
 *
 * The value stays TEXT, which is right and was never what was wrong:
 * `spec_runs.boq_revision` and `.boq_date` are text columns on purpose, and
 * parsing "14-Sep-26" into a `date` is the TOE-dates trap for a value nothing
 * computes with. Nothing here produces a `Date`; it reads one and writes a
 * string.
 *
 * And the FIGURES are read in UTC, deliberately. `read-excel-file` turns a
 * serial number into "a javascript Date in UTC+0 timezone with time set to
 * 00:00" -- its own words -- so the day is the UTC day, and local getters
 * would render the day BEFORE anywhere west of Greenwich. This is the TOE
 * rule pointed the other way: there, a `date` column parsed to LOCAL midnight
 * and `toISOString()` moved it back a day in British Summer Time; here the
 * instant is already UTC midnight and the local calendar is the wrong one to
 * ask.
 *
 * A cell carrying a TIME as well keeps it. A bill would not normally, but
 * silently dropping half of what a cell said is how a "14:00 delivery" becomes
 * a date.
 */
function sheetDate(value: Date): string {
  const day = [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
  const minutes = value.getUTCHours() * 60 + value.getUTCMinutes();
  const seconds = value.getUTCSeconds();
  if (minutes === 0 && seconds === 0) return day;
  const clock = `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  return seconds === 0 ? `${day} ${clock}` : `${day} ${clock}:${String(seconds).padStart(2, "0")}`;
}

function norm(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? sheetDate(value) : String(value);
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = (value instanceof Date ? sheetDate(value) : String(value)).replace(/\s+/g, " ").trim();
  return out === "" ? null : out;
}

function quantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads one row AS A HEADER: which wanted column each heading sat in, which
 * headings it did not recognise, and whether that adds up to a header at all.
 *
 * IT NO LONGER RETURNS NULL FOR A NEAR MISS, and that is the whole of row 1 of
 * the variance matrix. A bill whose columns read "Item No." and "Product"
 * matched nothing required, so the reader refused with a list of the words it
 * accepts and NOT ONE WORD about what the bill actually said — which is the
 * only half a person can act on. Keeping the partial reading is what lets the
 * refusal name the closest row and quote its own headings back.
 */
function readHeader(row: readonly unknown[]): HeaderReading {
  const found: Partial<Record<ColumnKey, number>> = {};
  const unrecognised: string[] = [];
  row.forEach((cell, index) => {
    const value = norm(cell);
    if (!value) return;
    let claimed = false;
    for (const [key, synonyms] of Object.entries(COLUMNS) as [ColumnKey, readonly string[]][]) {
      // First match wins: "Product Reference" must not be claimed by `code`'s
      // "reference" synonym once a real "Code" column has been seen.
      if (!(synonyms as readonly string[]).includes(value)) continue;
      claimed = true;
      if (found[key] === undefined) found[key] = index;
    }
    if (!claimed) unrecognised.push(text(cell) ?? "");
  });
  return { found, unrecognised, complete: REQUIRED.every((key) => found[key] !== undefined) };
}

/** How much of a header a row managed to be, for picking the closest one. */
function headerScore(reading: HeaderReading): number {
  return Object.keys(reading.found).length;
}

/**
 * TWO ROWS READ AS ONE HEADER — variance matrix row 3.
 *
 * A client template that merges cells vertically, or simply wraps a long
 * heading, splits one label over two rows: "FF&E" above "code", "Item" above
 * "description", "Total" above "Q-ty". Neither row is a header on its own, so
 * a whole bill refused for want of a code column it plainly has.
 *
 * Each column offers three readings — the upper cell, the lower cell, and the
 * two joined in printed order — and the same whole-value synonym rule decides.
 * Joining is NOT a substring rule: "ff&e code" matches because it is a synonym,
 * where a rule clever enough to find "code" inside "ff&e code" would also find
 * it inside "cost code" and inside a data row's "Coded oak".
 *
 * IT IS ONLY EVER TRIED ON A ROW THAT ALREADY LOOKS LIKE A HEADER, and only
 * when the pair COMPLETES the required columns. Trying it on any row would let
 * a title row and the first data row under it conspire into a header, and the
 * bill would then be read one row short with its first item as column names.
 */
function readHeaderPair(upper: readonly unknown[], lower: readonly unknown[]): HeaderReading {
  const width = Math.max(upper.length, lower.length);
  const joined: unknown[] = [];
  for (let index = 0; index < width; index += 1) {
    const above = text(upper[index]);
    const below = text(lower[index]);
    joined.push(above && below ? `${above} ${below}` : (above ?? below));
  }

  // Each of the three readings, merged first-match-wins per column key: the
  // lower row's own words win over a join, and the join over the upper row's,
  // because the lower row is the one immediately above the items.
  const readings = [readHeader(lower), readHeader(joined), readHeader(upper)];
  const found: Partial<Record<ColumnKey, number>> = {};
  for (const reading of readings) {
    for (const [key, index] of Object.entries(reading.found) as [ColumnKey, number][]) {
      if (found[key] === undefined) found[key] = index;
    }
  }
  // What NEITHER row nor the join recognised, for the refusal to quote.
  const unrecognised = readHeader(joined).unrecognised;
  return { found, unrecognised, complete: REQUIRED.every((key) => found[key] !== undefined) };
}

const LABEL_ONLY = /^(revision|rev|date)\s*[:\-]?\s*$/i;
const LABEL_INLINE = /^(revision|rev|date)\s*[:\-]\s*(.+)$/i;

/**
 * Reads the rows above the header.
 *
 * A client template writes `Revision:` in one cell and `0` in the NEXT one, so
 * a single-cell regex finds the label and no value. Both the split form and the
 * inline `Revision: 0` form are handled, and anything not consumed as a label
 * or its value is kept as a note rather than dropped.
 *
 * The revision and the date stay STRINGS. "14-Sep-26" is whatever the client
 * typed; parsing it into a date would hit the same trap as the TOE dates (a
 * `date` read as local midnight renders the day before it in British Summer
 * Time) for a value nothing computes with.
 */
function readMetadata(data: SheetData, headerIndex: number): BoqSheetMetadata {
  const metadata: BoqSheetMetadata = { revision: null, date: null, notes: [] };

  for (let rowIndex = 0; rowIndex < headerIndex; rowIndex += 1) {
    const row = data[rowIndex];
    if (!row) continue;
    const cells = row.map((cell) => text(cell));

    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i] ?? null;
      if (cell === null) continue;

      const inline = LABEL_INLINE.exec(cell);
      if (inline) {
        const key = (inline[1] ?? "").toLowerCase().startsWith("rev") ? "revision" : "date";
        const value = (inline[2] ?? "").trim();
        if (value !== "" && metadata[key] === null) metadata[key] = value;
        continue;
      }

      if (LABEL_ONLY.test(cell)) {
        const key = cell.toLowerCase().startsWith("rev") ? "revision" : "date";
        // The value is the next non-empty cell on the same row, if there is one.
        let value: string | null = null;
        for (let j = i + 1; j < cells.length; j += 1) {
          const next = cells[j] ?? null;
          if (next !== null) {
            value = next;
            cells[j] = null; // consumed; do not also record it as a note
            break;
          }
        }
        if (value !== null && metadata[key] === null) metadata[key] = value;
        if (value === null) metadata.notes.push(cell);
        continue;
      }

      metadata.notes.push(cell);
    }
  }

  return metadata;
}

/**
 * Parses EVERY sheet that looks like a BOQ. Multi-sheet workbooks are the norm
 * and each sheet is a run, not an alternative reading of one.
 */
export function parseBoqSheets(sheets: { sheet: string; data: SheetData }[]): BoqParseResult {
  if (sheets.length === 0) return { ok: false, error: "The file has no sheets." };

  const staged: ParsedBoqSheet[] = [];
  /** The nearest miss on any sheet, kept only so a refusal can name it. */
  let closest: HeaderAttempt | null = null;

  for (const { sheet, data } of sheets) {
    for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
      const row = data[rowIndex];
      if (!row) continue;
      const reading = readHeader(row);
      if (reading.complete) {
        staged.push(readRows(sheet, data, rowIndex, reading.found));
        break;
      }

      // A ROW THAT LOOKS LIKE HALF A HEADER GETS ONE MORE READING, with the row
      // below it (row 3 of the variance matrix). Nothing else does: a row that
      // matched no column at all is a title, and pairing it with the row under
      // it is how a bill loses its first item to the header.
      const below = headerScore(reading) > 0 ? data[rowIndex + 1] : undefined;
      if (below) {
        const pair = readHeaderPair(row, below);
        if (pair.complete) {
          staged.push(readRows(sheet, data, rowIndex + 1, pair.found, { headerRows: 2 }));
          break;
        }
      }

      if (headerScore(reading) > (closest ? headerScore(closest) : 0)) {
        closest = {
          ...reading,
          sheetName: sheet,
          rowNo: rowIndex + 1,
          ...(below ? { pairedWith: rowIndex + 2 } : {}),
        };
      }
    }
  }

  if (staged.length === 0) return { ok: false, error: noHeaderError(closest) };

  return { ok: true, sheets: staged };
}

/** As many of a row's own headings as a sentence can carry. */
const HEADINGS_NAMED = 8;
const HEADING_CHARS = 40;

/**
 * Why no sheet could be read, in a form somebody can act on.
 *
 * ============================================================================
 * IT NAMES THE BILL'S OWN WORDS, NOT ONLY OURS.
 *
 * The old message listed the synonyms this reader accepts and stopped there. On
 * the shape row 1 of the variance matrix is about — a bill headed "Item No." and
 * "Product" — that is a refusal a reviewer can do nothing with: they cannot see
 * which of their columns was not understood, and the person who CAN add the
 * alias never finds out what to add. So the closest row is quoted back, with
 * what it did recognise and what it did not.
 *
 * The synonym list is CODE (`COLUMNS` above), not seed data. The plan wants it
 * seeded eventually; until it is, adding a word is a commit, and this sentence
 * is what tells somebody which word.
 * ============================================================================
 */
function noHeaderError(closest: HeaderAttempt | null): string {
  const wanted =
    "A BOQ needs one row naming at least its code column " +
    `(one of: ${COLUMNS.code.join(", ")}) and its description column ` +
    `(one of: ${COLUMNS.itemDescription.join(", ")}).`;

  // Nothing on any sheet matched even one heading: there is no row to quote,
  // and inventing one — the widest row, the first row — would put a reviewer
  // in front of a heading list that was never a header.
  if (!closest || headerScore(closest) === 0) {
    return `Could not find a header row on any sheet. ${wanted} No row on any sheet named even one of them.`;
  }

  const matched = (Object.keys(closest.found) as ColumnKey[]).map((key) => COLUMN_LABEL[key]);
  const missing = REQUIRED.filter((key) => closest.found[key] === undefined).map((key) => COLUMN_LABEL[key]);
  const quoted = closest.unrecognised
    .filter((heading) => heading !== "")
    .slice(0, HEADINGS_NAMED)
    .map((heading) => `“${heading.length > HEADING_CHARS ? `${heading.slice(0, HEADING_CHARS)}…` : heading}”`);

  const parts = [
    `Could not find a header row on any sheet. ${wanted}`,
    `The closest is row ${closest.rowNo} of “${closest.sheetName}”, which named its ` +
      `${list(matched)} column${matched.length === 1 ? "" : "s"} but no ${list(missing)} column.`,
  ];
  // SAY THAT THE SECOND READING WAS TRIED. A two-row header is read as one
  // where the lower row completes the upper (variance matrix row 3), so a
  // refusal that did not mention it would leave somebody wondering whether a
  // split heading was the problem.
  if (closest.pairedWith !== undefined) {
    parts.push(`Reading it together with row ${closest.pairedWith} beneath it did not complete it either.`);
  }
  if (quoted.length > 0) {
    parts.push(
      `Its other headings read ${list(quoted)}${closest.unrecognised.length > HEADINGS_NAMED ? " and more" : ""}, ` +
        "and this reader knows none of them. Rename them to words above, or have the bill's own wording added to " +
        "the reader's list.",
    );
  } else {
    parts.push("Rename that column to one of the words above, or have the bill's own wording added to the reader's list.");
  }
  return parts.join(" ");
}

/** "a", "a and b", "a, b and c" — a list a person reads rather than parses. */
function list(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function readRows(
  sheet: string,
  data: SheetData,
  headerIndex: number,
  header: Partial<Record<ColumnKey, number>>,
  options: { headerRows?: number } = {},
): ParsedBoqSheet {
  const headerRows = options.headerRows ?? 1;
  const at = (row: readonly unknown[], key: ColumnKey): unknown => {
    const index = header[key];
    return index === undefined ? null : row[index];
  };

  const lines: BoqLine[] = [];
  let skippedRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex];
    if (!row) continue;

    const itemDescription = text(at(row, "itemDescription"));
    const code = text(at(row, "code"));

    // A row with neither a code nor a description is a spacer or a totals row.
    // Counted rather than silently dropped, so the reviewer is told.
    if (!itemDescription && !code) {
      if (row.some((cell: unknown) => text(cell) !== null)) skippedRows += 1;
      continue;
    }

    lines.push({
      lineNo: rowIndex + 1,
      designer: text(at(row, "designer")),
      boqCategory: text(at(row, "boqCategory")),
      area: text(at(row, "area")),
      code,
      itemDescription: itemDescription ?? "",
      productReference: text(at(row, "productReference")),
      qty: quantity(at(row, "qty")),
      qtyUnit: text(at(row, "qtyUnit")),
    });
  }

  // A header with nothing under it is a blank template tab. Staged as ignored
  // rather than failing the workbook: one empty tab must not cost the reviewer
  // the three real ones beside it.
  const empty = lines.length === 0;

  return {
    sheetName: sheet,
    proposedRunName: sheet,
    headerRow: headerIndex + 1,
    headerRows,
    skippedRows,
    ignored: empty,
    ignoredReason: empty ? "No rows under the header." : null,
    // The metadata stops at the FIRST of the header's rows. Reading up to the
    // last would file the upper half of a two-row header — "FF&E", "Item",
    // "Total" — as the phase's notes, where the revision and the COM terms go.
    metadata: readMetadata(data, headerIndex - (headerRows - 1)),
    lines,
  } satisfies ParsedBoqSheet;
}

/**
 * What the reader did with this sheet, in the words a reviewer wants.
 *
 * ============================================================================
 * "ROW 6 WAS SKIPPED, HEADER FOUND ON ROW 6" WAS TRUE AND UNREADABLE.
 *
 * The review printed `headerRow` and `skippedRows` side by side as two bare
 * fragments, and the pair read as a contradiction: the header row was not
 * skipped, and the rows that WERE skipped are two different populations that
 * the screen never distinguished.
 *
 *   - Rows ABOVE the header are not skipped at all. `readMetadata` reads them
 *     for the revision, the date and the terms the phase is priced under, and
 *     keeps everything else verbatim as a note. Saying so is the point: a
 *     reviewer who believes five rows were thrown away goes looking for them.
 *   - `skippedRows` counts rows UNDER the header carrying neither a code nor a
 *     description — spacers and totals — and only the non-blank ones, so a
 *     blank line between the header and the first item is in neither count.
 *
 * AND THE ITEMS-START ROW IS READ, NEVER COMPUTED. `headerRow + 1` is the
 * obvious arithmetic and it lies on every bill with a blank line or a totals
 * row under its header — which is the same class of mistake as the message it
 * replaces. It comes from the FIRST PARSED LINE's own `lineNo`, so it is
 * whatever the reader actually started at, and it degrades to an em dash
 * rather than guessing when a staged sheet carries no usable line number.
 *
 * Pure and structural on purpose: the staged JSON is data from the past and no
 * field was added to it, so this renders the same sentence for a bill staged
 * today and one staged before the sentence existed.
 * ============================================================================
 */
export function describeHeader(sheet: {
  headerRow?: number;
  headerRows?: number;
  skippedRows?: number;
  lines?: readonly { lineNo?: number; qty?: number | null }[];
}): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const sentences: string[] = [];

  const headerRow = Number.isFinite(sheet.headerRow) ? Number(sheet.headerRow) : null;
  // A header spanning two rows says both, because a reviewer checking the
  // sentence against the file has to find the same thing the reader found.
  // Absent means one: a bill staged before two-row headers were read carries
  // no such key, and the sentence must still be true of it.
  const spans = Number.isFinite(sheet.headerRows) ? Math.max(1, Number(sheet.headerRows)) : 1;
  sentences.push(
    headerRow === null
      ? "The header row was not recorded."
      : spans > 1
        ? `Header on rows ${headerRow - spans + 1} to ${headerRow}, read as one.`
        : `Header on row ${headerRow}.`,
  );

  const lines = sheet.lines ?? [];
  const firstLineNo = lines[0]?.lineNo;
  const firstItemRow = Number.isFinite(firstLineNo) ? Number(firstLineNo) : null;
  if (lines.length === 0) sentences.push("No items under it.");
  else sentences.push(`Items start on row ${firstItemRow ?? "—"}.`);

  const above = headerRow === null ? null : headerRow - spans;
  if (above !== null) {
    sentences.push(
      above <= 0
        ? "Nothing above it."
        : `${above} ${plural(above, "row", "rows")} above the header ${plural(above, "was", "were")} read as the ` +
          "phase's notes (revision, date, terms).",
    );
  }

  /**
   * NO QUANTITY ON THIS TAB AT ALL — variance matrix row 2.
   *
   * Said ONCE, here, rather than as a long label on three hundred rows: a bill
   * with no `TOTAL Q-ty` column gives no line a quantity, and the per-row cell
   * only has room to say "not given". The two halves are the same fact at two
   * scales, and neither of them is a 1.
   *
   * It does not distinguish a missing COLUMN from a column of blanks, because
   * the staged sheet does not record which columns were found and inventing
   * that distinction from the lines would be a guess. "The bill gave none" is
   * true of both.
   *
   * Strictly `null`, never a missing key: a staged line has carried `qty`
   * since the first version of this shape, so `undefined` means a partial
   * object in a test rather than a bill, and claiming a fact about one of
   * those is how this sentence would come to be wrong about a real sheet.
   */
  if (lines.length > 0 && lines.every((line) => line.qty === null)) {
    sentences.push("No line here carries a quantity — the bill gave none, so none is written.");
  }

  const skipped = Number.isFinite(sheet.skippedRows) ? Number(sheet.skippedRows) : 0;
  if (skipped > 0) {
    sentences.push(
      `${skipped} ${plural(skipped, "row", "rows")} under the header with no code or description ` +
        `${plural(skipped, "was", "were")} passed over (spacers or totals).`,
    );
  }

  return sentences.join(" ");
}

/**
 * Reads a staged BOQ run's `parsed` column as v2.
 *
 * v1 staged ONE sheet as `{sheet, lines, …}`; migration 0007 rewrote every
 * stored row. This refuses anything else rather than guessing: a reader that
 * supports two staged formats is a reader whose second format is exercised
 * once a year and is wrong when it is.
 */
/**
 * A staged BOQ, at the shape this build understands.
 *
 * v3 (0017) is v2 plus the reviewer's revision decisions. 0017 upgraded every
 * v2 row in place, exactly as 0007 upgraded v1 — a reader that supports two
 * staged formats has a second format that is exercised once a year and is
 * wrong when it is. The keys it adds are nullable, so a v3 row that has never
 * been touched reads identically to the v2 it came from.
 */
export function assertBoqDocument(parsed: unknown): BoqDocument {
  const doc = parsed as Partial<BoqDocument> | null;
  if (!doc || typeof doc !== "object" || doc.schemaVersion !== 3 || !Array.isArray(doc.sheets)) {
    throw new Error(
      "This import was staged in an older format and cannot be reviewed. Upload the BOQ again.",
    );
  }
  return doc as BoqDocument;
}

/** The sheets a confirm would actually act on. */
export function activeSheets(doc: BoqDocument): StagedBoqSheet[] {
  return doc.sheets.filter((sheet) => !sheet.ignored);
}

export function countLines(doc: BoqDocument): number {
  return activeSheets(doc).reduce((total, sheet) => total + sheet.lines.length, 0);
}

/**
 * Normalised form of a client reference, for the ref_value_norm column.
 * `FU06C-CG27.2` and `FU06C - CG27.2` are the same reference written twice;
 * this is what makes them compare equal. The original is always kept alongside.
 */
export function normaliseRef(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[–—]/g, "-").toUpperCase();
}

/** The staged-shape version this build writes. Bumped with its migration. */
export const BOQ_SCHEMA_VERSION = 3;
