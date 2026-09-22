"use client";

// The spec table for ONE RUN. Never for several at once.
//
// `runId` is required, and that is the point rather than an accident of the
// call sites. A BOQ's tabs are sub-quotes -- a mock-up run, a main run, a
// value-engineered run -- quoting the SAME item codes at different quantities,
// so a table holding all three shows three of everything with no column that
// says which is which. There used to be a second screen that mounted this
// without a run and did exactly that; it was deleted rather than fixed,
// because the merged view is not a view anybody wanted.
//
// Extracted from the page so the project screen can mount one per run tab. The
// CAPTURED bar is how much of the record's checklist is answered; the number of
// statements a document has made about it is on the record itself, because two
// raw fractions side by side told a reader less than one picture does.
//
// ============================================================================
// THE HEADER BAND IS THE PROJECT'S, AND THIS REPORTS INTO IT.
//
// The mock-up puts the run's own subtitle and its actions in the page's header
// band — `MAIN RUN · BOQ rev 0, 14-Sep-26 · 22 items`, and `Chase 148` beside
// the outputs. Those are numbers this component has already loaded, and a
// second fetch for one of them would be a second reading of the same rule: the
// project screen's summary counts the WHOLE project, and `to_quote_outstanding`
// is per record and per run. So `onSummary` hands the run's own tally up, from
// the payload already on screen, and the header renders what the table is
// showing rather than a number computed somewhere else.
//
// It is held in a ref and called from `load`, never from an effect with the
// callback in its dependencies: a caller passing a lambda is ordinary React,
// and the crop queue already paid for that mistake once (33 rasterisations for
// 12 panels).
// ============================================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import Tip from "@/components/ui/Tip";
import StatTile from "@/components/ui/StatTile";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { unallocatedQty } from "@/lib/record-variants";
import { GATE_SHORT_LABELS, NO_MATRIX_CATEGORY_EXPLANATION, type Gate } from "@/lib/gates";
import type { GateSummaryEntry } from "@/lib/gate-load";
import AddItem from "@/components/records/AddItem";
import AreaSelect from "@/components/ui/AreaSelect";
import { areaOptions, matchesArea } from "@/lib/area-filter";
import { useUrlTab } from "@/lib/use-url-tab";
import { letterColour } from "@/components/records/letter-colours";
import {
  SPECS_AGREED_LABEL,
  URGENCY_LABELS,
  daysUntilSpecsAgreed,
  hasProgramme,
  recordUrgency,
  todayLocal,
  type ProgrammeDates,
  type RecordUrgency,
} from "@/lib/project-programme";

export type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  status: string; retired_at: string | null; retired_by: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  /**
   * EVERY ref system this record holds. Searchable, and NOT what the Code
   * column prints: see `client_code`.
   */
  refs: string | null;
  /**
   * The `boq_code` refs, read through a configuration's parent — the export's
   * own Client Code clause, identically. The Code column prints THIS, because
   * the column is a claim about what the file will carry and `refs` is not:
   * a record holding only a `bws_job` ref used to show that job number here
   * and ship a blank code.
   */
  client_code: string | null;
  run_id: string; run_name: string; attribute_count: string;
  /** A fabric split (0024): the bill line this configuration belongs to. */
  parent_id: string | null;
  variant_label: string | null;
  /** A configuration carries no client ref of its own — it shows its parent's. */
  parent_refs: string | null;
  /** Live configurations under this record. More than none makes it a HEADING. */
  variant_count: string;
  /** What its configurations have taken of the bill's quantity. */
  variant_qty: string;
  category_name: string | null; category_family: string | null; requirements_authored: boolean;
  spec_total: string; spec_settled: string; spec_tbc: string; spec_missing: string;
  ready_total: string; ready_settled: string; ready_tbc: string; ready_missing: string;
  level: string | null;
  /** A level this app guessed. Advisory: it tiers nothing until accepted. */
  level_suggested: string | null;
  level_suggested_reason: string | null;
  /** The optimistic lock, for the inline level accept. */
  version: number;
  /** Derived per read, never stored: see /api/records. */
  waiting: number;
  /** null where the record has no level — not the same as "nothing is blocking". */
  to_quote_outstanding: number | null;
  to_quote_waiting: number;
  /**
   * WHICH questions those are, named rather than counted — and ABSENT until
   * somebody opens a cell. Absent is not empty: a row this table has never
   * asked about must not render as a row with nothing outstanding.
   *
   * They come out of `loadOutstanding`'s own output, in the same loop that made
   * the count, so a cell can never open onto a different set from the number it
   * opened. See `/api/records`.
   */
  to_quote_questions?: ToQuoteQuestion[];
  /**
   * Per gate, from Matthew's matrix (0026): this gate's own outstanding
   * fields, and the earlier gates holding it up. NULL where this record's
   * category is not one of the nine his matrix covers — printed as "—", never
   * as zero, because "no rules written yet" and "nothing left to do" are
   * different answers.
   *
   * `blockedBy` is why a bare number is not enough: a gate whose own fields
   * are all settled is NOT satisfied while an earlier gate is outstanding, and
   * a tick there would claim a record is at production lock over a price
   * nobody could quote.
   */
  gates: Record<Gate, GateSummaryEntry> | null;
};

/** One outstanding to-quote question on a record, as `/api/records` names it. */
export type ToQuoteQuestion = {
  requirementId: string;
  label: string;
  section: string | null;
  state: string;
  waiting: boolean;
};

/**
 * How many of a row's questions are listed before the rest fold away.
 *
 * A cabinetry item falls to the 0019 placeholder, where every one of its 48
 * questions blocks a quote — and 48 names inside a table row is a row nobody
 * scrolls past. Six is enough to see what KIND of thing is missing; the rest
 * are one click, never dropped.
 */
const QUESTIONS_SHOWN = 6;

/**
 * How wide a spanning panel is. Counted off the header row below, and kept here
 * so adding a column and forgetting the panel is one edit rather than two
 * silently disagreeing numbers.
 */
const COLUMNS = 13;

/** What the run's header band needs, from the payload this table already has. */
export type RunTally = {
  records: number;
  toQuote: number;
  toQuoteItems: number;
};

const DOTS: Record<RecordUrgency, string> = {
  complete: "bg-green-500",
  waiting: "bg-blue-500",
  action_required: "bg-red-500",
  overdue: "bg-red-600 ring-2 ring-red-300",
};

/**
 * How much of this record's checklist is answered, as one bar.
 *
 * It replaced two columns — Spec fields and Readiness — each showing a
 * settled/TBC/missing triple. Six numbers per row, twelve on the widest
 * screen, and none of them answers the question somebody scanning the table is
 * asking, which is "how far along is this one". The split still exists and
 * still matters, and it is one click away on the record itself.
 *
 * Green is settled, amber is TBC — an ANSWER, and a different thing from
 * nobody having looked, which is the bar's remaining width.
 */
function Captured({
  settled,
  tbc,
  total,
}: {
  settled: number;
  tbc: number;
  total: number;
}) {
  if (total === 0) return <span className="text-neutral-400">—</span>;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <span
      className="flex min-w-[6.5rem] items-center gap-2"
      title={`${settled} settled, ${tbc} TBC, ${total - settled - tbc} nobody has looked at, of ${total}`}
    >
      <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
        <span className="block bg-green-600" style={{ width: pct(settled) }} />
        <span className="block bg-amber-400" style={{ width: pct(tbc) }} />
      </span>
      <span className="shrink-0 tabular-nums text-xs text-neutral-500">
        {settled} of {total}
      </span>
    </span>
  );
}

/**
 * A record that carries no client ref at all — variance matrix row d3.
 *
 * SAID IN WORDS, not as an em dash. The client ref is the pre-sale primary key:
 * it is what the BOQ, the FF&E schedule and every email use, and it is how the
 * BWS job will be found later. A record without one exports a BLANK Client Code
 * — correctly, because inventing one would be worse — so this cell is the only
 * place anybody would notice, and an em dash there reads as "nothing to say"
 * beside the columns that genuinely have nothing to say. The same argument as
 * `quantity not given` on the next column but one.
 */
function NoClientRef() {
  return (
    <span
      className="font-sans text-xs text-amber-800"
      title="No client ref on this record, so the export ships a blank Client Code. Nothing is invented."
    >
      no client ref
    </span>
  );
}

/**
 * The refs a record holds that are NOT its client code.
 *
 * `spec_record_refs` carries five systems and the export's Client Code is one
 * of them, so a `bws_job` number, a `design_code` or a `cos_code` has nowhere
 * else on this screen to be. Printing them inside the Code cell would be the
 * defect again; printing them beneath it, named as what they are, keeps the
 * column a true statement about the file and loses nothing.
 */
function OtherRefs({ clientCode, refs }: { clientCode: string | null; refs: string | null }) {
  const client = new Set((clientCode ?? "").split(",").map((part) => part.trim()).filter(Boolean));
  const others = (refs ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !client.has(part));
  if (others.length === 0) return null;
  return (
    <span
      className="block font-sans text-xs text-neutral-500"
      title="Other refs on this record. The export's Client Code carries the client's BOQ code only."
    >
      also {others.join(", ")}
    </span>
  );
}

/** What the tiles above the table can narrow it to. Null lists everything. */
export type Focus = null | "tgq" | "waiting" | "no_category" | "no_level" | "quotable";

/** The word beside the removable chip in the filter row, per tile. */
const FOCUS_LABELS: Record<Exclude<Focus, null>, string> = {
  tgq: "TGQ",
  waiting: "Waiting on a reply",
  no_category: "No category",
  no_level: "No level",
  quotable: "Ready to quote",
};

export default function SpecTable({
  projectId,
  runId,
  onSummary,
  initialFocus = null,
}: {
  projectId: string;
  runId: string;
  /** Called after every load with this run's own numbers, for the header band. */
  onSummary?: (tally: RunTally) => void;
  /**
   * Which tile is pressed when this table first renders.
   *
   * The next-step control (`src/lib/next-step.ts`) lands somebody here already
   * narrowed — "Categorise 6 items" has to arrive showing the six. It seeds the
   * state and nothing more: the tile is then pressable as normal, and the URL
   * is never rewritten, because correcting a link somebody pasted is how the
   * `useUrlTab` trap started.
   */
  initialFocus?: Focus;
}) {
  const [records, setRecords] = useState<SpecRecord[] | null>(null);
  const [programme, setProgramme] = useState<ProgrammeDates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retiredCount, setRetiredCount] = useState(0);
  // Out by default. The export takes only active records, so a table that
  // listed retired ones beside the rest would describe a different set from
  // the file.
  const [showRetired, setShowRetired] = useState(false);
  const [acceptingLevels, setAcceptingLevels] = useState(false);
  /** Which single row's suggestion is being filed, if any. */
  const [acceptingRow, setAcceptingRow] = useState<string | null>(null);
  /**
   * WHICH TILE IS PRESSED, and therefore what the table lists.
   *
   * A FILTER NARROWS WHAT IS LISTED AND NOTHING ELSE. The counts on every tile
   * stay the RUN'S OWN whatever is selected — the chase screen's rule, and the
   * reason somebody cannot narrow this screen until a run looks finished. The
   * footer says how many rows are hidden.
   */
  const [focus, setFocus] = useState<Focus>(initialFocus);
  /**
   * WHICH ROWS ARE OPEN, AND WHETHER THE NAMES HAVE BEEN ASKED FOR.
   *
   * "On this page, you can't see what's missing? There's a button to go and see
   * them." So the count opens in place. The names are not on the first payload:
   * `loadOutstanding` runs server-side either way, so they cost no query — but
   * a 300-line phase on the 0019 placeholder carries 48 per row, and shipping
   * fourteen thousand of them to serve the one row somebody opens is the wrong
   * trade. The first expand re-reads the SAME endpoint with `withToQuote=1` and
   * every row has them from then on.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Rows whose fold has been opened past the first six. */
  const [expandedAll, setExpandedAll] = useState<Set<string>>(new Set());
  const [namedQuestions, setNamedQuestions] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [designer, setDesigner] = useState("");
  const [categories, setCategories] = useState<{ id: string; family: string; name: string }[]>([]);

  // The callback lives in a ref so a caller passing a lambda — which is every
  // caller — does not make `load` a new function on every render and re-fetch
  // the table.
  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;

  const load = useCallback(async () => {
    const query = new URLSearchParams({ projectId, runId });
    if (showRetired) query.set("includeRetired", "1");
    if (namedQuestions) query.set("withToQuote", "1");
    const res = await apiFetch<{
      records: SpecRecord[];
      programme: ProgrammeDates;
      retiredCount: number;
      categories: { id: string; family: string; name: string }[];
    }>(`/api/records?${query.toString()}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRecords(res.data.records);
    setProgramme(res.data.programme);
    setRetiredCount(Number(res.data.retiredCount ?? 0));
    setCategories(res.data.categories ?? []);
    summaryRef.current?.({
      records: res.data.records.length,
      toQuote: res.data.records.reduce((sum, record) => sum + (record.to_quote_outstanding ?? 0), 0),
      toQuoteItems: res.data.records.filter((record) => (record.to_quote_outstanding ?? 0) > 0).length,
    });
  }, [projectId, runId, showRetired, namedQuestions]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Agree with every level this run's records were guessed. */
  async function acceptLevels() {
    setAcceptingLevels(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      // Reload first, then report: this table clears its banner on a
      // successful load, so setting the message first would flash a refusal
      // and then show nothing at all.
      await load();
      if (!res.ok) setError(res.error);
    } finally {
      // Always, so a non-JSON error cannot leave the button dead.
      setAcceptingLevels(false);
    }
  }

  /**
   * Agree with ONE row's suggestion, at the version the row was rendered at.
   *
   * The run-wide button exists because 22 items must not mean 22 visits; this
   * exists because a control sitting on one row must do what that row says.
   * Sending the run id from here would file twenty-one decisions nobody looked
   * at, which is the whole thing `level_suggested` is a separate column to
   * prevent.
   */
  async function acceptLevel(record: SpecRecord) {
    if (!record.level_suggested) return;
    setAcceptingRow(record.id);
    try {
      const res = await apiFetch(`/api/records/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: record.level_suggested, version: record.version }),
      });
      await load();
      if (!res.ok) setError(res.error);
    } finally {
      setAcceptingRow(null);
    }
  }

  /**
   * Open or close one row's to-quote list.
   *
   * The first open asks the server for the names. Nothing is filtered out of
   * what comes back: the list is the RECORD'S OWN questions whatever the table
   * is showing, the chase screen's rule — a filter narrows what is LISTED,
   * never what is outstanding.
   */
  function toggleQuestions(recordId: string) {
    setNamedQuestions(true);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  /** The designers this run's own records name. A filter offers only what is here. */
  const designers = useMemo(() => {
    return [
      ...new Set((records ?? []).map((record) => (record.designer ?? "").trim()).filter((code) => code !== "")),
    ].sort();
  }, [records]);

  /** The areas this phase's own records carry, folded for grouping only. */
  const areas = useMemo(() => areaOptions(records ?? []), [records]);

  /**
   * WHICH AREA IS CHOSEN, AND IT LIVES IN THE URL.
   *
   * A 300-line phase narrowed to one floor is a screen somebody links to, and
   * the tab beside it is already in the URL. `useUrlTab`'s own rule is what
   * makes it safe here: while the records are still loading `areas` is empty,
   * `resolve` answers null, the fallback renders EVERY area, and the URL is
   * left exactly as it is — so a pasted `?area=` is not corrected a quarter of
   * a second before it becomes valid.
   */
  const [area, setArea] = useUrlTab<string>({
    param: "area",
    fallback: "",
    resolve: (raw) => (raw && areas.some((option) => option.key === raw) ? raw : null),
  });

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!records) return <Spinner label="Loading spec records" />;

  const n = (value: string) => Number(value);
  const today = todayLocal();
  const daysLate = daysUntilSpecsAgreed(programme?.specsAgreedBy ?? null, today);
  const overdueBy = daysLate === null ? null : -daysLate;
  // Records carrying a level this app guessed and nobody has agreed to. Until
  // somebody does, every one of them is unquotable-by-unknown rather than
  // unquotable-by-answer, which is not the same thing and reads the same.
  const suggested = records.filter((record) => !record.level && record.level_suggested);
  const suggestedLevels = suggested.length;
  const suggestedBreakdown = [...new Set(suggested.map((record) => record.level_suggested))]
    .map((level) => `${suggested.filter((record) => record.level_suggested === level).length} ${level}`)
    .join(", ");

  /**
   * The run's own numbers, for the tiles.
   *
   * Computed over ALL records, never over the filtered list — narrowing the
   * screen must not be able to make a run look finished. The same rule the
   * chase screen states about its line counts.
   */
  const tally = {
    toQuote: records.reduce((sum, record) => sum + (record.to_quote_outstanding ?? 0), 0),
    toQuoteItems: records.filter((record) => (record.to_quote_outstanding ?? 0) > 0).length,
    waiting: records.reduce((sum, record) => sum + (record.waiting ?? 0), 0),
    noCategory: records.filter((record) => !record.category_name).length,
    noLevel: records.filter((record) => !record.level).length,
    // TGQ SATISFIED, which is a smaller claim than "nothing outstanding" and
    // the only one this screen can make. A record with no level is out: nothing
    // on it is tiered under the fallback half of TGQ, so calling it ready would
    // be a reading of silence.
    readyToQuote: records.filter((record) => record.to_quote_outstanding === 0).length,
  };

  /** What the table lists. The tiles and the filter row narrow this, nothing else. */
  const term = search.trim().toLowerCase();
  const shown = records.filter((record) => {
    if (
      term &&
      !`${record.record_no} ${record.refs ?? ""} ${record.parent_refs ?? ""} ${record.item_description} ${
        record.area ?? ""
      }`
        .toLowerCase()
        .includes(term)
    ) {
      return false;
    }
    if (category && record.category_name !== category) return false;
    if (designer && (record.designer ?? "").trim() !== designer) return false;
    // The area narrows the LIST. The tiles above and the tally reported up to
    // the header band are computed over every record and are untouched by it:
    // narrowing to one floor must never be able to make a phase look finished.
    if (!matchesArea(record, area)) return false;
    switch (focus) {
      case "tgq":
        return (record.to_quote_outstanding ?? 0) > 0;
      case "waiting":
        return (record.waiting ?? 0) > 0;
      case "no_category":
        return !record.category_name;
      case "no_level":
        return !record.level;
      case "quotable":
        return record.to_quote_outstanding === 0;
      default:
        return true;
    }
  });
  const narrowed = focus !== null || term !== "" || category !== "" || designer !== "" || area !== "";

  return (
    <>
      {/* ONE CLICK FOR THE RUN, because 59 records must not mean 59 visits —
          the same reason the drafts screen carries an inline level picker. It
          is still a person agreeing: the level of every record is on this
          screen with what it was guessed from, and this accepts only what is
          already suggested. */}
      {suggestedLevels > 0 && (
        <Note
          tone="info"
          title={`${suggestedLevels} item${suggestedLevels === 1 ? "" : "s"} ${
            suggestedLevels === 1 ? "has" : "have"
          } a suggested level`}
          actions={
            <>
              <SuggestButton
                size="sm"
                value={`Accept all ${suggestedLevels}`}
                evidence={suggestedBreakdown}
                busy={acceptingLevels}
                onAccept={() => void acceptLevels()}
              />
              <Button size="xs" variant="quiet" onClick={() => setFocus("no_level")}>
                Review one by one
              </Button>
            </>
          }
        >
          — read off the bill&rsquo;s own wording and the drawings. Nothing on them is tiered until you agree, and
          each row carries its own reading beside the button.
        </Note>
      )}

      {/* THE RUN'S NUMBERS, AND EACH ONE NARROWS THE TABLE.
          ==================================================================
          Asked for on 2026-09-18: "those boxes at the top, if we click on
          those then that could filter them". Pressing a tile lists only the
          records it counts; pressing it again lists everything. The tile that
          is on is outlined, the filter is repeated as a removable chip in the
          row below, and the footer says in words how many rows are hidden — a
          filter you cannot see is a filter you forget you set, and this table
          is the one people judge a run by.

          The counts NEVER change with the filter. They are the run's own, so
          narrowing the screen can never make a run look finished. */}
      {records.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          <StatTile
            label="TGQ"
            tone="danger"
            value={tally.toQuote}
            meaning={`${tally.toQuoteItems} of ${records.length} item${records.length === 1 ? "" : "s"}`}
            action={focus === "tgq" ? "showing these" : "show only these"}
            onPress={() => setFocus(focus === "tgq" ? null : "tgq")}
            active={focus === "tgq"}
          />
          <StatTile
            label="Waiting on a reply"
            tone="warn"
            value={tally.waiting}
            meaning="chased, nothing back"
            action="filter"
            onPress={() => setFocus(focus === "waiting" ? null : "waiting")}
            active={focus === "waiting"}
          />
          <StatTile
            label="No category"
            tone={tally.noCategory > 0 ? "warn" : "plain"}
            value={tally.noCategory}
            meaning="no questions at all"
            action="filter"
            onPress={() => setFocus(focus === "no_category" ? null : "no_category")}
            active={focus === "no_category"}
          />
          <StatTile
            label="No level"
            tone={tally.noLevel > 0 ? "warn" : "plain"}
            value={tally.noLevel}
            meaning={suggestedLevels > 0 ? `${suggestedLevels} have a suggestion` : "nothing suggested"}
            action="filter"
            onPress={() => setFocus(focus === "no_level" ? null : "no_level")}
            active={focus === "no_level"}
          />
          {/* READY TO QUOTE is not "nothing outstanding": it is TGQ satisfied,
              which is a smaller claim and the only one this screen can make.
              A record with no level is NOT counted — nothing on it is tiered
              under the fallback, so "ready" would be a reading of silence. */}
          <StatTile
            label="Ready to quote"
            tone="good"
            value={tally.readyToQuote}
            meaning="TGQ satisfied"
            action="filter"
            onPress={() => setFocus(focus === "quotable" ? null : "quotable")}
            active={focus === "quotable"}
          />
        </div>
      )}

      {records.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-neutral-600">
            No records here yet. Import a bill of quantities, or add an item by hand.
          </p>
          <div className="mt-3">
            {/* ADDING AN ITEM BY HAND is offered even on an empty run — that is
                the case it exists for. Until 0028 a record could only be
                created by confirming a bill, so a project whose documents are
                drawings and emails could not be started at all. */}
            <AddItem projectId={projectId} runId={runId} categories={categories} onAdded={load} />
          </div>
        </div>
      ) : (
        <>
          {overdueBy !== null && overdueBy > 0 && (
            <Note tone="danger" title={`${SPECS_AGREED_LABEL} ${programme?.specsAgreedBy}`}>
              — {overdueBy} day{overdueBy === 1 ? "" : "s"} ago. Everything still outstanding below is overdue.
            </Note>
          )}

          {/* An absent date is NOT "on time". IN WORDS, never a tip: a project
              with no programme and a project on time render identically
              otherwise, which is the one test a tip has to pass. */}
          {programme && !programme.specsAgreedBy && (
            <Note tone="warn">
              {hasProgramme(programme)
                ? `No date for ${SPECS_AGREED_LABEL.toLowerCase()}, so nothing here can be flagged overdue.`
                : "No programme recorded for this project, so nothing here can be flagged overdue — which is not the same as being on time."}
            </Note>
          )}

          {/* THE FILTER ROW. Search, the two closed lists this run's own rows
              offer, and the tile that is pressed repeated as a chip you can
              take off — the tile is at the top of the screen and the rows are
              at the bottom, so by the time somebody wonders why an item is
              missing the tile is off the screen. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a code, an item, an area"
              className="w-64 rounded border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">All categories</option>
              {[...new Set(records.map((record) => record.category_name).filter(Boolean))].sort().map((name) => (
                <option key={name} value={name!}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={designer}
              onChange={(event) => setDesigner(event.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
              disabled={designers.length === 0}
            >
              <option value="">All designers</option>
              {designers.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {/* THE AREA. Asked for on 2026-09-18 — "if you could filter by
                that, that'd be quite handy" — and it sits beside the other two
                closed lists this phase's own rows offer. The search box to its
                left still matches the area text, which is what makes 35 of
                them findable without a combobox. */}
            <AreaSelect options={areas} value={area} onChange={setArea} />
            {focus !== null && (
              <button type="button" onClick={() => setFocus(null)} className="inline-flex">
                <Chip tone={focus === "quotable" ? "good" : focus === "tgq" ? "danger" : "warn"}>
                  {FOCUS_LABELS[focus]} <span aria-hidden>✕</span>
                  <span className="sr-only">remove this filter</span>
                </Chip>
              </button>
            )}
            <span className="flex-1" />
            {/* ONLY WHEN THE LIST WAS ACTUALLY NARROWED. Printing "22 of 22"
                on every visit teaches people to ignore the one time it
                matters. */}
            {narrowed && (
              <span className="text-sm text-neutral-500">
                {shown.length} of {records.length} shown
              </span>
            )}
            <AddItem projectId={projectId} runId={runId} categories={categories} onAdded={load} />
          </div>

          {/* Said out loud, so "38 records" cannot quietly mean "38 of 41". A
              record retired by a BOQ revision is out of the export, and a BWS
              job created from it is NOT deleted by that absence — so somebody
              has to be able to find it. */}
          {retiredCount > 0 && (
            <p className="mt-2 text-xs text-neutral-500">
              {retiredCount} retired record{retiredCount === 1 ? "" : "s"} on this phase — out of the export.{" "}
              <Button size="xs" variant="quiet" onClick={() => setShowRetired((value) => !value)}>
                {showRetired ? "hide them" : "show them"}
              </Button>
            </p>
          )}

          <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
            <Table scroll>
              <thead>
                <tr>
                  <Th>No.</Th>
                  <Th>Client ref</Th>
                  <Th>Item</Th>
                  <Th>Area</Th>
                  <Th num>Qty</Th>
                  <Th>Category</Th>
                  <Th>Level</Th>
                  <Th className="w-[130px]">
                    Captured
                    <Tip>
                      How much of the checklist is answered — green settled, amber TBC. The split between spec
                      fields and readiness questions is on the record itself.
                    </Tip>
                  </Th>
                  <Th num>
                    TGQ
                    <Tip>
                      Questions blocking a quotation. Matthew&rsquo;s matrix where he has written one for this
                      category, the older per-level model where he has not.
                    </Tip>
                    {/* THE SAME QUESTIONS, THE OTHER WAY UP. "Show me all the
                        jobs with dimensions missing" is a real question this
                        column cannot answer, and it is one link away rather
                        than a second view of this table. */}
                    <Link
                      href={`/dashboard/projects/${encodeURIComponent(projectId)}/infill?tab=by-question`}
                      className="block text-[10.5px] font-normal normal-case tracking-normal text-blue-700 no-underline hover:underline"
                    >
                      by question
                    </Link>
                  </Th>
                  <Th num>Waiting</Th>
                  <Th>TG0</Th>
                  <Th>TG1</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {shown.map((record) => {
                  const outstanding =
                    n(record.spec_tbc) + n(record.spec_missing) + n(record.ready_tbc) + n(record.ready_missing);
                  const anyMissing = n(record.spec_missing) + n(record.ready_missing) > 0;
                  const urgency = recordUrgency({
                    outstanding,
                    // Everything outstanding on this record has been asked and
                    // nobody has replied yet. That is a different state from
                    // "nobody has done anything", and the dot says so.
                    allChased: outstanding > 0 && record.waiting >= outstanding,
                    specsAgreedBy: programme?.specsAgreedBy ?? null,
                    today,
                  });
                  const dot = urgency === "action_required" && !anyMissing ? "bg-amber-500" : DOTS[urgency];
                  const isConfiguration = Boolean(record.variant_label);
                  const isHeading = n(record.variant_count) > 0;
                  const retired = record.status === "retired";
                  const open = expanded.has(record.id);
                  const body = (
                    <Tr
                      /* A CONFIGURATION IS TINTED AND INDENTED under its bill
                         line. It is sorted there by the query — on the
                         PARENT'S record_no, because its own is just the next
                         free number in the project. */
                      className={
                        retired
                          ? "bg-neutral-50 text-neutral-400"
                          : isConfiguration
                            ? "bg-[#fcfcfc]"
                            : ""
                      }
                      title={
                        retired
                          ? `Retired${record.retired_by ? ` by ${record.retired_by}` : ""}${record.retired_at ? ` on ${new Date(record.retired_at).toLocaleDateString()}` : ""}. Not in the export.`
                          : undefined
                      }
                    >
                      <Td className={`text-neutral-500 tabular-nums ${isConfiguration ? "pl-6" : ""}`}>
                        <span
                          title={URGENCY_LABELS[urgency]}
                          className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${dot}`}
                        />
                        <Link
                          href={`/dashboard/records/${record.id}`}
                          className="font-mono text-neutral-600 no-underline hover:underline"
                        >
                          {record.record_no}
                        </Link>
                      </Td>
                      <Td
                        mono
                        className={`font-medium ${retired ? "text-neutral-400 line-through" : "text-neutral-900"}`}
                      >
                        {/* THE CODE COLUMN SAYS WHAT THE FILE WILL SAY. It
                            printed `refs` — every ref system — while the
                            export's Client Code is `boq_code` alone, so a
                            record carrying only a `bws_job` ref showed a code
                            here and exported a blank one, and `NoClientRef`
                            never fired on the one row it exists for. Any OTHER
                            ref the record holds is still printed, apart and
                            labelled, because it is real and this screen is the
                            only place it shows. `client_code` already reads
                            through a configuration's parent. */}
                        {isConfiguration ? (
                          <span className="text-neutral-500">
                            {record.client_code ?? <NoClientRef />}{" "}
                            {/* THE LETTER, coloured the way the review card
                                colours it — A is sky on every screen. */}
                            <b className={letterColour(record.variant_label!)}>{record.variant_label}</b>
                          </span>
                        ) : (
                          (record.client_code ?? <NoClientRef />)
                        )}
                        <OtherRefs clientCode={record.client_code} refs={record.refs} />
                      </Td>
                      <Td className={isConfiguration ? "pl-6" : ""}>
                        <Link
                          href={`/dashboard/records/${record.id}`}
                          className="text-blue-700 no-underline hover:underline"
                        >
                          {record.item_description}
                        </Link>
                        {record.product_reference && (
                          <span className="text-neutral-500"> · {record.product_reference}</span>
                        )}
                        {/* A HEADING, not an item. Its configurations are what
                            the export ships — and a row that stayed silent
                            would read as an item nobody had specced. */}
                        {isHeading && (
                          <p className="text-xs text-neutral-500">
                            {n(record.variant_count)} configuration{n(record.variant_count) === 1 ? "" : "s"} — they
                            are what the export carries, not this line
                          </p>
                        )}
                      </Td>
                      <Td className="text-neutral-700">{record.area ?? "—"}</Td>
                      <Td num className="text-neutral-700">
                        {/* THE BILL'S QUANTITY IS NOT APPORTIONED BY ANYTHING.
                            The bill says 45 of S-201 and never says how many
                            are fabric A. Splitting it has a price attached, so
                            the table says how much is unaccounted for rather
                            than dividing it. */}
                        {/* A BILL LINE WITH NO QUANTITY SAYS SO — variance
                            matrix row 2. It used to print an em dash, which
                            reads as "nothing to say" beside the columns that
                            genuinely have nothing to say, and a bill with no
                            quantity column produces a whole phase of them. A
                            CONFIGURATION is a different statement: the bill
                            said 45 and never said how many are fabric A, so its
                            quantity is unallocated rather than ungiven. */}
                        {record.qty === null ? (
                          isConfiguration ? (
                            /* THE SAME WORDS THE OTHER TWO SCREENS USE. The
                               infill line and the chase line both say "quantity
                               not allocated"; this said "qty not set", which
                               reads as somebody having forgotten to fill a
                               field in — where the truth is that the bill said
                               45 and never said how many are fabric A. Three
                               screens describing one state in two ways is how a
                               reader comes to believe they are two states. */
                            <Chip tone="warn" title="The bill's quantity is never divided between configurations.">
                              not allocated
                            </Chip>
                          ) : (
                            <span
                              className="text-xs text-amber-800"
                              title="The bill gave no quantity for this line. Nothing is assumed."
                            >
                              quantity not given
                            </span>
                          )
                        ) : (
                          record.qty
                        )}
                        {isHeading &&
                          record.qty !== null &&
                          unallocatedQty(record.qty, [n(record.variant_qty)]) !== 0 && (
                            <span
                              className="block text-xs text-amber-800"
                              title="Set a quantity on each configuration."
                            >
                              {unallocatedQty(record.qty, [n(record.variant_qty)])} not allocated
                            </span>
                          )}
                      </Td>
                      <Td>
                        {record.category_name ? (
                          <>
                            <Link
                              href={`/dashboard/records/${record.id}`}
                              className="text-neutral-800 no-underline hover:underline"
                            >
                              {record.category_name}
                            </Link>
                            {!record.requirements_authored && (
                              <span className="ml-1 text-xs text-amber-800">(not yet defined)</span>
                            )}
                          </>
                        ) : (
                          <Chip tone="warn">not set</Chip>
                        )}
                      </Td>
                      {/* THE LEVEL. A decision, a suggestion with its evidence,
                          or nothing — and the three must not look alike. A
                          pre-filled select could not be the accept control: it
                          fires no change event when somebody picks the value it
                          is already showing. */}
                      <Td>
                        {record.level ? (
                          <Chip>{record.level}</Chip>
                        ) : record.level_suggested ? (
                          <SuggestButton
                            value={record.level_suggested}
                            evidence={record.level_suggested_reason ?? "guessed from the bill"}
                            busy={acceptingRow === record.id || acceptingLevels}
                            onAccept={() => void acceptLevel(record)}
                            className="flex-col items-start gap-0.5"
                          />
                        ) : (
                          <Chip tone="warn">not set</Chip>
                        )}
                      </Td>
                      <Td>
                        {isHeading ? (
                          <span className="text-xs text-neutral-500">counted through its configurations</span>
                        ) : (
                          <Captured
                            settled={n(record.spec_settled) + n(record.ready_settled)}
                            tbc={n(record.spec_tbc) + n(record.ready_tbc)}
                            total={n(record.spec_total) + n(record.ready_total)}
                          />
                        )}
                      </Td>
                      <Td num>
                        {/* A SPLIT LINE IS A HEADING. It is neither "0, can
                            quote" nor "nobody has set a level" — its questions
                            live on its configurations, which are the rows
                            indented under it. Said before the level case,
                            because a split line may also have no level and the
                            heading is the more useful answer. */}
                        {isHeading ? (
                          <span className="text-neutral-400">—</span>
                        ) : !record.category_name ? (
                          /* AN UNCATEGORISED RECORD IS NOT UNTIERED, IT IS
                             UNASKED — variance matrix row d1. It has no
                             checklist at all, so it scores zero outstanding,
                             and the two readings this cell had for it were both
                             wrong: a plain dash where a level was set (silent
                             about why), and the LEVEL sentence where one was
                             not, which sends somebody to choose simple or hero
                             when a level would buy them nothing. Same control
                             either way, and the panel says which decision is
                             actually missing. */
                          <button
                            type="button"
                            onClick={() => toggleQuestions(record.id)}
                            aria-expanded={expanded.has(record.id)}
                            className="text-neutral-400 hover:text-neutral-700"
                            title="No category, so there is no checklist to count"
                          >
                            — <span aria-hidden>{expanded.has(record.id) ? "▾" : "▸"}</span>
                          </button>
                        ) : record.to_quote_outstanding === null ? (
                          /* A DASH IS NEVER A ZERO. 0 here would read as
                             ready, and the record is not unready — it is
                             untiered, which is a different thing. It OPENS,
                             like a count does, and says what is in the way:
                             a row that could not be opened at all would be the
                             one row on the screen where the control is absent
                             for a reason nobody can see. */
                          <button
                            type="button"
                            onClick={() => toggleQuestions(record.id)}
                            aria-expanded={expanded.has(record.id)}
                            className="text-neutral-400 hover:text-neutral-700"
                          >
                            — <span aria-hidden>{expanded.has(record.id) ? "▾" : "▸"}</span>
                          </button>
                        ) : record.to_quote_outstanding > 0 ? (
                          <span>
                            {/* THE COUNT OPENS THE LIST. It used to be a link
                                to the record — "there's a button to go and see
                                them", which is the defect being reported: the
                                answer to WHAT is missing was a page away. It is
                                a button because it does something; each name
                                inside it is a link, because those go
                                somewhere. */}
                            <button
                              type="button"
                              onClick={() => toggleQuestions(record.id)}
                              aria-expanded={expanded.has(record.id)}
                              className="font-semibold text-red-700 hover:underline"
                              title="Show which questions"
                            >
                              {record.to_quote_outstanding}{" "}
                              <span aria-hidden>{expanded.has(record.id) ? "▾" : "▸"}</span>
                            </button>
                            {record.to_quote_waiting > 0 && (
                              <span className="ml-1 text-xs font-normal text-blue-700">
                                ({record.to_quote_waiting} asked)
                              </span>
                            )}
                          </span>
                        ) : record.category_name ? (
                          /* NOTHING OUTSTANDING, SO NOTHING TO OPEN. A
                             disclosure control over an empty list is a control
                             that teaches people it is not worth pressing. */
                          <span className="text-green-700">Can quote</span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </Td>
                      <Td num muted>
                        {isHeading ? "—" : (record.waiting ?? 0)}
                      </Td>
                      {/* THE GATES. Same numbers the record screen shows,
                          from the same `gateStatus` — a table that disagreed
                          with the screen it links to would be worse than no
                          column. */}
                      {(["TG0", "TG1"] as const).map((gate) => {
                        const entry = record.gates?.[gate] ?? null;
                        /* THE GATES BUILD ON EACH OTHER, so a tick here means
                           "this gate AND every gate before it". A column that
                           ticked TG1 over an outstanding TGQ would say a record
                           is at production lock over a price nobody could
                           quote — and it did, until 2026-09-18. */
                        const waitingFor = entry?.blockedBy[0] ?? null;
                        return (
                          <Td key={gate}>
                            {entry === null ? (
                              <span className="text-neutral-400" title={NO_MATRIX_CATEGORY_EXPLANATION}>
                                —
                              </span>
                            ) : entry.satisfied ? (
                              <Chip tone="good">met</Chip>
                            ) : (
                              /* THE COUNT IS A LINK TO WHAT IT COUNTS. Asked
                                 for on 2026-09-18 — "when it goes red three, I
                                 should be able to click on that and it takes me
                                 to the three things that are needed". The
                                 record screen's gate panel is where they are
                                 named, with whose problem each one is.

                                 SLATE, not red, where an earlier gate comes
                                 first: the count is true, and it is not work
                                 anybody can start today. The number still
                                 shows, so the column never says less than it
                                 used to. */
                              <Link
                                href={`/dashboard/records/${record.id}?tab=gates`}
                                className="no-underline"
                                title={
                                  waitingFor
                                    ? `${gate} has not been reached — ${GATE_SHORT_LABELS[waitingFor]} comes first. ${entry.outstanding} of ${gate}'s own fields outstanding.`
                                    : `${entry.outstanding} outstanding at ${gate} — open the record to see which`
                                }
                              >
                                <Chip tone={waitingFor ? "blocked" : "danger"}>
                                  {waitingFor ? `after ${GATE_SHORT_LABELS[waitingFor]}` : entry.outstanding}
                                </Chip>
                              </Link>
                            )}
                          </Td>
                        );
                      })}
                      <Td>
                        <div className="flex justify-end">
                          {record.category_name ? (
                            <Link
                              href={`/dashboard/records/${record.id}`}
                              className="rounded border border-transparent px-2 py-1 text-xs text-neutral-600 no-underline hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
                            >
                              Open
                            </Link>
                          ) : (
                            /* AN UNCATEGORISED RECORD HAS NO QUESTIONS AT ALL,
                               so the useful action is not "look at it" — it is
                               the decision that creates its checklist. */
                            <Link
                              href={`/dashboard/records/${record.id}`}
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 no-underline hover:bg-neutral-50"
                            >
                              Set category
                            </Link>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                  if (!open) return <Fragment key={record.id}>{body}</Fragment>;
                  return (
                    <Fragment key={record.id}>
                      {body}
                      {/* A SPANNING PANEL IS ITS OWN `tr`, never an extra
                          `td colSpan` beside the data cells: that makes the row
                          21 column slots wide and the browser finds room for
                          the panel BESIDE the data, squeezed into a ribbon.
                          The drawings card paid for that once already. */}
                      <tr className="bg-[#fbfbfb]">
                        <td colSpan={COLUMNS} className="border-b border-neutral-200 px-4 py-3 align-top">
                          <ToQuotePanel
                            record={record}
                            questions={record.to_quote_questions}
                            showAll={expandedAll.has(record.id)}
                            onShowAll={() =>
                              setExpandedAll((current) => new Set(current).add(record.id))
                            }
                          />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>

          {/* A FILTER YOU CANNOT SEE IS A FILTER YOU FORGET YOU SET. Said in
              words at the bottom too, with the way out beside it, and only when
              the list was actually narrowed. */}
          {narrowed && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
              <span>
                Showing {shown.length} of {records.length} item{records.length === 1 ? "" : "s"}.{" "}
                <span className="text-neutral-500">{records.length - shown.length} hidden by the filters.</span>
              </span>
              <Button
                size="xs"
                variant="quiet"
                onClick={() => {
                  setFocus(null);
                  setSearch("");
                  setCategory("");
                  setDesigner("");
                }}
              >
                Show all {records.length}
              </Button>
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * WHAT IS MISSING ON ONE ROW, inside the row.
 *
 * ============================================================================
 * Matthew, on the phase table: "On this page, you can't see what's missing?
 * There's a button to go and see them." The count was a link to the record, so
 * the answer to WHAT was a page away and a run of 22 items was 22 visits.
 *
 * FOUR THINGS ARE LOAD-BEARING.
 *
 * THE LIST IS THE RECORD'S OWN, never the table's. It arrives on the record's
 * payload out of the same `loadOutstanding` loop that made the count, so it
 * cannot disagree with the number that opened it, and no filter above the table
 * touches it — the chase screen's rule: a filter narrows what is LISTED, never
 * what is outstanding.
 *
 * SIX, THEN THE REST, NEVER A CAP. A cabinetry item falls to the 0019
 * placeholder where all 48 of its questions block a quote. Six names say what
 * KIND of thing is missing; the other 42 are one click and are never dropped,
 * because a list that silently stopped would be a row claiming its item needs
 * less than it does.
 *
 * GROUPED BY THE SHEET'S OWN SECTION, in checklist order inside each. The
 * commercial block and the upholstery block are different jobs, and a flat list
 * of 48 reads as one undifferentiated pile.
 *
 * A LEVEL-LESS ROW EXPLAINS RATHER THAN LISTING NOTHING. Its cell is a dash
 * because nothing on it is tiered, and an empty panel would read as an item
 * with nothing outstanding — which is the one wrong answer this column exists
 * to avoid. It names the control instead, which is on this same row.
 * ============================================================================
 */
function ToQuotePanel({
  record,
  questions,
  showAll,
  onShowAll,
}: {
  record: SpecRecord;
  /** Undefined until the table has asked for the names. Not the same as none. */
  questions: ToQuoteQuestion[] | undefined;
  showAll: boolean;
  onShowAll: () => void;
}) {
  // CATEGORISE FIRST, and this is said BEFORE the level. An uncategorised
  // record has no checklist — no questions of any tier — so the level sentence
  // below would be a true statement about the wrong decision: setting a level
  // on it changes nothing, because there is nothing to tier. Variance matrix
  // row d1, where the rule is that no screen may report zero outstanding on a
  // record nobody has decided what to ask about.
  if (!record.category_name) {
    return (
      <p className="text-sm text-neutral-700">
        <b>No category</b>, so this item has no checklist and nothing to count — not nothing outstanding. Choosing a
        category is what creates its questions. Set one on{" "}
        <Link href={`/dashboard/records/${record.id}`} className="text-blue-700 no-underline hover:underline">
          the record
        </Link>
        .
      </p>
    );
  }

  // A LEVEL IS WHAT TIERS A QUESTION, so a record without one has no to-quote
  // set at all — under the half of TGQ that predates Matthew's matrix. The
  // sentence says what it is needed FOR, because "set a level" on its own reads
  // as a form field somebody forgot.
  if (record.to_quote_outstanding === null) {
    return (
      <p className="text-sm text-neutral-700">
        Nothing on this item is tiered yet, so this column cannot say what is missing.{" "}
        <b>A level</b> — simple, complex or hero — is what decides which questions block a quote, and it also picks
        the BWS boilerplate the item is priced against. Set it in the <b>Level</b> column on this row, or on{" "}
        <Link href={`/dashboard/records/${record.id}`} className="text-blue-700 no-underline hover:underline">
          the record
        </Link>
        .
      </p>
    );
  }

  if (!questions) return <p className="text-sm text-neutral-500">Loading the questions…</p>;
  if (questions.length === 0) {
    // The count said there were some and the list is empty: the table has been
    // reloaded since. Said out loud rather than rendered as a blank panel.
    return <p className="text-sm text-neutral-500">Nothing outstanding on this item.</p>;
  }

  const listed = showAll ? questions : questions.slice(0, QUESTIONS_SHOWN);
  const folded = questions.length - listed.length;
  // Grouped by the cheat sheet's own section, in the order the questions first
  // appear — which is checklist order, because that is how the payload arrives.
  const sections: { name: string; questions: ToQuoteQuestion[] }[] = [];
  for (const question of listed) {
    const name = question.section ?? "Other";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.questions.push(question);
    else sections.push({ name, questions: [question] });
  }

  return (
    <div className="text-sm">
      <p className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">
        Needed before this item can be quoted
      </p>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {sections.map((section, index) => (
          <div key={`${section.name}-${index}`}>
            <p className="text-xs font-medium text-neutral-500">{section.name}</p>
            <ul className="mt-0.5 space-y-0.5">
              {section.questions.map((question) => (
                <li key={question.requirementId}>
                  {/* EACH NAME OPENS ON THE QUESTION. The checklist already
                      renders `id="q-<requirementId>"` and scrolls to it after
                      its payload lands, so this lands on the row rather than
                      at the top of a list of 43. */}
                  <Link
                    href={`/dashboard/records/${record.id}?tab=checklist#q-${question.requirementId}`}
                    className="text-blue-700 no-underline hover:underline"
                  >
                    {question.label}
                  </Link>
                  {question.state === "tbc" && (
                    <span className="ml-1 text-xs text-amber-700">TBC</span>
                  )}
                  {question.waiting && <span className="ml-1 text-xs text-blue-700">asked</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {folded > 0 && (
        <Button size="xs" variant="quiet" className="mt-2" onClick={onShowAll}>
          and {folded} more
        </Button>
      )}
    </div>
  );
}
