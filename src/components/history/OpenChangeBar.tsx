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
//
// ============================================================================
// IT LIVES IN THE HEADER BAND, ON EVERY TAB.
//
// A person starts a change and then goes looking for the item it applies to,
// so it cannot belong to one tab's content — and it is CONSEQUENTIAL, which is
// why it is a `Button` rather than the grey underlined 12px text it used to be,
// fainter on the page than the link beside it to a spreadsheet.
//
// The form opens as a panel anchored under the button rather than as a band
// across the page: the header row is a sentence, and a three-field form laid
// out along it would push the tabs down on every visit for something somebody
// does once a day. `relative`/`absolute` rather than a portal, because the
// header's actions are the only positioned ancestor and there is no scrolling
// container to escape.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import EvidenceUpload, { type UploadedEvidence } from "@/components/history/EvidenceUpload";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";

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

  // A CHANGE IS OPEN, so the header says what everything is being recorded
  // against and offers the one control that ends it. It is not an action to
  // start another: there is at most one open change per person per project.
  if (open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Chip tone="info" title="Everything you change on this project is recorded against this until you finish it.">
          Change open{open.reason ? `: ${open.reason}` : ""}
          {open.recordsChanged > 0 && ` · ${open.recordsChanged} item${open.recordsChanged === 1 ? "" : "s"}`}
        </Chip>
        {open.evidenceFilename && (
          <a href={`/api/change-sets/${open.id}/evidence`} className="text-xs text-blue-700 underline">
            {open.evidenceFilename}
          </a>
        )}
        <Button size="sm" disabled={busy} onClick={() => void send({ action: "close" })}>
          {busy ? "…" : "Finish"}
        </Button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <Button onClick={() => setStarting((value) => !value)}>Start a change</Button>
      {starting && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[26rem] rounded-lg border border-neutral-300 bg-white p-3 text-sm shadow-lg">
          <p className="font-medium text-neutral-900">What is changing, and why?</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Say it once — an email, a call — and everything you edit on this project is recorded against it.
          </p>
          <input
            value={reason}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setStarting(false);
            }}
            placeholder="Hayley's email of 14 Sep — fabric changes on the guestroom seating"
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1"
          />
          <div className="mt-2">
            <EvidenceUpload projectId={projectId} onUploaded={setEvidence} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={!reason.trim() || busy} onClick={() => void start()}>
              {busy ? "Starting…" : "Start"}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setStarting(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </div>
      )}
      {error && !starting && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </span>
  );
}
