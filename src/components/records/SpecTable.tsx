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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  refs: string | null; run_id: string; run_name: string; attribute_count: string;
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

/** What the tiles above the table can narrow it to. Null lists everything. */
type Focus = null | "tgq" | "waiting" | "no_category" | "no_level" | "quotable";

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
}: {
  projectId: string;
  runId: string;
  /** Called after every load with this run's own numbers, for the header band. */
  onSummary?: (tally: RunTally) => void;
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
  const [focus, setFocus] = useState<Focus>(null);
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
  }, [projectId, runId, showRetired]);

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

  /** The designers this run's own records name. A filter offers only what is here. */
  const designers = useMemo(() => {
    return [
      ...new Set((records ?? []).map((record) => (record.designer ?? "").trim()).filter((code) => code !== "")),
    ].sort();
  }, [records]);

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
  const narrowed = focus !== null || term !== "" || category !== "" || designer !== "";

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
              {retiredCount} retired record{retiredCount === 1 ? "" : "s"} on this run — out of the export.{" "}
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
                  return (
                    <Tr
                      key={record.id}
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
                        {isConfiguration ? (
                          <span className="text-neutral-500">
                            {record.parent_refs ?? record.refs ?? "—"}{" "}
                            {/* THE LETTER, coloured the way the review card
                                colours it — A is sky on every screen. */}
                            <b className={letterColour(record.variant_label!)}>{record.variant_label}</b>
                          </span>
                        ) : (
                          (record.refs ?? "—")
                        )}
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
                        {isConfiguration && record.qty === null ? (
                          <Chip tone="warn">qty not set</Chip>
                        ) : (
                          (record.qty ?? "—")
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
                        ) : record.to_quote_outstanding === null ? (
                          /* A DASH IS NEVER A ZERO. 0 here would read as
                             ready, and the record is not unready — it is
                             untiered, which is a different thing and the tip
                             says which. */
                          <span className="text-neutral-400">
                            —
                            <Tip>
                              A level is what decides which questions block a quote. Until one is set, nothing on
                              this record is tiered.
                            </Tip>
                          </span>
                        ) : record.to_quote_outstanding > 0 ? (
                          <span>
                            <Link
                              href={`/dashboard/records/${record.id}`}
                              className="font-semibold text-red-700 no-underline hover:underline"
                              title="Open the record to see which questions"
                            >
                              {record.to_quote_outstanding}
                            </Link>
                            {record.to_quote_waiting > 0 && (
                              <span className="ml-1 text-xs font-normal text-blue-700">
                                ({record.to_quote_waiting} asked)
                              </span>
                            )}
                          </span>
                        ) : record.category_name ? (
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
