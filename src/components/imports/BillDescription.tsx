// What a bill line's description cell will become, on the BOQ review screen.
//
// ============================================================================
// THIS SCREEN IS THE APPROVAL GATE FOR THESE VALUES.
//
// The confirm writes each item's name and every specification its description
// cell states — dimensions in their slots, finish codes in their BWS fields,
// every other line as a note — from `planSheetDescriptions`, the function the
// server ran to produce what is rendered here. Nothing here computes: the
// composed dimension cell is `composeDimensionCell`'s own text, carried in the
// plan, so the line under an item says what the record will say.
//
// Two parts, because the table is the table. `BillDescriptionSummary` is the
// one compact line under the item's name — the size, each finish code with the
// field it lands in, how many notes — and `BillDescriptionPanelRow` is every
// statement verbatim beside what it became, with the cell as printed. The
// panel is its OWN `<tr>`, never a `<td colSpan>` beside the data cells, which
// is the rule `Table.tsx` states.
//
// ONE THING HERE CHANGES SOMETHING: a size part's slot. The bill printed
// `D 400` on a round stool, and a person says it is the diameter — before the
// confirm, on the screen that is the gate. The change is posted (the caller's
// `onSetSlot`), stored on the staged line, and applied INSIDE the plan the
// server recomposes; nothing here composes a cell, so the chip after the
// reload is `composeDimensionCell`'s own text again.
// ============================================================================
import { useState } from "react";
import { fieldDisplayName } from "@/lib/spec-field-label";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import ItemSpecChips from "@/components/records/ItemSpecChips";
import {
  BILL_UNIT_OVERRIDES,
  isBillUnitOverride,
  type BillDescriptionPlan,
  type BillUnitOverride,
  type PlanFigure,
  type PlannedAttribute,
  type SlotOverride,
} from "@/lib/bill-description";
import { DIMENSION_SLOT_LABELS } from "@/lib/spec-vocab";
import { SlotPicker, WhatBwsReceives } from "@/components/imports/SlotPicker";
import { toMillimetres, valueCarriesItsUnit } from "@/lib/dimensions";

/** Set a size part's slot (`null` puts it back as printed). Absent where the line cannot change. */
export type SetSlot = (key: string, slot: SlotOverride | null) => void;

/** Say the unit of a size that prints none (`null` takes it back). Absent where the line cannot change. */
export type SetUnit = (unit: BillUnitOverride | null) => void;

/** The plan as the review GET sends it: plus, on a line a revision carries, why it will not be written. */
export type ReviewDescription = BillDescriptionPlan & { revisionRefusal?: string | null };

const isFinish = (attribute: PlannedAttribute) => attribute.attrGroup !== "note" && attribute.attrGroup !== "dimension";

/** What one planned attribute IS, in the reviewer's words. */
function becomes(attribute: PlannedAttribute): string {
  if (attribute.slot) {
    // A feet-and-inches figure prints its own unit and gets its millimetres
    // beside it — `toMillimetres`, the conversion the composer uses.
    if (valueCarriesItsUnit(attribute.value) || attribute.unit === "in") {
      const mm = attribute.unit === "in" || attribute.unit === null ? toMillimetres(attribute.value, "in") : null;
      // (A marked value beside a metric unit is a conflict the cautions name; no conversion is shown.)
      const printed = valueCarriesItsUnit(attribute.value) ? attribute.value : `${attribute.value}"`;
      return `${DIMENSION_SLOT_LABELS[attribute.slot]} ${printed}${mm?.ok ? ` (${mm.mm}mm)` : ""}`;
    }
    return `${DIMENSION_SLOT_LABELS[attribute.slot]} ${attribute.value}${attribute.unit ?? ""}`;
  }
  if (isFinish(attribute)) return fieldDisplayName(attribute.specFieldName) ?? "a finish in no BWS field";
  return attribute.state === "tbc" ? "a note, TBC" : "a note";
}

export function BillDescriptionSummary({
  plan,
  open,
  onToggle,
  onSetSlot,
  onSetUnit,
  busy = false,
  chipClassName = "",
}: {
  plan: ReviewDescription;
  open: boolean;
  onToggle: () => void;
  onSetSlot?: SetSlot;
  onSetUnit?: SetUnit;
  busy?: boolean;
  /**
   * Layout for the size and finish chips. The bill review passes a class that
   * lets them wrap inside its Item column — `Chip` stays no-wrap everywhere
   * else, where a code broken over two lines reads as two codes.
   */
  chipClassName?: string;
}) {
  const depthKey = plan.depthWithoutWidth ?? null;
  const finishes = plan.attributes.filter(isFinish);
  const notes = plan.attributes.filter((attribute) => attribute.attrGroup === "note");
  return (
    <div className="mt-1 space-y-1">
      {/* THE SIZE AS THE BILL PRINTED IT. A feet-and-inches slot reads as
          printed with its millimetres beside it — the composer's screen mode —
          and the chip says it was converted. What BWS receives is the plan's
          millimetre cell, which the panel row below still prints. */}
      <ItemSpecChips
        dimensionCell={plan.dimensionCellShown ?? plan.dimensionCell}
        fromImperial={plan.dimensionFromImperial === true}
        chipClassName={chipClassName}
        dimensionTitle={
          plan.dimensionFromImperial
            ? `The Dimensions cell this item will carry. BWS receives it in millimetres: ${plan.dimensionCell}`
            : "The Dimensions cell this item will carry, composed as the export writes it"
        }
        finishes={finishes.map((attribute, index) => ({
          key: `${attribute.materialCode ?? "finish"}-${index}`,
          label: `${attribute.materialCode ?? "—"} → ${fieldDisplayName(attribute.specFieldName) ?? "no field"}`,
          tone: attribute.specFieldId ? "plain" : "blocked",
          title: attribute.value,
        }))}
      >
        <span>
          {notes.length} note{notes.length === 1 ? "" : "s"}
        </span>
        <Button variant="quiet" size="xs" aria-expanded={open} onClick={onToggle}>
          {open ? "Hide" : "Show"} all {plan.statements.length} statement{plan.statements.length === 1 ? "" : "s"}
        </Button>
      </ItemSpecChips>
      {/* THE UNIT OF A SIZE THAT PRINTS NONE. Offered only where the placed
          size states no unit in its figures, its label or its column heading,
          so a printed unit can never be changed here. A person's choice, so it
          is not badged as a guess — but the row says it was set on review. */}
      {plan.unitMissing && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {onSetUnit ? (
            <label className="flex items-center gap-1 text-neutral-600">
              Unit:
              <select
                className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs"
                value={plan.unitSetOnReview ?? ""}
                disabled={busy}
                onChange={(event) => onSetUnit(isBillUnitOverride(event.target.value) ? event.target.value : null)}
              >
                <option value="">—</option>
                {BILL_UNIT_OVERRIDES.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            plan.unitSetOnReview && <span className="text-neutral-600">Unit: {plan.unitSetOnReview}</span>
          )}
          {plan.unitSetOnReview && (
            <Chip tone="info" title="The bill prints no unit for this size; a reviewer set it">
              unit set on review
            </Chip>
          )}
        </div>
      )}
      {plan.cautions.map((caution) => (
        <p key={caution} className={`text-xs ${TONE.warn.text}`}>
          {caution}
        </p>
      ))}
      {/* THE ANSWER BESIDE THE QUESTION. A D with no W is the shape a round
          item is written in when D means its diameter; the person looking at
          the bill says which, and the plan places it so. "It's a depth" is
          the third answer, so a caution somebody has checked can be put away. */}
      {depthKey && onSetSlot && (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="secondary" size="xs" disabled={busy} onClick={() => onSetSlot(depthKey, "DIA")}>
            It&apos;s the diameter
          </Button>
          <Button variant="secondary" size="xs" disabled={busy} onClick={() => onSetSlot(depthKey, "W")}>
            It&apos;s the width
          </Button>
          <Button variant="quiet" size="xs" disabled={busy} onClick={() => onSetSlot(depthKey, "D")}>
            It&apos;s a depth
          </Button>
        </div>
      )}
      {/* A FIGURE PRINTED WITH NO LETTER beside a lettered one — the 710 of
          `700 DIA X 710MM`. The line does not say its slot, so the plan keeps
          it a note and asks; the slots are offered here, beside the caution,
          so nobody has to open the statements to answer it. Pressing "note"
          answers it too. */}
      {onSetSlot &&
        (plan.unletteredAwaiting ?? []).map((key) => {
          const part = plan.attributes.find((attribute) => attribute.part?.key === key)?.part;
          if (!part) return null;
          return (
            <div key={key} className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
              <span className="font-mono">{key}</span> is:
              <SlotPicker current="note" figure={key} busy={busy} currentClickable onPick={(slot) => onSetSlot(key, slot)} />
            </div>
          );
        })}
      {plan.revisionRefusal && <p className={`text-xs ${TONE.warn.text}`}>{plan.revisionRefusal}</p>}
    </div>
  );
}

/** What one figure becomes, in the reviewer's words: `W 720 mm`, `H 2'-4" (711mm)`, or a note. */
export function figureBecomes(figure: Pick<PlanFigure, "slot" | "figure" | "unit">): string {
  if (figure.slot === "note") return "a note";
  const short = figure.slot === "DIA" ? "Dia" : figure.slot;
  if (valueCarriesItsUnit(figure.figure) || figure.unit === "in") {
    const mm = toMillimetres(figure.figure, "in");
    const printed = valueCarriesItsUnit(figure.figure) ? figure.figure : `${figure.figure}"`;
    return `${short} ${printed}${mm.ok ? ` (${mm.mm}mm)` : ""}`;
  }
  return figure.unit ? `${short} ${figure.figure} ${figure.unit}` : `${short} ${figure.figure} (no unit)`;
}

/** Where a figure is printed, in words: `1st of “720 X 1400 X 720MM” · no letter printed`. */
function figureWhere(figure: PlanFigure): string {
  const nth = ["1st", "2nd", "3rd"][figure.ordinal - 1] ?? `${figure.ordinal}th`;
  const at = figure.of > 1 ? `${nth} of “${figure.line}”` : `“${figure.line}”`;
  const letter = figure.assumed
    ? "no letter printed"
    : figure.printed
      ? `printed as ${figure.printed === "DIA" ? "Dia" : figure.printed}`
      : "no letter printed";
  return `${at} · ${letter}`;
}

/**
 * THE LINE EXPANDED, top to bottom (workstream E, 2026-10-15): what BWS
 * receives, large; ONE row per figure the line prints, each with the same
 * picker; everything else the line says beside what it is written as; and the
 * bill as printed LAST, in a box labelled as the document. Matthew read the
 * old right-hand "As printed" column as the output (26:08) — the document is
 * never a column beside what is written.
 */
export function BillDescriptionPanelRow({
  plan,
  raw,
  colSpan,
  onSetSlot,
  busy = false,
}: {
  plan: ReviewDescription;
  /** The cell as the bill printed it. */
  raw: string;
  colSpan: number;
  onSetSlot?: SetSlot;
  busy?: boolean;
}) {
  const figures = plan.figures ?? [];
  // Everything that is not one figure: finishes, words, and a size line kept
  // whole as a note — which says why, so it stays listed beside its figures.
  const rest = plan.attributes.filter((attribute) => !attribute.slot && !attribute.part);
  const shownCell = { text: plan.dimensionCellShown ?? plan.dimensionCell, fromImperial: plan.dimensionFromImperial === true };
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
        <div className="space-y-3">
          <WhatBwsReceives
            shown={shownCell}
            fileText={plan.dimensionCell}
            empty={figures.length > 0 ? "No slot filled yet — give a figure its slot below." : "This line gives no size."}
          />
          {figures.length > 0 && (
            <div>
              <p className="mb-1 text-th font-bold uppercase tracking-wider text-neutral-500">Each figure the bill prints</p>
              <table className="w-full rounded-lg border border-neutral-200 bg-white text-xs" data-testid="bill-figures">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="w-[40%] px-3 py-1.5 font-normal">Figure, as the bill prints it</th>
                    <th className="px-3 py-1.5 font-normal">Is</th>
                    <th className="px-3 py-1.5 font-normal">Becomes</th>
                  </tr>
                </thead>
                <tbody>
                  {figures.map((figure) => {
                    const guessed = figure.assumed && !figure.overridden && figure.slot !== "note";
                    return (
                      <tr
                        key={figure.key}
                        className={`border-t border-neutral-100 align-top ${guessed ? TONE.guess.row : figure.overridden ? TONE.info.row : ""}`}
                        data-figure={figure.key}
                      >
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-sm font-semibold text-neutral-900">{figure.figure}</span>
                          {figure.unit && <span className="ml-1 text-neutral-500">{figure.unit}</span>}
                          <p className="text-neutral-500">{figureWhere(figure)}</p>
                        </td>
                        <td className="px-3 py-1.5">
                          {onSetSlot ? (
                            <SlotPicker
                              current={figure.slot}
                              figure={figure.figure}
                              busy={busy}
                              currentClickable
                              onPick={(slot) => onSetSlot(figure.key, slot)}
                            />
                          ) : (
                            <span className="font-mono">{figure.slot === "note" ? "note" : figure.slot}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={figure.slot === "note" ? "text-neutral-500" : "font-mono font-semibold text-neutral-900"}>
                            {figureBecomes(figure)}
                          </span>
                          {guessed && (
                            <Chip tone="guess" className="ml-1.5" title="The line prints no letter: the slot comes from printed order">
                              order assumed
                            </Chip>
                          )}
                          {figure.overridden && (
                            <>
                              <Chip tone="info" className="ml-1.5" title={`The bill printed ${figureWhere(figure)}`}>
                                set by you
                              </Chip>
                              {onSetSlot && (
                                <Button variant="quiet" size="xs" className="ml-1" disabled={busy} onClick={() => onSetSlot(figure.key, null)}>
                                  Undo
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rest.length > 0 && (
            <div>
              <p className="mb-1 text-th font-bold uppercase tracking-wider text-neutral-500">Everything else the bill says about it</p>
              <table className="w-full rounded-lg border border-neutral-200 bg-white text-xs">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="w-[40%] px-3 py-1.5 font-normal">The bill says</th>
                    <th className="w-[22%] whitespace-nowrap px-3 py-1.5 font-normal">Written as</th>
                    <th className="px-3 py-1.5 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((attribute, index) => (
                    <tr key={index} className="border-t border-neutral-100 align-top">
                      <td className="px-3 py-1.5 font-mono text-neutral-800">
                        {attribute.label}: {attribute.value}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-800">
                        {becomes(attribute)}
                        {attribute.materialCode && isFinish(attribute) && (
                          <span className="text-neutral-500"> · {attribute.materialCode} filed in the finishes library</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-600">{attribute.why ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* THE DOCUMENT, LAST, and labelled as the document. */}
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2" data-testid="bill-as-printed">
            <p className="text-th font-bold uppercase tracking-wider text-neutral-500">
              The bill, as printed <span className="font-normal normal-case tracking-normal">— the document, not what is written</span>
            </p>
            {raw.trim() !== "" && (
              <p className="mt-1 whitespace-pre-line font-mono text-xs text-neutral-800">{raw.replace(/\r\n?/g, "\n")}</p>
            )}
            {/* A BILL'S OWN DIMS AND FINISH COLUMNS, as printed under their
                headings — read by the same reader as the description's lines. */}
            {groupColumnCells(plan.columnCells ?? []).map((cell) => (
              <div key={cell.heading} className="mt-1.5">
                <p className="text-xs text-neutral-500">The bill&apos;s {cell.heading} column</p>
                <p className="whitespace-pre-line font-mono text-xs text-neutral-800">{cell.lines.join("\n")}</p>
              </div>
            ))}
            <p className="mt-1 text-xs text-neutral-500">Every statement is kept on the record, sourced to this bill with no page.</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** A Dims cell of several lines is several cells of one column: shown as the one cell it was. */
function groupColumnCells(cells: { heading: string; value: string }[]): { heading: string; lines: string[] }[] {
  const out: { heading: string; lines: string[] }[] = [];
  for (const cell of cells) {
    const last = out[out.length - 1];
    if (last && last.heading === cell.heading) last.lines.push(cell.value);
    else out.push({ heading: cell.heading, lines: [cell.value] });
  }
  return out;
}

/**
 * ONE UNIT FOR EVERY SIZE ON THE SHEET THAT PRINTS NONE — the real Butler
 * bedrooms bill prints no unit on eight of its nine sized rows, and eight
 * selects is eight clicks for one fact. Shown only where at least one live
 * line's size prints no unit and nobody has set it yet. Apply writes the same
 * per-line unit those selects write, onto exactly the lines counted, in one
 * request: never over a line a person already set, never over a printed unit.
 */
export function BillUnitAll({
  count,
  busy = false,
  onApply,
}: {
  count: number;
  busy?: boolean;
  onApply: (unit: BillUnitOverride) => void;
}) {
  const [unit, setUnit] = useState<BillUnitOverride>("mm");
  if (count === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs ${TONE.warn.note}`}>
      <span className={TONE.warn.text}>
        {count} item{count === 1 ? " has" : "s have"} a size with no unit — set them all to
      </span>
      <select
        aria-label="Unit for every size with none"
        className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs"
        value={unit}
        disabled={busy}
        onChange={(event) => {
          if (isBillUnitOverride(event.target.value)) setUnit(event.target.value);
        }}
      >
        {BILL_UNIT_OVERRIDES.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
      <Button size="xs" variant="secondary" disabled={busy} onClick={() => onApply(unit)}>
        Apply
      </Button>
    </div>
  );
}
