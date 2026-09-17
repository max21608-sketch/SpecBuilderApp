"use client";

// The project's trail, and the comparison between any two points in it.
//
// Two questions, one screen, because they are the same question at different
// resolutions: "what has happened here" and "what is different between the
// version we issued and the one we hold now".
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import DiffTable from "@/components/history/DiffTable";
import type { ProjectChange } from "@/lib/change-history";
import type { ProjectComparison, RecordComparison } from "@/lib/baselines";
import Button from "@/components/ui/Button";

type Payload = { changes: ProjectChange[] };

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
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

const CHANGE_CLASS: Record<RecordComparison["change"], string> = {
  added: "text-green-700 bg-green-50 border-green-200",
  removed: "text-red-700 bg-red-50 border-red-200",
  changed: "text-amber-800 bg-amber-50 border-amber-200",
  unchanged: "text-neutral-500 bg-neutral-50 border-neutral-200",
};

export default function ProjectHistory({ projectId, runId }: { projectId: string; runId?: string | null }) {
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
  const [namingPoint, setNamingPoint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);

  const load = useCallback(async () => {
    const query = runId ? `?runId=${runId}` : "";
    const res = await apiFetch<Payload>(`/api/projects/${projectId}/history${query}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
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

  if (error && !data) return <p className="mt-3 text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading history" />;

  const { changes } = data;
  const baselines = changes.filter((change) => change.kind === "baseline");
  const visible = comparison?.records.filter((record) => showUnchanged || record.change !== "unchanged") ?? [];
  const visibleChanges = showAllChanges ? changes : changes.slice(0, RECENT_CHANGES);
  const hiddenChanges = changes.length - visibleChanges.length;

  return (
    <div className="mt-3">
      {error && <p className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      {/* Naming a point. A baseline writes down the exact version of every
          record, so a comparison against it later is two exact sets. */}
      {namingPoint ? (
        <div className="border border-neutral-300 rounded-lg bg-white px-4 py-3 text-sm">
          <p className="font-medium text-neutral-900">Name this point</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Records what every item holds right now, so you can compare against it later.
          </p>
          <input
            value={baselineLabel}
            autoFocus
            onChange={(event) => setBaselineLabel(event.target.value)}
            placeholder="Issued to client, 16 Sep"
            className="mt-2 w-full border border-neutral-300 rounded px-2 py-1"
          />
          <input
            value={baselineReason}
            onChange={(event) => setBaselineReason(event.target.value)}
            placeholder="What was issued, and to whom"
            className="mt-2 w-full border border-neutral-300 rounded px-2 py-1"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void takeBaseline()}
              disabled={!baselineLabel.trim() || !baselineReason.trim() || busy}
              className="border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save this point"}
            </button>
            <Button variant="quiet" onClick={() => setNamingPoint(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setNamingPoint(true)}>Name this point</Button>
      )}

      {changes.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm border border-neutral-200 rounded-lg bg-white px-3 py-2">
          <span className="text-neutral-500">Compare</span>
          <select value={from} onChange={(event) => setFrom(event.target.value)} className="border border-neutral-300 rounded px-2 py-1 max-w-[16rem]">
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
          <select value={to} onChange={(event) => setTo(event.target.value)} className="border border-neutral-300 rounded px-2 py-1 max-w-[16rem]">
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
          <button
            type="button"
            onClick={() => void compare()}
            disabled={!from || !to || comparing}
            className="border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
          >
            {comparing ? "Comparing…" : "Show"}
          </button>
          {comparison && (
            <button type="button" onClick={() => setComparison(null)} className="text-neutral-500 hover:text-neutral-900">
              clear
            </button>
          )}
        </div>
      )}

      {comparison && (
        <div className="mt-3 border border-neutral-300 rounded-lg bg-white px-4 py-3">
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
            <button
              type="button"
              onClick={() => setShowUnchanged((value) => !value)}
              className="mt-1 text-xs text-neutral-600 hover:text-neutral-900"
            >
              {showUnchanged ? "Hide" : "Show"} the {comparison.counts.unchanged} unchanged
            </button>
          )}

          <ul className="mt-2 border border-neutral-200 rounded divide-y divide-neutral-200">
            {visible.map((record) => (
              <li key={record.recordId} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenRecord(openRecord === record.recordId ? null : record.recordId)}
                  className="w-full text-left flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                  disabled={!record.diff}
                >
                  <span className="font-mono text-neutral-900">{record.label}</span>
                  <span className="text-neutral-700">{record.itemDescription}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${CHANGE_CLASS[record.change]}`}>{record.change}</span>
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

      <h3 className="mt-5 text-xs font-medium text-neutral-500 uppercase tracking-wide">
        Everything that has happened
        {changes.length > 0 && <span className="ml-2 normal-case tracking-normal text-neutral-400">{changes.length}</span>}
      </h3>
      {changes.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          Nothing recorded yet. Changes start when a document is confirmed or somebody edits an item.
        </p>
      ) : (
        <ul className="mt-2 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {visibleChanges.map((change) => (
            <li key={change.id} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-neutral-900">{change.label ?? change.kindLabel}</span>
                {change.label && <span className="text-xs text-neutral-500">{change.kindLabel}</span>}
                <span className="text-xs text-neutral-500">{when(change.createdAt)}</span>
                <span className="text-xs text-neutral-500">{change.actor}</span>
                {change.recordsChanged > 0 && (
                  <span className="text-xs text-neutral-400">
                    {change.recordsChanged} item{change.recordsChanged === 1 ? "" : "s"}
                  </span>
                )}
                {change.closedAt === null && (
                  <span className="text-xs text-blue-700 border border-blue-200 bg-blue-50 rounded px-1.5">open</span>
                )}
              </div>
              {change.reason && <p className="text-xs text-neutral-600">{change.reason}</p>}
              <div className="flex flex-wrap gap-x-4 text-xs">
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
                  <a href={`/api/change-sets/${change.id}/evidence`} className="text-neutral-500 underline hover:text-neutral-900">
                    {change.evidence.filename ?? "evidence"} (download)
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* Expanding shows the rest; it never loads anything, because the whole
          trail is already here. The count says how many are hidden, so the
          list never reads as the whole of what has happened. */}
      {changes.length > RECENT_CHANGES && (
        <div className="mt-2">
          <Button variant="quiet" onClick={() => setShowAllChanges((value) => !value)}>
            {showAllChanges ? `Show the ${RECENT_CHANGES} most recent` : `Show all ${changes.length} — ${hiddenChanges} more`}
          </Button>
        </div>
      )}
    </div>
  );
}
