// The one compact line that says what an item IS: its size and its finishes.
//
// ============================================================================
// ONE LOOK, THREE SCREENS.
//
// The bill review's item summary was the first place an item's size and finish
// codes sat as chips under its name, and Max asked for the phase table to show
// the same thing (2026-10-05: "make sure ... it all appears in that line items
// overview as it should"). So the chips are this component and both screens
// render it; the bill review adds its own controls beside them.
//
// Nothing here composes. `dimensionCell` is `composeDimensionCell`'s own text
// in SCREEN mode, handed in by whoever called the one composer, and
// `fromImperial` is that same call's flag — so the "converted from ft-in" chip
// can only appear beside a cell that actually carries a bracketed conversion.
// ============================================================================
import Chip from "@/components/ui/Chip";
import type { Tone } from "@/components/ui/tone";

/**
 * Amber, because it needs a person's eye: the millimetres beside a
 * feet-and-inches figure are this app's arithmetic, not the page's, and the
 * figure the page printed is the one to check. Not red — nothing is wrong.
 */
export function ConvertedChip({ className = "" }: { className?: string }) {
  return (
    <Chip
      tone="warn"
      className={className}
      title="The page gave these in feet and inches. They are shown as printed, with the millimetres this app converted them to in brackets. BWS receives the millimetres."
    >
      converted from ft-in
    </Chip>
  );
}

export type SpecChip = {
  key: string;
  label: string;
  /** Plain where it lands somewhere; `blocked` where it has nowhere to go. */
  tone?: Tone;
  title?: string;
};

export default function ItemSpecChips({
  dimensionCell,
  fromImperial = false,
  finishes,
  chipClassName = "",
  emptySize = "no size placed",
  dimensionTitle = "The Dimensions cell, composed by the same function the export calls",
  children,
}: {
  /** `composeDimensionCell(..., { mode: "screen" }).text`, or empty. */
  dimensionCell: string;
  fromImperial?: boolean;
  finishes: readonly SpecChip[];
  /**
   * Layout for the chips. A table column passes a class that lets them wrap —
   * `Chip` stays no-wrap everywhere else, where a code broken over two lines
   * reads as two codes.
   */
  chipClassName?: string;
  /** What to say where there is no size. Null says nothing. */
  emptySize?: string | null;
  dimensionTitle?: string;
  /** Anything the caller puts after the chips, on the same line. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
      {dimensionCell ? (
        <Chip mono className={chipClassName} title={dimensionTitle}>
          {dimensionCell}
        </Chip>
      ) : (
        emptySize && <span className="text-neutral-500">{emptySize}</span>
      )}
      {dimensionCell && fromImperial && <ConvertedChip className={chipClassName} />}
      {finishes.map((finish) => (
        <Chip key={finish.key} mono tone={finish.tone ?? "plain"} className={chipClassName} title={finish.title}>
          {finish.label}
        </Chip>
      ))}
      {children}
    </div>
  );
}

/**
 * A composed dimension cell on a screen that also promises what the FILE says.
 *
 * The drawings cards and the record screen head their cell "BWS Dimensions" /
 * "as BWS will receive them". In screen mode a feet-and-inches slot reads as
 * printed with its millimetres beside it, which is NOT what BWS receives — so
 * where the screen cell converted anything, the millimetre cell the export
 * ships is printed under it in words. Both strings are `composeDimensionCell`'s
 * own, from the same rows; this renders them and computes nothing.
 */
export function ComposedDimensionText({
  shown,
  fileText,
  className = "font-mono text-[13px] text-neutral-900",
}: {
  shown: { text: string; fromImperial?: boolean };
  fileText: string;
  className?: string;
}) {
  return (
    <>
      <p className={className}>
        {shown.text}
        {shown.fromImperial && <ConvertedChip className="ml-2 align-middle font-sans" />}
      </p>
      {shown.fromImperial && fileText && (
        <p className="mt-0.5 text-xs text-neutral-500">
          BWS receives <span className="font-mono text-neutral-700">{fileText}</span>
        </p>
      )}
    </>
  );
}
