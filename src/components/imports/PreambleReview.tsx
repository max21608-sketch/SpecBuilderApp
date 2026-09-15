"use client";

// Reviewing a preamble: cutting a client's general conditions into notes that
// sit on the project overview.
//
// There is nothing to resolve here — a preamble states what the whole package
// is built under, not what one item is — so the review is editorial. The
// document's own wording is kept alongside the reviewer's text, because a
// standard, a tolerance or a deadline that somebody paraphrased is one nobody
// can be held to afterwards.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
import Spinner from "@/components/ui/Spinner";
import Disclosure, { DisclosureList } from "@/components/ui/Disclosure";
import { DOCUMENT_KIND_LABELS } from "@/lib/spec-vocab";
import type { PreambleNote, StagedPreamble } from "@/lib/preamble-document";

type Run = {
  id: string;
  status: string;
  version: number;
  error: string | null;
  filename: string | null;
  claim_live: boolean | null;
  within_deadline: boolean | null;
  claim_count: number;
  parsed: StagedPreamble | null;
};

export default function PreambleReview({ importId }: { importId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [blockers, setBlockers] = useState<{ noteId: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { title?: string | null; body?: string | null }>>({});
  const [showIgnored, setShowIgnored] = useState(false);
  const [showApplied, setShowApplied] = useState(false);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    const res = await apiFetch<{ import: Run; blockers?: { noteId: string; message: string }[] }>(
      `/api/imports/${importId}`,
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRun(res.data.import);
    setBlockers(res.data.blockers ?? []);
  }, [importId]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = run?.status === "queued" || run?.status === "parsing";
  usePoll(load, { intervalMs: 3000, active: Boolean(waiting) });

  // Everything pending is selected by default: a preamble is read to be kept,
  // and the reviewer's job is to drop what does not apply rather than to pick
  // out of nineteen pages one at a time.
  useEffect(() => {
    if (!run?.parsed) return;
    setSelected(new Set(run.parsed.notes.filter((note) => note.reviewStatus === "pending").map((note) => note.id)));
  }, [run?.parsed]);

  async function startExtraction(action: "start" | "retry-dispatch" | "restart-expired") {
    if (!run) return;
    setBusy("extract");
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, requestId: crypto.randomUUID(), action }),
      });
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  function queueSave(fn: () => Promise<void>) {
    saveChain.current = saveChain.current.then(fn, fn);
    return saveChain.current;
  }

  async function saveNote(note: PreambleNote, changes: { title?: string | null; body?: string | null }) {
    await queueSave(async () => {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: note.id, expectedVersion: note.version, changes }),
      });
      if (!res.ok) setError(res.error);
      await load();
    });
  }

  async function review(notes: PreambleNote[], action: "confirm" | "ignore" | "restore") {
    if (notes.length === 0) return;
    await saveChain.current;
    setBusy(action);
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, notes: notes.map((note) => ({ id: note.id, version: note.version })) }),
      });
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!run) return error ? <p className="mt-6 text-sm text-red-700">{error}</p> : <Spinner label="Loading" />;

  if (run.status === "pending" || run.status === "failed") {
    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6 text-center">
        <p className="text-sm text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS.preamble}
        </p>
        {run.status === "failed" && run.error && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-left">{run.error}</p>
        )}
        <p className="mt-3 text-sm text-neutral-700">
          Reading this sends it to the model, which is the step that {run.status === "failed" ? "charges again." : "costs money."}
        </p>
        <button
          type="button"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
          className="mt-4 text-sm px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "extract" ? "Starting…" : run.status === "failed" ? "Retry extraction" : "Read the preamble"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  if (waiting) {
    const restartable =
      (run.status === "parsing" && run.claim_live === false) ||
      (run.status === "queued" && run.within_deadline === false) ||
      run.claim_count >= 4;
    // Queued, never claimed: the publish may not have landed, and re-sending
    // the SAME attempt costs nothing new and cannot disturb a worker that
    // already has it. Without this the row spins for the whole 24-hour
    // deadline before `restartable` offers anything -- which stopped being a
    // rare state when every upload began dispatching its own read.
    const dispatchable = run.status === "queued" && run.claim_count === 0 && run.within_deadline !== false;
    return (
      <div className="mt-6 max-w-xl mx-auto border border-neutral-200 rounded-lg bg-white p-6">
        <Spinner label="Reading the preamble" />
        <p className="mt-3 text-sm text-neutral-600">You can leave this page — it carries on without you.</p>
        {dispatchable && (
          <button
            type="button"
            onClick={() => void startExtraction("retry-dispatch")}
            disabled={busy !== null}
            className="mt-4 mr-2 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
            title="Sends the same request again. It charges nothing new, and it will not disturb a worker that already has it."
          >
            {busy === "extract" ? "Retrying…" : "Retry dispatch"}
          </button>
        )}
        {restartable && (
          <button
            type="button"
            onClick={() => void startExtraction("restart-expired")}
            disabled={busy !== null}
            className="mt-4 text-sm px-3 py-1.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-50 disabled:opacity-50"
          >
            Start again (may be charged again)
          </button>
        )}
      </div>
    );
  }

  const staged = run.parsed;
  if (!staged || staged.notes.length === 0) {
    return <p className="mt-6 text-sm text-neutral-700">No requirements were found in this document.</p>;
  }

  const pending = staged.notes.filter((note) => note.reviewStatus === "pending");
  const chosen = pending.filter((note) => selected.has(note.id));
  const blocked = new Set(blockers.map((blocker) => blocker.noteId));

  return (
    <div className="mt-6">
      {error && <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-600">
          {staged.notes.length} requirement{staged.notes.length === 1 ? "" : "s"} · {pending.length} still to review
        </p>
        <a
          href={`/api/imports/${importId}/source`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-neutral-600 hover:text-neutral-900 underline"
        >
          Open the original
        </a>
      </div>

      {staged.documentNotes && (
        <p className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          The model noted: {staged.documentNotes}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {pending.map((note) => {
          const draft = drafts[note.id] ?? {};
          return (
            <li key={note.id} className="border border-neutral-200 rounded-lg bg-white p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(note.id)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(note.id);
                      else next.delete(note.id);
                      return next;
                    })
                  }
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <input
                      value={draft.title !== undefined ? draft.title ?? "" : note.title ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [note.id]: { ...draft, title: event.target.value } }))
                      }
                      onBlur={(event) => {
                        if (event.target.value === (note.title ?? "")) return;
                        void saveNote(note, { title: event.target.value || null });
                      }}
                      placeholder="Untitled requirement"
                      className="font-medium text-sm text-neutral-900 border-b border-transparent hover:border-neutral-300 focus:border-neutral-500 outline-none"
                    />
                    <span className="text-xs text-neutral-500">
                      {note.topic}
                      {note.page && (
                        <>
                          {" · "}
                          <a
                            href={`/api/imports/${importId}/source#page=${note.page}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-neutral-900"
                          >
                            page {note.page}
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                  <textarea
                    value={draft.body !== undefined ? draft.body ?? "" : note.body ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [note.id]: { ...draft, body: event.target.value } }))
                    }
                    onBlur={(event) => {
                      if (event.target.value === (note.body ?? "")) return;
                      void saveNote(note, { body: event.target.value || null });
                    }}
                    rows={3}
                    className="mt-2 w-full text-sm text-neutral-800 border border-neutral-200 rounded px-2 py-1"
                  />
                  {blocked.has(note.id) && (
                    <p className="mt-1 text-xs text-amber-900">A note needs a body, or ignore it.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void review([note], "ignore")}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Ignore
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void review(chosen, "confirm")}
          disabled={busy !== null || chosen.length === 0 || chosen.some((note) => blocked.has(note.id))}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "confirm" ? "Adding…" : `Add ${chosen.length} note${chosen.length === 1 ? "" : "s"} to the project`}
        </button>
        <p className="text-xs text-neutral-500">They appear on the project overview, and can be retired later.</p>
      </div>

      <Collapsed
        title="Ignored"
        open={showIgnored}
        onToggle={() => setShowIgnored((value) => !value)}
        notes={staged.notes.filter((note) => note.reviewStatus === "ignored")}
        onRestore={(note) => void review([note], "restore")}
      />
      <Collapsed
        title="Added"
        open={showApplied}
        onToggle={() => setShowApplied((value) => !value)}
        notes={staged.notes.filter((note) => note.reviewStatus === "applied")}
      />
    </div>
  );
}

function Collapsed({
  title,
  open,
  onToggle,
  notes,
  onRestore,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  notes: PreambleNote[];
  onRestore?: (note: PreambleNote) => void;
}) {
  return (
    <Disclosure title={title} count={notes.length} open={open} onToggle={onToggle}>
      <DisclosureList>
        {notes.map((note) => (
          <li key={note.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1 text-neutral-800">{note.title ?? note.body?.slice(0, 80)}</span>
            {onRestore && (
              <button
                type="button"
                onClick={() => onRestore(note)}
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </DisclosureList>
    </Disclosure>
  );
}
