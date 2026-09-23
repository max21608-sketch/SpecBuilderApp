// What each column of a bill can MEAN, and the rules for a person's mapping.
//
// A leaf, and pure, so the review screen's Columns panel and the server read
// the same list and the same validation: a panel that allowed a mapping the
// route then refused would be a reviewer's afternoon spent on a form that
// cannot be submitted, and a route that allowed one the panel refused would be
// a check that lives only in the browser.
//
// ============================================================================
// A ROLE IS WHAT THE READER DOES WITH A COLUMN, NOT WHAT THE BILL CALLS IT.
//
// The bill's own heading is kept beside every role (`BoqColumnRef.heading`),
// because "Spec Code" read as the code is a decision somebody took, and the
// screen has to be able to say which heading it was taken about. The first
// eight roles are the ones `COLUMNS` always had; `subArea`, `sourceLine` and
// `notes` arrived with the Aman pricing document (2026-09-23), whose bill
// carries a Sub-Area beside its Area, its own Line number and a Notes column
// that says "OPTION 1" where the same code appears twice.
//
// `ignore` is explicit. Prices, costs and pictures are never read into this
// app — there is no pricing anywhere in it — and "a person said this column is
// not read" is a different statement from "nobody has said what it is".
// ============================================================================

/** The roles a column can be READ as. Order is the panel's option order. */
export const BOQ_READ_ROLES = [
  "code",
  "itemDescription",
  "qty",
  "qtyUnit",
  "area",
  "subArea",
  "boqCategory",
  "designer",
  "productReference",
  "sourceLine",
  "notes",
] as const;

export type BoqReadRole = (typeof BOQ_READ_ROLES)[number];

/**
 * Every role, including the deliberate "not read". The CHECK on
 * `boq_column_aliases.role` (0040) holds exactly this list, and
 * `tests/db/vocabulary-sync.test.ts` asserts the two agree.
 */
export const BOQ_ROLES = [...BOQ_READ_ROLES, "ignore"] as const;

export type BoqRole = (typeof BOQ_ROLES)[number];

export function isBoqReadRole(value: unknown): value is BoqReadRole {
  return typeof value === "string" && (BOQ_READ_ROLES as readonly string[]).includes(value);
}

export function isBoqRole(value: unknown): value is BoqRole {
  return typeof value === "string" && (BOQ_ROLES as readonly string[]).includes(value);
}

/** The words a reviewer reads in the role select. */
export const BOQ_ROLE_LABELS: Record<BoqRole, string> = {
  code: "Code (client ref)",
  itemDescription: "Item description",
  qty: "Quantity",
  qtyUnit: "Unit",
  area: "Area",
  subArea: "Sub-area",
  boqCategory: "Bill's own category",
  designer: "Designer",
  productReference: "Product reference",
  sourceLine: "Line number",
  notes: "Notes",
  ignore: "Not read",
};

/** One column the reader took a role from: where it is, and what it was headed. */
export type BoqColumnRef = { index: number; heading: string };

/** Where a sheet's columns came from, which the panel badges each select with. */
export const BOQ_MAPPING_SOURCES = ["synonym", "layout", "person", "model"] as const;
export type BoqMappingSource = (typeof BOQ_MAPPING_SOURCES)[number];

export const BOQ_MAPPING_SOURCE_LABELS: Record<BoqMappingSource, string> = {
  synonym: "known heading",
  layout: "saved layout",
  person: "set by a person",
  model: "read by the model",
};

/**
 * The fold every heading is compared under: case and whitespace, and nothing
 * else. A heading that differs by punctuation is a different heading — the
 * `normaliseFinishCode` rule, because a fold clever enough to merge two
 * spellings is clever enough to merge two columns a client kept apart.
 */
export function foldHeading(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * THE AREA A RECORD CARRIES, when a bill gives an Area AND a Sub-Area.
 *
 * `Guest Suites / Corridor`, verbatim, in the bill's own words. This is a
 * DEFAULT awaiting Max (plan question 1: compose it, or keep Sub-Area as its
 * own field), and it is behind this one function so that answer is a one-line
 * change rather than a hunt through the confirm, the reconcile and the screen.
 * Either half alone stands alone; neither is invented.
 */
export function composeBoqArea(area: string | null | undefined, subArea: string | null | undefined): string | null {
  const a = area?.trim() || null;
  const b = subArea?.trim() || null;
  if (a && b) return `${a} / ${b}`;
  return a ?? b;
}

/**
 * Why a person's column mapping cannot be read, in words, or null when it can.
 *
 * `columns` is role → column index; a column no role names is not read. The
 * rules are the smallest set that makes the read meaningful:
 *
 *   * ONE COLUMN PER ROLE is structural (a map has one value per key); ONE ROLE
 *     PER COLUMN is checked, because "Spec Code" read as both the code and the
 *     description would put the same text in two places and neither would be
 *     wrong-looking.
 *   * A CODE OR A DESCRIPTION. A line with neither is a spacer, so a mapping
 *     with neither column would read every row as one. The synonym reader asks
 *     for BOTH before it calls a row a header — that is a guard against
 *     mistaking a title row for a header, and a person pointing at a row is
 *     not that risk.
 *   * The columns exist, and the header row is on the sheet.
 */
export function columnMappingProblem(input: {
  columns: Partial<Record<BoqReadRole, number>>;
  headerRow: number;
  headerRows: number;
  rowCount: number;
  width: number;
}): string | null {
  const { columns, headerRow, headerRows, rowCount, width } = input;
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > rowCount) {
    return "Choose the row the column headings are on.";
  }
  if (headerRows !== 1 && headerRows !== 2) return "A header is one row, or two read as one.";
  if (headerRows === 2 && headerRow < 2) return "A two-row header needs a row above the one chosen.";

  const byColumn = new Map<number, BoqReadRole[]>();
  for (const [role, index] of Object.entries(columns) as [BoqReadRole, number][]) {
    if (!isBoqReadRole(role)) return `“${String(role)}” is not a column role.`;
    if (!Number.isInteger(index) || index < 0 || index >= width) {
      return `The ${BOQ_ROLE_LABELS[role].toLowerCase()} column is not on this sheet.`;
    }
    byColumn.set(index, [...(byColumn.get(index) ?? []), role]);
  }
  for (const [index, roles] of byColumn) {
    if (roles.length > 1) {
      return (
        `Column ${columnLetter(index)} is set as ${roles.map((role) => BOQ_ROLE_LABELS[role].toLowerCase()).join(" and ")}. ` +
        "A column can be read as one thing only."
      );
    }
  }
  if (columns.code === undefined && columns.itemDescription === undefined) {
    return "Say which column holds the code or the item description — a bill line needs at least one of them.";
  }
  return null;
}

/** "A", "B", … "Z", "AA" — the letter a person sees at the top of the sheet. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * The panel's selects — one role per COLUMN — turned into the route's shape,
 * one column per ROLE, or the sentence saying why they cannot be.
 *
 * The panel asks column by column because that is how a person reads a sheet;
 * the route takes role → column because that is what a reading needs. Two
 * columns set to the same role is the one mistake the first shape allows and
 * the second cannot express, so it is caught here, in words, before anything
 * is sent. `ignore` and an unset select both mean "not read".
 */
export function columnsFromSelections(
  selections: readonly (BoqRole | null | undefined)[],
): { columns: Partial<Record<BoqReadRole, number>>; problem: string | null } {
  const columns: Partial<Record<BoqReadRole, number>> = {};
  const seen = new Map<BoqReadRole, number[]>();
  selections.forEach((role, index) => {
    if (!role || role === "ignore") return;
    seen.set(role, [...(seen.get(role) ?? []), index]);
  });
  for (const [role, indexes] of seen) {
    if (indexes.length > 1) {
      return {
        columns: {},
        problem:
          `Columns ${indexes.map(columnLetter).join(" and ")} are both set as ${BOQ_ROLE_LABELS[role].toLowerCase()}. ` +
          "Each role is read from one column.",
      };
    }
    columns[role] = indexes[0] as number;
  }
  return { columns, problem: null };
}
