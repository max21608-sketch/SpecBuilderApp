// Pure tier — the composed dimension cell as a PERSON reads it.
//
// Max, 2026-10-05: "Always keep the original measurement, but have in brackets
// beside it the one in millimeters ... it can just flag." So a screen shows a
// slot the page printed in feet and inches AS PRINTED, with the millimetres
// beside it, and says it converted. The FILE does not change: BWS field 3 is
// `W***mm`, and the existing dimension and export tests hold that untouched.
// This file pins both halves of the one function: the screen string, and that
// the default (file) mode over the same rows is today's string exactly.
import { describe, expect, it } from "vitest";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import type { AttributeUnit, DimensionSlot } from "@/lib/spec-vocab";

const row = (
  slot: DimensionSlot,
  value: string | null,
  unit: AttributeUnit | null = "in",
  overrides: Partial<DimensionRow> = {},
): DimensionRow => ({ slot, value, unit, state: "confirmed", sortOrder: 0, ...overrides });

const ordered = (rows: DimensionRow[]) => rows.map((r, i) => ({ ...r, sortOrder: r.sortOrder || i }));
const screen = (rows: DimensionRow[], note?: string | null) =>
  composeDimensionCell(ordered(rows), note, { mode: "screen" });
const file = (rows: DimensionRow[], note?: string | null) => composeDimensionCell(ordered(rows), note);

describe("composeDimensionCell — screen mode", () => {
  it("prints each feet-and-inches slot as printed, with its millimetres in brackets", () => {
    const rows = [row("W", "3'-7\""), row("D", "1'-10 5/8\""), row("H", "2'-5\"")];
    const cell = screen(rows);
    expect(cell.text).toBe('W 3\'-7" (1092mm) x D 1\'-10 5/8" (575mm) x H 2\'-5" (737mm)');
    expect(cell.fromImperial).toBe(true);
    expect(cell.problems).toEqual([]);
    // THE FILE IS UNCHANGED: millimetres only, the unit once at the end.
    expect(file(rows).text).toBe("W1092 x D575 x H737mm");
    expect(file(rows)).not.toHaveProperty("fromImperial");
  });

  it("prints plain inches with their mark, and a fraction after feet", () => {
    expect(screen([row("H", '18"')]).text).toBe('H 18" (457mm)');
    expect(screen([row("H", "2'-0 1/2\"")]).text).toBe('H 2\'-0 1/2" (622mm)');
  });

  it("gives a bare figure recorded at `in` its inch mark back", () => {
    // `18` at `in` is eighteen inches. A bare 18 beside a millimetre group would
    // read as eighteen millimetres.
    expect(screen([row("W", "18", "in")]).text).toBe('W 18" (457mm)');
  });

  it("writes a diameter the same way, replacing W and D", () => {
    const cell = screen([row("DIA", '18"'), row("H", "2'-5\"")]);
    expect(cell.text).toBe('Dia. 18" (457mm) x H 2\'-5" (737mm)');
    expect(cell.fromImperial).toBe(true);
  });

  it("puts the cell's single `mm` on the last METRIC figure where the slots are mixed", () => {
    const mixed = [row("W", "540", "mm"), row("D", "610", "mm"), row("SH", '16"')];
    expect(screen(mixed).text).toBe('W540 x D610mm x SH 16" (406mm)');
    expect(file(mixed).text).toBe("W540 x D610 x SH406mm");

    const imperialFirst = [row("W", '21"'), row("D", "610", "mm"), row("H", "430", "mm")];
    expect(screen(imperialFirst).text).toBe('W 21" (533mm) x D610 x H430mm');
  });

  it("reads exactly as the file where nothing is imperial, and does not flag", () => {
    const metric = [row("W", "1900", "mm"), row("D", "79", "cm"), row("H", "720", "mm"), row("SH", "440", "mm")];
    const cell = screen(metric);
    expect(cell.text).toBe(file(metric).text);
    expect(cell.text).toBe("W1900 x D790 x H720 x SH440mm");
    expect(cell.fromImperial).toBe(false);
  });

  it("keeps a TBC the page printed after the bracket", () => {
    expect(screen([row("W", "3'-7\" TBC")]).text).toBe('W 3\'-7" (1092mm) TBC');
  });

  it("puts a person's note last, as the file does", () => {
    expect(screen([row("W", "3'-7\"")], "1250 L-shaped return").text).toBe(
      'W 3\'-7" (1092mm) (1250 L-shaped return)',
    );
  });

  it("still refuses an incomplete compound exactly as the file does", () => {
    const refused = [row("W", "8'-6\" eq")];
    expect(screen(refused).text).toBe(file(refused).text);
    expect(screen(refused).text).toBe('[W "8\'-6" eq" — imperial, not converted]');
    expect(screen(refused).fromImperial).toBe(false);
    // And a compound beside a metric unit is a conflict on both, never converted.
    const conflict = [row("SH", "1'6\"", "mm")];
    expect(screen(conflict).text).toBe(file(conflict).text);
  });
});
