"use client";
// Setting a project's finishes library out at the start, from a pasted list.
//
// Matthew's first bullet: "Project finishes I think are the way to go; set
// these out from the outset." A project's codes come off a finishes schedule,
// an email or a spreadsheet, and until now they arrived one at a time through
// a single-code box, or not at all — which is why every finish in the sandbox
// came from a drawing confirm and none was ever set out in advance.
//
// PREVIEW FIRST, ALWAYS. The library's whole point is edit-once: correcting a
// code corrects every item carrying it. A box that silently created thirty
// rows, some of them duplicates of codes the project already holds, would be
// the opposite of that.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import type { BulkPreview } from "@/lib/finish-bulk";

const STATUS_CLASS: Record<string, string> = {
  new: "text-green-700",
  "already held": "text-neutral-500",
  "repeated in this list": "text-amber-800",
};

export default function BulkAddFinishes({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function call(action: "preview" | "create") {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<BulkPreview & { created?: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/finishes/bulk`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, text }),
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview({ rows: res.data.rows, newCount: res.data.newCount });
      if (action === "create") {
        setDone(res.data.created ?? 0);
        await onCreated();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Set out the library
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-3">
      <p className="text-sm font-medium text-neutral-800">Set the library out from a list</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        One code per line. A description after a tab, a comma or a spaced dash. Nothing is filed as a fabric or a
        timber — nothing infers that, so you pick afterwards.
      </p>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setPreview(null);
          setDone(null);
        }}
        rows={6}
        disabled={busy}
        placeholder={"WD-05 - Natural oak\nCH-01.1, Ceruse finish oak\nMT-02\tAntique brass"}
        className="mt-2 block w-full border border-neutral-300 rounded px-2 py-1 text-sm font-mono disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy || !text.trim()} onClick={() => void call("preview")}>
          {busy ? "…" : "Check the list"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          // Only after a preview: nothing is created before it is shown.
          disabled={busy || !preview || preview.newCount === 0}
          onClick={() => void call("create")}
        >
          {preview ? `Add ${preview.newCount}` : "Add"}
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => { setOpen(false); setPreview(null); setError(null); setDone(null); }}>
          Close
        </Button>
        {done !== null && <span className="text-xs text-green-700">Added {done}.</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {preview && (
        <ul className="mt-3 max-h-64 overflow-y-auto border border-neutral-200 rounded divide-y divide-neutral-100 text-sm">
          {preview.rows.map((row) => (
            <li key={`${row.lineNo}:${row.code}`} className="px-3 py-1.5 flex items-baseline gap-3">
              <span className="font-mono text-neutral-900 w-28 shrink-0">{row.code}</span>
              <span className="flex-1 min-w-0 text-neutral-600 truncate">{row.description ?? ""}</span>
              <span className={`shrink-0 text-xs ${STATUS_CLASS[row.status] ?? "text-neutral-500"}`}>
                {row.status === "already held" && row.heldAs ? `already held as ${row.heldAs}` : row.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
