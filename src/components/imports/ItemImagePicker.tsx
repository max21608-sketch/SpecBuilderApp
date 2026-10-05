"use client";

// The picture that will go on the record, shown before it goes there.
//
// The model reports WHERE the pictures are; `pickItemView` decides which one to
// propose; this renders that crop from the actual PDF so the reviewer confirms
// pixels rather than a description. They can switch to another reported view,
// drag their own box, or keep none at all.
//
// WHEN NOTHING WAS REPORTED, THE PAGE ITSELF IS PROPOSED.
//
// A real drawing set gets this wrong often: the eleven-page Panther set came
// back with no view regions at all, the model saying it could not fix exact
// crop boxes. The pages are almost entirely picture — a reviewer drags a box
// over nearly the whole sheet — so "no picture" was the one answer that was
// certainly wrong, and it was the answer forty cards defaulted to.
//
// So a card with no reported view proposes the WHOLE PAGE. That is not a guess
// about what the item looks like: the page IS the drawing of the item, it is
// labelled as the whole page in words, it renders in front of the reviewer
// before anything is stored, and "Drag a box" and "No picture" are both one
// click. It also does not contradict the card's rule that nothing is
// pre-selected where the answer is unknown — that rule is about spec VALUES,
// which get exported and quoted against. A picture is an aid to recognising
// the item, and the reviewer is looking at it.
//
// UNLESS THE ITEM ALREADY HAS A PICTURE (Max, 2026-10-05, on the Aman pack:
// "if there's already an image, by default it needs to go to no image"). A
// bill that prints a picture on each row gives it to the record at confirm,
// and the drawings confirm REPLACES whatever item picture it finds — so a
// proposal here, accepted by confirming the card for its specs, silently
// swapped the bill's picture for a crop of a drawing. Where the server says a
// record this card writes to already holds one, the panel starts at "no
// picture" and says why in words; the proposal, the whole page and a dragged
// box are each still one click, and choosing one says it will replace the
// current picture. Nothing is rasterised until somebody chooses.
//
// It renders on mount and re-renders whenever the chosen region changes, and it
// hands the encoded PNG up through `onCropped` so the card can upload it as
// part of confirming. Nothing is uploaded until then: a card that is never
// confirmed leaves no bytes in the store.
import { useCallback, useEffect, useRef, useState } from "react";
import { cropPdfRegion, type CroppedImage } from "@/lib/pdf-crop";
import PageCropper from "@/components/imports/PageCropper";
import Button from "@/components/ui/Button";
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

/** The whole page, as a view. `other` because that is honestly what it is. */
function wholePage(page: number | null): ItemView {
  return { viewType: "other", page: page ?? 1, bbox: [0, 0, 1, 1] };
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
  sharesItsPage,
  existingPicture,
  onCropped,
}: {
  importId: string;
  itemPage: number | null;
  proposal: ItemView | null | undefined;
  views: ItemView[];
  /**
   * Whether this item has the page to itself.
   *
   * IT IS NOT ONE ITEM PER PAGE. A sheet can carry three codes, and where the
   * model reported no view region every one of them would propose the SAME
   * whole page as its own picture — three records showing an identical picture
   * of all three items. The whole-page proposal only makes sense when the page
   * IS the drawing of this item, so it is withheld otherwise and the reviewer
   * drags a box, which is the honest offer there.
   *
   * Optional and defaulting to alone: every existing caller renders one item
   * per page, and this is the caller that knows.
   */
  sharesItsPage?: boolean;
  /**
   * The records this card's picture would land on that ALREADY have one, and
   * how many it would land on in all — the server's `pictureHeld`, computed
   * over the confirm's own fan-out. Present means the panel starts at none.
   *
   * Read ONCE, at mount, like the proposal: a reload after a sibling card is
   * confirmed must not move a choice somebody made, or un-make one they had
   * not made yet by suddenly rendering a crop.
   */
  existingPicture?: { recordIds: readonly string[]; of: number } | null;
  /** null means "this item gets no picture", which is a real answer. */
  onCropped: (image: CroppedImage | null) => void;
}) {
  const sourceUrl = `/api/imports/${importId}/source`;
  // A reported view is always preferred to the page. The fallback only stands
  // in where the model gave us nothing to prefer AND the page is this item's.
  const fallback = !proposal && views.length === 0 && !sharesItsPage ? wholePage(itemPage) : null;
  const held = existingPicture?.recordIds.length ?? 0;
  const of = Math.max(existingPicture?.of ?? 0, held);
  // A record that already has a picture keeps it unless somebody chooses
  // otherwise: the default is none, and nothing is cropped on mount.
  const [chosen, setChosen] = useState<ItemView | null>(held > 0 ? null : (proposal ?? fallback));
  // UNTOUCHED, IT FOLLOWS THE RECORDS; TOUCHED, IT IS THE PERSON'S. Found in
  // the browser on 2026-10-05: a code on two bill lines resolves to nobody
  // until the reviewer picks one, so the panel mounted with nothing held and
  // proposed the drawing -- and picking the line, whose bill picture is exactly
  // what this rule protects, then left that proposal standing. So while nobody
  // has pressed anything here, the default moves with what the ticked records
  // hold; once somebody has, nothing the server says moves their choice.
  const touched = useRef(false);
  const choose = useCallback((view: ItemView | null) => {
    touched.current = true;
    setChosen(view);
  }, []);
  const hasHeld = held > 0;
  const defaultView = useRef<ItemView | null>(proposal ?? fallback);
  defaultView.current = proposal ?? fallback;
  const lastHeld = useRef(hasHeld);
  useEffect(() => {
    // Only on a CHANGE: re-setting the mount value would be a second crop of
    // the same page, the defect the ref around onCropped exists to prevent.
    if (lastHeld.current === hasHeld) return;
    lastHeld.current = hasHeld;
    if (!touched.current) setChosen(hasHeld ? null : defaultView.current);
  }, [hasHeld]);
  // What can be switched to. The proposal is normally the first of `views`;
  // it is added where it is not, so that starting at none — or pressing "No
  // picture" — can never lose the one view the read proposed.
  const offered = [
    ...(proposal && !views.some((view) => sameView(view, proposal)) ? [proposal] : []),
    ...views,
    ...(fallback ? [fallback] : []),
  ];
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);
  // ==========================================================================
  // THE CALLBACK CANNOT BE ALLOWED TO RE-RASTERISE THE PAGE.
  //
  // `onCropped` arrives as an inline arrow from the card — `(image) =>
  // onImage(item.id, image)` — so it is a new function on every parent render.
  // With it in the effect's dependencies, every re-render of the card started
  // a fresh crop of an A3 drawing: eleven cards produced thirty-three renders
  // of the same pack, each one superseding a render nothing had cancelled, and
  // the picture panels stayed on "Rendering…" while they fought over the
  // worker. Max saw it as a panel that never resolved, and occasionally as
  // "Could not render" with an error out of pdfjs's own internals.
  //
  // Held in a ref instead: the crop depends on WHAT IS BEING CROPPED, never on
  // the identity of the function that receives it. A caller passing a lambda
  // is normal React and must not be able to cause this.
  // ==========================================================================
  const report = useRef(onCropped);
  report.current = onCropped;
  /** The crop currently in flight, so a newer one can cancel it. */
  const inFlight = useRef<AbortController | null>(null);

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
      // Whatever was being rasterised is no longer what is wanted.
      inFlight.current?.abort();
      if (!view) {
        setPreview(null);
        report.current(null);
        return;
      }
      const controller = new AbortController();
      inFlight.current = controller;
      setRendering(true);
      setError(null);
      try {
        const image = await cropPdfRegion(sourceUrl, view.page ?? itemPage ?? 1, view.bbox, {
          signal: controller.signal,
        });
        setPreview(track(image.blob));
        report.current(image);
      } catch (cause) {
        // A CANCELLED CROP IS NOT A FAILURE. It means this component asked for
        // a different one, and the newer call owns the panel now — reporting
        // it would flash "Could not render" over a picture that is about to
        // arrive, and would tell the card it has no image when it is about to
        // have one.
        if (controller.signal.aborted) return;
        // Never fatal to the card. A drawing this cannot rasterise is a card
        // that confirms its specs with no picture, which is the behaviour that
        // existed before pictures did.
        setError(cause instanceof Error ? cause.message : "That page could not be read.");
        setPreview(null);
        report.current(null);
      } finally {
        // Always resets, so a failure cannot leave the card spinning — but only
        // for the crop that is still the current one.
        if (inFlight.current === controller) {
          inFlight.current = null;
          setRendering(false);
        }
      }
    },
    [sourceUrl, itemPage, track],
  );

  useEffect(() => {
    void render(chosen);
    // `render` depends only on the source, the page and the crop box, so this
    // runs when the chosen VIEW changes and at no other time. It said as much
    // before and was not true: `onCropped` was in its dependencies.
  }, [chosen, render]);

  // A card scrolled away, or a screen left, must not go on rasterising.
  useEffect(() => () => inFlight.current?.abort(), []);

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
                {error ? "Could not render" : held > 0 ? "None from this drawing" : "No picture"}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-[12rem] flex-1">
          {chosen ? (
            <p className="text-sm text-neutral-700">
              {/* Named for what it is. A whole-page crop that called itself a
                  "View" would look like something the drawing had pointed at. */}
              {sameView(chosen, fallback) ? "The whole page" : (VIEW_LABELS[chosen.viewType] ?? "View")}
              {chosen.page && <span className="text-neutral-500"> · page {chosen.page}</span>}
              {sameView(chosen, fallback) && (
                <span className="block text-xs text-neutral-500">
                  The drawing reported no separate picture, so the page itself is proposed. Drag a box to crop it
                  closer.
                </span>
              )}
              {held > 0 && (
                // Said once a picture is CHOSEN, never before: the replace is
                // the consequence of the choice, and the confirm deletes the
                // old row (confirm-drawings.ts) rather than keeping two.
                <span className="block text-xs text-amber-800">
                  {held < of
                    ? `Confirming replaces the current picture on ${held} of the ${of} records.`
                    : "Confirming replaces the item's current picture."}
                </span>
              )}
            </p>
          ) : held > 0 ? (
            <p className="text-sm text-neutral-600">
              {held < of
                ? `${held} of ${of} records already have a picture, so none will be taken from this drawing.`
                : "This item already has a picture, so none will be taken from this drawing."}
            </p>
          ) : (
            <p className="text-sm text-neutral-600">No picture will be saved for this item.</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Every OTHER view the model reported, so switching is one click
                rather than a drag. The proposal is just the first of these.
                The whole page joins the list where it is the fallback, so
                "No picture" is not a one-way door. */}
            {offered
              .filter((view) => !sameView(view, chosen))
              .map((view, index) => (
                <Button
                  key={`${view.viewType}-${view.page}-${index}`}
                  size="xs"
                  onClick={() => choose(view)}
                >
                  {sameView(view, fallback) ? "Use the whole page" : `Use ${(VIEW_LABELS[view.viewType] ?? "view").toLowerCase()}`}
                </Button>
              ))}
            <Button size="xs" onClick={() => void startCropping()}>
              {chosen ? "Drag a box instead" : "Drag a box"}
            </Button>
            {chosen && (
              // Quiet, because it clears rather than chooses — and it is not a
              // one-way door: the whole page is offered straight back above.
              <Button size="xs" variant="quiet" onClick={() => choose(null)}>
                No picture
              </Button>
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
            choose({ viewType: "other", page: chosen?.page ?? itemPage ?? 1, bbox });
          }}
        />
      )}
      {dragging && !pageImage && <p className="mt-2 text-xs text-neutral-500">Rendering the page…</p>}
    </div>
  );
}
