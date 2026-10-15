// What still stops a Confirm, as a short list of places to go.
//
// ============================================================================
// ONE LIST, AT THE TOP, EACH ITEM A LINK TO ITS ROW (2026-10-15).
//
// Both of that day's calls stalled on blockers the screen knew about and said
// somewhere else. The bill review's reason was a hover title on a button
// scrolled out of view; a drawing card waited on "Checked" boxes nobody could
// see. Max, the same evening: "they're very much like developer style error
// messages… what we need is just like things to get highlighted… we don't
// know what the next step is." Matthew asked for the tabs that still need
// something to be red, and Max proposed "a bar at the top with… things that
// need to be done… click on that and it will take you to where on the page it
// needs your attention" (part 2, 1:46–2:39).
//
// So each blocker becomes a few words naming the next step, and a TARGET: the
// id of the element to scroll to and highlight. The full sentence the screen
// already computed travels as `why`, shown behind a toggle — never deleted,
// because it is how a reviewer checks what the app is asking.
//
// Pure, and nothing here decides WHETHER a card can commit: the blockers are
// still `drawingItemBlockers` and `boqConfirmBlocker`'s inputs, the functions
// the confirm routes call. This only says them shorter, and where.
// ============================================================================
import { DIMENSION_SLOT_LABELS, type DimensionSlot } from "@/lib/spec-vocab";

export type NeedsYouItem = {
  key: string;
  /** The next step, in a few words. */
  words: string;
  /** The element id to scroll to and highlight, or null where there is nowhere to go. */
  target: string | null;
  /** The full sentence, shown behind the list's toggle. */
  why?: string;
  /** The row it is about, so a card can unfold a folded row before going there. */
  observationId?: string;
  /** The bill sheet it is about, so the review can switch to its tab first. */
  sheetIndex?: number;
};

// ---- ids, so the list and the rows cannot disagree about an address --------

export const needsYouListId = (scope: string) => `needs-you-${scope}`;
export const observationRowId = (observationId: string) => `row-${observationId}`;
/** The replace box under a row: a held value is decided there, not on the row. */
export const replacePanelId = (observationId: string) => `replace-${observationId}`;
export const uncertainNoticeId = (itemId: string, index: number) => `uncertain-${itemId}-${index}`;
export const runTargetsId = (itemId: string) => `runs-${itemId}`;
export const sheetColumnsId = (sheetIndex: number) => `sheet-${sheetIndex}-columns`;
export const billLineId = (sheetIndex: number, lineNo: number) => `bill-line-${sheetIndex}-${lineNo}`;

/** Up to the first full stop, for a blocker no rule below has shorter words for. */
function firstSentence(message: string): string {
  const match = message.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : message).trim();
}

// ---- a drawing card ----------------------------------------------------------

export type CardBlockerLike = {
  code: string;
  message: string;
  observationId?: string;
  index?: number;
};

export type CardRowLike = {
  id: string;
  labelRaw?: string | null;
  attrGroup?: string | null;
  dimensionSlot?: DimensionSlot | string | null;
};

function rowName(row: CardRowLike | undefined): string {
  if (!row) return "A row";
  if (row.attrGroup === "dimension" && row.dimensionSlot && row.dimensionSlot in DIMENSION_SLOT_LABELS) {
    return DIMENSION_SLOT_LABELS[row.dimensionSlot as DimensionSlot];
  }
  const label = (row.labelRaw ?? "").trim();
  return label ? (label.length > 40 ? `${label.slice(0, 39)}…` : label) : "A row";
}

const ROW_WORDS: Record<string, (name: string) => string> = {
  dimension_slot_taken: (name) => `${name}: already held — use this drawing's, or ignore the row`,
  slot_taken: (name) => `${name}: field already held — use this drawing's, or ignore the row`,
  unit_missing: (name) => `${name}: choose a unit`,
  no_state: (name) => `${name}: stated or TBC?`,
  empty_value: (name) => `${name}: give it a value`,
  dimension_slot_missing: (name) => `${name}: say which dimension it is`,
  dia_conflict: (name) => `${name}: a diameter beside a width or depth`,
  field_conflict: (name) => `${name}: same finish, or two?`,
  configuration_undecided: (name) => `${name}: which configuration?`,
};

/**
 * One item per blocker on a single drawing card, in the card's own order:
 * what the read was unsure of first (it sits at the top), then the records,
 * then the rows. `slots` maps an `uncertain_unchecked` blocker's notice index
 * to the slot it doubts.
 */
export function drawingNeedsYou(input: {
  itemId: string;
  blockers: readonly CardBlockerLike[];
  rows: readonly CardRowLike[];
  slots: ReadonlyMap<number, DimensionSlot | null>;
}): NeedsYouItem[] {
  const rows = new Map(input.rows.map((row) => [row.id, row]));
  const uncertain: NeedsYouItem[] = [];
  const records: NeedsYouItem[] = [];
  const onRows: NeedsYouItem[] = [];
  const seen = new Set<string>();
  input.blockers.forEach((blocker, position) => {
    if (blocker.code === "uncertain_unchecked" && typeof blocker.index === "number") {
      const slot = input.slots.get(blocker.index);
      uncertain.push({
        key: `uncertain-${blocker.index}`,
        words: `Check the ${slot ? DIMENSION_SLOT_LABELS[slot].toLowerCase() : "size"} — then press “Mark checked”`,
        target: uncertainNoticeId(input.itemId, blocker.index),
        why: blocker.message,
      });
      return;
    }
    if (blocker.code === "no_targets" || blocker.code === "ambiguous_run") {
      records.push({
        key: `${blocker.code}-${position}`,
        words: blocker.code === "no_targets" ? "Choose the record this page is for" : "Pick which bill line it is",
        target: runTargetsId(input.itemId),
        why: blocker.message,
      });
      return;
    }
    if (blocker.observationId) {
      const words = (ROW_WORDS[blocker.code] ?? (() => firstSentence(blocker.message)))(rowName(rows.get(blocker.observationId)));
      const key = `${blocker.observationId}-${blocker.code}`;
      if (seen.has(key)) return;
      seen.add(key);
      const taken = blocker.code === "dimension_slot_taken" || blocker.code === "slot_taken";
      onRows.push({
        key,
        words,
        target: taken ? replacePanelId(blocker.observationId) : observationRowId(blocker.observationId),
        why: blocker.message,
        observationId: blocker.observationId,
      });
      return;
    }
    records.push({ key: `${blocker.code}-${position}`, words: firstSentence(blocker.message), target: null, why: blocker.message });
  });
  return [...uncertain, ...records, ...onRows];
}

// ---- a bill review -------------------------------------------------------------

export type BillSheetState = {
  index: number;
  /** The name its tab shows. */
  tab: string;
  /** Nobody has said its columns. */
  unmapped: boolean;
  /** A model read its columns and nobody has agreed to them. */
  unchecked: boolean;
  /** Finish lines with no item, from `rowKindProblems`. */
  problems: readonly { lineNo: number; problem: string }[];
};

/**
 * One item per thing a bill's confirm waits on, each pointing at the panel or
 * the line, on its own tab. `single` is a bill of one sheet, which has no tab
 * to name. The same reasons `boqConfirmBlocker` gives, in the same order.
 */
export function billNeedsYou(input: {
  sheets: readonly BillSheetState[];
  single: boolean;
  reading: boolean;
  noLiveLines: boolean;
}): NeedsYouItem[] {
  const on = (sheet: BillSheetState) => (input.single ? "" : ` on “${sheet.tab}”`);
  const out: NeedsYouItem[] = [];
  for (const sheet of input.sheets) {
    if (sheet.unmapped) {
      out.push({
        key: `unmapped-${sheet.index}`,
        words: `Set the columns${on(sheet)}, or drop the sheet`,
        target: sheetColumnsId(sheet.index),
        why: `Nothing has been read from ${input.single ? "this sheet" : `“${sheet.tab}”`} yet — nobody has said which column is which. Set its columns on the Columns panel, or drop the sheet if it is not a bill.`,
        sheetIndex: sheet.index,
      });
    }
  }
  for (const sheet of input.sheets) {
    if (sheet.unchecked) {
      out.push({
        key: `unchecked-${sheet.index}`,
        words: `Check the columns${on(sheet)}, then press “The columns are right”`,
        target: sheetColumnsId(sheet.index),
        why: "The model read the header, the columns and the Kind of each line; the confirm waits until a person has checked them against the sheet. The model never typed a value: every code, description and quantity was read by code.",
        sheetIndex: sheet.index,
      });
    }
  }
  for (const sheet of input.sheets) {
    for (const problem of sheet.problems) {
      out.push({
        key: `problem-${sheet.index}-${problem.lineNo}`,
        words: `Row ${problem.lineNo}${on(sheet)}: say which item this fabric belongs to`,
        target: billLineId(sheet.index, problem.lineNo),
        why: problem.problem,
        sheetIndex: sheet.index,
      });
    }
  }
  if (input.reading) out.push({ key: "reading", words: "Wait — the model is still reading the columns", target: null });
  if (input.noLiveLines && !input.sheets.some((sheet) => sheet.unmapped)) {
    out.push({ key: "no-lines", words: "Every line is dropped — include one to confirm", target: null });
  }
  return out;
}

/** The sheets a person still has something to do on: their tabs are red. */
export function sheetsWaiting(items: readonly NeedsYouItem[]): Set<number> {
  return new Set(items.flatMap((item) => (item.sheetIndex === undefined ? [] : [item.sheetIndex])));
}
