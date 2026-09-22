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
//
// ---- ONE VALUE, APPLIED TO THE ITEMS THAT ARE TICKED ----------------------
//
// Max, 2026-09-22, looking at `Access - Select option` opened to 28 identical
// rows: *"we need basically an apply-to-all box … even better a tick box with
// an option to select all, but then you can untick some. This screen doesn't
// really make sense if they have to go through every single one."*
//
// Four things about the bar are traps rather than preferences.
//
//  - **"ALL" IS THE ROWS ON SCREEN, AND THE BAR SAYS WHICH NUMBER THAT IS.**
//    A row only exists in the browser once its heading is OPENED, and the
//    area, state and tier filters then narrow what is listed inside it — so
//    "all" is ambiguous between loaded, visible and counted before anybody
//    builds this. It is the VISIBLE rows: what select-all ticks is exactly
//    what is drawn under it, every tick is on screen to be taken off again,
//    and the bar prints "n of the m items shown here". A filter narrows what
//    is LISTED, never what is written — reaching the rows it hides would
//    break that rule in the most expensive direction there is.
//
//  - **A DIMENSION HEADING GETS NO TICKS AT ALL.** `rowKind` reads
//    `jsonId === 3` and the row writes an ATTRIBUTE, because the composed
//    Dimensions cell is a projection of the record's own measurements. One
//    width applied to 28 items is the case where apply-to-all is certainly
//    wrong, so the heading says so instead of offering the control.
//
//  - **A SETTLED ANSWER CANNOT BE TICKED.** The route skips it and names it;
//    the row says so rather than offering a tick that will be refused.
//
//  - **THE SELECTION IS PER HEADING AND SURVIVES A FILTER CHANGE.** Untick two
//    of 28, then narrow by area, and the two stay unticked — the bar counts
//    only what is visible, so what it promises is always what is drawn.
// ============================================================================
import { useCallback, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import AreaSelect from "@/components/ui/AreaSelect";
import AnswerValue from "@/components/records/AnswerValue";
import InfillRow, { type SaveAnswer, type SaveDimension } from "@/components/infill/InfillRow";
import type { Filters } from "@/components/infill/InfillTable";
import { NO_FILTERS } from "@/components/infill/InfillTable";
import { matchesArea, type AreaOption } from "@/lib/area-filter";
import { rowKind, type InfillQuestion } from "@/lib/infill";
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

/** What one press of the bar came back with. */
export type ApplyOutcome = { ok: true; message: string } | { ok: false; error: string };

export type ApplyToRows = (
  rows: InfillQuestion[],
  input: { value: string | null; state: "confirmed" | "tbc" },
) => Promise<ApplyOutcome>;

const COLUMNS = 8;

/** A row's identity on screen — the pair every patch and every tick keys on. */
function rowKey(row: InfillQuestion): string {
  return `${row.recordId}:${row.requirementId}`;
}

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
  onApply,
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
  /**
   * One value onto several items.
   *
   * REQUIRED, because the tick column is part of this view's table and a
   * column that sometimes exists is a header and a body that disagree about
   * how many cells a row has.
   */
  onApply: ApplyToRows;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** Per heading, the rows a person has ticked. Never a global selection. */
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

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

  const setTicks = useCallback((key: string, fn: (prev: Set<string>) => Set<string>) => {
    setSelected((prev) => ({ ...prev, [key]: fn(prev[key] ?? new Set<string>()) }));
  }, []);

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
              <Th className="w-8" />
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
                  ticked={selected[group.key] ?? EMPTY}
                  onTick={(key, on) =>
                    setTicks(group.key, (prev) => {
                      const next = new Set(prev);
                      if (on) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                  onTickAll={(keys, on) =>
                    setTicks(group.key, (prev) => {
                      const next = new Set(prev);
                      for (const key of keys) {
                        if (on) next.add(key);
                        else next.delete(key);
                      }
                      return next;
                    })
                  }
                  onToggle={() => toggle(group)}
                  onReload={() => onReloadQuestion(group)}
                  paletteFor={paletteFor}
                  onSaveAnswer={onSaveAnswer}
                  onSaveDimension={onSaveDimension}
                  onApply={onApply}
                />
              );
            })}
          </tbody>
        </Table>
      </div>
    </>
  );
}

const EMPTY: ReadonlySet<string> = new Set<string>();

/** Why a row cannot join a batch, or null where it can. */
function blockedReason(row: InfillQuestion, kind: ReturnType<typeof rowKind>): string | null {
  if (kind === "dimension") return "a dimension is recorded per item, not in a batch";
  if (row.answerId === null || row.answerVersion === null) return "there is no checklist row to write to yet";
  if (row.state === "confirmed") return "already answered — change that one on its own";
  return null;
}

function GroupRows({
  group,
  open,
  loading,
  error,
  rows,
  hidden,
  ticked,
  onTick,
  onTickAll,
  onToggle,
  onReload,
  paletteFor,
  onSaveAnswer,
  onSaveDimension,
  onApply,
}: {
  group: QuestionSummary;
  open: boolean;
  loading: boolean;
  error: string | null;
  rows: InfillQuestion[];
  hidden: number;
  ticked: ReadonlySet<string>;
  onTick: (key: string, on: boolean) => void;
  onTickAll: (keys: string[], on: boolean) => void;
  onToggle: () => void;
  onReload: () => Promise<void>;
  paletteFor: (question: InfillQuestion) => Palette | null;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
  onApply: ApplyToRows;
}) {
  // THE WHOLE HEADING IS ONE BWS FIELD, so one row decides whether it is a
  // dimension — and a heading with nothing loaded yet offers no bar at all.
  const isDimension = rows.length > 0 && rowKind(rows[0]!, paletteFor(rows[0]!)) === "dimension";

  const selectable = rows.filter((row) => blockedReason(row, rowKind(row, paletteFor(row))) === null);
  const selectableKeys = selectable.map(rowKey);
  const chosen = selectable.filter((row) => ticked.has(rowKey(row)));

  return (
    <>
      <Tr className="cursor-pointer" onClick={onToggle}>
        <Td className="px-0" />
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

      {/* A PANEL THAT SPANS THE ROW IS ITS OWN `<tr>`, never an extra colSpan
          cell beside the data cells — the drawings card's rule. */}
      {open && isDimension && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-slate-50 px-4 py-2 pl-10 text-xs text-slate-600">
            Dimensions are recorded one item at a time. The cell is built from each item&rsquo;s own measurements, so
            there is no one figure to apply to all of them.
          </td>
        </tr>
      )}

      {open && !isDimension && rows.length > 0 && (
        <ApplyBar
          group={group}
          shownCount={rows.length}
          selectableKeys={selectableKeys}
          chosen={chosen}
          allTicked={selectableKeys.length > 0 && selectableKeys.every((key) => ticked.has(key))}
          palette={paletteFor(rows[0]!)}
          hidden={hidden}
          onTickAll={onTickAll}
          onApply={onApply}
          onReload={onReload}
        />
      )}

      {open &&
        rows.map((row) => {
          const why = blockedReason(row, rowKind(row, paletteFor(row)));
          return (
            <InfillRow
              key={rowKey(row)}
              question={row}
              palette={paletteFor(row)}
              columns={COLUMNS}
              pad="pl-10"
              heading="record"
              selection={{
                checked: ticked.has(rowKey(row)),
                onChange: (on) => onTick(rowKey(row), on),
                why,
                label: `Include ${row.recordLabel}`,
              }}
              onSaveAnswer={onSaveAnswer}
              onSaveDimension={onSaveDimension}
              onReload={onReload}
            />
          );
        })}

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

/**
 * Select all, one value, one press.
 *
 * It is its OWN `<tr>` for the reason every spanning panel in this app is: a
 * row carrying both data cells and a `colSpan` panel is twice as many column
 * slots wide, and the browser finds room for the panel BESIDE the data.
 */
function ApplyBar({
  group,
  shownCount,
  selectableKeys,
  chosen,
  allTicked,
  palette,
  hidden,
  onTickAll,
  onApply,
  onReload,
}: {
  group: QuestionSummary;
  shownCount: number;
  selectableKeys: string[];
  chosen: InfillQuestion[];
  allTicked: boolean;
  palette: Palette | null;
  hidden: number;
  onTickAll: (keys: string[], on: boolean) => void;
  onApply: ApplyToRows;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * THE VALUE AS AT THE CLICK, NOT AS AT THE LAST RENDER.
   *
   * `AnswerValue` commits a typed value on BLUR, and clicking the button is
   * what blurs the box — so the handler's closure can still hold the previous
   * draft. The ref is written in the same commit, so the press always records
   * what is in the box.
   */
  const latest = useRef("");

  async function run(state: "confirmed" | "tbc") {
    const value = latest.current.trim();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const outcome = await onApply(chosen, { value: value || null, state });
      if (outcome.ok) {
        setDone(outcome.message);
        // Every written row is now `confirmed` and cannot be batched again, so
        // the ticks that produced it are spent.
        onTickAll(chosen.map(rowKey), false);
      } else {
        // A refusal means the screen is out of date — reload the heading first,
        // then say what happened, or the reload clears the message.
        await onReload();
        setError(outcome.error);
      }
    } finally {
      // Always, so a response that is not JSON cannot leave the bar disabled.
      setBusy(false);
    }
  }

  const count = chosen.length;

  return (
    <tr>
      <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-blue-50/50 px-4 py-2 pl-10 align-top">
        <div className="flex flex-wrap items-start gap-3">
          <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-800">
            <input
              type="checkbox"
              checked={allTicked}
              disabled={busy || selectableKeys.length === 0}
              aria-label={`Select every item shown under ${group.heading}`}
              onChange={(event) => onTickAll(selectableKeys, event.target.checked)}
              className="h-3.5 w-3.5 accent-blue-700"
            />
            Select all shown
          </label>
          <div className="w-64 max-w-full">
            <AnswerValue
              palette={palette}
              value={draft || null}
              disabled={busy}
              inputKey={`${group.key}:bulk`}
              onCommit={(next) => {
                latest.current = next;
                setDraft(next);
              }}
            />
          </div>
          <Button
            size="xs"
            variant="primary"
            disabled={busy || count === 0}
            onClick={() => void run("confirmed")}
          >
            {busy ? "Recording…" : `Record on ${count} item${count === 1 ? "" : "s"}`}
          </Button>
          <Button size="xs" variant="quiet" disabled={busy || count === 0} onClick={() => void run("tbc")}>
            TBC on {count}
          </Button>
        </div>

        {/* WHICH NUMBER "ALL" IS, in words. The rows on screen — not the
            heading's own count, and not everything that owes the question. */}
        <p className="mt-1 text-[11px] text-neutral-600">
          {count} of the {shownCount} item{shownCount === 1 ? "" : "s"} shown here {count === 1 ? "is" : "are"} ticked
          {selectableKeys.length < shownCount && (
            <> · {shownCount - selectableKeys.length} cannot be included and say why on the row</>
          )}
          {hidden > 0 && (
            <>
              {" "}
              · {hidden} more owe this question and {hidden === 1 ? "is" : "are"} hidden by your filters — a filter
              never changes what is written
            </>
          )}
        </p>
        {done && <p className="mt-1 text-xs text-green-700">{done}</p>}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </td>
    </tr>
  );
}
