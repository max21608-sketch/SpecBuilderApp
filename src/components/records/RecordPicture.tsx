"use client";

// The item's picture on its record, saying where it came from — and the one
// other picture a person may swap in.
//
// ============================================================================
// A PHOTO OR A RENDER BEATS A DRAWING, AND THE CHOICE IS A PERSON'S.
//
// The caption used to read "Cropped off the drawings" under every picture,
// including the photograph a bill printed beside the item — so a reader could
// not tell the one thing in the pack that looks like the finished piece from a
// line drawing. It now says which it is and where: "From the bill, row 36",
// "Cropped off the drawings, page 4" (`itemImageCaption`, off the stored path
// and name; nothing is stored to say it).
//
// A drawings confirm no longer replaces a bill's picture (Max, 2026-10-05: "we
// always prefer a picture over a drawing"); it leaves its crop here as an
// offer, small, with "The drawings offer this picture" and a button. And the
// reverse: where a crop IS the picture and it took the place of a bill's, the
// bill's is offered back. So every swap can be undone by the same control,
// which is what keeps it a choice rather than a one-way door.
//
// The button is a BUTTON (`Button.tsx`: a link goes somewhere, a button does
// something) and it writes a version of the record. "Change crop" stays a
// link, and only under a picture that IS a drawing crop: under a bill's
// photograph it would send somebody to re-crop a picture that is not there.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button, { buttonClass } from "@/components/ui/Button";
import { itemImageCaption, offeredPictureWords, type ItemImageSource } from "@/lib/item-image";

/** What `/api/records/[id]` says about the record's pictures. */
export type RecordPictureState = {
  current: { id: string; source: ItemImageSource } | null;
  offered: { id: string; source: ItemImageSource } | null;
};

export default function RecordPicture({
  recordId,
  alt,
  picture,
  failed,
  onFailed,
  drawingRunId,
  onChosen,
}: {
  recordId: string;
  alt: string;
  picture: RecordPictureState;
  /** The current picture's file could not be read — the row names a blob the store no longer holds. */
  failed: boolean;
  onFailed: () => void;
  /** The drawing set this item's specs came off, where a crop is chosen. */
  drawingRunId: string | null;
  /** After a swap: null when it worked, the refusal's words when it did not. The caller reloads. */
  onChosen: (failure: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // By id rather than a flag, so a newer offer is not hidden by an old miss.
  const [failedOfferId, setFailedOfferId] = useState<string | null>(null);
  const { current, offered } = picture;
  const showCurrent = Boolean(current) && !failed;
  if (!showCurrent && !offered) return null;

  async function choose() {
    if (!offered) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/records/${recordId}/image/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attachmentId: offered.id, currentAttachmentId: current?.id ?? null }),
      });
      onChosen(res.ok ? null : res.error);
    } finally {
      setBusy(false);
    }
  }

  const words = offered ? offeredPictureWords(offered.source) : null;

  return (
    <div className="rounded-[10px] border border-neutral-200 bg-white p-2.5">
      {showCurrent && current && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element --
              an authenticated same-origin route that streams from private
              blob storage; next/image cannot fetch it with the session
              cookie. `v` is the current picture's id, so a swap is not
              served the old picture out of the browser's cache. */}
          <img
            src={`/api/records/${recordId}/image?v=${current.id}`}
            alt={alt}
            onError={onFailed}
            className="h-auto w-full rounded"
          />
          <p className="mt-1.5 text-center text-[11.5px] text-neutral-500">{itemImageCaption(current.source)}</p>
          {current.source.kind === "drawing" && drawingRunId && (
            <Link
              href={`/dashboard/imports/${drawingRunId}`}
              title="Opens the drawing set this item's specs came off, where the crop is chosen"
              className={buttonClass("quiet", "xs", "mt-1.5 w-full")}
            >
              Change crop
            </Link>
          )}
        </>
      )}

      {offered && words && failedOfferId !== offered.id && (
        <div className={`flex items-center gap-2.5 ${showCurrent ? "mt-2.5 border-t border-neutral-100 pt-2.5" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img
            src={`/api/records/${recordId}/image?attachment=${offered.id}`}
            alt={`${alt}, as ${words.note.toLowerCase()}`}
            onError={() => setFailedOfferId(offered.id)}
            className="h-14 w-14 shrink-0 rounded border border-neutral-200 object-contain"
          />
          <div className="min-w-0">
            <p className="text-[11.5px] text-neutral-600">
              {words.note}
              <span className="block text-neutral-500">{itemImageCaption(offered.source)}</span>
            </p>
            <Button size="xs" className="mt-1" disabled={busy} onClick={() => void choose()}>
              {busy ? "Saving…" : words.action}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
