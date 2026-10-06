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
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import ItemSpecChips from "@/components/records/ItemSpecChips";
import {
  BILL_UNIT_OVERRIDES,
  isBillUnitOverride,
  type BillDescriptionPlan,
  type BillUnitOverride,
  type PlannedAttribute,
  type SlotOverride,
} from "@/lib/bill-description";
import { DIMENSION_SLOT_LABELS, DIMENSION_SLOTS } from "@/lib/spec-vocab";
import { toMillimetres, valueCarriesItsUnit } from "@/lib/dimensions";

/** Set a size part's slot (`null` puts it back as printed). Absent where the line cannot change. */
export type SetSlot = (key: string, slot: SlotOverride | null) => void;

/** Say the unit of a size that prints none (`null` takes it back). Absent where the line cannot change. */
export type SetUnit = (unit: BillUnitOverride | null) => void;

const SLOT_CHOICES: { value: SlotOverride; short: string; long: string }[] = [
  ...DIMENSION_SLOTS.map((slot) => ({
    value: slot as SlotOverride,
    short: slot === "DIA" ? "Dia" : slot,
    long: DIMENSION_SLOT_LABELS[slot].toLowerCase(),
  })),
  { value: "note", short: "note", long: "a note, not a slot" },
];

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
  if (isFinish(attribute)) return attribute.specFieldName ? `${attribute.specFieldName}` : "a finish in no BWS field";
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
          label: `${attribute.materialCode ?? "—"} → ${attribute.specFieldName ?? "no field"}`,
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
      {plan.revisionRefusal && <p className={`text-xs ${TONE.warn.text}`}>{plan.revisionRefusal}</p>}
    </div>
  );
}

/** Every statement of the cell, verbatim, beside what the confirm writes for it — and the cell as printed. */
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
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3 font-normal">The bill says</th>
                <th className="py-1 pr-3 font-normal">Written as</th>
                <th className="py-1 font-normal">Why</th>
              </tr>
            </thead>
            <tbody>
              {plan.attributes.map((attribute, index) => (
                <tr key={index} className="border-t border-neutral-200 align-top">
                  <td className="py-1 pr-3 font-mono text-neutral-800">
                    {attribute.label}: {attribute.value}
                  </td>
                  <td className="py-1 pr-3 text-neutral-800">
                    {becomes(attribute)}
                    {attribute.materialCode && isFinish(attribute) && (
                      <span className="text-neutral-500"> · {attribute.materialCode} filed in the finishes library</span>
                    )}
                    {attribute.part?.overridden && (
                      <Chip tone="info" className="ml-1.5" title={`The bill printed ${attribute.part.key}`}>
                        changed on review
                      </Chip>
                    )}
                    {attribute.part && onSetSlot && (
                      <SlotControl
                        part={attribute.part}
                        current={attribute.slot ?? "note"}
                        busy={busy}
                        onSetSlot={onSetSlot}
                      />
                    )}
                  </td>
                  <td className="py-1 text-neutral-600">{attribute.why ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="mb-1 text-xs text-neutral-500">As printed</p>
            <p className="whitespace-pre-line rounded border border-neutral-200 bg-white p-2 font-mono text-xs text-neutral-800">
              {raw.replace(/\r\n?/g, "\n")}
            </p>
            {/* A BILL'S OWN DIMS AND FINISH COLUMNS, as printed under their
                headings — read by the same reader as the description's lines. */}
            {(plan.columnCells ?? []).map((cell) => (
              <div key={cell.column} className="mt-2">
                <p className="mb-1 text-xs text-neutral-500">The bill&apos;s {cell.heading} column</p>
                <p className="whitespace-pre-line rounded border border-neutral-200 bg-white p-2 font-mono text-xs text-neutral-800">
                  {cell.value}
                </p>
              </div>
            ))}
            <p className="mt-1 text-xs text-neutral-500">
              {(plan.columnCells ?? []).length === plan.statements.length
                ? "Each column cell is written to the record, sourced to this bill with no page."
                : (plan.columnCells ?? []).length > 0
                  ? "Every line after the first, and each column cell, is written to the record, sourced to this bill with no page."
                  : "Every line after the first is written to the record, sourced to this bill with no page."}
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

/**
 * W · D · H · SH · Dia · note for one size part. BUTTONS, never a select: a
 * select already showing "D" fires no change when somebody picks D, so the
 * press recording "yes, it is a depth" would do nothing — the level picker's
 * trap. The current slot is pressed; "As printed" removes the change.
 */
function SlotControl({
  part,
  current,
  busy,
  onSetSlot,
}: {
  part: NonNullable<PlannedAttribute["part"]>;
  current: SlotOverride;
  busy: boolean;
  onSetSlot: SetSlot;
}) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-0.5" role="group" aria-label={`What ${part.key} is`}>
      {SLOT_CHOICES.map((choice) => {
        const pressed = choice.value === current;
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={pressed}
            title={`${part.key} is ${choice.long}`}
            disabled={busy}
            onClick={() => onSetSlot(part.key, choice.value)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[11px] leading-4 disabled:opacity-50 ${
              pressed
                ? "border-neutral-800 bg-neutral-800 text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
            }`}
          >
            {choice.short}
          </button>
        );
      })}
      {part.overridden && (
        <Button variant="quiet" size="xs" disabled={busy} onClick={() => onSetSlot(part.key, null)}>
          As printed
        </Button>
      )}
    </span>
  );
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
