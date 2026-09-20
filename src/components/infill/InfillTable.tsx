"use client";

// What is outstanding, as one row per FURNITURE LINE, with an edit box inside.
//
// ============================================================================
// THE CHASE SCREEN'S LIST. THE SAME RULES, AND THEY ARE NOT PREFERENCES.
//
//   * A LINE IS COLLAPSED, and its questions are inside it. A flat list of
//     outstanding questions is 19,582 rows on the 300-line project and 823 on
//     the pilot; twenty questions about one headboard read as twenty separate
//     problems.
//
//   * A LINE'S TWO COUNTS ARE ITS OWN, whatever the filters say. "n shown"
//     appears beside them and never rewrites them, or somebody narrows the
//     screen until an item looks finished.
//
//   * A FILTER NARROWS WHAT IS LISTED, NEVER WHAT IS RECORDED. Nothing on this
//     screen is a selection, so there is no ticked-but-hidden case to report —
//     but hiding a question does not answer it, and the footer says how many
//     lines are hidden.
//
//   * `optionCount` IS THE TRUE NUMBER OF FINISH OPTIONS, including any with
//     nothing outstanding. "2 finish options" beside one visible option is a
//     question about the data; "1" would be a claim that B does not exist.
//
//   * A QUANTITY IS NEVER APPORTIONED. The bill says 45 and never says how
//     many are fabric A.
//
// ---- A LINE'S QUESTIONS ARRIVE WHEN IT IS OPENED --------------------------
//
// Measured, not assumed (`npm run measure:outstanding`, sandbox, 2026-09-20):
// the whole outstanding list for the 300-line project is 18,976 KB of JSON.
// The summary is what the server sends; opening a line re-reads that line's
// questions through the same loader, scoped. The line says when it is loading
// and says so in words if the read fails.
//
// ---- AND NO `overflow-hidden` ON THE WRAPPER ------------------------------
//
// It would make the wrapper the sticky scroll container, and the column header
// would then offset down from the top of the table and cover a furniture line
// — a row nobody would know to look for.
// ============================================================================
import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { letterColour } from "@/components/records/letter-colours";
import InfillRow, { type SaveAnswer, type SaveDimension } from "@/components/infill/InfillRow";
import type { InfillLineSummary, InfillQuestion } from "@/lib/infill";
import type { Palette } from "@/lib/palettes";
import { ITEM_LEVEL_LABELS, type ItemLevel } from "@/lib/spec-vocab";
import { TIER_LABELS, type QuestionTier } from "@/lib/tgq";

/** The columns, once, so a spanning row cannot drift out of step with the head. */
const COLUMNS = 7;

export type Filters = {
  text: string;
  runId: string;
  tier: "all" | QuestionTier;
  state: "" | "missing" | "tbc";
};

export const NO_FILTERS: Filters = { text: "", runId: "", tier: "all", state: "" };

export default function InfillTable({
  lines,
  phases,
  filters,
  onFilters,
  questionsByLine,
  loadingLine,
  lineError,
  onOpenLine,
  onReloadLine,
  paletteFor,
  onSaveAnswer,
  onSaveDimension,
  answered,
}: {
  lines: InfillLineSummary[];
  phases: { id: string; name: string }[];
  filters: Filters;
  onFilters: (next: Filters) => void;
  /** A line's questions, once it has been opened. */
  questionsByLine: Record<string, InfillQuestion[]>;
  loadingLine: string | null;
  lineError: Record<string, string>;
  onOpenLine: (lineId: string) => void;
  onReloadLine: (lineId: string) => Promise<void>;
  paletteFor: (question: InfillQuestion) => Palette | null;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
  /** How many gaps have been filled on each line in this sitting. */
  answered: Record<string, number>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const text = filters.text.trim().toLowerCase();
  const narrowed = Boolean(text) || filters.tier !== "all" || filters.state !== "";

  const shown = useMemo(() => {
    return lines.filter((line) => {
      if (filters.runId && line.runId !== filters.runId) return false;
      // The tier and state filters read the line's own counts, because a line
      // arrives without its questions. A line with nothing in the half being
      // filtered for is not hidden work — it has none.
      if (filters.tier === "to_quote" && line.counts.toQuote === 0) return false;
      if (filters.tier === "later" && line.counts.later === 0) return false;
      if (filters.state === "missing" && line.states.missing === 0) return false;
      if (filters.state === "tbc" && line.states.tbc === 0) return false;
      if (
        text &&
        !`${line.code} ${line.itemDescription} ${line.recordLabel} ${line.area ?? ""}`.toLowerCase().includes(text)
      ) {
        return false;
      }
      return true;
    });
  }, [lines, filters, text]);

  function toggle(lineId: string) {
    const wasOpen = open.has(lineId);
    setOpen((prev) => {
      const next = new Set(prev);
      if (wasOpen) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
    // OUTSIDE the state updater. React runs an updater during rendering, and
    // a fetch started in there sets state on the PAGE mid-render — "cannot
    // update a component while rendering a different component", which in this
    // app renders as a line that quietly never loads.
    //
    // Fetched once and kept, so collapsing and re-opening a line during a
    // meeting is free. A save reloads the line deliberately.
    if (!wasOpen && !questionsByLine[lineId]) onOpenLine(lineId);
  }

  /** The filters that also apply INSIDE an open line. */
  function visible(questions: InfillQuestion[], lineMatched: boolean): InfillQuestion[] {
    return questions.filter((question) => {
      if (filters.tier !== "all" && question.tier !== filters.tier) return false;
      if (filters.state && question.state !== filters.state) return false;
      if (text && !lineMatched && !`${question.prompt} ${question.fieldLabel ?? ""}`.toLowerCase().includes(text)) {
        return false;
      }
      return true;
    });
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.text}
          onChange={(event) => onFilters({ ...filters, text: event.target.value })}
          placeholder="Search a code, an item, an area or a question"
          aria-label="Search what is outstanding"
          className="w-72 max-w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        />
        <select
          value={filters.runId}
          onChange={(event) => onFilters({ ...filters, runId: event.target.value })}
          aria-label="Filter by phase"
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All phases</option>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
        <select
          value={filters.tier}
          onChange={(event) => onFilters({ ...filters, tier: event.target.value as Filters["tier"] })}
          aria-label="Filter by what blocks a quote"
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="all">Everything outstanding</option>
          <option value="to_quote">{TIER_LABELS.to_quote} only</option>
          <option value="later">{TIER_LABELS.later} only</option>
        </select>
        <select
          value={filters.state}
          onChange={(event) => onFilters({ ...filters, state: event.target.value as Filters["state"] })}
          aria-label="Filter by answer state"
          className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Missing and TBC</option>
          <option value="missing">Missing only</option>
          <option value="tbc">TBC only</option>
        </select>
        {narrowed && (
          <Button size="xs" variant="quiet" onClick={() => onFilters({ ...NO_FILTERS, runId: filters.runId })}>
            Clear filters
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-neutral-600">
          {shown.length} of {lines.length} item{lines.length === 1 ? "" : "s"} shown
        </span>
      </div>

      <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
        <Table>
          <thead>
            <tr>
              <Th className="w-6" />
              <Th>Item</Th>
              <Th num className="w-[70px]">Qty</Th>
              <Th className="w-[110px]">Level</Th>
              <Th num className="w-[80px]">{TIER_LABELS.to_quote}</Th>
              <Th num className="w-[80px]">Also</Th>
              <Th className="w-[80px]" />
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
            {shown.map((line) => {
              const isOpen = open.has(line.lineId);
              const loaded = questionsByLine[line.lineId];
              const lineMatched =
                !text || `${line.code} ${line.itemDescription} ${line.recordLabel}`.toLowerCase().includes(text);
              const all = loaded ?? [];
              const shownQuestions = visible(all, lineMatched);
              const own = shownQuestions.filter((question) => question.variantLabel === null);
              const options = line.options.map((option) => ({
                option,
                questions: shownQuestions.filter((question) => question.recordId === option.recordId),
              }));
              const filled = answered[line.lineId] ?? 0;

              return (
                <LineRows
                  key={line.lineId}
                  line={line}
                  open={isOpen}
                  loading={loadingLine === line.lineId}
                  error={lineError[line.lineId] ?? null}
                  own={own}
                  options={options}
                  hiddenByFilters={narrowed && loaded ? all.length - shownQuestions.length : 0}
                  answered={filled}
                  onToggle={() => toggle(line.lineId)}
                  onReload={() => onReloadLine(line.lineId)}
                  paletteFor={paletteFor}
                  onSaveAnswer={onSaveAnswer}
                  onSaveDimension={onSaveDimension}
                />
              );
            })}
          </tbody>
        </Table>
      </div>
    </>
  );
}

function LineRows({
  line,
  open,
  loading,
  error,
  own,
  options,
  hiddenByFilters,
  answered,
  onToggle,
  onReload,
  paletteFor,
  onSaveAnswer,
  onSaveDimension,
}: {
  line: InfillLineSummary;
  open: boolean;
  loading: boolean;
  error: string | null;
  own: InfillQuestion[];
  options: { option: InfillLineSummary["options"][number]; questions: InfillQuestion[] }[];
  hiddenByFilters: number;
  answered: number;
  onToggle: () => void;
  onReload: () => Promise<void>;
  paletteFor: (question: InfillQuestion) => Palette | null;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
}) {
  const optionsWithNothing = line.optionCount - line.options.filter((option) => option.counts.toQuote + option.counts.later > 0).length;

  return (
    <>
      <Tr className="cursor-pointer" onClick={onToggle}>
        <Td className="px-0 text-center text-neutral-500">{open ? "▾" : "▸"}</Td>
        <Td>
          {/* NOT PREFETCHED. Next prefetches every `<Link>` in the viewport,
              and 407 lines carry three record links each — a request per link
              to draw a list nobody has clicked. Seen on DEMO-300 on the
              production build, 2026-09-20, as a wall of aborted `_rsc` fetches;
              with this it is 32 on a plain load. */}
          <Link
            href={`/dashboard/records/${line.lineId}`}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            onClick={(event) => event.stopPropagation()}
            className="font-mono font-semibold text-blue-700 no-underline hover:underline"
          >
            {line.code || "—"}
          </Link>{" "}
          <span className="text-neutral-900">{line.itemDescription}</span>
          <span className="text-neutral-500">
            {" "}· {line.runName} · {line.recordLabel}
            {line.area && <> · {line.area}</>}
          </span>
          {line.optionCount > 0 && (
            <span className="block text-[11.5px] text-neutral-500">
              {line.optionCount} finish option{line.optionCount === 1 ? "" : "s"}
              {optionsWithNothing > 0 && (
                <> · {optionsWithNothing} {optionsWithNothing === 1 ? "has" : "have"} nothing outstanding</>
              )}
            </span>
          )}
          {answered > 0 && (
            /* WHAT YOU RECORDED HERE, IN THIS SITTING. A filled gap leaves the
               outstanding list, so without this the only evidence of the work
               would be rows quietly disappearing on the next reload. */
            <span className="block text-[11.5px] text-green-700">
              {answered} recorded here just now
            </span>
          )}
        </Td>
        <Td num className="text-neutral-600">{line.qty ?? "—"}</Td>
        <Td onClick={(event) => event.stopPropagation()}>
          {line.level ? (
            <Chip>{ITEM_LEVEL_LABELS[line.level as ItemLevel] ?? line.level}</Chip>
          ) : (
            /* A LINK, because it goes somewhere: a level is a decision taken on
               the record, beside the category that creates the questions. New
               tab, so a half-finished meeting survives it. */
            <Link
              href={`/dashboard/records/${line.lineId}`}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] text-amber-800 no-underline hover:underline"
            >
              Set level
            </Link>
          )}
        </Td>
        <Td num>
          <span className={line.counts.toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>
            {line.counts.toQuote}
          </span>
        </Td>
        <Td num className={line.counts.later > 0 ? "text-neutral-600" : "text-neutral-400"}>
          {line.counts.later}
        </Td>
        <Td className="text-right">
          <Link
            href={`/dashboard/records/${line.lineId}`}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center rounded border border-transparent px-2 py-1 text-xs text-neutral-600 no-underline hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
          >
            Open
          </Link>
        </Td>
      </Tr>

      {open && loading && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-2 pl-10 text-xs text-neutral-500">
            Reading what is outstanding on this item…
          </td>
        </tr>
      )}
      {open && error && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-red-50/60 px-4 py-2 pl-10 text-xs text-red-800">
            {error}{" "}
            <Button size="xs" variant="quiet" onClick={() => void onReload()}>
              Try again
            </Button>
          </td>
        </tr>
      )}

      {open &&
        own.map((question) => (
          <InfillRow
            key={`${question.recordId}:${question.requirementId}`}
            question={question}
            palette={paletteFor(question)}
            columns={COLUMNS}
            pad="pl-10"
            onSaveAnswer={onSaveAnswer}
            onSaveDimension={onSaveDimension}
            onReload={onReload}
          />
        ))}

      {open &&
        options.map(({ option, questions }) => (
          <FragmentRows key={option.recordId}>
            <tr className="bg-[#fcfcfc]">
              <Td className="px-0" />
              <Td colSpan={3}>
                {/* The letter is coloured the way the drawings review colours
                    it — A is always sky — so a chip on a card and a row here
                    are the same configuration at a glance. */}
                <span className="pl-4 font-mono font-semibold" title={option.name}>
                  {option.name.slice(0, option.name.length - option.label.length)}
                  <b className={letterColour(option.label)}>{option.label}</b>
                </span>
                {/* The bill says 45 and never says how many are fabric A. */}
                <span className="text-neutral-500"> · quantity not allocated</span>
              </Td>
              <Td num>
                <span className={option.counts.toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>
                  {option.counts.toQuote}
                </span>
              </Td>
              <Td num className={option.counts.later > 0 ? "text-neutral-600" : "text-neutral-400"}>
                {option.counts.later}
              </Td>
              <Td />
            </tr>
            {questions.map((question) => (
              <InfillRow
                key={`${question.recordId}:${question.requirementId}`}
                question={question}
                palette={paletteFor(question)}
                columns={COLUMNS}
                pad="pl-14"
                onSaveAnswer={onSaveAnswer}
                onSaveDimension={onSaveDimension}
                onReload={onReload}
              />
            ))}
          </FragmentRows>
        ))}

      {open && hiddenByFilters > 0 && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-1.5 pl-10 text-xs text-neutral-500">
            {hiddenByFilters} more on this item, hidden by your filters — the counts above are the item&rsquo;s own.
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
