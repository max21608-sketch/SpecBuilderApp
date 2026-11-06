"use client";

// The review screen. Everything here is a draft: nothing has been written to a
// spec record until Confirm.
//
// Category suggestions are shown with the document's own wording next to them,
// and an ambiguous match offers candidates rather than picking one. A line the
// matcher could not resolve stays blank — a plausible guess in a field a human
// skims past is worse than an obvious gap.
import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";
import FinishScheduleReview from "@/components/imports/FinishScheduleReview";
import Button, { buttonClass } from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import NeedsYou from "@/components/ui/NeedsYou";
import { billNeedsYou, needsYouListId, sheetColumnsId, sheetsWaiting, transcriptionNeedsYou } from "@/lib/needs-you";
import { goToAndFlash } from "@/lib/go-to";
import { TONE } from "@/components/ui/tone";
import PageHeader from "@/components/ui/PageHeader";
import NextStepAction from "@/components/ui/NextStepAction";
import { useNextStep } from "@/lib/use-next-step";
import SuggestButton from "@/components/ui/SuggestButton";
import { suggestedCategoryId } from "@/lib/bill-category";
import { Table, Th } from "@/components/ui/Table";
import Tip from "@/components/ui/Tip";
// Pure and type-only inside: which sheets the confirm still waits on, from
// the functions the confirm itself calls.
import { sheetsAwaitingColumnCheck, sheetsNeedingColumns } from "@/lib/boq-import";
import { pdfPageOfLine } from "@/lib/pdf-bill-source";
import { transcriptionChecks, type LineCheck } from "@/lib/pdf-bill-checks";
import PdfTranscriptionPanel from "@/components/imports/PdfTranscriptionPanel";
// Pure: the one rule about what a row is, what stops a fabric line, and what
// the Confirm button says it will write — the same functions the confirm runs.
import {
  boqConfirmCounts,
  boqConfirmBlocker,
  boqConfirmLabel,
  rowKindProblems,
} from "@/lib/boq-row-kinds";
// Pure: where the review draws its lines — an item and the fabrics under it as
// one group, a gap between groups, consecutive items of one code bracketed.
// Layout only; nothing the confirm writes reads it.
import { groupBillLines } from "@/lib/bill-review-groups";
import { BillUnitAll } from "@/components/imports/BillDescription";
import { columnsAwaitingALook } from "@/lib/boq-roles";
// Pure: the "this may not be furniture" question, and the set the batch action
// acts on. The page NEVER decides either for itself — one function behind the
// count on the button and the loop behind it.
import { linesToIgnore } from "@/lib/non-furniture-guess";
// Pure: the refs one tab carries twice, and — the same set, which is why it is
// one module — the rows a decision on this tab reaches on the others. The
// duplicate panel used to compute its own fold here; the carry must use
// `normaliseRef`, and two folds is how the amber panel and the carry come to
// disagree about which rows are ambiguous.
import { duplicateGroups } from "@/lib/boq-carry";
import { formatDay } from "@/lib/format-day";
import PageBody from "@/components/ui/PageBody";
import Tabs from "@/components/ui/Tabs";
import { useBoqImport, type Line } from "@/components/imports/use-boq-import";
import RevisionPanel from "@/components/imports/RevisionPanel";
import SheetHeader from "@/components/imports/SheetHeader";
import { SheetColumns, StructureReadNotes, structurePending, useStructureRead } from "@/components/imports/StructureRead";
import BillLineRow, { FamilyHeading, GroupGap, listOf, type BillLinePlace } from "@/components/imports/BillLineRow";

/** A reason sentence joined into another, without its own full stop. */
function asClause(text: string): string {
  return text.trim().replace(/[.!\s]+$/, "");
}

export default function ReviewImportPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data,
    load,
    loading,
    error,
    setError,
    notice,
    setNotice,
    busy,
    blocked,
    mockupNotice,
    specsBusy,
    setLine,
    setPicture,
    setSheet,
    acceptAllLevels,
    acceptAllCategories,
    acceptAllPairings,
    ignoreAllSuggested,
    readAgain,
    setSlot,
    setUnit,
    setUnitAll,
    setLineKind,
    readSpecifications,
    confirm,
  } = useBoqImport(id);
  /** Which sheet is shown. A BOQ tab is a sub-quote, so a tab each. */
  const [sheetTab, setSheetTab] = useState(0);
  /**
   * Sheets whose Columns panel somebody opened with "Change columns". A sheet
   * nobody has mapped, and one a saved layout read that nobody has checked,
   * show theirs regardless — see `panelOpen` below.
   */
  const [openPanels, setOpenPanels] = useState<Set<number>>(() => new Set());
  /**
   * The pack this document arrived in, for the crumb.
   *
   * Read from the project's batches rather than from the import, because
   * `/api/imports/[id]` carries no batch id and this screen is not where an API
   * shape is changed. An absent pack is normal — anything uploaded before
   * deliveries were grouped has none — and the crumb falls back to the project,
   * which is the way back either way.
   */
  const [pack, setPack] = useState<{ id: string; created_at: string; drawings: number } | null>(null);
  /** Lines whose description panel is open, as `sheet:index`. */
  const [openDescriptions, setOpenDescriptions] = useState<Set<string>>(() => new Set());
  const toggleDescription = (key: string) =>
    setOpenDescriptions((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * THE ONE ROW WHOSE PICTURE IS OPEN, as `sheet:index` — one at a time, like
   * the crops it makes: a second panel would be a second crop competing for
   * the same queue, and a second place to lose track of which row is which.
   */
  const [openPicture, setOpenPicture] = useState<string | null>(null);

  /** Fabric lines whose "why?" is open, as `sheet:index`. */
  const [openWhy, setOpenWhy] = useState<Set<string>>(() => new Set());
  const toggleWhy = (key: string) =>
    setOpenWhy((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const projectId = data?.import.project_id ?? "";
  /**
   * WHAT COMES AFTER THIS BILL. The confirm already pushes to the phase tabs,
   * where the header's own primary is this same step; this is the other half —
   * a bill somebody comes BACK to, already confirmed, whose screen said "This
   * import has already been confirmed" and offered nothing to do about it.
   *
   * Re-read whenever THIS document moves: a confirm that stays on the page
   * otherwise keeps the step computed while the bill was waiting, "Review the
   * bill", linking here (audit 2026-11-06, G7).
   */
  const step = useNextStep(projectId || null, data ? `${data.import.status}:${data.import.version}` : null);
  useEffect(() => {
    if (!projectId || !id) return;
    void apiFetch<{ batches: { id: string; created_at: string; runs: { id: string; documentKind: string | null }[] }[] }>(
      `/api/projects/${projectId}/batches`,
    ).then((res) => {
      if (!res.ok) return;
      const found = res.data.batches.find((batch) => batch.runs.some((batchRun) => batchRun.id === id));
      setPack(
        found
          ? {
              id: found.id,
              created_at: found.created_at,
              drawings: found.runs.filter((batchRun) => batchRun.documentKind === "shop_drawings").length,
            }
          : null,
      );
    });
  }, [projectId, id]);

  /** After the Columns panel wrote: reload, THEN say what happened. */
  async function afterColumns(sheetIndex: number, message: string | null) {
    await load();
    setError(null);
    if (message) setNotice(message);
    setOpenPanels((current) => {
      const next = new Set(current);
      next.delete(sheetIndex);
      return next;
    });
  }

  const { asking, structureError, askModel } = useStructureRead({ id, data, load, setNotice });

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const sheets = run.parsed?.sheets ?? [];
  // The runs this bill could revise, and the live per-sheet reconciliation.
  // Both come from the server on every read: a record retired or paired since
  // the page loaded has to show as it is now.
  const runs = data.runs.filter((projectRun) => projectRun.status === "active");
  const activeSheets = sheets.filter((sheet) => !sheet.ignored);
  /**
   * Live sheets nobody has said the columns of. The confirm refuses while any
   * remain (`sheetsNeedingColumns`, the same function it calls), so the button
   * is disabled and the screen says which, rather than letting a press fail.
   */
  const unmapped = sheetsNeedingColumns({ sheets });
  const activeLines = activeSheets.flatMap((sheet) => sheet.lines.filter((line) => !line.ignored));
  /**
   * Is this bill REVISING a run, or creating one?
   *
   * The button has to say which, because they are not the same act at all: a
   * revision writes the bill's own columns over records that already exist and
   * keeps everything hanging off them, and retires the ones the revision no
   * longer lists. "Confirm 57 lines" describes both equally and warns about
   * neither.
   */
  const revising = Object.keys(data.reconciliation ?? {}).length > 0;
  /** Live sheets whose columns a model read and nobody has agreed to — the confirm waits. */
  const unchecked = sheetsAwaitingColumnCheck({ sheets });
  /** Fabric lines that cannot be written, from the function the confirm runs. */
  const kindProblems = activeSheets.flatMap((sheet) => rowKindProblems(sheet.lines));
  const counts = boqConfirmCounts(sheets);
  const structureState = run.model_metadata?.structureRead;
  const reading = asking !== null || structurePending(structureState);
  /** A sheet as its tab names it — the words the reason beside Confirm uses, so it points at a tab you can see. */
  const tabName = (sheet: (typeof sheets)[number]) => sheet.proposedRunName || sheet.sheetName;
  // A PDF BILL THE MODEL TRANSCRIBES (C2): waiting while it runs, then every
  // line marked, and code's cross-checks re-run on every render — never stored,
  // so a person changing the columns re-checks against the new mapping.
  const transcription = run.parsed?.pdfTranscription ?? null;
  const transcribing = transcription?.state === "waiting";
  const transcribed = transcription?.state === "done";
  const pageOfLine = (sheet: (typeof sheets)[number], lineNo: number) => pdfPageOfLine(run.parsed?.pdfSource, sheet.sheetName, lineNo);
  const lineChecks = new Map<number, Map<number, LineCheck[]>>();
  const checkSummaries: string[] = [];
  if (transcribed && transcription) {
    sheets.forEach((sheet, index) => {
      if (sheet.ignored) return;
      const result = transcriptionChecks({
        lines: sheet.lines.map((line) => ({ lineNo: line.lineNo, code: line.code, qty: line.qty, rowKind: line.rowKind })),
        qtyColumn: sheet.columns?.qty?.index ?? null,
        pageOf: (lineNo) => pageOfLine(sheet, lineNo),
        transcription,
      });
      lineChecks.set(index, result.byLine);
      checkSummaries.push(...result.summary);
    });
  }
  const checkNeedsYou = transcribed
    ? sheets.flatMap((sheet, index) =>
        sheet.ignored
          ? []
          : transcriptionNeedsYou({
              sheetIndex: index,
              tab: tabName(sheet),
              single: sheets.length === 1,
              lines: sheet.lines,
              checks: lineChecks.get(index) ?? new Map(),
              pageOf: (lineNo) => pageOfLine(sheet, lineNo),
            }),
      )
    : [];
  const confirmBlocker = transcribing
    ? "Wait for the model to transcribe the PDF."
    : run.status === "parsed"
      ? boqConfirmBlocker({
          single: sheets.length === 1,
          reading,
          unmapped: unmapped.map(tabName),
          unchecked: unchecked.map(tabName),
          kindProblems: activeSheets
            .map((sheet) => ({ tab: tabName(sheet), count: rowKindProblems(sheet.lines).length }))
            .filter((entry) => entry.count > 0),
          noLiveLines: activeLines.length === 0,
        })
      : null;
  // WHAT THE CONFIRM WAITS ON, AS PLACES TO GO (2026-10-15): the same reasons
  // as `confirmBlocker`, each a link to the panel or line on its own tab, and
  // the tabs that still need somebody painted red.
  const needsYou =
    run.status === "parsed" && !transcribing
      ? billNeedsYou({
          sheets: sheets.map((sheet, index) => ({
            index,
            tab: tabName(sheet),
            unmapped: unmapped.includes(sheet),
            unchecked: unchecked.includes(sheet),
            problems: sheet.ignored ? [] : rowKindProblems(sheet.lines),
          })),
          single: sheets.length === 1,
          reading,
          noLiveLines: activeLines.length === 0,
        })
      : [];
  const waitingSheets = sheetsWaiting(needsYou);
  const canAsk = run.status === "parsed" && run.has_source !== false && run.parsed?.sourcePreserved !== false;
  const ignoredSheets = sheets.filter((sheet) => sheet.ignored);
  /** The revision and date the FIRST live tab printed, as text. Both stay text. */
  const revisionLabel = (() => {
    const first = activeSheets[0];
    if (!first) return null;
    const parts = [first.metadata?.revision ? `rev ${first.metadata.revision}` : null, first.metadata?.date]
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  })();
  const packCrumb = pack
    ? {
        label: `Pack delivered ${formatDay(pack.created_at.slice(0, 10))}`,
        href: `/dashboard/projects/${run.project_id}/intake/${pack.id}`,
      }
    : { label: `${run.bws_project_number} — ${run.project_name}`, href: `/dashboard/projects/${run.project_id}` };

  // Four documents, four review screens, one route. Each staged shape is edited
  // by the screen that understands it; nothing shares a component with a shape
  // it cannot display.
  if (run.document_kind === "shop_drawings") {
    return (
      // The review component renders its own band — see the note on the
      // spec-document branch below.
      <DrawingsReview
        importId={run.id}
        crumb={packCrumb}
        packHref={pack ? `/dashboard/projects/${run.project_id}/intake/${pack.id}/drawings` : undefined}
        packDrawingCount={pack?.drawings}
      />
    );
  }

  if (run.document_kind === "preamble") {
    return (
      <PreambleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  // A finishes schedule read as ENTRIES (schemaVersion 2), or one not read yet
  // — which will be. A version 1 schedule (proposals) keeps the screen below.
  if (
    run.document_kind === "finishes_schedule" &&
    (!run.parsed || (run.parsed as unknown as { kind?: string }).kind === "finishes_schedule")
  ) {
    return (
      <FinishScheduleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  if (run.source_kind === "spec_document") {
    if (!data.registers) return <Spinner label="Loading the document" />;
    return (
      // The review component renders its OWN band: `PageHeader` is full-bleed
      // and sits outside `PageBody`, and the tabs, the Re-match button and the
      // confirm footer all read state that lives inside it.
      <SpecDocumentReview
        data={{ import: run as unknown as SpecImport, registers: data.registers, message: data.message }}
        reload={() => load()}
        quietReload={() => load(true)}
        crumb={
          run.document_kind === "email" ? { label: "Inbox", href: "/dashboard/inbox" } : packCrumb
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[packCrumb]}
        title={run.filename ?? "Bill of quantities"}
        subtitle={
          <>
            {/* WHAT THIS SCREEN COST, FIRST. Every other review screen in the
                app was read by a model and charged for it; a bill is parsed by
                code, and a reviewer who does not know that treats the figures
                as something to second-guess. */}
            {/* A BILL READ FROM A PDF SAYS SO FIRST, and where to check it:
                its cells are the PDF's text put back by position, by code,
                and a person checks a few lines against the PDF (C1). */}
            {/* A BILL THE MODEL TRANSCRIBED SAYS SO INSTEAD (C2): the one
                bill whose cells a model wrote, every line marked. */}
            {transcribed && (
              <>
                <span className={TONE.danger.text}>Transcribed by the model from a PDF with no usable text: check every line against its page in the</span>{" "}
                <a href={`/api/imports/${run.id}/source?document=pdf`} className="text-blue-700 no-underline hover:underline">
                  PDF
                </a>
                <Tip>
                  {`${transcription?.reason ?? ""} So the model copied the table — one charged read — and code then read that copy as it reads any spreadsheet. Every line is marked “transcribed” with its page. A line whose quantity does not add up to a total the PDF prints, whose code is not in the page's own text, or that the model said it could not read clearly, is red. Pictures in the PDF are not carried over.`.trim()}
                </Tip>
                {". "}
              </>
            )}
            {run.parsed?.pdfSource && !run.parsed?.pdfTranscription && (
              <>
                <span className={TONE.warn.text}>Read from a PDF by its text: check a few lines against the</span>{" "}
                <a
                  href={`/api/imports/${run.id}/source?document=pdf`}
                  className="text-blue-700 no-underline hover:underline"
                >
                  PDF
                </a>
                <Tip>
                  Every cell is text the PDF printed, put back into columns by position — no model read it. Each
                  line shows the PDF page it came from. Pictures in the PDF are not carried over.
                </Tip>
                {". "}
              </>
            )}
            {transcribing && (
              <>
                <span className={TONE.warn.text}>A PDF a program could not read: the model transcribes it, every line marked.</span>{" "}
              </>
            )}
            {transcription
              ? null
              : Object.keys(run.model_metadata?.structureRead?.sheets ?? {}).length > 0
                ? "Every cell read by code; the model read the columns (one small read, charged)."
                : "Parsed by code, not by a model — nothing here was charged."}{" "}
            {!transcribing && (
              <>
                {sheets.length} tab
                {sheets.length === 1 ? "" : "s"}
              </>
            )}
            {revisionLabel && <> · {revisionLabel}</>}
            {/* A reload after an action. Inline rather than a spinner over the
                table: the rows stay readable and nothing on the page moves. */}
            {loading && <> · <span className="text-neutral-500">reloading…</span></>}
            {run.parsed?.sourcePreserved !== false && !transcribing && (
              <>
                {" · "}
                <a
                  href={`/api/imports/${run.id}/source`}
                  className="text-blue-700 no-underline hover:underline"
                >
                  open the spreadsheet
                </a>
              </>
            )}
          </>
        }
        actions={
          // A CONFIRMED BILL HAS NO CONFIRM. It used to render disabled and
          // still wearing the primary's dark fill, so the screen's most
          // emphatic control was one nobody could press — beside a green box
          // whose own action IS the next step. §0.3: one primary, and it is
          // what a person does next. Every other reason the button is disabled
          // (nothing parsed yet, no active lines) keeps it on screen, because
          // then it is the control being refused and it has to say so.
          run.status === "confirmed" ? null : (
          <>
          {/* THE REASON, BESIDE THE BUTTON IT DISABLES, naming the tab that
              waits (2026-10-15). It used to be the button's hover title only,
              and a person scrolled into a tab saw neither it nor the banner. */}
          {confirmBlocker && !busy && (
            <p className={`max-w-[26rem] text-right text-xs ${TONE.warn.text}`}>
              {confirmBlocker}
              {needsYou.some((entry) => entry.target) && (
                <>
                  {" "}
                  <a
                    href={`#${needsYouListId("bill")}`}
                    className="font-medium underline decoration-amber-500 underline-offset-2"
                    onClick={(event) => {
                      event.preventDefault();
                      goToAndFlash(needsYouListId("bill"));
                    }}
                  >
                    Take me there
                  </a>
                </>
              )}
            </p>
          )}
          <Button
            variant="primary"
            onClick={confirm}
            disabled={
              busy ||
              reading ||
              run.status !== "parsed" ||
              activeLines.length === 0 ||
              unmapped.length > 0 ||
              unchecked.length > 0 ||
              kindProblems.length > 0
            }
            title={confirmBlocker ?? undefined}
          >
            {boqConfirmLabel({ counts, revising, unmapped: unmapped.length, busy })}
          </Button>
          </>
          )
        }
        tabs={
          sheets.length > 1 ? (
            // `useState`, not the URL: nothing links to a sheet of a staged
            // bill, and a `?tab=` here would be a second address for a screen
            // that already has one.
            //
            // AN IGNORED SHEET KEEPS ITS OWN TAB, struck through, rather than
            // being folded into an "Ignored tabs (n)" pile. Dismissing a sheet
            // is a decision somebody took and has to be able to undo, and the
            // undo lives on the sheet's own panel — a grouped tab would say how
            // many were dropped without saying which, and the way back would be
            // a click further away than the way in.
            <Tabs
              label="Sheets in this bill"
              value={String(sheetTab)}
              onChange={(tabId) => setSheetTab(Number(tabId))}
              items={sheets.map((sheet, index) => ({
                id: String(index),
                label: sheet.proposedRunName || sheet.sheetName,
                count: sheet.lines.filter((line) => !line.ignored).length,
                muted: sheet.ignored,
                // RED WHILE IT WAITS ON SOMEBODY (Matthew, 2026-10-15 part 2,
                // 1:46): the confirm is refused until it is done.
                attention: waitingSheets.has(index),
              }))}
            />
          ) : undefined
        }
      />

      <PageBody width="wide">
        {/* ONE LIST OF WHAT THE CONFIRM WAITS ON, FIRST ON THE PAGE, each item
            a link that switches to its tab and lights the panel or line
            (2026-10-15). It replaces two amber banners whose sentences are now
            each item's "Why". */}
        <NeedsYou
          id={needsYouListId("bill")}
          items={needsYou}
          className="mt-3"
          onGo={(entry) => {
            if (entry.sheetIndex === undefined) return;
            setSheetTab(entry.sheetIndex);
            // A Columns link opens the panel, so there is a panel to land on.
            if (entry.target === sheetColumnsId(entry.sheetIndex)) {
              const index = entry.sheetIndex;
              setOpenPanels((current) => new Set(current).add(index));
            }
          }}
        />
        {/* A PDF BILL THE MODEL TRANSCRIBES (C2): the panel while it waits or
            runs; then, RED and apart from what the confirm waits on, every
            line code's cross-checks flagged — a mis-copied quantity looks
            exactly like a real one. */}
        {transcription && (
          <PdfTranscriptionPanel
            importId={run.id}
            version={run.version}
            transcription={transcription}
            record={run.model_metadata?.transcription}
            pdfHref={`/api/imports/${run.id}/source?document=pdf`}
            reload={() => load(true)}
          />
        )}
        <NeedsYou
          id={needsYouListId("transcribed")}
          items={checkNeedsYou}
          title="Check against the PDF"
          tone="danger"
          className="mt-3"
          onGo={(entry) => {
            if (entry.sheetIndex !== undefined) setSheetTab(entry.sheetIndex);
          }}
        />
        {transcribed && checkSummaries.length > 0 && (
          <details className="mt-1 text-[11.5px] text-neutral-600">
            <summary className="cursor-pointer">What code checked of the transcription</summary>
            <ul className="mt-1 list-disc pl-5">
              {[...new Set(checkSummaries)].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}
        {/* THE BILL THAT COULD NOT BE READ SAYS SO ON THIS SCREEN.
            ==================================================================
            The parser's refusal was returned by the registration route as a 422
            and shown on the UPLOAD screen — and then never again. A reviewer who
            followed the link from the pack, or came back to the run later, got
            this page with no sheets, no error and a blue note explaining that a
            tab is a phase. `intake_runs.error` has carried the sentence all
            along and nothing rendered it.

            Row 1 of the variance matrix (§6.10.a) is a REFUSAL, and a refusal
            has to be readable where the document is. `parseBoqSheets` names the
            columns it looked for, the words it accepts, and the closest row's
            own headings, so the sentence below is the one thing a person needs
            in order to act. */}
        {run.status === "failed" && (
          <Note
            tone="danger"
            title="This bill could not be read, and nothing was staged from it."
            actions={
              // A BILL IS NEVER READ BY A MODEL, so "Try again" here is free:
              // the stored spreadsheet is read again by code, with the columns
              // a person can now set. The bills refused before 0040 recover
              // this way, without a new upload.
              run.has_source ? (
                <Button size="sm" disabled={busy} onClick={() => void readAgain()}>
                  {busy ? "Reading…" : "Read it again"}
                </Button>
              ) : undefined
            }
          >
            {run.error ?? "The reader gave no reason, which is itself worth reporting."}
            {run.has_source ? (
              <span className="mt-1 block">
                Reading it again is free — the stored spreadsheet is read by code — and a bill whose columns the
                reader does not know now opens on a Columns panel instead of stopping here.
              </span>
            ) : run.has_source === false ? (
              <span className="mt-1 block">
                The original was not kept when it was uploaded, so it cannot be read again. Upload the file again.
              </span>
            ) : null}
          </Note>
        )}

        <StructureReadNotes
          reading={reading}
          asking={asking}
          structureError={structureError}
          canAsk={canAsk}
          onAskAgain={() => void askModel()}
          status={run.status}
          unchecked={unchecked}
        />
        {/* THE SENTENCES THAT WERE TWO AMBER BANNERS HERE — a finish line
            with no item, a sheet nobody has mapped — are each item's "Why" on
            the list above, one click away and never deleted. */}

        {/* A TAB IS A PHASE, NOT A REVISION. Three tabs quote the same codes at
            different quantities and can all be live at once, which is why they
            become `spec_runs` rows rather than versions of one.

            Only where there ARE tabs: on a bill that failed to parse it was a
            standing explanation of something the screen was not showing. */}
        {sheets.length > 0 && (
        <Note tone="info" title="A tab is a phase, not a revision.">
          {sheets.length > 1 ? "These" : "This"} quote the same codes at different quantities and can all be live at
          once. Drop a tab to leave it out
          {ignoredSheets.length > 0 ? (
            <>
              {" — "}
              {ignoredSheets.map((sheet, index) => (
                <span key={sheet.sheetName + String(index)}>
                  {index > 0 && ", "}
                  <span className="font-mono">{sheet.sheetName}</span>
                </span>
              ))}{" "}
              already {ignoredSheets.length === 1 ? "is" : "are"}
              {ignoredSheets[0]?.ignoredReason ? ` — ${asClause(ignoredSheets[0].ignoredReason)}` : ""}.
            </>
          ) : (
            "."
          )}
        </Note>
        )}

        {run.parsed?.rowImagesNote && run.status === "parsed" && (
          <Note
            tone="warn"
            title={
              // A sheet whose in-cell pictures could not be read keeps its floating ones.
              Object.keys(run.parsed.rowImages ?? {}).length > 0
                ? "Some pictures in this workbook were not read."
                : "No pictures from this workbook."
            }
          >
            {run.parsed.rowImagesNote} The bill itself is read as normal.
          </Note>
        )}

        {run.parsed?.sourcePreserved === false && (
          <Note tone="warn" title="The source file was not kept.">
            There is no blob store configured, so this import read the spreadsheet and discarded it. The records
            below will have no document to check back against.
          </Note>
        )}

        {run.status === "confirmed" && (
          <Note tone="good" actions={<NextStepAction step={step} size="sm" />}>
            This import has already been confirmed.
          </Note>
        )}
        {run.status === "confirmed" && mockupNotice && (
          <Note tone="warn" title="The Mock-up phase needs a look.">
            {mockupNotice}
          </Note>
        )}
        {/* THE SPECIFICATIONS IN THE BILL'S OWN WORDS. A description cell packs
            sizes, models and finishes; the confirm made records and never read
            what the words say. One press registers this file as a specification
            document and reads it — charged, and said so on the button. */}
        {/* A BILL WHOSE CONFIRM READ ITS DESCRIPTIONS has nothing left for a
            charged read to find, so none is offered — and the route refuses
            one too. Said where the button would have been, so its absence is
            not a mystery. */}
        {run.status === "confirmed" && data.descriptionsRead && !data.billSpecs && (
          <Note tone="good" title="The descriptions in this bill were read when it was confirmed.">
            Each record carries its name and what its description cell said — sizes in their slots, finish codes
            in their fields, every other line as a note — sourced to this bill. There is nothing more to read, so no
            charged read is offered.
          </Note>
        )}
        {run.status === "confirmed" && run.has_source !== false && (!data.descriptionsRead || data.billSpecs) && (
          <Note
            tone="info"
            title="The descriptions in this bill carry specifications."
            actions={
              data.billSpecs ? (
                <a href={`/dashboard/imports/${data.billSpecs.id}`} className={buttonClass("secondary", "sm", "no-underline")}>
                  Open the specifications read
                </a>
              ) : (
                <Button size="sm" disabled={specsBusy} onClick={() => void readSpecifications()}>
                  {specsBusy ? "Registering…" : "Read the specifications in this bill — one read, charged"}
                </Button>
              )
            }
          >
            {data.billSpecs
              ? "They are being read, or have been, as a document of their own: sizes by slot, finishes by code, each for you to confirm."
              : "Reading them turns each line's sizes, models and finishes into proposals on its record, for you to confirm like any document's."}
          </Note>
        )}

        {notice && !error && <Note tone="info">{notice}</Note>}

        {error && (
          <Note tone="danger">
            {error}
            {blocked.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {blocked.map((line) => (
                  <li key={line.lineNo}>
                    Row {line.lineNo}
                    {line.code ? ` (${line.code})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Note>
        )}

        {sheets.map((sheet, sheetIndex) => {
          if (sheets.length > 1 && sheetIndex !== sheetTab) return null;
          const reconciliation = data.reconciliation[sheetIndex] ?? null;
          const pairingFor = (index: number) => reconciliation?.lines.find((line) => line.index === index) ?? null;
          const live = sheet.lines.filter((line) => !line.ignored);
          // The set *Ignore all suggested* acts on, from the one function the
          // per-row buttons read — so the count on the control is exactly what
          // the control does.
          const notFurniture = linesToIgnore(live);
          const notFurnitureIds = new Set(notFurniture.map((line) => line.index));
          const noLevel = live.filter((line) => !line.level && !notFurnitureIds.has(line.index)).length;
          // A line asked about as packaging is not also offered a level to
          // accept: its cell prints "not furniture?" instead, so counting it
          // here would put a number on the button the table does not show.
          const suggested = live.filter(
            // A fabric line is not a record, so it has no level to accept:
            // counting the 34 under the Aman items made "Accept all 101".
            (line) =>
              line.level && line.levelStatus !== "chosen" && !notFurnitureIds.has(line.index) && line.rowKind !== "finish_for",
          );
          // The same three exclusions for the CATEGORY a line suggests: a
          // fabric line is not a record, and a line asked about as packaging
          // is not offered a sheet to accept before that cheaper question.
          const suggestedCategories = live.filter(
            (line) =>
              suggestedCategoryId(line) !== null && !notFurnitureIds.has(line.index) && line.rowKind !== "finish_for",
          );
          // A fabric line is not a record, so the code it carries is not a client
          // ref two records share: `GR-FAB-13` under six items is one fabric.
          const duplicates = duplicateGroups({ ...sheet, lines: sheet.lines.filter((line) => line.rowKind !== "finish_for") });
          const problemByRow = new Map(rowKindProblems(sheet.lines).map((problem) => [problem.lineNo, problem.problem]));
          // Row, Kind, Client ref, Item, Area, Qty, Designer, (Against the
          // phase), Category, Level, Include.
          const columns = reconciliation ? 11 : 10;
          const descriptions = data.descriptions[sheetIndex] ?? {};
          const described = Object.keys(descriptions).length;
          // Lines whose plan reads the bill's own Dims / Finish columns, so the
          // note below says so rather than only describing a multi-line cell.
          const fromColumns = Object.values(descriptions).filter((plan) => (plan.columnCells ?? []).length > 0).length;
          const fromCells = Object.values(descriptions).filter((plan) => plan.statements.some((statement) => !statement.column)).length;
          // The lines whose size prints no unit and nobody has set one yet —
          // exactly what "set them all" writes, so its count is what it does.
          const unitless = live.filter((line) => {
            const plan = descriptions[line.index];
            return plan?.unitMissing === true && !plan.unitSetOnReview && !line.unitOverride;
          });
          const fabricFilings = data.fabricFilings[sheetIndex] ?? {};
          /**
           * THE COLUMNS PANEL IS OPEN when nobody has mapped this sheet yet
           * (unless it is dropped, when it waits to be asked for), when a
           * PERSON'S saved layout or a model read it and nobody has looked — a
           * remembered layout must never apply unseen — or when somebody
           * pressed Change columns. A SEEDED layout reads like a known heading
           * and opens nothing (`columnsAwaitingALook`, the panel's own test).
           */
          const layoutUnchecked = columnsAwaitingALook(sheet);
          const panelOpen =
            openPanels.has(sheetIndex) || (sheet.needsColumns === true && !sheet.ignored) || layoutUnchecked;
          const setPanel = (open: boolean) =>
            setOpenPanels((current) => {
              const next = new Set(current);
              if (open) next.add(sheetIndex);
              else next.delete(sheetIndex);
              return next;
            });
          return (
            <div key={sheet.sheetName + String(sheetIndex)} className={sheet.ignored ? "opacity-60" : undefined}>
              <SheetHeader
                sheet={sheet}
                status={run.status}
                runs={runs}
                busy={busy}
                panelOpen={panelOpen}
                notice={data.sheetNotices[sheetIndex]}
                onOpenPanel={() => setPanel(true)}
                onSetSheet={(patch) => setSheet(sheetIndex, patch)}
              />

              <SheetColumns
                run={run}
                sheet={sheet}
                sheetIndex={sheetIndex}
                open={panelOpen}
                busy={busy}
                reading={reading}
                setPanel={setPanel}
                onRead={(message) => afterColumns(sheetIndex, message)}
                onSetSheet={(patch) => setSheet(sheetIndex, patch)}
                onAsk={canAsk ? () => void askModel(sheetIndex) : undefined}
                onReadAgain={readAgain}
              />

              {reconciliation && (
                <RevisionPanel
                  reconciliation={reconciliation}
                  status={run.status}
                  busy={busy}
                  onAcceptPairings={(pairs) => acceptAllPairings(sheetIndex, pairs)}
                />
              )}

              {/* THE REVIEW IS THE GATE FOR WHAT THE DESCRIPTIONS SAY: the
                  confirm writes exactly what is shown under each line. */}
              {!sheet.ignored && !sheet.needsColumns && described > 0 && run.status === "parsed" && (
                <Note tone="info" title="Each item's description is read as you confirm.">
                  {fromCells > 0 && (
                    <>
                      {fromCells} line{fromCells === 1 ? "'s" : "s'"} description cell
                      {fromCells === 1 ? " is" : "s are"} more than a name: the first line becomes the
                      item&rsquo;s name, and the rest is written to its record — sizes in their slots, finish codes in
                      their BWS fields and the finishes library, every other line as a note.{" "}
                    </>
                  )}
                  {fromColumns > 0 && (
                    <>
                      {fromColumns} line{fromColumns === 1 ? "" : "s"} carr{fromColumns === 1 ? "ies" : "y"} a size or a
                      finish in the bill&rsquo;s own Dims or Finish column, read the same way: a size into its slots, a
                      finish into the BWS field of its one kind, or kept whole as a note.{" "}
                    </>
                  )}
                  Check what is shown under each line; amber is what needs a look.
                </Note>
              )}
              {!sheet.ignored && !sheet.needsColumns && run.status === "parsed" && (
                <BillUnitAll
                  count={unitless.length}
                  busy={busy}
                  onApply={(unit) => void setUnitAll(sheetIndex, unitless, unit)}
                />
              )}
              {!sheet.ignored && !sheet.needsColumns && (
                <Card
                  flush
                  title={
                    <>
                      {live.length} line{live.length === 1 ? "" : "s"}
                      {noLevel > 0 && (
                        <Chip tone="warn">
                          {noLevel} need{noLevel === 1 ? "s" : ""} a level
                        </Chip>
                      )}
                      {suggested.length > 0 && (
                        <Chip tone="info">
                          {suggested.length} {suggested.length === 1 ? "has" : "have"} a suggested level
                        </Chip>
                      )}
                      {suggestedCategories.length > 0 && (
                        <Chip tone="info">
                          {suggestedCategories.length} {suggestedCategories.length === 1 ? "has" : "have"} a suggested
                          category
                        </Chip>
                      )}
                      {notFurniture.length > 0 && (
                        <Chip tone="info">
                          {notFurniture.length} may not be furniture
                        </Chip>
                      )}
                    </>
                  }
                  actions={
                    run.status === "parsed" &&
                    (notFurniture.length > 0 || suggested.length > 0 || suggestedCategories.length > 0) ? (
                      <span className="inline-flex flex-wrap items-center gap-4">
                        {/* FIRST, because it is the cheaper decision: whether a
                            row belongs in the bill at all comes before how
                            complex it is. Neither is a `primary` — the screen's
                            one primary is Confirm, in the header. */}
                        {notFurniture.length > 0 && (
                          <SuggestButton
                            value={`Ignore all ${notFurniture.length} suggested`}
                            evidence="each row says what it was read from · the Include box puts one back"
                            busy={busy}
                            onAccept={() => void ignoreAllSuggested(sheetIndex, notFurniture)}
                          />
                        )}
                        {/* Category before level: the category decides
                            which questions the record has at all. */}
                        {suggestedCategories.length > 0 && (
                          <SuggestButton
                            value="Accept all suggested categories on this tab"
                            evidence={`accepts ${suggestedCategories.length} suggestion${suggestedCategories.length === 1 ? "" : "s"} · each row says what it matched`}
                            busy={busy}
                            onAccept={() => void acceptAllCategories(sheetIndex, suggestedCategories)}
                          />
                        )}
                        {suggested.length > 0 && (
                          <SuggestButton
                            value={`Accept all ${suggested.length} suggested level${suggested.length === 1 ? "" : "s"}`}
                            evidence="each row says what it was read from"
                            busy={busy}
                            onAccept={() => void acceptAllLevels(sheetIndex, suggested)}
                          />
                        )}
                      </span>
                    ) : undefined
                  }
                >
                  {/* Ten columns, two of them selects: a notch tighter than the
                      primitive, or the category select pushed the bill 29px past
                      its box at 1440 and 1920 (the overflow rule caught it). */}
                  <Table scroll className="[&_td]:px-3 [&_th]:px-3">
                    <thead>
                      <tr>
                        <Th>Row</Th>
                        {/* Narrower than it was: the kind is quiet text until
                            clicked, and the select opens in place. */}
                        <Th className="w-[120px]">
                          Kind
                          <Tip>
                            A finish line — fabric, timber, metal, trim — is not a record: it is written as a spec on its
                            item, in the next free field of its kind, or kept with no field. A section, subtotal or blank
                            row is left out, and its Include box brings it back.
                          </Tip>
                        </Th>
                        <Th>Client ref</Th>
                        {/* The floor is on a BLOCK inside each Item cell
                            (`ITEM_CELL`): under table-layout auto a min-width on
                            a th or td is only a hint. */}
                        <Th>Item</Th>
                        <Th>Area</Th>
                        <Th num>Qty</Th>
                        <Th>Designer</Th>
                        {reconciliation && <Th>Against the phase</Th>}
                        {/* Capped, so the select does not take the slack the
                            Item column needs: a select is as wide as its
                            longest option, and a category name is long. */}
                        <Th className="w-[180px]">
                          Category
                          <Tip>A line with no category still imports — it simply has no checklist yet.</Tip>
                        </Th>
                        <Th className="w-[170px]">Level</Th>
                        {/* Wide enough for the "Not furniture?" question and
                            its evidence, which live under the checkbox they
                            act on. */}
                        <Th className="w-[190px]">Include</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                      /**
                       * One bill line's row, and its description panel.
                       * `place` is where `groupBillLines` put it: a fabric
                       * HANGING off the item above is drawn on a rail, a member
                       * of a family carries the sky bar, and every member of a
                       * family after the first opens with a dashed rule rather
                       * than a gap.
                       */
                      const lineRows = (line: Line, place: BillLinePlace) => {
                        const key = `${sheetIndex}:${line.index}`;
                        return (
                          <BillLineRow
                            key={line.index}
                            line={line}
                            place={place}
                            sheet={sheet}
                            sheetIndex={sheetIndex}
                            importId={id}
                            run={run}
                            columns={columns}
                            reconciliation={reconciliation}
                            pairing={pairingFor(line.index)}
                            categories={data.categories}
                            descriptionPlan={descriptions[line.index]}
                            fabricFiling={fabricFilings[line.index]}
                            problem={problemByRow.get(line.lineNo) ?? null}
                            flags={lineChecks.get(sheetIndex)?.get(line.lineNo) ?? []}
                            transcribed={transcribed}
                            busy={busy}
                            pictureOpen={openPicture === key}
                            onTogglePicture={() => setOpenPicture((current) => (current === key ? null : key))}
                            onClosePicture={() => setOpenPicture(null)}
                            whyOpen={openWhy.has(key)}
                            onToggleWhy={() => toggleWhy(key)}
                            descriptionOpen={openDescriptions.has(key)}
                            onToggleDescription={() => toggleDescription(key)}
                            setLine={setLine}
                            setPicture={setPicture}
                            setSlot={setSlot}
                            setUnit={setUnit}
                            setLineKind={setLineKind}
                          />
                        );
                      };
                      return groupBillLines(sheet.lines).map((group, groupIndex) => (
                        <Fragment key={`group-${group.members[0]?.line.index ?? groupIndex}`}>
                          {groupIndex > 0 && <GroupGap columns={columns} />}
                          {group.family && <FamilyHeading family={group.family} columns={columns} />}
                          {group.members.map((member, memberIndex) => (
                            <Fragment key={`member-${member.line.index}`}>
                              {lineRows(member.line, {
                                member,
                                hanging: false,
                                more: false,
                                family: group.family !== null,
                                familyRule: group.family !== null && memberIndex > 0,
                              })}
                              {member.fabrics.map((fabricLine, fabricIndex) =>
                                lineRows(fabricLine, {
                                  member,
                                  hanging: true,
                                  more: fabricIndex < member.fabrics.length - 1,
                                  family: group.family !== null,
                                  familyRule: false,
                                }),
                              )}
                            </Fragment>
                          ))}
                        </Fragment>
                      ));
                      })()}
                      {/* THE SAME CLIENT REF ON TWO LINES IS NORMAL, AND IS THE
                          MOST CONFUSING THING IN THE REAL PILOT BILL. `SX11A`
                          appears twice in the P17231 BOQ at different
                          quantities. A ref is the CLIENT'S key, not ours —
                          which is why records carry a surrogate id and a
                          `record_no`. The explanation sits UNDER the rows it is
                          about, not in a banner at the top of the page. */}
                      {duplicates.map((group) => (
                        <tr key={group.code}>
                          <td
                            colSpan={columns}
                            className="border-b border-neutral-100 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900"
                          >
                            <b>
                              Row{group.lineNos.length === 1 ? "" : "s"} {listOf(group.lineNos)} carry the same client
                              ref <span className="font-mono">{group.code}</span> at different quantities.
                            </b>{" "}
                            That is normal — a ref is the client&rsquo;s key, not ours. Both become records; each gets
                            its own <span className="font-mono">record_no</span>.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}

              {(sheet.metadata?.notes?.length ?? 0) > 0 && (
                <Card
                  title={
                    <>
                      Read off the rows above the header
                      <CardHeadingNote>kept on the phase as text</CardHeadingNote>
                    </>
                  }
                >
                  <p className="text-neutral-600">
                    {sheet.metadata.notes.map((note, index) => (
                      <span key={index} className="block">
                        {note}
                      </span>
                    ))}
                  </p>
                </Card>
              )}
            </div>
          );
        })}
      </PageBody>
    </>
  );
}
