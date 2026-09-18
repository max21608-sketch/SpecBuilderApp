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
// ============================================================================
import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { ANSWER_STATE_LABELS, ITEM_LEVEL_LABELS, type AnswerState, type ItemLevel } from "@/lib/spec-vocab";
import { TIER_LABELS, type QuestionTier } from "@/lib/tgq";
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

const key = (recordId: string, requirementId: string) => `${recordId}:${requirementId}`;

/**
 * A finish option's chip colour, by letter. A is always sky, so a letter finds
 * its own row at a glance — the same mapping the drawings review uses, because
 * two screens colouring `A` differently is worse than neither colouring it.
 */
const LETTER_COLOURS = [
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-rose-600",
  "bg-cyan-700",
];
function letterColour(label: string): string {
  const index = label.toUpperCase().charCodeAt(0) - 65;
  return LETTER_COLOURS[index] ?? "bg-neutral-600";
}

type Filters = {
  text: string;
  contactId: string;
  runId: string;
  level: string;
  state: string;
  includeWaiting: boolean;
  showReadiness: boolean;
};

const EMPTY: Filters = {
  text: "",
  contactId: "",
  runId: "",
  level: "",
  state: "",
  includeWaiting: false,
  showReadiness: false,
};

/** The columns, once, so a spanning row cannot drift out of step with the head. */
const COLUMNS = 13;

export default function ChaseQuestionTable({
  questions,
  selected,
  onToggle,
  onToggleMany,
  generating,
  onGenerate,
}: {
  questions: TableQuestion[];
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
  onToggleMany: (questions: TableQuestion[], on: boolean) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [tier, setTier] = useState<"all" | QuestionTier>("all");
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const [openOptions, setOpenOptions] = useState<Set<string>>(new Set());

  const lines = useMemo(() => groupIntoLines(questions), [questions]);

  const contacts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const question of questions) byId.set(question.contactId, question.contactName);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [questions]);

  const runs = useMemo(() => {
    const byId = new Map<string, string>();
    for (const question of questions) byId.set(question.runId, question.runName);
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [questions]);

  // Whether the user has NARROWED the list, as opposed to leaving readiness and
  // awaiting-a-reply hidden, which is the default view rather than a filter.
  // Printing "n shown" on every row by default teaches people to ignore the one
  // row where it means something.
  const narrowed = Boolean(filters.text) || Boolean(filters.state) || tier !== "all";

  const text = filters.text.trim().toLowerCase();
  const lineMatchesText = (line: FurnitureLine<TableQuestion>) =>
    !text || `${line.code} ${line.itemDescription} ${line.recordLabel}`.toLowerCase().includes(text);

  function visible(line: FurnitureLine<TableQuestion>, list: TableQuestion[]): TableQuestion[] {
    const lineHit = lineMatchesText(line);
    return list.filter((question) => {
      if (tier !== "all" && question.tier !== tier) return false;
      if (!filters.showReadiness && question.requirementKind === "readiness") return false;
      if (!filters.includeWaiting && question.waiting) return false;
      if (filters.state && question.state !== filters.state) return false;
      if (text && !lineHit && !`${question.prompt} ${question.fieldLabel ?? ""}`.toLowerCase().includes(text)) {
        return false;
      }
      return true;
    });
  }

  function linePasses(line: FurnitureLine<TableQuestion>): boolean {
    if (filters.contactId && !line.contactIds.includes(filters.contactId)) return false;
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
  }, [lines, filters, tier]);

  const shownQuestionCount = shown.reduce((sum, entry) => sum + entry.visibleAll.length, 0);
  const everything = useMemo(() => lines.flatMap((line) => allQuestions(line)), [lines]);
  const selectedQuestions = everything.filter((question) => selected.has(key(question.recordId, question.requirementId)));
  const selectedToQuote = selectedQuestions.filter(
    (question) => question.tier === "to_quote" && question.requirementKind === "spec_field",
  ).length;
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

  return (
    <>
      {/* ---- what to show ------------------------------------------------- */}
      <div className="mt-4 border border-neutral-200 rounded-lg bg-neutral-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-800">Questions to ask</h2>
          <input
            type="search"
            value={filters.text}
            onChange={(event) => setFilters((prev) => ({ ...prev, text: event.target.value }))}
            placeholder="Search a code, an item, a question or a BWS field"
            className="flex-1 min-w-[220px] border border-neutral-300 rounded px-2 py-1 text-sm bg-white"
          />
          <div className="inline-flex border border-neutral-300 rounded overflow-hidden bg-white">
            {([
              ["all", "Everything"],
              ["to_quote", TIER_LABELS.to_quote],
              ["later", TIER_LABELS.later],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tier === value}
                onClick={() => setTier(value)}
                className={`text-xs px-2.5 py-1 border-l first:border-l-0 border-neutral-200 ${
                  tier === value ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-700">
          <span className="text-neutral-500">Filter</span>
          <select
            value={filters.contactId}
            onChange={(event) => setFilters((prev) => ({ ...prev, contactId: event.target.value }))}
            className="border border-neutral-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Any contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
          <select
            value={filters.runId}
            onChange={(event) => setFilters((prev) => ({ ...prev, runId: event.target.value }))}
            className="border border-neutral-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Any run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name}
              </option>
            ))}
          </select>
          <select
            value={filters.level}
            onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}
            className="border border-neutral-300 rounded px-2 py-1 bg-white"
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
            className="border border-neutral-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Missing and TBC</option>
            <option value="missing">Missing only</option>
            <option value="tbc">TBC only</option>
          </select>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.includeWaiting}
              onChange={(event) => setFilters((prev) => ({ ...prev, includeWaiting: event.target.checked }))}
            />
            Include questions awaiting a reply
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.showReadiness}
              onChange={(event) => setFilters((prev) => ({ ...prev, showReadiness: event.target.checked }))}
            />
            Show readiness questions
          </label>
          <Button size="xs" variant="quiet" onClick={() => setFilters(EMPTY)}>
            Clear filters
          </Button>
          <span className="ml-auto text-neutral-600">
            {shown.length} furniture line{shown.length === 1 ? "" : "s"} · {shownQuestionCount} question
            {shownQuestionCount === 1 ? "" : "s"} shown of {everything.length}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setOpenLines(new Set(shown.map((entry) => entry.line.lineId)))}
          >
            Expand all
          </Button>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setOpenLines(new Set());
              setOpenOptions(new Set());
            }}
          >
            Collapse all
          </Button>
          <Button size="xs" variant="secondary" onClick={selectShown}>
            Select everything shown
          </Button>
          <Button size="xs" variant="secondary" onClick={clearAll}>
            Clear selection
          </Button>
        </div>
      </div>

      {/* ---- the lines ---------------------------------------------------- */}
      {/* No `overflow-hidden` on this wrapper. It would make it the sticky
          scroll container, and the column header would then offset DOWN from
          the top of the table and cover a furniture line -- a row nobody would
          know to look for. */}
      <div className="mt-3 border border-neutral-200 rounded-lg">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="w-7" />
              <th className="w-8" />
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Code</th>
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Item</th>
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Record</th>
              <th className="text-right font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Qty</th>
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Run</th>
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Level</th>
              <th className="text-left font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Ask</th>
              <th className="text-right font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">
                To quote
              </th>
              <th className="text-right font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">Also</th>
              <th className="text-right font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">
                Options
              </th>
              <th className="text-right font-semibold px-2 py-1.5 bg-neutral-50 border-b border-neutral-200">
                Awaiting
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS} className="px-3 py-6 text-center text-sm text-neutral-500">
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
                  searching={searching}
                  selected={selected}
                  onToggle={onToggle}
                  onToggleMany={onToggleMany}
                  onToggleLine={() => toggleOpen(setOpenLines, line.lineId)}
                  onToggleOption={(id) => toggleOpen(setOpenOptions, id)}
                  narrowed={narrowed}
                  visibleOnLine={visibleAll}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- what would be generated -------------------------------------- */}
      <div className="sticky bottom-0 mt-3 border border-neutral-200 rounded-lg bg-white shadow-sm px-3 py-2 flex flex-wrap items-center gap-3">
        <span className="text-sm text-neutral-700">
          {selectedQuestions.length === 0 ? (
            "Nothing selected"
          ) : (
            <>
              <span className="font-medium text-neutral-900">{selectedQuestions.length}</span> questions ·{" "}
              {selectedToQuote} TGQ · across{" "}
              <span className="font-medium text-neutral-900">{selectedLines}</span> furniture line
              {selectedLines === 1 ? "" : "s"} · {recipients.length} recipient
              {recipients.length === 1 ? "" : "s"}{" "}
              <span className="text-neutral-500">({recipients.join(", ")})</span>
            </>
          )}
        </span>
        {hiddenSelected > 0 && (
          <span className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-0.5">
            {hiddenSelected} selected question{hiddenSelected === 1 ? " is" : "s are"} hidden by the filters — they
            will still be asked
          </span>
        )}
        <Button
          className="ml-auto"
          disabled={generating || selectedQuestions.length === 0}
          onClick={onGenerate}
        >
          {generating
            ? "Generating…"
            : selectedQuestions.length === 0
              ? "Generate drafts"
              : `Generate ${recipients.length} draft${recipients.length === 1 ? "" : "s"} (${selectedQuestions.length} question${selectedQuestions.length === 1 ? "" : "s"})`}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One furniture line, and everything under it.
//
// A spanning panel is its OWN `<tr>`, never an extra `<td colSpan>` beside the
// data cells: a row carrying both is 20 column slots wide, and the browser
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
  searching,
  selected,
  onToggle,
  onToggleMany,
  onToggleLine,
  onToggleOption,
  narrowed,
  visibleOnLine,
}: {
  line: FurnitureLine<TableQuestion>;
  open: boolean;
  own: TableQuestion[];
  options: { option: FurnitureLine<TableQuestion>["options"][number]; questions: TableQuestion[] }[];
  total: { toQuote: number; later: number; waiting: number };
  filteredCount: number | null;
  optionsWithNothing: number;
  openOptions: Set<string>;
  searching: boolean;
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
  onToggleMany: (questions: TableQuestion[], on: boolean) => void;
  onToggleLine: () => void;
  onToggleOption: (id: string) => void;
  narrowed: boolean;
  visibleOnLine: TableQuestion[];
}) {
  const allSelected =
    visibleOnLine.length > 0 && visibleOnLine.every((q) => selected.has(key(q.recordId, q.requirementId)));
  const someSelected = visibleOnLine.some((q) => selected.has(key(q.recordId, q.requirementId)));
  const contacts = [...new Set(visibleOnLine.concat(allQuestions(line)).map((q) => q.contactName))];

  return (
    <>
      <tr className="border-t border-neutral-200 hover:bg-neutral-50 cursor-pointer" onClick={onToggleLine}>
        <td className="px-1 text-center text-xs text-neutral-500">{open ? "▾" : "▸"}</td>
        <td className="px-1" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(node) => {
              if (node) node.indeterminate = someSelected && !allSelected;
            }}
            onChange={(event) => onToggleMany(visibleOnLine, event.target.checked)}
          />
        </td>
        <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{line.code || "—"}</td>
        <td className="px-2 py-1.5 whitespace-nowrap">{line.itemDescription}</td>
        <td className="px-2 py-1.5 text-xs text-neutral-500 tabular-nums whitespace-nowrap">
          <Link
            href={`/dashboard/records/${line.lineId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="underline"
          >
            {line.recordLabel}
          </Link>
        </td>
        <td className="px-2 py-1.5 text-right text-xs text-neutral-600 tabular-nums">{line.qty ?? "—"}</td>
        <td className="px-2 py-1.5 text-xs text-neutral-600 whitespace-nowrap">{line.runName}</td>
        <td className="px-2 py-1.5 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
          {line.level ? (
            <span className="text-[11px] border border-neutral-300 rounded-full px-2 py-0.5 text-neutral-600">
              {ITEM_LEVEL_LABELS[line.level as ItemLevel] ?? line.level}
            </span>
          ) : (
            // A LINK, because it goes somewhere: the record screen is where a
            // level is set. New tab, so a half-made selection survives it.
            <Link
              href={`/dashboard/records/${line.lineId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] border border-amber-300 bg-amber-50 rounded-full px-2 py-0.5 text-amber-900 underline"
            >
              Set level
            </Link>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-neutral-600 whitespace-nowrap">{contacts.join(", ")}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          <span className={total.toQuote > 0 ? "text-red-700 font-semibold" : "text-neutral-400"}>
            {total.toQuote}
          </span>
          {filteredCount !== null && (
            <span className="block text-[11px] text-neutral-400">{filteredCount} shown</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          <span className={total.later > 0 ? "text-neutral-700" : "text-neutral-400"}>{total.later}</span>
        </td>
        <td className="px-2 py-1.5 text-right text-xs text-neutral-600 whitespace-nowrap">
          {line.optionCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              {line.options.map((option) => (
                <span
                  key={option.recordId}
                  className={`inline-block w-2 h-2 rounded-full ${letterColour(option.label)}`}
                />
              ))}
              {line.optionCount}
            </span>
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right">
          {total.waiting > 0 ? (
            <span className="text-[11px] border border-blue-300 bg-blue-50 text-blue-800 rounded-full px-2 py-0.5">
              {total.waiting}
            </span>
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </td>
      </tr>

      {open && line.optionCount > 0 && own.length > 0 && (
        <tr className="bg-neutral-50">
          <td />
          <td />
          <td colSpan={COLUMNS - 2} className="px-2 py-1 text-xs text-neutral-600">
            This bill line is a heading — its {line.optionCount} finish option
            {line.optionCount === 1 ? "" : "s"} are what gets quoted. These questions are still on the line itself.
          </td>
        </tr>
      )}

      {open && <QuestionRows questions={own} depth={1} selected={selected} onToggle={onToggle} />}

      {open &&
        options.map(({ option, questions }) => {
          const optionOpen = openOptions.has(option.recordId) || searching;
          const optionTotal = countOutstanding(option.questions);
          const optionSelected =
            questions.length > 0 && questions.every((q) => selected.has(key(q.recordId, q.requirementId)));
          const optionSome = questions.some((q) => selected.has(key(q.recordId, q.requirementId)));
          return (
            <FragmentRows key={option.recordId}>
              <tr
                className="border-t border-neutral-100 hover:bg-neutral-50 cursor-pointer"
                onClick={() => onToggleOption(option.recordId)}
              >
                <td className="px-1 text-center text-xs text-neutral-500">{optionOpen ? "▾" : "▸"}</td>
                <td className="px-1 pl-4" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={optionSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = optionSome && !optionSelected;
                    }}
                    onChange={(event) => onToggleMany(questions, event.target.checked)}
                  />
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold text-white ${letterColour(option.label)}`}
                  >
                    {option.label}
                  </span>{" "}
                  <span className="font-semibold">{option.name}</span>
                </td>
                <td colSpan={5} className="px-2 py-1 text-xs text-neutral-600">
                  Finish option · quantity not allocated
                </td>
                <td className="px-2 py-1 text-xs text-neutral-600 whitespace-nowrap">
                  {[...new Set(option.questions.map((q) => q.contactName))].join(", ")}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <span className={optionTotal.toQuote > 0 ? "text-red-700 font-semibold" : "text-neutral-400"}>
                    {optionTotal.toQuote}
                  </span>
                  {narrowed && questions.length !== option.questions.length && (
                    <span className="block text-[11px] text-neutral-400">{questions.length} shown</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-neutral-700">{optionTotal.later}</td>
                <td className="px-2 py-1 text-right text-xs text-neutral-500">{option.label}</td>
                <td className="px-2 py-1 text-right">
                  {optionTotal.waiting > 0 ? (
                    <span className="text-[11px] border border-blue-300 bg-blue-50 text-blue-800 rounded-full px-2 py-0.5">
                      {optionTotal.waiting}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
              </tr>
              {optionOpen && questions.length === 0 && (
                <tr>
                  <td />
                  <td />
                  <td colSpan={COLUMNS - 2} className="px-2 py-1 pl-8 text-xs text-neutral-500">
                    Nothing outstanding on this finish option.
                  </td>
                </tr>
              )}
              {optionOpen && <QuestionRows questions={questions} depth={2} selected={selected} onToggle={onToggle} />}
            </FragmentRows>
          );
        })}

      {open && optionsWithNothing > 0 && (
        <tr>
          <td />
          <td />
          <td colSpan={COLUMNS - 2} className="px-2 py-1 text-xs text-neutral-500">
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
  questions,
  depth,
  selected,
  onToggle,
}: {
  questions: TableQuestion[];
  depth: 1 | 2;
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
}) {
  if (questions.length === 0) return null;
  const pad = depth === 2 ? "pl-8" : "pl-4";
  const groups: [string, string, TableQuestion[]][] = [
    [
      "to_quote",
      TIER_LABELS.to_quote,
      questions.filter((q) => q.tier === "to_quote" && q.requirementKind === "spec_field"),
    ],
    ["later", TIER_LABELS.later, questions.filter((q) => q.tier !== "to_quote" && q.requirementKind === "spec_field")],
    ["readiness", "Readiness — internal and commercial", questions.filter((q) => q.requirementKind === "readiness")],
  ];
  return (
    <>
      {groups.map(([id, label, list]) =>
        list.length === 0 ? null : (
          <FragmentRows key={id}>
            <tr>
              <td />
              <td />
              <td
                colSpan={COLUMNS - 2}
                className={`px-2 py-0.5 text-[11px] font-medium ${pad} ${
                  id === "to_quote"
                    ? "text-red-800 bg-red-50"
                    : id === "readiness"
                      ? "text-amber-900 bg-amber-50"
                      : "text-neutral-600 bg-neutral-100"
                }`}
              >
                {label} ({list.length})
              </td>
            </tr>
            {list.map((question) => {
              const k = key(question.recordId, question.requirementId);
              return (
                <tr key={k} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td />
                  <td className={`px-1 ${pad}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => onToggle(question.recordId, question.requirementId)}
                    />
                  </td>
                  <td colSpan={7} className="px-2 py-1">
                    <span className="text-sm text-neutral-900">{question.prompt}</span>
                    {question.fieldLabel && (
                      <span className="block text-[11px] text-neutral-500">BWS: {question.fieldLabel.trim()}</span>
                    )}
                  </td>
                  <td colSpan={4} className="px-2 py-1 text-right whitespace-nowrap">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded border ${
                        question.state === "tbc"
                          ? "text-amber-800 border-amber-300 bg-amber-50"
                          : "text-red-700 border-red-300 bg-red-50"
                      }`}
                    >
                      {ANSWER_STATE_LABELS[question.state as AnswerState]}
                    </span>
                    {question.waiting && (
                      <span
                        className="ml-1.5 text-[11px] px-2 py-0.5 rounded border text-blue-800 border-blue-300 bg-blue-50"
                        title={`Asked ${question.waiting.contactName}${
                          question.waiting.sentAt
                            ? ` on ${new Date(question.waiting.sentAt).toLocaleDateString()}`
                            : ""
                        }`}
                      >
                        Waiting
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </FragmentRows>
        ),
      )}
    </>
  );
}
