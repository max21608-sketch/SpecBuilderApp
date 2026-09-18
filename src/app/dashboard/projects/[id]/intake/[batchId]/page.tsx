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
import StatTile from "@/components/ui/StatTile";
import Tip from "@/components/ui/Tip";
import Button, { buttonClass } from "@/components/ui/Button";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { intakeStatusLabel, isIntakeRunWorking } from "@/lib/intake-status";

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

/**
 * One stage of the reading order.
 *
 * `done` is a fact about the documents, never about whether the stage EXISTS:
 * an absent preamble is not a finished one, so it renders undone with its
 * absence in words. A tick over a stage with no document would be the empty
 * programme error in a third place.
 */
function Step({
  n,
  done,
  title,
  meaning,
  children,
  action,
  last,
}: {
  n: number;
  done: boolean;
  title: string;
  meaning: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${last ? "" : "border-b border-neutral-200"}`}>
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
          done
            ? "border-green-300 bg-green-50 text-green-700"
            : "border-neutral-300 bg-white text-neutral-400"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-neutral-900">
          <span className="font-medium">{title}</span>
          <span className="text-neutral-500"> — {meaning}</span>
        </p>
        <p className="mt-0.5 text-xs text-neutral-600">{children}</p>
      </div>
      {action}
    </div>
  );
}

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
  const inFlight = (batch?.runs ?? []).some((run) => isIntakeRunWorking(run.status));
  usePoll(load, { intervalMs: 3000, active: inFlight });

  async function extract(run: Run, action: "start" | "retry-dispatch" = "start") {
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
          action,
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

  /**
   * What the pack is waiting on, counted once.
   *
   * `confirmed` means no pending proposals remain — applied or explicitly
   * ignored — which is what the review screens call "Review complete". It does
   * NOT mean the answers it produced are settled, and the wording here follows
   * that: "reviewed", never "complete".
   */
  /** The three stages, in reading order. A stage with no document says so. */
  const packSteps = {
    preamble: (batch?.runs ?? []).filter((run) => run.documentKind === "preamble"),
    bill: (batch?.runs ?? []).filter((run) => run.sourceKind === "boq_xlsx"),
  };

  const packState = (batch?.runs ?? []).reduce(
    (acc, run) => {
      if (run.status === "confirmed") acc.reviewed += 1;
      else if (run.status === "parsed") acc.toReview += 1;
      else if (run.status === "failed") acc.failed += 1;
      else if (isIntakeRunWorking(run.status)) acc.reading += 1;
      return acc;
    },
    { reviewed: 0, toReview: 0, reading: 0, failed: 0 },
  );

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
        Every specification document is read automatically when it uploads, so this screen is usually somewhere to
        watch rather than somewhere to click.
      </p>

      {/* WHAT THIS PACK WANTS FROM YOU, at a glance.
          ==================================================================
          Reading is dispatched at upload, so most of the time the answer is
          "nothing" — and a screen of file rows makes you work that out by
          reading every status. The tiles say it in four numbers, and the only
          one that is ever a call to action is the one that failed. A document
          being READ is deliberately shown as information rather than as work:
          it needs nobody, and offering a button beside it would invite a second
          charged call for a read that is already running. */}
      {(batch?.runs ?? []).length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatTile label="Reviewed" tone="good" value={packState.reviewed} meaning="applied or ruled on" />
          <StatTile
            label="Waiting for you"
            tone={packState.toReview > 0 ? "warn" : "plain"}
            value={packState.toReview}
            meaning="staged and unreviewed"
          />
          <StatTile
            label="Still being read"
            tone="info"
            value={packState.reading}
            meaning={packState.reading > 0 ? "nothing to do" : "none in flight"}
          />
          <StatTile
            label="Read failed"
            tone={packState.failed > 0 ? "danger" : "plain"}
            value={packState.failed}
            meaning={packState.failed > 0 ? "a retry charges again" : "none"}
          />
        </div>
      )}

      {/* THE ORDER THESE ARE READ IN, AS THE PAGE ITSELF.
          ==================================================================
          The order is not cosmetic: the preamble gives the conditions the whole
          package is built under, the bill CREATES the records, and the drawings
          attach specs to those records. It was a paragraph above a flat list,
          which is where a sentence about sequence goes to be skimmed.

          As three steps it also makes an ABSENT preamble visible. The Panther
          pack has none — it was not in the curated folder on 15 Sept — and a
          flat list of eleven files cannot say that a twelfth is missing. */}
      <div className="mt-4 rounded-lg border border-neutral-200 bg-white">
        <h2 className="flex items-center border-b border-neutral-200 px-4 py-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
          The order these are read in
          <Tip>
            A drawing extracted before its bill is confirmed is fine — its targets resolve at review time, not at
            extraction.
          </Tip>
        </h2>
        <Step
          done={packSteps.preamble.length > 0}
          n={1}
          title="The preamble"
          meaning="the conditions the whole package is built under"
        >
          {packSteps.preamble.length > 0 ? (
            <>
              {packSteps.preamble.length} document{packSteps.preamble.length === 1 ? "" : "s"}
            </>
          ) : (
            <span className="text-neutral-500">
              Not in this pack. Add it when it reaches the folder — nothing is blocked without one.
            </span>
          )}
        </Step>
        <Step
          done={packSteps.bill.some((run) => run.status === "confirmed")}
          n={2}
          title="The bill of quantities"
          meaning="creates the records everything else attaches to"
        >
          {packSteps.bill.length === 0 ? (
            <span className="text-neutral-500">Not in this pack.</span>
          ) : (
            <>
              {packSteps.bill.map((run) => run.filename ?? "Unnamed file").join(", ")} ·{" "}
              {packSteps.bill.every((run) => run.status === "confirmed") ? "confirmed" : "not confirmed yet"}
            </>
          )}
        </Step>
        <Step
          done={drawingRuns.length > 0 && drawingRuns.every((run) => run.status === "confirmed")}
          n={3}
          title="The drawings"
          meaning="attach specs to those records"
          last
          action={
            drawingRuns.length > 1 ? (
              <Link
                href={`/dashboard/projects/${projectId}/intake/${batchId}/drawings`}
                className={buttonClass("primary", "sm", "no-underline")}
              >
                Review all {drawingRuns.length} together
              </Link>
            ) : undefined
          }
        >
          {drawingRuns.length === 0 ? (
            <span className="text-neutral-500">Not in this pack.</span>
          ) : (
            <>
              {drawingRuns.length} document{drawingRuns.length === 1 ? "" : "s"} ·{" "}
              {packState.reviewed} reviewed, {packState.toReview} waiting for you
              {packState.reading > 0 && <>, {packState.reading} still reading</>}
            </>
          )}
        </Step>
      </div>

      {/* A TABLE, because the job here is comparing one column down the page —
          which of eleven files still wants something. A stacked list makes you
          read every row's prose to find the two that do. */}
      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium w-[42%]">File</th>
              <th className="px-4 py-2 font-medium w-[16%]">Kind</th>
              <th className="px-4 py-2 font-medium w-[18%]">State</th>
              <th className="px-4 py-2 font-medium w-[14%]">What it produced</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(batch?.runs ?? []).map((run) => {
              const readable = run.sourceKind === "spec_document";
              const needsExtract = readable && (run.status === "pending" || run.status === "failed");
              const working = isIntakeRunWorking(run.status);
              // QUEUED WITH AN ERROR is the ambiguous dispatch: the message may
              // or may not have reached the queue, so the attempt is
              // deliberately not failed. Without a way out of it the row spins
              // for ever on something that is never coming.
              const dispatchUncertain = readable && run.status === "queued" && Boolean(run.error);
              return (
                <tr
                  key={run.id}
                  className={
                    run.status === "failed"
                      ? "bg-red-50/40"
                      : run.status === "parsed"
                        ? "bg-amber-50/40"
                        : undefined
                  }
                >
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/dashboard/imports/${run.id}`}
                      className="text-blue-700 no-underline hover:underline"
                    >
                      {run.filename ?? "Unnamed file"}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {new Date(run.createdAt).toLocaleString("en-GB")}
                    </p>
                    {run.error && <p className="mt-1 text-xs text-red-700">{run.error}</p>}
                  </td>
                  <td className="px-4 py-3 align-top text-neutral-700">{kindLabel(run)}</td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-xs ${
                        run.status === "failed"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : run.status === "confirmed"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : run.status === "parsed"
                              ? "border-amber-200 bg-amber-50 text-amber-800"
                              : "border-blue-200 bg-blue-50 text-blue-700"
                      }`}
                    >
                      {intakeStatusLabel(run.status)}
                    </span>
                    {working && !dispatchUncertain && (
                      <span className="ml-2 align-middle">
                        <Spinner label="" />
                      </span>
                    )}
                  </td>
                  {/* NOTHING TO DO is a real answer and says so. A document
                      being read needs nobody, and a blank cell there reads as a
                      row somebody forgot. */}
                  <td className="px-4 py-3 align-top text-xs text-neutral-500">
                    {working
                      ? "nothing to do"
                      : run.status === "failed"
                        ? "a retry charges again"
                        : run.status === "confirmed"
                          ? "review complete"
                          : run.status === "parsed"
                            ? "waiting for you"
                            : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end gap-2">
                      {dispatchUncertain && (
                        <Button
                          size="xs"
                          disabled={busy !== null}
                          onClick={() => void extract(run, "retry-dispatch")}
                          title="Sends the same request again. It charges nothing new, and it will not disturb a worker that already has it."
                        >
                          {busy === run.id ? "Retrying…" : "Retry dispatch"}
                        </Button>
                      )}
                      {needsExtract && (
                        <Button
                          size="xs"
                          variant={run.status === "failed" ? "danger" : "secondary"}
                          disabled={busy !== null}
                          onClick={() => void extract(run)}
                          title="This sends the document to the model, which costs money."
                        >
                          {busy === run.id ? "Starting…" : run.status === "failed" ? "Try again" : "Read it now"}
                        </Button>
                      )}
                      <Link
                        href={`/dashboard/imports/${run.id}`}
                        className={buttonClass(run.status === "parsed" ? "secondary" : "quiet", "xs", "no-underline")}
                      >
                        {run.status === "parsed" ? "Review" : "Open"}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {batch?.runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-neutral-500">
                  This pack has no documents.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Reading is dispatched at upload now, so a document sitting at "Not
          read yet" is one of two things: uploaded before that change, or one
          whose dispatch did not reach the queue. Both are read by this
          button. */}
      <p className="mt-3 text-xs text-neutral-500">
        Anything still saying <em>Not read yet</em> was uploaded before documents were read automatically, or its
        request never reached the queue. Reading it sends it to the model, and each send is charged.
      </p>
    </div>
  );
}
