"use client";

// One intake pack: the documents that arrived together, in the order they are
// read.
//
// The order is not cosmetic. The preamble gives the conditions the whole
// package is built under; the bill of quantities creates the records; the
// drawings attach specs to those records. A drawing extracted before its bill
// is confirmed is FINE — its targets resolve at review time, not at extraction
// — and this screen says so rather than blocking the button, because the post
// does not always arrive in the right order.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
import Spinner from "@/components/ui/Spinner";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";

type Run = {
  id: string;
  sourceKind: string;
  documentKind: DocumentKind | null;
  status: string;
  error: string | null;
  filename: string | null;
  createdAt: string;
};

type Batch = { id: string; label: string | null; created_at: string; runs: Run[] };

const STATUS_LABELS: Record<string, string> = {
  pending: "Not read yet",
  queued: "Queued",
  parsing: "Reading",
  parsed: "Ready to review",
  confirmed: "Review complete",
  failed: "Failed",
};

function kindLabel(run: Run): string {
  if (run.sourceKind === "boq_xlsx") return "Bill of quantities";
  return run.documentKind ? DOCUMENT_KIND_LABELS[run.documentKind] : "Document";
}

export default function IntakeBatchPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const [projectId, setProjectId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void params.then((resolved) => {
      setProjectId(resolved.id);
      setBatchId(resolved.batchId);
    });
  }, [params]);

  const load = useCallback(async () => {
    if (!projectId) return;
    const res = await apiFetch<{ batches: Batch[] }>(`/api/projects/${projectId}/batches`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setBatch(res.data.batches.find((row) => row.id === batchId) ?? null);
  }, [projectId, batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only while something is actually in flight. A settled pack polls nothing.
  const inFlight = (batch?.runs ?? []).some((run) => run.status === "queued" || run.status === "parsing");
  usePoll(load, { intervalMs: 3000, active: inFlight });

  async function extract(run: Run) {
    setBusy(run.id);
    setError(null);
    try {
      // The version is read fresh: this screen does not hold one, and the
      // extract route refuses a mismatch rather than starting a second attempt.
      const current = await apiFetch<{ import: { version: number } }>(`/api/imports/${run.id}`);
      if (!current.ok) {
        setError(current.error);
        return;
      }
      const res = await apiFetch(`/api/imports/${run.id}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: current.data.import.version,
          requestId: crypto.randomUUID(),
          action: "start",
        }),
      });
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      // Always reset: an HTML error page must not leave the button spinning.
      setBusy(null);
    }
  }

  const drawingRuns = (batch?.runs ?? []).filter((run) => run.documentKind === "shop_drawings");

  if (!batch && !error) return <Spinner label="Loading the pack" />;

  return (
    <div className="py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-neutral-900">Intake pack</h1>
        <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          Back to the project
        </Link>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <p className="mt-2 text-sm text-neutral-600">
        Read the preamble, if the pack has one, and then the bill — the bill is what creates the records that drawings
        attach to. Drawings can be read before that; their specs simply have nothing to land on until the bill is
        confirmed.
      </p>

      {/* At one PDF per line item a pack holds thirty drawing files. Reviewing
          them one screen at a time is thirty screens, and nothing can then see
          the two problems that only exist across documents. */}
      {drawingRuns.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          <span>
            This pack has {drawingRuns.length} drawing documents.
          </span>
          <Link
            href={`/dashboard/projects/${projectId}/intake/${batchId}/drawings`}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
          >
            Review them together
          </Link>
          <span className="text-xs text-neutral-500">
            One card per item, whichever file it came from — and the only place a record described by two of them shows
            up.
          </span>
        </div>
      )}

      <ul className="mt-4 divide-y divide-neutral-100 border border-neutral-200 rounded-lg bg-white">
        {(batch?.runs ?? []).map((run) => {
          const readable = run.sourceKind === "spec_document";
          const needsExtract = readable && (run.status === "pending" || run.status === "failed");
          const working = run.status === "queued" || run.status === "parsing";
          return (
            <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-[14rem]">
                <p className="text-sm font-medium text-neutral-900">{run.filename ?? "Unnamed file"}</p>
                <p className="text-xs text-neutral-500">{kindLabel(run)}</p>
                {run.error && <p className="mt-1 text-xs text-red-700">{run.error}</p>}
              </div>

              <span className="text-xs text-neutral-600">{STATUS_LABELS[run.status] ?? run.status}</span>

              {working && <Spinner label="" />}

              {needsExtract && (
                <button
                  type="button"
                  onClick={() => void extract(run)}
                  disabled={busy !== null}
                  className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
                  title="This sends the document to the model, which costs money."
                >
                  {busy === run.id ? "Starting…" : run.status === "failed" ? "Retry (charges again)" : "Read it"}
                </button>
              )}

              <Link
                href={`/dashboard/imports/${run.id}`}
                className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50"
              >
                {run.status === "parsed" ? "Review" : "Open"}
              </Link>
            </li>
          );
        })}
        {batch?.runs.length === 0 && (
          <li className="px-4 py-6 text-sm text-neutral-500">This pack has no documents.</li>
        )}
      </ul>

      <p className="mt-3 text-xs text-neutral-500">
        Reading a document sends it to the model and is the step that costs money. Registering it did not.
      </p>
    </div>
  );
}
