"use client";

// One panel per phase on the project page: the phase's spec table, where the
// phase came from, and Retire this phase with its required reason. Moved out
// of src/app/dashboard/projects/[id]/page.tsx on 2026-11-07 (audit 5.3, cut B).
//
// The tab STRIP stays in the page's header band, beside Overview, Finishes,
// Documents and History; this is what each phase's tab shows when chosen.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import SpecTable, { type Focus, type RunTally } from "@/components/records/SpecTable";
import Button from "@/components/ui/Button";
import { NO_CODES_PHASE_SENTENCE } from "@/lib/bill-sheet-notices";

export type SpecRun = {
  id: string;
  name: string;
  /** Sent back when the phase is retired, so a phase changed since this load is refused (audit A16). */
  version: number;
  source_sheet: string | null;
  boq_revision: string | null;
  boq_date: string | null;
  header_notes: string[];
  /** A bill made this phase and none of its items carries a code (`NO_CODES_PHASE_SENTENCE`). */
  bill_without_codes?: boolean;
  record_count: string;
  attribute_count: string;
};

export default function PhaseTabs({
  projectId,
  runs,
  tab,
  initialFocus,
  onRunSummary,
  onReload,
  onError,
  onRetired,
}: {
  projectId: string;
  runs: SpecRun[];
  /** The page's URL tab: a phase's panel renders only when it is chosen. */
  tab: string;
  initialFocus: Focus;
  onRunSummary: (runId: string, tally: RunTally) => void;
  /** The page's whole load, which a retire is reported after. */
  onReload: () => Promise<void>;
  onError: (message: string | null) => void;
  /** The retired phase's tab is gone: the page goes back to the Overview. */
  onRetired: () => void;
}) {
  const [retiringRun, setRetiringRun] = useState<string | null>(null);
  const [retireRunReason, setRetireRunReason] = useState("");
  const [retiringBusy, setRetiringBusy] = useState(false);

  async function retireRun(run: SpecRun) {
    if (!retireRunReason.trim()) return;
    const runId = run.id;
    setRetiringBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${runId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "retired", reason: retireRunReason.trim(), version: run.version }),
      });
      // Reload first, then report. This screen clears its banner on a
      // successful load, so setting the message first would show a refusal for
      // a few milliseconds and then nothing at all.
      await onReload();
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onError(null);
      setRetiringRun(null);
      setRetireRunReason("");
      // The retired run has left the tabs, so the tab it was on no longer
      // exists. Back to the overview rather than a blank panel.
      onRetired();
    } finally {
      // Always reset: a non-JSON error must not leave the dialog frozen.
      setRetiringBusy(false);
    }
  }

  return (
    <>
      {runs.map((run) =>
        tab === run.id ? (
          <section key={run.id}>
            <SpecTable
              projectId={projectId}
              runId={run.id}
              onSummary={(tally) => onRunSummary(run.id, tally)}
              initialFocus={initialFocus}
            />

            {/* WHERE THIS RUN CAME FROM, AT THE BOTTOM. It is provenance —
                read once when somebody asks which revision they are looking
                at, and never while working down the records. Above the table
                it cost four lines of the screen on every visit. */}
            <p className="mt-4 text-xs text-neutral-500">
              {run.source_sheet && <>from sheet “{run.source_sheet}”</>}
              {run.boq_revision && <> · revision {run.boq_revision}</>}
              {run.boq_date && <> · dated {run.boq_date}</>}
            </p>
            {run.header_notes?.length > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                The bill said: {run.header_notes.join(" · ")}
              </p>
            )}
            {/* A BILL WITH NO CODES, said once, beside what the bill said:
                amber, because the revision it warns about needs a person to
                pair every line by hand. */}
            {run.bill_without_codes && (
              <p className="mt-1 text-xs text-amber-800" role="note">
                {NO_CODES_PHASE_SENTENCE}
              </p>
            )}

            {/* Retiring a phase takes a whole sub-quote out of the tabs and out
                of the export. Every record on it goes with it, and both can be
                brought back — but the reason is required, because whoever
                finds the gap later needs to know why it is there. */}
            {retiringRun === run.id ? (
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-900">Retire “{run.name}”?</p>
                <p className="mt-0.5 text-xs text-red-800">
                  Its {run.record_count} record{Number(run.record_count) === 1 ? "" : "s"} stop being live: they
                  leave this project&rsquo;s export and its tabs. Nothing is deleted, and the phase can be brought
                  back. A BWS job already created from one of these records is NOT removed by its absence from the
                  export — check those by hand.
                </p>
                <input
                  value={retireRunReason}
                  autoFocus
                  onChange={(event) => setRetireRunReason(event.target.value)}
                  placeholder="Superseded by the Rev B bill confirmed on 16 Sep"
                  className="mt-2 w-full rounded border border-red-300 bg-white px-2 py-1 text-sm"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!retireRunReason.trim() || retiringBusy}
                    onClick={() => void retireRun(run)}
                  >
                    {retiringBusy ? "Retiring…" : "Retire the phase"}
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setRetiringRun(null)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="xs"
                variant="danger"
                className="mt-3"
                onClick={() => {
                  setRetiringRun(run.id);
                  setRetireRunReason("");
                }}
              >
                Retire this phase
              </Button>
            )}
          </section>
        ) : null,
      )}
    </>
  );
}
