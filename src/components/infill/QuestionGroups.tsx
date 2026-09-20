"use client";

// The same outstanding list, turned ninety degrees: one row per QUESTION.
//
// ============================================================================
// "CAN YOU SHOW ME ALL THE JOBS WITH DIMENSIONS MISSING?"
//
// Matthew, 2026-09-18. "Who still owes me a metalwork finish" is a different
// job from "what does this chair still need", and answering it by walking the
// item list is how an afternoon goes. So this is the same loader, the same
// rows and the same edit boxes, grouped by `groupByQuestion` instead of by
// `groupIntoLines` — a tab rather than a screen, because a second screen over
// the same data is a second place for the number to be wrong.
//
// A HEADING IS A QUESTION, NOT A `requirements` ROW. `requirements` is seeded
// per category, so "Dimensions" is seventeen rows; on the 300-line project it
// folds to ONE heading over nine of them carrying 401 items. Grouping by the
// row would print four "Dimensions" headings, and somebody who cleared the
// first would believe they had done dimensions. `questionGroupKey` is where
// that fold lives.
//
// The rows arrive when a heading is opened, for the reason the lines do: the
// whole list is 19,582 rows whichever way it is grouped.
// ============================================================================
import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import AreaSelect from "@/components/ui/AreaSelect";
import InfillRow, { type SaveAnswer, type SaveDimension } from "@/components/infill/InfillRow";
import type { Filters } from "@/components/infill/InfillTable";
import { NO_FILTERS } from "@/components/infill/InfillTable";
import { matchesArea, type AreaOption } from "@/lib/area-filter";
import type { InfillQuestion } from "@/lib/infill";
import type { Palette } from "@/lib/palettes";
import { TIER_LABELS } from "@/lib/tgq";

/** One heading, as the route sends it. */
export type QuestionSummary = {
  key: string;
  /** Every `requirements` row folded into it — what a re-read is scoped by. */
  requirementIds: string[];
  heading: string;
  fieldLabel: string | null;
  toQuote: number;
  rows: number;
  records: number;
  /** The areas it is outstanding in. Null is "no area given". */
  areas: (string | null)[];
};

const COLUMNS = 7;

export default function QuestionGroups({
  questions,
  areas,
  filters,
  onFilters,
  rowsByQuestion,
  loadingQuestion,
  questionError,
  onOpenQuestion,
  onReloadQuestion,
  paletteFor,
  onSaveAnswer,
  onSaveDimension,
}: {
  questions: QuestionSummary[];
  /** Counted in ROWS by the server: how many items sit in each area. */
  areas: AreaOption[];
  filters: Filters;
  onFilters: (next: Filters) => void;
  rowsByQuestion: Record<string, InfillQuestion[]>;
  loadingQuestion: string | null;
  questionError: Record<string, string>;
  onOpenQuestion: (group: QuestionSummary) => void;
  onReloadQuestion: (group: QuestionSummary) => Promise<void>;
  paletteFor: (question: InfillQuestion) => Palette | null;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const text = filters.text.trim().toLowerCase();

  const shown = useMemo(
    () =>
      questions.filter((group) => {
        if (filters.tier === "to_quote" && group.toQuote === 0) return false;
        if (filters.tier === "later" && group.toQuote === group.rows) return false;
        // A HEADING SURVIVES AN AREA FILTER IF ANY OF ITS ITEMS IS IN THAT
        // AREA. The rows inside are filtered too, so a heading that passes and
        // then shows nothing cannot happen.
        if (filters.area && !group.areas.some((area) => matchesArea({ area }, filters.area))) return false;
        if (text && !`${group.heading} ${group.fieldLabel ?? ""}`.toLowerCase().includes(text)) return false;
        return true;
      }),
    [questions, filters, text],
  );

  function toggle(group: QuestionSummary) {
    const wasOpen = open.has(group.key);
    setOpen((prev) => {
      const next = new Set(prev);
      if (wasOpen) next.delete(group.key);
      else next.add(group.key);
      return next;
    });
    // Outside the updater: React runs one during rendering, and a fetch
    // started there sets state on the page mid-render.
    if (!wasOpen && !rowsByQuestion[group.key]) onOpenQuestion(group);
  }

  /** The filters that also apply inside an opened heading. */
  function visible(rows: InfillQuestion[]): InfillQuestion[] {
    return rows.filter((row) => {
      if (filters.tier !== "all" && row.tier !== filters.tier) return false;
      if (filters.state && row.state !== filters.state) return false;
      if (!matchesArea(row, filters.area)) return false;
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
          placeholder="Search a question or a BWS field"
          aria-label="Search the questions"
          className="w-72 max-w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        />
        <AreaSelect options={areas} value={filters.area} onChange={(area) => onFilters({ ...filters, area })} />
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
        {(text || filters.area || filters.tier !== "all" || filters.state) && (
          <Button size="xs" variant="quiet" onClick={() => onFilters(NO_FILTERS)}>
            Clear filters
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-neutral-600">
          {shown.length} of {questions.length} question{questions.length === 1 ? "" : "s"} shown
        </span>
      </div>

      <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
        <Table>
          <thead>
            <tr>
              <Th className="w-6" />
              <Th>Question</Th>
              <Th num className="w-[90px]">Items</Th>
              <Th num className="w-[80px]">{TIER_LABELS.to_quote}</Th>
              <Th className="w-[160px]" />
              <Th className="w-[80px]" />
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
            {shown.map((group) => {
              const isOpen = open.has(group.key);
              const loaded = rowsByQuestion[group.key];
              const rows = loaded ? visible(loaded) : [];
              const hidden = loaded ? loaded.length - rows.length : 0;
              return (
                <GroupRows
                  key={group.key}
                  group={group}
                  open={isOpen}
                  loading={loadingQuestion === group.key}
                  error={questionError[group.key] ?? null}
                  rows={rows}
                  hidden={hidden}
                  onToggle={() => toggle(group)}
                  onReload={() => onReloadQuestion(group)}
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

function GroupRows({
  group,
  open,
  loading,
  error,
  rows,
  hidden,
  onToggle,
  onReload,
  paletteFor,
  onSaveAnswer,
  onSaveDimension,
}: {
  group: QuestionSummary;
  open: boolean;
  loading: boolean;
  error: string | null;
  rows: InfillQuestion[];
  hidden: number;
  onToggle: () => void;
  onReload: () => Promise<void>;
  paletteFor: (question: InfillQuestion) => Palette | null;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
}) {
  return (
    <>
      <Tr className="cursor-pointer" onClick={onToggle}>
        <Td className="px-0 text-center text-neutral-500">{open ? "▾" : "▸"}</Td>
        <Td>
          <span className="font-medium text-neutral-900">{group.heading}</span>
          {/* THE CATEGORIES THAT ASK IT, counted. A heading folding nine
              `requirements` rows is nine cheat sheets asking the same thing,
              and saying so is what stops it reading like a duplicate. */}
          {group.requirementIds.length > 1 && (
            <span className="block text-[11px] text-neutral-500">
              asked by {group.requirementIds.length} categories
            </span>
          )}
        </Td>
        <Td num className="text-neutral-700">{group.records}</Td>
        <Td num>
          <span className={group.toQuote > 0 ? "font-semibold text-red-700" : "text-neutral-400"}>
            {group.toQuote}
          </span>
        </Td>
        <Td>
          {/* A QUESTION CAN BLOCK A QUOTE ON ONE ITEM AND NOT ON ANOTHER —
              levels differ, and Matthew's matrix is per category. The chip says
              so rather than calling the whole heading one or the other. */}
          {group.toQuote > 0 && group.toQuote < group.rows && (
            <Chip tone="warn">{TIER_LABELS.to_quote} on {group.toQuote} of {group.rows}</Chip>
          )}
        </Td>
        <Td />
        <Td />
      </Tr>

      {open && loading && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-2 pl-10 text-xs text-neutral-500">
            Reading the items that still owe this…
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
        rows.map((row) => (
          <InfillRow
            key={`${row.recordId}:${row.requirementId}`}
            question={row}
            palette={paletteFor(row)}
            columns={COLUMNS}
            pad="pl-10"
            heading="record"
            onSaveAnswer={onSaveAnswer}
            onSaveDimension={onSaveDimension}
            onReload={onReload}
          />
        ))}

      {open && hidden > 0 && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 px-4 py-1.5 pl-10 text-xs text-neutral-500">
            {hidden} more item{hidden === 1 ? " owes" : "s owe"} this, hidden by your filters — the counts above are
            the question&rsquo;s own.
          </td>
        </tr>
      )}
    </>
  );
}
