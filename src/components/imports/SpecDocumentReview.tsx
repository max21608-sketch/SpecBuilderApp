"use client";

// Reviewing what a model read out of a specification document.
//
// ============================================================================
// WHAT THIS SCREEN REFUSES TO DO
//
// - It never pre-selects an ambiguous match. Ambiguity is CHIPS: every tied
//   candidate as a button, and nothing chosen. Only a confident match pre-fills.
//   A plausible guess sitting in a field a reviewer skims past is worse than an
//   obvious gap, because the gap gets fixed.
// - It never hides a proposal. Every one is in exactly one visible section, and
//   the diagnostic section catches anything that somehow fits none of them: a
//   row held in the run but visible nowhere is one nobody can fix.
// - It never says "complete" when TBC answers remain. The run being finished
//   means nothing is left to REVIEW, which is not the same thing.
// - Blockers render BESIDE the action, not only as a disabled button's tooltip.
//   A greyed-out button with no reason is a screen refusing to explain itself.
//
// AUTOSAVE IS NOT PROOF THAT EDITS SAVED. Dirty text is held separately from
// acknowledged server state, a failure is loud and persistent, and the
// navigation guard stays armed while anything is dirty or failed.
//
// This component is NOT keyed on run.version: every ordinary autosave bumps it,
// and a key on it would remount the whole grid mid-edit.
// ============================================================================
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { usePoll } from "@/lib/use-poll";
import EmailEnvelope, { type EmailMessage } from "@/components/imports/EmailHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import {
  classifyProposal,
  proposalBlockers,
  type Proposal,
  type RecordEntry,
  type RequirementEntry,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { commitGroups, groupIntoSpecRows, type SpecRow } from "@/lib/spec-review-rows";
import type { ChangeDescription } from "@/lib/spec-change";
import Tabs from "@/components/ui/Tabs";
import PageHeader from "@/components/ui/PageHeader";
import PageBody from "@/components/ui/PageBody";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Button from "@/components/ui/Button";
import type { Tone } from "@/components/ui/tone";
import {
  ANSWER_STATES,
  ANSWER_STATE_LABELS,
  ANSWER_STATE_TONE,
  ATTRIBUTE_UNITS,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/lib/spec-vocab";

export type SpecImport = {
  id: string;
  project_id: string;
  status: string;
  version: number;
  error: string | null;
  document_kind: DocumentKind;
  model: string | null;
  model_metadata: { requestId?: string; elapsedMs?: number; proposals?: number } | null;
  attempt_id: string | null;
  claim_count: number;
  within_deadline: boolean | null;
  claim_live: boolean | null;
  bws_project_number: string;
  project_name: string;
  filename: string | null;
  parsed: StagedSpecDocument | null;
};

export type Registers = { records: RecordEntry[]; requirements: RequirementEntry[] };

// Reused from the BOQ review, so one word means one thing on both screens.
const MATCH_LABEL = { confident: "matched", ambiguous: "several possible", none: "no match" } as const;

// The answer state's colour comes from `ANSWER_STATE_TONE`, decided once beside
// the label. The map that used to live here painted `missing` RED, which is the
// disagreement that map exists to settle: red is what blocks money going out,
// and whether an unanswered question does that is the TIER's business, not the
// state's.

type Dirty = { value: string; seq: number };

export default function SpecDocumentReview({
  data,
  reload,
  quietReload,
  crumb,
}: {
  data: { import: SpecImport; registers: Registers; message?: EmailMessage | null };
  reload: () => Promise<void>;
  quietReload: () => Promise<void>;
  /** Where this document came from: the Inbox for an email, its pack otherwise. */
  crumb: { label: string; href: string };
}) {
  const run = data.import;
  const proposals = useMemo(() => run.parsed?.lines ?? [], [run.parsed]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "applied" | "ignored" | "message">("pending");
  // Acknowledged server state per proposal, held apart from what is being typed.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, Dirty>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  // Which spec rows are open. The table is a summary; the per-run controls
  // that can change a value live inside the row, one click away.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Per-proposal edit sequence, so a save response that lands after more typing
  // cannot overwrite the newer text.
  const seq = useRef(0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // One save in flight per proposal, chained: an older response can never be
  // applied after a newer one.
  const chains = useRef<Record<string, Promise<void>>>({});

  const waiting = run.status === "queued" || run.status === "parsing";
  usePoll(() => void quietReload(), { intervalMs: 3000, active: waiting });

  const hasUnsaved = Object.keys(dirty).length > 0 || Object.keys(saveErrors).length > 0;
  useUnsavedChangesWarning(
    hasUnsaved,
    "Some edits on this review have not been saved. Leave without saving them?",
  );

  // The version this screen believes each proposal is at: the one the server
  // ACKNOWLEDGED, not the one first loaded.
  const versionOf = useCallback(
    (proposal: Proposal) => versions[proposal.id] ?? proposal.version,
    [versions],
  );

  const save = useCallback(
    async (proposal: Proposal, changes: Record<string, unknown>, mySeq: number) => {
      const previous = chains.current[proposal.id] ?? Promise.resolve();
      const next = previous.then(async () => {
        const res = await apiFetch<{ proposal: Proposal; version: number }>(`/api/imports/${run.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            proposalId: proposal.id,
            expectedProposalVersion: versions[proposal.id] ?? proposal.version,
            changes,
          }),
        });
        if (!res.ok) {
          // Loud and persistent. The typed text is KEPT so nothing is lost.
          setSaveErrors((current) => ({ ...current, [proposal.id]: res.error }));
          return;
        }
        setVersions((current) => ({ ...current, [proposal.id]: res.data.proposal.version }));
        setSaveErrors((current) => {
          if (!(proposal.id in current)) return current;
          const rest = { ...current };
          delete rest[proposal.id];
          return rest;
        });
        // Only clear the buffer if nothing newer was typed while this was away.
        setDirty((current) => {
          const held = current[proposal.id];
          // Only clear what THIS save covered. Newer typing keeps its buffer.
          if (!held || held.seq !== mySeq) return current;
          const rest = { ...current };
          delete rest[proposal.id];
          return rest;
        });
        await quietReload();
      });
      chains.current[proposal.id] = next.catch(() => {});
      return next;
    },
    [run.id, versions, quietReload],
  );

  function typeValue(proposal: Proposal, value: string) {
    const mySeq = ++seq.current;
    setDirty((current) => ({ ...current, [proposal.id]: { value, seq: mySeq } }));
    clearTimeout(timers.current[proposal.id]);
    timers.current[proposal.id] = setTimeout(() => {
      void save(proposal, { proposedValue: value.trim() === "" ? null : value }, mySeq);
    }, 800);
  }

  /** Flushed and AWAITED before any action that commits — autosave is not proof. */
  async function flush(proposal: Proposal) {
    const held = dirty[proposal.id];
    clearTimeout(timers.current[proposal.id]);
    if (held) {
      await save(proposal, { proposedValue: held.value.trim() === "" ? null : held.value }, held.seq);
    }
    await (chains.current[proposal.id] ?? Promise.resolve());
  }

  async function act(label: string, body: unknown) {
    setBusy(label);
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${run.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(res.error);
        await reload();
        return;
      }
      setVersions({});
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function startExtraction(action: "start" | "retry-dispatch" | "restart-expired") {
    setBusy("extract");
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${run.id}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, requestId: crypto.randomUUID(), action }),
      });
      if (!res.ok) setError(res.error);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  // ---- the grid ------------------------------------------------------------

  /**
   * WHICH TAB. Applied and Ignored were `<details>` blocks below the review
   * table, so on a seven-row email they sat under the whole table and were
   * reached by scrolling past everything still to do. And the MESSAGE itself —
   * the thing every value on this screen was read out of — had nowhere at all:
   * the header strip names the sender and the subject and nothing showed the
   * text. Four states of one document, a tab each.
   */
  const sections = {
    pending: proposals.filter((p) => classifyProposal(p) === "pending"),
    ambiguous: proposals.filter((p) => classifyProposal(p) === "ambiguous"),
    unassigned: proposals.filter((p) => classifyProposal(p) === "unassigned"),
    ignored: proposals.filter((p) => classifyProposal(p) === "ignored"),
    applied: proposals.filter((p) => classifyProposal(p) === "applied"),
    unclassified: proposals.filter((p) => classifyProposal(p) === "unclassified"),
  };

  // ONE ROW PER SPEC, placed or not. The old screen split them into a card
  // stack and a separate amber "Not yet placed" panel, so the seven things
  // this email says were spread across two mental models and a reviewer had to
  // hold which was which. A spec that has not resolved is still a spec the
  // email states; it belongs in the same list, saying so in its own row.
  const rows = groupIntoSpecRows(
    [...sections.pending, ...sections.ambiguous, ...sections.unassigned],
    proposals,
  );
  // The record is STILL the unit of commit. This is the set of whole cards a
  // "confirm everything" would send, one request each.
  const commits = commitGroups(sections.pending);
  const commitBlockers = sections.pending.flatMap((proposal) => proposalBlockers(proposal, proposals));
  const pendingPlaced = sections.pending.length;

  /**
   * One request per record, in label order, stopping at the first refusal.
   *
   * Deliberately NOT one big request: the confirm route takes one record and
   * ALL of its pending proposals and checks that set against the live
   * grouping, which is what stops a card committing that the reviewer never
   * saw whole. The configuration card issues its requests the same way, for
   * the same reason, and reports the same three numbers — because a refusal on
   * the VE run after the main run has been written is a real and recoverable
   * state, and a screen that said only "failed" would hide what landed.
   */
  async function confirmAll() {
    for (const proposal of sections.pending) await flush(proposal);

    let written = 0;
    let refused: string | null = null;
    let attempted = 0;

    setBusy("confirm:all");
    try {
      for (const group of commits) {
        attempted += 1;
        const res = await apiFetch(`/api/imports/${run.id}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
            recordId: group.recordId,
            proposals: group.proposals.map((proposal) => ({ id: proposal.id, version: versionOf(proposal) })),
          }),
        });
        if (!res.ok) {
          refused = `${group.recordLabel}: ${res.error}`;
          break;
        }
        written += group.proposals.length;
      }
    } finally {
      setBusy(null);
    }

    // Reload FIRST, report after: this screen refreshes on every action and a
    // successful load clears the banner, so setting it before the reload shows
    // the message for a few milliseconds and then nothing at all.
    await reload();
    if (refused) {
      const notAttempted = commits.length - attempted;
      setError(
        `${written} ${written === 1 ? "answer" : "answers"} written. Refused on ${refused}` +
          (notAttempted > 0 ? ` ${notAttempted} ${notAttempted === 1 ? "record was" : "records were"} not attempted.` : ""),
      );
    } else {
      setError(null);
    }
  }

  /** Free: no model call, no attempt, nothing charged. See the route's header. */
  async function rematch() {
    setBusy("rematch");
    let outcome: string | null = null;
    try {
      const res = await apiFetch<{ rematched: number; added: number }>(`/api/imports/${run.id}/rematch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version }),
      });
      outcome = res.ok
        ? res.data.rematched === 0
          ? "Nothing matched differently — the bill still has no line these can land on."
          : null
        : res.error;
    } finally {
      setBusy(null);
    }
    // Reload first, report after: a successful load clears the banner.
    await reload();
    setError(outcome);
  }

  // ---- the band -----------------------------------------------------------
  //
  // THE HEADER BELONGS TO THE SCREEN, AND THIS COMPONENT IS THE SCREEN.
  // `PageHeader` is full-bleed and sits OUTSIDE `PageBody`, so it cannot be
  // rendered by the route above while the tabs, the re-match button and the
  // confirm footer all live on state held in here. Lifting that state out to
  // put one band above it would be three props and a second source of truth.
  const message = data.message;
  const isEmail = run.document_kind === "email";
  const sender = message
    ? message.from_name
      ? `${message.from_name} <${message.from_addr ?? "unknown"}>`
      : (message.from_addr ?? "unknown sender")
    : null;
  const received = message?.received_at
    ? new Date(message.received_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const shell = (tabs: React.ReactNode, children: React.ReactNode) => (
    <>
      <PageHeader
        crumbs={[crumb]}
        title={message?.subject?.trim() || run.filename || (isEmail ? "(no subject)" : "Specification document")}
        subtitle={
          <>
            {sender && <>{sender} · </>}
            {received && <>{received} · </>}
            on{" "}
            <Link href={`/dashboard/projects/${run.project_id}`} className="text-blue-700 no-underline hover:underline">
              {run.bws_project_number} — {run.project_name}
            </Link>
            {/* WHY THIS MESSAGE IS ON THIS PROJECT, in the app's own words.
                Routing never breaks its own tie, so a reader has to be able to
                see which signal decided it and disagree with it. */}
            {message?.routing_reason && (
              <>
                {" "}
                <Chip tone="info">auto · {message.routing_reason}</Chip>
              </>
            )}
            {" · "}
            {/* A plain link, not a button: it is a DOWNLOAD of the evidence,
                and nothing on this screen renders an .eml body — it is markup a
                stranger wrote. */}
            <a
              href={message ? `/api/email-messages/${message.id}/mime` : `/api/imports/${run.id}/source`}
              className="text-blue-700 no-underline hover:underline"
            >
              {message ? "open the .eml" : "open the source document"}
            </a>
          </>
        }
        actions={
          rows.length > 0 ? (
            // Says plainly that it is free. Every other button on this screen
            // that touches extraction spends money, so one that does not has to
            // say so or nobody will press it.
            <Button disabled={busy !== null} onClick={() => void rematch()}>
              {busy === "rematch" ? "Matching…" : "Re-match"}
              <span className="font-normal text-neutral-400"> · free</span>
            </Button>
          ) : undefined
        }
        tabs={tabs}
      />
      <PageBody width="wide">{children}</PageBody>
    </>
  );

  // ---- the four body states ------------------------------------------------

  if (run.status === "pending" || run.status === "failed") {
    return shell(
      undefined,
      <Card title="This document has not been read">
        <p className="text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS[run.document_kind] ?? run.document_kind}
        </p>
        {run.status === "failed" && run.error && <Note tone="danger">{run.error}</Note>}
        <p className="mt-3 text-neutral-700">
          Reading this document sends it to the model. Registering it did not; this is the step that
          {run.status === "failed" ? " charges again." : " costs money."}
        </p>
        <Button
          variant="primary"
          className="mt-3"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
        >
          {busy === "extract" ? "Starting…" : run.status === "failed" ? "Retry extraction" : "Extract"}
        </Button>
        {error && <Note tone="danger">{error}</Note>}
      </Card>,
    );
  }

  if (waiting) {
    // An expired claim writes an error while returning the row to `queued`, so
    // an error here is NOT a failure and must not read like one.
    const restartable =
      (run.status === "parsing" && run.claim_live === false) ||
      (run.status === "queued" && run.within_deadline === false) ||
      run.claim_count >= 4;
    const dispatchable = run.status === "queued" && run.claim_count === 0;

    return shell(
      undefined,
      <Card title="Being read">
        <Spinner label="Reading the document" />
        <p className="mt-3 text-neutral-800">
          {run.status === "queued" ? "Queued — starting shortly." : "Reading the document…"}
        </p>
        <p className="mt-1 text-neutral-600">
          A long schedule can take a few minutes. You can leave this page — it carries on without you.
        </p>
        {run.error && <Note tone="plain">Last attempt reported: {run.error}</Note>}
        {(restartable || dispatchable) && (
          <div className="mt-3 flex gap-2">
            {dispatchable && (
              <Button disabled={busy !== null} onClick={() => void startExtraction("retry-dispatch")}>
                Retry dispatch
              </Button>
            )}
            {restartable && (
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => void startExtraction("restart-expired")}
                title="This starts a new attempt and may be charged for another model call."
              >
                Start again (may be charged again)
              </Button>
            )}
          </div>
        )}
        {error && <Note tone="danger">{error}</Note>}
      </Card>,
    );
  }

  /**
   * Ignore everything still pending, in one request.
   *
   * Reversible: an ignored proposal keeps its row and the Ignored tab restores
   * it. That is what makes a bulk dismissal safe here and would not make a bulk
   * CONFIRM safe — a confirm writes answers and each one is a decision.
   */
  async function ignoreAll() {
    for (const proposal of sections.pending) await flush(proposal);
    await act("ignore:all", {
      action: "ignore",
      proposals: sections.pending.map((proposal) => ({ id: proposal.id, version: versionOf(proposal) })),
    });
  }

  if (proposals.length === 0) {
    return shell(
      undefined,
      <>
        <Card title={isEmail ? "Nothing to record" : "No proposals found"}>
          <p className="text-neutral-600">
            The model read {isEmail ? "this email" : (run.filename ?? "this document")} and found nothing it could
            record as a specification value.{" "}
            {run.parsed?.documentNotes ? `It noted: \u201C${run.parsed.documentNotes}\u201D` : ""}
          </p>
          <p className="mt-2 text-neutral-600">
            {isEmail
              ? "That is a normal outcome: most email is not specification. The message is kept either way."
              : "That is a result, not an error — check the document is the one you meant."}
          </p>
        </Card>
        {message && <EmailEnvelope message={message} />}
      </>,
    );
  }

  const runsWritten = new Set(rows.flatMap((row) => row.runs.map((member) => member.runName).filter(Boolean))).size;
  const needsAck = commitBlockers.filter((blocker) => blocker.code === "overwrite" || blocker.code === "replace").length;

  const tabs = (
    // `useState`, not the URL: this strip is nested inside a review component,
    // nothing links into it, and a `?tab=` would be a second address for a
    // screen that already has one.
    <Tabs
      label="Proposals in this document"
      value={tab}
      onChange={setTab}
      items={[
        { id: "pending", label: "To review", count: sections.pending.length || null, tone: "warn" },
        { id: "applied", label: "Applied", count: sections.applied.length || null, tone: "good" },
        { id: "ignored", label: "Ignored", count: sections.ignored.length || null },
        { id: "message", label: message ? "The message" : "The document", count: null },
      ]}
    />
  );

  return shell(
    tabs,
    <>
      {error && <Note tone="danger">{error}</Note>}

      {/* THE FAN-OUT, SAID ONCE AT THE TOP. One code on three runs is three
          records and all three are written together; a reviewer who does not
          know that reads twenty-one proposals as twenty-one problems. */}
      {tab === "pending" && rows.length > 0 && (
        <Note
          tone="info"
          title={`${rows.length} ${rows.length === 1 ? "specification" : "specifications"}, each landing on ${
            runsWritten || 1
          } ${runsWritten === 1 ? "phase" : "phases"}.`}
        >
          {rows[0]?.distinctRuns.length ? (
            <>
              A code on {rows[0].distinctRuns.map((entry) => entry.runName ?? "no phase").join(", ")} is one record per
              phase — a fan-out, written together. Untick a phase whose spec genuinely differs.
            </>
          ) : (
            <>One record per phase is a fan-out, and all of them are written together.</>
          )}
        </Note>
      )}

      {rows.some((row) => row.unplacedCount > 0) && tab === "pending" && (
        <Note tone="warn">
          {rows.filter((row) => row.unplacedCount > 0).length} of these did not find an item on this project. If the
          bill has changed since this was read, or the app has learnt to read something it could not before, press
          Re-match — it re-reads nothing and costs nothing.
        </Note>
      )}

      {run.status === "confirmed" && (
        // Never "complete": nothing is left to REVIEW, which is not the same as
        // every answer being settled.
        <Note tone="good">Review complete — every proposal has been applied or ignored. Some answers may still be TBC.</Note>
      )}

      {run.parsed?.documentNotes && tab === "pending" && <Note tone="plain">{run.parsed.documentNotes}</Note>}

      {/* THE MESSAGE ITSELF, which had nowhere on this screen.
          ==============================================================
          Every value here was read out of it, and `quotedText` on each row is a
          sentence out of it — but the whole text was only ever reachable by
          downloading the .eml. The body is rendered as PLAIN TEXT and never as
          HTML: an .eml body is markup a stranger wrote, which is why both
          routes that serve one set `content-disposition: attachment` and
          `nosniff`. Quoted history is kept and marked rather than stripped,
          because a reply quotes the question it answers. */}
      {tab === "message" && (
        <>
          {message && <EmailEnvelope message={message} />}
          <Card title={message ? "The message, as plain text" : "The document"}>
            {message?.body_text ? (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-sm text-neutral-800">
                {message.body_text}
              </pre>
            ) : (
              <p className="text-neutral-600">
                No plain-text body was recorded for this document.{" "}
                <a href={`/api/imports/${run.id}/source`} target="_blank" rel="noreferrer" className="underline">
                  Open the source document
                </a>{" "}
                instead — it downloads rather than rendering, because its markup is not ours.
              </p>
            )}
          </Card>
        </>
      )}

      {tab === "pending" && (
        <Card flush>
          <SpecReviewTable
            rows={rows}
            all={proposals}
            registers={data.registers}
            dirty={dirty}
            saveErrors={saveErrors}
            busy={busy}
            expanded={expanded}
            onToggleExpand={(key) => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
            onType={typeValue}
            onChange={(proposal, changes) => void save(proposal, changes, ++seq.current)}
            onIgnoreRow={async (row) => {
              for (const member of row.runs) {
                const proposal = proposals.find((p) => p.id === member.proposalId);
                if (proposal) await flush(proposal);
              }
              await act(`ignore:${row.key}`, {
                action: "ignore",
                proposals: row.runs.map((member) => {
                  const proposal = proposals.find((p) => p.id === member.proposalId);
                  return { id: member.proposalId, version: proposal ? versionOf(proposal) : 0 };
                }),
              });
            }}
          />

          {/* THE FOOTER SAYS WHAT CONFIRM WRITES, AND WHAT IS STOPPING IT.
              The record is still the unit of commit: one request per record,
              each carrying that record's whole pending set. Said out loud,
              because "confirm everything" over three runs is three writes and a
              reviewer should know one can be refused while another lands. */}
          {commits.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-[#fcfcfc] px-4 py-3">
              <span className="text-neutral-600">
                <b className="text-neutral-900">
                  {pendingPlaced} {pendingPlaced === 1 ? "spec" : "specs"}
                </b>{" "}
                · writes to {commits.length} {commits.length === 1 ? "record" : "records"} across{" "}
                {runsWritten || 1} {runsWritten === 1 ? "phase" : "phases"}
              </span>
              {commitBlockers.length > 0 && (
                <Chip tone="danger">
                  {needsAck > 0
                    ? `${needsAck} ${needsAck === 1 ? "needs" : "need"} your acknowledgement before it can commit`
                    : `${commitBlockers.length} ${commitBlockers.length === 1 ? "row needs" : "rows need"} attention before this can be confirmed`}
                </Chip>
              )}
              <span className="flex-1" />
              <Button disabled={busy !== null} onClick={() => void ignoreAll()}>
                {busy === "ignore:all" ? "Ignoring…" : "Ignore the rest"}
              </Button>
              <Button
                variant="primary"
                disabled={busy !== null || commitBlockers.length > 0}
                onClick={() => void confirmAll()}
              >
                {busy === "confirm:all" ? "Confirming…" : "Confirm"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {tab === "ignored" && (
        <Card flush>
          {sections.ignored.length === 0 && (
            <p className="px-4 py-6 text-neutral-500">Nothing has been ignored on this document.</p>
          )}
          <ul>
            {sections.ignored.map((proposal) => (
              <li key={proposal.id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2">
                <span className="flex-1 text-neutral-600">
                  {proposal.raw.refRaw ?? "—"} · {proposal.raw.attributeRaw ?? "—"} · {proposal.raw.valueRaw ?? "—"}
                </span>
                <Button
                  size="xs"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`restore:${proposal.id}`, {
                      action: "restore",
                      proposals: [{ id: proposal.id, version: versionOf(proposal) }],
                    })
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "applied" && (
        <Card flush>
          {sections.applied.length === 0 && (
            <p className="px-4 py-6 text-neutral-500">Nothing has been applied from this document yet.</p>
          )}
          <ul>
            {sections.applied.map((proposal) => (
              <li key={proposal.id} className="border-b border-neutral-100 px-4 py-2 text-neutral-600">
                {proposal.target?.recordLabel} · {proposal.target?.requirementPrompt} →{" "}
                <span className="text-neutral-900">{proposal.applied?.value ?? "N/A"}</span>{" "}
                <span className="text-xs">({proposal.applied?.state})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* The diagnostic fallback. It should always be empty; if it is not, a
          proposal is being held in the run and this is the only place it is
          visible. An invisible row is one nobody can fix. */}
      {sections.unclassified.length > 0 && (
        <Note tone="danger" title={`${sections.unclassified.length} rows could not be classified.`}>
          This is a bug — please report it with this import&rsquo;s address.
          <ul className="mt-1 font-mono text-xs">
            {sections.unclassified.map((proposal) => (
              <li key={proposal.id}>{proposal.id}</li>
            ))}
          </ul>
        </Note>
      )}
    </>,
  );
}

// ---- one proposal ------------------------------------------------------------

function ProposalRow({
  proposal,
  all,
  registers,
  record,
  dirtyValue,
  saveError,
  busy,
  onType,
  onChange,
  onIgnore,
}: {
  proposal: Proposal;
  all: Proposal[];
  registers: Registers;
  record: RecordEntry | undefined;
  dirtyValue: string | undefined;
  saveError: string | undefined;
  busy: string | null;
  onType: (proposal: Proposal, value: string) => void;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnore: (proposal: Proposal) => Promise<void>;
}) {
  const blockers = proposalBlockers(proposal, all);
  const questions = registers.requirements.filter((row) => row.categoryId === record?.categoryId);
  const matchStatus = proposal.requirementId
    ? "confident"
    : proposal.requirementCandidates.length > 1
      ? "ambiguous"
      : "none";

  return (
    <li id={`intake-proposal-${proposal.id}`} className="scroll-mt-4 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-neutral-900">{proposal.raw.attributeRaw ?? "unlabelled"}</span>
        <span className="text-neutral-500">
          {/* The document's own words, always. */}
          “{proposal.raw.valueRaw ?? ""}”
        </span>
        <span className="text-xs text-neutral-400">
          {proposal.raw.page ? `page ${proposal.raw.page}` : ""}
          {proposal.raw.sourceSheet ? `${proposal.raw.sourceSheet}${proposal.raw.sourceRow ? ` row ${proposal.raw.sourceRow}` : ""}` : ""}
          {proposal.raw.confidence ? ` · ${proposal.raw.confidence} confidence` : ""}
        </span>
      </div>
      {proposal.raw.note && <p className="mt-1 text-xs text-neutral-600">{proposal.raw.note}</p>}

      <div className="mt-2 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] gap-2 items-start">
        <label className="text-xs text-neutral-500">
          Question
          <Chip className="ml-2">{MATCH_LABEL[matchStatus]}</Chip>
          <select
            value={proposal.requirementId ?? ""}
            disabled={busy !== null}
            onChange={(event) => onChange(proposal, { requirementId: event.target.value || null })}
            className="mt-1 w-full border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
          >
            <option value="">Choose a question…</option>
            {questions.map((question) => (
              <option key={question.id} value={question.id}>
                {question.section ? `${question.section} · ` : ""}
                {question.prompt}
              </option>
            ))}
          </select>
          {/* Ambiguity is CHIPS, never a pre-selection. */}
          {!proposal.requirementId && proposal.requirementCandidates.length > 1 && (
            <span className="mt-1 block text-xs text-amber-800">
              ambiguous match —{" "}
              {proposal.requirementCandidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="xs"
                  className="mr-1"
                  onClick={() => onChange(proposal, { requirementId: candidate.id })}
                >
                  {candidate.label}
                </Button>
              ))}
            </span>
          )}
          {proposal.target && (
            <span className="mt-1 block text-xs text-neutral-500">
              currently{" "}
              <Chip tone={ANSWER_STATE_TONE[proposal.target.answerState ?? "missing"]}>
                {ANSWER_STATE_LABELS[proposal.target.answerState ?? "missing"]}
              </Chip>{" "}
              {proposal.target.answerValue ? `“${proposal.target.answerValue}”` : ""}
            </span>
          )}
        </label>

        <label className="text-xs text-neutral-500">
          Answer to record
          <input
            value={dirtyValue ?? proposal.proposedValue ?? ""}
            disabled={busy !== null || proposal.proposedState === "na"}
            onChange={(event) => onType(proposal, event.target.value)}
            className="mt-1 w-full border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900 disabled:bg-neutral-50"
          />
          <select
            value={proposal.proposedState ?? ""}
            disabled={busy !== null}
            onChange={(event) => onChange(proposal, { proposedState: event.target.value || null })}
            className="mt-1 w-full border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
          >
            <option value="">Choose a state…</option>
            {ANSWER_STATES.filter((state) => state !== "missing").map((state) => (
              <option key={state} value={state}>
                {ANSWER_STATE_LABELS[state]}
              </option>
            ))}
          </select>
          {/* Only when no blocker is already saying it -- `no_state` uses this
              very sentence as its message, and printing both put the same words
              on the row twice. */}
          {proposal.stateReason && !blockers.some((blocker) => blocker.code === "no_state") && (
            <span className="mt-1 block text-xs text-amber-800">{proposal.stateReason}</span>
          )}
          {saveError && (
            <span className="mt-1 block text-xs text-red-700 font-medium">
              Your in-progress edits are not being saved: {saveError}
              {dirtyValue !== undefined && (
                <span className="block font-normal">
                  Yours: “{dirtyValue}” · saved: “{proposal.proposedValue ?? ""}”
                </span>
              )}
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1">
          <Button variant="quiet" size="xs" disabled={busy !== null} onClick={() => void onIgnore(proposal)}>
            Ignore
          </Button>
          {blockers.some((blocker) => blocker.code === "overwrite") && (
            <label className="text-xs text-amber-900 flex items-start gap-1 max-w-[14rem]">
              <input
                type="checkbox"
                checked={proposal.overwriteAcknowledged}
                onChange={(event) => onChange(proposal, { overwriteAcknowledged: event.target.checked })}
                className="mt-0.5"
              />
              Replace the existing answer
            </label>
          )}
        </div>
      </div>

      {blockers.length > 0 && (
        <ul className="mt-2 text-xs text-amber-900">
          {blockers.map((blocker) => (
            <li key={blocker.code}>{blocker.message}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---- the spec table --------------------------------------------------------
//
// ONE ROW PER SPEC. Asked for on 2026-09-17 against the first real email:
// "just a table listing each of the specs and then just list the changes… I
// don't think we need to be going through each spec change like this."
//
// Three things about it are load-bearing, and each is a trap rather than a
// preference:
//
// - THE ROW IS A SUMMARY AND THE CONTROLS ARE STILL THERE. Collapsing seven
//   cards into seven lines is only safe because every control that can change
//   a value — the question picker, the value box, the state select, the
//   overwrite acknowledgement — is one click inside the row, unchanged. A
//   table that could only confirm or ignore would make correcting a misread
//   value impossible, which is the reviewer's whole job.
// - A ROW THAT CANNOT COMMIT SAYS SO ON THE ROW. Blockers render in the row,
//   not only on the disabled button at the bottom. The old screen put a 400
//   in a banner at the top of the page, nowhere near the row it was about.
// - THE VERB COMES FROM THE RECORD. `describeChange` reads the target
//   snapshot, not the model's reasoning paragraph, which is kept but folded
//   away: what a reviewer needs first is whether this is new, a confirmation
//   or an overwrite.
/**
 * What each verb MEANS, in the house colour language.
 *
 * Green is settled — a value provided or confirmed. Amber needs a person: an
 * overwrite, a withdrawal to TBC, a question nothing matched, an item nothing
 * placed. Plain is a repeat, which changes nothing and should not compete for
 * attention with the row above it that does.
 */
const CHANGE_TONE: Record<ChangeDescription["kind"], Tone> = {
  provides: "good",
  confirms: "good",
  changes: "warn",
  repeats: "plain",
  withdraws: "warn",
  not_applicable: "plain",
  no_question: "warn",
  unplaced: "warn",
};

/** The six-column grid the header and every row share. */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_200px_150px_140px_100px] gap-2.5 px-4";

function SpecReviewTable({
  rows,
  all,
  registers,
  dirty,
  saveErrors,
  busy,
  expanded,
  onToggleExpand,
  onType,
  onChange,
  onIgnoreRow,
}: {
  rows: SpecRow[];
  all: Proposal[];
  registers: Registers;
  dirty: Record<string, Dirty>;
  saveErrors: Record<string, string>;
  busy: string | null;
  expanded: Record<string, boolean>;
  onToggleExpand: (key: string) => void;
  onType: (proposal: Proposal, value: string) => void;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnoreRow: (row: SpecRow) => Promise<void>;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-neutral-500">Nothing is waiting to be reviewed on this document.</p>;
  }

  return (
    // A GRID, NOT A TABLE, and that is what removes the trap rather than
    // working around it. The old markup was a `<table>` whose expanded panel
    // and blocker line were each an extra `<tr colSpan={5}>`, which is the
    // shape the drawings card had to learn its way out of. Here the row and its
    // panel are siblings in a bordered block, so there is no column count for a
    // panel to be squeezed into and no `divide-y` to draw a line between a row
    // and its own panel.
    <div>
      <div
        className={`${ROW_GRID} border-b border-neutral-200 bg-[#fcfcfc] py-2 text-th font-semibold uppercase tracking-wider text-neutral-500`}
      >
        <span>What the email says</span>
        <span>Lands on</span>
        <span>Value</span>
        <span>Does what</span>
        <span />
      </div>
      {rows.map((row) => (
        <SpecRowView
          key={row.key}
          row={row}
          isOpen={expanded[row.key] ?? false}
          blocked={row.blockers.length > 0}
          all={all}
          registers={registers}
          dirty={dirty}
          saveErrors={saveErrors}
          busy={busy}
          onToggleExpand={onToggleExpand}
          onType={onType}
          onChange={onChange}
          onIgnoreRow={onIgnoreRow}
        />
      ))}
    </div>
  );
}

/**
 * WHERE THE VALUE LANDS, read off the members rather than off the wording.
 *
 * A dimension lands in a SLOT and all five compose into BWS field 3; a finish
 * lands in a BWS field decided by what the record already holds; everything
 * else answers a checklist question. Those are three different destinations and
 * the column says which, because "Dimensions" beside four slot chips is what
 * makes an "Overall" line that placed W, D and H legible at a glance.
 */
function LandsOn({ row, members }: { row: SpecRow; members: Proposal[] }) {
  const first = members[0];
  const finish = members.find((proposal) => proposal.finish)?.finish;
  // `SpecRow.slots` deliberately holds a finish's BWS FIELD NAME as well as a
  // dimension's slot — both answer "where does this land" — so the branch is
  // chosen on the MEMBER, never on that list. Reading it first printed
  // "Dimensions · COM 3" over a fabric.
  const dimensionSlots = members.map((proposal) => proposal.dimension?.slot).filter(Boolean) as string[];

  if (dimensionSlots.length > 0) {
    return (
      <span>
        Dimensions{" "}
        {[...new Set(dimensionSlots)].map((slot) => (
          <Chip key={slot} tone="live" className="ml-1">
            {slot}
          </Chip>
        ))}
        <span className="mt-0.5 block text-[11px] text-neutral-500">
          {new Set(dimensionSlots).size} {new Set(dimensionSlots).size === 1 ? "slot" : "slots"} · {row.runs.length}{" "}
          {row.runs.length === 1 ? "proposal" : "proposals"}
        </span>
      </span>
    );
  }

  if (finish) {
    return (
      <span>
        {finish.specFieldName ?? "no BWS field"}
        {finish.codeRaw && (
          <Chip mono className="ml-1">
            {finish.codeRaw}
          </Chip>
        )}
        <span className="mt-0.5 block text-[11px] text-neutral-500">
          {row.runs.length} {row.runs.length === 1 ? "proposal" : "proposals"}
        </span>
      </span>
    );
  }

  if (first?.target?.requirementPrompt) {
    return (
      <span>
        {first.target.requirementPrompt}
        <span className="mt-0.5 block text-[11px] text-neutral-500">
          {row.runs.length} {row.runs.length === 1 ? "proposal" : "proposals"}
        </span>
      </span>
    );
  }

  // "Item not found" and "question not matched" are different jobs, and the
  // blocker on the row names which half is missing.
  return <Chip tone="warn">Not placed</Chip>;
}

function SpecRowView({
  row,
  isOpen,
  blocked,
  all,
  registers,
  dirty,
  saveErrors,
  busy,
  onToggleExpand,
  onType,
  onChange,
  onIgnoreRow,
}: {
  row: SpecRow;
  isOpen: boolean;
  blocked: boolean;
  all: Proposal[];
  registers: Registers;
  dirty: Record<string, Dirty>;
  saveErrors: Record<string, string>;
  busy: string | null;
  onToggleExpand: (key: string) => void;
  onType: (proposal: Proposal, value: string) => void;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnoreRow: (row: SpecRow) => Promise<void>;
}) {
  const members = row.runs
    .map((member) => all.find((proposal) => proposal.id === member.proposalId))
    .filter((proposal): proposal is Proposal => Boolean(proposal));

  return (
    <div className={`border-b border-neutral-200 ${blocked ? "bg-amber-50/40" : ""}`.trim()}>
      <div className={`${ROW_GRID} py-2.5`}>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onToggleExpand(row.key)}
            className="text-left font-semibold text-neutral-900 hover:underline"
          >
            {row.attributeRaw ?? "Unlabelled"}
          </button>
          {row.configurationLabel && (
            // A READING of the wording, never a target. 0024's configurations
            // are real records and this email names one; nothing resolves it,
            // because a configuration carries no client ref and may not exist.
            <Chip tone="guess" className="ml-1.5">
              Configuration {row.configurationLabel}
            </Chip>
          )}
          {/* THE SENTENCE IT WAS READ FROM IS THE PROVENANCE. An email has no
              page to turn to, so the quoted line is what makes a proposal
              checkable — it belongs on the row, not behind a disclosure. */}
          {row.quotedText && (
            <p className="mt-1 border-l-2 border-neutral-300 pl-2.5 text-xs italic text-neutral-700">
              “{row.quotedText}”
            </p>
          )}
          {row.note && <p className="mt-1 text-[11px] text-neutral-500">{row.note}</p>}
          {row.varies && (
            // Never averaged. One row genuinely being several decisions is the
            // case most worth saying out loud.
            <p className="mt-1 text-xs text-amber-800">The phases do not agree — open the row.</p>
          )}
        </div>

        <div className="min-w-0 text-neutral-700">
          <LandsOn row={row} members={members} />
        </div>

        <div className="min-w-0 font-mono text-neutral-800">{row.valueRaw ?? "—"}</div>

        <div className="min-w-0">
          <Chip tone={CHANGE_TONE[row.summary.kind]}>{row.summary.label}</Chip>
          {row.summary.was && <span className="mt-0.5 block text-[11px] text-neutral-500">was {row.summary.was}</span>}
        </div>

        <div className="text-right">
          {/* A disclosure toggle, so it stays a bare button and carries no
              colour of its own. It was blue, which in the tone language means
              "the app is suggesting something" — opening a row suggests
              nothing. */}
          <button
            type="button"
            onClick={() => onToggleExpand(row.key)}
            className="text-xs text-neutral-600 hover:text-neutral-900"
          >
            {row.placedCount > 0
              ? `${row.distinctRuns.length} ${row.distinctRuns.length === 1 ? "phase" : "phases"}`
              : "open"}{" "}
            {isOpen ? "▴" : "▾"}
          </button>
          <span className="mt-1 block">
            <Button variant="quiet" size="xs" disabled={busy !== null} onClick={() => void onIgnoreRow(row)}>
              Ignore
            </Button>
          </span>
        </div>
      </div>

      {/* Blockers on the ROW, beside what they are about — not in a banner at
          the top of the page, which is where a 400 used to land. */}
      {blocked && !isOpen && (
        <p className="px-4 pb-2 text-xs text-amber-900">
          {[...new Set(row.blockers.map((blocker) => blocker.message))].join(" ")}
        </p>
      )}

      {isOpen && (
        <div className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
          {/* ProposalRow renders its OWN <li>, so the per-run wrapper is a
              <div> and the <ul> sits inside it. Nesting one <li> in another is
              invalid HTML and React reports it as a hydration error. */}
          <div className="space-y-3">
            {members.map((proposal) => {
              const record = registers.records.find((entry) => entry.id === proposal.recordId);
              return (
                <div key={proposal.id} className="rounded border border-neutral-200 bg-white">
                  <p className="px-3 pt-2 text-th uppercase tracking-wider text-neutral-500">
                    {proposal.runName ?? "No phase"}
                    {proposal.target ? ` · ${proposal.target.recordLabel}` : ""}
                  </p>
                  {proposal.finish ? (
                    <FinishRow
                      proposal={proposal}
                      all={all}
                      busy={busy}
                      onChange={onChange}
                      onIgnore={async () => {
                        await onIgnoreRow({ ...row, runs: row.runs.filter((r) => r.proposalId === proposal.id) });
                      }}
                    />
                  ) : proposal.dimension ? (
                    <DimensionRow
                      proposal={proposal}
                      all={all}
                      busy={busy}
                      onChange={onChange}
                      onIgnore={async () => {
                        await onIgnoreRow({ ...row, runs: row.runs.filter((r) => r.proposalId === proposal.id) });
                      }}
                    />
                  ) : (
                    <ul>
                      <ProposalRow
                        proposal={proposal}
                        all={all}
                        registers={registers}
                        record={record}
                        dirtyValue={dirty[proposal.id]?.value}
                        saveError={saveErrors[proposal.id]}
                        busy={busy}
                        onType={onType}
                        onChange={onChange}
                        onIgnore={async () => {
                          await onIgnoreRow({ ...row, runs: row.runs.filter((r) => r.proposalId === proposal.id) });
                        }}
                      />
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- one dimension, on one record ------------------------------------------
//
// A dimension is not an answer and this is not ProposalRow. It has no question
// to choose and no state to pick: it fills one of five SLOTS, and all five
// compose into BWS field 3 by `composeDimensionCell` at confirm time. What a
// reviewer can do to it is exactly three things — supply a unit the email did
// not state, agree to replace what the slot already holds, or ignore it.
//
// THE UNIT IS THE ONE THAT MATTERS. Nothing in the dimension model ever infers
// a unit from a figure's size, because a wrong unit reads as a real
// measurement and nothing downstream questions it. So a missing unit is amber
// and asked for — and it is NOT a blocker: `composeDimensionCell` renders an
// underived figure verbatim in a bracket saying why, which is a truthful cell
// and better than a card that cannot commit.
function DimensionRow({
  proposal,
  all,
  busy,
  onChange,
  onIgnore,
}: {
  proposal: Proposal;
  all: Proposal[];
  busy: string | null;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnore: () => Promise<void>;
}) {
  const dimension = proposal.dimension;
  if (!dimension) return null;
  const blockers = proposalBlockers(proposal, all);
  const replace = blockers.find((blocker) => blocker.code === "replace");

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Sky is the ordinary working state: a slot the email named outright. */}
        <Chip tone="live" mono>
          {dimension.slot}
        </Chip>
        <span className="text-neutral-900">
          {dimension.tbc ? "TBC" : (dimension.figure ?? "—")}
          {dimension.unit ?? ""}
        </span>
        {dimension.slotSuggested && (
          // The same yellow a guessed slot gets everywhere else: this one came
          // from printed ORDER, not from a prefix the document stated.
          <Chip tone="guess">read from the printed order — check it</Chip>
        )}
        {dimension.unitSource === "reviewer" && <span className="text-xs text-neutral-500">unit set by hand</span>}

        <label className="ml-auto flex items-center gap-1 text-xs text-neutral-600">
          <span className={dimension.unit ? "" : "text-amber-800"}>Unit</span>
          <select
            value={dimension.unit ?? ""}
            disabled={busy !== null}
            onChange={(event) =>
              onChange(proposal, { dimensionUnit: event.target.value === "" ? null : event.target.value })
            }
            className={`border rounded px-1.5 py-1 text-sm ${dimension.unit ? "border-neutral-300" : "border-amber-400 bg-amber-50"}`}
          >
            <option value="">not stated</option>
            {ATTRIBUTE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>

        <Button variant="quiet" size="xs" disabled={busy !== null} onClick={() => void onIgnore()}>
          Ignore
        </Button>
      </div>

      {dimension.qualifier && (
        // Kept, and said out loud: "445" on its own does not say what it
        // measures. This is recorded as a note beside the figure at confirm.
        <p className="mt-1 text-xs text-neutral-600">
          Kept as a note: <span className="text-neutral-800">{dimension.qualifier}</span>
        </p>
      )}

      {!dimension.unit && !dimension.tbc && (
        <p className="mt-1 text-xs text-amber-800">
          The email does not state a unit. Set one, or the cell will show the figure as written and say it could not be
          converted.
        </p>
      )}

      {replace && (
        <label className="mt-2 flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
          <input
            type="checkbox"
            checked={proposal.overwriteAcknowledged}
            disabled={busy !== null}
            onChange={(event) => onChange(proposal, { overwriteAcknowledged: event.target.checked })}
            className="mt-0.5"
          />
          <span>{replace.message}</span>
        </label>
      )}

      {blockers
        .filter((blocker) => blocker.code !== "replace")
        .map((blocker) => (
          <p key={blocker.code} className="mt-1 text-sm text-amber-800">
            {blocker.message}
          </p>
        ))}
    </div>
  );
}

// ---- one finish, on one record ---------------------------------------------
//
// A fabric, timber, metal or piece of hardware. Like a dimension it writes an
// ATTRIBUTE rather than an answer, because it carries a BWS FIELD — COM 1, COM
// 2, Main timber finish — and which slot it takes depends on what the record
// already holds. That is why an alias vocabulary was the wrong fix for these:
// an alias would have to name one slot up front, and the next item contradicts
// it.
//
// `readFinish` only fires on the document's own CODE, so the reviewer is never
// shown a build instruction that has been read as a fabric. The code is shown
// because it is the thing to check against the page, and it is what links the
// row to the project's finishes library.
function FinishRow({
  proposal,
  all,
  busy,
  onChange,
  onIgnore,
}: {
  proposal: Proposal;
  all: Proposal[];
  busy: string | null;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnore: () => Promise<void>;
}) {
  const finish = proposal.finish;
  if (!finish) return null;
  const blockers = proposalBlockers(proposal, all);
  const replace = blockers.find((blocker) => blocker.code === "replace");

  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Violet on purpose, and NOT a tone: the configuration letters carry
            their own palette on this screen (`CONFIGURATION_COLOURS` — A sky, B
            emerald, C violet) and a finish's BWS slot is read beside them, so
            it keeps that palette rather than borrowing one of the eight
            meanings. Do not invent a violet tone for it. */}
        <span className="text-xs px-1.5 py-0.5 rounded border border-violet-300 bg-violet-50 text-violet-800 font-medium">
          {finish.specFieldName ?? "no BWS field"}
        </span>
        {finish.codeRaw && <span className="text-sm font-mono text-neutral-800">{finish.codeRaw}</span>}
        <span className="text-neutral-800">{finish.tbc ? "TBC" : (finish.value ?? "—")}</span>
        {finish.reason && <span className="text-xs text-neutral-500">{finish.reason}</span>}

        <Button
          variant="quiet"
          size="xs"
          className="ml-auto"
          disabled={busy !== null}
          onClick={() => void onIgnore()}
        >
          Ignore
        </Button>
      </div>

      {!finish.specFieldId && (
        // Kept, not refused: 0007 makes the column nullable precisely so an
        // observation with no BWS home is still worth recording against the
        // item. It simply will not reach the export's own cell.
        <p className="mt-1 text-xs text-amber-800">
          Every {finish.group === "material" ? "COM" : "finish"} slot on this item is already filled, so this will be
          recorded against the item but will not reach a BWS column.
        </p>
      )}

      {replace && (
        <label className="mt-2 flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
          <input
            type="checkbox"
            checked={proposal.overwriteAcknowledged}
            disabled={busy !== null}
            onChange={(event) => onChange(proposal, { overwriteAcknowledged: event.target.checked })}
            className="mt-0.5"
          />
          <span>{replace.message}</span>
        </label>
      )}

      {blockers
        .filter((blocker) => blocker.code !== "replace")
        .map((blocker) => (
          <p key={blocker.code} className="mt-1 text-sm text-amber-800">
            {blocker.message}
          </p>
        ))}
    </div>
  );
}
