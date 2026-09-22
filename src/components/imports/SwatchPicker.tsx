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
// THE CODE MAY NOT EXIST YET (4a.2, after 4a.1). A finish the client gave no
// code for is filed under one this app mints, and the number is allocated under
// the project row lock at CONFIRM — so a row about to be filed internally has a
// finish to attach a picture to and no code to print beside it. `code` is
// therefore nullable, and the panel says the same edit-once sentence without
// naming a number that another reviewer's confirm may take first. What it must
// not do is fall silent: the picture still reaches every item filed under the
// same finish, and that is the half somebody has to know before cropping.
//
// NOTHING IS UPLOADED UNTIL THE CARD IS CONFIRMED, exactly like the item
// picture: a card nobody commits leaves no bytes in the store, and the finish
// the swatch attaches to does not exist until the confirm creates it.
//
// ============================================================================
// AN ITEM IS SEVERAL PAGES, AND THE CHIP IS ON WHICHEVER ONE PRINTS IT
//
// Reported 2026-09-19: *"It was on the second page, and I've only got one
// page."* A two-page item is the normal case, not the exception — a shop
// drawing and then the finishes sheet — and this picker was scoped to the ONE
// page the row was read from, so a chip printed on the other page of the same
// item could not be reached at all without leaving the card.
//
// So it offers EVERY page of the item (`pages`, the union of the item's staged
// pages and the model's own code group) and DEFAULTS to the page the row was
// read from, which is where the chip usually is.
//
// THE PAGE IT REPORTS IS THE PAGE THAT WAS CROPPED, never the card's. The
// selector's value is what `onCropped` hands back and what the confirm records,
// because a swatch citing a page it did not come from is worse than one citing
// none: the whole reason this control exists is that a picture has to be
// checkable against a page somebody can open.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropPdfRegion, type CroppedImage } from "@/lib/pdf-crop";
import PageCropper from "@/components/imports/PageCropper";
import Button from "@/components/ui/Button";

export default function SwatchPicker({
  importId,
  page,
  pages = [],
  code,
  disabled,
  onCropped,
}: {
  importId: string;
  /** The page the finish row itself was read from. The default, and null on a version 1 run. */
  page: number | null;
  /** Every page of the item this row belongs to. One page means no selector. */
  pages?: readonly number[];
  /**
   * The code the picture files under, where there is one to name.
   *
   * NULL is not "no finish" — it is a finish whose code this app has not minted
   * yet, which happens at confirm. A caller that has nothing to attach to at all
   * must not render this control; see the row's own gate.
   */
  code: string | null;
  disabled?: boolean;
  onCropped: (image: CroppedImage | null, page: number | null) => void;
}) {
  // The row's own page is always offered even where the item's page list does
  // not carry it: a staged run from before code groups existed knows the page
  // this row came from and nothing else, and dropping it would leave the one
  // page that is certainly right off the list.
  const pageOptions = useMemo(() => {
    const all = new Set<number>();
    for (const candidate of [...pages, page]) {
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) all.add(candidate);
    }
    return [...all].sort((a, b) => a - b);
  }, [pages, page]);

  const [chosen, setChosen] = useState<number | null>(page ?? pageOptions[0] ?? null);
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
  const start = useCallback(
    async (target: number | null) => {
      setError(null);
      setBusy(true);
      try {
        const rendered = await cropPdfRegion(`/api/imports/${importId}/source`, target ?? 1, [0, 0, 1, 1]);
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
    },
    [importId, track],
  );

  const selector =
    pageOptions.length > 1 ? (
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-neutral-500">Crop from:</span>
        {pageOptions.map((option) => (
          <Button
            key={option}
            size="xs"
            variant={option === chosen ? "secondary" : "quiet"}
            disabled={disabled || busy}
            onClick={() => {
              setChosen(option);
              // Changing the page while the cropper is open swaps the page
              // under it, rather than making somebody cancel and start again.
              if (cropping) void start(option);
            }}
          >
            page {option}
          </Button>
        ))}
      </div>
    ) : null;

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             a blob URL for a crop made in this browser; next/image can do
             nothing with it. */
          <img
            src={preview}
            alt={code ? `Swatch for ${code}` : "Swatch for this finish"}
            className="h-10 w-10 rounded border border-neutral-300 object-cover bg-white"
          />
        ) : null}
        <Button size="xs" variant="quiet" disabled={disabled || busy} onClick={() => void start(chosen)}>
          {busy ? "Opening the page…" : preview ? "Crop it again" : "Crop the swatch"}
        </Button>
        {preview && (
          <Button
            size="xs"
            variant="quiet"
            disabled={disabled}
            onClick={() => {
              setPreview(null);
              onCropped(null, null);
            }}
          >
            Remove
          </Button>
        )}
        {preview && (
          <span className="text-[11px] text-neutral-500">
            {code
              ? `Saved for ${code} across this project when you confirm.`
              : "Saved when you confirm, for every item filed under the same finish on this project."}
          </span>
        )}
      </div>
      {selector}
      {/* A version 1 run staged no page for this row. The card's first page is
          what gets rendered, and saying so is the difference between a default
          and a claim about where the chip is printed. */}
      {page === null && chosen !== null && (
        <p className="mt-0.5 text-[11px] text-amber-800">
          Page unknown for this value — showing page {chosen}.
        </p>
      )}
      {error && <p className="mt-0.5 text-xs text-amber-800">{error}</p>}
      {cropping && pageImage && (
        <PageCropper
          pageImage={pageImage}
          onCancel={() => setCropping(false)}
          onPicked={(bbox) => {
            setCropping(false);
            void (async () => {
              setBusy(true);
              // Read once, so a page changed underneath an in-flight crop
              // cannot make the picture and the page it reports disagree.
              const croppedFrom = chosen;
              try {
                const image = await cropPdfRegion(`/api/imports/${importId}/source`, croppedFrom ?? 1, bbox);
                setPreview(track(image.blob));
                onCropped(image, croppedFrom);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "That area could not be captured.");
                onCropped(null, null);
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
