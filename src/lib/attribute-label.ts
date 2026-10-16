// What a spec row is CALLED on a screen — the one decision, display only.
//
// Max, 2026-10-16, on TB-08 (an extending dining table, Ronnie Scott's): "the
// dimension labels should just read height or width or length or seat
// height". A bill's Dims column has ONE heading for every figure in it, so a
// record read off that column carried three rows each labelled
// "DIMENSIONS CM / MM L X W X H" — 900mm, 3500mm, 710mm — and each read as if
// it were the whole L x W x H.
//
// So a row that holds a SLOT is named by its slot: Width, Depth, Height, Seat
// height, Diameter. Five, never six: a bill's L is set to W or D on review and
// then reads that name. A note (no slot) keeps the document's own label,
// exactly as before, because that label is the only thing saying what the
// figure measures (`ARM HEIGHT 520`).
//
// `record_attributes.label` is untouched and stays what the document said: it
// is offered as the row's hover title (`documentLabelTitle`). The export, the
// composed cell and the check sheet never read this file; a version's diff
// heads a size row by its slot and still diffs the stored label as "Label".

import { DIMENSION_SLOT_LABELS, isDimensionSlot } from "@/lib/spec-vocab";

type LabelledRow = { label: string | null | undefined; slot: string | null | undefined };

/** The name a screen prints for a spec row: its slot's name, else the document's label. */
export function attributeDisplayLabel(row: LabelledRow): string {
  if (isDimensionSlot(row.slot)) return DIMENSION_SLOT_LABELS[row.slot];
  return row.label ?? "";
}

/**
 * The document's own label, for the row's hover title — only where the screen
 * prints something else. Nothing where they agree (a row typed as "Width", a
 * drawing read staged under its slot name) or where there is no label.
 */
export function documentLabelTitle(row: LabelledRow): string | undefined {
  const label = row.label?.trim();
  if (!label) return undefined;
  const shown = attributeDisplayLabel(row);
  if (shown.trim().toLowerCase() === label.toLowerCase()) return undefined;
  return `The document labels it “${label}”`;
}
