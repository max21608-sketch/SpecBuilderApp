"use client";

// Uploading a document to a project.
//
// THE IMPORT TYPE IS DECLARED HERE, and that is the whole point of this
// component existing. A BOQ and an FF&E schedule are both .xlsx, so the file
// itself cannot say which pipeline it belongs in — and guessing would
// eventually feed an FF&E schedule to the BOQ parser and create a project's
// worth of wrong spec records. The person who has the file says which it is.
//
// Registering a specification document COSTS NOTHING and reads nothing. The
// model is only called when someone presses Extract on the review screen.
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { apiFetch } from "@/lib/api-fetch";
import { INTAKE_UPLOAD_ACCEPT } from "@/lib/intake-source-types";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { projectUploadPrefix } from "@/lib/blob-source";

type ImportType = "boq" | "spec_document";

export default function DocumentUpload({ projectId, onUploaded }: { projectId: string; onUploaded?: () => void }) {
  const [importType, setImportType] = useState<ImportType>("spec_document");
  const [documentKind, setDocumentKind] = useState<DocumentKind>("ffe_schedule");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setProgress(0);
    // Generated ONCE per user action and reused if this fails and is retried,
    // so a lost response cannot register the same upload twice.
    const registrationRequestId = crypto.randomUUID();

    try {
      let blobPathname: string;
      try {
        // Bytes go browser -> blob store directly, never through a route
        // handler: a real source document is well over the serverless
        // request-body ceiling. The store is PRIVATE and must stay that way —
        // these are NDA-covered client documents.
        //
        // The pathname is namespaced to the project, which is what the upload
        // token signs and what registration re-checks.
        const blob = await upload(`${projectUploadPrefix(projectId)}${file.name}`, file, {
          access: "private",
          handleUploadUrl: "/api/uploads/token",
          clientPayload: projectId,
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        });
        blobPathname = blob.pathname;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        if (importType === "spec_document") {
          // No fallback here, deliberately. The document is read by a model
          // minutes later in a worker with no request body, and a reviewer must
          // be able to check a proposal against the original page.
          setError(`The document could not be stored (${detail}). A specification document cannot be read without a stored copy.`);
          return;
        }
        // A BOQ can still be parsed from the request body — but that path
        // cannot keep the original, and the review screen says so.
        setError(`The file could not be stored (${detail}). Reading it without keeping a copy.`);
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", projectId);
        form.set("importType", "boq");
        const fallback = await apiFetch<{ importId: string }>("/api/imports", { method: "POST", body: form });
        if (!fallback.ok) { setError(fallback.error); return; }
        window.location.href = `/dashboard/imports/${fallback.data.importId}`;
        return;
      }

      const res = await apiFetch<{ importId: string }>("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          importType,
          documentKind: importType === "spec_document" ? documentKind : null,
          pathname: blobPathname,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          registrationRequestId,
        }),
      });
      if (!res.ok) { setError(res.error); return; }
      onUploaded?.();
      window.location.href = `/dashboard/imports/${res.data.importId}`;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="mt-3 border border-neutral-200 rounded-lg bg-white p-3">
      {error && (
        <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-neutral-500">
          What is this?
          <select
            value={importType}
            onChange={(event) => setImportType(event.target.value as ImportType)}
            disabled={busy}
            className="mt-1 block border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
          >
            <option value="spec_document">A specification document</option>
            <option value="boq">A bill of quantities (creates records)</option>
          </select>
        </label>

        {importType === "spec_document" && (
          <label className="text-xs text-neutral-500">
            What kind?
            <select
              value={documentKind}
              onChange={(event) => setDocumentKind(event.target.value as DocumentKind)}
              disabled={busy}
              className="mt-1 block border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-900"
            >
              {DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {DOCUMENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={importType === "boq" ? ".xlsx" : INTAKE_UPLOAD_ACCEPT}
          onChange={onFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? (progress === null ? "Registering…" : `Uploading ${progress}%`) : "Choose a file"}
        </button>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        {importType === "boq"
          ? "A bill of quantities creates one spec record per line, after you review the categories."
          : "Uploading costs nothing and reads nothing. You choose whether to send it to the model on the next screen."}
      </p>
    </div>
  );
}
