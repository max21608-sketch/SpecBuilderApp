// A part the survey could not call a bill or a schedule, tried by the bill
// reader for nothing (open intake, Stage 1 — Stage 0's finding 2).
//
// ============================================================================
// THE TRAP: SETTLING "BILL OR SCHEDULE?" WITH MORE PROMPT.
//
// Every Ronnie Scott's procurement schedule is held by the survey between a
// bill of quantities and an FF&E schedule, on every run, and a paragraph
// telling the model "a procurement schedule is a bill" moved none of them and
// cost two other packs parts (the plan, "Stage 0, first measurement"). What
// the model cannot weigh, code can see for nothing: whether the part's cells
// read as a bill's table — a code or description column AND a quantity column
// — through the SAME reader that would read it if it were filed as one.
//
// IT INFORMS, IT NEVER FILES. A table with a quantity column is also what an
// FF&E schedule with a Qty column looks like, and filing that as a bill would
// stage a project's worth of wrong records. So a part that reads as a bill
// stays HELD: its box is filled with Bill of quantities and its evidence says
// what code found, so the person's one press is informed rather than a choice
// from nothing. Widening `isBillOrScheduleDoubt` to "any doubt", or letting a
// good reading clear the hold, are the two changes this file exists to refuse.
// ============================================================================
import { foldHeading } from "@/lib/boq-roles";
import { REFERENCE_BOQ_ALIASES, type BoqAlias, type BoqParseResult } from "@/lib/boq-import";
import type { PdfBillRead } from "@/lib/pdf-bill";
import type { SurveyPart } from "@/lib/pack-survey-types";

/** What the bill reader found in one part. */
export type BillProbe = {
  lines: number;
  code: boolean;
  description: boolean;
  quantity: boolean;
};

/**
 * Is this part held between a bill and an FF&E schedule, either way round?
 * Only that pair: a doubt between a bill and a drawing set is not a table
 * question, and a CERTAIN answer is the model's to stand on.
 */
export function isBillOrScheduleDoubt(part: Pick<SurveyPart, "genre" | "certain" | "weighedAgainst" | "nothingToRead">): boolean {
  if (part.nothingToRead || part.certain) return false;
  const pair = new Set([part.genre, part.weighedAgainst]);
  return pair.size === 2 && pair.has("bill_of_quantities") && pair.has("ffe_schedule");
}

/**
 * The evidence a part that reads as a bill carries, or null where it does not
 * read as one: no lines, no quantity column, or neither a code nor a
 * description column. Code is named before description where both are found,
 * because the code is what a record is keyed by.
 */
export function billProbeEvidence(probe: BillProbe | null): string | null {
  if (!probe || probe.lines < 1 || !probe.quantity || !(probe.code || probe.description)) return null;
  const column = probe.code ? "code" : "description";
  return `Reads as a bill: ${probe.lines} line${probe.lines === 1 ? "" : "s"}; ${column} and quantity columns found.`;
}

/**
 * What a PDF part's text read as. The quantity column is the one the rows
 * were anchored on, so an `ok` read always has one; code and description are
 * the header's labels under the same headings the bill reader knows.
 */
export function probeOfPdfBill(read: PdfBillRead, aliases: readonly BoqAlias[] = REFERENCE_BOQ_ALIASES): BillProbe | null {
  if (!read.ok) return null;
  const terms = (role: BoqAlias["role"]) => new Set(aliases.filter((alias) => alias.role === role).map((alias) => foldHeading(alias.term)));
  const codes = terms("code");
  const descriptions = terms("itemDescription");
  const header = read.header.map(foldHeading);
  return {
    lines: read.rows.length,
    code: header.some((label) => codes.has(label)),
    description: header.some((label) => descriptions.has(label)),
    quantity: true,
  };
}

/**
 * What a workbook part read as: the sheets in it that the reader READ (not
 * left for a person to map, not set aside), their lines summed. A sheet
 * outside the part is staged `ignored` by `parseBoqSheets` and counts nothing.
 */
export function probeOfSheets(parsed: BoqParseResult): BillProbe | null {
  if (!parsed.ok) return null;
  const read = parsed.sheets.filter((sheet) => !sheet.ignored && !sheet.needsColumns && sheet.columns?.qty);
  if (read.length === 0) return null;
  return {
    lines: read.reduce((total, sheet) => total + sheet.lines.length, 0),
    code: read.some((sheet) => Boolean(sheet.columns?.code)),
    description: read.some((sheet) => Boolean(sheet.columns?.itemDescription)),
    quantity: true,
  };
}

/** The sentence a held part that reads as a bill carries above its box. */
export const BILL_OR_SCHEDULE_HELD =
  "Could be the bill or an FF&E schedule. If it is the bill, accept Bill of quantities; if not, choose what it is.";
