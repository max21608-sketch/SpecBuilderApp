"use client";

// The swatch chip, cropped off the page it is printed on.
//
// ============================================================================
// WHY IT BELONGS IN INTAKE AND NOT ON THE FINISHES PAGE.
//
// `project_finishes` has taken a swatch since 0018, and nobody had ever added
// one. The reason was the flow, not the feature: a person had to find the
// finish in the library, find the PDF, find the page, screenshot a chip, save a
// file, upload it, and then TYPE which document and page it came from — which
// the swatch route requires, correctly, because a picture nobody can trace back
// to a page is a picture nobody can check.
//
// A reviewer on a drawings card has all of that already. The page is open, the
// document and page are known, and the chips are printed right there in the
// materials panel. So the crop happens here, and the provenance is recorded
// from the run rather than typed.
//
// A SWATCH BELONGS TO THE CODE, NOT TO THE ITEM. `project_finishes` is keyed on
// (project_id, code_norm) and `WD-05` appears on three pages of the real set,
// so cropping it once is cropping it for every item that carries the code —
// that IS the finishes library's edit-once rule, and the panel says so out
// loud. Otherwise somebody crops the same chip five times and wonders why the
// fifth one won.
//
// NOTHING IS UPLOADED UNTIL THE CARD IS CONFIRMED, exactly like the item
// picture: a card nobody commits leaves no bytes in the store, and the finish
// the swatch attaches to does not exist until the confirm creates it.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { cropPdfRegion, type CroppedImage } from "@/lib/pdf-crop";
import PageCropper from "@/components/imports/PageCropper";
import Button from "@/components/ui/Button";

export default function SwatchPicker({
  importId,
  page,
  code,
  disabled,
  onCropped,
}: {
  importId: string;
  page: number | null;
  /** The client's own finish code. A swatch has nothing to attach to without one. */
  code: string;
  disabled?: boolean;
  onCropped: (image: CroppedImage | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  // Revoked on unmount. Forty cards each holding an un-revoked object URL is
  // forty crops pinned in memory for the life of the page.
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

  /** The whole page, rendered once, only when somebody wants to crop. */
  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const rendered = await cropPdfRegion(`/api/imports/${importId}/source`, page ?? 1, [0, 0, 1, 1]);
      setPageImage(track(rendered.blob));
      setCropping(true);
    } catch (cause) {
      // Never fatal to the card: a page this cannot rasterise is a card that
      // confirms its specs with no swatch, which is how it worked before.
      setError(cause instanceof Error ? cause.message : "That page could not be read.");
    } finally {
      // Always resets, so a failure cannot leave the row spinning.
      setBusy(false);
    }
  }, [importId, page, track]);

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             a blob URL for a crop made in this browser; next/image can do
             nothing with it. */
          <img
            src={preview}
            alt={`Swatch for ${code}`}
            className="h-10 w-10 rounded border border-neutral-300 object-cover bg-white"
          />
        ) : null}
        <Button size="xs" variant="quiet" disabled={disabled || busy} onClick={() => void start()}>
          {busy ? "Opening the page…" : preview ? "Crop it again" : "Crop the swatch"}
        </Button>
        {preview && (
          <Button
            size="xs"
            variant="quiet"
            disabled={disabled}
            onClick={() => {
              setPreview(null);
              onCropped(null);
            }}
          >
            Remove
          </Button>
        )}
        {preview && (
          <span className="text-[11px] text-neutral-500">
            Saved for {code} across this project when you confirm.
          </span>
        )}
      </div>
      {error && <p className="mt-0.5 text-xs text-amber-800">{error}</p>}
      {cropping && pageImage && (
        <PageCropper
          pageImage={pageImage}
          onCancel={() => setCropping(false)}
          onPicked={(bbox) => {
            setCropping(false);
            void (async () => {
              setBusy(true);
              try {
                const image = await cropPdfRegion(`/api/imports/${importId}/source`, page ?? 1, bbox);
                setPreview(track(image.blob));
                onCropped(image);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "That area could not be captured.");
                onCropped(null);
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      )}
    </div>
  );
}
