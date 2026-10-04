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
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import type { BillDescriptionPlan, PlannedAttribute, SlotOverride } from "@/lib/bill-description";
import { DIMENSION_SLOT_LABELS, DIMENSION_SLOTS } from "@/lib/spec-vocab";

/** Set a size part's slot (`null` puts it back as printed). Absent where the line cannot change. */
export type SetSlot = (key: string, slot: SlotOverride | null) => void;

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
  if (attribute.slot) return `${DIMENSION_SLOT_LABELS[attribute.slot]} ${attribute.value}${attribute.unit ?? ""}`;
  if (isFinish(attribute)) return attribute.specFieldName ? `${attribute.specFieldName}` : "a finish in no BWS field";
  return attribute.state === "tbc" ? "a note, TBC" : "a note";
}

export function BillDescriptionSummary({
  plan,
  open,
  onToggle,
  onSetSlot,
  busy = false,
}: {
  plan: ReviewDescription;
  open: boolean;
  onToggle: () => void;
  onSetSlot?: SetSlot;
  busy?: boolean;
}) {
  const depthKey = plan.depthWithoutWidth ?? null;
  const finishes = plan.attributes.filter(isFinish);
  const notes = plan.attributes.filter((attribute) => attribute.attrGroup === "note");
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
        {plan.dimensionCell ? (
          <Chip mono title="The Dimensions cell this item will carry, composed as the export writes it">
            {plan.dimensionCell}
          </Chip>
        ) : (
          <span className="text-neutral-500">no size placed</span>
        )}
        {finishes.map((attribute, index) => (
          <Chip
            key={`${attribute.materialCode ?? "finish"}-${index}`}
            mono
            tone={attribute.specFieldId ? "plain" : "blocked"}
            title={attribute.value}
          >
            {attribute.materialCode ?? "—"} → {attribute.specFieldName ?? "no field"}
          </Chip>
        ))}
        <span>
          {notes.length} note{notes.length === 1 ? "" : "s"}
        </span>
        <Button variant="quiet" size="xs" aria-expanded={open} onClick={onToggle}>
          {open ? "Hide" : "Show"} all {plan.statements.length} statement{plan.statements.length === 1 ? "" : "s"}
        </Button>
      </div>
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
            <p className="mt-1 text-xs text-neutral-500">
              Every line after the first is written to the record, sourced to this bill with no page.
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
