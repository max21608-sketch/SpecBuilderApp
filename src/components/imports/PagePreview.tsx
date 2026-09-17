"use client";

// The page itself, on the card, when the card cannot answer a question.
//
// A dispute about which figure is the width is not readable from a list of
// figures — it is readable from the drawing, in about two seconds. Putting the
// page beside the message means a reviewer decides where they are rather than
// opening a PDF in another tab, finding the right sheet and coming back.
//
// It renders through the same `cropPdfRegion` the picture picker uses, at the
// whole page, from the same cached parse — so a card showing this costs one
// more rasterise of a document the screen has already loaded. A failure is
// never fatal: the message and the link to the PDF stand on their own.
import { useEffect, useRef, useState } from "react";
import { cropPdfRegion } from "@/lib/pdf-crop";

export default function PagePreview({
  importId,
  page,
  className = "",
}: {
  importId: string;
  page: number | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // Cancelled on unmount rather than merely ignored: rasterising an A3 page
    // is the most expensive thing on this screen, and a panel nobody is
    // looking at must not go on competing for the worker with the ones they
    // are. See the note in src/lib/pdf-crop.ts.
    const controller = new AbortController();
    void (async () => {
      try {
        const image = await cropPdfRegion(`/api/imports/${importId}/source`, page ?? 1, [0, 0, 1, 1], {
          signal: controller.signal,
        });
        if (!live) return;
        objectUrl.current = URL.createObjectURL(image.blob);
        setUrl(objectUrl.current);
      } catch {
        // A cancelled crop is not a failure: this panel is going away.
        if (live && !controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      live = false;
      controller.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [importId, page]);

  if (failed) return null;
  return (
    <a
      href={`/api/imports/${importId}/source${page ? `#page=${page}` : ""}`}
      target="_blank"
      rel="noreferrer"
      className={`block ${className}`}
      title="Open the drawing"
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element --
           a blob URL for a crop made in this browser; next/image can do
           nothing with it. */
        <img src={url} alt={`Page ${page ?? 1} of the drawing`} className="block w-full h-auto rounded border border-amber-300 bg-white" />
      ) : (
        <span className="block h-40 rounded border border-amber-300 bg-white text-xs text-amber-800 flex items-center justify-center">
          Rendering the page…
        </span>
      )}
    </a>
  );
}
