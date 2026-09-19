"use client";

// The questions to ask, as one row per FURNITURE LINE.
//
// ============================================================================
// FIVE DELIBERATE BEHAVIOURS
//
//   * A LINE IS COLLAPSED. Its questions exist inside it, which is the whole
//     point: 823 flat rows under one contact's name is a list nobody reads.
//     Finish options (S-301 A, B, C, D) are a level in between, because the
//     fabric is what differs and the fabric is what the questions are about.
//
//   * THE TWO COUNTS ARE THE LINE'S OWN, always. A filter adds "n shown"
//     beside them and never rewrites them. A count that moved with the filter
//     would let somebody narrow the screen until an item looked finished --
//     the same rule the finishes library learned the hard way about its
//     used-on count.
//
//   * A FILTER NARROWS WHAT IS LISTED, NEVER WHAT IS ASKED. The selection is
//     the truth; hiding a question does not untick it. Where the two disagree
//     the footer says so in words, because silently dropping a ticked question
//     from a draft is how somebody sends an email missing the thing they
//     specifically added.
//
//   * TICKING A LINE TICKS WHAT IS SHOWN ON IT. The alternative -- ticking
//     what is hidden too -- makes "select" mean something different from what
//     the screen displays.
//
//   * THE TIER IS THE SERVER'S. These controls choose WHICH questions are
//     asked, never which half of the email they land in. `questionTier` runs
//     server-side and a request that tries to set one is a 400.
//
// ---- THREE OF ITS FILTERS BELONG TO THE PAGE -----------------------------
//
// The contact strip is the page's `Tabs`, in the header band, because a chase
// is written to ONE person and "what do I owe Hayley" is the screen's primary
// axis rather than its fifth dropdown. The TGQ / Also / Waiting tiles are the
// page's too, because a tile IS a filter (`StatTile`) and their numbers come
// from the inventory rather than from the rows.
//
// So those three arrive as OPTIONAL controlled props, each falling back to
// state held here. A component whose own tests mount it bare must go on
// working bare; a page that wants to drive a filter from a tile must be able
// to. What must never happen either way is a filter reaching the SELECTION,
// which is why every one of them narrows `shown` and nothing else.
//
// ---- AND THE QUESTIONS UNDER A LINE ARE FOLDED ---------------------------
//
// A hero sofa has 37 outstanding questions and opening it filled the screen
// with them. The first few are shown and the rest are one click away, counted
// in the fold: `9 more TGQ · 28 also outstanding`. That is NOT a filter — the
// hidden ones stay ticked, stay counted in the line's own totals, and stay in
// the draft. It is the same distinction the footer makes in words.
// ============================================================================
import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { TONE } from "@/components/ui/tone";
import { letterColour } from "@/components/records/letter-colours";
import { ANSWER_STATE_LABELS, ITEM_LEVEL_LABELS, type AnswerState, type ItemLevel } from "@/lib/spec-vocab";
import { TIER_LABELS, type QuestionTier } from "@/lib/tgq";
import { formatDay } from "@/lib/format-day";
import {
  allQuestions,
  countOutstanding,
  groupIntoLines,
  type FurnitureLine,
  type GroupableQuestion,
} from "@/lib/chase-grouping";

export type TableQuestion = GroupableQuestion & {
  requirementId: string;
  recordLabel: string;
  prompt: string;
  fieldLabel: string | null;
  waiting: { draftId: string; sentAt: string | null; contactName: string } | null;
  contactId: string;
  contactName: string;
};

/** What this app guessed a line's level is, and what it read to say so. */
export type LevelSuggestion = { level: string; reason: string | null };

const key = (recordId: string, requirementId: string) => `${recordId}:${requirementId}`;

/** Missing blocks a quote; TBC is a person saying "not yet". Both are amber-to-red. */
const STATE_TONE: Record<string, "danger" | "warn" | "plain"> = {
  missing: "danger",
  tbc: "warn",
};

/**
 * The day a chase went out, from the local calendar rather than the ISO string.
 *
 * `sent_at` is a timestamptz, so slicing its ISO text takes the UTC day and
 * renders the day before for anything sent after 11pm in summer. The TOE-dates
 * rule, applied to a timestamp: work out the day where the reader is, then
 * format the STRING.
 */
function askedOn(sentAt: string): string {
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) return sentAt;
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return formatDay(day);
}

type Filters = {
  text: string;
  runId: string;
  level: string;
  state: string;
  showReadiness: boolean;
};

const EMPTY: Filters = {
  text: "",
  runId: "",
  level: "",
  state: "",
  showReadiness: false,
};

/** The columns, once, so a spanning row cannot drift out of step with the head. */
const COLUMNS = 8;

/** How many questions a line shows before the fold. */
const FOLD_AT = 3;

/** TGQ first, then the rest, then the commercial checklist. The fold reads down. */
function byTier(questions: TableQuestion[]): TableQuestion[] {
  const rank = (question: TableQuestion) =>
    question.requirementKind === "readiness" ? 2 : question.tier === "to_quote" ? 0 : 1;
  return [...questions].sort((a, b) => rank(a) - rank(b));
}

export default function ChaseQuestionTable({
  questions,
  selected,
  onToggle,
  onToggleMany,
  generating,
  onGenerate,
  contactId,
  tier,
  onTier,
  includeWaiting,
  onIncludeWaiting,
  levelSuggestions,
  onAcceptLevel,
  acceptingLevel,
}: {
  questions: TableQuestion[];
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
  onToggleMany: (questions: TableQuestion[], on: boolean) => void;
  generating: boolean;
  onGenerate: () => void;
  /**
   * Which contact's questions to list. The strip that sets it is the PAGE's
   * `Tabs`, in the header band — there is no control for it here, so there is
   * no setter either.
   */
  contactId?: string;
  /** The page's TGQ / Also tiles. A tile IS a filter. */
  tier?: "all" | QuestionTier;
  onTier?: (tier: "all" | QuestionTier) => void;
  /** The page's Waiting tile and its header action. */
  includeWaiting?: boolean;
  onIncludeWaiting?: (on: boolean) => void;
  /** Per record: what the app guessed the level is. Nothing is written by it. */
  levelSuggestions?: Record<string, LevelSuggestion>;
  onAcceptLevel?: (recordId: string) => void;
  acceptingLevel?: string | null;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [localTier, setLocalTier] = useState<"all" | QuestionTier>("all");
  const [localWaiting, setLocalWaiting] = useState(false);
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const [openOptions, setOpenOptions] = useState<Set<string>>(new Set());
  /** Which question lists are unfolded. Never a filter: see the header. */
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());

  const contactValue = contactId ?? "";
  const tierValue = tier ?? localTier;
  const waitingValue = includeWaiting ?? localWaiting;
  const setTierValue = onTier ?? setLocalTier;
  const setWaitingValue = onIncludeWaiting ?? setLocalWaiting;

  const lines = useMemo(() => groupIntoLines(questions), [questions]);

  const runs = useMemo(() => {
    const byId = new Map<string, string>();
    for (const question of questions) byId.set(question.runId, question.runName);
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [questions]);

  // Whether the user has NARROWED the list, as opposed to leaving readiness and
  // awaiting-a-reply hidden, which is the default view rather than a filter.
  // Printing "n shown" on every row by default teaches people to ignore the one
  // row where it means something.
  const narrowed = Boolean(filters.text) || Boolean(filters.state) || tierValue !== "all";

  const text = filters.text.trim().toLowerCase();
  const lineMatchesText = (line: FurnitureLine<TableQuestion>) =>
    !text || `${line.code} ${line.itemDescription} ${line.recordLabel}`.toLowerCase().includes(text);

  function visible(line: FurnitureLine<TableQuestion>, list: TableQuestion[]): TableQuestion[] {
    const lineHit = lineMatchesText(line);
    return list.filter((question) => {
      if (tierValue !== "all" && question.tier !== tierValue) return false;
      if (!filters.showReadiness && question.requirementKind === "readiness") return false;
      if (!waitingValue && question.waiting) return false;
      if (filters.state && question.state !== filters.state) return false;
      if (text && !lineHit && !`${question.prompt} ${question.fieldLabel ?? ""}`.toLowerCase().includes(text)) {
        return false;
      }
      return true;
    });
  }

  function linePasses(line: FurnitureLine<TableQuestion>): boolean {
    if (contactValue && !line.contactIds.includes(contactValue)) return false;
    if (filters.runId && line.runId !== filters.runId) return false;
    if (filters.level === "none" && line.level !== null) return false;
    if (filters.level && filters.level !== "none" && line.level !== filters.level) return false;
    return true;
  }

  /** Each line with what the filters leave of it. Computed once per render. */
  const shown = useMemo(() => {
    const out: {
      line: FurnitureLine<TableQuestion>;
      own: TableQuestion[];
      options: { option: FurnitureLine<TableQuestion>["options"][number]; questions: TableQuestion[] }[];
      visibleAll: TableQuestion[];
      searching: boolean;
    }[] = [];
    for (const line of lines) {
      if (!linePasses(line)) continue;
      const own = visible(line, line.own);
      const options = line.options.map((option) => ({ option, questions: visible(line, option.questions) }));
      const visibleAll = [...own, ...options.flatMap((entry) => entry.questions)];
      // A search that matches nothing on a line hides the line -- unless the
      // line itself is what matched, in which case it stays with its questions.
      if (visibleAll.length === 0 && (text || filters.state) && !lineMatchesText(line)) continue;
      if (visibleAll.length === 0 && (text || filters.state)) continue;
      out.push({ line, own, options, visibleAll, searching: Boolean(text) && !lineMatchesText(line) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, filters, tierValue, contactValue, waitingValue]);

  const everything = useMemo(() => lines.flatMap((line) => allQuestions(line)), [lines]);
  const selectedQuestions = everything.filter((question) => selected.has(key(question.recordId, question.requirementId)));
  const selectedLines = new Set(selectedQuestions.map((question) => question.parentId ?? question.recordId)).size;
  const recipients = [...new Set(selectedQuestions.map((question) => question.contactName))];
  // Ticked, but not on screen. Never dropped silently: the footer says so.
  const visibleKeys = new Set(
    shown.flatMap((entry) => entry.visibleAll.map((q) => key(q.recordId, q.requirementId))),
  );
  const hiddenSelected = selectedQuestions.filter(
    (question) => !visibleKeys.has(key(question.recordId, question.requirementId)),
  ).length;

  function toggleOpen(setter: typeof setOpenLines, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectShown = () => onToggleMany(shown.flatMap((entry) => entry.visibleAll), true);
  const clearAll = () => onToggleMany(everything, false);
  const filtering = Boolean(filters.text || filters.runId || filters.level || filters.state || tierValue !== "all");

  return (
    <>
      {/* ---- what to show ------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.text}
          onChange={(event) => setFilters((prev) => ({ ...prev, text: event.target.value }))}
          placeholder="Search a code, an item, a question or a BWS field"
          aria-label="Search the questions"
          className="w-64 max-w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        />
        <select
          value={filters.runId}
          onChange={(event) => setFilters((prev) => ({ ...prev, runId: event.target.value }))}
          aria-label="Filter by phase"
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All phases</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name}
            </option>
          ))}
        </select>
        {/* THE ACTIVE TILE, REPEATED AS A REMOVABLE CHIP. A filter you cannot
            see is a filter you forget you set — and this one is set from a tile
            at the top of the page, which scrolls away. */}
        {tierValue !== "all" && (
          <button
            type="button"
            onClick={() => setTierValue("all")}
            aria-label={`Stop showing only ${TIER_LABELS[tierValue]}`}
            className="rounded-full"
          >
            <Chip tone={tierValue === "to_quote" ? "danger" : "warn"}>
              {tierValue === "to_quote" ? "TGQ" : TIER_LABELS.later} ✕
            </Chip>
          </button>
        )}
        {waitingValue && (
          <button
            type="button"
            onClick={() => setWaitingValue(false)}
            aria-label="Stop including questions waiting on a reply"
            className="rounded-full"
          >
            <Chip tone="info">Waiting on a reply included ✕</Chip>
          </button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-neutral-600">
          <b className="font-semibold text-neutral-900">{selectedQuestions.length} ticked</b> · {shown.length} line
          {shown.length === 1 ? "" : "s"} shown of {lines.length}
        </span>
      </div>

      {/* The controls that are not in the mock-up's one row but are real
          features: hiding them would be a regression, and putting them in the
          headline row would bury the search. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-700">
        <select
          value={filters.level}
          onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
          aria-label="Filter by level"
          className="rounded border border-neutral-300 bg-white px-2 py-1"
        >
          <option value="">Any level</option>
          <option value="simple">{ITEM_LEVEL_LABELS.simple}</option>
          <option value="complex">{ITEM_LEVEL_LABELS.complex}</option>
          <option value="hero">{ITEM_LEVEL_LABELS.hero}</option>
          <option value="none">No level set</option>
        </select>
        <select
          value={filters.state}
          onChange={(event) => setFilters((prev) => ({ ...prev, state: event.target.value }))}
          aria-label="Filter by answer state"
          className="rounded border border-neutral-300 bg-white px-2 py-1"
        >
          <option value="">Missing and TBC</option>
          <option value="missing">Missing only</option>
          <option value="tbc">TBC only</option>
        </select>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={waitingValue}
            onChange={(event) => setWaitingValue(event.target.checked)}
          />
          Include questions waiting on a reply
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.showReadiness}
            onChange={(event) => setFilters((prev) => ({ ...prev, showReadiness: event.target.checked }))}
          />
          Show readiness questions
        </label>
        {filtering && (
          <Button
            size="xs"
            variant="quiet"
            onClick={() => {
              setFilters(EMPTY);
              setTierValue("all");
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="flex-1" />
        <Button
          size="xs"
          variant="quiet"
          onClick={() => setOpenLines(new Set(shown.map((entry) => entry.line.lineId)))}
        >
          Expand all
        </Button>
        <Button
          size="xs"
          variant="quiet"
          onClick={() => {
            setOpenLines(new Set());
            setOpenOptions(new Set());
          }}
        >
          Collapse all
        </Button>
        <Button size="xs" variant="quiet" onClick={selectShown}>
          Select everything shown
        </Button>
        <Button size="xs" variant="quiet" onClick={clearAll}>
          Clear selection
        </Button>
      </div>

      {/* ---- the lines ---------------------------------------------------- */}
      {/* No `overflow-hidden` on this wrapper. It would make it the sticky
          scroll container, and the column header would then offset DOWN from
          the top of the table and cover a furniture line -- a row nobody would
          know to look for. */}
      <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th className="w-6" />
              <Th>Item</Th>
              <Th num className="w-[80px]">Qty</Th>
              <Th className="w-[120px]">Level</Th>
              <Th num className="w-[90px]">TGQ</Th>
              <Th num className="w-[90px]">Also</Th>
              <Th className="w-[90px]" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} className="px-4 py-6 text-center text-sm text-neutral-500">
                  Nothing matches those filters.
                </td>
              </tr>
            )}
            {shown.map(({ line, own, options, visibleAll, searching }) => {
              const open = openLines.has(line.lineId) || searching;
              const total = countOutstanding(allQuestions(line));
              const optionsWithNothing = line.optionCount - options.filter((entry) => entry.questions.length > 0).length;
              return (
                <LineRows
                  key={line.lineId}
                  line={line}
                  open={open}
                  own={own}
                  options={options}
                  total={total}
                  filteredCount={narrowed && visibleAll.length !== allQuestions(line).length ? visibleAll.length : null}
                  optionsWithNothing={optionsWithNothing}
                  openOptions={openOptions}
                  unfolded={unfolded}
                  onUnfold={(id) => toggleOpen(setUnfolded, id)}
                  searching={searching}
                  selected={selected}
                  onToggle={onToggle}
                  onToggleMany={onToggleMany}
                  onToggleLine={() => toggleOpen(setOpenLines, line.lineId)}
                  onToggleOption={(id) => toggleOpen(setOpenOptions, id)}
                  narrowed={narrowed}
                  visibleOnLine={visibleAll}
                  showContacts={!contactValue}
                  suggestion={levelSuggestions?.[line.lineId]}
                  onAcceptLevel={onAcceptLevel}
                  acceptingLevel={acceptingLevel ?? null}
                />
              );
            })}
          </tbody>
        </Table>

        {/* ---- what would be generated ------------------------------------ */}
        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-[#fcfcfc] px-4 py-2.5">
          <span className="text-sm text-neutral-700">
            {selectedQuestions.length === 0 ? (
              "Nothing ticked"
            ) : (
              <>
                <b className="font-semibold text-neutral-900">{selectedQuestions.length} question
                {selectedQuestions.length === 1 ? "" : "s"} ticked</b>{" "}
                across {selectedLines} item{selectedLines === 1 ? "" : "s"} ·{" "}
                {recipients.length} recipient{recipients.length === 1 ? "" : "s"}{" "}
                <span className="text-neutral-500">({recipients.join(", ")})</span>
              </>
            )}
          </span>
          {hiddenSelected > 0 && (
            <Chip tone="warn">
              {hiddenSelected} ticked question{hiddenSelected === 1 ? " is" : "s are"} hidden by your filters — they
              will still be asked
            </Chip>
          )}
          <span className="flex-1" />
          <Button
            variant="primary"
            disabled={generating || selectedQuestions.length === 0}
            onClick={onGenerate}
          >
            {generating
              ? "Drafting…"
              : selectedQuestions.length === 0
                ? "Draft it"
                : `Draft it · ${recipients.length} draft${recipients.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One furniture line, and everything under it.
//
// A spanning panel is its OWN `<tr>`, never an extra `<td colSpan>` beside the
// data cells: a row carrying both is 15 column slots wide, and the browser
// finds room for the panel BESIDE the data rather than under it.
// ---------------------------------------------------------------------------
function LineRows({
  line,
  open,
  own,
  options,
  total,
  filteredCount,
  optionsWithNothing,
  openOptions,
  unfolded,
  onUnfold,
  searching,
  selected,
  onToggle,
  onToggleMany,
  onToggleLine,
  onToggleOption,
  narrowed,
  visibleOnLine,
  showContacts,
  suggestion,
  onAcceptLevel,
  acceptingLevel,
}: {
  line: FurnitureLine<TableQuestion>;
  open: boolean;
  own: TableQuestion[];
  options: { option: FurnitureLine<TableQuestion>["options"][number]; questions: TableQuestion[] }[];
  total: { toQuote: number; later: number; waiting: number };
  filteredCount: number | null;
  optionsWithNothing: number;
  openOptions: Set<string>;
  unfolded: Set<string>;
  onUnfold: (id: string) => void;
  searching: boolean;
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
  onToggleMany: (questions: TableQuestion[], on: boolean) => void;
  onToggleLine: () => void;
  onToggleOption: (id: string) => void;
  narrowed: boolean;
  visibleOnLine: TableQuestion[];
  showContacts: boolean;
  suggestion?: LevelSuggestion;
  onAcceptLevel?: (recordId: string) => void;
  acceptingLevel: string | null;
}) {
  const allSelected =
    visibleOnLine.length > 0 && visibleOnLine.every((q) => selected.has(key(q.recordId, q.requirementId)));
  const someSelected = visibleOnLine.some((q) => selected.has(key(q.recordId, q.requirementId)));
  const contacts = [...new Set(visibleOnLine.concat(allQuestions(line)).map((q) => q.contactName))];

  return (
    <>
      <Tr className="cursor-pointer" onClick={onToggleLine}>
        <Td className="px-2" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={allSelected}
            aria-label={`Ask everything shown on ${line.code || line.recordLabel}`}
            ref={(node) => {
              if (node) node.indeterminate = someSelected && !allSelected;
            }}
            onChange={(event) => onToggleMany(visibleOnLine, event.target.checked)}
          />
        </Td>
        <Td className="px-0 text-center text-neutral-500">{open ? "▾" : "▸"}</Td>
        {/* THE ITEM, AND EVERYTHING THAT IDENTIFIES IT, IN ONE CELL. The run
            and the record number used to be columns of their own, which put
            four narrow columns between the code and the number that decides
            whether to chase it. */}
        <Td>
          <Link
            href={`/dashboard/records/${line.lineId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="font-mono font-semibold text-blue-700 no-underline hover:underline"
          >
            {line.code || "—"}
          </Link>{" "}
          {/* THE DESCRIPTION IS NOT A LINK, and the row is. Clicking a line is
              how you open it, which is the gesture this screen is built on; a
              link in the middle of the row would fight it. The code beside it
              and `Open` at the end both go to the record. */}
          <span className="text-neutral-900">{line.itemDescription}</span>
          <span className="text-neutral-500">
            {" "}· {line.runName} · {line.recordLabel}
            {showContacts && contacts.length > 0 && <> · {contacts.join(", ")}</>}
          </span>
          {/* THE TRUE NUMBER OF FINISH OPTIONS, including any with nothing
              outstanding. "2 finish options" beside a single visible one is a
              question about the data; "1" would be a claim that B does not
              exist. */}
          {line.optionCount > 0 && (
            <span className="block text-[11.5px] text-neutral-500">
              {line.optionCount} finish option{line.optionCount === 1 ? "" : "s"}
              {optionsWithNothing > 0 && (
                <> · {optionsWithNothing} {optionsWithNothing === 1 ? "has" : "have"} nothing outstanding</>
              )}
            </span>
          )}
        </Td>
        <Td num className="text-neutral-600">{line.qty ?? "—"}</Td>
        <Td onClick={(event) => event.stopPropagation()}>
          {line.level ? (
            <Chip>{ITEM_LEVEL_LABELS[line.level as ItemLevel] ?? line.level}</Chip>
          ) : suggestion && onAcceptLevel ? (
            /* WHAT THE APP GUESSED, with what it read to guess it. Accepting
               writes `spec_records.level` — the column the quote gate reads —
               so it is a click and never a pre-filled control. */
            <SuggestButton
              value={ITEM_LEVEL_LABELS[suggestion.level as ItemLevel] ?? suggestion.level}
              evidence={suggestion.reason ?? "guessed when the bill was confirmed"}
              busy={acceptingLevel === line.lineId}
              onAccept={() => onAcceptLevel(line.lineId)}
            />
          ) : (
            // A LINK, because it goes somewhere: the record screen is where a
            // level is set. New tab, so a half-made selection survives it.
            <Link
              href={`/dashboard/records/${line.lineId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] text-amber-800 no-underline hover:underline"
            >
              Set level
            </Link>
          )}
        </Td>
        <Td num>
          <span className={total.toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>
            {total.toQuote}
          </span>
          {filteredCount !== null && (
            <span className="block text-[11px] text-neutral-400">{filteredCount} shown</span>
          )}
        </Td>
        <Td num className={total.later > 0 ? "text-neutral-600" : "text-neutral-400"}>{total.later}</Td>
        <Td className="text-right">
          <Link
            href={`/dashboard/records/${line.lineId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center rounded border border-transparent px-2 py-1 text-xs text-neutral-600 no-underline hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
          >
            Open
          </Link>
        </Td>
      </Tr>

      {open && line.optionCount > 0 && own.length > 0 && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-[#fcfcfc] px-4 py-1.5 pl-12 text-xs text-neutral-600">
            This bill line is a heading — its {line.optionCount} finish option
            {line.optionCount === 1 ? "" : "s"} are what gets quoted. These questions are still on the line itself.
          </td>
        </tr>
      )}

      {open && (
        <QuestionRows
          id={line.lineId}
          questions={own}
          depth={1}
          selected={selected}
          onToggle={onToggle}
          unfolded={unfolded}
          onUnfold={onUnfold}
        />
      )}

      {open &&
        options.map(({ option, questions }) => {
          const optionOpen = openOptions.has(option.recordId) || searching;
          const optionTotal = countOutstanding(option.questions);
          const optionSelected =
            questions.length > 0 && questions.every((q) => selected.has(key(q.recordId, q.requirementId)));
          const optionSome = questions.some((q) => selected.has(key(q.recordId, q.requirementId)));
          return (
            <FragmentRows key={option.recordId}>
              <tr className="cursor-pointer bg-[#fcfcfc] hover:bg-neutral-50" onClick={() => onToggleOption(option.recordId)}>
                <Td className="px-2 pl-5" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={optionSelected}
                    aria-label={`Ask everything shown on ${option.name}`}
                    ref={(node) => {
                      if (node) node.indeterminate = optionSome && !optionSelected;
                    }}
                    onChange={(event) => onToggleMany(questions, event.target.checked)}
                  />
                </Td>
                <Td className="px-0 text-center text-neutral-500">{optionOpen ? "▾" : "▸"}</Td>
                <Td>
                  {/* The letter is coloured the way the drawings review colours
                      it — A is always sky — so a chip on a card and a row here
                      are the same configuration at a glance. */}
                  <span className="font-mono font-semibold" title={option.name}>
                    {option.name.slice(0, option.name.length - option.label.length)}
                    <b className={letterColour(option.label)}>{option.label}</b>
                  </span>
                  {/* The bill says 45 and never says how many are fabric A. */}
                  <span className="text-neutral-500"> · quantity not allocated</span>
                </Td>
                <Td num className="text-neutral-400">—</Td>
                <Td />
                <Td num>
                  <span className={optionTotal.toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>
                    {optionTotal.toQuote}
                  </span>
                  {narrowed && questions.length !== option.questions.length && (
                    <span className="block text-[11px] text-neutral-400">{questions.length} shown</span>
                  )}
                </Td>
                <Td num className={optionTotal.later > 0 ? "text-neutral-600" : "text-neutral-400"}>
                  {optionTotal.later}
                </Td>
                <Td />
              </tr>
              {optionOpen && questions.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-1.5 pl-16 text-xs text-neutral-500">
                    Nothing outstanding on this finish option.
                  </td>
                </tr>
              )}
              {optionOpen && (
                <QuestionRows
                  id={option.recordId}
                  questions={questions}
                  depth={2}
                  selected={selected}
                  onToggle={onToggle}
                  unfolded={unfolded}
                  onUnfold={onUnfold}
                />
              )}
            </FragmentRows>
          );
        })}

      {open && optionsWithNothing > 0 && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-1.5 pl-12 text-xs text-neutral-500">
            {optionsWithNothing} finish option{optionsWithNothing === 1 ? " has" : "s have"} nothing outstanding.
          </td>
        </tr>
      )}
    </>
  );
}

/** `<>...</>` around table rows, named so the nesting reads. */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function QuestionRows({
  id,
  questions,
  depth,
  selected,
  onToggle,
  unfolded,
  onUnfold,
}: {
  /** The record these questions hang off, so each fold opens on its own. */
  id: string;
  questions: TableQuestion[];
  depth: 1 | 2;
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
  unfolded: Set<string>;
  onUnfold: (id: string) => void;
}) {
  if (questions.length === 0) return null;
  const pad = depth === 2 ? "pl-16" : "pl-12";
  const ordered = byTier(questions);
  const open = unfolded.has(id);
  const listed = open ? ordered : ordered.slice(0, FOLD_AT);
  const rest = ordered.slice(listed.length);
  const moreToQuote = rest.filter((q) => q.tier === "to_quote" && q.requirementKind === "spec_field").length;
  const moreAlso = rest.length - moreToQuote;

  return (
    <>
      {listed.map((question) => {
        const k = key(question.recordId, question.requirementId);
        const toQuote = question.tier === "to_quote" && question.requirementKind === "spec_field";
        return (
          <tr key={k} className="hover:bg-neutral-50">
            <td colSpan={2} className={`border-b border-neutral-100 px-2 py-1.5 align-top ${pad}`}>
              <input
                type="checkbox"
                checked={selected.has(k)}
                aria-label={`Ask “${question.prompt}”`}
                onChange={() => onToggle(question.recordId, question.requirementId)}
              />
            </td>
            <Td colSpan={2}>
              {/* RED IS THE ONE THAT BLOCKS A QUOTE. Amber is the commercial
                  checklist, which is Ben Whistler's own and is never ticked by
                  default. Everything else carries no dot at all. */}
              <span
                aria-hidden
                title={
                  toQuote
                    ? TIER_LABELS.to_quote
                    : question.requirementKind === "readiness"
                      ? "Readiness — internal and commercial"
                      : TIER_LABELS.later
                }
                className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                  toQuote ? TONE.danger.dot : question.requirementKind === "readiness" ? TONE.warn.dot : "bg-neutral-300"
                }`}
              />
              <span className="text-neutral-900">{question.prompt}</span>
              {question.fieldLabel && (
                <span className="block pl-3.5 text-[11px] text-neutral-500">BWS: {question.fieldLabel.trim()}</span>
              )}
            </Td>
            <Td>
              <Chip tone={STATE_TONE[question.state] ?? "plain"}>
                {ANSWER_STATE_LABELS[question.state as AnswerState]}
              </Chip>
            </Td>
            <Td colSpan={2} className="text-neutral-500">
              {question.waiting ? (
                <>
                  <span className="text-blue-700">
                    asked{question.waiting.sentAt ? ` ${askedOn(question.waiting.sentAt)}` : ""}
                  </span>
                  <span className="block text-[11px]">excluded — waiting on a reply</span>
                </>
              ) : (
                "never asked"
              )}
            </Td>
            <Td />
          </tr>
        );
      })}
      {rest.length > 0 && (
        <tr>
          <td colSpan={2} className="border-b border-neutral-100" />
          <td colSpan={COLUMNS - 2} className={`border-b border-neutral-100 px-4 py-1.5 text-xs ${pad}`}>
            {/* NOT A FILTER. These questions are still ticked, still counted on
                the line, and still in the draft — the fold is about how much of
                one item fills the screen at once. */}
            <Button size="xs" variant="quiet" onClick={() => onUnfold(id)}>
              {moreToQuote > 0 && `${moreToQuote} more TGQ`}
              {moreToQuote > 0 && moreAlso > 0 && " · "}
              {moreAlso > 0 && `${moreAlso} also outstanding`}
            </Button>
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={2} className="border-b border-neutral-100" />
          <td colSpan={COLUMNS - 2} className={`border-b border-neutral-100 px-4 py-1.5 text-xs ${pad}`}>
            <Button size="xs" variant="quiet" onClick={() => onUnfold(id)}>
              Show fewer
            </Button>
          </td>
        </tr>
      )}
    </>
  );
}
