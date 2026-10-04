"use client";

// "Use this drawing's values over the bill's" — one press per card (brief G).
//
// The bill is confirmed first and writes sizes and finish codes onto each
// record, so a drawing card for the same item finds slot after slot taken and
// asks, row by row, to replace each. Asking is right; a tick per row on every
// card is the friction. This sets exactly the acknowledgements those ticks
// would have set — only for values THE BILL wrote, each at the version shown —
// and names every one of them BEFORE the press. A value a person typed or
// another drawing gave is never in the list: it keeps its own tick.
//
// After the press the same panel says what confirming will replace, with one
// press to put the bill's values back. Nothing is written until the card's own
// Confirm: this only records the decision.
import {
  describeBillReplacements,
  withBillAcknowledgements,
  type BillReplacement,
} from "@/lib/bill-over-drawing";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import Button from "@/components/ui/Button";
import Note from "@/components/ui/Note";

export type BillValuesGroup = {
  item: DrawingItem;
  /** The server's `billReplacements` for this item; absent or empty is none. */
  entries: readonly BillReplacement[] | undefined;
  /** Prefixed to each line where a card stacks several pages: "A · ". */
  prefix?: string;
};

export type BillValuesEdit = { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> };

/** One edit per row: its whole `replaces` list with these entries set or cleared. */
export function billValuesEdits(groups: readonly BillValuesGroup[], on: boolean): BillValuesEdit[] {
  const edits: BillValuesEdit[] = [];
  for (const { item, entries } of groups) {
    const relevant = (entries ?? []).filter((entry) => entry.acknowledged !== on);
    for (const observation of item.observations) {
      const mine = relevant.filter((entry) => entry.observationId === observation.id);
      if (mine.length === 0) continue;
      edits.push({ item, observation, changes: { replaces: withBillAcknowledgements(observation, mine, on) } });
    }
  }
  return edits;
}

export default function BillValuesAction({
  groups,
  fieldName,
  busy,
  onSave,
}: {
  groups: readonly BillValuesGroup[];
  /** A BWS field's name, for a finish line: "Main metal finish MTL-01 → …". */
  fieldName: (fieldId: string) => string | null;
  busy: boolean;
  /** Every row's acknowledgements in ONE batched save, reloaded once. */
  onSave: (edits: BillValuesEdit[]) => void;
}) {
  const all = groups.flatMap((group) => (group.entries ?? []).map((entry) => ({ group, entry })));
  if (all.length === 0) return null;

  const outstanding = all.filter(({ entry }) => !entry.acknowledged);
  const shown = outstanding.length > 0 ? outstanding : all;
  const lines = groups.flatMap((group) =>
    describeBillReplacements(
      group.item,
      shown.filter((pair) => pair.group === group).map((pair) => pair.entry),
      fieldName,
    ).map((line) => ({ key: `${group.item.id}:${line.observationId}`, text: `${group.prefix ?? ""}${line.text}` })),
  );

  if (outstanding.length > 0) {
    return (
      <Note
        tone="warn"
        title="The bill already gave this item some of these values."
        actions={
          <Button variant="danger" size="xs" disabled={busy} onClick={() => onSave(billValuesEdits(groups, true))}>
            Use this drawing&rsquo;s values over the bill&rsquo;s ({lines.length})
          </Button>
        }
      >
        Confirming would replace them. One press ticks every one of these; the per-row ticks below stay for keeping
        some. The bill&rsquo;s values are kept, marked retired.
        <ul className="mt-1 list-none font-mono text-[12px]">
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      </Note>
    );
  }
  return (
    <Note
      tone="info"
      title="Confirming replaces the bill's values with this drawing's:"
      actions={
        <Button variant="quiet" size="xs" disabled={busy} onClick={() => onSave(billValuesEdits(groups, false))}>
          Keep the bill&rsquo;s values
        </Button>
      }
    >
      <ul className="mt-1 list-none font-mono text-[12px]">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </Note>
  );
}
