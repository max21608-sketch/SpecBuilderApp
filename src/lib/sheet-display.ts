// A spreadsheet NUMBER as the sheet DISPLAYS it, for the identifier columns.
//
// ============================================================================
// `1.10` IS NOT `1.1`, AND `0012` IS NOT `12` (audit C13, 2026-11-16).
//
// `read-excel-file` hands back a numeric cell's VALUE. A bill that types its
// line numbers as numbers formatted `0.00` prints `1.10` under `1.9`, and the
// reader staged "1.1" — the same text as line 1.1, two lines one label. A code
// column formatted `0000` prints `0012` and staged "12", a client ref the
// client never wrote. Confirmed with a synthetic workbook before this was
// written: both happen.
//
// So the identifier columns — the code, the bill's own line number, a finish
// code — read the cell as DISPLAYED, through this. Two things about it are
// traps rather than preferences:
//
//   * ONLY THE ZERO PATTERNS ARE RENDERED: `0000`, `0.00`, `#0.0` — fixed
//     decimals and zero-padding, which is all an identifier format is. A
//     format with a thousands separator, a currency, a percentage, a date or a
//     colour section is left to the raw value: rendering it here would be a
//     second, partial Excel formatter, and a wrong one would invent a code.
//   * NEVER FOR A QUANTITY. A quantity formatted `#,##0` would read `1,200`,
//     which `readPrintedNumber` refuses as ambiguous; quantities keep reading
//     the VALUE through `src/lib/printed-number.ts`, the one reader.
//
// ExcelJS gives each cell's `numFmt` (its `.text` is NOT the displayed text —
// it is `String(value)`, measured); `readSheetDisplays` in `intake-source.ts`
// reads it, server-side. A workbook ExcelJS cannot open yields no display at
// all, and every cell reads its raw value exactly as before. This file is a
// pure leaf because the bill reader, which the review screen imports, needs
// `displayKey`, and a browser bundle must never reach ExcelJS.
// ============================================================================

/** Displayed text by `${rowIndex}:${columnIndex}`, 0-based, for the cells whose display differs from their value. */
export type SheetDisplay = ReadonlyMap<string, string>;

export function displayKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

const ZERO_PATTERN = /^#*(0+)(?:\.(0+))?$/;

/**
 * The text a number shows under a zero-pattern format, or null where the
 * format is anything else, the value is not a non-negative finite number, or
 * the display is just the value. `@` (Text) shows the value as it is.
 */
export function displayedNumber(value: unknown, numFmt: string | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // The first section is the one a non-negative number shows. Quoted text and
  // escapes are not part of a zero pattern, so a format carrying them fails
  // the pattern below and is left alone.
  const format = (numFmt ?? "").split(";")[0]?.trim() ?? "";
  const match = ZERO_PATTERN.exec(format);
  if (!match) return null;
  const decimals = match[2]?.length ?? 0;
  const fixed = value.toFixed(decimals);
  const [whole = "", fraction] = fixed.split(".");
  const padded = whole.padStart(match[1]!.length, "0");
  const shown = fraction === undefined ? padded : `${padded}.${fraction}`;
  return shown === String(value) ? null : shown;
}
