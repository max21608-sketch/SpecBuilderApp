"use client";

// Dropping a whole tender pack in at once.
//
// A pack is a preamble, a bill of quantities and a drawing set, delivered
// together. Uploading them one at a time — the old flow navigated away after
// each file — made three unrelated runs out of one delivery, in whatever order
// somebody happened to click.
//
// EVERY FILE'S KIND IS DECLARED, and the list will not start until each one is
// set. A BOQ and an FF&E schedule are both .xlsx, so the bytes cannot say which
// pipeline a file belongs in; guessing would eventually feed a schedule to the
// BOQ parser and make a project's worth of wrong records. The filename hint
// below is shown as TEXT next to the select, never used to choose for you.
//
// Registering costs nothing and reads nothing. The model is called only when
// somebody presses Extract on the batch screen.
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { apiFetch } from "@/lib/api-fetch";
import { INTAKE_UPLOAD_ACCEPT } from "@/lib/intake-source-types";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { projectUploadPrefix } from "@/lib/blob-source";

/** What a person calls the thing, in the order a pack is read. */
const CHOICES: { value: string; label: string; importType: "boq" | "spec_document"; documentKind: DocumentKind | null }[] = [
  { value: "preamble", label: "Preamble (general conditions)", importType: "spec_document", documentKind: "preamble" },
  { value: "boq", label: "Bill of quantities (creates the records)", importType: "boq", documentKind: null },
  { value: "shop_drawings", label: "Shop drawings (specs per item)", importType: "spec_document", documentKind: "shop_drawings" },
  { value: "ffe_schedule", label: DOCUMENT_KIND_LABELS.ffe_schedule, importType: "spec_document", documentKind: "ffe_schedule" },
  { value: "spec_bible", label: DOCUMENT_KIND_LABELS.spec_bible, importType: "spec_document", documentKind: "spec_bible" },
  { value: "finishes_schedule", label: DOCUMENT_KIND_LABELS.finishes_schedule, importType: "spec_document", documentKind: "finishes_schedule" },
  { value: "fabric_schedule", label: DOCUMENT_KIND_LABELS.fabric_schedule, importType: "spec_document", documentKind: "fabric_schedule" },
  { value: "other", label: DOCUMENT_KIND_LABELS.other, importType: "spec_document", documentKind: "other" },
];

/** A guess shown as a hint for a HUMAN to accept or ignore. Never applied. */
function hint(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.includes("preamble")) return "looks like a preamble";
  if (lower.includes("boq") || lower.includes("bill of")) return "looks like a bill of quantities";
  if (lower.includes("drawing")) return "looks like drawings";
  return null;
}

type Queued = {
  key: string;
  file: File;
  choice: string;
  status: "waiting" | "uploading" | "registering" | "done" | "failed";
  progress: number;
  error: string | null;
};

export default function IntakeBatchUpload({ projectId, onUploaded }: { projectId: string; onUploaded?: () => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setQueue((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        choice: "",
        status: "waiting" as const,
        progress: 0,
        error: null,
      })),
    ]);
  }

  const update = (key: string, patch: Partial<Queued>) =>
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const undeclared = queue.filter((item) => item.status === "waiting" && !item.choice).length;
  const pending = queue.filter((item) => item.status !== "done");

  async function start() {
    if (queue.length === 0 || undeclared > 0) return;
    setBusy(true);
    setError(null);

    try {
      const batch = await apiFetch<{ batch: { id: string } }>(`/api/projects/${projectId}/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: `${queue.length} document${queue.length === 1 ? "" : "s"}` }),
      });
      if (!batch.ok) {
        setError(batch.error);
        return;
      }
      const batchId = batch.data.batch.id;

      // Sequential, so a failure names the file it belongs to and the others
      // still land. A pack whose drawings failed is still a pack with a bill.
      for (const item of queue) {
        if (item.status === "done") continue;
        const choice = CHOICES.find((entry) => entry.value === item.choice);
        if (!choice) continue;

        // Generated ONCE per file and reused on retry, so a lost response
        // cannot register the same upload twice.
        const registrationRequestId = crypto.randomUUID();
        update(item.key, { status: "uploading", progress: 0, error: null });

        try {
          // Bytes go browser -> blob store directly, never through a route
          // handler: a real drawing set is well over the request-body ceiling.
          // The store is PRIVATE and stays that way — NDA client documents.
          const blob = await upload(`${projectUploadPrefix(projectId)}${item.file.name}`, item.file, {
            access: "private",
            handleUploadUrl: "/api/uploads/token",
            clientPayload: projectId,
            onUploadProgress: ({ percentage }) => update(item.key, { progress: Math.round(percentage) }),
          });

          update(item.key, { status: "registering" });
          const res = await apiFetch<{ importId: string }>("/api/imports", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId,
              batchId,
              importType: choice.importType,
              documentKind: choice.documentKind,
              pathname: blob.pathname,
              filename: item.file.name,
              contentType: item.file.type,
              size: item.file.size,
              registrationRequestId,
            }),
          });
          if (!res.ok) {
            update(item.key, { status: "failed", error: res.error });
            continue;
          }
          update(item.key, { status: "done", progress: 100 });
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          update(item.key, { status: "failed", error: `Could not be stored: ${detail}` });
        }
      }

      onUploaded?.();
      window.location.href = `/dashboard/projects/${projectId}/intake/${batchId}`;
    } finally {
      // Always reset, so an HTML error page or a network failure cannot leave
      // the button disabled with no way back.
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border border-neutral-200 rounded-lg bg-white p-3">
      {error && (
        <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`rounded border-2 border-dashed px-4 py-6 text-center ${
          dragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"
        }`}
      >
        <p className="text-sm text-neutral-700">Drop the pack here — the preamble, the BOQ and the drawings together.</p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={INTAKE_UPLOAD_ACCEPT}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="mt-2 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
        >
          Choose files
        </button>
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded">
          {queue.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-sm text-neutral-900 flex-1 min-w-[12rem] truncate" title={item.file.name}>
                {item.file.name}
                {hint(item.file.name) && (
                  <span className="ml-2 text-xs text-neutral-400">{hint(item.file.name)}</span>
                )}
              </span>

              <select
                value={item.choice}
                onChange={(event) => update(item.key, { choice: event.target.value })}
                disabled={busy || item.status === "done"}
                className="border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
              >
                <option value="">What is this?</option>
                {CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>

              <span className="text-xs text-neutral-500 w-24 text-right">
                {item.status === "uploading" && `${item.progress}%`}
                {item.status === "registering" && "Registering…"}
                {item.status === "done" && "Added"}
                {item.status === "failed" && <span className="text-red-700">Failed</span>}
              </span>

              {item.status !== "done" && !busy && (
                <button
                  type="button"
                  onClick={() => setQueue((current) => current.filter((row) => row.key !== item.key))}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Remove
                </button>
              )}

              {item.error && <p className="w-full text-xs text-red-700">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || queue.length === 0 || undeclared > 0 || pending.length === 0}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Starting intake…" : `Start intake${pending.length ? ` (${pending.length})` : ""}`}
        </button>
        {undeclared > 0 && (
          <p className="text-xs text-neutral-500">
            Say what {undeclared === 1 ? "the remaining file is" : `each of the ${undeclared} remaining files is`} first —
            a BOQ and a schedule are both spreadsheets, so the file cannot say.
          </p>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Uploading costs nothing and reads nothing. You choose which documents go to the model on the next screen.
      </p>
    </div>
  );
}
