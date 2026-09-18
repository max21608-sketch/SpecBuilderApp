// The costing sheet's ITEM BLOCK — the third of Matthew's three outputs.
//
// ============================================================================
// THIS FILE EMITS TEN COLUMNS OF AN EIGHTY-THREE COLUMN SHEET, ON PURPOSE.
//
// `Estimating Sheet Template - with stone.xlsx` (Sales/Projects & Clients/
// - Estimating tools/) is 83 columns across. Columns A-J identify the item;
// everything from K rightwards is an estimator's work — three identical
// pricing blocks whose median is taken, then a stone block. Read off a real
// completed one (Maybourne Paris seating, 69 items, 2026-09-18): Frame in
// Euro, Metalwork in Euro, Upholstery (Outsourced), effort hours at €38,
// Cost-Plus at 50% and 60% GP, Quoted Price, Who.
//
// SO THIS EXPORT STOPS AT J, AND THAT IS THE WHOLE DESIGN.
//
// The tempting version emits all 83 columns so the file "is" the estimating
// sheet. It would be a sheet that looks like the estimating sheet and prices
// nothing: the template's value is its FORMULAS — the exchange rate, the
// multiples, the GP targets, the median across three estimators — and this app
// cannot reproduce one of them. A spreadsheet carrying 73 empty columns where
// an estimator expects formulas is the plausible-looking wrong answer wearing
// a familiar layout, and somebody would eventually price off it.
//
// A-J is also CONTIGUOUS, which is what makes the narrow file the useful one:
// it pastes into the template as a block, and columns K onwards keep the
// formulas they shipped with. B is the template's own spacer and stays empty.
//
// ---- THIS IS NOT THE BWS FILE AND NOT THE QUOTE --------------------------
//
// The 109-column export REPLACES a job's fields on import, which is why it
// refuses to be filtered. The quote csv is a list of quotable lines for a
// person to price. This is the left-hand block of an internal estimating
// workbook. All three share `loadExportScope` and nothing else, so no two of
// them can describe a different set of records.
//
// ---- WHY THE DIMENSIONS GO IN `Tags` -------------------------------------
//
// THIS IS THE COLUMN THE WHOLE EXPORT IS FOR, and it is this repo's judgement
// rather than Matthew's instruction — flagged in `notes` so the screen says so.
//
// `Tags` on the real completed sheet holds a few actual tags (`dining chair`,
// `bathroom stool`) and, on every other filled row, a measurement somebody
// pasted out of a drawing or a designer's website:
//
//     Height: 91 cm\n- Width : 110 cm\n- Seat depth: 102cm
//     H800mm x D635mm x W700mm SH480mm.
//     H 93 - L 47 - P 56 cm - seat H-53cm which reduces by 3/4cm when seated
//     58 x 36 x 43cm
//
// Every trap the dimension model exists for is in those four lines: cm and mm
// in one column with nothing saying which a row is; `L`/`P` for longueur and
// profondeur, which no slot rule would place; a qualifier welded to a figure;
// and a bare triple whose order is an assumption. It is there because the
// sheet had nowhere structured to put a size, so a person typed what they
// found, in the form they found it.
//
// The app has somewhere structured. `composeDimensionCell` is the SINGLE
// composer — the export, the quote, the record screen and the drawings review
// all call it — so the figure an estimator prices against is the same one the
// BWS file ships, in millimetres, with the unit resolved in the fixed order
// and never guessed from a magnitude. Where it could not derive a number it
// renders the original verbatim in a bracket saying why, which is the honest
// cell and exactly what a pasted string could never be.
// ============================================================================
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import type { ExportAttribute, ExportRecord, ExportScope } from "@/lib/bws-export";
import type { AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";

/**
 * A-J of the template, with the template's own names where it has one.
 *
 * A and C are headed `Exchange rate` and its value on the template's own row 1
 * — the sheet reuses those two columns for links from row 2 down. We name them
 * for what the CELLS say, because a header reading "Exchange rate" over a
 * column of document links would be worse than useless.
 */
export const COSTING_HEADER = [
  "Specs",
  "",
  "Specs 2",
  "Area",
  "Client Ref",
  "Item",
  "Qty",
  "Image",
  "Comments",
  "Tags",
];

/** Where a value came from: one document, at one page. */
export type CostingSource = {
  runId: string;
  filename: string;
  page: number | null;
  /** How many of the record's attributes this document and page contributed. */
  weight: number;
};

export type CostingLink = { text: string; href: string };

export type CostingRow = {
  recordId: string;
  recordNo: number;
  /** The primary source document, as a link. Null where nothing on the record has a page. */
  specs: CostingLink | null;
  /** The second distinct document and page, where there is one. */
  specs2: CostingLink | null;
  area: string;
  clientRef: string;
  item: string;
  qty: string;
  /** True where the record holds a confirmed item picture, which only the xlsx can carry. */
  hasImage: boolean;
  comments: string;
  tags: string;
};

export type CostingSheet = {
  header: string[];
  rows: CostingRow[];
  /** What is not filled and why, for the screen to say in words. */
  notes: string[];
};

/**
 * The one or two documents a reviewer would open to check this item.
 *
 * Ordered by how much of the record each (document, page) actually accounts
 * for, then by page. An item is routinely specified across several pages —
 * geometry on one, finishes on another — and the page carrying most of what
 * the record knows is the one worth putting first. Ties break on the lower
 * page number so the order is stable across exports; an estimator who wrote
 * "Specs opens page 7" must not find it opening page 11 next week.
 *
 * NO PAGE MEANS NO LINK. A hand-typed value carries no source run and no page,
 * deliberately, and a link that opened a document at page 1 to stand in for a
 * value somebody typed would be a false provenance rather than a missing one.
 */
export function pickSources(sources: CostingSource[]): CostingSource[] {
  return [...sources]
    .sort((a, b) => b.weight - a.weight || (a.page ?? 0) - (b.page ?? 0) || a.filename.localeCompare(b.filename))
    .slice(0, 2);
}

/**
 * The link for one source.
 *
 * It points at THIS APP'S copy, not at SharePoint. The app holds the document
 * — it was uploaded into the blob store and is served by
 * `/api/imports/[id]/source`, which streams it inline and passes range
 * requests through so a viewer can jump straight to the page. Where the file
 * also sits in SharePoint this app has never been told, and composing a
 * SharePoint URL from a filename would be a guess that resolves to a 404 or,
 * worse, to a different revision of the same drawing.
 *
 * `#page=N` is the same fragment the costing-sheet skill uses and every
 * browser PDF viewer honours it.
 */
export function sourceLink(origin: string, source: CostingSource): CostingLink {
  const base = `${origin}/api/imports/${source.runId}/source`;
  return {
    text: source.page === null ? source.filename : `${source.filename} p${source.page}`,
    href: source.page === null ? base : `${base}#page=${source.page}`,
  };
}

/**
 * The composed dimension cell, or nothing.
 *
 * The same rows, the same composer and therefore the same string as BWS field
 * 3 and the quote's DIMS line. A second implementation here is how a costing
 * sheet starts pricing against a size the file does not carry.
 */
export function dimensionTag(attributes: ExportAttribute[]): string {
  const rows: DimensionRow[] = attributes
    .filter((attribute) => attribute.attrGroup === "dimension" && attribute.dimensionSlot !== null)
    .map((attribute) => ({
      slot: attribute.dimensionSlot as DimensionSlot,
      value: attribute.value,
      unit: attribute.unit as AttributeUnit | null,
      state: attribute.state,
      sortOrder: attribute.sortOrder,
    }));
  if (rows.length === 0) return "";
  return composeDimensionCell(rows).text.trim();
}

export type CostingInput = ExportScope & {
  records: (ExportRecord & { internalNotes?: string | null })[];
};

/**
 * One row per record in scope, in the order the export ships them.
 *
 * `sourcesByRecord` and `imageRecordIds` are passed in rather than queried
 * here, so this stays pure and provable without a database — the same shape as
 * `composeQuoteSheet` taking its boilerplate register as an argument.
 */
export function composeCostingSheet(
  scope: CostingInput,
  options: {
    origin: string;
    sourcesByRecord: Map<string, CostingSource[]>;
    imageRecordIds: Set<string>;
  },
): CostingSheet {
  const rows: CostingRow[] = [];

  for (const record of [...scope.records].sort((a, b) => a.recordNo - b.recordNo)) {
    const mine = scope.attributes.filter((attribute) => attribute.recordId === record.id);
    const [first, second] = pickSources(options.sourcesByRecord.get(record.id) ?? []);

    rows.push({
      recordId: record.id,
      recordNo: record.recordNo,
      specs: first ? sourceLink(options.origin, first) : null,
      specs2: second ? sourceLink(options.origin, second) : null,
      area: record.area ?? "",
      // The same join the BWS file's Client Code uses. The real sheet writes
      // `FU01-SX01` — two ref systems welded into one cell by hand — and this
      // app holds them as separate rows per system, so it prints what it has
      // rather than re-inventing somebody's punctuation.
      clientRef: record.boqCodes.join(", "),
      // A configuration is named, or two rows read as one item entered twice.
      item: record.variantLabel ? `${record.itemDescription} (${record.variantLabel})` : record.itemDescription,
      // NEVER APPORTIONED. A split bill line's quantity stays on the bill line
      // and its configurations carry null, because the bill says 45 and never
      // says how many are fabric A. A blank an estimator has to ask about beats
      // a number this app divided.
      qty: record.qty === null ? "" : String(record.qty),
      hasImage: options.imageRecordIds.has(record.id),
      comments: record.internalNotes?.trim() ?? "",
      tags: dimensionTag(mine),
    });
  }

  return { header: COSTING_HEADER, rows, notes: costingNotes(rows) };
}

function costingNotes(rows: CostingRow[]): string[] {
  const notes = [
    "Columns A to J only — the item block. Everything from K rightwards is the estimator's: three pricing blocks and the stone block, whose formulas this app cannot reproduce and does not hold the rates for. Paste these columns into the template and price it there.",
    "Tags carries the composed dimensions, from the same composer as the BWS file and the quote. On the sheets this was built against that column held measurements pasted by hand in mixed units; this is the app's structured answer to that, and it is this repo's judgement rather than an instruction from Matthew.",
    "Specs and Specs 2 open this app's own copy of the document at the page, not SharePoint — the app was never told where these files also live, and a composed SharePoint URL would be a guess.",
  ];

  const noQty = rows.filter((row) => row.qty === "").length;
  if (noQty > 0) {
    notes.push(
      `${noQty} row${noQty === 1 ? "" : "s"} carr${noQty === 1 ? "ies" : "y"} no quantity. A bill line split into configurations keeps its quantity on the bill line; nothing here divides it.`,
    );
  }

  const noSource = rows.filter((row) => row.specs === null).length;
  if (noSource > 0) {
    notes.push(
      `${noSource} row${noSource === 1 ? " has" : "s have"} no document link. A hand-typed spec carries no source page, which is the honest shape rather than a gap.`,
    );
  }

  const noTag = rows.filter((row) => row.tags === "").length;
  if (noTag > 0) {
    notes.push(`${noTag} row${noTag === 1 ? " has" : "s have"} no dimensions recorded yet, so Tags is blank rather than guessed.`);
  }

  return notes;
}

/**
 * One row as flat strings, for the csv.
 *
 * A csv cannot hold a hyperlink or a picture, so the link becomes its URL —
 * readable and clickable in most viewers — and the Image column is empty. The
 * xlsx is the format that carries both, which is why it is the default.
 */
export function costingRowCells(row: CostingRow): string[] {
  return [
    row.specs?.href ?? "",
    "",
    row.specs2?.href ?? "",
    row.area,
    row.clientRef,
    row.item,
    row.qty,
    "",
    row.comments,
    row.tags,
  ];
}
