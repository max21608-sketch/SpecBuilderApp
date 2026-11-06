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
// Pure and type-only inside: the parser's own wording for what it did with a
// sheet, so the screen cannot describe the parse differently from the parser.
import { describeHeader } from "@/lib/boq-import";
import { NO_CODES_REVIEW_SENTENCE, type BillSheetNotice } from "@/lib/bill-sheet-notices";
import { BOQ_ROLE_LABELS, BOQ_MAPPING_SOURCE_LABELS, columnLetter, type BoqReadRole } from "@/lib/boq-roles";
import type { ProjectRun, Sheet } from "@/components/imports/use-boq-import";

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
          consequential, so a person says which. */}
      {!sheet.ignored && runs.length > 0 && status === "parsed" && (
        <label className="mt-3.5 block text-sm text-neutral-600">
          This sheet is
          <select
            value={sheet.replacesRunId ?? ""}
            disabled={busy}
            onChange={(event) => void onSetSheet({ replacesRunId: event.target.value || null })}
            className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">a new phase</option>
            {runs.map((projectRun) => (
              <option key={projectRun.id} value={projectRun.id}>
                a revision of “{projectRun.name}” ({projectRun.record_count} items
                {projectRun.boq_revision ? `, ${projectRun.boq_revision}` : ""})
              </option>
            ))}
          </select>
        </label>
      )}
    </Card>
  );
}
