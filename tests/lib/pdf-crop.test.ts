// Pure tier — the crop's arithmetic, against a REAL rotated PDF.
//
// ============================================================================
// STAGE 2 VARIANCE ROW 5: A PAGE ROTATED 90 DEGREES.
//
// The expected outcome is "proceeds", and the brief's condition on it is the
// point: if pdfjs already normalises rotation, prove it rather than assume it.
// So this loads a synthetic PDF built by `tests/fixtures/build-pdf.mjs`, one
// page per rotation, and asks pdfjs what it reports — and then puts those
// numbers through `cropGeometry`, which is the crop's own maths lifted out of
// the browser so it can be asked this question at all.
//
// WHAT THE TRAP LOOKS LIKE. `/Rotate` does not change the MediaBox: a rotated
// 600 x 400 page still has `page.view` of [0, 0, 600, 400], and `getViewport()`
// reports 400 x 600 — the page as a reader sees it. A bbox is in fractions of
// the page AS DISPLAYED, because that is what the model read and what a drag
// produces. Size the canvas off the MediaBox and the region comes out against
// the wrong axes: the top-left quarter of a portrait page, rendered as a
// landscape strip. It would read as the model having misread the page.
//
// The canvas itself is not exercised — there is none in the node tier, and
// rasterising is the browser's job by design (`pdf-crop.ts`'s own header).
// What is exercised is every number the canvas is given.
// ============================================================================
import { describe, expect, it, beforeAll } from "vitest";
import { buildPdf } from "../fixtures/build-pdf.mjs";
import { cropGeometry, MAX_IMAGE_PX } from "@/lib/pdf-crop";

type Viewport = { width: number; height: number; transform: number[] };
type Page = { rotate: number; view: number[]; getViewport: (options: { scale: number }) => Viewport };

// 600 x 400 landscape, printed four ways. Invented, and built rather than
// committed: a real drawing never enters this repo.
const ROTATIONS = [0, 90, 180, 270] as const;

describe("a page's own rotation", () => {
  const pages: Page[] = [];

  beforeAll(async () => {
    // The legacy build is the one that runs outside a browser.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = buildPdf(ROTATIONS.map((rotate) => ({ width: 600, height: 400, rotate, label: `__QA ${rotate}` })));
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    expect(doc.numPages).toBe(ROTATIONS.length);
    for (let n = 1; n <= doc.numPages; n += 1) pages.push((await doc.getPage(n)) as unknown as Page);
  }, 30_000);

  it("reads /Rotate off the page and reports the TURNED dimensions", () => {
    expect(pages.map((page) => page.rotate)).toEqual([0, 90, 180, 270]);
    // The MediaBox never moves. This is the number that would be wrong to use.
    for (const page of pages) expect(page.view).toEqual([0, 0, 600, 400]);
    // The viewport does. 90 and 270 turn the landscape page portrait.
    expect(pages.map((page) => [page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height])).toEqual([
      [600, 400],
      [400, 600],
      [600, 400],
      [400, 600],
    ]);
  });

  it("bakes the rotation into the transform it renders with", () => {
    // Not an identity plus a flip on a turned page: the axes are exchanged, so
    // the render itself puts the pixels where the viewport says they are.
    expect(pages[0]!.getViewport({ scale: 1 }).transform).toEqual([1, 0, 0, -1, 0, 400]);
    expect(pages[1]!.getViewport({ scale: 1 }).transform).toEqual([0, 1, 1, 0, 0, 0]);
    expect(pages[3]!.getViewport({ scale: 1 }).transform).toEqual([0, -1, -1, 0, 400, 600]);
  });

  it("crops the LEFT HALF of a rotated page as a tall region, not a wide one", () => {
    // The left half of a portrait 400 x 600: 200 wide by 600 high.
    const bbox: [number, number, number, number] = [0, 0, 0.5, 1];
    const turned = pages[1]!.getViewport({ scale: 1 });
    const geometry = cropGeometry({ width: turned.width, height: turned.height }, bbox);
    expect("tooSmall" in geometry).toBe(false);
    if ("tooSmall" in geometry) return;
    // 200 x 600 in page units, so the long side is the HEIGHT.
    expect(geometry.canvasHeight).toBeGreaterThan(geometry.canvasWidth);
    expect(geometry.canvasHeight / geometry.canvasWidth).toBeCloseTo(3, 1);

    // The same bbox against the MEDIABOX — the wrong pair — is 300 x 400, a
    // 3:4 region where the page's own left half is 1:3. This assertion is the
    // defect written down: the two disagree, so which pair `renderCrop` passes
    // is load-bearing rather than incidental.
    const fromMediaBox = cropGeometry({ width: 600, height: 400 }, bbox);
    if ("tooSmall" in fromMediaBox) throw new Error("the mediabox case should have produced a region");
    expect(fromMediaBox.canvasWidth / fromMediaBox.canvasHeight).toBeCloseTo(0.75, 2);
    expect(geometry.canvasWidth / geometry.canvasHeight).toBeCloseTo(1 / 3, 2);
  });

  it("shifts the page by the rotated page's own distances", () => {
    // The bottom-right quarter of the turned page. The translate has to be in
    // the same space as the width and height, or the crop lands elsewhere.
    const bbox: [number, number, number, number] = [0.5, 0.5, 1, 1];
    const turned = pages[1]!.getViewport({ scale: 1 });
    const geometry = cropGeometry({ width: turned.width, height: turned.height }, bbox);
    if ("tooSmall" in geometry) throw new Error("the region should have been big enough");
    expect(geometry.translateX).toBeCloseTo(-0.5 * 400 * geometry.scale, 6);
    expect(geometry.translateY).toBeCloseTo(-0.5 * 600 * geometry.scale, 6);
  });

  it("sizes every crop to the thumbnail budget before supersampling", () => {
    // Held here because it is the one thing a reviewer sees go wrong — a crop
    // rendered at a handful of pixels, or an A3 page rasterised at 8000px.
    for (const page of pages) {
      const viewport = page.getViewport({ scale: 1 });
      const geometry = cropGeometry({ width: viewport.width, height: viewport.height }, [0, 0, 1, 1]);
      if ("tooSmall" in geometry) throw new Error("a whole page is not too small");
      expect(Math.max(geometry.canvasWidth, geometry.canvasHeight)).toBe(MAX_IMAGE_PX * 2);
    }
  });

  it("refuses a region too small to be anything but an accident", () => {
    const turned = pages[1]!.getViewport({ scale: 1 });
    // The 2% minimum on the cropper is what separates "no crop" from a
    // one-pixel smear somebody has to notice and undo.
    expect(cropGeometry({ width: turned.width, height: turned.height }, [0.5, 0.5, 0.5, 0.5])).toEqual({ tooSmall: true });
    // And an inverted box, which a drag upwards produces.
    expect(cropGeometry({ width: turned.width, height: turned.height }, [0.8, 0.8, 0.2, 0.2])).toEqual({ tooSmall: true });
  });
});
