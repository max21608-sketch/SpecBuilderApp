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
 * Render one region of one page to a PNG.
 *
 * `bbox` is in page fractions with the origin top-left, which is what the model
 * reports and what a drag on a rendered page produces. PDF user space has its
 * origin bottom-left, but `getViewport` already returns a top-left device space,
 * so the two agree and no flip is needed.
 */
export async function cropPdfRegion(
  url: string,
  pageNumber: number,
  bbox: CropBox,
): Promise<CroppedImage> {
  const doc = await openPdf(url);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));

  const base = page.getViewport({ scale: 1 });
  const [x0, y0, x1, y1] = bbox;
  const regionWidth = Math.max(0, x1 - x0) * base.width;
  const regionHeight = Math.max(0, y1 - y0) * base.height;
  if (regionWidth < 1 || regionHeight < 1) throw new Error("That area of the page is too small to capture.");

  // Scale so the LONGEST side of the crop lands on the thumbnail budget, then
  // supersample. Sizing off the page instead would make a small inset render at
  // a handful of pixels.
  const target = (MAX_IMAGE_PX * SUPERSAMPLE) / Math.max(regionWidth, regionHeight);
  // Never upscale past the supersample factor: blowing a 40pt detail up to
  // 1280px makes a blurry picture look like a deliberate one.
  const scale = Math.min(target, SUPERSAMPLE * 4);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(regionWidth * scale));
  canvas.height = Math.max(1, Math.round(regionHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser would not provide a canvas to draw on.");

  // White first. A PDF page has no background of its own, and a transparent
  // crop turns black the moment anything composites it onto a dark surface.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Shift the page so the region's top-left sits at the canvas origin.
  context.translate(-x0 * base.width * scale, -y0 * base.height * scale);

  await page.render({ canvasContext: context, viewport, background: "rgba(0,0,0,0)" }).promise;

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
