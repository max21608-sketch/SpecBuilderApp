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
// A CHIP THE READ FOUND IS PROPOSED, like the item's picture (2026-10-04).
//
// The item-centric read (schemaVersion 4) reports where a finish's printed
// swatch sits (`swatchProposal`). That box is cropped on arrival and shown as
// this row's swatch, labelled as proposed, with Remove and Crop it again one
// click away — exactly the item picture's rule (`ItemImagePicker`): the reviewer
// sees the pixels before anything is stored, and NOTHING IS UPLOADED UNTIL THE
// CARD IS CONFIRMED. A crop the screen already holds for the row wins; a
// proposal is never re-made over a person's choice.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropPdfRegion, type CroppedImage } from "@/lib/pdf-crop";
import PageCropper from "@/components/imports/PageCropper";
import PagePicker from "@/components/imports/PagePicker";
import Button from "@/components/ui/Button";
import { useReviewRowActions } from "@/components/imports/review-row-actions";

export default function SwatchPicker({
  importId,
  observationId,
  page,
  pages = [],
  code,
  disabled,
  proposed = null,
  proposalRefused = null,
  onCropped,
}: {
  importId: string;
  /**
   * The row this picker crops for. With a review screen around it, a crop the
   * screen holds for this row — carried here from a row ignored as the same
   * fabric — is SHOWN, rather than the picker reading empty over a crop that
   * will be uploaded at confirm.
   */
  observationId?: string;
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
  /** Where the read saw the chip (schemaVersion 4). Cropped on arrival as the proposed swatch. */
  proposed?: { page: number; bbox: [number, number, number, number] } | null;
  /**
   * Why the proposed chip has no finish to attach to (brief F) — the row's
   * words for its code disagree with the library. The proposal is then shown
   * UNTICKED with this sentence and is not handed to the screen, so the
   * confirm never sees it; ticking it makes it a person's choice, which keeps
   * the old rule (refused with the reason, never dropped).
   */
  proposalRefused?: string | null;
  /**
   * `origin` is `proposed` for the read's own crop, handed over untouched,
   * and `person` for anything a reviewer cropped or ticked.
   */
  onCropped: (image: CroppedImage | null, page: number | null, origin: "proposed" | "person") => void;
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
  const [fromProposal, setFromProposal] = useState(false);
  // A REFUSED PROPOSAL, held here and not handed over until a person ticks it.
  const [refusedCrop, setRefusedCrop] = useState<{ image: CroppedImage; page: number } | null>(null);
  const [ticked, setTicked] = useState(false);
  const objectUrls = useRef<string[]>([]);
  // The callback in a ref, for `ItemImagePicker`'s reason: the card passes a
  // new arrow on every render, and the proposal must be cropped once.
  const report = useRef(onCropped);
  report.current = onCropped;
  const refusedRef = useRef(proposalRefused);
  refusedRef.current = proposalRefused;

  // A CROP THE SCREEN HOLDS FOR THIS ROW, shown. Only fills an empty preview:
  // one this picker made itself is already the screen's, under the same key.
  const actions = useReviewRowActions();
  const epoch = actions?.swatchEpoch ?? 0;
  useEffect(() => {
    if (!actions || !observationId || preview) return;
    const held = actions.heldSwatch(observationId);
    if (held) setPreview(track(held.blob));
    // `actions` changes identity on every render of the screen; the epoch is
    // what says a crop moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, observationId]);

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

  // THE PROPOSED CHIP, cropped once on arrival. Not where the screen already
  // holds a crop for this row, and never again after somebody removes it.
  const proposalTried = useRef(false);
  useEffect(() => {
    if (!proposed || proposalTried.current) return;
    if (actions && observationId && actions.heldSwatch(observationId)) return;
    proposalTried.current = true;
    const controller = new AbortController();
    setBusy(true);
    void cropPdfRegion(`/api/imports/${importId}/source`, proposed.page, proposed.bbox, { signal: controller.signal })
      .then((image) => {
        setPreview(track(image.blob));
        setFromProposal(true);
        setChosen(proposed.page);
        // AN AUTOMATICALLY PROPOSED SWATCH NEVER BLOCKS A CARD (brief F).
        // Where it has no finish to attach to it is shown and kept here,
        // unticked — the screen never holds it, so the confirm never sees it.
        if (refusedRef.current) {
          setRefusedCrop({ image, page: proposed.page });
          return;
        }
        report.current(image, proposed.page, "proposed");
      })
      .catch((cause) => {
        // A cancelled crop is the card leaving the screen, not a failure; a
        // failed one leaves the row as it was before proposals existed.
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The proposed swatch could not be rendered.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
    // Once per row: the proposal is a value from the staged JSON, and `actions`
    // changes identity on every render of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed?.page, proposed?.bbox?.join(","), observationId, importId]);

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

  // Eight buttons, then previous / next — see PagePicker. An item drawn across
  // thirty pages must not become thirty buttons beside one swatch.
  const selector =
    pageOptions.length > 1 ? (
      <div className="mt-1">
        <PagePicker
          label="Crop from:"
          pages={pageOptions}
          current={chosen}
          disabled={disabled || busy}
          onPick={(option) => {
            setChosen(option);
            // Changing the page while the cropper is open swaps the page
            // under it, rather than making somebody cancel and start again.
            if (cropping) void start(option);
          }}
        />
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
              setFromProposal(false);
              setRefusedCrop(null);
              setTicked(false);
              onCropped(null, null, "person");
            }}
          >
            Remove
          </Button>
        )}
        {preview && fromProposal && !refusedCrop && (
          <span className="text-[11px] text-amber-800">Proposed by the read — check it is the right chip.</span>
        )}
        {preview && refusedCrop && (
          <label className="flex items-center gap-1 text-[11px] text-neutral-700">
            <input
              type="checkbox"
              checked={ticked}
              disabled={disabled}
              onChange={(event) => {
                setTicked(event.target.checked);
                // A TICK IS A PERSON'S CHOICE, and from here the old rule
                // applies: the confirm refuses it with the reason.
                onCropped(event.target.checked ? refusedCrop.image : null, event.target.checked ? refusedCrop.page : null, "person");
              }}
            />
            Use this swatch
          </label>
        )}
        {preview && (!refusedCrop || ticked) && (
          <span className="text-[11px] text-neutral-500">
            {code
              ? `Saved for ${code} across this project when you confirm.`
              : "Saved when you confirm, for every item filed under the same finish on this project."}
          </span>
        )}
      </div>
      {preview && refusedCrop && proposalRefused && (
        <p className="mt-0.5 text-[11px] text-neutral-600">{proposalRefused}</p>
      )}
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
                setFromProposal(false);
                setRefusedCrop(null);
                setTicked(false);
                onCropped(image, croppedFrom, "person");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "That area could not be captured.");
                onCropped(null, null, "person");
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
