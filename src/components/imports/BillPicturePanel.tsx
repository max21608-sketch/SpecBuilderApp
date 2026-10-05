"use client";

// A bill row's picture, opened under its row on the bill review: crop it, take
// it whole, or take none.
//
// ============================================================================
// Max, 2026-10-05: "the option to kind of crop on the image has been lost …
// it's quite useful, especially because for some of them, I don't know what's
// going on." A pricing document prints a render beside a drawing in one
// picture. Approved mock-up item 4: clicking an item's thumbnail opens its
// picture under the row, "using the same crop control as the drawings review:
// drag a box, take the whole picture, or no picture"; a fabric swatch opens
// the same way.
//
// THE RULES, EACH A TRAP
//
// - THE SAME CROP CONTROL. `PageCropper` is the one implementation of "a drag
//   is a crop", with its 2% floor; a second copy is how the two start
//   disagreeing about what a click means.
// - IT CROPS THE BILL'S OWN PICTURE (`original=1`), never the crop on screen
//   now. Cropping a crop throws the rest of the picture away for good; this
//   way a second crop can always reach the whole of it.
// - THE CROP IS SHOWN BEFORE ANYTHING IS STORED. The pixels are cut in the
//   browser (`cropImageRegion`, the image analogue of the page crop, through
//   the same one-at-a-time queue) and rendered here; only "Use this crop"
//   uploads them, and only to this run's own prefix (`billPicturePrefix`) —
//   a PATHNAME the server checks again before it is recorded.
// - "THE WHOLE PICTURE" IS THE BILL'S OWN, not an upload of it: it clears the
//   choice, so the row reads the picture registration stored.
// - A ROW WITH TWO PICTURES OFFERS NONE TO CHOOSE. Registration stores neither
//   (`stageBillRowImages`: which one is the item is a person's call), so there
//   is nothing here to crop or take. The panel says so and offers No picture.
// - IT IS ITS OWN `<tr>`, never a `<td colSpan>` beside the data cells — the
//   drawings card's rule (`docs/design-language.md`).
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import PageCropper from "@/components/imports/PageCropper";
import Button from "@/components/ui/Button";
import { TONE } from "@/components/ui/tone";
import { cropImageRegion, type CropBox, type CroppedImage } from "@/lib/pdf-crop";
import { billPicturePrefix, type BillRowImage } from "@/lib/bill-row-image";

/** What the row gives now. */
export type PictureChoiceNow = "own" | "crop" | "none";

/** What a person can choose: the bill's own (null), none, or a stored crop. */
export type PictureChoice = null | { none: true } | { pathname: string; width: number; height: number };

export default function BillPicturePanelRow({
  importId,
  projectId,
  sheetIndex,
  lineNo,
  kind,
  original,
  now,
  colSpan,
  busy = false,
  onChoose,
  onClose,
}: {
  importId: string;
  projectId: string;
  sheetIndex: number;
  lineNo: number;
  /** An item's picture, or a fabric line's swatch. */
  kind: "item" | "swatch";
  /** The picture the bill printed on the row, as read (`rowImageFor`). */
  original: BillRowImage | null;
  now: PictureChoiceNow;
  colSpan: number;
  busy?: boolean;
  /** Records the choice. Resolves true where it was recorded. */
  onChoose: (choice: PictureChoice) => Promise<boolean>;
  onClose: () => void;
}) {
  const [cropped, setCropped] = useState<{ image: CroppedImage; url: string } | null>(null);
  const [working, setWorking] = useState<"cropping" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // An abandoned crop is cancelled, and a preview's object URL released.
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => {
    if (cropped) URL.revokeObjectURL(cropped.url);
  }, [cropped]);

  const source = `/api/imports/${importId}/row-image?sheet=${sheetIndex}&row=${lineNo}&original=1`;
  const what = kind === "item" ? "picture" : "swatch";
  const disabled = busy || working !== null;

  async function crop(bbox: CropBox) {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setError(null);
    setWorking("cropping");
    try {
      const image = await cropImageRegion(source, bbox, { signal: mine.signal });
      setCropped({ image, url: URL.createObjectURL(image.blob) });
    } catch (cause) {
      if (mine.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setError(cause instanceof Error ? cause.message : "That area could not be cropped.");
    } finally {
      if (controller.current === mine) setWorking(null);
    }
  }

  async function choose(choice: PictureChoice) {
    setError(null);
    setWorking("saving");
    try {
      if (await onChoose(choice)) onClose();
    } finally {
      setWorking(null);
    }
  }

  async function storeCrop() {
    if (!cropped) return;
    setError(null);
    setWorking("saving");
    try {
      let pathname: string;
      try {
        const stored = await upload(
          `${billPicturePrefix(projectId, importId)}crop-${sheetIndex}-${lineNo}-${Date.now()}.png`,
          cropped.image.blob,
          { access: "private", handleUploadUrl: "/api/uploads/token", clientPayload: projectId, contentType: "image/png" },
        );
        pathname = stored.pathname;
      } catch (cause) {
        setError(`The crop could not be stored: ${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
      if (await onChoose({ pathname, width: cropped.image.width, height: cropped.image.height })) onClose();
    } finally {
      setWorking(null);
    }
  }

  const nowWords =
    now === "crop"
      ? `Now: your crop of the bill's ${what}.`
      : now === "none"
        ? `Now: no ${what}.`
        : original?.pathname
          ? `Now: the bill's ${what}, whole.`
          : `Now: no ${what} — the bill gives none.`;

  return (
    <tr data-bill-picture-panel={lineNo}>
      <td colSpan={colSpan} className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12.5px] text-neutral-700">
            <b>Row {lineNo}&apos;s {what}.</b> {nowWords}{" "}
            {kind === "item"
              ? "The confirm gives the record what you choose here."
              : "The confirm files what you choose here as the fabric's swatch."}
          </p>
          <Button variant="quiet" size="xs" onClick={onClose} disabled={working === "saving"}>
            Close
          </Button>
        </div>

        {original?.pathname ? (
          <div className="mt-1 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <PageCropper pageImage={source} onPicked={(bbox) => void crop(bbox)} onCancel={onClose} />
            <div className="mt-3">
              <p className="text-xs text-neutral-500">The crop</p>
              {working === "cropping" ? (
                <p className="mt-2 text-xs text-neutral-500">Cropping…</p>
              ) : cropped ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of pixels cut in this tab */}
                  <img
                    src={cropped.url}
                    alt={`The crop of row ${lineNo}'s ${what}`}
                    className="mt-2 block max-h-48 w-auto rounded border border-neutral-200 bg-white"
                  />
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {cropped.image.width} × {cropped.image.height} px · nothing is stored until you use it
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">Drag a box over the picture and it shows here.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" size="xs" disabled={disabled || !cropped} onClick={() => void storeCrop()}>
                  Use this crop
                </Button>
                <Button variant="secondary" size="xs" disabled={disabled || now === "own"} onClick={() => void choose(null)}>
                  The whole picture
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={disabled || now === "none"}
                  onClick={() => void choose({ none: true })}
                >
                  No picture
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-xs text-neutral-600">
              {original && original.pictures > 1
                ? `The bill prints ${original.pictures} different pictures on this row. Neither was stored when the bill was read — which one is the item is a person's call — so there is nothing here to crop or take. Read the bill again from a copy with one picture on the row to choose one.`
                : "The bill prints no picture on this row, so there is nothing to crop."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {now !== "own" && (
                <Button variant="secondary" size="xs" disabled={disabled} onClick={() => void choose(null)}>
                  As the bill gives it
                </Button>
              )}
              <Button
                variant="secondary"
                size="xs"
                disabled={disabled || now === "none"}
                onClick={() => void choose({ none: true })}
              >
                No picture
              </Button>
            </div>
          </div>
        )}
        {working === "saving" && <p className="mt-2 text-xs text-neutral-500">Saving…</p>}
        {error && (
          <p className={`mt-2 text-xs ${TONE.danger.text}`} role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}
