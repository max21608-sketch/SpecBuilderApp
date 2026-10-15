// What a drawing card's replace box says: WHICH DOCUMENT HOLDS WHAT.
//
// ============================================================================
// Matthew, 2026-10-15 (part 2, 36:36–44:38), on TB-08's replace box: "is it
// going to replace it with a 900 or… keep the 3,500?", then "I still don't
// know which way around it is". The box said "This item already holds a value
// here. Tick to replace it — the old one is kept, marked retired, and linked
// to this as its replacement", with the bill's own column heading beneath it.
// It never said that the held value was THE BILL'S, nor what this drawing
// says instead. His ask: "flagging that this intake contradicts what you
// already put in on the BOQ… I think it just needs to reword it."
//
// So the box is one comparison and one choice, both ways named:
//
//   The bill says W 900mm · this drawing says W 3500mm
//   [ ] Use this drawing's      To keep the bill's, ignore this row or make it a note.
//
// The rule is unchanged: the tick is the same per-(observation, record)
// acknowledgement, keyed the same way. Only the words moved. The old sentence
// about retiring is kept, behind a toggle, because it is how a reviewer learns
// that nothing is deleted.
// ============================================================================
import type { DimensionSlot } from "@/lib/spec-vocab";
import { sourceSays, type SourceLike } from "@/lib/source-words";

const SLOT_PREFIX: Record<DimensionSlot, string> = { W: "W", D: "D", H: "H", SH: "SH", DIA: "Dia" };

/** Long finish text is cut: the full value is on the row above and under the toggle. */
const MAX_QUOTE = 70;

function figure(value: string | null | undefined, unit: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "nothing";
  return unit && /\d$/.test(text) ? `${text}${unit}` : text;
}

function quoted(value: string | null | undefined): string {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "nothing";
  return `“${text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1)}…` : text}”`;
}

export type ReplaceSide = {
  /** The held value's slot, where it is a dimension. */
  slot: DimensionSlot | null;
  value: string | null;
  unit: string | null;
};

/**
 * "The bill says W 900mm · this drawing says W 3500mm".
 *
 * `held` is what the record holds now and where it came from; `incoming` is
 * this row. A dimension names its slot on both sides, because the slot is the
 * whole question (TB-08: the bill's W was the table's depth). A finish quotes
 * its words.
 */
export function replaceComparison(held: ReplaceSide & SourceLike, incoming: ReplaceSide): string {
  const side = (entry: ReplaceSide) =>
    entry.slot ? `${SLOT_PREFIX[entry.slot]} ${figure(entry.value, entry.unit)}` : quoted(entry.value);
  return `${sourceSays(held)} ${side(held)} · this drawing says ${side(incoming)}`;
}

/** What leaving the box unticked means, in the words of whose value stays. */
export function keepWords(held: SourceLike): string {
  const whose = held.sourceIsBill ? "the bill's" : "the value already there";
  return `To keep ${whose}, ignore this row or make it a note.`;
}
