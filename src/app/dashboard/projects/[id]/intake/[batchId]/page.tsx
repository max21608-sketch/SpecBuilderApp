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
import Note from "@/components/ui/Note";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import Button, { buttonClass } from "@/components/ui/Button";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { hasPendingReview, isIntakeRunInFlight, isIntakeRunWorking, isReviewComplete, packTally } from "@/lib/intake-status";
import PackSummary from "@/components/imports/PackSummary";
import DocumentState from "@/components/imports/DocumentState";
import { formatDay } from "@/lib/format-day";
import PageBody from "@/components/ui/PageBody";

type Run = {
  id: string;
  sourceKind: string;
  documentKind: DocumentKind | null;
  status: string;
  error: string | null;
  filename: string | null;
  createdAt: string;
  /**
   * How many proposals on this document are still pending — from the staged
   * JSON, counted by the batches route. ABSENT is not zero: a payload that does
   * not carry one must not read as a finished review.
   */
  pendingReview?: number | null;
  /** `pending` because the pack is at its in-flight cap, not because nobody asked. */
  waitingForSlot?: boolean | null;
};

type Batch = { id: string; label: string | null; created_at: string; created_by: string | null; runs: Run[] };

/** Enough of the project to say where this pack sits. */
type ProjectHead = { id: string; bws_project_number: string | null; name: string };

/** How many document rows are shown before the fold. */
const SHOWN_BEFORE_FOLD = 8;

/**
 * One stage of the reading order.
 *
 * `done` is a fact about the documents, never about whether the stage EXISTS:
 * an absent preamble is not a finished one, so it renders undone with its
 * absence in words. A tick over a stage with no document would be the empty
 * programme error in a third place.
 *
 * `current` is the stage the pack is ON, and it is deliberately NOT simply "the
 * first one that is not done". An absent preamble is neither finished nor the
 * thing to do next — nothing is blocked without one — so a stage with no
 * document is never current, and a pack whose preamble never arrives still
 * points at the drawings.
 */
function Step({
  n,
  done,
  current,
  title,
  meaning,
  children,
  action,
  last,
}: {
  n: number;
  done: boolean;
  current: boolean;
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
            ? "border-green-200 bg-green-50 text-green-700"
            : current
              ? "border-neutral-900 bg-neutral-900 text-white"
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

/**
 * What a row still wants, in the reader's words.
 *
 * "Nothing to do" is PRINTED rather than left blank: a document being read
 * needs nobody, and an empty cell there reads as a row somebody forgot.
 *
 * It reads the PENDING COUNT before the status, for the reason
 * `documentReviewLabel` does: "review complete" beside outstanding proposals is
 * the tick Matthew read off this screen (found-in-use 4), and a status alone
 * cannot tell a document somebody finished from one they opened and left.
 */
function produced(run: Run): string {
  if (isIntakeRunWorking(run.status)) return "nothing to do";
  if (run.status === "failed") return "a retry charges again";
  if (hasPendingReview(run)) return "waiting for you";
  if (run.status === "confirmed") return "review complete";
  if (run.status === "parsed") return "waiting for you";
  return "—";
}

export default function IntakeBatchPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const [projectId, setProjectId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [project, setProject] = useState<ProjectHead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Loaded-and-absent is a different answer from not-loaded-yet. Without it a
  // pack id that is not on this project spun for ever on a request that had
  // already come back.
  const [loaded, setLoaded] = useState(false);

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
    setLoaded(true);
  }, [projectId, batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The crumb's own read. A pack belongs to a project and the way back has to
  // name it; a failure here leaves the crumb reading "the project" rather than
  // breaking the screen, because nothing on it depends on the project's row.
  useEffect(() => {
    if (!projectId) return;
    void apiFetch<{ project: ProjectHead }>(`/api/projects/${projectId}`).then((res) => {
      if (res.ok) setProject(res.data.project);
    });
  }, [projectId]);

  // Only while something is actually in flight -- INCLUDING a document waiting
  // for a slot, which starts on its own (isIntakeRunInFlight says why). A
  // settled pack polls nothing.
  const inFlight = (batch?.runs ?? []).some((run) => isIntakeRunInFlight(run));
  usePoll(load, { intervalMs: 3000, active: inFlight });

  /** Returns whether the attempt was accepted, so a caller doing several can stop. */
  async function extract(run: Run, action: "start" | "retry-dispatch" = "start"): Promise<boolean> {
    setBusy(run.id);
    setError(null);
    try {
      // The version is read fresh: this screen does not hold one, and the
      // extract route refuses a mismatch rather than starting a second attempt.
      const current = await apiFetch<{ import: { version: number } }>(`/api/imports/${run.id}`);
      if (!current.ok) {
        setError(current.error);
        return false;
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
      // Reload FIRST, report after: `load()` clears the banner on success, so
      // setting it before the reload showed a refusal — "This document is
      // already being read", the one a person most needs to see — for a few
      // milliseconds and then nothing at all, leaving the row looking as
      // though the click had not registered. The reload is still required: a
      // refused request means this screen is out of date. Same rule as both
      // drawings screens and the record screen.
      await load();
      if (!res.ok) setError(res.error);
      return res.ok;
    } finally {
      // Always reset: an HTML error page must not leave the button spinning.
      setBusy(null);
    }
  }

  /**
   * Retry every failed read, one after another.
   *
   * It is the EXISTING per-row action, N times — not a new route and not a
   * batch one. Sequential because each retry is a charged model call and
   * firing eleven at once is the un-rate-limited enqueue path this app already
   * has a note about.
   *
   * It stops at the FIRST refusal, on the return value rather than on `error`:
   * the state read inside this loop is the one captured at render, so testing
   * the banner here would never see the failure it just caused. A refusal that
   * applies to one of them usually applies to all, and each attempt costs.
   */
  async function retryAllFailed() {
    for (const run of (batch?.runs ?? []).filter((row) => row.status === "failed")) {
      if (!(await extract(run))) break;
    }
  }

  const runs = batch?.runs ?? [];
  const drawingRuns = runs.filter((run) => run.documentKind === "shop_drawings");

  /** The three stages, in reading order. A stage with no document says so. */
  const packSteps = {
    preamble: runs.filter((run) => run.documentKind === "preamble"),
    bill: runs.filter((run) => run.sourceKind === "boq_xlsx"),
  };

  // What the pack is waiting on, counted ONCE, by `packTally` — the same
  // function `PackSummary` calls, so the sentence and the tiles cannot
  // disagree. It used to be an inline reducer here and that is exactly how they
  // would have.
  const packState = packTally(runs);
  // The drawings step counts DRAWINGS. It used to print the pack's own totals
  // beside the drawing count, so a pack of two drawings read "2 documents · 3
  // reviewed" — a number nobody could make add up, because the third was the
  // bill.
  const drawingState = packTally(drawingRuns);

  // A STAGE IS TICKED ONLY WHERE EVERY DOCUMENT IN IT IS REVIEWED AND HAS
  // NOTHING LEFT PENDING. `isReviewComplete` is both halves: the status alone
  // is the tick found-in-use 4 is about, and an empty pending list alone is
  // true of a document nobody has read.
  const stepDone = {
    preamble: packSteps.preamble.length > 0,
    bill: packSteps.bill.length > 0 && packSteps.bill.every(isReviewComplete),
    drawings: drawingRuns.length > 0 && drawingRuns.every(isReviewComplete),
  };
  // The stage the pack is on: the first that has documents and is not finished.
  const currentStep = !stepDone.bill && packSteps.bill.length > 0
    ? "bill"
    : !stepDone.drawings && drawingRuns.length > 0
      ? "drawings"
      : null;

  const drawingsHref = `/dashboard/projects/${projectId}/intake/${batchId}/drawings`;
  const shown = showAll ? runs : runs.slice(0, SHOWN_BEFORE_FOLD);

  if (!batch && !error && !loaded) return <Spinner label="Loading the pack" />;
  if (!batch && !error) {
    return (
      <PageBody>
        <Note tone="warn" title="That pack is not on this project.">
          It may have been delivered to another one, or the link may be out of date.{" "}
          <Link href={`/dashboard/projects/${projectId}?tab=documents`} className="underline">
            The project&rsquo;s documents
          </Link>{" "}
          lists every pack it has.
        </Note>
      </PageBody>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[
          {
            label: project
              ? `${project.bws_project_number ?? "Project"} — ${project.name}`
              : "The project",
            href: `/dashboard/projects/${projectId}`,
          },
        ]}
        title={batch ? `Pack delivered ${formatDay(batch.created_at.slice(0, 10))}` : "Intake pack"}
        subtitle={
          // WHO DELIVERED IT, not what state it is in. The subtitle used to
          // assert that "every specification document was read on arrival",
          // which is false on exactly the pack that matters — one where a read
          // failed. What the pack adds up to is `PackSummary`, one line, below.
          batch && (
            <>
              {batch.created_by ? `Uploaded by ${batch.created_by} · ` : ""}
              every specification document is read on arrival
            </>
          )
        }
        actions={
          <>
            {/* Upload lives on the project, and it starts a NEW pack rather than
                joining this one — `IntakeBatchUpload` takes no batch id. So the
                label says what the click does; "Add to this pack" would promise
                something the app has never done. */}
            <Link
              href={`/dashboard/projects/${projectId}?tab=documents`}
              className={buttonClass("secondary", "sm", "no-underline")}
            >
              Add more documents
            </Link>
            {drawingRuns.length > 0 && (
              <Link href={drawingsHref} className={buttonClass("primary", "sm", "no-underline")}>
                Review all {drawingRuns.length} drawing{drawingRuns.length === 1 ? "" : "s"} together
              </Link>
            )}
          </>
        }
      />

      <PageBody>
        {error && <Note tone="danger">{error}</Note>}

        {/* THE PACK IN ONE LINE — found-in-use 5. It reads from the same runs
            the table does, re-tallied on every render, so the three-second poll
            moves it without anything else being wired up. */}
        <PackSummary runs={runs} busy={busy !== null} onRetryFailed={() => void retryAllFailed()} />

        {/* WHAT THIS PACK WANTS FROM YOU, at a glance.
            ==================================================================
            Reading is dispatched at upload, so most of the time the answer is
            "nothing" — and a screen of file rows makes you work that out by
            reading every status. The tiles say it in four numbers, and the only
            one that is ever a call to action is the one that failed. A document
            being READ is deliberately shown as information rather than as work:
            it needs nobody, and offering a button beside it would invite a
            second charged call for a read that is already running. */}
        {runs.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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
            The order is not cosmetic: the preamble gives the conditions the
            whole package is built under, the bill CREATES the records, and the
            drawings attach specs to those records. It was a paragraph above a
            flat list, which is where a sentence about sequence goes to be
            skimmed.

            As three steps it also makes an ABSENT preamble visible. The Panther
            pack has none — it was not in the curated folder on 15 Sept — and a
            flat list of eleven files cannot say that a twelfth is missing. */}
        <Card
          flush
          title={
            <>
              The order these are read in
              <Tip>
                A drawing extracted before its bill is confirmed is fine — its targets resolve at review time, not
                at extraction.
              </Tip>
            </>
          }
        >
          <Step
            done={stepDone.preamble}
            current={false}
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
            done={stepDone.bill}
            current={currentStep === "bill"}
            n={2}
            title="The bill of quantities"
            meaning="creates the records everything else attaches to"
          >
            {packSteps.bill.length === 0 ? (
              <span className="text-neutral-500">Not in this pack.</span>
            ) : (
              <>
                {packSteps.bill.map((run) => run.filename ?? "Unnamed file").join(", ")} ·{" "}
                {stepDone.bill ? "confirmed" : "not confirmed yet"}
                {/* TWO BILLS IN ONE PACK — variance matrix §6.10.a row 9.
                    Both stage, and NOTHING pairs them: which is a revision of
                    which is a person's call, taken on the bill's own review
                    screen where the phase to revise is chosen. Said here
                    because this is the screen that lists what arrived, and two
                    bills read as an accident otherwise — the reviewer's next
                    move is either to drop one or to mark one a revision, and
                    confirming both as new phases quietly doubles the project. */}
                {packSteps.bill.length > 1 && (
                  <span className="mt-0.5 block text-amber-800">
                    {packSteps.bill.length} bills arrived in this pack. Each becomes its own phase unless somebody
                    says otherwise — which is a revision of which is your call, on the bill&rsquo;s own review
                    screen. Nothing has been paired.
                  </span>
                )}
              </>
            )}
          </Step>
          <Step
            done={stepDone.drawings}
            current={currentStep === "drawings"}
            n={3}
            title="The drawings"
            meaning="attach specs to those records"
            last
            action={
              // SECONDARY, not primary — the header carries the same link and
              // the same words, and the screen had two dark fills
              // (`found-in-use.md`, 2026-09-20, named there as 1.6's). §0.3:
              // one primary per screen, and it is the next step. It stays HERE
              // as well as in the header because a control belongs beside the
              // thing it acts on, and this is the row that says how many
              // drawings are waiting.
              drawingRuns.length > 1 ? (
                <Link href={drawingsHref} className={buttonClass("secondary", "sm", "no-underline")}>
                  Review all {drawingRuns.length} together
                </Link>
              ) : undefined
            }
          >
            {drawingRuns.length === 0 ? (
              <span className="text-neutral-500">Not in this pack.</span>
            ) : (
              <>
                {drawingRuns.length} document{drawingRuns.length === 1 ? "" : "s"} · {drawingState.reviewed} reviewed,{" "}
                {drawingState.toReview} waiting for you
                {drawingState.reading > 0 && <>, {drawingState.reading} still reading</>}
              </>
            )}
          </Step>
        </Card>

        {/* A TABLE, because the job here is comparing one column down the page —
            which of eleven files still wants something. A stacked list makes you
            read every row's prose to find the two that do. */}
        <Card flush title={<>Documents <CardHeadingNote>{runs.length}</CardHeadingNote></>}>
          <Table>
            <thead>
              <tr>
                <Th className="w-[42%]">File</Th>
                <Th className="w-[16%]">Kind</Th>
                <Th className="w-[18%]">State</Th>
                <Th className="w-[14%]">What it produced</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((run) => {
                const readable = run.sourceKind === "spec_document";
                const needsExtract = readable && (run.status === "pending" || run.status === "failed");
                const working = isIntakeRunWorking(run.status);
                // QUEUED WITH AN ERROR is the ambiguous dispatch: the message
                // may or may not have reached the queue, so the attempt is
                // deliberately not failed. Without a way out of it the row spins
                // for ever on something that is never coming.
                const dispatchUncertain = readable && run.status === "queued" && Boolean(run.error);
                return (
                  // Tinted by what the row wants: amber needs review, red needs
                  // a retry. Everything else is plain, because a row that wants
                  // nothing should not compete with the two that do.
                  <Tr
                    key={run.id}
                    tone={
                      run.status === "failed"
                        ? "danger"
                        : run.status === "parsed" || hasPendingReview(run)
                          ? "warn"
                          : "plain"
                    }
                  >
                    <Td>
                      <Link href={`/dashboard/imports/${run.id}`} className="text-blue-700 no-underline hover:underline">
                        {run.filename ?? "Unnamed file"}
                      </Link>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        {new Date(run.createdAt).toLocaleString("en-GB")}
                      </span>
                    </Td>
                    <Td>{kindLabel(run)}</Td>
                    <Td>
                      <DocumentState run={run} uncertain={dispatchUncertain} />
                    </Td>
                    <Td muted className="text-xs">
                      {produced(run)}
                    </Td>
                    <Td>
                      <div className="flex items-start justify-end gap-2">
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
                          <span className="text-right">
                            <Button
                              size="xs"
                              variant={run.status === "failed" ? "danger" : "secondary"}
                              disabled={busy !== null}
                              onClick={() => void extract(run)}
                              title="This sends the document to the model, which costs money."
                            >
                              {busy === run.id ? "Starting…" : run.status === "failed" ? "Try again" : "Read it now"}
                            </Button>
                            <span className="mt-1 block text-[10.5px] text-neutral-500">charges again</span>
                          </span>
                        )}
                        {working ? (
                          <span className="text-[11.5px] text-neutral-500">nothing to do</span>
                        ) : (
                          <Link
                            href={`/dashboard/imports/${run.id}`}
                            className={buttonClass(
                              run.status === "parsed" || hasPendingReview(run) ? "secondary" : "quiet",
                              "xs",
                              "no-underline",
                            )}
                          >
                            {run.status === "parsed" || hasPendingReview(run) ? "Review" : "Open"}
                          </Link>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <Td colSpan={5} muted>
                    This pack has no documents.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          {/* The fold, not a page. A pack of eleven is read as a list; a pack of
              thirty is read for the two rows that want something, and those are
              tinted and counted above. */}
          {runs.length > SHOWN_BEFORE_FOLD && (
            <div className="px-4 py-2.5">
              <Button variant="quiet" size="xs" onClick={() => setShowAll((on) => !on)}>
                {showAll ? "Show fewer" : `${runs.length - SHOWN_BEFORE_FOLD} more`}
              </Button>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}
