"use client";
// Adding a sub-quote with no bill behind it.
//
// A phase is a SCOPE, not a spreadsheet tab — `spec_runs.source_import_id` has
// been nullable since 0007 for exactly this reason, and nothing used it until
// 0028. Every phase in the app came from a BOQ confirm, so a project whose
// documents are drawings and emails had nowhere to put an item.
//
// It sits in the tab bar because that is where the phases are, and the reason
// a person wants one is that the phase they need is not in the row.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";

export default function AddRun({
  projectId,
  onAdded,
}: {
  projectId: string;
  onAdded: (runId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A phase needs a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ run: { runId: string } }>(
        `/api/projects/${encodeURIComponent(projectId)}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setOpen(false);
      await onAdded(res.data.run.runId);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm -mb-px border-b-2 border-transparent text-neutral-500 hover:text-neutral-800"
      >
        + Add a phase
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") { setOpen(false); setError(null); }
        }}
        placeholder="MAIN RUN"
        className="border border-neutral-300 rounded px-2 py-1 text-sm w-40"
      />
      <Button variant="primary" size="xs" disabled={saving} onClick={() => void submit()}>
        {saving ? "Adding…" : "Add"}
      </Button>
      <Button variant="quiet" size="xs" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>
        Cancel
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
