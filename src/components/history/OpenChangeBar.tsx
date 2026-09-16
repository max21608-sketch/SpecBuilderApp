"use client";

// "I am working through Hayley's email of the 14th."
//
// Said once, with the email attached, and every edit that follows is recorded
// against it. This is what makes a reason answerable without asking for one on
// every keystroke — the alternative, a box beside each field, collects twenty
// rows reading "update" and teaches people to ignore it.
//
// Closing is explicit. A change left open is not a problem: it simply keeps
// collecting the edits the same person makes on the same project, which is
// what it is for.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import EvidenceUpload, { type UploadedEvidence } from "@/components/history/EvidenceUpload";
import Button from "@/components/ui/Button";

type OpenChange = {
  id: string;
  reason: string | null;
  createdAt: string;
  evidenceFilename: string | null;
  recordsChanged: number;
};

export default function OpenChangeBar({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const [open, setOpen] = useState<OpenChange | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<UploadedEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ open: OpenChange | null }>(`/api/projects/${projectId}/changes`);
    if (!res.ok) {
      setError(res.error);
      setLoaded(true);
      return;
    }
    setError(null);
    setOpen(res.data.open);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/changes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Reload first, then report: this component refreshes itself, and a
      // message set before the reload would be cleared by it.
      await load();
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      setError(null);
      onChanged?.();
      return true;
    } finally {
      // Always reset, so an HTML error page cannot leave the bar frozen.
      setBusy(false);
    }
  }

  async function start() {
    if (!reason.trim()) return;
    const ok = await send({ action: "open", reason: reason.trim(), evidence });
    if (ok) {
      setReason("");
      setEvidence(null);
      setStarting(false);
    }
  }

  if (!loaded) return null;

  if (open) {
    return (
      <div className="mt-3 border border-blue-300 bg-blue-50 rounded-lg px-4 py-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-medium text-blue-900">Change open</span>
          <span className="text-blue-900">{open.reason}</span>
          {open.evidenceFilename && (
            <a href={`/api/change-sets/${open.id}/evidence`} className="text-xs text-blue-800 underline">
              {open.evidenceFilename}
            </a>
          )}
          <span className="text-xs text-blue-800">
            {open.recordsChanged} item{open.recordsChanged === 1 ? "" : "s"} so far
          </span>
          <button
            type="button"
            onClick={() => void send({ action: "close" })}
            disabled={busy}
            className="ml-auto text-xs border border-blue-400 bg-white rounded px-2 py-0.5 hover:bg-blue-100 disabled:opacity-50"
          >
            {busy ? "…" : "Finish"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-blue-800">
          Everything you change on this project is recorded against this until you finish it.
        </p>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  if (!starting) {
    return (
      <div className="mt-3 text-sm">
        {/* An ACTION, and a consequential one: every edit made on this
            project afterwards attaches to it. It was underlined 14px grey text,
            fainter than the link beside it to a spreadsheet. */}
        <Button onClick={() => setStarting(true)}>Start a change</Button>
        <span className="ml-2 text-xs text-neutral-500">
          Say why once — an email, a call — and everything you edit is recorded against it.
        </span>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 border border-neutral-300 rounded-lg bg-white px-4 py-3 text-sm">
      <p className="font-medium text-neutral-900">What is changing, and why?</p>
      <input
        value={reason}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        placeholder="Hayley's email of 14 Sep — fabric changes on the guestroom seating"
        className="mt-2 w-full border border-neutral-300 rounded px-2 py-1"
      />
      <div className="mt-2">
        <EvidenceUpload projectId={projectId} onUploaded={setEvidence} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={!reason.trim() || busy}
          className="border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start"}
        </button>
        <button type="button" onClick={() => setStarting(false)} className="text-neutral-500 hover:text-neutral-900">
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
