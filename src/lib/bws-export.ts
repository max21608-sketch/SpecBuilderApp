// Composing the BWS job-spec layout from a project's records.
//
// ============================================================================
// WHAT THIS FILE IS, AND IS NOT
//
// It is a REVIEW FILE. It carries no `Id` and no `Job Number`, because this app
// has never had BWS access and does not know them. Nobody can import it back
// into BWS as it stands, and nothing here should pretend otherwise: BWS is
// read/download only, forever, and an export that looked importable would be
// the first step towards a code path that writes to it.
//
// THE EXPORT IS ALWAYS THE COMPLETE DATASET FOR ITS SCOPE.
//
// A BWS import REPLACES the job's fields; it does not merge. So a partial
// export silently wipes every field it omits, which makes "export only the
// records that changed" the most dangerous feature anyone could ask for here.
// The scope is a whole run or a whole project, never a filter, and the route
// refuses any query parameter it does not recognise so that a well-meaning
// `?status=incomplete` cannot become one.
//
// THE COLUMN LIST IS A STATIC CONSTANT, NOT A QUERY.
//
// 109 columns: A-AE are job metadata, AF-CI are the 56 spec fields this app
// holds, CJ-DE are website and style fields BWS owns. Only the last two blocks
// carry json ids, which is why the list cannot be derived from `spec_fields`
// alone. A test asserts that its 56 spec ids are exactly the seeded ones — that
// is what catches a BWS column insertion, which shifts every letter after it
// while the ids stay put.
// ============================================================================
import { compareRecordOrder } from "@/lib/record-label";
import {
  ATTRIBUTE_GROUP_LABELS,
  DIMENSION_SLOT_LABELS,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { composeDimensionCell } from "@/lib/dimensions";
import { combineFinishState, composeFinishCell, type Finish } from "@/lib/finishes";

export type BwsColumn = { name: string; jsonId: number | null };

/** Row 1 of the BWS export, verbatim — including the trailing space on 'Stone '. */
export const BWS_EXPORT_COLUMNS: BwsColumn[] = [
  { name: "Id", jsonId: null },
  { name: "Due Date", jsonId: null },
  { name: "Job Number", jsonId: null },
  { name: "Order Number", jsonId: null },
  { name: "Lifecycle State", jsonId: null },
  { name: "Buffer Colour", jsonId: null },
  { name: "Temp", jsonId: null },
  { name: "Status", jsonId: null },
  { name: "Client", jsonId: null },
  { name: "Project Ref", jsonId: null },
  { name: "Client PO", jsonId: null },
  { name: "KAM", jsonId: null },
  { name: "Due Date Notes", jsonId: null },
  { name: "Name", jsonId: null },
  { name: "Price", jsonId: null },
  { name: "Pricing Status", jsonId: null },
  { name: "Invoicing Status", jsonId: null },
  { name: "Invoice Notes", jsonId: null },
  { name: "Paid Amount", jsonId: null },
  { name: "Category", jsonId: null },
  { name: "Parent Category", jsonId: null },
  { name: "Item Count", jsonId: null },
  { name: "Product Code", jsonId: null },
  { name: "Specifications i flag", jsonId: null },
  { name: "RRHS Stream", jsonId: null },
  { name: "Repeat Reference id", jsonId: null },
  { name: "Sales Stream name", jsonId: null },
  { name: "Cluster Name", jsonId: null },
  { name: "Cluster URL", jsonId: null },
  { name: "export_to_public_website", jsonId: null },
  { name: "name_for_public_website", jsonId: null },
  { name: "Routing", jsonId: 34 },
  { name: "Ex VAT RRP", jsonId: 230 },
  { name: "Dimensions", jsonId: 3 },
  { name: "Mattress setting", jsonId: 36 },
  { name: "COM 1", jsonId: 1 },
  { name: "COM 2", jsonId: 2 },
  { name: "COM 3", jsonId: 14 },
  { name: "FR Interliner", jsonId: 74 },
  { name: "Hinges", jsonId: 9 },
  { name: "Stud spec", jsonId: 16 },
  { name: "Upholstery free text", jsonId: 267 },
  { name: "Runners", jsonId: 10 },
  { name: "Stitching spec", jsonId: 37 },
  { name: "Seat Upholstery Build", jsonId: 11 },
  { name: "Swivel Mechs", jsonId: 232 },
  { name: "Back Upholstery Build", jsonId: 12 },
  { name: "COM Hardware", jsonId: 8 },
  { name: "Arm Upholstery Build", jsonId: 13 },
  { name: "Back Cushion Build", jsonId: 25 },
  { name: "Main timber finish", jsonId: 4 },
  { name: "Timber Finish 2", jsonId: 31 },
  { name: "Timber Finish 3", jsonId: 143 },
  { name: "Main metal finish", jsonId: 5 },
  { name: "Metal Finish 2", jsonId: 35 },
  { name: "Glass & Mirror Spec", jsonId: 15 },
  { name: "Floor type", jsonId: 39 },
  { name: "Stone ", jsonId: 147 },
  { name: "Skirting", jsonId: 72 },
  { name: "Wall build", jsonId: 73 },
  { name: "Outdoor", jsonId: 130 },
  { name: "Access - Select option", jsonId: 6 },
  { name: "Site Info - survey + dry fit", jsonId: 7 },
  { name: "Assy guide required", jsonId: 191 },
  { name: "Blue Label Stock?", jsonId: 186 },
  { name: "Dimensions checked", jsonId: 189 },
  { name: "BW Supplied Hardware", jsonId: 75 },
  { name: "Drawer liner", jsonId: 190 },
  { name: "BOM 1", jsonId: 110 },
  { name: "BOM 2", jsonId: 111 },
  { name: "BOM 3", jsonId: 112 },
  { name: "BOM Hardware 1", jsonId: 228 },
  { name: "Finishing - Colour of sample", jsonId: 21 },
  { name: "Upholstery pictures & Wash-up", jsonId: 187 },
  { name: "BOM Hardware 2", jsonId: 229 },
  { name: "Bed - 4 Poster", jsonId: 137 },
  { name: "Bed - Fitted Headboard", jsonId: 138 },
  { name: "Bed - Underbed storage", jsonId: 139 },
  { name: "Bed - Headboard only", jsonId: 140 },
  { name: "BL Pictures Job", jsonId: 188 },
  { name: "Job Budget", jsonId: 195 },
  { name: "Blue Label Product Washed Up?", jsonId: 153 },
  { name: "Finishing Sheen", jsonId: 22 },
  { name: "Substrate", jsonId: 192 },
  { name: "Timber Cut", jsonId: 23 },
  { name: "Finishing Recipe", jsonId: 150 },
  { name: "Purchasing Notes", jsonId: 24 },
  { name: "Image cleaning", jsonId: 141 },
  { name: "Ready to Order", jsonId: 135 },
  { name: "Client Code", jsonId: 136 },
  { name: "BL Original Repeater", jsonId: 152 },
  { name: "Fitted", jsonId: 131 },
  { name: "Mechanism", jsonId: 132 },
  { name: "Hidden Notes", jsonId: 234 },
  { name: "Fabric requirement", jsonId: 142 },
  { name: "Style", jsonId: 114 },
  { name: "Arm style", jsonId: 115 },
  { name: "Seat style", jsonId: 116 },
  { name: "Back style", jsonId: 117 },
  { name: "Upholstery detail", jsonId: 118 },
  { name: "Legs / Plinth", jsonId: 119 },
  { name: "Show materials", jsonId: 133 },
  { name: "Shape", jsonId: 120 },
  { name: "Main material", jsonId: 121 },
  { name: "Secondary material", jsonId: 122 },
  { name: "Base", jsonId: 123 },
  { name: "Detailing", jsonId: 125 },
  { name: "Doors", jsonId: 124 },
  { name: "Has Drawers", jsonId: 134 },
];

/** The block this app fills: the 56 spec fields at AF-CI. */
export const SPEC_FIELD_COLUMNS = BWS_EXPORT_COLUMNS.slice(31, 87);

/**
 * The job-metadata columns this app can honestly fill, addressed BY NAME.
 *
 * They are in the A-AE block, which carries NO json ids — row 2 of the export
 * is blank for all 31 of them. An earlier version of this file matched them by
 * id anyway, and since ids 9, 10, 14 and 22 all exist further along the row,
 * the client's name was written into `Hinges` and the item description into
 * `COM 3`. Every value landed in a real column, so the file looked correct and
 * a test that also matched by id agreed with it. Address a column by the one
 * thing it actually has.
 */
export const CLIENT_COLUMN_NAME = "Client";
export const PROJECT_REF_COLUMN_NAME = "Project Ref";
export const NAME_COLUMN_NAME = "Name";
export const ITEM_COUNT_COLUMN_NAME = "Item Count";

/** These two DO have ids: 'Client Code' is in the CJ-DE block, Dimensions in AF-CI. */
export const CLIENT_CODE_JSON_ID = 136;
export const DIMENSIONS_JSON_ID = 3;

// ---- what a row is composed from -------------------------------------------

/**
 * Bumped by hand when composeRowCells changes in a way that alters its output.
 *
 * Stored on every version, so a reader can tell a real edit from a rule
 * change: two versions that differ only in composer_version were composed
 * under different rules, and the difference between their stored cells is not
 * something anybody did to the record.
 */
export const COMPOSER_VERSION = 1;

export type ExportRecord = {
  id: string;
  recordNo: number;
  label: string;
  itemDescription: string;
  /** `A` on a fabric split, null otherwise. See the Name column below. */
  variantLabel?: string | null;
  /**
   * The one qualifier a person typed about the dimension cell (0034):
   * "1250 L-shaped return". Optional for the same reason `variantLabel` is —
   * a fixture composing a row need not know about it — and `loadRecordAtoms`
   * always sets it, so every record the app loads carries the real value.
   */
  dimensionNote?: string | null;
  qty: number | null;
  area: string | null;
  runName: string;
  boqCodes: string[];
  /**
   * 0039: the bill line's `record_no` and this configuration's number under
   * it. Both null on a bill line. Optional for the reason `variantLabel` is;
   * what they are FOR is `compareRecordOrder`, which lists 12.1 … 12.5 under
   * line 12 in every file rather than at the end.
   */
  parentRecordNo?: number | null;
  variantOrdinal?: number | null;
};

export type ExportAttribute = {
  /** The row's own id. A version diff keys on it, so a value edited in place is one change and not a delete plus an add. */
  id: string;
  recordId: string;
  attrGroup: AttributeGroup;
  label: string;
  value: string | null;
  unit: AttributeUnit | null;
  /** Where on the item it goes: "Main body & self pipe". The second line of this statement (0029). */
  qualifier: string | null;
  /** One of the five, on a dimension and nowhere else — 0011 enforces the pairing. */
  dimensionSlot: DimensionSlot | null;
  materialCode: string | null;
  /**
   * The library entry this attribute's code resolves to, when it is linked.
   *
   * THE LIBRARY IS THE TRUTH AND THE ATTRIBUTE IS THE EVIDENCE: `value` stays
   * exactly what the drawing said about this item, so it can be re-checked
   * against its page, and the CELL renders the finish's current definition.
   * Correcting CH-01.1 once therefore corrects every item carrying it — which
   * is the only correction mechanism there is, the pilot's finishes schedule
   * being confirmed absent.
   */
  finish: Finish | null;
  specFieldJsonId: number | null;
  state: AttributeState;
  sortOrder: number;
  sourceFilename: string | null;
  sourcePage: number | null;
};

/** A confirmed cheat-sheet answer that maps to a BWS field. */
export type ExportAnswer = {
  recordId: string;
  specFieldJsonId: number;
  value: string | null;
  /** The placement promoted with the value (0029). Null for a composed cell. */
  qualifier: string | null;
};

export type ExportScope = {
  projectName: string;
  client: string | null;
  runName: string | null;
  records: ExportRecord[];
  attributes: ExportAttribute[];
  answers: ExportAnswer[];
};

/**
 * A whole-word TBC anywhere in a value, however the page punctuated it.
 *
 * Word-bounded on purpose: a product code ending `-TBC1` is a code, and a cell
 * that treated it as the client's "not decided" marker would silently stop
 * marking a genuinely unsettled value.
 */
/**
 * How a spec value's QUALIFIER — its placement on the item — reaches the file.
 *
 * Matthew, 2026-09-17: "the top line as the spec and the return line as the
 * qualifier ... I don't think BWS currently captures that on the export /
 * import but i can get Tim to build the import to suit."
 *
 * Until that importer exists and somebody has SEEN its shape, the qualifier
 * goes inline after a hyphen, which is exactly what his own quote sheet writes
 * ("...30% sheen - Recessed plinth"). Emitting a newline into a BWS cell on the
 * strength of a sentence in an email would be guessing at a file format, in the
 * one file where a wrong guess overwrites rather than fails.
 *
 * A CONSTANT, not an environment variable and not an in-app toggle: house
 * conventions §8 puts integration enablement in deployment configuration, and
 * this is a change to the most dangerous file in the product. Flipping it is a
 * deliberate commit, and `tests/lib/bws-export.test.ts` asserts no cell
 * contains a newline, so the flip means watching that test fail on purpose and
 * running a fresh check sheet.
 *
 * His file mixes an ASCII hyphen and an en dash. We emit one, always, and
 * parse neither.
 */
export const EXPORT_QUALIFIER_MODE: "inline" | "second_line" = "inline";

/** The one separator. */
const QUALIFIER_SEPARATOR = " - ";

/** A value and its placement, joined the way this export writes them. */
export function joinQualifier(value: string, qualifier: string | null): string {
  const placement = qualifier?.trim();
  if (!placement) return value;
  if (!value) return placement;
  return EXPORT_QUALIFIER_MODE === "inline"
    ? `${value}${QUALIFIER_SEPARATOR}${placement}`
    : `${value}\n${placement}`;
}

const MENTIONS_TBC = /(?:^|[^A-Za-z0-9])T\.?B\.?C\.?(?:$|[^A-Za-z0-9])/i;

/**
 * How a TBC observation reads in a BWS cell.
 *
 * `TBC` must survive the export as itself. A blank cell says "nobody has looked
 * at this"; TBC says "somebody asked and the client has not decided", and those
 * two produce different actions on the shop floor.
 *
 * THE MARKER IS ADDED ONCE, NOT ADDED AGAIN.
 *
 * This appended " TBC" unconditionally, and the Panther pack writes the word
 * itself: a COM 1 field reading `TBC – Yarn Collective Tessarae YC04158 - 01`
 * exported as that plus ` TBC`, and an attribute whose whole value is `TBC`
 * exported as `TBC TBC`. Both read as a rendering fault in the one file M8 is
 * judged on, and a reviewer who finds a fault like that in a cell they can
 * check stops trusting the cells they cannot.
 *
 * The two tempting fixes are the actual trap, and neither is taken here:
 *
 *   * Stripping the word out of the value EDITS THE CLIENT'S WORDING. The
 *     value is what a document said, kept verbatim so it can be re-checked
 *     against its page. `TBC – Yarn Collective…` is the designer naming a
 *     fabric they have not confirmed, and the dash, the order and the wording
 *     are theirs.
 *   * Emitting only the state's marker and dropping the rest LOSES THE
 *     STATEMENT — the reader would see `TBC` where the page named a candidate
 *     fabric.
 *
 * So the value is never touched, and the marker is appended only when the cell
 * would otherwise not carry one. The test is "does a reader of this cell
 * already see TBC", which is why it matches ANYWHERE in the value rather than
 * only at an end. `parseDimensionFigure` in `@/lib/dimensions` deliberately
 * asks a NARROWER question — leading or trailing only — because there the
 * position decides whether the string is a figure at all; nothing is parsed
 * here.
 *
 * A `tbc` attribute with no value at all is still `TBC`: that is the state
 * saying a question was asked, with nothing yet to say about the answer.
 */
export function renderAttributeValue(attribute: {
  value: string | null;
  unit: AttributeUnit | null;
  state: AttributeState;
  finish?: Finish | null;
  qualifier?: string | null;
}): string {
  // A LINKED FINISH RENDERS AS THE LIBRARY SAYS IT IS, not as this page wrote
  // it. One composer, called here, by the record screen and by
  // promote-answers — see src/lib/finishes.ts for why all three must agree.
  const finish = attribute.finish ?? null;
  // An INTERNAL finish composes to its description alone (it has no code the
  // file may carry), so where somebody has cleared that description there is
  // nothing to emit — and this page's own words are what the cell said before
  // the library could hold this fabric at all. Falls back to them rather than
  // shipping a blank.
  const value = (finish ? composeFinishCell(finish) : "") || (attribute.value?.trim() ?? "");
  const state = finish ? combineFinishState(attribute.state, finish) : attribute.state;
  const withUnit = value && attribute.unit ? `${value}${attribute.unit}` : value;
  // THE QUALIFIER GOES ON LAST, AFTER the TBC marker. A placement is not part
  // of the statement MENTIONS_TBC is asking about — "Main body and self pipe"
  // can never carry the client's not-decided marker — so folding it in first
  // would let a placement suppress a TBC that belongs on the value.
  const marked =
    state !== "tbc" ? withUnit : !withUnit ? "TBC" : MENTIONS_TBC.test(withUnit) ? withUnit : `${withUnit} TBC`;
  return joinQualifier(marked, attribute.qualifier ?? null);
}

/**
 * The same rendering for a CHECKLIST answer.
 *
 * `composeRowCells` used to put `answer.value.trim()` straight into the cell, a
 * bare string with no composer behind it. The moment an answer could carry a
 * qualifier that became a way for a placement typed on the record screen to
 * vanish from the file while the screen went on showing it — the
 * `composeDimensionCell` rule, in a third place. One function, so it cannot.
 */
export function renderAnswerValue(answer: { value: string | null; qualifier?: string | null }): string {
  return joinQualifier(answer.value?.trim() ?? "", answer.qualifier ?? null);
}

/**
 * "W1900 x D790 x H720 x SH440mm" — the five slots, in Matthew's order.
 *
 * This used to emit "Width 190cm; Depth 79cm; Height 72cm": every label a
 * document printed, in review order, in whatever unit the page was drawn in. On
 * the real Panther pack that produced a cell nobody could read, because one
 * armchair page carries 44 figures and the sheets label five more of them
 * "WIDTH SEAT", "DEPTH BACK", "ARM HEIGHT".
 *
 * The composition itself lives in `@/lib/dimensions` because the record screen
 * and the drawings review preview the same string, and a second implementation
 * is how a screen starts promising what the file does not deliver. This is the
 * adapter: attributes in, cell out. Its `problems` are surfaced on those
 * screens, not in the cell's own column.
 */
export function composeDimensions(attributes: ExportAttribute[], note?: string | null): string {
  return composeDimensionCell(
    attributes
      .filter((attribute) => attribute.attrGroup === "dimension" && attribute.dimensionSlot !== null)
      .map((attribute) => ({
        slot: attribute.dimensionSlot as DimensionSlot,
        value: attribute.value,
        unit: attribute.unit,
        state: attribute.state,
        sortOrder: attribute.sortOrder,
      })),
    // The record's own typed qualifier (0034). It is passed THROUGH to the
    // composer rather than appended here, so the file, the quote, the costing
    // sheet's Tags and the record screen all write the bracket the same way.
    note ?? null,
  ).text;
}

/**
 * Where a cell's value came from.
 *
 * The export itself does not carry this — a BWS import wants 109 cells, not a
 * provenance column. The CHECK SHEET does: "W1900 x D790 x H720mm" is only
 * re-checkable by somebody who knows which page to open, and a reviewer sent to
 * find that out by hand will check the easy cells and skim the rest.
 *
 * It is produced by the composer rather than re-derived beside it, for the same
 * reason there is one `composeDimensionCell`: a second copy of the precedence
 * rules is how a check sheet starts vouching for a value the file does not
 * actually hold.
 */
export type CellSource =
  | { kind: "empty" }
  /** A BWS-owned vocabulary this app does not know. Blank on purpose, not a gap. */
  | { kind: "bws" }
  | { kind: "project" }
  | { kind: "record" }
  | { kind: "attribute"; attribute: ExportAttribute }
  | { kind: "dimensions"; attributes: ExportAttribute[] }
  | { kind: "answer" };

export type ExportCell = {
  value: string;
  source: CellSource;
  /**
   * The placement half, apart from the value, so the CHECK SHEET can show a
   * reviewer which is which. The export itself only ever sees `value`, which
   * already has the qualifier joined in by `joinQualifier`.
   */
  qualifier: string | null;
};

/**
 * One record to one row of 109 cells, each with where it came from.
 *
 * Precedence for a spec field: an attribute the reviewer confirmed off a
 * document wins, then a confirmed cheat-sheet answer, then blank. An attribute
 * is a statement from a client document about this item; an answer is somebody
 * filling in a checklist, and where both exist the document is the one that can
 * be re-checked against a page.
 *
 * BWS-owned vocabularies (Category, Status, Lifecycle State, KAM, Routing) stay
 * BLANK. This app does not know their allowed values, and a guessed enum is
 * either rejected on import or accepted as a wrong classification. They are
 * marked `bws` rather than `empty` so a check sheet can say "blank on purpose"
 * where it would otherwise read as 25 unanswered questions per record.
 */
export function composeRowCells(
  scope: ExportScope,
  record: ExportRecord,
  attributes: ExportAttribute[],
  answers: ExportAnswer[],
): ExportCell[] {
  const mine = attributes.filter((attribute) => attribute.recordId === record.id);
  const byField = new Map<number, ExportAttribute>();
  for (const attribute of mine) {
    if (attribute.specFieldJsonId !== null && attribute.attrGroup !== "dimension" && !byField.has(attribute.specFieldJsonId)) {
      byField.set(attribute.specFieldJsonId, attribute);
    }
  }
  const answerByField = new Map<number, ExportAnswer>();
  for (const answer of answers) {
    if (answer.recordId === record.id && answer.value?.trim()) answerByField.set(answer.specFieldJsonId, answer);
  }

  const dimensionAttributes = mine.filter((attribute) => attribute.attrGroup === "dimension" && attribute.dimensionSlot !== null);
  const dimensions = composeDimensions(mine, record.dimensionNote ?? null);

  return BWS_EXPORT_COLUMNS.map((column): ExportCell => {
    // The id-less job-metadata block, by name.
    if (column.jsonId === null) {
      switch (column.name) {
        case CLIENT_COLUMN_NAME:
          return { value: scope.client ?? "", source: { kind: "project" }, qualifier: null };
        case PROJECT_REF_COLUMN_NAME:
          return { value: scope.projectName, source: { kind: "project" }, qualifier: null };
        case NAME_COLUMN_NAME:
          // THIS REPO'S JUDGEMENT, like the rest of the job columns. Two
          // variants of one bill line share the client's description exactly,
          // so a file carrying both would show BWS two identical `Armchair`
          // jobs against the same client code. The letter is appended to tell
          // them apart; confirm it against a real BWS import before anybody
          // relies on the file.
          return {
            value: record.variantLabel ? `${record.itemDescription} (${record.variantLabel})` : record.itemDescription,
            source: { kind: "record" },
            qualifier: null,
          };
        case ITEM_COUNT_COLUMN_NAME:
          return { value: record.qty === null ? "" : String(record.qty), source: { kind: "record" }, qualifier: null };
        default:
          // Every other job column is a BWS-owned vocabulary or a value only
          // BWS knows (Id, Job Number, Status, KAM, Lifecycle State). Blank is
          // the only honest answer; a guessed enum imports as a wrong
          // classification.
          return { value: "", source: { kind: "bws" }, qualifier: null };
      }
    }
    if (column.jsonId === CLIENT_CODE_JSON_ID)
      return { value: record.boqCodes.join(", "), source: { kind: "record" }, qualifier: null };
    if (column.jsonId === DIMENSIONS_JSON_ID) {
      return {
        value: dimensions,
        // The source stays what the FIGURES came from, and a typed note does
        // not change it: a note carries no run and no page, deliberately, and
        // naming a document beside it would be a false provenance rather than
        // a missing one. Where the note is all there is, the check sheet's
        // "Came from" is blank, which is the truth.
        source: dimensionAttributes.length ? { kind: "dimensions", attributes: dimensionAttributes } : { kind: "empty" },
        // A COMPOSED CELL HAS NO SINGLE PLACEMENT. Four slots off three pages
        // could carry four of 0029's placements; picking one would be the app
        // inventing a fact. What it CAN carry is the record's own dimension
        // note (0034) — ONE statement about the whole cell, typed by a person
        // — and the check sheet shows it here, apart from the figures, so a
        // reviewer reading the cell against a page can tell which half the
        // page actually said.
        qualifier: record.dimensionNote?.trim() || null,
      };
    }
    const attribute = byField.get(column.jsonId);
    if (attribute) {
      return {
        value: renderAttributeValue(attribute),
        source: { kind: "attribute", attribute },
        qualifier: attribute.qualifier ?? null,
      };
    }
    const answer = answerByField.get(column.jsonId);
    if (answer !== undefined) {
      return { value: renderAnswerValue(answer), source: { kind: "answer" }, qualifier: answer.qualifier ?? null };
    }
    return { value: "", source: { kind: "empty" }, qualifier: null };
  });
}

/** The 109 cells as the file holds them. One set of precedence rules, two views. */
export function composeRow(scope: ExportScope, record: ExportRecord, attributes: ExportAttribute[], answers: ExportAnswer[]): string[] {
  return composeRowCells(scope, record, attributes, answers).map((cell) => cell.value);
}

export type Workbook = {
  jobs: { headerNames: string[]; headerIds: string[]; rows: string[][] };
  specs: { header: string[]; rows: string[][] };
};

export const SPECS_SHEET_HEADER = [
  "Record",
  "Client code",
  "Phase",
  "Group",
  "Label",
  // The slot a dimension claims. Without it the long-form sheet cannot explain
  // why the Dimensions cell reads W1900 when this row says 190 — which is the
  // whole point of a sheet that exists to make a converted figure re-checkable
  // against its page.
  "Dimension",
  "Value",
  "Unit",
  "Client material code",
  "BWS field",
  "State",
  "Source document",
  "Page",
];

/**
 * The whole export.
 *
 * EVERY record in scope produces a row, including one with no attributes and no
 * answers. That is what "complete dataset" means: a record omitted because it
 * had nothing to say is a record whose BWS fields would be wiped on import.
 *
 * The second sheet lists every attribute long-form, because flattening 56
 * columns loses the ones that did not fit — the client's own material code, the
 * page a value came from, the second and third dimensions of a slot. A reviewer
 * comparing the export against a drawing needs those.
 */
export function composeWorkbook(scope: ExportScope): Workbook {
  const fieldNameById = new Map(BWS_EXPORT_COLUMNS.filter((c) => c.jsonId !== null).map((c) => [c.jsonId as number, c.name]));

  // BILL ORDER, each configuration under its line (0039): 12, 12.1 … 12.5,
  // 13. It changes NOTHING about what an import replaces — BWS keys a row by
  // its job, not by where it sits in the file, and every record in scope is
  // still here — it only puts 12.3 where somebody reading the file looks
  // for it, instead of after the last line on the bill.
  const rows = [...scope.records]
    .sort(compareRecordOrder)
    .map((record) => composeRow(scope, record, scope.attributes, scope.answers));

  const specs = scope.records
    .sort(compareRecordOrder)
    .flatMap((record) =>
      scope.attributes
        .filter((attribute) => attribute.recordId === record.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attribute) => [
          record.label,
          record.boqCodes.join(", "),
          record.runName,
          ATTRIBUTE_GROUP_LABELS[attribute.attrGroup],
          attribute.label,
          attribute.dimensionSlot === null ? "" : DIMENSION_SLOT_LABELS[attribute.dimensionSlot],
          attribute.value ?? "",
          attribute.unit ?? "",
          attribute.materialCode ?? "",
          attribute.specFieldJsonId === null ? "" : fieldNameById.get(attribute.specFieldJsonId) ?? "",
          attribute.state,
          attribute.sourceFilename ?? "",
          attribute.sourcePage === null ? "" : String(attribute.sourcePage),
        ]),
    );

  return {
    jobs: {
      headerNames: BWS_EXPORT_COLUMNS.map((column) => column.name),
      // Row 2 of the BWS export: json ids, blank for the job-metadata block.
      headerIds: BWS_EXPORT_COLUMNS.map((column) => (column.jsonId === null ? "" : String(column.jsonId))),
      rows,
    },
    specs: { header: SPECS_SHEET_HEADER, rows: specs },
  };
}

/** RFC 4180 with a UTF-8 BOM, which is what the BWS export itself is. */
export function toCsv(rows: string[][]): string {
  const escape = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return "﻿" + rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
}

/**
 * Allowlisted, so a client's project name cannot put a quote, a newline or a
 * path separator into a Content-Disposition header. Copied from the .eml route,
 * which learned it first.
 */
export function exportFilename(projectNumber: string, runName: string | null, extension: string): string {
  const safe = (raw: string) => raw.replace(/[^A-Za-z0-9 &-]/g, "").slice(0, 60).trim();
  const scope = runName ? ` - ${safe(runName)}` : "";
  return `${safe(projectNumber) || "export"}${scope} - BWS spec fields.${extension}`;
}
