"use client";

// The review screen. Everything here is a draft: nothing has been written to a
// spec record until Confirm.
//
// Category suggestions are shown with the document's own wording next to them,
// and an ambiguous match offers candidates rather than picking one. A line the
// matcher could not resolve stays blank — a plausible guess in a field a human
// skims past is worse than an obvious gap.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type Registers, type SpecImport } from "@/components/imports/SpecDocumentReview";
import { type EmailMessage } from "@/components/imports/EmailHeader";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";
import Button, { buttonClass } from "@/components/ui/Button";
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
import { describeHeader, sheetsAwaitingColumnCheck, sheetsNeedingColumns } from "@/lib/boq-import";
// Pure: the one rule about what a row is, what stops a fabric line, and what
// the Confirm button says it will write — the same functions the confirm runs.
import {
  boqConfirmCounts,
  boqConfirmLabel,
  rowKindProblems,
  type BoqRowKind,
  type RowKindFields,
} from "@/lib/boq-row-kinds";
import BoqRowKindCell from "@/components/imports/BoqRowKindCell";
// Pure: the area a record will carry (a Sub-Area composed in), the same
// function the confirm writes it with, so the table shows what will be written.
import { effectiveArea } from "@/lib/boq-reconcile";
import { BOQ_ROLE_LABELS, BOQ_MAPPING_SOURCE_LABELS, columnLetter, type BoqReadRole } from "@/lib/boq-roles";
import BoqColumnsPanel, { type ColumnsPanelSheet } from "@/components/imports/BoqColumnsPanel";
// Pure: the "this may not be furniture" question, and the set the batch action
// acts on. The page NEVER decides either for itself — one function behind the
// count on the button and the loop behind it.
import { linesToIgnore, nonFurnitureOf, type NonFurnitureGuess } from "@/lib/non-furniture-guess";
// Pure: the refs one tab carries twice, and — the same set, which is why it is
// one module — the rows a decision on this tab reaches on the others. The
// duplicate panel used to compute its own fold here; the carry must use
// `normaliseRef`, and two folds is how the amber panel and the carry come to
// disagree about which rows are ambiguous.
import { duplicateGroups, isDuplicated } from "@/lib/boq-carry";
import { formatDay } from "@/lib/format-day";
import PageBody from "@/components/ui/PageBody";
import Tabs from "@/components/ui/Tabs";

type Line = {
  replaces?: { recordId: string; recordVersion: number } | null;
  index: number; lineNo: number; designer: string | null; boqCategory: string | null;
  area: string | null; code: string | null; itemDescription: string; productReference: string | null;
  qty: number | null; qtyUnit: string | null;
  // Present only where the bill has the column (v4) — see `BoqLine`.
  subArea?: string | null; sourceLine?: string | null; notes?: string | null;
  categoryId: string | null; categoryStatus: string;
  categoryCandidates?: { id: string; name: string }[]; ignored: boolean;
  // Guessed at parse time, corrected here. `chosen` is what makes it a
  // decision the quote gate may read; see db/migrations/0025.
  level?: string | null; levelStatus?: string; levelReason?: string | null;
  /**
   * WHICH TAB THIS VALUE WAS DECIDED ON, where it was not this one.
   *
   * A bill's tabs are phases quoting the same codes, so a decision about
   * `S-100` on MUR is a decision about the item — see `src/lib/boq-carry.ts`.
   * A carried value arrives as `chosen`, because that is what it is; this is
   * what keeps it honest about whose tab it was taken on, and it is what
   * protects a person's own choice here from the next carry.
   *
   * OPTIONAL, and absent is the ordinary state: nothing carried into this row.
   */
  levelCarriedFrom?: string | null; categoryCarriedFrom?: string | null;
  // "This may not be furniture", asked at staging. ABSENT on a bill staged
  // before the question existed, which `nonFurnitureOf` answers at read time.
  nonFurnitureSuggested?: NonFurnitureGuess | null;
} & RowKindFields;

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
 * WHERE A VALUE WAS DECIDED, where it was not decided here.
 *
 * A bill's tabs are PHASES quoting the same codes, so accepting a level on
 * `S-100` in MUR is a decision about the item and it lands on `S-100` wherever
 * else the bill lists it. The receiving row says so, because a decision that
 * appeared on a tab nobody was looking at is one nobody can check — and it can
 * be changed here, which is what makes the carry safe for a value-engineered
 * phase that genuinely differs.
 *
 * It renders nothing at all on the ordinary row, so the column does not grow a
 * line of grey text on every item in the bill.
 */
function CarriedFrom({ tab }: { tab?: string | null }) {
  if (!tab) return null;
  return (
    <span className="mt-1 block text-[10.5px] text-neutral-500">
      carried from <span className="font-mono">{tab}</span>
    </span>
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
      <>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Chip tone="good">{ITEM_LEVEL_LABELS[line.level as keyof typeof ITEM_LEVEL_LABELS] ?? line.level}</Chip>
          {editable && (
            <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </span>
        <CarriedFrom tab={line.levelCarriedFrom} />
      </>
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
type Sheet = Omit<ColumnsPanelSheet, "lines"> & {
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
  /** Whether the original is stored, so a failed bill can be read again from it. */
  has_source?: boolean;
  /** What a model's structure read left on the run (`/suggest-columns`). */
  model_metadata?: { structureRead?: StructureReadState } | null;
  parsed: { schemaVersion: 3 | 4; filename: string | null; sourcePreserved?: boolean; sheets: Sheet[] } | null;
};

/** The parts of `model_metadata.structureRead` the screen reads. */
type StructureReadState = {
  pending?: { requestId: string; at: string; sheets: string[] } | null;
  sheets?: Record<string, { at: string; ok: boolean; outcome: string }>;
};

/** A claim this old is a request that died, and the screen stops waiting on it. */
const STRUCTURE_CLAIM_MS = 330_000;

function structurePending(state: StructureReadState | undefined): boolean {
  const pending = state?.pending;
  return Boolean(pending && Date.now() - new Date(pending.at).getTime() < STRUCTURE_CLAIM_MS);
}

/** A reason sentence joined into another, without its own full stop. */
function asClause(text: string): string {
  return text.trim().replace(/[.!\s]+$/, "");
}

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
    billSpecs: { id: string; status: string } | null;
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
  /**
   * WHAT A PRESS DID ON THE TABS THE REVIEWER IS NOT LOOKING AT.
   *
   * Not an error and not a suggestion: a decision they took, reported where
   * they took it. It clears on the next action, like the banner above it.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which sheet is shown. A BOQ tab is a sub-quote, so a tab each. */
  const [sheetTab, setSheetTab] = useState(0);
  /**
   * Sheets whose Columns panel somebody opened with "Change columns". A sheet
   * nobody has mapped, and one a saved layout read that nobody has checked,
   * show theirs regardless — see `panelOpen` below.
   */
  const [openPanels, setOpenPanels] = useState<Set<number>>(() => new Set());
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
  /**
   * THE MODEL IS READING THIS BILL'S COLUMNS, from this tab — `all` for the
   * automatic read, or the sheet a panel's button asked about. A read another
   * tab started shows the same sentence, from the server's own claim.
   */
  const [asking, setAsking] = useState<"all" | number | null>(null);
  /** Why the last structure read did not land, with the retry beside it. */
  const [structureError, setStructureError] = useState<string | null>(null);
  /** Once per visit: the automatic read never fires twice from one screen. */
  const autoAsked = useRef(false);
  const [specsBusy, setSpecsBusy] = useState(false);

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
      billSpecs?: { id: string; status: string } | null;
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
      billSpecs: res.data.billSpecs ?? null,
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
    setNotice(null);
    const res = await apiFetch<{ carried?: number; carriedTo?: string }>(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, ...patch }),
    });
    if (!res.ok) { setError(res.error); return; }
    // WHAT IT DID SOMEWHERE ELSE, SAID OUT LOUD. The receiving row carries the
    // sentence, but the person is looking at the tab they decided on — so
    // without this a press that changed three tabs looks like a press that
    // changed one cell.
    const carried = res.data?.carried ?? 0;
    if (carried > 0) {
      setNotice(
        `Also filled in on ${carried} line${carried === 1 ? "" : "s"} carrying the same client ref${
          res.data?.carriedTo ? ` — ${res.data.carriedTo}` : ""
        }. Each says where it came from and can be changed there.`,
      );
    }
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
    setNotice(null);
    // Each accepted level carries to the same client ref on the other tabs, so
    // the sentence at the end is the TOTAL — one count for one press, rather
    // than twelve notices the last of which is the only one anybody reads.
    let carried = 0;
    try {
      for (const line of lines) {
        if (!line.level) continue;
        const res = await apiFetch<{ carried?: number }>(`/api/imports/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheetIndex, index: line.index, level: line.level }),
        });
        if (!res.ok) {
          setError(res.error);
          break;
        }
        carried += res.data?.carried ?? 0;
      }
      if (carried > 0) {
        setNotice(
          `Also filled in on ${carried} line${carried === 1 ? "" : "s"} on the other phases carrying the same client ` +
            `refs. Each says where it came from and can be changed there.`,
        );
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

  /**
   * READ THE WHOLE BILL AGAIN from its stored source — free, by code. For a
   * bill that failed (every one refused before 0040 included) and for one
   * staged before its columns were recorded. Reload first, then report.
   */
  async function readAgain() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${id}/columns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reread", version: data.import.version }),
      });
      await load();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Read again from the stored spreadsheet. Nothing was charged and nothing is confirmed.");
    } finally {
      setBusy(false);
    }
  }

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

  /**
   * ASK THE MODEL TO READ THE COLUMNS — one small read, charged. `sheetIndex`
   * absent is the automatic read of every live sheet nobody could map. A
   * request id per press, so a retried request is answered from the record
   * rather than read (and charged) again. Reload first, then report.
   */
  const askModel = useCallback(
    async (sheetIndex?: number) => {
      if (!data) return;
      setAsking(sheetIndex ?? "all");
      setStructureError(null);
      setNotice(null);
      try {
        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
        const res = await apiFetch<{ nothing?: boolean; charged?: number }>(`/api/imports/${id}/suggest-columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: data.import.version,
            requestId,
            ...(sheetIndex === undefined ? {} : { sheetIndex }),
          }),
        });
        await load(true);
        if (!res.ok) {
          const code = (res.data as { code?: string } | null)?.code;
          // Another tab's read is not a failure: this screen waits for it.
          if (code === "structure_read_running") setNotice(res.error);
          else setStructureError(res.error);
          return;
        }
        // No notice on success: the yellow banner that the reload brings up
        // says the same thing, on every sheet the model read, until the
        // reviewer checks it — two banners for one fact is one to ignore.
      } finally {
        setAsking(null);
      }
    },
    [data, id, load],
  );

  /**
   * THE AUTOMATIC READ: once, the first time this screen opens a bill with a
   * live sheet nobody could map and no structure read on record. Never on a
   * bill whose original was not kept (there is nothing to re-read with the
   * answer), never while another tab's read is in flight, and never twice
   * from one visit.
   */
  useEffect(() => {
    if (!data || autoAsked.current) return;
    const bill = data.import;
    if (bill.source_kind !== "boq_xlsx" || bill.status !== "parsed" || bill.has_source === false) return;
    if (bill.parsed?.sourcePreserved === false) return;
    const state = bill.model_metadata?.structureRead;
    if (structurePending(state)) return;
    const wanted = (bill.parsed?.sheets ?? []).some(
      (sheet) => sheet.needsColumns && !sheet.ignored && !state?.sheets?.[sheet.sheetName],
    );
    if (!wanted) return;
    autoAsked.current = true;
    void askModel();
  }, [data, askModel]);

  /** Another tab is reading: look again quietly until its claim clears. */
  const otherTabReading = asking === null && structurePending(data?.import.model_metadata?.structureRead);
  useEffect(() => {
    if (!otherTabReading) return;
    const timer = setInterval(() => void load(true), 4000);
    return () => clearInterval(timer);
  }, [otherTabReading, load]);

  /** A line's kind, set by a person. The route checks the item against the live sheet. */
  async function setLineKind(sheetIndex: number, index: number, rowKind: BoqRowKind, finishForRow: number | null) {
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/imports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetIndex, index, rowKind, ...(finishForRow === null ? {} : { finishForRow }) }),
    });
    await load();
    if (!res.ok) setError(res.error);
  }

  /**
   * READ THE SPECIFICATIONS IN THIS BILL — one read, charged, on the button.
   * Registers this bill's own stored file as a specification document; a
   * second press returns the read the first one started.
   */
  async function readSpecifications() {
    setSpecsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ importId: string; reused?: boolean; autoRead?: { dispatched: boolean; error?: string } }>(
        `/api/imports/${id}/read-specifications`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      await load(true);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.autoRead && !res.data.autoRead.dispatched && res.data.autoRead.error) {
        setError(`Registered, but its read did not start: ${res.data.autoRead.error} Retry it from the Documents tab.`);
        return;
      }
      setNotice(
        res.data.reused
          ? "The specifications in this bill are already being read — nothing more was charged."
          : "Reading the specifications in this bill. They arrive as a document to review, like any other.",
      );
    } finally {
      setSpecsBusy(false);
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
            {Object.keys(run.model_metadata?.structureRead?.sheets ?? {}).length > 0
              ? "Every cell read by code; the model read the columns (one small read, charged)."
              : "Parsed by code, not by a model — nothing here was charged."}{" "}
            {sheets.length} tab
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
            disabled={
              busy ||
              reading ||
              run.status !== "parsed" ||
              activeLines.length === 0 ||
              unmapped.length > 0 ||
              unchecked.length > 0 ||
              kindProblems.length > 0
            }
            title={
              unmapped.length > 0
                ? "Set the columns of every live sheet, or drop it, first."
                : unchecked.length > 0
                  ? "Check the columns the model read, and press “The columns are right”, first."
                  : kindProblems.length > 0
                    ? "Say which item each fabric line belongs to first."
                    : undefined
            }
          >
            {boqConfirmLabel({ counts, revising, unmapped: unmapped.length, busy })}
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

        {/* THE MODEL IS READING THE COLUMNS — said before it answers, with the
            charge, because the screen is otherwise a panel nobody should start
            filling in while the reading is about to replace it. */}
        {reading && (
          <Note tone="info" title="Reading the columns…">
            One small read, charged. The model reads the layout — the header, what each column is and which rows
            are fabric lines, sections or subtotals — and code then reads every cell from the stored spreadsheet.
            {asking === null && " It was started from another tab or a moment ago; this screen shows the result when it lands."}
          </Note>
        )}
        {structureError && !reading && (
          <Note
            tone="warn"
            title="The model did not read the columns."
            actions={
              canAsk ? (
                <Button size="sm" onClick={() => void askModel()}>
                  Ask again
                </Button>
              ) : undefined
            }
          >
            {structureError} The Columns panel still works by hand, and that is free.
          </Note>
        )}
        {/* A MODEL'S COLUMNS, NOT YET AGREED TO. Yellow, because it is a guess
            until a person has looked; the confirm refuses until they say so. */}
        {run.status === "parsed" && unchecked.length > 0 && (
          <Note tone="guess" title="Columns and row kinds read by the model — check them.">
            {unchecked.length === 1 ? (
              <>
                On <span className="font-mono">{unchecked[0]?.sheetName}</span>, check each column on the panel and
                the Kind of each line, then press <b>The columns are right</b>.
              </>
            ) : (
              <>
                On {unchecked.map((sheet) => sheet.sheetName).join(", ")}, check each column and the Kind of each line,
                then press <b>The columns are right</b> on each.
              </>
            )}{" "}
            The model never typed a value: every code, description and quantity below was read by code.
          </Note>
        )}
        {run.status === "parsed" && kindProblems.length > 0 && (
          <Note tone="warn" title="A fabric line has no item to be written onto.">
            {kindProblems.map((problem) => problem.problem).join(" ")}
          </Note>
        )}

        {/* WHICH SHEETS STILL NEED SOMEBODY, named, above everything else: the
            confirm is disabled until each is mapped or dropped, and a disabled
            button that does not say why is a screen nobody can finish. */}
        {run.status === "parsed" && unmapped.length > 0 && (
          <Note tone="warn" title="Say which column is which before confirming.">
            {unmapped.length === 1 ? (
              <>
                Nothing has been read from <span className="font-mono">{unmapped[0]?.sheetName}</span> yet: set its
                columns below, or drop the sheet if it is not a bill.
              </>
            ) : (
              <>
                Nothing has been read from {unmapped.length} sheets yet (
                {unmapped.map((sheet) => sheet.sheetName).join(", ")}): set each one&rsquo;s columns, or drop the ones
                that are not a bill.
              </>
            )}
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
              {ignoredSheets[0]?.ignoredReason ? ` — ${asClause(ignoredSheets[0].ignoredReason)}` : ""}.
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
        {/* THE SPECIFICATIONS IN THE BILL'S OWN WORDS. A description cell packs
            sizes, models and finishes; the confirm made records and never read
            what the words say. One press registers this file as a specification
            document and reads it — charged, and said so on the button. */}
        {run.status === "confirmed" && run.has_source !== false && (
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
            (line) => line.level && line.levelStatus !== "chosen" && !notFurnitureIds.has(line.index),
          );
          // A fabric line is not a record, so the code it carries is not a client
          // ref two records share: `GR-FAB-13` under six items is one fabric.
          const duplicates = duplicateGroups({ ...sheet, lines: sheet.lines.filter((line) => line.rowKind !== "finish_for") });
          const problemByRow = new Map(rowKindProblems(sheet.lines).map((problem) => [problem.lineNo, problem.problem]));
          const columns = reconciliation ? 10 : 9;
          /**
           * THE COLUMNS PANEL IS OPEN when nobody has mapped this sheet yet
           * (unless it is dropped, when it waits to be asked for), when a
           * SAVED LAYOUT read it and nobody has looked — a remembered layout
           * must never apply unseen — or when somebody pressed Change columns.
           */
          const layoutUnchecked =
            (sheet.mappingSource === "layout" || sheet.mappingSource === "model") && !sheet.columnsChecked;
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
              <Card
                title="This tab becomes a phase"
                actions={
                  <>
                    {/* OFFERED ON EVERY BILL SHEET, including one the synonyms
                        read: a wrong match is correctable only if it is
                        visible, and the panel is where it is visible. */}
                    {!panelOpen && run.status === "parsed" && (
                      <Button size="xs" onClick={() => setPanel(true)}>
                        {sheet.needsColumns ? "Set the columns" : "Change columns"}
                      </Button>
                    )}
                    <Button
                      size="xs"
                      disabled={run.status !== "parsed"}
                      onClick={() => void setSheet(sheetIndex, { ignored: !sheet.ignored })}
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
                        Read with the <b className="text-neutral-700">{sheet.layout.name}</b> layout:{" "}
                      </>
                    ) : sheet.mappingSource ? (
                      <>Columns ({BOQ_MAPPING_SOURCE_LABELS[sheet.mappingSource]}): </>
                    ) : null}
                    {(Object.entries(sheet.columns) as [BoqReadRole, { index: number; heading: string }][])
                      .sort((a, b) => a[1].index - b[1].index)
                      .map(([role, ref]) => `${BOQ_ROLE_LABELS[role]} ← “${ref.heading || "no heading"}” (${columnLetter(ref.index)})`)
                      .join(" · ")}
                  </p>
                )}

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

              {panelOpen && (
                <BoqColumnsPanel
                  // Re-mounted when what was READ changes, so a successful read
                  // shows the new mapping — and NOT on every autosave, which
                  // bumps the version and would throw away half-set selects.
                  key={`${sheetIndex}:${sheet.headerRow}:${sheet.headerRows ?? 1}:${JSON.stringify(sheet.columns ?? {})}`}
                  importId={run.id}
                  sheetIndex={sheetIndex}
                  sheet={sheet}
                  version={run.version}
                  editable={run.status === "parsed"}
                  sourceKept={run.parsed?.sourcePreserved !== false && run.has_source !== false}
                  onRead={(message) => afterColumns(sheetIndex, message)}
                  onClose={sheet.needsColumns ? undefined : () => setPanel(false)}
                  onIgnoreSheet={() => {
                    setPanel(false);
                    void setSheet(sheetIndex, { ignored: true });
                  }}
                  onAsk={canAsk ? () => void askModel(sheetIndex) : undefined}
                  asking={reading}
                />
              )}
              {panelOpen && (sheet.preview?.length ?? 0) === 0 && run.status === "parsed" && run.has_source && (
                <div className="mt-2">
                  <Button size="sm" disabled={busy} onClick={() => void readAgain()}>
                    {busy ? "Reading…" : "Read the whole bill again"}
                  </Button>
                </div>
              )}

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
                        <Th className="w-[170px]">
                          Kind
                          <Tip>
                            A fabric line is not a record: it is written as the next free COM spec on its item. A section,
                            subtotal or blank row is left out, and its Include box brings it back.
                          </Tip>
                        </Th>
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
                        const fabric = line.rowKind === "finish_for";
                        const duplicated = !fabric && isDuplicated(sheet, line);
                        return (
                          <Tr
                            key={line.index}
                            tone={duplicated ? "warn" : "plain"}
                            className={line.ignored ? "opacity-40" : undefined}
                          >
                            <Td muted>
                              {line.lineNo}
                              {/* The bill's OWN line number, where it has a
                                  column for one. Shown, never written: the row
                                  is what "go and look" needs. */}
                              {line.sourceLine && (
                                <span className="block text-[10.5px] text-neutral-400">line {line.sourceLine}</span>
                              )}
                            </Td>
                            <Td>
                              <BoqRowKindCell
                                line={line}
                                lines={sheet.lines}
                                editable={run.status === "parsed"}
                                busy={busy}
                                problem={problemByRow.get(line.lineNo) ?? null}
                                onSet={(kind, finishForRow) => void setLineKind(sheetIndex, line.index, kind, finishForRow)}
                              />
                            </Td>
                            <Td mono>{line.code ?? "—"}</Td>
                            <Td>
                              {line.itemDescription}
                              {line.productReference && (
                                <span className="text-neutral-500"> · {line.productReference}</span>
                              )}
                              {line.notes && (
                                <span className="mt-0.5 block text-xs text-neutral-500">Notes: {line.notes}</span>
                              )}
                            </Td>
                            {/* What the record will carry: `effectiveArea` is
                                the function the confirm writes it with, so a
                                Sub-Area shows here composed exactly as stored. */}
                            <Td>{effectiveArea(line) ?? "—"}</Td>
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
                            {fabric ? (
                              <Td colSpan={2} className="text-xs text-neutral-600">
                                Not a record — its description is written as a fabric spec on row{" "}
                                {line.finishFor?.row ?? "—"}
                                {line.finishFor?.code ? ` (${line.finishFor.code})` : ""}.
                              </Td>
                            ) : (
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
                              <CarriedFrom tab={line.categoryCarriedFrom} />
                            </Td>
                            )}
                            {/* THE LEVEL, GUESSED AND ONE CLICK FROM A DECISION.
                                A record with no level cannot be tiered at all,
                                so a 59-line bill used to arrive as 59 records
                                reading "Set level". A guess is a
                                `SuggestButton` with the words it was read from
                                beside it, NEVER a select already showing the
                                guess: a select reading "Hero" fires no change
                                event when somebody chooses Hero, so the one act
                                recording their agreement would do nothing. */}
                            {!fabric && (
                            <Td>
                              <LevelCell
                                line={line}
                                editable={run.status === "parsed" && !line.ignored}
                                busy={busy}
                                onSet={(level) => void setLine(sheetIndex, line.index, { level })}
                              />
                            </Td>
                            )}
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
                              {line.ignored && line.ignoredBecause && (
                                <span className="mt-1 block text-[10.5px] text-neutral-500">
                                  left out: {line.ignoredBecause}
                                </span>
                              )}
                              {(() => {
                                const guess = fabric ? null : nonFurnitureOf(line);
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
