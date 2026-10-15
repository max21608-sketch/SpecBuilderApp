// The size, as the two review screens show it: what BWS receives, and ONE
// picker per figure.
//
// ============================================================================
// WORKSTREAM E (2026-10-15). Max: "it's just a nightmare using that kind of
// menu… at its core, it's good how it doesn't show and then it expands… it's
// just when it expands, it's quite complex". On the bill's expanded line and
// on the drawing card only SOME figures offered a slot ("only three of the
// four"), the drawing card had a select AND a row of "Use as" buttons for one
// question, and the composed cell sat small and grey where nobody looked —
// Matthew read the bill's "As printed" column as the output.
//
// So both screens use these two pieces and nothing else for the size:
//
// - `WhatBwsReceives`: the composed cell, LARGE, labelled for what it is. It
//   renders `composeDimensionCell`'s own text, passed in; nothing here
//   composes.
// - `SlotPicker`: W · D · H · SH · Dia · note, for every figure. BUTTONS,
//   never a select: a select already showing "D" fires no change when somebody
//   picks D, so the press recording "yes, it is a depth" would do nothing (the
//   level picker's trap). What a pick does is the caller's: the bill posts a
//   slot change and the drawing card a swap, and both move the figure that
//   held the slot to a note in the same locked write.
// ============================================================================
import type { ReactNode } from "react";
import {
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { ConvertedChip } from "@/components/records/ItemSpecChips";

/** A figure's slot, or a note. */
export type SlotChoice = DimensionSlot | "note";

const SHORT: Record<SlotChoice, string> = {
  W: "W",
  D: "D",
  H: "H",
  SH: "SH",
  DIA: "Dia",
  note: "note",
};

/** How a slot reads in a sentence: "the width", "a note". */
export function slotWords(slot: SlotChoice): string {
  return slot === "note"
    ? "a note, not a slot"
    : `the ${DIMENSION_SLOT_LABELS[slot].toLowerCase()}`;
}

export function SlotPicker({
  current,
  figure,
  busy = false,
  currentClickable = false,
  onPick,
}: {
  /** What the figure is now. */
  current: SlotChoice;
  /** The figure as printed, for the buttons' names: "720 is the width". */
  figure: string;
  busy?: boolean;
  /**
   * Pressing the slot it already holds still calls `onPick` — the bill uses
   * it to record "checked, as printed". Off on the drawing card, where it
   * would be a write that changes nothing.
   */
  currentClickable?: boolean;
  onPick: (slot: SlotChoice) => void;
}) {
  const choices: SlotChoice[] = [...DIMENSION_SLOTS, "note"];
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-neutral-300"
      role="group"
      aria-label={`What ${figure} is`}
    >
      {choices.map((choice) => {
        const pressed = choice === current;
        return (
          <button
            key={choice}
            type="button"
            aria-pressed={pressed}
            aria-label={`${figure} is ${slotWords(choice)}`}
            title={
              pressed
                ? `${figure} is ${slotWords(choice)}`
                : `Make ${figure} ${slotWords(choice)}`
            }
            disabled={busy || (pressed && !currentClickable)}
            onClick={() => onPick(choice)}
            className={`px-2 py-0.5 font-mono text-xs leading-5 ${choice === "note" ? "border-l-2" : "border-l"} border-neutral-300 first:border-l-0 ${
              pressed
                ? "bg-neutral-800 text-white disabled:opacity-100"
                : "bg-white text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            }`}
          >
            {SHORT[choice]}
          </button>
        );
      })}
    </span>
  );
}

/**
 * THE COMPOSED CELL, LARGE, AT THE TOP OF THE SIZE. `shown` is the screen
 * rendering (feet and inches as printed, millimetres beside); `fileText` the
 * millimetre cell BWS receives, printed under it where the two differ.
 */
export function WhatBwsReceives({
  shown,
  fileText,
  problems = [],
  empty,
  children,
}: {
  shown: { text: string; fromImperial?: boolean };
  fileText: string;
  problems?: readonly string[];
  /** What to say where no slot is filled. */
  empty: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5"
      data-testid="what-bws-receives"
    >
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <span className="text-th font-bold uppercase tracking-wider text-neutral-500">
          What BWS receives
        </span>
        {fileText ? (
          <span
            className="font-mono text-xl font-semibold tracking-tight text-neutral-900"
            data-testid="bws-cell"
          >
            {shown.text || fileText}
            {shown.fromImperial && (
              <ConvertedChip className="ml-2 align-middle font-sans" />
            )}
          </span>
        ) : (
          <span className="text-sm text-neutral-500">{empty}</span>
        )}
        <span className="text-xs text-neutral-500">Dimensions, field 3</span>
      </div>
      {shown.fromImperial && fileText && shown.text !== fileText && (
        <p className="mt-0.5 text-xs text-neutral-500">
          In millimetres, as the file writes it:{" "}
          <span className="font-mono text-neutral-700">{fileText}</span>
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="mt-0.5 text-xs text-amber-700">
          {problem}
        </p>
      ))}
      {children}
    </div>
  );
}
