"use client";

// The picture that will go on the record, shown before it goes there.
//
// The model reports WHERE the pictures are; `pickItemView` decides which one to
// propose; this renders that crop from the actual PDF so the reviewer confirms
// pixels rather than a description. They can switch to another reported view,
// drag their own box, or keep none at all.
//
// It renders on mount and re-renders whenever the chosen region changes, and it
// hands the encoded PNG up through `onCropped` so the card can upload it as
// part of confirming. Nothing is uploaded until then: a card that is never
// confirmed leaves no bytes in the store.
import { useCallback, useEffect, useRef, useState } from "react";
import { cropPdfRegion, type CropBox, type CroppedImage } from "@/lib/pdf-crop";
import type { ItemView } from "@/lib/drawing-document";

/**
 * Two views are the same view when they describe the same region.
 *
 * NOT reference equality: `imageProposal` and its twin inside `viewRegions`
 * come back from `intake_runs.parsed` as two separate deserialised objects, so
 * `===` reports them different and the chosen view appears in its own
 * "switch to" list.
 */
function sameView(a: ItemView | null, b: ItemView | null): boolean {
  if (!a || !b) return a === b;
  return a.viewType === b.viewType && a.page === b.page && a.bbox.every((n, i) => n === b.bbox[i]);
}

const VIEW_LABELS: Record<string, string> = {
  photo: "Photograph",
  render: "Render",
  "3d": "3D view",
  front: "Front",
  side: "Side",
  back: "Back",
  plan: "Plan",
  detail: "Detail",
  other: "View",
};

export default function ItemImagePicker({
  importId,
  itemPage,
  proposal,
  views,
  onCropped,
}: {
  importId: string;
  itemPage: number | null;
  proposal: ItemView | null | undefined;
  views: ItemView[];
  /** null means "this item gets no picture", which is a real answer. */
  onCropped: (image: CroppedImage | null) => void;
}) {
  const sourceUrl = `/api/imports/${importId}/source`;
  const [chosen, setChosen] = useState<ItemView | null>(proposal ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  // Revoked on unmount. A pack of forty cards each holding an un-revoked object
  // URL is forty crops pinned in memory for the life of the page.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const track = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.push(url);
    return url;
  }, []);

  const render = useCallback(
    async (view: ItemView | null) => {
      if (!view) {
        setPreview(null);
        onCropped(null);
        return;
      }
      setRendering(true);
      setError(null);
      try {
        const image = await cropPdfRegion(sourceUrl, view.page ?? itemPage ?? 1, view.bbox);
        setPreview(track(image.blob));
        onCropped(image);
      } catch (cause) {
        // Never fatal to the card. A drawing this cannot rasterise is a card
        // that confirms its specs with no picture, which is the behaviour that
        // existed before pictures did.
        setError(cause instanceof Error ? cause.message : "That page could not be read.");
        setPreview(null);
        onCropped(null);
      } finally {
        // Always resets, so a failure cannot leave the card spinning.
        setRendering(false);
      }
    },
    [sourceUrl, itemPage, onCropped, track],
  );

  useEffect(() => {
    void render(chosen);
    // `render` is stable per source; re-running on every parent render would
    // re-rasterise the page on every keystroke elsewhere on the card.
  }, [chosen, render]);

  /** The whole page, rendered once, only when somebody wants to drag a box. */
  const startCropping = useCallback(async () => {
    setError(null);
    setDragging(true);
    try {
      const page = await cropPdfRegion(sourceUrl, chosen?.page ?? itemPage ?? 1, [0, 0, 1, 1]);
      setPageImage(track(page.blob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That page could not be read.");
      setDragging(false);
    }
  }, [sourceUrl, chosen, itemPage, track]);

  return (
    <div className="px-4 py-3 border-b border-neutral-100">
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Picture</p>
          <div className="mt-2 w-40 h-32 border border-neutral-200 rounded bg-neutral-50 flex items-center justify-center overflow-hidden">
            {rendering ? (
              <span className="text-xs text-neutral-500">Rendering…</span>
            ) : preview ? (
              /* eslint-disable-next-line @next/next/no-img-element --
                 a blob URL for a crop this component just made; next/image
                 optimises remote and static assets and can do nothing with it. */
              <img src={preview} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-neutral-500">
                {error ? "Could not render" : "No picture"}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-[12rem] flex-1">
          {chosen ? (
            <p className="text-sm text-neutral-700">
              {VIEW_LABELS[chosen.viewType] ?? "View"}
              {chosen.page && <span className="text-neutral-500"> · page {chosen.page}</span>}
            </p>
          ) : (
            <p className="text-sm text-neutral-600">
              {views.length > 0
                ? "No picture will be saved for this item."
                : "The drawing offered no picture of this item. Drag a box if you want one."}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Every OTHER view the model reported, so switching is one click
                rather than a drag. The proposal is just the first of these. */}
            {views
              .filter((view) => !sameView(view, chosen))
              .map((view, index) => (
                <button
                  key={`${view.viewType}-${view.page}-${index}`}
                  type="button"
                  onClick={() => setChosen(view)}
                  className="text-xs px-2 py-0.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                >
                  Use {(VIEW_LABELS[view.viewType] ?? "view").toLowerCase()}
                </button>
              ))}
            <button
              type="button"
              onClick={() => void startCropping()}
              className="text-xs px-2 py-0.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            >
              {views.length > 0 ? "Drag a box instead" : "Drag a box"}
            </button>
            {chosen && (
              <button
                type="button"
                onClick={() => setChosen(null)}
                className="text-xs px-2 py-0.5 rounded border border-neutral-300 text-neutral-500 hover:bg-neutral-50"
              >
                No picture
              </button>
            )}
          </div>

          {error && <p className="mt-1 text-xs text-amber-800">{error}</p>}
        </div>
      </div>

      {dragging && pageImage && (
        <PageCropper
          pageImage={pageImage}
          onCancel={() => setDragging(false)}
          onPicked={(bbox) => {
            setDragging(false);
            setChosen({ viewType: "other", page: chosen?.page ?? itemPage ?? 1, bbox });
          }}
        />
      )}
      {dragging && !pageImage && <p className="mt-2 text-xs text-neutral-500">Rendering the page…</p>}
    </div>
  );
}

/**
 * Drag a rectangle over the rendered page.
 *
 * Coordinates come back as FRACTIONS of the page, which is the same shape the
 * model reports, so a hand-drawn box and a proposed one are the same kind of
 * thing to everything downstream.
 */
function PageCropper({
  pageImage,
  onPicked,
  onCancel,
}: {
  pageImage: string;
  onPicked: (bbox: CropBox) => void;
  onCancel: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const pointFrom = (event: React.MouseEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const rect =
    start && current
      ? {
          left: `${Math.min(start.x, current.x) * 100}%`,
          top: `${Math.min(start.y, current.y) * 100}%`,
          width: `${Math.abs(current.x - start.x) * 100}%`,
          height: `${Math.abs(current.y - start.y) * 100}%`,
        }
      : null;

  return (
    <div className="mt-3">
      <p className="text-xs text-neutral-500">
        Drag over the picture you want. Release to use it.
        <button type="button" onClick={onCancel} className="ml-2 underline hover:text-neutral-900">
          Cancel
        </button>
      </p>
      <div
        ref={boxRef}
        onMouseDown={(event) => {
          const point = pointFrom(event);
          if (!point) return;
          setStart(point);
          setCurrent(point);
        }}
        onMouseMove={(event) => {
          if (!start) return;
          setCurrent(pointFrom(event));
        }}
        onMouseUp={() => {
          if (!start || !current) return;
          const bbox: CropBox = [
            Math.min(start.x, current.x),
            Math.min(start.y, current.y),
            Math.max(start.x, current.x),
            Math.max(start.y, current.y),
          ];
          setStart(null);
          setCurrent(null);
          // A click rather than a drag is not a crop. Ignoring it beats
          // capturing a one-pixel smear the reviewer then has to undo.
          if (bbox[2] - bbox[0] < 0.02 || bbox[3] - bbox[1] < 0.02) return;
          onPicked(bbox);
        }}
        className="relative mt-2 inline-block border border-neutral-300 cursor-crosshair select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL */}
        <img src={pageImage} alt="" draggable={false} className="block max-h-[28rem] w-auto" />
        {rect && <div style={rect} className="absolute border-2 border-neutral-900 bg-neutral-900/10" />}
      </div>
    </div>
  );
}
