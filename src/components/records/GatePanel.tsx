"use client";
// Matthew's gate matrix for one record: what each gate still wants.
//
// ============================================================================
// THE PANEL'S JOB IS TO SAY WHOSE PROBLEM EACH ROW IS.
//
// A flat "12 outstanding" is the number the checklist already gives, and it is
// the number that made the checklist unusable: 43 questions with no sense of
// which matter when. The five outcomes are here because three of them are not
// a reviewer's fault and must not read as one --
//
//   blocking       somebody has to answer it. RED.
//   unknown        a conditional whose controller is unanswered. AMBER: we
//                  cannot tell whether it even applies.
//   unanswerable   the app has nowhere to put the answer. SLATE and dashed,
//                  deliberately not red: the fix is a seed or a migration, and
//                  putting it in the red list teaches somebody to ignore red.
//
// Colour follows the house reading: red blocks, amber is "cannot tell yet",
// green is settled, grey is genuinely not applicable.
// ============================================================================
import { useState } from "react";
import {
  GATES,
  GATE_LABELS,
  GATE_SHORT_LABELS,
  NO_MATRIX_CATEGORY_EXPLANATION,
  NO_MATRIX_CATEGORY_LABEL,
  type Gate,
  type GateOutcome,
  type GateStatus,
} from "@/lib/gates";

const OUTCOME_CLASS: Record<GateOutcome, string> = {
  satisfied: "text-green-700 border-green-300 bg-green-50",
  blocking: "text-red-700 border-red-300 bg-red-50",
  unknown: "text-amber-800 border-amber-300 bg-amber-50",
  unanswerable: "text-slate-600 border-slate-300 border-dashed bg-slate-50",
  not_applicable: "text-neutral-500 border-neutral-300 bg-neutral-50",
};

const OUTCOME_LABEL: Record<GateOutcome, string> = {
  satisfied: "Settled",
  blocking: "Outstanding",
  unknown: "Cannot tell",
  unanswerable: "Nowhere to record it",
  not_applicable: "N/A",
};

/** Outstanding for the purposes of the pill: everything a gate is not happy with. */
function outstanding(status: GateStatus): number {
  return status.counts.blocking + status.counts.unknown + status.counts.unanswerable;
}

export default function GatePanel({ gates }: { gates: Record<Gate, GateStatus> | null }) {
  const [open, setOpen] = useState<Gate | null>(null);

  if (!gates) {
    return (
      <div className="mt-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <p className="text-sm font-medium text-neutral-700">{NO_MATRIX_CATEGORY_LABEL}</p>
        <p className="mt-1 text-xs text-neutral-500">{NO_MATRIX_CATEGORY_EXPLANATION}</p>
      </div>
    );
  }

  const shown = open ? gates[open] : null;

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm font-medium text-neutral-700">Gates</span>
        {GATES.map((gate) => {
          const status = gates[gate];
          const left = outstanding(status);
          const isOpen = open === gate;
          return (
            <button
              key={gate}
              type="button"
              onClick={() => setOpen(isOpen ? null : gate)}
              aria-expanded={isOpen}
              title={GATE_LABELS[gate]}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                status.satisfied
                  ? "text-green-700 border-green-300 bg-green-50 hover:bg-green-100"
                  : "text-red-700 border-red-300 bg-red-50 hover:bg-red-100"
              } ${isOpen ? "ring-2 ring-offset-1 ring-neutral-300" : ""}`}
            >
              {GATE_SHORT_LABELS[gate]} {status.satisfied ? "✓" : `${left} outstanding`}
            </button>
          );
        })}
        <span className="text-xs text-neutral-400">
          Matthew&rsquo;s decision matrix, 17 Sep. Click a gate to see what it wants.
        </span>
      </div>

      {shown && (
        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="text-xs text-neutral-500">{GATE_LABELS[shown.gate]}</p>
          <ul className="mt-2 divide-y divide-neutral-100">
            {shown.fields.map((row) => (
              <li key={row.field.matrixRow} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-900">{row.field.fieldName}</p>
                  <p className="text-xs text-neutral-500">{row.reason}</p>
                  {row.value && <p className="text-xs text-neutral-700 mt-0.5 font-mono break-words">{row.value}</p>}
                  {/* The palette he names and this app does not hold. Said in
                      words rather than offered as an empty dropdown, which
                      reads as broken. */}
                  {row.field.paletteRaw?.startsWith("From BWS") && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {row.field.paletteRaw} — not loaded in this app yet, so this stays free text.
                    </p>
                  )}
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded border ${OUTCOME_CLASS[row.outcome]}`}>
                  {OUTCOME_LABEL[row.outcome]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
