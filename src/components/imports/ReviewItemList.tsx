"use client";

// Every item on a long review screen, one line each — the stepper's list.
//
// ============================================================================
// A 44-PAGE PACK IS 26,000 PIXELS OF CARDS.
//
// The stepper says "Item 3 of 15" and moves one at a time; what a reviewer
// could not do was see the whole set, jump to the one they want, or tell what
// is left. So the stepper carries a compact list — the code, the name, how many
// rows are still to review, and a marker where the card cannot confirm —
// collapsed until asked for, scrolling inside its own box so sixty items do
// not push the cards off the screen.
//
// "Pending only" hides settled cards from the list AND the screen. It narrows
// what is LISTED, never what is ASKED: every card still confirms exactly what
// it covers, and nothing a filter hides is changed by hiding it.
// ============================================================================
import { useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";

export type ReviewItemLine = {
  key: string;
  code: string;
  name: string | null;
  /** Rows still to review on the card. */
  pending: number;
  /** Why the card cannot confirm, or null. */
  blocked: string | null;
};

export default function ReviewItemList({
  lines,
  current,
  onJump,
  pendingOnly,
  onPendingOnly,
  settledHidden,
}: {
  lines: readonly ReviewItemLine[];
  current: number;
  onJump: (index: number) => void;
  pendingOnly: boolean;
  onPendingOnly: (value: boolean) => void;
  /** How many settled cards "pending only" is hiding, so the filter says so. */
  settledHidden: number;
}) {
  const [open, setOpen] = useState(false);
  const blocked = lines.filter((line) => line.blocked).length;
  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <Button size="xs" variant="quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide the item list" : `All ${lines.length} items`}
        </Button>
        {blocked > 0 && <Chip tone="warn">{blocked} cannot confirm yet</Chip>}
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-xs text-neutral-700">
          <input type="checkbox" checked={pendingOnly} onChange={(event) => onPendingOnly(event.target.checked)} />
          Pending only
          {pendingOnly && settledHidden > 0 && (
            <span className="text-neutral-500">({settledHidden} settled hidden)</span>
          )}
        </label>
      </div>
      {open && (
        <ol aria-label="Items on this screen" className="max-h-80 overflow-y-auto border-t border-neutral-200 py-1">
          {lines.map((line, index) => (
            <li key={line.key}>
              <button
                type="button"
                onClick={() => onJump(index)}
                aria-current={index === current ? "true" : undefined}
                title={line.blocked ?? undefined}
                className={`flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-xs hover:bg-neutral-50 ${
                  index === current ? "bg-sky-50" : ""
                }`}
              >
                <span className="w-6 shrink-0 text-right tabular-nums text-neutral-400">{index + 1}</span>
                <span className="shrink-0 font-mono font-semibold text-neutral-900">{line.code}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-600">{line.name ?? ""}</span>
                <span className="shrink-0 tabular-nums text-neutral-600">
                  {line.pending === 0 ? "settled" : `${line.pending} to review`}
                </span>
                {line.blocked && <span className="shrink-0 font-medium text-amber-700">blocked</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
