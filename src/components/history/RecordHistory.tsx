"use client";

// Every version of one record, and what changed between any two of them.
//
// ============================================================================
// TWO VERSIONS ARE SELECTED, AND THE DIFF IS THE PAGE.
//
// It used to be two dropdowns and a Show button, with the diff appearing above
// a list of collapsible rows. Nobody compares two versions by naming them: the
// question is almost always "what just changed", and the answer to it should
// be on the screen when the tab opens. So the newest pair is selected by
// default, clicking two rows re-selects, and the diff is the left-hand column
// rather than a panel.
//
// ---- A VERSION AND A BASELINE DO NOT LOOK ALIKE ---------------------------
//
// Versions are numbered rows; a BASELINE is a green bar straight across the
// column with its name on it, so you can see which versions fall inside Rev A
// and which came after — the only question anybody asks of one. It is placed
// by its MEMBER ROW and never by its date: `baseline_members` materialises the
// exact version each record was at when the point was named, because
// `created_at` is transaction START time and two overlapping guarded
// transactions can commit in the opposite order.
//
// ---- AND THE TWO CARDS ANSWER DIFFERENT QUESTIONS -------------------------
//
// The DIFF recomposes both ends with today's rules, so a change to
// `composeRowCells` never shows as an edit on a record nobody touched. The
// card under it shows the STORED cells — what BWS would have received on that
// date — which is the other question and cannot be answered by recomposing.
// Keeping them apart is why 0012 stores the cells at all.
//
// Unchanged fields are COUNTED, not listed, and are one click away: a diff
// that hides them entirely cannot prove nothing else moved.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Pill from "@/components/ui/Pill";
import Note from "@/components/ui/Note";
import Button from "@/components/ui/Button";
import { Table, Td, Tr } from "@/components/ui/Table";
import type { RecordVersion } from "@/lib/change-history";
import type { FieldChange, ListChange, SnapshotDiff } from "@/lib/snapshot-diff";
import type { RecordBaseline } from "@/lib/baselines";

type StoredCell = { name: string; jsonId: number | null; value: string };

type Payload = {
  record: { id: string; label: string; itemDescription: string };
  versions: RecordVersion[];
  /** Added 2026-09-18. An older cached payload has none, and the bars simply do not draw. */
  baselines?: RecordBaseline[];
};
type ComparePayload = {
  from: number;
  to: number;
  diff: SnapshotDiff;
  /** The newer version's stored cells — what the file said that day. */
  cells?: StoredCell[];
  /** Everything the newer version holds that this change did not touch. */
  unchanged?: { key: string; label: string; value: string | null }[];
};

/** A timestamp, not a `date` column — so `Date` is safe here and only here. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** One line of the diff grid: what it is, what it was, what it now is. */
type DiffRow = { key: string; label: string; sub: string | null; was: string | null; now: string | null };

function flatten(items: ListChange[], sub: (item: ListChange) => string): DiffRow[] {
  return items.flatMap((item) =>
    item.fields.map((field) => ({
      key: `${item.change}:${item.key}:${field.field}`,
      label: item.label,
      sub: `${sub(item)} · ${item.change}`,
      was: item.change === "added" ? null : field.was,
      now: item.change === "removed" ? null : field.now,
    })),
  );
}

function diffRows(diff: SnapshotDiff): DiffRow[] {
  const core: DiffRow[] = diff.core.map((change: FieldChange) => ({
    key: `core:${change.field}`,
    label: change.label,
    sub: null,
    was: change.was,
    now: change.now,
  }));
  const cells: DiffRow[] = diff.cells.map((change) => ({
    key: `cell:${change.field}`,
    label: change.label,
    // The composed cell is DERIVED from the rows above it, and saying so is
    // what stops a reader counting one edit twice.
    sub: "the export's own cell",
    was: change.was,
    now: change.now,
  }));
  return [
    ...core,
    ...flatten(diff.attributes, () => "captured spec"),
    ...flatten(diff.answers, () => "checklist"),
    ...flatten(diff.refs, () => "client ref"),
    ...cells,
  ];
}

export default function RecordHistory({
  recordId,
  projectId = null,
  reloadKey = 0,
}: {
  recordId: string;
  /** For "See this change on the project". Null renders no link rather than a dead one. */
  projectId?: string | null;
  reloadKey?: number;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last two versions clicked, oldest first. Empty means "the newest pair". */
  const [picked, setPicked] = useState<number[]>([]);
  const [comparison, setComparison] = useState<ComparePayload | null>(null);
  const [comparing, setComparing] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [baselineId, setBaselineId] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/records/${recordId}/history`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [recordId]);

  // reloadKey changes when the record screen saves something, so the history
  // grows under the edit that caused it rather than going stale until reload.
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const versions = useMemo(() => data?.versions ?? [], [data]);

  /**
   * WHAT JUST CHANGED, by default. The newest pair, until somebody picks.
   *
   * A record with one version has nothing to compare, and the screen says so
   * rather than rendering an empty diff.
   */
  const pair = useMemo<[number, number] | null>(() => {
    if (picked.length === 2) return [Math.min(...picked), Math.max(...picked)];
    if (versions.length < 2) return null;
    return [versions[1]!.snapshotNo, versions[0]!.snapshotNo];
  }, [picked, versions]);

  useEffect(() => {
    if (!pair) {
      setComparison(null);
      return;
    }
    let live = true;
    setComparing(true);
    setShowUnchanged(false);
    void apiFetch<ComparePayload>(`/api/records/${recordId}/history?from=${pair[0]}&to=${pair[1]}`).then((res) => {
      if (!live) return;
      setComparing(false);
      // Report EITHER WAY: a comparison that failed must say so rather than
      // leaving the previous answer on screen under the new heading.
      if (!res.ok) {
        setComparison(null);
        setError(res.error);
        return;
      }
      setError(null);
      setComparison(res.data);
    });
    return () => {
      live = false;
    };
  }, [recordId, pair, reloadKey]);

  if (error && !data) return <Note tone="danger">{error}</Note>;
  if (!data) return <Spinner label="Loading history" />;

  if (versions.length === 0) {
    return (
      <Note tone="plain">
        No versions recorded for this item yet. Versions start when something changes it.
      </Note>
    );
  }

  const baselines = data.baselines ?? [];
  const latest = versions[0]!;
  const fromVersion = pair ? versions.find((version) => version.snapshotNo === pair[0]) ?? null : null;
  const toVersion = pair ? versions.find((version) => version.snapshotNo === pair[1]) ?? null : null;
  const rows = comparison ? diffRows(comparison.diff) : [];
  const counts = comparison
    ? {
        changed:
          comparison.diff.core.length +
          [...comparison.diff.attributes, ...comparison.diff.answers, ...comparison.diff.refs].filter(
            (change) => change.change === "changed",
          ).length,
        added: [...comparison.diff.attributes, ...comparison.diff.answers, ...comparison.diff.refs].filter(
          (change) => change.change === "added",
        ).length,
        removed: [...comparison.diff.attributes, ...comparison.diff.answers, ...comparison.diff.refs].filter(
          (change) => change.change === "removed",
        ).length,
        unchanged: comparison.unchanged?.length ?? 0,
      }
    : null;

  /** Clicking a row picks it; the last two clicked are the comparison. */
  const pick = (snapshotNo: number) =>
    setPicked((current) => {
      const next = [...current.filter((value) => value !== snapshotNo), snapshotNo];
      return next.slice(-2);
    });

  return (
    <>
      {error && <Note tone="danger">{error}</Note>}

      <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {!pair ? (
            <Note tone="plain">
              This is the first version of the item. There is nothing before it to compare against.
            </Note>
          ) : (
            <>
              <Card
                title={`What changed between v${pair[0]} and v${pair[1]}`}
                className="mt-0"
                actions={
                  <CardHeadingNote>
                    {comparing
                      ? "comparing…"
                      : counts
                        ? `${counts.changed} changed · ${counts.added} added${
                            counts.removed > 0 ? ` · ${counts.removed} removed` : ""
                          } · ${counts.unchanged} unchanged`
                        : ""}
                  </CardHeadingNote>
                }
                flush
              >
                <div className="grid grid-cols-1 min-[640px]:grid-cols-[200px_1fr_1fr]">
                  <div className="border-b border-neutral-200 bg-[#fcfcfc] px-3 py-1.5 text-th font-semibold uppercase tracking-wider text-neutral-500">
                    Field
                  </div>
                  <div className="border-b border-neutral-200 bg-[#fcfcfc] px-3 py-1.5 text-th font-semibold uppercase tracking-wider text-neutral-500">
                    v{pair[0]}
                    {fromVersion ? ` — ${when(fromVersion.createdAt)}` : ""}
                  </div>
                  <div className="border-b border-neutral-200 bg-[#fcfcfc] px-3 py-1.5 text-th font-semibold uppercase tracking-wider text-neutral-500">
                    v{pair[1]}
                    {toVersion ? ` — ${when(toVersion.createdAt)}` : ""}
                    {toVersion?.snapshotNo === latest.snapshotNo && (
                      <span className="text-green-700"> · current</span>
                    )}
                  </div>

                  {rows.map((row) => (
                    <div key={row.key} className="contents">
                      <div className="border-b border-neutral-100 px-3 py-1.5">
                        <b className="font-medium text-neutral-900">{row.label}</b>
                        {row.sub && <span className="block text-[11px] text-neutral-500">{row.sub}</span>}
                      </div>
                      <div className="border-b border-neutral-100 px-3 py-1.5">
                        {row.was === null ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <span className="font-mono text-neutral-500 line-through decoration-red-300">
                            {row.was}
                          </span>
                        )}
                      </div>
                      <div className="border-b border-neutral-100 px-3 py-1.5">
                        {row.now === null ? (
                          <span className="italic text-neutral-400">cleared</span>
                        ) : (
                          <span className="font-mono font-medium text-neutral-900">{row.now}</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {!comparing && rows.length === 0 && (
                    <div className="col-span-full px-3 py-2 text-neutral-500">
                      Nothing on this record changed between these two versions.
                    </div>
                  )}
                </div>

                {/* COUNTED, NOT LISTED — and one click away, because a diff
                    that hides them entirely cannot prove nothing else moved. */}
                {counts && counts.unchanged > 0 && (
                  <div className="border-t border-neutral-100 px-3 py-1.5">
                    <Button variant="quiet" size="xs" onClick={() => setShowUnchanged((open) => !open)}>
                      {showUnchanged ? "▾" : "▸"} {counts.unchanged} unchanged — show them
                    </Button>
                    {showUnchanged && (
                      <ul className="mt-1 divide-y divide-neutral-100">
                        {comparison?.unchanged?.map((item) => (
                          <li key={item.key} className="flex gap-3 py-1 text-[12px]">
                            <span className="w-48 shrink-0 text-neutral-500">{item.label}</span>
                            <span className="min-w-0 break-words font-mono text-neutral-600">
                              {item.value ?? "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {toVersion && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-3.5 py-2.5">
                    <Chip>{toVersion.kindLabel}</Chip>
                    {toVersion.reason && (
                      <span className="text-[12px] text-neutral-500">&ldquo;{toVersion.reason}&rdquo;</span>
                    )}
                    <span className="text-[12px] text-neutral-500">— {toVersion.actor}</span>
                    <span className="flex-1" />
                    {projectId && (
                      <Link
                        href={`/dashboard/projects/${projectId}?tab=history`}
                        className="text-[12px] underline hover:text-neutral-900"
                      >
                        See this change on the project
                      </Link>
                    )}
                  </div>
                )}
              </Card>

              {/* THE OTHER QUESTION: what the FILE said that day. Read from the
                  stored cells, never recomposed — that is the whole reason
                  0012 keeps them. */}
              {comparison?.cells && comparison.cells.length > 0 && (
                <Card
                  title={`v${pair[1]} as BWS would receive it`}
                  actions={<CardHeadingNote>the export&rsquo;s own cells, as at that version</CardHeadingNote>}
                  flush
                >
                  <Table>
                    <tbody>
                      {comparison.cells.map((cell) => (
                        <Tr key={`${cell.name}:${cell.jsonId ?? ""}`}>
                          <Td className="w-[30%]">{cell.name.trim()}</Td>
                          <Td mono>{cell.value}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}
            </>
          )}
        </div>

        <div className="min-w-0">
          <Card
            title="Versions"
            className="mt-0"
            actions={<CardHeadingNote>compare any two</CardHeadingNote>}
            flush
          >
            <ul>
              {versions.map((version) => {
                const selected = pair !== null && (version.snapshotNo === pair[0] || version.snapshotNo === pair[1]);
                // A BASELINE SITS BETWEEN VERSIONS, placed by the version it
                // FROZE. Comparing dates instead is the error
                // `baseline_members` exists to prevent.
                const bars = baselines.filter((baseline) => baseline.memberSnapshotNo === version.snapshotNo);
                return (
                  <li key={version.snapshotNo}>
                    {bars.map((baseline) => (
                      <div
                        key={baseline.changeSetId}
                        className="flex items-center gap-2 border-y border-green-200 bg-green-50 px-3 py-1"
                      >
                        <Pill tone="good">Baseline</Pill>
                        <span className="min-w-0 truncate text-[12px] text-green-900">{baseline.label}</span>
                        <span className="ml-auto text-[11px] text-green-700">{day(baseline.createdAt)}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => pick(version.snapshotNo)}
                      aria-pressed={selected}
                      className={`flex w-full items-start gap-2.5 border-b border-neutral-100 px-3 py-2 text-left hover:bg-[#fcfcfc] ${
                        selected ? "bg-slate-50 shadow-[inset_3px_0_0_#171717]" : ""
                      }`}
                    >
                      <span className="shrink-0 rounded border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-[12px] font-bold text-neutral-600">
                        v{version.snapshotNo}
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block font-medium text-neutral-900">{version.kindLabel}</b>
                        <span className="block text-[11.5px] text-neutral-500">
                          {version.source?.filename ?? version.reason ?? version.label ?? ""}
                          {version.diff && !version.diff.isEmpty
                            ? `${version.source?.filename || version.reason ? " · " : ""}${
                                version.diff.core.length +
                                version.diff.attributes.length +
                                version.diff.answers.length +
                                version.diff.refs.length
                              } changed`
                            : ""}
                        </span>
                        {version.unreadable && (
                          <span className="block text-[11.5px] text-amber-700">{version.unreadable}</span>
                        )}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-right text-[11.5px] text-neutral-500">
                        {when(version.createdAt)}
                        <span className="block">{version.actor}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 border-t border-neutral-200 px-3.5 py-2.5">
              <span className="text-[12px] text-neutral-500">
                {pair ? (
                  <>
                    Comparing <b className="font-semibold text-neutral-800">v{pair[0]} → v{pair[1]}</b>
                  </>
                ) : (
                  "One version so far"
                )}
              </span>
              <span className="flex-1" />
              {picked.length > 0 && (
                <Button size="xs" onClick={() => setPicked([])}>
                  Reset
                </Button>
              )}
            </div>
          </Card>

          <Card title="Compare to a baseline">
            {baselines.length === 0 ? (
              <p className="text-[12px] text-neutral-500">
                No named point covers this item yet. A baseline is named on the project, and it fixes exactly which
                version of each item was in it at that moment.
              </p>
            ) : (
              <>
                <select
                  value={baselineId}
                  onChange={(event) => setBaselineId(event.target.value)}
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                >
                  <option value="">— choose a baseline —</option>
                  {baselines.map((baseline) => (
                    <option key={baseline.changeSetId} value={baseline.changeSetId}>
                      {baseline.label} (v{baseline.memberSnapshotNo}, {day(baseline.createdAt)})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={!baselineId}
                  onClick={() => {
                    const baseline = baselines.find((row) => row.changeSetId === baselineId);
                    if (!baseline) return;
                    setPicked([baseline.memberSnapshotNo, latest.snapshotNo]);
                  }}
                >
                  Compare to now
                </Button>
                <p className="mt-2 text-[11.5px] text-neutral-500">
                  A baseline fixes exactly which version of each item was in it, at the moment it was named.
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
