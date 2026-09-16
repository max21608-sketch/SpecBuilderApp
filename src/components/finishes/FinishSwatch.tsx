"use client";

// A picture of the finish.
//
// The drawings print a panel of swatch chips with the codes beside them, which
// is where these come from — but the model is deliberately NOT asked for them
// yet: adding a field to the tool schema is a re-read of every document in the
// pack, and every pack already read would have to be read again and paid for
// again. So the first route in is the one that costs nothing: a person crops
// one from a source PDF, or uploads an image and says where it came from.
//
// A swatch belongs to the FINISH, not to an item: the same chip is on every
// page that uses the code. Replacing one supersedes the old row rather than
// deleting it, because a version may point at it.
import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { projectUploadPrefix } from "@/lib/blob-source";
import { apiFetch } from "@/lib/api-fetch";

function Swatch({ finishId, hasSwatch }: { finishId: string; hasSwatch: boolean }) {
  // Optimistic, like the item image: request it, and let the 404 for a finish
  // with none turn it off. Asking first is a round trip to learn something the
  // image request itself reports.
  const [visible, setVisible] = useState(hasSwatch);
  if (!visible) {
    return (
      <div className="w-14 h-14 shrink-0 rounded border border-dashed border-neutral-300 bg-neutral-50 flex items-center justify-center">
        <span className="text-[10px] text-neutral-400 text-center leading-tight">no
          <br />
          swatch
        </span>
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element --
       an authenticated same-origin route streaming from private blob storage;
       next/image cannot fetch it with the session cookie. */
    <img
      src={`/api/finishes/${finishId}/swatch`}
      alt=""
      onError={() => setVisible(false)}
      className="w-14 h-14 shrink-0 rounded border border-neutral-200 object-cover"
    />
  );
}

function Upload({
  finishId,
  projectId,
  onDone,
}: {
  finishId: string;
  projectId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | null) {
    if (!file) return;
    if (!source.trim()) {
      setError("Say where this picture came from — the document and page — so the swatch can be checked later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
      const blob = await upload(`${projectUploadPrefix(projectId)}finish-swatches/${Date.now()}-${safe}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads/token",
        clientPayload: projectId,
      });
      const res = await apiFetch(`/api/finishes/${finishId}/swatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pathname: blob.pathname,
          filename: file.name,
          contentType: file.type || "image/png",
          size: file.size,
          source: source.trim(),
        }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSource("");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That image could not be uploaded.");
    } finally {
      // Always reset: a rejected type must not leave the control stuck.
      setBusy(false);
    }
  }

  return (
    <span className="text-xs text-neutral-600">
      <input
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="Where it came from, e.g. S-100.pdf p1"
        className="border border-neutral-300 rounded px-2 py-1 mr-2 bg-white"
      />
      <label>
        {busy ? "Uploading…" : "Swatch image"}
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
          className="ml-1 text-xs"
        />
      </label>
      {error && <span className="ml-2 text-red-700">{error}</span>}
    </span>
  );
}

const FinishSwatch = Object.assign(Swatch, { Upload });
export default FinishSwatch;
