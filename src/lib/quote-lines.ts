// The quote CSV: one line per item, with the specification written out.
//
// ============================================================================
// EIGHT OF TWELVE COLUMNS, AND THE OTHER FOUR SAY WHY THEY ARE BLANK.
//
// Matthew's `Quote output example.xlsx` has Type, Item count, Description,
// Specification, Internal notes, Area or room, Net price each, Net price,
// Product code, Product code id, UUID and Image url.
//
// This app can fill eight. It CANNOT fill:
//
//   Net price each / Net price   There is no pricing anywhere in this app --
//                                no rate, no labour model, no material cost,
//                                no supplier price. A generated number would
//                                be the worst version of a wrong value that
//                                looks right, and it would be the first figure
//                                in this product that nothing downstream could
//                                question.
//   UUID                         BWS's own.
//   Image url                    An item picture is a private Vercel Blob.
//                                BWS cannot fetch it, and a link that 404s in
//                                a quote is worse than a blank.
//
// AND IT CANNOT GENERATE THE COMPANION ROWS. Nineteen of the real file's 57
// lines are `.BW-INTERLINER Billing ONLY`, `BW-STONE-INVOICE-PURPOSES`,
// mattress SKUs and `Delivery_Charge`. The interliner line's `Item count` is
// the fabric METREAGE, and composeFinishCell deliberately does not hold
// metreage -- "inventing a number for a cell somebody orders against would be
// worse than leaving the gap visible". Those stay a person's job, and this
// file says so rather than emitting a row somebody prices off.
//
// ---- THE SPECIFICATION BLOCK USES THE EXISTING COMPOSERS ----------------
//
// `composeDimensionCell` and `composeFinishCell` compose the DIMS and finish
// lines, the same functions the 109-column export calls. A second dimension
// composer is the one thing that design exists to prevent, and a quote that
// said `W1900 x D790` where the BWS file said something else would be found by
// a client rather than by us.
//
// The labels are normalised. His own file writes `COM1`, `COM 1` and `COM` for
// one field and `TIMBER1` / `TIMBER 1` for another -- written by hand, over
// years. We emit one spelling per field, from one constant.
// ============================================================================
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import { renderAttributeValue, type ExportAttribute, type ExportRecord, type ExportScope } from "@/lib/bws-export";
import type { AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";

/** The column order of Matthew's own file, unchanged. */
export const QUOTE_HEADER = [
  "Type",
  "Item count",
  "Description",
  "Specification",
  "Internal notes",
  "Area or room",
  "Net price each",
  "Net price",
  "Product code",
  "Product code id",
  "UUID",
  "Image url",
];

/** Every line in his example is `J`. */
const TYPE = "J";

/**
 * The labelled lines of the Specification block, in his own order, each with
 * the BWS field ids that feed it.
 *
 * Read off the real file: DIMS appears 39 times, ACCESS 38, GLIDES 37, TIMBER
 * 26, FR INTERLINER 20, COM 18, METAL 12, STONE 7, DRAWER LINER 6.
 */
const SPEC_LINES: { label: string; jsonIds: number[] }[] = [
  { label: "COM", jsonIds: [1, 2, 14] },
  { label: "FR INTERLINER", jsonIds: [74] },
  { label: "TIMBER", jsonIds: [4, 31, 143] },
  { label: "METAL", jsonIds: [5, 35] },
  { label: "STONE", jsonIds: [147] },
  { label: "GLASS", jsonIds: [15] },
  { label: "DRAWER LINER", jsonIds: [190] },
  { label: "STUD", jsonIds: [16] },
  { label: "STITCHING", jsonIds: [37] },
  { label: "ACCESS", jsonIds: [6] },
];

const DIMENSIONS_JSON_ID = 3;

export type QuoteBoilerplate = { matrixCode: string; variant: string; code: string; bwsId: number };

/**
 * Which boilerplate a record is priced against.
 *
 * Matthew's rule, row 1 of his matrix, verbatim: "if MF1 or MF2 is populated
 * -> with-Metalwork variant; otherwise Simple". `matrixCode` is null for a
 * category his matrix does not cover -- every cabinetry sheet, today -- and
 * then there is no code, which is the honest blank rather than a guess.
 *
 * "Populated" is read as A VALUE THAT IS NOT ITSELF A NON-ANSWER: a metal
 * finish recorded as `TBC` or `None` does not make an item metalwork. That is
 * this repo's reading and question 6 for him.
 */
export function pickBoilerplate(
  matrixCodes: readonly string[],
  hasMetalFinish: boolean,
  register: QuoteBoilerplate[],
): QuoteBoilerplate | null {
  // ---- AMBIGUOUS MAPS NOTHING ---------------------------------------------
  //
  // Found in the browser against the real Panther run, 2026-09-17: our cheat
  // sheet `armchairs-benches-stools-sofas` is ONE sheet receiving three of
  // Matthew's codes (S, A and B), so a SOFA on it was handed the ARMCHAIR
  // boilerplate — 929 instead of 847 — because the query took the first code
  // alphabetically. That is the app choosing silently between three prices.
  //
  // So more than one code derives NOTHING, exactly as `findRecordsByRef` offers
  // candidates and picks none, and as a BOQ revision pairs nothing when a code
  // is on two records. A blank product code is a visible gap; a wrong one is a
  // quote priced against the wrong template.
  //
  // It also makes question 2 to Matthew concrete: while our seating sheets are
  // merged, three of his nine categories cannot derive a code at all.
  const unique = [...new Set(matrixCodes)];
  if (unique.length !== 1) return null;
  const variant = hasMetalFinish ? "metalwork" : "simple";
  return register.find((row) => row.matrixCode === unique[0] && row.variant === variant) ?? null;
}

const NON_ANSWERS = new Set(["", "tbc", "none", "n/a", "na", "not required", "-"]);

/** Does this record carry a metal finish that is actually a finish? */
export function hasMetalFinish(attributes: ExportAttribute[]): boolean {
  return attributes.some((attribute) => {
    if (attribute.specFieldJsonId !== 5 && attribute.specFieldJsonId !== 35) return false;
    const value = (attribute.value ?? "").trim().toLowerCase();
    return !NON_ANSWERS.has(value);
  });
}

function dimensionLine(attributes: ExportAttribute[]): string | null {
  const rows: DimensionRow[] = attributes
    .filter((attribute) => attribute.attrGroup === "dimension" && attribute.dimensionSlot !== null)
    .map((attribute) => ({
      slot: attribute.dimensionSlot as DimensionSlot,
      value: attribute.value,
      unit: attribute.unit as AttributeUnit | null,
      state: attribute.state,
      sortOrder: attribute.sortOrder,
    }));
  if (rows.length === 0) return null;
  const cell = composeDimensionCell(rows);
  return cell.text.trim() ? `DIMS: ${cell.text}` : null;
}

/**
 * The Specification block for one record.
 *
 * Opens with the record's own prose (0028's `spec_description`), because his
 * example does — "Curved sofa with fixed back and seat / Recessed timber
 * plinth" — then the labelled lines, then his standing caveat.
 */
export function composeSpecification(
  record: ExportRecord & { specDescription?: string | null },
  attributes: ExportAttribute[],
  answers: { specFieldJsonId: number; value: string | null; qualifier: string | null }[],
): string {
  const lines: string[] = ["As per details supplied"];

  const prose = record.specDescription?.trim();
  if (prose) lines.push(...prose.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

  const dims = dimensionLine(attributes);
  if (dims) lines.push(dims);

  const byField = new Map<number, ExportAttribute>();
  for (const attribute of attributes) {
    if (attribute.specFieldJsonId !== null && attribute.attrGroup !== "dimension" && !byField.has(attribute.specFieldJsonId)) {
      byField.set(attribute.specFieldJsonId, attribute);
    }
  }
  const answerByField = new Map(answers.map((answer) => [answer.specFieldJsonId, answer]));

  for (const { label, jsonIds } of SPEC_LINES) {
    // Several slots share one label — COM 1, 2 and 3 are all "COM" in his
    // file — and each one that holds a value gets its own line, numbered only
    // where there is more than one, exactly as he writes it.
    const values: string[] = [];
    for (const jsonId of jsonIds) {
      if (jsonId === DIMENSIONS_JSON_ID) continue;
      const attribute = byField.get(jsonId);
      if (attribute) {
        const rendered = renderAttributeValue(attribute);
        if (rendered.trim()) values.push(rendered);
        continue;
      }
      const answer = answerByField.get(jsonId);
      const written = answer?.value?.trim();
      if (written) {
        const placement = answer?.qualifier?.trim();
        values.push(placement ? `${written} - ${placement}` : written);
      }
    }
    if (values.length === 1) lines.push(`${label}: ${values[0]}`);
    else values.forEach((value, index) => lines.push(`${label} ${index + 1}: ${value}`));
  }

  // His own closing line, on every bespoke item in the file.
  lines.push("*Subject to price increase where furniture is to be made in component form*");
  return lines.join("\n");
}

export type QuoteSheet = { header: string[]; rows: string[][]; unfillable: string[] };

/**
 * One row per record in scope, in the same order the export ships them.
 *
 * `unfillable` is returned rather than hidden: the screen that offers this file
 * has to say which four columns are blank and why, or somebody prices off a
 * row believing the gaps are values nobody happened to fill in.
 */
export function composeQuoteSheet(
  scope: ExportScope & {
    records: (ExportRecord & {
      specDescription?: string | null;
      internalNotes?: string | null;
      /** Every one of Matthew's categories this record's cheat sheet maps to. More than one derives nothing. */
      matrixCodes?: readonly string[];
    })[];
  },
  register: QuoteBoilerplate[],
): QuoteSheet {
  const rows: string[][] = [];

  for (const record of [...scope.records].sort((a, b) => a.recordNo - b.recordNo)) {
    const mine = scope.attributes.filter((attribute) => attribute.recordId === record.id);
    const answers = scope.answers
      .filter((answer) => answer.recordId === record.id)
      .map((answer) => ({
        specFieldJsonId: answer.specFieldJsonId,
        value: answer.value,
        qualifier: answer.qualifier,
      }));
    const boilerplate = pickBoilerplate(record.matrixCodes ?? [], hasMetalFinish(mine), register);

    rows.push([
      TYPE,
      record.qty === null ? "" : String(record.qty),
      record.variantLabel ? `${record.itemDescription} (${record.variantLabel})` : record.itemDescription,
      composeSpecification(record, mine, answers),
      record.internalNotes?.trim() ?? "",
      record.area ?? "",
      "", // Net price each — no pricing in this app.
      "", // Net price — likewise.
      boilerplate?.code ?? "",
      boilerplate ? String(boilerplate.bwsId) : "",
      "", // UUID — BWS's own.
      "", // Image url — item pictures are a private blob store.
    ]);
  }

  return {
    header: QUOTE_HEADER,
    rows,
    unfillable: [
      "Net price each and Net price: this app holds no pricing at all — no rate, no labour, no material cost.",
      "UUID: BWS's own.",
      "Image url: item pictures are private and BWS cannot fetch them.",
      "A product code is left blank where the item's category maps to more than one of Matthew's nine — our merged seating sheets do — because picking one of three would price it against the wrong template.",
      "The companion billing lines — interliner, stone, mattresses, delivery — cannot be generated: the interliner quantity is the fabric metreage, which this app deliberately does not hold.",
    ],
  };
}
