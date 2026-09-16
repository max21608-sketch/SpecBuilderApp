"use client";

// The email that asked for a change.
//
// Uploaded straight to the project's own blob prefix by the browser, exactly
// as a drawing crop is: the server is handed a PATHNAME, never a URL, and
// re-checks it belongs to this project before it will attach it to anything.
// A signed-in user pasting someone else's pathname gets a 400, not a file.
//
// A `.msg` is binary Outlook format and a `.eml` body is untrusted HTML.
// Nothing renders either — the link on a change downloads the file and it
// opens in Outlook. That is said on screen rather than left to be discovered.
import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { projectUploadPrefix } from "@/lib/blob-source";
import Button from "@/components/ui/Button";

export type UploadedEvidence = { pathname: string; filename: string; contentType: string; size: number };

export default function EvidenceUpload({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded?: (evidence: UploadedEvidence | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<UploadedEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(chosen: File | null) {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const safe = chosen.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-120);
      const blob = await upload(`${projectUploadPrefix(projectId)}evidence/${Date.now()}-${safe}`, chosen, {
        access: "private",
        handleUploadUrl: "/api/uploads/token",
        clientPayload: projectId,
      });
      const evidence: UploadedEvidence = {
        pathname: blob.pathname,
        filename: chosen.name,
        // Outlook drag-outs often arrive with an empty type; the extension is
        // what the server checks, so an empty string here is not a failure.
        contentType: chosen.type || "application/octet-stream",
        size: chosen.size,
      };
      setFile(evidence);
      onUploaded?.(evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That file could not be uploaded.");
      onUploaded?.(null);
    } finally {
      // Always reset, so a rejected file type cannot leave the control stuck.
      setBusy(false);
    }
  }

  return (
    <div className="text-xs">
      {file ? (
        <p className="text-neutral-700">
          Attached: {file.filename}{" "}
          <Button
            size="xs"
            variant="quiet"
            onClick={() => {
              setFile(null);
              onUploaded?.(null);
            }}
          >
            Remove
          </Button>
        </p>
      ) : (
        <label className="text-neutral-600">
          {busy ? "Uploading…" : "Attach the email or document (optional)"}
          <input
            type="file"
            disabled={busy}
            accept=".eml,.msg,.pdf,.png,.jpg,.jpeg,.xlsx,message/rfc822,application/pdf"
            onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            className="ml-2 text-xs"
          />
        </label>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
