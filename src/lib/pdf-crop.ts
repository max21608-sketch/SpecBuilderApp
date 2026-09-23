// Cropping a picture of an item out of the drawing it was found on.
//
// ============================================================================
// WHY THIS RUNS IN THE BROWSER AND NOT IN THE WORKER.
//
// Turning a region of a PDF page into a PNG needs the page RASTERISED, and a
// shop drawing's views are vector linework — there is no embedded image to pull
// out. Rasterising server-side means a canvas, which means a native binary in a
// serverless function, and it means `render()` on a large CAD page inside a
// 300-second function: the one request that takes the whole instance down.
//
// The browser already has a canvas, and the reviewer is already looking at the
// page. So the crop is made where it will be looked at, and the human confirms
// the actual pixels rather than a description of them. That also gives ONE path
// for both document kinds: a specification sheet's embedded photograph and a
// drawing's vector 3D view render identically here, where a server-side
// extract-the-embedded-image approach would only have handled the first.
//
// The PDF comes from /api/imports/[id]/source — same origin, authenticated,
// range-capable — so no blob URL or store credential is involved.
//
// NOTHING HERE IS AUTHORITATIVE. The crop is a proposal until a human confirms
// the card, and the source PDF is preserved, so any crop can be re-made.
// ============================================================================

/** The longest side of a stored crop. A thumbnail, not an archival copy. */
export const MAX_IMAGE_PX = 640;

/**
 * How much bigger than the final thumbnail to rasterise before downscaling.
 * Vector linework rendered at exactly the output size aliases badly; rendering
 * at 2x and letting the browser's own filtering do the reduction is the cheap
 * fix, and 2x is where the quality stops improving noticeably.
 */
const SUPERSAMPLE = 2;

export type CropBox = [number, number, number, number];

export type CroppedImage = {
  blob: Blob;
  width: number;
  height: number;
};

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Loaded on demand, once. pdfjs is about a megabyte, and the only screen that
 * needs it is the drawings review — a static import would put it in the bundle
 * of every page in the app.
 */
async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Without this the library looks for a worker next to its own module
      // path, which the bundler has moved. `new URL(..., import.meta.url)` is
      // the form the bundler rewrites to the emitted asset.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * How many pages a PDF the person has CHOSEN has, before a byte of it is
 * stored — or NULL where pdfjs could not tell.
 *
 * The same pdfjs and the same worker as the crops (`loadPdfjs`), never a
 * second setup. NULL MEANS PROCEED (`pdfUploadVerdict`): a count that failed
 * is not evidence the document is too large, and refusing on it would leave
 * somebody with a file they cannot get in. The server still checks at the read.
 */
export async function countPdfPagesInBrowser(file: Blob): Promise<number | null> {
  try {
    const pdfjs = await loadPdfjs();
    // A copy of the bytes: pdfjs transfers the buffer it is given to its worker.
    const data = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
    try {
      return document.numPages;
    } finally {
      void document.destroy();
    }
  } catch {
    return null;
  }
}

type LoadedDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

const documents = new Map<string, Promise<LoadedDocument>>();

/**
 * One parsed document per source URL, shared by every card on the screen.
 *
 * A pack of thirty per-item sheets is thirty URLs and thirty small documents;
 * one combined set is a single URL that forty cards all crop from, and parsing
 * a 5MB PDF forty times is the difference between a screen that loads and one
 * that does not.
 */
export async function openPdf(url: string): Promise<LoadedDocument> {
  const existing = documents.get(url);
  if (existing) return existing;
  const loading = (async () => {
    const pdfjs = await loadPdfjs();
    return pdfjs.getDocument({
      url,
      // The PDF is a client document and therefore untrusted input. No eval, and
      // no reaching out to the system for fonts.
      isEvalSupported: false,
      useSystemFonts: false,
      // Same-origin and cookie-authenticated: the route resolves the file from
      // the run's own attachment row, so nothing here names a blob.
      withCredentials: true,
      // ====================================================================
      // ONE REQUEST FOR THE FILE, NOT A HUNDRED.
      //
      // By default pdfjs keeps a background download of the whole file open
      // AND issues 64KB range requests for whatever a page needs. Every one of
      // those goes through this app's own route to a blob store in another
      // region: the real 5MB drawing set was measured at 123 requests for one
      // visit to the review screen, against a browser limit of six connections
      // to this origin that the screen's own API calls are also using.
      //
      // A drawing set is a few megabytes and EVERY page of it is about to be
      // cropped for a card, so there is nothing to save by fetching it
      // piecemeal. One GET, held in the cache above, and every crop after that
      // is local — measured at 1 request for the same visit.
      // ====================================================================
      disableRange: true,
      disableStream: true,
    }).promise;
  })();
  documents.set(url, loading);
  // A failed parse must not be cached as a permanent failure -- a reviewer
  // should be able to retry after a network blip.
  loading.catch(() => documents.delete(url));
  return loading;
}

/** Forget a document, so a re-extracted run is not served from the old parse. */
export function forgetPdf(url: string): void {
  documents.delete(url);
}

/**
 * ONE CROP AT A TIME, ACROSS THE WHOLE SCREEN.
 *
 * A pack screen mounts a picture panel per card and a page preview per
 * disputed item, and every one of them asks for a crop the moment it appears:
 * eleven cards meant two dozen simultaneous requests for the same document.
 * Each one rasterises an A3 drawing into a 1280px canvas and pulls the ranges
 * of the PDF it needs, so they compete for one worker, for the browser's six
 * connections to this origin, and for the main thread that has to composite
 * the result — and the panels sat on "Rendering…" for minutes, sometimes for
 * ever.
 *
 * Serialising costs nothing in total work: the same crops are made, in the
 * order they were asked for, and the first one now appears in a second instead
 * of all of them appearing eventually. It also bounds memory, which two dozen
 * simultaneous canvases did not.
 *
 * A cancelled crop still has to leave the queue, which is why the chain is
 * advanced in a `finally` and never by the caller.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  // The chain must not inherit a rejection: one page that cannot be rasterised
  // would otherwise take every later crop down with it.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Render one region of one page to a PNG.
 *
 * `bbox` is in page fractions with the origin top-left, which is what the model
 * reports and what a drag on a rendered page produces. PDF user space has its
 * origin bottom-left, but `getViewport` already returns a top-left device space,
 * so the two agree and no flip is needed.
 *
 * Pass a `signal` to abandon a crop that is no longer wanted: it cancels the
 * render rather than leaving it running, and rejects with pdfjs's
 * RenderingCancelledException. Anything driving this from an effect should
 * pass one.
 */
export type CropGeometry = {
  /** Render scale for the page, chosen so the crop lands on the thumbnail budget. */
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  /** How far to shift the page so the region's top-left sits at the canvas origin. */
  translateX: number;
  translateY: number;
};

/**
 * The crop's own arithmetic, apart from the canvas so it can be proved.
 *
 * ============================================================================
 * `pageWidth` AND `pageHeight` COME FROM THE VIEWPORT, NEVER FROM THE MEDIABOX.
 *
 * That is the whole of Stage 2 variance row 5, and it is why this is a function
 * with named arguments rather than four lines reading `page.something`. A page
 * carrying `/Rotate 90` keeps its MediaBox: `page.view` on a rotated A4 still
 * reads 595 x 842, and pdfjs's `getViewport()` reports 842 x 595 — the page as
 * a reader sees it — with the rotation baked into the transform it renders
 * with. `bbox` is in fractions of the page AS DISPLAYED, which is what the
 * model reports (it read the page as an image) and what a drag on a rendered
 * page produces.
 *
 * So the viewport is the only pair of numbers that agrees with both the bbox
 * and the render. Taking the MediaBox instead would size the canvas against
 * the wrong axes and shift the page by the wrong distances, and a region
 * reported on a rotated page would come out as a different part of it — which
 * looks like a model that read the page wrongly rather than like a bug here.
 * `tests/lib/pdf-crop.test.ts` proves the swap against a real rotated PDF.
 * ============================================================================
 */
export function cropGeometry(
  page: { width: number; height: number },
  bbox: CropBox,
): CropGeometry | { tooSmall: true } {
  const [x0, y0, x1, y1] = bbox;
  const regionWidth = Math.max(0, x1 - x0) * page.width;
  const regionHeight = Math.max(0, y1 - y0) * page.height;
  if (regionWidth < 1 || regionHeight < 1) return { tooSmall: true };

  // Scale so the LONGEST side of the crop lands on the thumbnail budget, then
  // supersample. Sizing off the page instead would make a small inset render at
  // a handful of pixels.
  const target = (MAX_IMAGE_PX * SUPERSAMPLE) / Math.max(regionWidth, regionHeight);
  // Never upscale past the supersample factor: blowing a 40pt detail up to
  // 1280px makes a blurry picture look like a deliberate one.
  const scale = Math.min(target, SUPERSAMPLE * 4);
  return {
    scale,
    canvasWidth: Math.max(1, Math.round(regionWidth * scale)),
    canvasHeight: Math.max(1, Math.round(regionHeight * scale)),
    translateX: -x0 * page.width * scale,
    translateY: -y0 * page.height * scale,
  };
}

export function cropPdfRegion(
  url: string,
  pageNumber: number,
  bbox: CropBox,
  options: { signal?: AbortSignal } = {},
): Promise<CroppedImage> {
  return enqueue(() => renderCrop(url, pageNumber, bbox, options));
}

async function renderCrop(
  url: string,
  pageNumber: number,
  bbox: CropBox,
  options: { signal?: AbortSignal },
): Promise<CroppedImage> {
  // Already superseded while it waited its turn: do not rasterise it at all.
  if (options.signal?.aborted) throw new DOMException("The crop was superseded.", "AbortError");
  const doc = await openPdf(url);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));

  // The VIEWPORT, not `page.view`: a page carrying /Rotate 90 keeps its
  // MediaBox and pdfjs reports the turned dimensions here, with the rotation
  // baked into the transform the render below uses. See `cropGeometry`.
  const base = page.getViewport({ scale: 1 });
  const geometry = cropGeometry({ width: base.width, height: base.height }, bbox);
  if ("tooSmall" in geometry) throw new Error("That area of the page is too small to capture.");
  const { scale, canvasWidth, canvasHeight, translateX, translateY } = geometry;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser would not provide a canvas to draw on.");

  // White first. A PDF page has no background of its own, and a transparent
  // crop turns black the moment anything composites it onto a dark surface.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Shift the page so the region's top-left sits at the canvas origin.
  context.translate(translateX, translateY);

  // ============================================================================
  // A SUPERSEDED RENDER IS CANCELLED, NOT ABANDONED.
  //
  // Rasterising an A3 drawing is the most expensive thing this screen does, and
  // a card can ask for a new crop before the last one has finished — the
  // reviewer switches view, or the component re-runs its effect. Without a
  // cancel, the abandoned task keeps rasterising: eleven cards restarting
  // turned into thirty-three renders of the same pack, every one of them
  // holding a 1280px canvas and competing for the same worker, and the picture
  // panels sat on "Rendering…" long after the page had settled.
  //
  // `task.cancel()` rejects the promise with a RenderingCancelledException,
  // which the caller is expected to treat as "superseded" rather than as a
  // failure to report.
  // ============================================================================
  const task = page.render({ canvasContext: context, viewport, background: "rgba(0,0,0,0)" });
  const cancel = () => task.cancel();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }

  const finished = downscale(canvas, MAX_IMAGE_PX);
  const blob = await toPngBlob(finished);
  return { blob, width: finished.width, height: finished.height };
}

/** Reduce to the thumbnail budget, in one step. */
function downscale(source: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxPx) return source;
  const ratio = maxPx / longest;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * ratio));
  out.height = Math.max(1, Math.round(source.height * ratio));
  const context = out.getContext("2d");
  if (!context) return source;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Null means the browser refused, which is rare but real (a tainted
      // canvas, or memory pressure). Rejecting gives the screen a sentence to
      // show instead of a silent failure to attach anything.
      if (blob) resolve(blob);
      else reject(new Error("The picture could not be encoded."));
    }, "image/png");
  });
}

/** How many pages the source has, for a page picker that cannot overshoot. */
export async function pdfPageCount(url: string): Promise<number> {
  return (await openPdf(url)).numPages;
}
