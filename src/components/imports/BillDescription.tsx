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
// ============================================================================
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import type { BillDescriptionPlan, PlannedAttribute } from "@/lib/bill-description";
import { DIMENSION_SLOT_LABELS } from "@/lib/spec-vocab";

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
}: {
  plan: ReviewDescription;
  open: boolean;
  onToggle: () => void;
}) {
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
      {plan.revisionRefusal && <p className={`text-xs ${TONE.warn.text}`}>{plan.revisionRefusal}</p>}
    </div>
  );
}

/** Every statement of the cell, verbatim, beside what the confirm writes for it — and the cell as printed. */
export function BillDescriptionPanelRow({
  plan,
  raw,
  colSpan,
}: {
  plan: ReviewDescription;
  /** The cell as the bill printed it. */
  raw: string;
  colSpan: number;
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
