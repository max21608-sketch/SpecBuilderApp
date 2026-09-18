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
//
// ---- AND THE GATES BUILD ON EACH OTHER -------------------------------------
//
// This panel printed `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓`,
// which cannot be true: a record cannot be at production lock over a price
// nobody could quote. `chainGates` is the fix and this is where it shows.
//
// A gate is one of FOUR things here, and the fourth is the one that was
// missing:
//
//   settled        own fields settled, every earlier gate settled. GREEN ✓.
//   outstanding    it is this gate's turn and there is work on it. RED.
//   not reached    an earlier gate is not met. SLATE, naming the gate to do
//                  first. Its own count still shows, because hiding it would
//                  lose what the screen used to say — but it is not red, for
//                  the reason `unanswerable` is not red: work that cannot
//                  start yet is not work on somebody's desk today.
//   no matrix      the category is not on Matthew's nine. Said in words.
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

/**
 * What a gate is waiting on, in words.
 *
 * The EARLIEST unmet gate is named, because that is the one to do next — the
 * later ones in `blockedBy` follow from it. The full list is on the panel.
 */
function waitingOn(status: GateStatus): Gate | null {
  return status.blockedBy[0] ?? null;
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
          const first = waitingOn(status);
          const isOpen = open === gate;
          // THREE TONES, NOT TWO. A gate that has not been reached is not the
          // reviewer's work today, so it is slate rather than red — and it is
          // never green, whatever its own fields say.
          const tone = status.satisfied
            ? "text-green-700 border-green-300 bg-green-50 hover:bg-green-100"
            : first
              ? "text-slate-600 border-slate-300 border-dashed bg-slate-50 hover:bg-slate-100"
              : "text-red-700 border-red-300 bg-red-50 hover:bg-red-100";
          return (
            <button
              key={gate}
              type="button"
              onClick={() => setOpen(isOpen ? null : gate)}
              aria-expanded={isOpen}
              title={
                first
                  ? `${GATE_LABELS[gate]} — not reached: ${GATE_SHORT_LABELS[first]} comes first`
                  : GATE_LABELS[gate]
              }
              className={`text-xs px-2 py-1 rounded border transition-colors ${tone} ${
                isOpen ? "ring-2 ring-offset-1 ring-neutral-300" : ""
              }`}
            >
              {GATE_SHORT_LABELS[gate]}{" "}
              {status.satisfied
                ? "✓"
                : first
                  ? /* Its own count still shows where there is one, so the
                       panel never says less than it used to — but the reading
                       leads with the gate that has to happen first. */
                    left > 0
                    ? `${GATE_SHORT_LABELS[first]} first · ${left} of its own`
                    : `${GATE_SHORT_LABELS[first]} first`
                  : `${left} outstanding`}
            </button>
          );
        })}
        <span className="text-xs text-neutral-400">
          Matthew&rsquo;s decision matrix, 17 Sep. Each gate needs the one before it. Click a gate to see what it
          wants.
        </span>
      </div>

      {shown && (
        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="text-xs text-neutral-500">{GATE_LABELS[shown.gate]}</p>

          {/* NOT REACHED, AND WHY — above the field list, because the list
              below is not what to do next. The earlier gates are named with
              their own counts and each one opens from here, so "TG1 is fine,
              go and look at TGQ" is one click rather than a hunt. The list
              itself stays THIS gate's own rows: that is what was asked for,
              and mixing three gates' fields into one list is how the panel
              became unreadable in the first place. */}
          {shown.blockedBy.length > 0 && (
            <div className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">
                {GATE_SHORT_LABELS[shown.gate]} has not been reached yet.
              </p>
              <p className="mt-1 text-xs text-slate-600">
                The gates build on each other, so {GATE_SHORT_LABELS[shown.gate]} cannot be met until{" "}
                {shown.blockedBy.map((g) => GATE_SHORT_LABELS[g]).join(" and ")}{" "}
                {shown.blockedBy.length === 1 ? "is" : "are"}.{" "}
                {shown.ownSatisfied
                  ? `Every field ${GATE_SHORT_LABELS[shown.gate]} asks for is settled — that is all this gate can tell you today.`
                  : `The ${outstanding(shown)} outstanding below ${
                      outstanding(shown) === 1 ? "is" : "are"
                    } real, and ${GATE_SHORT_LABELS[shown.blockedBy[0]!]} comes first.`}
              </p>
              {/* WHOSE PROBLEM THE EARLIER GATE IS, broken out. `unanswerable`
                  is the app having nowhere to put the answer, and on this
                  data it is the commonest blocker of all — so a button
                  reading "TGQ — 2 outstanding" would put an app gap on a
                  reviewer's desk as if they could clear it. Same argument
                  that keeps `unanswerable` slate in the list below. */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {shown.blockedBy.map((gate) => {
                  const c = gates[gate].counts;
                  const toAnswer = c.blocking + c.unknown;
                  const parts = [
                    toAnswer > 0 ? `${toAnswer} to answer` : null,
                    c.unanswerable > 0 ? `${c.unanswerable} nowhere to record` : null,
                  ].filter(Boolean);
                  return (
                    <button
                      key={gate}
                      type="button"
                      onClick={() => setOpen(gate)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        toAnswer > 0
                          ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                          : "border-slate-300 border-dashed bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {GATE_SHORT_LABELS[gate]} — {parts.join(", ")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
