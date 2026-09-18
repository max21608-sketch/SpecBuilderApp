"use client";

// The project's trail, and the comparison between any two points in it.
//
// Two questions, one screen, because they are the same question at different
// resolutions: "what has happened here" and "what is different between the
// version we issued and the one we hold now".
//
// ============================================================================
// A VERSION IS NOT A CHANGE, AND THE TRAIL HAS TO SHOW IT.
//
// Asked for on 2026-09-18: "I want to make it quite clear when a version has
// been created… there need to be quite distinctive differences between just a
// normal change and a version change." Everything here rendered identically, so
// a named point — the thing you compare against, and the only row anybody reads
// deliberately — was a line of grey text among forty.
//
// A BASELINE is a green bar straight across the list. A KEY DATE is a violet
// bar in the same list, because the programme reads against the work rather
// than only in a field at the top. An ordinary change is a row: what kind it
// was, what it touched, why, and who. Scrolling then answers the one question
// anybody asks of a trail — which changes fall inside Rev A and which came
// after — by looking.
//
// The key date is a `YYYY-MM-DD` STRING and is compared as one. A component
// taking a `Date` here is where the TOE-dates trap comes back.
//
// THE THREE CONTROLS ARE THE CARD'S, not this component's. `Name this point`,
// `Compare two points` and `All n` live in the heading of the card that holds
// the trail, which is where the mock-up puts them — so they are optional
// controlled props, and this still works standalone with its own state when
// nobody passes them.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import DiffTable from "@/components/history/DiffTable";
import type { ProjectChange } from "@/lib/change-history";
import type { ProjectComparison, RecordComparison } from "@/lib/baselines";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Pill from "@/components/ui/Pill";
import { SPECS_AGREED_LABEL, daysUntilSpecsAgreed, todayLocal } from "@/lib/project-programme";
import { formatDay } from "@/lib/format-day";

type Payload = { changes: ProjectChange[] };

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How much of the trail is shown before somebody asks for the rest. A seeded
 *  run writes one change per record, so the newest few are the whole of what
 *  anybody reads and the other eighty push the comparison controls — and every
 *  other card on the page — off the screen. The count is always stated, so a
 *  collapsed list never implies the trail is shorter than it is. */
const RECENT_CHANGES = 5;

/** Days from today to a `YYYY-MM-DD` day, compared as strings by the shared helper. */
function daysUntil(day: string): number {
  return daysUntilSpecsAgreed(day, todayLocal()) ?? 0;
}

function describeDays(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} ago — anything outstanding is overdue`;
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"} away`;
}

const CHANGE_CLASS: Record<RecordComparison["change"], string> = {
  added: "text-green-700 bg-green-50 border-green-200",
  removed: "text-red-700 bg-red-50 border-red-200",
  changed: "text-amber-800 bg-amber-50 border-amber-200",
  unchanged: "text-neutral-500 bg-neutral-50 border-neutral-200",
};

export type ProjectHistoryControls = {
  /** How many entries the trail holds, so the card's heading can say "All n". */
  onLoaded?: (count: number) => void;
  naming?: boolean;
  onNamingChange?: (open: boolean) => void;
  comparing?: boolean;
  onComparingChange?: (open: boolean) => void;
  showAll?: boolean;
  onShowAllChange?: (open: boolean) => void;
};

export default function ProjectHistory({
  projectId,
  runId,
  specsAgreedBy,
  toQuote,
  onLoaded,
  naming,
  onNamingChange,
  comparing: comparingOpen,
  onComparingChange,
  showAll,
  onShowAllChange,
}: ProjectHistoryControls & {
  projectId: string;
  runId?: string | null;
  /**
   * The project's specs-agreed-by date, as a `YYYY-MM-DD` STRING.
   *
   * A string, never a Date: `projects.specs_agreed_by` is a `date` column and
   * both drivers parse one into local midnight, which `toISOString()` then
   * renders as the day before in British Summer Time. The whole TOE-dates rule
   * (CLAUDE.md) is that these are calendar days compared as strings, and a
   * component that took a Date here would be the place that quietly broke it.
   */
  specsAgreedBy?: string | null;
  /** What is still blocking a quote, for the key-date bar. Absent prints nothing. */
  toQuote?: number | null;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [comparison, setComparison] = useState<ProjectComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [baselineLabel, setBaselineLabel] = useState("");
  const [baselineReason, setBaselineReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Uncontrolled fallbacks, so this component is still usable on its own.
  const [ownNaming, setOwnNaming] = useState(false);
  const [ownComparePanel, setOwnComparePanel] = useState(false);
  const [ownShowAll, setOwnShowAll] = useState(false);
  const namingPoint = naming ?? ownNaming;
  const setNamingPoint = (value: boolean) => (onNamingChange ? onNamingChange(value) : setOwnNaming(value));
  const comparePanel = comparingOpen ?? ownComparePanel;
  const setComparePanel = (value: boolean) =>
    onComparingChange ? onComparingChange(value) : setOwnComparePanel(value);
  const showAllChanges = showAll ?? ownShowAll;
  const setShowAllChanges = (value: boolean) => (onShowAllChange ? onShowAllChange(value) : setOwnShowAll(value));

  // In a ref, so a caller passing a lambda does not re-run the load.
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;

  const load = useCallback(async () => {
    const query = runId ? `?runId=${runId}` : "";
    const res = await apiFetch<Payload>(`/api/projects/${projectId}/history${query}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
    loadedRef.current?.(res.data.changes.length);
  }, [projectId, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function compare() {
    if (!from || !to) return;
    setComparing(true);
    setComparison(null);
    try {
      const res = await apiFetch<ProjectComparison>(`/api/projects/${projectId}/compare?from=${from}&to=${to}`);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setComparison(res.data);
    } finally {
      setComparing(false);
    }
  }

  async function takeBaseline() {
    if (!baselineLabel.trim() || !baselineReason.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/baselines`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: baselineLabel.trim(), reason: baselineReason.trim() }),
      });
      await load();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setBaselineLabel("");
      setBaselineReason("");
      setNamingPoint(false);
    } finally {
      setBusy(false);
    }
  }

  /** Compare a named point against everything since, in one press. */
  function compareToNow(changeId: string) {
    const newest = data?.changes[0];
    if (!newest) return;
    setFrom(changeId);
    setTo(newest.id);
    setComparePanel(true);
  }

  if (error && !data) return <p className="p-4 text-sm text-red-700">{error}</p>;
  if (!data) return <div className="p-4"><Spinner label="Loading history" /></div>;

  const { changes } = data;
  const baselines = changes.filter((change) => change.kind === "baseline");
  const visible = comparison?.records.filter((record) => showUnchanged || record.change !== "unchanged") ?? [];
  const visibleChanges = showAllChanges ? changes : changes.slice(0, RECENT_CHANGES);
  const hiddenChanges = changes.length - visibleChanges.length;
  const overdue = specsAgreedBy ? daysUntil(specsAgreedBy) < 0 : false;

  return (
    <div>
      {error && <p className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Naming a point. A baseline writes down the exact version of every
          record, so a comparison against it later is two exact sets. */}
      {namingPoint && (
        <div className="border-b border-neutral-200 px-4 py-3 text-sm">
          <p className="font-medium text-neutral-900">Name this point</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Records what every item holds right now, so you can compare against it later.
          </p>
          <input
            value={baselineLabel}
            autoFocus
            onChange={(event) => setBaselineLabel(event.target.value)}
            placeholder="Issued to client, 16 Sep"
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1"
          />
          <input
            value={baselineReason}
            onChange={(event) => setBaselineReason(event.target.value)}
            placeholder="What was issued, and to whom"
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void takeBaseline()}
              disabled={!baselineLabel.trim() || !baselineReason.trim() || busy}
            >
              {busy ? "Saving…" : "Save this point"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setNamingPoint(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {comparePanel && changes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5 text-sm">
          <span className="text-neutral-500">Compare</span>
          <select
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="max-w-[16rem] rounded border border-neutral-300 px-2 py-1"
          >
            <option value="">from…</option>
            {/* Baselines first: they are what somebody means by "the version we
                issued", and picking one out of a list of every edit is not a
                thing anybody would do twice. */}
            {baselines.length > 0 && (
              <optgroup label="Baselines">
                {baselines.map((change) => (
                  <option key={change.id} value={change.id}>{change.label}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Changes">
              {changes.map((change) => (
                <option key={change.id} value={change.id}>
                  {when(change.createdAt)} · {change.kindLabel}
                </option>
              ))}
            </optgroup>
          </select>
          <select
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="max-w-[16rem] rounded border border-neutral-300 px-2 py-1"
          >
            <option value="">to…</option>
            {baselines.length > 0 && (
              <optgroup label="Baselines">
                {baselines.map((change) => (
                  <option key={change.id} value={change.id}>{change.label}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Changes">
              {changes.map((change) => (
                <option key={change.id} value={change.id}>
                  {when(change.createdAt)} · {change.kindLabel}
                </option>
              ))}
            </optgroup>
          </select>
          <Button size="sm" onClick={() => void compare()} disabled={!from || !to || comparing}>
            {comparing ? "Comparing…" : "Show"}
          </Button>
          {comparison && (
            <Button size="sm" variant="quiet" onClick={() => setComparison(null)}>
              clear
            </Button>
          )}
        </div>
      )}

      {comparison && (
        <div className="border-b border-neutral-200 px-4 py-3">
          <p className="text-sm font-medium text-neutral-900">
            {comparison.from.label ?? when(comparison.from.createdAt)} → {comparison.to.label ?? when(comparison.to.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-600">
            {comparison.counts.changed} changed · {comparison.counts.added} added · {comparison.counts.removed} removed ·{" "}
            {comparison.counts.unchanged} unchanged
          </p>
          {/* Removed records are named rather than merely counted: an export
              omits them, but a BWS job already created from one is not deleted
              by omission, so somebody has to act on it there. */}
          {comparison.counts.removed > 0 && (
            <p className="mt-1 text-xs text-red-700">
              Records removed here are gone from the export. A BWS job already created from one is not deleted by its
              absence — check those by hand.
            </p>
          )}
          {comparison.counts.unchanged > 0 && (
            <Button size="xs" variant="quiet" className="mt-1" onClick={() => setShowUnchanged((value) => !value)}>
              {showUnchanged ? "Hide" : "Show"} the {comparison.counts.unchanged} unchanged
            </Button>
          )}

          <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
            {visible.map((record) => (
              <li key={record.recordId} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenRecord(openRecord === record.recordId ? null : record.recordId)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left text-sm"
                  disabled={!record.diff}
                >
                  <span className="font-mono text-neutral-900">{record.label}</span>
                  <span className="text-neutral-700">{record.itemDescription}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-xs ${CHANGE_CLASS[record.change]}`}>{record.change}</span>
                  {record.fromVersion !== null && record.toVersion !== null && record.fromVersion !== record.toVersion && (
                    <span className="text-xs text-neutral-400">v{record.fromVersion} → v{record.toVersion}</span>
                  )}
                  <Link
                    href={`/dashboard/records/${record.recordId}`}
                    className="ml-auto text-xs text-neutral-500 underline hover:text-neutral-900"
                  >
                    open
                  </Link>
                </button>
                {record.unreadable && <p className="mt-1 text-xs text-amber-700">{record.unreadable}</p>}
                {openRecord === record.recordId && record.diff && <DiffTable diff={record.diff} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* THE PROGRAMME BELONGS IN THE TRAIL, NOT ONLY IN A FIELD AT THE TOP.
          Asked for on 2026-09-18, looking at the history: "I don't see any key
          date." A trail of what has happened, with the date everything is
          working towards recorded somewhere else entirely, makes the reader hold
          the deadline in their head while they read.

          It sits above the changes because it is the only entry here in the
          FUTURE, and the list is newest first. Violet, so it reads as neither a
          change (grey) nor a baseline (green) — it is not something somebody
          did. When the date has passed it says so in red, which is the same fact
          the spec table calls overdue. */}
      {specsAgreedBy && (
        <div
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y px-4 py-2.5 text-sm ${
            overdue ? "border-red-200 bg-red-50" : "border-violet-200 bg-violet-50"
          }`}
        >
          <Pill
            className={
              overdue
                ? "border-red-300 bg-white text-red-700"
                : "border-violet-300 bg-white text-violet-700"
            }
          >
            Key date
          </Pill>
          <span className={overdue ? "font-semibold text-red-900" : "font-semibold text-violet-900"}>
            {/* Written the way a person writes a day. `formatDay` reads the
                STRING's own parts — a `new Date` here is where the TOE-dates
                trap comes back, and it would render the day before in BST. */}
            {SPECS_AGREED_LABEL} — {formatDay(specsAgreedBy)}
          </span>
          <span className={`text-xs ${overdue ? "text-red-800" : "text-violet-800"}`}>
            {describeDays(daysUntil(specsAgreedBy))}
            {typeof toQuote === "number" && toQuote > 0 && <> · {toQuote.toLocaleString()} still TGQ</>}
          </span>
        </div>
      )}

      {changes.length === 0 ? (
        <p className="px-4 py-3 text-sm text-neutral-600">
          Nothing recorded yet. Changes start when a document is confirmed or somebody edits an item.
        </p>
      ) : (
        <ul>
          {visibleChanges.map((change) => {
            /* `label` is baseline-only by constraint (0012: "a baseline is
               named, and nothing else is"), so `kind === "baseline"` and the
               presence of a name are the same fact, and the row can lean on
               either. */
            const isBaseline = change.kind === "baseline";
            if (isBaseline) {
              return (
                <li
                  key={change.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-green-200 bg-green-50 px-4 py-2.5 text-sm"
                >
                  <Pill tone="good">Baseline</Pill>
                  <span className="font-semibold text-green-900">{change.label ?? change.kindLabel}</span>
                  <span className="text-xs text-green-800">
                    {when(change.createdAt)} · {change.actor}
                    {change.recordsChanged > 0 && (
                      <> · {change.recordsChanged} item{change.recordsChanged === 1 ? "" : "s"} fixed at this point</>
                    )}
                  </span>
                  {changes[0] && changes[0].id !== change.id && (
                    <Button size="xs" className="ml-auto" onClick={() => compareToNow(change.id)}>
                      Compare to now
                    </Button>
                  )}
                </li>
              );
            }
            const first = change.records[0];
            return (
              <li key={change.id} className="flex items-start gap-3 border-b border-neutral-100 px-4 py-2.5 text-sm">
                <Chip className="mt-0.5 shrink-0">{change.kindLabel}</Chip>
                <div className="min-w-0 flex-1">
                  <p className="text-neutral-800">
                    {first ? (
                      <Link
                        href={`/dashboard/records/${first.id}`}
                        className="text-blue-700 no-underline hover:underline"
                      >
                        {first.label}
                      </Link>
                    ) : (
                      <span className="text-neutral-500">nothing versioned</span>
                    )}
                    {change.recordsChanged > 1 && (
                      <span className="text-neutral-500"> and {change.recordsChanged - 1} more</span>
                    )}
                    {change.closedAt === null && (
                      <Chip tone="info" className="ml-2">
                        open
                      </Chip>
                    )}
                  </p>
                  {change.reason && <p className="text-xs text-neutral-500">&ldquo;{change.reason}&rdquo;</p>}
                  <p className="flex flex-wrap gap-x-4 text-xs">
                    {change.source && (
                      <a
                        href={`/api/imports/${change.source.intakeRunId}/source`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neutral-500 underline hover:text-neutral-900"
                      >
                        {change.source.filename ?? "source document"}
                      </a>
                    )}
                    {change.evidence && (
                      <a
                        href={`/api/change-sets/${change.id}/evidence`}
                        className="text-neutral-500 underline hover:text-neutral-900"
                      >
                        {change.evidence.filename ?? "evidence"} (download)
                      </a>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  {when(change.createdAt)}
                  <br />
                  {change.actor}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Expanding shows the rest; it never loads anything, because the whole
          trail is already here. The count says how many are hidden, so the
          list never reads as the whole of what has happened. */}
      {changes.length > RECENT_CHANGES && (
        <div className="px-4 py-2">
          <Button variant="quiet" size="xs" onClick={() => setShowAllChanges(!showAllChanges)}>
            {showAllChanges ? `Show the ${RECENT_CHANGES} most recent` : `Show all ${changes.length} — ${hiddenChanges} more`}
          </Button>
        </div>
      )}
    </div>
  );
}
