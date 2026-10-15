"use client";

// The size on a drawing card: what BWS receives, then ONE row per figure the
// drawing prints, each with the same picker (workstream E, 2026-10-15).
//
// ============================================================================
// WHY A SECTION OF ITS OWN, AND NOT ROWS OF THE SPEC TABLE.
//
// A figure sat in the same six-column table as a fabric, with a group select,
// a slot SELECT and, beside it, a row of "Use as W · D · H · SH · Dia" buttons
// — two controls for one question — and the composed cell sat at the bottom
// of the card, small, under every finish. On TB-08 (part 2, 22:48–50:59) the
// room spent half an hour on the card and the size was the hardest part of it.
//
// Here a figure is three things read across: the figure as the page prints it
// (with where), what it IS (`SlotPicker`), and what it BECOMES. Picking a slot
// another figure holds is the existing swap (`swapSlotRequest` →
// `planSlotSwap`), one locked write in which the holder returns to a note; a
// note is the old "Keep as a note" patch. Nothing the confirm reads changed.
//
// FOLD THEN EXPAND, kept: the slot holders show, every other figure is one
// click away — never dropped, and never folded where a blocker sits on it.
// Editing the figure, its unit or its state is one click away on the row
// ("Edit value"), except where the row cannot commit without it.
// ============================================================================
import { Fragment, useState } from "react";
import {
  asksForState,
  unitSourceOf,
  type DrawingObservation,
} from "@/lib/drawing-document";
import {
  canTakeSlot,
  millimetreReading,
  millimetresBeside,
} from "@/lib/slot-swap";
import { observationRowId } from "@/lib/needs-you";
import {
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  type AttributeState,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import {
  SlotPicker,
  WhatBwsReceives,
  type SlotChoice,
} from "@/components/imports/SlotPicker";
import {
  ReplacePanel,
  RowNotes,
  type Occupant,
  type RowBlocker,
  type RowWarning,
  type RunResolution,
} from "@/components/imports/ObservationRows";
import Button from "@/components/ui/Button";
import { TONE } from "@/components/ui/tone";

const COLUMNS = 4;

const SHORT: Record<DimensionSlot, string> = {
  W: "W",
  D: "D",
  H: "H",
  SH: "SH",
  DIA: "Dia",
};

/** What a figure becomes: `W 3500 mm`, `H 2'-4" (711mm)`, or a note. */
export function drawingFigureBecomes(
  observation: DrawingObservation,
  value: string | null,
): string {
  if (observation.attrGroup !== "dimension" || !observation.dimensionSlot)
    return "a note";
  const short = SHORT[observation.dimensionSlot];
  const figure = (value ?? "").trim();
  if (!observation.unit) return `${short} ${figure} (no unit)`;
  const mm = millimetresBeside(figure, observation.unit);
  const printed = /["']/.test(figure)
    ? figure
    : `${figure} ${observation.unit}`;
  return mm !== null ? `${short} ${printed} (${mm}mm)` : `${short} ${printed}`;
}

/** Where on the drawing a figure is printed: `Width · page 1 · DIMENSIONS`. */
function whereOf(observation: DrawingObservation): string {
  return [
    observation.labelRaw,
    typeof observation.page === "number" ? `page ${observation.page}` : null,
    observation.view,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

export type DrawingSizeProps = {
  /** Every pending row the section lists (`isSizeRow`), in staged order. */
  rows: DrawingObservation[];
  /** The composed cell: `composeDimensionCell`'s screen and file renderings, and its problems. */
  cell: {
    shown: { text: string; fromImperial?: boolean };
    fileText: string;
    problems: string[];
  };
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<
    React.SetStateAction<Record<string, Partial<DrawingObservation>>>
  >;
  busy: boolean;
  showMm: boolean;
  /** The folded rows are open. Owned by the card, so a "needs you" link can open it. */
  showAll: boolean;
  onToggleAll: () => void;
  blockersFor: (observationId: string) => RowBlocker[];
  warningsFor: (observationId: string) => RowWarning[];
  occupantsFor: (
    observationId: string,
  ) => { recordId: string; occupant: Occupant }[];
  runs: RunResolution[];
  guessWhy: (observationId: string) => string | undefined;
  /**
   * The row that IS one of a row's rival figures (`candidateRowFor`), by the
   * candidate's index, or null where none can be named — "Use this instead".
   */
  candidateRow?: (
    observation: DrawingObservation,
    index: number,
  ) => DrawingObservation | null;
  /** A slot: the swap. Never called with the slot the row already holds. */
  onSwapSlot: (observation: DrawingObservation, slot: DimensionSlot) => void;
  onChange: (
    observation: DrawingObservation,
    changes: Record<string, unknown>,
  ) => void;
  onIgnore: (observation: DrawingObservation) => void;
};

/** Which rows show folded: the slot holders, in slot order, and any row something stops on. */
export function sizeRowsShown(
  rows: DrawingObservation[],
  stops: (observation: DrawingObservation) => boolean,
): { shown: DrawingObservation[]; folded: DrawingObservation[] } {
  const holders = rows
    .filter((row) => row.attrGroup === "dimension" && row.dimensionSlot)
    .sort(
      (a, b) =>
        DIMENSION_SLOTS.indexOf(a.dimensionSlot as DimensionSlot) -
        DIMENSION_SLOTS.indexOf(b.dimensionSlot as DimensionSlot),
    );
  // NOTHING TO FOLD BEHIND: with no slot filled, every figure shows.
  if (holders.length === 0) return { shown: rows, folded: [] };
  const rest = rows.filter((row) => !holders.includes(row));
  return {
    shown: [...holders, ...rest.filter(stops)],
    folded: rest.filter((row) => !stops(row)),
  };
}

export default function DrawingSize(props: DrawingSizeProps) {
  const { rows, cell, showAll, onToggleAll, blockersFor } = props;
  // A row something stops on is never folded away.
  const { shown, folded } = sizeRowsShown(
    rows,
    (row) => blockersFor(row.id).length > 0,
  );
  return (
    <div className="space-y-2" data-testid="drawing-size">
      <WhatBwsReceives
        shown={cell.shown}
        fileText={cell.fileText}
        problems={cell.problems}
        empty={
          rows.length > 0
            ? "No width, depth or height placed yet — give a figure its slot below."
            : "This drawing prints no figure for the size."
        }
      />
      {rows.length > 0 && (
        <>
          <p className="text-th font-bold uppercase tracking-wider text-neutral-500">
            Each figure the drawing prints
          </p>
          <div className="rounded-lg border border-neutral-200">
            <table
              className="w-full border-collapse text-cell"
              data-testid="drawing-figures"
            >
              <thead>
                <tr className="text-left text-th font-semibold uppercase tracking-wider text-neutral-500">
                  <th className="w-[38%] bg-[#fcfcfc] px-4 py-2">
                    Figure, as the page prints it
                  </th>
                  <th className="bg-[#fcfcfc] px-2 py-2">Is</th>
                  <th className="bg-[#fcfcfc] px-2 py-2">Becomes</th>
                  <th className="bg-[#fcfcfc] px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <FigureRows key={row.id} row={row} {...props} />
                ))}
                {folded.length > 0 && (
                  <tr className="border-t border-neutral-200 bg-neutral-50">
                    <td colSpan={COLUMNS} className="px-4 py-2">
                      <Button
                        size="xs"
                        variant="quiet"
                        aria-expanded={showAll}
                        onClick={onToggleAll}
                      >
                        {showAll
                          ? `Hide the other ${folded.length} figure${folded.length === 1 ? "" : "s"}`
                          : `Every other figure the drawing prints (${folded.length}) — show`}
                      </Button>
                      <span className="ml-2 text-xs text-neutral-500">
                        Kept on the item as notes unless you give one a slot.
                      </span>
                    </td>
                  </tr>
                )}
                {showAll &&
                  folded.map((row) => (
                    <FigureRows key={row.id} row={row} {...props} />
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** One figure's row, then its replace question and its notes, each its own `<tr>`. */
function FigureRows({
  row,
  ...props
}: DrawingSizeProps & { row: DrawingObservation }) {
  const {
    drafts,
    setDrafts,
    busy,
    showMm,
    blockersFor,
    warningsFor,
    occupantsFor,
    runs,
    guessWhy,
    onSwapSlot,
    onChange,
    onIgnore,
  } = props;
  const [editing, setEditing] = useState(false);
  const draft = drafts[row.id] ?? {};
  const value = draft.value !== undefined ? draft.value : row.value;
  const blockers = blockersFor(row.id);
  const warnings = warningsFor(row.id);
  const blocked = blockers.length > 0 || warnings.length > 0;
  const guessed = Boolean(row.slotSuggested && row.dimensionSlot);
  const current: SlotChoice =
    row.attrGroup === "dimension" && row.dimensionSlot
      ? row.dimensionSlot
      : "note";
  const unitSource = unitSourceOf(row);
  // The unit is asked only where the page did not print it.
  const askUnit = canTakeSlot(row) && (unitSource !== "printed" || row.unit === null);
  const askState = asksForState(row) && row.state === null;
  const reading = showMm ? millimetreReading(value, row.unit) : null;
  const pick = (slot: SlotChoice) => {
    if (slot === current) return;
    if (slot === "note")
      onChange(row, { attrGroup: "note", dimensionSlot: null });
    else onSwapSlot(row, slot);
  };
  const unitSelect = (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-neutral-500" aria-hidden="true">
        printed in
      </span>
      <select
        value={row.unit ?? ""}
        onChange={(event) =>
          onChange(row, { unit: event.target.value || null })
        }
        aria-label="printed in"
        className={`rounded border px-1 py-0.5 text-xs ${
          row.unit === null && row.attrGroup === "dimension"
            ? "border-amber-400 bg-amber-50"
            : "border-neutral-300"
        }`}
      >
        <option value="">unit…</option>
        {ATTRIBUTE_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </select>
    </span>
  );
  const stateSelect = (
    <select
      value={row.state ?? ""}
      onChange={(event) =>
        onChange(row, {
          state: (event.target.value || null) as AttributeState | null,
        })
      }
      aria-label="State"
      className={`rounded border px-1 py-0.5 text-xs ${row.state === null ? "border-amber-400 bg-amber-50" : "border-neutral-300"}`}
    >
      <option value="">Stated or TBC?</option>
      <option value="confirmed">Stated</option>
      <option value="tbc">TBC</option>
    </select>
  );
  return (
    <Fragment>
      <tr
        id={observationRowId(row.id)}
        data-figure-row={row.id}
        data-label={row.labelRaw ?? ""}
        className={`border-t border-neutral-100 align-top${guessed ? ` ${TONE.guess.row}` : blocked ? " bg-amber-50/40" : ""}${
          blocked ? " border-l-4 border-l-amber-400" : ""
        }`}
      >
        <td className="px-4 py-2">
          {editing ? (
            <input
              value={value ?? ""}
              aria-label="The figure"
              autoFocus
              onChange={(event) =>
                setDrafts((all) => ({
                  ...all,
                  [row.id]: { ...draft, value: event.target.value },
                }))
              }
              onBlur={(event) => {
                if (event.target.value !== (row.value ?? ""))
                  onChange(row, { value: event.target.value || null });
              }}
              className="w-40 rounded border border-neutral-300 px-2 py-0.5 font-mono text-sm"
            />
          ) : (
            <span className="font-mono text-sm font-semibold text-neutral-900">
              {value ?? "—"}
            </span>
          )}{" "}
          {!canTakeSlot(row) ? null : askUnit ? (
            <span className="inline-flex items-center gap-1">
              {unitSelect}
              {unitSource === "figures" && (
                <span className="text-xs text-amber-700">
                  guessed from the figures
                </span>
              )}
              {unitSource === "project_default" && (
                <span className="text-xs text-amber-700">
                  the project default
                </span>
              )}
            </span>
          ) : (
            // A printed unit is NOT a guess and says so: that is the difference
            // between a measurement and a guess.
            <span className="text-xs text-neutral-500">
              {row.unit}{" "}
              <span className="text-neutral-400">· printed on the page</span>
            </span>
          )}
          {/* THE MILLIMETRES, RIGHT BESIDE THE FIGURE (Max, 2026-10-12): live
              off the box and the unit, through the one conversion. */}
          {(() => {
            const mm = millimetresBeside(value, row.unit);
            return mm === null ? null : (
              <span
                className="ml-1 whitespace-nowrap font-mono text-xs text-neutral-600"
                data-testid="mm-beside"
              >
                ({mm}mm)
              </span>
            );
          })()}
          <p className="text-xs text-neutral-500">{whereOf(row)}</p>
          {row.valueRaw !== null && row.valueRaw !== row.value && (
            <p className="text-xs text-neutral-400">
              drawing said: {row.valueRaw}
            </p>
          )}
          {reading && (
            <p
              className={`font-mono text-xs ${reading.ok ? "text-neutral-800" : "text-amber-800"}`}
              data-testid="in-millimetres"
            >
              {reading.ok ? `= ${reading.text}` : `[${reading.text}]`}
            </p>
          )}
          {/* THE FIGURES THE READ DID NOT CHOOSE for this slot: each is a
              row of its own, and "Use this instead" is that row's swap. */}
          {row.candidates && row.candidates.length > 0 && (
            <div className="text-xs text-amber-800">
              also printed:
              <ul className="mt-0.5 space-y-0.5">
                {row.candidates.map((candidate, index) => {
                  const rival = props.candidateRow?.(row, index) ?? null;
                  const where = [
                    candidate.view,
                    candidate.page ? `p${candidate.page}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={index}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span>
                        {candidate.valueRaw}
                        {candidate.unitRaw ? ` ${candidate.unitRaw}` : ""}
                        {where ? ` (${where})` : ""}
                      </span>
                      {rival && row.dimensionSlot && (
                        <Button
                          size="xs"
                          variant="quiet"
                          disabled={busy}
                          onClick={() =>
                            onSwapSlot(
                              rival,
                              row.dimensionSlot as DimensionSlot,
                            )
                          }
                        >
                          Use this instead
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {askState && <div className="mt-1">{stateSelect}</div>}
          {editing && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {!askUnit && unitSelect}
              {!askState && asksForState(row) && stateSelect}
              <Button
                size="xs"
                variant="quiet"
                onClick={() => setEditing(false)}
              >
                Done
              </Button>
            </div>
          )}
        </td>
        <td className="px-2 py-2">
          {canTakeSlot(row) ? (
            <SlotPicker
              current={current}
              figure={value ?? row.labelRaw ?? "this figure"}
              busy={busy}
              onPick={pick}
            />
          ) : (
            <span className="text-xs text-neutral-500">no figure printed</span>
          )}
          {guessed && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              {row.slotReason ?? guessWhy(row.id) ?? "order assumed W × D × H"}
            </p>
          )}
        </td>
        <td className="px-2 py-2">
          <span
            className={
              current === "note"
                ? "text-xs text-neutral-500"
                : "font-mono font-semibold text-neutral-900"
            }
          >
            {drawingFigureBecomes(row, value)}
          </span>
          {row.state === "tbc" && current !== "note" && (
            <span className="ml-1 text-xs text-amber-700">TBC</span>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-right">
          {!editing && (
            <Button size="xs" variant="quiet" onClick={() => setEditing(true)}>
              Edit value
            </Button>
          )}
          <Button size="xs" variant="quiet" onClick={() => onIgnore(row)}>
            Ignore
          </Button>
        </td>
      </tr>
      <ReplacePanel
        observation={row}
        occupants={occupantsFor(row.id)}
        runs={runs}
        busy={busy}
        blocked={blocked}
        colSpan={COLUMNS}
        onChange={onChange}
      />
      <RowNotes blockers={blockers} warnings={warnings} colSpan={COLUMNS} />
    </Fragment>
  );
}
