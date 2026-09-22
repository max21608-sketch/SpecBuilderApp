"use client";

// The review screen. Everything here is a draft: nothing has been written to a
// spec record until Confirm.
//
// Category suggestions are shown with the document's own wording next to them,
// and an ambiguous match offers candidates rather than picking one. A line the
// matcher could not resolve stays blank — a plausible guess in a field a human
// skims past is worse than an obvious gap.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type Registers, type SpecImport } from "@/components/imports/SpecDocumentReview";
import { type EmailMessage } from "@/components/imports/EmailHeader";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";
import Button from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import PageHeader from "@/components/ui/PageHeader";
import NextStepAction from "@/components/ui/NextStepAction";
import { useNextStep } from "@/lib/use-next-step";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import Tip from "@/components/ui/Tip";
import { ITEM_LEVELS, ITEM_LEVEL_LABELS, isItemLevel } from "@/lib/spec-vocab";
// Pure and type-only inside: the parser's own wording for what it did with a
// sheet, so the screen cannot describe the parse differently from the parser.
import { describeHeader } from "@/lib/boq-import";
// Pure: the "this may not be furniture" question, and the set the batch action
// acts on. The page NEVER decides either for itself — one function behind the
// count on the button and the loop behind it.
import { linesToIgnore, nonFurnitureOf, type NonFurnitureGuess } from "@/lib/non-furniture-guess";
import { formatDay } from "@/lib/format-day";
import PageBody from "@/components/ui/PageBody";
import Tabs from "@/components/ui/Tabs";

type Line = {
  replaces?: { recordId: string; recordVersion: number } | null;
  index: number; lineNo: number; designer: string | null; boqCategory: string | null;
  area: string | null; code: string | null; itemDescription: string; productReference: string | null;
  qty: number | null; qtyUnit: string | null;
  categoryId: string | null; categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[]; ignored: boolean;
  // Guessed at parse time, corrected here. `chosen` is what makes it a
  // decision the quote gate may read; see db/migrations/0025.
  level?: string | null; levelStatus?: string; levelReason?: string | null;
  // "This may not be furniture", asked at staging. ABSENT on a bill staged
  // before the question existed, which `nonFurnitureOf` answers at read time.
  nonFurnitureSuggested?: NonFurnitureGuess | null;
};

function isDuplicated(sheet: { lines: Line[] }, line: Line): boolean {
  if (line.ignored || !line.code?.trim()) return false;
  const key = line.code.trim().toUpperCase().replace(/\s+/g, " ");
  return (
    sheet.lines.filter(
      (other) => !other.ignored && other.code?.trim().toUpperCase().replace(/\s+/g, " ") === key,
    ).length > 1
  );
}


/**
 * The duplicate refs of one sheet, with the rows that carry each.
 *
 * The ROWS are the point. "One client ref appears on more than one line" sends
 * somebody hunting up the table; "Rows 17 and 18 carry the same ref" is the
 * answer, and it goes under the rows it is about rather than in a banner at the
 * top of the page.
 */
function duplicateGroups(sheet: { lines: Line[] }): { code: string; lineNos: number[] }[] {
  const seen = new Map<string, { code: string; lineNos: number[] }>();
  for (const line of sheet.lines) {
    if (line.ignored || !line.code?.trim()) continue;
    const key = line.code.trim().toUpperCase().replace(/\s+/g, " ");
    const entry = seen.get(key) ?? { code: line.code.trim(), lineNos: [] };
    entry.lineNos.push(line.lineNo);
    seen.set(key, entry);
  }
  return [...seen.values()].filter((entry) => entry.lineNos.length > 1);
}

/** "17 and 18", "17, 18 and 19" — a list a person reads rather than parses. */
function listOf(values: number[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

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

/**
 * The level cell: a decision, a suggestion, or nothing to read it from.
 *
 * Three shapes rather than one select, because they are three different states
 * and a select cannot tell them apart. A CHOSEN level is a `Chip` with a quiet
 * Change beside it — it is a decision, and a select showing it invites an
 * accidental edit. A SUGGESTED one is a `SuggestButton` carrying the words it
 * was read from, never a pre-selected select: a select already reading "Hero"
 * fires no change event when somebody picks Hero, so the one act that records
 * their agreement would do nothing at all. Where nothing was suggested the
 * select is offered with nothing selected, and the screen says why.
 */
function LevelCell({
  line,
  editable,
  busy,
  onSet,
}: {
  line: Line;
  editable: boolean;
  busy: boolean;
  onSet: (level: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const chosen = line.levelStatus === "chosen" && line.level;
  /**
   * A LINE THAT MAY NOT BE FURNITURE IS NOT OFFERED A LEVEL TO ACCEPT.
   *
   * `guessLevelFromBill` stopped guessing one the day this question was added,
   * so nothing is stored on a bill staged since — but the staged JSON is data
   * from the past and every bill staged before it carries `Simple · the bill
   * names no metalwork` on its packaging line. Reading it here suppresses the
   * SUGGESTION on both, without touching a level somebody actually chose:
   * accepting a guess is a decision, and the cheaper decision — whether the row
   * belongs in the bill at all — has not been taken yet.
   */
  const notFurniture = nonFurnitureOf(line) !== null;

  if (chosen && !editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Chip tone="good">{ITEM_LEVEL_LABELS[line.level as keyof typeof ITEM_LEVEL_LABELS] ?? line.level}</Chip>
        {editable && (
          <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </span>
    );
  }

  if (!editing && !notFurniture && line.level && isItemLevel(line.level)) {
    return (
      <SuggestButton
        value={ITEM_LEVEL_LABELS[line.level]}
        evidence={line.levelReason ?? "read off the bill"}
        busy={busy}
        disabled={!editable}
        onAccept={() => onSet(line.level ?? null)}
        className="max-w-[160px]"
      />
    );
  }

  return (
    <>
      <select
        value={notFurniture && line.levelStatus !== "chosen" ? "" : (line.level ?? "")}
        disabled={!editable}
        onChange={(event) => {
          onSet(event.target.value || null);
          setEditing(false);
        }}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">— not set —</option>
        {ITEM_LEVELS.map((level) => (
          <option key={level} value={level}>
            {ITEM_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
      {notFurniture ? (
        <span className="mt-1 block text-[10.5px] text-neutral-500">not furniture?</span>
      ) : (
        !line.level && <span className="mt-1 block text-[10.5px] text-neutral-500">nothing to read it from</span>
      )}
    </>
  );
}

type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };
type Sheet = {
  sheetName: string; proposedRunName: string; headerRow: number; skippedRows: number;
  ignored: boolean; ignoredReason: string | null;
  replacesRunId?: string | null;
  metadata: { revision: string | null; date: string | null; notes: string[] };
  lines: Line[];
};
type ProjectRun = {
  id: string; name: string; status: string; boq_revision: string | null; boq_date: string | null;
  record_count: number;
};
type Reconciliation = {
  lines: {
    index: number; lineNo: number; code: string | null;
    status: "paired" | "new" | "ambiguous";
    suggestedRecordId: string | null;
    candidates: string[];
    deltas: { field: string; label: string; was: string | null; now: string | null }[];
  }[];
  missing: {
    recordId: string; label: string; itemDescription: string; codes: string[];
    attributeCount: number; hasImage: boolean; settledAnswers: number;
  }[];
  counts: { paired: number; changed: number; new: number; ambiguous: number; missing: number };
  records: { id: string; version: number; label: string; itemDescription: string; qty: number | null }[];
};
type Import = {
  id: string; status: string; version: number; error: string | null; source_kind: string;
  document_kind: string | null; project_id: string;
  bws_project_number: string; project_name: string; filename: string | null;
  parsed: { schemaVersion: 3; filename: string | null; sourcePreserved?: boolean; sheets: Sheet[] } | null;
};

const STATUS_LABEL: Record<string, string> = {
  confident: "matched",
  ambiguous: "several possible",
  // What the parser actually writes for a confident match. It was missing, so
  // a suggested category rendered with NO chip and read as a decision.
  suggested: "suggested",
  none: "no match",
  chosen: "chosen",
  pending: "",
};

export default function ReviewImportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{
    import: Import;
    categories: Category[];
    registers: Registers | null;
    message: EmailMessage | null;
    runs: ProjectRun[];
    reconciliation: Record<number, Reconciliation>;
  } | null>(null);
  /**
   * WHETHER A RELOAD IS IN FLIGHT, and it is now RENDERED.
   *
   * This was `const [, setLoading] = useState(false)` — the value discarded,
   * so `setLoading` was a bare re-render and the screen showed nothing while
   * it reloaded (found-in-use 2026-09-21). Most actions here do not set
   * `busy`: changing a line's category or a tab's name just awaits `load()`,
   * which takes a second or two against the sandbox and gave no feedback at
   * all.
   *
   * IT IS NOT WHAT MAKES THE BANNER SURVIVE A RELOAD, which the entry
   * suspected. `load()` on this screen never clears `error` on success — the
   * drawings screens' `reloadThen` exists because THEIR loader does — so the
   * message survives whatever this state does.
   */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which sheet is shown. A BOQ tab is a sub-quote, so a tab each. */
  const [sheetTab, setSheetTab] = useState(0);
  const [blocked, setBlocked] = useState<{ lineNo: number; code: string | null }[]>([]);
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

  // `quiet` skips the loading state. The spec-document view re-reads every
  // three seconds while a document is being read, and blanking the screen out
  // from under someone reading it would make the page unusable.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const res = await apiFetch<{
      import: Import;
      categories?: Category[];
      registers?: Registers;
      message?: EmailMessage | null;
      runs?: ProjectRun[];
      reconciliation?: Record<number, Reconciliation>;
    }>(`/api/imports/${id}`);
    if (!quiet) setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setData({
      import: res.data.import,
      categories: res.data.categories ?? [],
      registers: res.data.registers ?? null,
      message: res.data.message ?? null,
      runs: res.data.runs ?? [],
      reconciliation: res.data.reconciliation ?? {},
    });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const projectId = data?.import.project_id ?? "";
  /**
   * WHAT COMES AFTER THIS BILL. The confirm already pushes to the phase tabs,
   * where the header's own primary is this same step; this is the other half —
   * a bill somebody comes BACK to, already confirmed, whose screen said "This
   * import has already been confirmed" and offered nothing to do about it.
   */
  const step = useNextStep(projectId || null);
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

  async function setLine(
    sheetIndex: number,
    index: number,
    patch: {
      categoryId?: string | null;
      level?: string | null;
      ignored?: boolean;
      replaces?: { recordId: string; recordVersion: number } | null;
    },
  ) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  /** A sheet's run name, or dropping the tab. Addressed the same way. */
  async function setSheet(
    sheetIndex: number,
    patch: { runName?: string; ignored?: boolean; replacesRunId?: string | null },
  ) {
    setError(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  /**
   * Accept every suggested level on one tab.
   *
   * One press, one line at a time, because the staged bill's own PATCH route is
   * per line — 59 records must not mean 59 visits, and the alternative is a new
   * bulk route for a screen whose confirm is about to write all of them anyway.
   * It reloads ONCE at the end rather than after every line, or the table
   * re-renders under the reviewer twenty-two times.
   */
  async function acceptAllLevels(sheetIndex: number, lines: Line[]) {
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) {
        if (!line.level) continue;
        const res = await apiFetch(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, level: line.level }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ignore every line the app has asked about as packaging or delivery.
   *
   * The SET comes from `linesToIgnore`, which is what the count on the button
   * was computed from — one reading, so the control cannot ignore something its
   * own label did not count. Sequential PATCHes and ONE reload, for the reason
   * `acceptAllLevels` does it that way: the staged bill's route is per line,
   * and reloading after each would re-render the table forty times.
   *
   * Every one of them is reversible from the Include checkbox, which is what
   * makes a batch action acceptable here at all (house/conventions §5).
   */
  async function ignoreAllSuggested(sheetIndex: number, lines: Line[]) {
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) {
        const res = await apiFetch(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, ignored: true }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setBlocked([]);
    try {
      const res = await apiFetch<{ imported: number; projectId: string; runs: number }>(`/api/imports/${id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: data.import.version }),
      });
      if (!res.ok) {
        setError(res.error);
        const lines = (res.data?.lines as { lineNo: number; code: string | null }[] | undefined) ?? [];
        setBlocked(lines);
        return;
      }
      // The project's run tabs, with the first one selected. A bill with three
      // tabs has just become three runs, and they are never shown merged.
      router.push(`/dashboard/projects/${res.data.projectId}?tab=spec`);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const sheets = run.parsed?.sheets ?? [];
  // The runs this bill could revise, and the live per-sheet reconciliation.
  // Both come from the server on every read: a record retired or paired since
  // the page loaded has to show as it is now.
  const runs = data.runs.filter((projectRun) => projectRun.status === "active");
  const activeSheets = sheets.filter((sheet) => !sheet.ignored);
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
            Parsed by code, not by a model — nothing here was charged. {sheets.length} tab
            {sheets.length === 1 ? "" : "s"}
            {revisionLabel && <> · {revisionLabel}</>}
            {/* A reload after an action. Inline rather than a spinner over the
                table: the rows stay readable and nothing on the page moves. */}
            {loading && <> · <span className="text-neutral-500">reloading…</span></>}
            {run.parsed?.sourcePreserved !== false && (
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
          <Button
            variant="primary"
            onClick={confirm}
            disabled={busy || run.status !== "parsed" || activeLines.length === 0}
          >
            {busy
              ? "Importing…"
              : revising
                ? `Confirm · updates this phase from ${activeLines.length} line${activeLines.length === 1 ? "" : "s"}`
                : `Confirm · creates ${activeLines.length} record${activeLines.length === 1 ? "" : "s"} on ${activeSheets.length} phase${activeSheets.length === 1 ? "" : "s"}`}
          </Button>
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
              }))}
            />
          ) : undefined
        }
      />

      <PageBody width="wide">
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
          <Note tone="danger" title="This bill could not be read, and nothing was staged from it.">
            {run.error ?? "The reader gave no reason, which is itself worth reporting."}
          </Note>
        )}

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
              {ignoredSheets[0]?.ignoredReason ? `, ${ignoredSheets[0].ignoredReason}` : ""}.
            </>
          ) : (
            "."
          )}
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
            (line) => line.level && line.levelStatus !== "chosen" && !notFurnitureIds.has(line.index),
          );
          const duplicates = duplicateGroups(sheet);
          const columns = reconciliation ? 9 : 8;
          return (
            <div key={sheet.sheetName + String(sheetIndex)} className={sheet.ignored ? "opacity-60" : undefined}>
              <Card
                title="This tab becomes a phase"
                actions={
                  <Button
                    size="xs"
                    disabled={run.status !== "parsed"}
                    onClick={() => void setSheet(sheetIndex, { ignored: !sheet.ignored })}
                  >
                    {sheet.ignored ? "Include this sheet" : "Drop this sheet"}
                  </Button>
                }
              >
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="block text-th font-semibold uppercase tracking-wider text-neutral-500">
                      Phase name
                    </span>
                    <input
                      defaultValue={sheet.proposedRunName}
                      disabled={run.status !== "parsed" || sheet.ignored}
                      onBlur={(event) => {
                        if (event.target.value.trim() === sheet.proposedRunName) return;
                        void setSheet(sheetIndex, { runName: event.target.value });
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
                <p className="mt-3 text-xs text-neutral-500">{describeHeader(sheet)}</p>

                {/* IS THIS A NEW RUN, OR A REVISION OF ONE?
                    Never chosen automatically. A revised bill that silently
                    replaced a run would rewrite quantities on records somebody
                    is already working from; one that silently made a new run
                    leaves the work stranded on the old copy. Both are
                    consequential, so a person says which. */}
                {!sheet.ignored && runs.length > 0 && run.status === "parsed" && (
                  <label className="mt-3.5 block text-sm text-neutral-600">
                    This sheet is
                    <select
                      value={sheet.replacesRunId ?? ""}
                      disabled={busy}
                      onChange={(event) => void setSheet(sheetIndex, { replacesRunId: event.target.value || null })}
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

              {reconciliation && (
                <Note
                  tone="info"
                  title={`${reconciliation.counts.changed} changed`}
                  className="mt-4"
                >
                  · {reconciliation.counts.paired - reconciliation.counts.changed} unchanged ·{" "}
                  {reconciliation.counts.new} new · {reconciliation.counts.missing} no longer listed
                  {reconciliation.counts.ambiguous > 0 && (
                    <> · <b>{reconciliation.counts.ambiguous} to pair by hand</b></>
                  )}
                  <p className="mt-0.5">
                    Items carried forward keep their record — and with it their drawings, their specs, their picture
                    and their answers. Only the bill&rsquo;s own columns are written over.
                  </p>
                  {reconciliation.missing.length > 0 && (
                    <>
                      <p className="mt-1.5 font-semibold">Not in this revision — these will be retired, not deleted:</p>
                      <ul className="mt-1 space-y-0.5">
                        {reconciliation.missing.map((missing) => (
                          <li key={missing.recordId}>
                            <span className="font-mono">{missing.label}</span> {missing.itemDescription}
                            {missing.codes.length > 0 && <span> · {missing.codes.join(", ")}</span>}
                            {/* Named, not counted. A record with 14 specs and a
                                picture is somebody's afternoon, and pairing it
                                is usually what was meant. */}
                            {(missing.attributeCount > 0 || missing.hasImage || missing.settledAnswers > 0) && (
                              <span className="text-amber-800">
                                {" — carries "}
                                {[
                                  missing.attributeCount > 0
                                    ? `${missing.attributeCount} spec${missing.attributeCount === 1 ? "" : "s"}`
                                    : null,
                                  missing.settledAnswers > 0
                                    ? `${missing.settledAnswers} answer${missing.settledAnswers === 1 ? "" : "s"}`
                                    : null,
                                  missing.hasImage ? "a picture" : null,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                                . Pair it with a line above, or it stops being live.
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Note>
              )}

              {!sheet.ignored && (
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
                      {notFurniture.length > 0 && (
                        <Chip tone="info">
                          {notFurniture.length} may not be furniture
                        </Chip>
                      )}
                    </>
                  }
                  actions={
                    run.status === "parsed" && (notFurniture.length > 0 || suggested.length > 0) ? (
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
                        {suggested.length > 0 && (
                          <SuggestButton
                            value={`Accept all ${suggested.length}`}
                            evidence="each row says what it was read from"
                            busy={busy}
                            onAccept={() => void acceptAllLevels(sheetIndex, suggested)}
                          />
                        )}
                      </span>
                    ) : undefined
                  }
                >
                  <Table scroll>
                    <thead>
                      <tr>
                        <Th>Row</Th>
                        <Th>Client ref</Th>
                        <Th>Item</Th>
                        <Th>Area</Th>
                        <Th num>Qty</Th>
                        <Th>Designer</Th>
                        {reconciliation && <Th>Against the phase</Th>}
                        <Th>
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
                      {sheet.lines.map((line) => {
                        const duplicated = isDuplicated(sheet, line);
                        return (
                          <Tr
                            key={line.index}
                            tone={duplicated ? "warn" : "plain"}
                            className={line.ignored ? "opacity-40" : undefined}
                          >
                            <Td muted>{line.lineNo}</Td>
                            <Td mono>{line.code ?? "—"}</Td>
                            <Td>
                              {line.itemDescription}
                              {line.productReference && (
                                <span className="text-neutral-500"> · {line.productReference}</span>
                              )}
                            </Td>
                            <Td>{line.area ?? line.boqCategory ?? "—"}</Td>
                            {/* NO QUANTITY IS NOT A DASH AND IT IS NEVER A 1.
                                A bill with no `TOTAL Q-ty` column gives every
                                line a null quantity (variance matrix row 2),
                                and an em dash there reads as "nothing to say"
                                rather than as a gap somebody has to close. The
                                tab's own sentence above says it once for the
                                whole sheet; this is short because the column is
                                narrow and there are three hundred of them. */}
                            <Td num>
                              {line.qty === null ? (
                                <span
                                  className="text-[11px] text-amber-800"
                                  title="The bill gave no quantity for this line. Nothing is assumed."
                                >
                                  not given
                                </span>
                              ) : (
                                <>
                                  {line.qty}
                                  {line.qtyUnit && <span className="text-neutral-400"> {line.qtyUnit}</span>}
                                </>
                              )}
                            </Td>
                            <Td mono muted>
                              {line.designer ?? "—"}
                            </Td>
                            {reconciliation && (
                              <Td>
                                {(() => {
                                  const pairing = pairingFor(line.index);
                                  if (!pairing || line.ignored) return <span className="text-neutral-400">—</span>;
                                  return (
                                    <div>
                                      <select
                                        value={
                                          line.replaces?.recordId ??
                                          (pairing.status === "paired" ? (pairing.suggestedRecordId ?? "") : "")
                                        }
                                        disabled={run.status !== "parsed" || busy}
                                        onChange={(event) => {
                                          const recordId = event.target.value;
                                          const record = reconciliation.records.find((row) => row.id === recordId);
                                          void setLine(sheetIndex, line.index, {
                                            // The VERSION the reviewer is
                                            // looking at travels with the
                                            // pairing, so a record edited since
                                            // refuses the confirm rather than
                                            // being quietly overwritten.
                                            replaces: record
                                              ? { recordId: record.id, recordVersion: record.version }
                                              : null,
                                          });
                                        }}
                                        className={`max-w-[13rem] rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                                          pairing.status === "ambiguous" && !line.replaces
                                            ? "border-amber-400 bg-amber-50"
                                            : "border-neutral-300"
                                        }`}
                                      >
                                        <option value="">new item</option>
                                        {reconciliation.records.map((record) => (
                                          <option key={record.id} value={record.id}>
                                            {record.label} · {record.itemDescription.slice(0, 32)}
                                          </option>
                                        ))}
                                      </select>
                                      {pairing.status === "ambiguous" && !line.replaces && (
                                        <p className="mt-0.5 text-xs text-amber-800">
                                          This code is on {pairing.candidates.length} records. Choose which one, or
                                          leave it as a new item.
                                        </p>
                                      )}
                                      {pairing.deltas.length > 0 && (
                                        <ul className="mt-0.5 text-xs text-neutral-600">
                                          {pairing.deltas.map((delta) => (
                                            <li key={delta.field}>
                                              {delta.label}:{" "}
                                              <span className="text-neutral-400 line-through">{delta.was ?? "—"}</span>{" "}
                                              → <span className="text-neutral-900">{delta.now ?? "—"}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {pairing.status === "paired" && pairing.deltas.length === 0 && (
                                        <p className="mt-0.5 text-xs text-neutral-500">unchanged</p>
                                      )}
                                    </div>
                                  );
                                })()}
                              </Td>
                            )}
                            <Td>
                              <select
                                value={line.categoryId ?? ""}
                                disabled={run.status !== "parsed" || line.ignored}
                                onChange={(e) =>
                                  setLine(sheetIndex, line.index, { categoryId: e.target.value || null })
                                }
                                className="max-w-xs rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                              >
                                <option value="">— not yet —</option>
                                {data.categories.map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
                                  </option>
                                ))}
                              </select>
                              {line.categoryStatus !== "chosen" && STATUS_LABEL[line.categoryStatus] && (
                                <span className="ml-1.5 text-xs text-neutral-500">
                                  {STATUS_LABEL[line.categoryStatus]}
                                </span>
                              )}
                            </Td>
                            {/* THE LEVEL, GUESSED AND ONE CLICK FROM A DECISION.
                                A record with no level cannot be tiered at all,
                                so a 59-line bill used to arrive as 59 records
                                reading "Set level". A guess is a
                                `SuggestButton` with the words it was read from
                                beside it, NEVER a select already showing the
                                guess: a select reading "Hero" fires no change
                                event when somebody chooses Hero, so the one act
                                recording their agreement would do nothing. */}
                            <Td>
                              <LevelCell
                                line={line}
                                editable={run.status === "parsed" && !line.ignored}
                                busy={busy}
                                onSet={(level) => void setLine(sheetIndex, line.index, { level })}
                              />
                            </Td>
                            {/* INCLUDE, AND THE ONE QUESTION THAT ASKS TO CHANGE
                                IT. The suggestion sits in this cell rather than
                                beside the description, because what it acts on
                                is the checkbox under it: a reviewer who accepts
                                it and changes their mind can see the way back
                                without moving their eyes. Nothing is ignored on
                                its own — this is the only control that does it,
                                and the checkbox undoes it. */}
                            <Td>
                              <input
                                type="checkbox"
                                checked={!line.ignored}
                                disabled={run.status !== "parsed"}
                                aria-label={`Include row ${line.lineNo}`}
                                onChange={() => setLine(sheetIndex, line.index, { ignored: !line.ignored })}
                              />
                              {(() => {
                                const guess = nonFurnitureOf(line);
                                if (!guess || line.ignored || run.status !== "parsed") return null;
                                return (
                                  <SuggestButton
                                    value="Not furniture"
                                    evidence={guess.reason}
                                    busy={busy}
                                    onAccept={() => void setLine(sheetIndex, line.index, { ignored: true })}
                                    className="mt-1.5"
                                  />
                                );
                              })()}
                            </Td>
                          </Tr>
                        );
                      })}
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
