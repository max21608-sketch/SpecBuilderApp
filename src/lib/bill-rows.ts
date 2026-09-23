// Which record a row of a confirmed bill became — the address a bill's OWN
// specification read resolves by (plan any-bill, Step 8).
//
// ============================================================================
// THIS IS NOT MATCHING.
//
// "Read the specifications in this bill" registers the bill's stored file as a
// specification document (`bill-specifications.ts`). Every proposal the model
// reads out of it carries the sheet and the row it came from, and the bill's
// own confirm recorded which record each row became: `spec_records.
// source_import_id` is the bill's run and `source_line_no` is the row. So the
// row IS the record, and resolving it by the client's code instead — which is
// what the ref matcher does, and all it can do for a document it did not
// write — threw that away. Measured on a real 101-line bill (2026-09-23): 256
// of 559 proposals resolved to NO record. 168 were AMBIGUOUS, because one code
// sits on several lines of a bill (an Option 1 and an Option 2 armchair, one
// code, two records) and a ref cannot say which; 88 were not found, because
// the model copied refs the way the bill prints them — `GR-FAB-13
// (GR-FUR-10)`, `N/A` — or the record had no category yet. By row, none is
// unfound, and 8 are ambiguous: the rows whose printed ref names a different
// item, which is a question for a person and is asked.
//
// A FABRIC LINE IS ITS ITEM'S. The bill confirm writes a `finish_for` line onto
// the item it sits under and makes no record of it, so its row resolves to the
// ITEM's record — the staged `finishFor.row` — and says so, because what that
// row states is about the fabric: its "Width" is a roll width, not the chair's.
//
// PURE and a leaf. The loader lives beside the other registers
// (`spec-document-registers.ts`); the rule lives here so a fixture can prove it.
// ============================================================================

/**
 * The registration request id a bill's specification read always carries. It
 * lives in this leaf so the registers loader can recognise one without pulling
 * in the registration protocol; `bill-specifications.ts` re-exports it.
 */
export const BILL_SPECS_REQUEST_PREFIX = "boq-specs:";

export function billSpecsRequestId(billRunId: string): string {
  return `${BILL_SPECS_REQUEST_PREFIX}${billRunId}`;
}

/** The bill a specification read was registered from, or null. */
export function billRunIdOf(registrationRequestId: string | null | undefined): string | null {
  const id = registrationRequestId ?? "";
  return id.startsWith(BILL_SPECS_REQUEST_PREFIX) ? id.slice(BILL_SPECS_REQUEST_PREFIX.length) || null : null;
}

export type BillRowTarget = {
  recordId: string;
  /** The code the bill printed on that row, verbatim. Null where it printed none. */
  codeRaw: string | null;
  /**
   * Set on a FABRIC LINE: the row of the item it sits under, whose record this
   * is. Null on an item's own row.
   */
  itemRow: number | null;
};

export type BillRowIndex = {
  billRunId: string;
  /**
   * Per sheet: row → record, and the rows its heading occupies (1-based), so a
   * windowed read of the same file repeats exactly the bill's own heading.
   */
  sheets: { sheet: string; rows: Map<number, BillRowTarget>; headerRows: number[] }[];
};

/** The parts of a staged bill line this reads. Structural, so v3 and v4 both fit. */
export type BillRowLine = {
  lineNo: number;
  code: string | null;
  ignored?: boolean;
  rowKind?: string | null;
  finishFor?: { row: number } | null;
};

/**
 * One map per sheet, row → record.
 *
 * `recordAt` answers which ACTIVE record the confirm made of a sheet's row, or
 * null — a row that became nothing (a section heading, an ignored line), a
 * record since retired, or two records claiming one row, which is not an exact
 * address and is left to the ref matcher rather than picked between.
 */
export function buildBillRowIndex(
  billRunId: string,
  sheets: { sheetName: string; lines: BillRowLine[]; headerRow?: number | null; headerRows?: number | null }[],
  recordAt: (sheetName: string, lineNo: number) => string | null,
): BillRowIndex {
  return {
    billRunId,
    sheets: sheets.map((sheet) => {
      // `headerRow` is the LOWER row of a two-row heading (`boq-import.ts`).
      const lower = Number.isInteger(sheet.headerRow) && Number(sheet.headerRow) >= 1 ? Number(sheet.headerRow) : null;
      const span = sheet.headerRows === 2 ? 2 : 1;
      const headerRows = lower === null ? [] : Array.from({ length: span }, (_, i) => lower - span + 1 + i).filter((row) => row >= 1);
      const rows = new Map<number, BillRowTarget>();
      for (const line of sheet.lines) {
        if (line.ignored) continue;
        const itemRow = line.rowKind === "finish_for" ? (line.finishFor?.row ?? null) : null;
        if (line.rowKind === "finish_for" && itemRow === null) continue;
        const recordId = recordAt(sheet.sheetName, itemRow ?? line.lineNo);
        if (!recordId) continue;
        rows.set(line.lineNo, { recordId, codeRaw: line.code ?? null, itemRow });
      }
      return { sheet: sheet.sheetName, rows, headerRows };
    }),
  };
}

function foldSheet(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The bill row an observation names, or null.
 *
 * The sheet is matched exactly, then folded by case and whitespace. A model
 * that gave no sheet is placed only where ONE sheet has that row — a bill with
 * two tabs both carrying row 12 is two different items, and the row alone does
 * not say which.
 */
export function billRowTarget(
  index: BillRowIndex | null | undefined,
  sheetRaw: string | null | undefined,
  row: number | null | undefined,
): { sheet: string; row: number; target: BillRowTarget } | null {
  if (!index || row === null || row === undefined || !Number.isInteger(row)) return null;
  const named = (sheetRaw ?? "").trim();
  if (named) {
    const sheet =
      index.sheets.find((entry) => entry.sheet === named) ??
      index.sheets.find((entry) => foldSheet(entry.sheet) === foldSheet(named)) ??
      null;
    const target = sheet?.rows.get(row) ?? null;
    return sheet && target ? { sheet: sheet.sheet, row, target } : null;
  }
  const holding = index.sheets.filter((entry) => entry.rows.has(row));
  if (holding.length !== 1) return null;
  const only = holding[0]!;
  return { sheet: only.sheet, row, target: only.rows.get(row)! };
}
