"use client";

// The card over each tab of a bill under review: its phase name, the sheet it
// came from, the revision it printed, what the reader did with it, which
// column each role came from, what it will do beyond its own phase, and
// whether it is a new phase or a revision of one. Moved out of
// src/app/dashboard/imports/[id]/page.tsx on 2026-11-06 (audit 5.3, cut A).
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import Tip from "@/components/ui/Tip";
import SuggestButton from "@/components/ui/SuggestButton";
// Pure and type-only inside: the parser's own wording for what it did with a
// sheet, so the screen cannot describe the parse differently from the parser.
import { describeHeader } from "@/lib/boq-import";
import { NO_CODES_REVIEW_SENTENCE, type BillSheetNotice } from "@/lib/bill-sheet-notices";
import { BOQ_ROLE_LABELS, BOQ_MAPPING_SOURCE_LABELS, columnLetter, type BoqReadRole } from "@/lib/boq-roles";
import type { ProjectRun, Sheet } from "@/components/imports/use-boq-import";
import { phaseSuggestionEvidence, phaseUndecided, type PhaseSuggestion } from "@/lib/phase-revision-suggest";

/** One read-only fact about the sheet, in the run card's four-column grid. */
function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-th font-semibold uppercase tracking-wider text-neutral-500">
        {label}
        {tip && <Tip>{tip}</Tip>}
      </span>
      <span className="mt-1.5 block font-mono text-[13px] text-neutral-900">{children}</span>
    </div>
  );
}

export default function SheetHeader({
  sheet,
  status,
  runs,
  suggestions = [],
  anchorId,
  busy,
  panelOpen,
  notice,
  onOpenPanel,
  onSetSheet,
}: {
  sheet: Sheet;
  /** The bill's run status: only a `parsed` bill can be changed. */
  status: string;
  /** The project's live phases, any of which this sheet may revise. */
  runs: ProjectRun[];
  /** The active phases this sheet looks like, best first (RV0). Empty where none. */
  suggestions?: PhaseSuggestion[];
  /** Where "Before you can confirm" points for the phase choice. */
  anchorId?: string;
  busy: boolean;
  /** Whether the sheet's Columns panel is open, so its button is not offered twice. */
  panelOpen: boolean;
  /** What the sheet will do beyond its own phase (`billSheetNotices`). */
  notice: BillSheetNotice | undefined;
  onOpenPanel: () => void;
  /** The sheet's phase name, dropping it, or the phase it revises. */
  onSetSheet: (patch: { runName?: string; ignored?: boolean; replacesRunId?: string | null }) => Promise<void>;
}) {
  return (
    <Card
      title="This tab becomes a phase"
      actions={
        <>
          {/* OFFERED ON EVERY BILL SHEET, including one the synonyms
              read: a wrong match is correctable only if it is
              visible, and the panel is where it is visible. */}
          {!panelOpen && status === "parsed" && (
            <Button size="xs" onClick={() => onOpenPanel()}>
              {sheet.needsColumns ? "Set the columns" : "Change columns"}
            </Button>
          )}
          <Button
            size="xs"
            disabled={status !== "parsed"}
            onClick={() => void onSetSheet({ ignored: !sheet.ignored })}
          >
            {sheet.ignored ? "Include this sheet" : "Drop this sheet"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="block text-th font-semibold uppercase tracking-wider text-neutral-500">
            Phase name
          </span>
          <input
            defaultValue={sheet.proposedRunName}
            disabled={status !== "parsed" || sheet.ignored}
            onBlur={(event) => {
              if (event.target.value.trim() === sheet.proposedRunName) return;
              void onSetSheet({ runName: event.target.value });
            }}
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 disabled:opacity-50"
          />
        </label>
        <Field label="Sheet">{sheet.sheetName}</Field>
        <Field
          label="Revision"
          tip="Kept as text, exactly as the sheet printed it. Parsing “14-Sep-26” into a date is how a day goes missing."
        >
          {[sheet.metadata?.revision, sheet.metadata?.date].filter(Boolean).join(" · ") || "— none printed —"}
        </Field>
      </div>

      {/* WHAT THE READER DID WITH THE SHEET, in sentences.
          Two bare fragments — "row 6 · 1 skipped" — read as a
          contradiction beside each other, and neither said what
          happened to the rows above the header. `describeHeader` is
          the single wording, so the screen cannot describe the parse
          differently from the parser. Printed, not a Tip: a reviewer
          who never hovers must not be left believing five rows were
          thrown away. */}
      <p className="mt-3 text-xs text-neutral-500">
        {/* A sheet nobody has mapped has a CANDIDATE header row — the
            closest the synonyms came — and describing it as "the
            header" would say the sheet was read when it was not. */}
        {sheet.needsColumns
          ? "Nothing has been read from this sheet yet — nobody has said which column is which."
          : describeHeader(sheet)}
      </p>

      {/* WHICH COLUMN EACH ROLE CAME FROM, printed with the panel
          closed too: "Spec Code is the code" is a statement a
          reviewer can check in a glance, where a column of codes
          alone does not say which column they came from. Absent on
          a v3 sheet, which never recorded it. */}
      {!sheet.needsColumns && sheet.columns && Object.keys(sheet.columns).length > 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          {sheet.mappingSource === "layout" && sheet.layout ? (
            <>
              Read with the {sheet.layoutOrigin === "seed" ? "standard " : ""}
              <b className="text-neutral-700">{sheet.layout.name}</b> layout:{" "}
            </>
          ) : sheet.mappingSource ? (
            <>Columns ({BOQ_MAPPING_SOURCE_LABELS[sheet.mappingSource]}): </>
          ) : null}
          {(Object.entries(sheet.columns) as [BoqReadRole, { index: number; heading: string }][])
            .sort((a, b) => a[1].index - b[1].index)
            .map(([role, ref]) => `${BOQ_ROLE_LABELS[role]} ← “${ref.heading || "no heading"}” (${columnLetter(ref.index)})`)
            .concat(
              (sheet.kept ?? []).map(
                (ref) => `${BOQ_ROLE_LABELS.keep} ← “${ref.heading || "no heading"}” (${columnLetter(ref.index)})`,
              ),
            )
            .join(" · ")}
        </p>
      )}

      {/* WHAT THIS SHEET WILL DO BEYOND ITS OWN PHASE, AND WHAT IT
          WILL COST LATER — both said before the confirm, from the
          function the confirm reads (`bill-sheet-notices.ts`). */}
      {!sheet.ignored && !sheet.needsColumns && notice?.mockup && (
        <Note tone="info" className="mt-3">
          {notice?.mockup?.sentence} Each takes the item&rsquo;s name, category and
          codes, and the bill&rsquo;s mock-up figure as its quantity where it is a number — never its specs.
        </Note>
      )}
      {!sheet.ignored && !sheet.needsColumns && notice?.noCodes && (
        <Note tone="warn" className="mt-3" title="This sheet gives its items no codes.">
          {NO_CODES_REVIEW_SENTENCE}
        </Note>
      )}

      {/* IS THIS A NEW RUN, OR A REVISION OF ONE?
          Never chosen automatically. A revised bill that silently
          replaced a run would rewrite quantities on records somebody
          is already working from; one that silently made a new run
          leaves the work stranded on the old copy. Both are
          consequential, so a person says which.

          AND "A NEW PHASE" IS NOT A DEFAULT FOR A TAB THAT LOOKS LIKE A
          PHASE THE PROJECT HAS (RV0, 2026-11-20): a revised “Guest Rooms”
          read as a new phase and one press of Confirm put every item on
          the project twice. Such a tab shows no choice until a person
          makes one, offers the phase it looks like as a suggestion with
          its evidence, and the confirm waits. */}
      {!sheet.ignored && runs.length > 0 && status === "parsed" && (
        <PhaseChoice
          sheet={sheet}
          runs={runs}
          suggestions={suggestions}
          anchorId={anchorId}
          busy={busy}
          onSetSheet={onSetSheet}
        />
      )}
    </Card>
  );
}

/** Which phase this tab is: new, or a revision of one — and, where it looks like one, the suggestion. */
function PhaseChoice({
  sheet,
  runs,
  suggestions,
  anchorId,
  busy,
  onSetSheet,
}: {
  sheet: Sheet;
  runs: ProjectRun[];
  suggestions: PhaseSuggestion[];
  anchorId?: string;
  busy: boolean;
  onSetSheet: (patch: { replacesRunId?: string | null }) => Promise<void>;
}) {
  const undecided = phaseUndecided(sheet, suggestions);
  // The select shows what is STORED, never the suggestion: "" is "nobody has
  // said", and it is only offered where the tab looks like a phase. A tab that
  // looks like none shows "a new phase", which is what it is by default.
  const value = sheet.replacesRunId ?? (undecided ? "" : "new");
  const select = (
    <label className="block text-sm text-neutral-600">
      This sheet is
      <select
        value={value}
        disabled={busy}
        onChange={(event) => {
          const chosen = event.target.value;
          if (chosen === "") return;
          void onSetSheet({ replacesRunId: chosen === "new" ? null : chosen });
        }}
        className="ml-2 max-w-full rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
      >
        {undecided && (
          <option value="" disabled>
            — say which —
          </option>
        )}
        <option value="new">a new phase</option>
        {runs.map((projectRun) => (
          <option key={projectRun.id} value={projectRun.id}>
            a revision of “{projectRun.name}” ({projectRun.record_count} items
            {projectRun.boq_revision ? `, ${projectRun.boq_revision}` : ""})
          </option>
        ))}
      </select>
    </label>
  );
  if (!undecided) return <div id={anchorId} className="mt-3.5">{select}</div>;
  return (
    <div id={anchorId}>
      <Note tone="warn" title="This tab looks like a phase this project already has.">
        Say which it is before confirming — as a new phase, every item on it would be added again.
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {select}
          {suggestions.map((suggestion) => (
            <SuggestButton
              key={suggestion.runId}
              value={<>a revision of “{suggestion.runName}”</>}
              evidence={phaseSuggestionEvidence(suggestion)}
              disabled={busy}
              onAccept={() => void onSetSheet({ replacesRunId: suggestion.runId })}
            />
          ))}
        </div>
      </Note>
    </div>
  );
}
