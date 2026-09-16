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
import EmailHeader, { type EmailMessage } from "@/components/imports/EmailHeader";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import {
  classifyProposal,
  groupByRecord,
  proposalBlockers,
  type Proposal,
  type RecordEntry,
  type RequirementEntry,
  type StagedSpecDocument,
} from "@/lib/spec-document";
import { ANSWER_STATES, ANSWER_STATE_LABELS, DOCUMENT_KIND_LABELS, type AnswerState, type DocumentKind } from "@/lib/spec-vocab";

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

const STATE_CLASS: Record<AnswerState, string> = {
  confirmed: "text-green-700 border-green-300 bg-green-50",
  tbc: "text-amber-800 border-amber-300 bg-amber-50",
  missing: "text-red-700 border-red-300 bg-red-50",
  na: "text-neutral-600 border-neutral-300 bg-neutral-50",
};

type Dirty = { value: string; seq: number };

export default function SpecDocumentReview({
  data,
  reload,
  quietReload,
}: {
  data: { import: SpecImport; registers: Registers; message?: EmailMessage | null };
  reload: () => Promise<void>;
  quietReload: () => Promise<void>;
}) {
  const run = data.import;
  const proposals = useMemo(() => run.parsed?.lines ?? [], [run.parsed]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Acknowledged server state per proposal, held apart from what is being typed.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, Dirty>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});

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

  // ---- the four body states ------------------------------------------------

  if (run.status === "pending" || run.status === "failed") {
    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6 text-center">
        <p className="text-sm text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS[run.document_kind] ?? run.document_kind}
        </p>
        {run.status === "failed" && run.error && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-left">
            {run.error}
          </p>
        )}
        <p className="mt-3 text-sm text-neutral-700">
          Reading this document sends it to the model. Registering it did not; this is the step that
          {run.status === "failed" ? " charges again." : " costs money."}
        </p>
        <button
          type="button"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
          className="mt-4 text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "extract" ? "Starting…" : run.status === "failed" ? "Retry extraction" : "Extract"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
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

    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6">
        <Spinner label="Reading the document" />
        <p className="mt-3 text-sm text-neutral-800">
          {run.status === "queued" ? "Queued — starting shortly." : "Reading the document…"}
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          A long schedule can take a few minutes. You can leave this page — it carries on without you.
        </p>
        {run.error && (
          <p className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
            Last attempt reported: {run.error}
          </p>
        )}
        {(restartable || dispatchable) && (
          <div className="mt-4 flex gap-2">
            {dispatchable && (
              <button
                type="button"
                onClick={() => void startExtraction("retry-dispatch")}
                disabled={busy !== null}
                className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
              >
                Retry dispatch
              </button>
            )}
            {restartable && (
              <button
                type="button"
                onClick={() => void startExtraction("restart-expired")}
                disabled={busy !== null}
                className="text-sm px-3 py-1.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                title="This starts a new attempt and may be charged for another model call."
              >
                Start again (may be charged again)
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  // ---- the grid ------------------------------------------------------------

  const sections = {
    pending: proposals.filter((p) => classifyProposal(p) === "pending"),
    ambiguous: proposals.filter((p) => classifyProposal(p) === "ambiguous"),
    unassigned: proposals.filter((p) => classifyProposal(p) === "unassigned"),
    ignored: proposals.filter((p) => classifyProposal(p) === "ignored"),
    applied: proposals.filter((p) => classifyProposal(p) === "applied"),
    unclassified: proposals.filter((p) => classifyProposal(p) === "unclassified"),
  };

  if (proposals.length === 0) {
    const isEmail = run.document_kind === "email";
    return (
      <div className="mt-4">
        {data.message && <EmailHeader message={data.message} />}
        <div className="mt-4 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6 text-center">
          <p className="font-medium text-neutral-900">
            {isEmail ? "Nothing to record" : "No proposals found"}
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            The model read {isEmail ? "this email" : (run.filename ?? "this document")} and found nothing it could
            record as a specification value.{" "}
            {run.parsed?.documentNotes ? `It noted: “${run.parsed.documentNotes}”` : ""}
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            {isEmail
              ? "That is a normal outcome: most email is not specification. The message is kept either way."
              : "That is a result, not an error — check the document is the one you meant."}
          </p>
        </div>
      </div>
    );
  }

  const groups = groupByRecord(sections.pending);

  return (
    <div className="mt-4">
      {data.message && <EmailHeader message={data.message} />}
      {error && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <p className="text-sm text-neutral-600">
        {sections.pending.length} to review · {sections.applied.length} applied · {sections.ignored.length} ignored
        {run.model_metadata?.elapsedMs ? ` · read in ${Math.round(run.model_metadata.elapsedMs / 1000)}s` : ""} ·{" "}
        <a href={`/api/imports/${run.id}/source`} target="_blank" rel="noreferrer" className="underline">
          open the source document
        </a>
      </p>
      {run.parsed?.documentNotes && (
        <p className="mt-2 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          {run.parsed.documentNotes}
        </p>
      )}
      {run.status === "confirmed" && (
        // Never "complete": nothing is left to REVIEW, which is not the same as
        // every answer being settled.
        <p className="mt-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
          Review complete — every proposal has been applied or ignored. Some answers may still be TBC.
        </p>
      )}

      {groups.map((group) => (
        <RecordCard
          key={group.recordId}
          group={group}
          all={proposals}
          registers={data.registers}
          dirty={dirty}
          saveErrors={saveErrors}
          busy={busy}
          onType={typeValue}
          onChange={(proposal, changes) => void save(proposal, changes, ++seq.current)}
          onIgnore={async (proposal) => {
            await flush(proposal);
            await act(`ignore:${proposal.id}`, {
              action: "ignore",
              proposals: [{ id: proposal.id, version: versionOf(proposal) }],
            });
          }}
          onConfirm={async () => {
            for (const proposal of group.proposals) await flush(proposal);
            await act(`confirm:${group.recordId}`, {
              action: "confirm",
              recordId: group.recordId,
              proposals: group.proposals.map((proposal) => ({ id: proposal.id, version: versionOf(proposal) })),
            });
          }}
        />
      ))}

      <UnplacedSection
        title="Not yet placed"
        explanation="These name an item or an attribute this project could not resolve. They stay here until each is placed or explicitly ignored."
        proposals={[...sections.ambiguous, ...sections.unassigned]}
        registers={data.registers}
        busy={busy}
        versionOf={versionOf}
        onChoose={(proposal, changes) => void save(proposal, changes, ++seq.current)}
        onIgnore={(proposal) =>
          void act(`ignore:${proposal.id}`, {
            action: "ignore",
            proposals: [{ id: proposal.id, version: versionOf(proposal) }],
          })
        }
      />

      {sections.ignored.length > 0 && (
        <details className="mt-6 border border-neutral-200 rounded-lg bg-white">
          <summary className="px-4 py-2 text-sm font-medium text-neutral-800 cursor-pointer">
            Ignored ({sections.ignored.length})
          </summary>
          <ul className="border-t border-neutral-100 divide-y divide-neutral-100">
            {sections.ignored.map((proposal) => (
              <li key={proposal.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="flex-1 text-neutral-600">
                  {proposal.raw.refRaw ?? "—"} · {proposal.raw.attributeRaw ?? "—"} · {proposal.raw.valueRaw ?? "—"}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`restore:${proposal.id}`, {
                      action: "restore",
                      proposals: [{ id: proposal.id, version: versionOf(proposal) }],
                    })
                  }
                  className="text-sm px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {sections.applied.length > 0 && (
        <details className="mt-4 border border-neutral-200 rounded-lg bg-white">
          <summary className="px-4 py-2 text-sm font-medium text-neutral-800 cursor-pointer">
            Applied ({sections.applied.length})
          </summary>
          <ul className="border-t border-neutral-100 divide-y divide-neutral-100 text-sm">
            {sections.applied.map((proposal) => (
              <li key={proposal.id} className="px-4 py-2 text-neutral-600">
                {proposal.target?.recordLabel} · {proposal.target?.requirementPrompt} →{" "}
                <span className="text-neutral-900">{proposal.applied?.value ?? "N/A"}</span>{" "}
                <span className="text-xs">({proposal.applied?.state})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* The diagnostic fallback. It should always be empty; if it is not, a
          proposal is being held in the run and this is the only place it is
          visible. An invisible row is one nobody can fix. */}
      {sections.unclassified.length > 0 && (
        <div className="mt-4 border border-red-300 bg-red-50 rounded-lg p-4">
          <p className="text-sm font-medium text-red-900">
            {sections.unclassified.length} row{sections.unclassified.length === 1 ? "" : "s"} could not be
            classified. This is a bug — please report it with this import&rsquo;s address.
          </p>
          <ul className="mt-2 text-xs text-red-800 font-mono">
            {sections.unclassified.map((proposal) => (
              <li key={proposal.id}>{proposal.id}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- one record's card -------------------------------------------------------

function RecordCard({
  group,
  all,
  registers,
  dirty,
  saveErrors,
  busy,
  onType,
  onChange,
  onIgnore,
  onConfirm,
}: {
  group: { recordId: string; recordLabel: string; proposals: Proposal[] };
  all: Proposal[];
  registers: Registers;
  dirty: Record<string, Dirty>;
  saveErrors: Record<string, string>;
  busy: string | null;
  onType: (proposal: Proposal, value: string) => void;
  onChange: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnore: (proposal: Proposal) => Promise<void>;
  onConfirm: () => Promise<void>;
}) {
  const record = registers.records.find((row) => row.id === group.recordId);
  const blockers = group.proposals.flatMap((proposal) =>
    proposalBlockers(proposal, all).map((blocker) => ({ proposal, blocker })),
  );
  const unsaved = group.proposals.some((proposal) => dirty[proposal.id] || saveErrors[proposal.id]);

  return (
    <section
      // Anchored on the RECORD's uuid, so an IssueLink lands on the exact card
      // no matter how the list has been filtered since.
      id={`intake-record-${group.recordId}`}
      className="scroll-mt-4 mt-6 border border-neutral-200 rounded-lg bg-white"
    >
      <header className="px-4 py-3 border-b border-neutral-100 flex items-baseline gap-2">
        <Link href={`/dashboard/records/${group.recordId}`} className="font-medium text-neutral-900 underline">
          {group.recordLabel}
        </Link>
        <span className="text-sm text-neutral-500">
          {record?.refs.join(", ")} · {record?.itemDescription} · {record?.categoryName ?? "no category"}
        </span>
      </header>

      <ul className="divide-y divide-neutral-100">
        {group.proposals.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            proposal={proposal}
            all={all}
            registers={registers}
            record={record}
            dirtyValue={dirty[proposal.id]?.value}
            saveError={saveErrors[proposal.id]}
            busy={busy}
            onType={onType}
            onChange={onChange}
            onIgnore={onIgnore}
          />
        ))}
      </ul>

      <footer className="px-4 py-3 border-t border-neutral-100 flex items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || blockers.length > 0}
          onClick={() => void onConfirm()}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === `confirm:${group.recordId}` ? "Confirming…" : `Confirm ${group.proposals.length} answer${group.proposals.length === 1 ? "" : "s"}`}
        </button>
        {unsaved && <span className="text-xs text-amber-800">Unsaved edits will be saved first.</span>}
        {/* BESIDE the action, not in a disabled button's tooltip -- but a COUNT,
            not a repeat: each blocker is already printed on its own row, and
            restating them here put the same sentence on screen three times. */}
        {blockers.length > 0 && (
          <p className="text-xs text-amber-900">
            {blockers.length} thing{blockers.length === 1 ? "" : "s"} to resolve above before this record can be
            confirmed.
          </p>
        )}
      </footer>
    </section>
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
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-neutral-300 bg-neutral-50 text-neutral-600">
            {MATCH_LABEL[matchStatus]}
          </span>
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
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onChange(proposal, { requirementId: candidate.id })}
                  className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                >
                  {candidate.label}
                </button>
              ))}
            </span>
          )}
          {proposal.target && (
            <span className="mt-1 block text-xs text-neutral-500">
              currently{" "}
              <span className={`px-1.5 py-0.5 rounded border ${STATE_CLASS[proposal.target.answerState ?? "missing"]}`}>
                {ANSWER_STATE_LABELS[proposal.target.answerState ?? "missing"]}
              </span>{" "}
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
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onIgnore(proposal)}
            className="text-sm px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
          >
            Ignore
          </button>
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

// ---- the unplaced ------------------------------------------------------------

function UnplacedSection({
  title,
  explanation,
  proposals,
  registers,
  busy,
  versionOf,
  onChoose,
  onIgnore,
}: {
  title: string;
  explanation: string;
  proposals: Proposal[];
  registers: Registers;
  busy: string | null;
  versionOf: (proposal: Proposal) => number;
  onChoose: (proposal: Proposal, changes: Record<string, unknown>) => void;
  onIgnore: (proposal: Proposal) => void;
}) {
  if (proposals.length === 0) return null;
  return (
    <section className="mt-6 border border-amber-200 bg-amber-50 rounded-lg">
      <header className="px-4 py-3 border-b border-amber-100">
        <p className="font-medium text-amber-900">
          {title} ({proposals.length})
        </p>
        <p className="text-sm text-amber-900">{explanation}</p>
      </header>
      <ul className="divide-y divide-amber-100">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium text-neutral-900">{proposal.raw.refRaw ?? "no reference"}</span>
              <span className="text-neutral-700">{proposal.raw.attributeRaw ?? "unlabelled"}</span>
              <span className="text-neutral-500">“{proposal.raw.valueRaw ?? ""}”</span>
              <span className="text-xs text-neutral-400">
                {proposal.raw.page ? `page ${proposal.raw.page}` : proposal.raw.sourceSheet ?? ""}
              </span>
            </div>
            {proposal.raw.note && <p className="mt-1 text-xs text-neutral-600">{proposal.raw.note}</p>}

            {proposal.recordCandidates.length > 1 && (
              <p className="mt-1 text-xs text-amber-900">
                ambiguous match —{" "}
                {proposal.recordCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onChoose(proposal, { recordId: candidate.id })}
                    className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                  >
                    {candidate.label}
                  </button>
                ))}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={proposal.recordId ?? ""}
                disabled={busy !== null}
                onChange={(event) => onChoose(proposal, { recordId: event.target.value || null })}
                className="border border-neutral-300 rounded px-2 py-1 text-sm bg-white"
              >
                <option value="">Choose a record…</option>
                {registers.records.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.label} · {record.refs.join(", ")} · {record.itemDescription}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onIgnore(proposal)}
                className="text-sm px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-50"
              >
                Ignore
              </button>
              <span className="text-xs text-neutral-500">v{versionOf(proposal)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
