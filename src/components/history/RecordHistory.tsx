"use client";

// Every version of one record, newest first.
//
// A version is a NUMBER a person can refer to ("S-100 v3"), the change that
// produced it, who made it, why, and the document or email it came off. The
// compare row at the top answers the other question — "what changed between
// the one we issued and the one we have now" — for any two versions, not just
// neighbours.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import DiffTable from "@/components/history/DiffTable";
import type { RecordVersion } from "@/lib/change-history";
import type { SnapshotDiff } from "@/lib/snapshot-diff";

type Payload = { record: { id: string; label: string; itemDescription: string }; versions: RecordVersion[] };
type ComparePayload = { from: number; to: number; diff: SnapshotDiff };

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RecordHistory({ recordId, reloadKey = 0 }: { recordId: string; reloadKey?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [comparison, setComparison] = useState<ComparePayload | null>(null);
  const [comparing, setComparing] = useState(false);

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

  async function compare() {
    if (!from || !to) return;
    setComparing(true);
    setComparison(null);
    try {
      const res = await apiFetch<ComparePayload>(`/api/records/${recordId}/history?from=${from}&to=${to}`);
      // Report AFTER the request settles either way: a comparison that failed
      // must say so rather than leaving the previous answer on screen.
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

  if (error && !data) return <p className="mt-2 text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading history" />;

  const { versions } = data;
  if (versions.length === 0) {
    return (
      <p className="mt-2 text-sm text-neutral-600">
        No versions recorded for this item yet. Versions start when something changes it.
      </p>
    );
  }

  return (
    <div className="mt-2">
      {error && <p className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      {versions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm border border-neutral-200 rounded-lg bg-white px-3 py-2">
          <span className="text-neutral-500">Compare</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
            <option value="">from…</option>
            {versions.map((version) => (
              <option key={version.snapshotNo} value={version.snapshotNo}>v{version.snapshotNo}</option>
            ))}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
            <option value="">to…</option>
            {versions.map((version) => (
              <option key={version.snapshotNo} value={version.snapshotNo}>v{version.snapshotNo}</option>
            ))}
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
        <div className="mt-2 border border-neutral-300 rounded-lg bg-white px-4 py-3">
          <p className="text-sm font-medium text-neutral-900">
            v{comparison.from} → v{comparison.to}
          </p>
          <DiffTable diff={comparison.diff} />
        </div>
      )}

      <ul className="mt-3 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
        {versions.map((version) => (
          <li key={version.snapshotNo} className="px-4 py-3">
            <button
              type="button"
              onClick={() => setOpen(open === version.snapshotNo ? null : version.snapshotNo)}
              className="w-full text-left"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm text-neutral-900">v{version.snapshotNo}</span>
                <span className="text-sm text-neutral-900">{version.kindLabel}</span>
                <span className="text-xs text-neutral-500">{when(version.createdAt)}</span>
                <span className="text-xs text-neutral-500">{version.actor}</span>
                {version.diff && !version.diff.isEmpty && (
                  <span className="text-xs text-neutral-400">
                    {version.diff.core.length + version.diff.attributes.length + version.diff.answers.length + version.diff.refs.length} change
                    {version.diff.core.length + version.diff.attributes.length + version.diff.answers.length + version.diff.refs.length === 1 ? "" : "s"}
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-400">{open === version.snapshotNo ? "▾" : "▸"}</span>
              </div>
            </button>

            {version.reason && <p className="mt-1 text-sm text-neutral-600">{version.reason}</p>}

            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {version.source && (
                <a
                  href={`/api/imports/${version.source.intakeRunId}/source`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-500 underline hover:text-neutral-900"
                >
                  {version.source.filename ?? "source document"}
                </a>
              )}
              {version.evidence && (
                // Downloads. An .eml or .msg opens in Outlook; nothing here
                // renders a message body, which is untrusted input.
                <a
                  href={`/api/change-sets/${version.id}/evidence`}
                  className="text-neutral-500 underline hover:text-neutral-900"
                >
                  {version.evidence.filename ?? "evidence"} (download)
                </a>
              )}
            </div>

            {version.unreadable && <p className="mt-1 text-sm text-amber-700">{version.unreadable}</p>}

            {open === version.snapshotNo &&
              (version.diff ? (
                <DiffTable diff={version.diff} />
              ) : (
                <p className="mt-2 text-sm text-neutral-500">
                  The first version of this item. There is nothing before it to compare against.
                </p>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
