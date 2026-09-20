// The swatch picker, and the page it can reach.
//
// ============================================================================
// WHAT THIS PROVES
//
// Reported 2026-09-19: *"It was on the second page, and I've only got one
// page."* A two-page item is the normal case — a shop drawing, then the
// finishes sheet — and the picker was scoped to the one page the finish row
// was read from, so a chip printed on the other page of the SAME item could
// not be cropped at all.
//
// The trap in fixing it is the other half: a picker that offers page 2 and
// then records page 1 cites a page the picture did not come from, which is
// worse than citing none — a swatch nobody can check against a drawing is the
// thing the standalone swatch route refuses an upload for. So the selector's
// value is what `onCropped` hands back.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SwatchPicker from "@/components/imports/SwatchPicker";

const crops = vi.hoisted(() => ({
  calls: [] as unknown[][],
  pending: [] as ((value: unknown) => void)[],
}));

vi.mock("@/lib/pdf-crop", () => ({
  cropPdfRegion: (...args: unknown[]) => {
    crops.calls.push(args);
    return new Promise((resolve) => crops.pending.push(resolve));
  },
}));

/** Finish every crop asked for so far, as a real rasterisation would. */
async function settleCrops() {
  const waiting = crops.pending.splice(0);
  for (const resolve of waiting) resolve({ blob: new Blob(["x"]), width: 10, height: 10 });
  await act(async () => undefined);
}

/** Which page each `cropPdfRegion` call asked for, in order. */
const pagesAsked = () => crops.calls.map((call) => call[1]);

/**
 * Drag a box over the rendered page.
 *
 * jsdom lays nothing out, so the cropper's own element has a zero-sized rect
 * and every fraction it computes is NaN. A 100x100 box is enough for the 2%
 * minimum to pass and keeps the arithmetic readable: 10,10 → 60,60 is the
 * middle half of the page.
 */
async function dragACrop() {
  const image = screen.getByAltText("");
  const box = image.parentElement!;
  box.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.mouseDown(box, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(box, { clientX: 60, clientY: 60 });
  fireEvent.mouseUp(box, { clientX: 60, clientY: 60 });
  await act(async () => undefined);
}

describe("the swatch picker", () => {
  beforeEach(() => {
    crops.calls = [];
    crops.pending = [];
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;
  });

  it("offers no page selector on an item drawn on one page", () => {
    render(
      <SwatchPicker importId="import-1" page={3} pages={[3]} code="UPH-07" onCropped={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "Crop the swatch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "page 3" })).not.toBeInTheDocument();
  });

  it("offers every page of the item, and defaults to the page the row was read from", async () => {
    render(
      <SwatchPicker importId="import-1" page={5} pages={[4, 5, 6]} code="UPH-07" onCropped={() => undefined} />,
    );
    // Every page of the item, in page order — not only the row's own.
    expect(screen.getByRole("button", { name: "page 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "page 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "page 6" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Crop the swatch" }));
    await settleCrops();
    // THE ROW'S OWN PAGE, which is where the chip usually is.
    expect(pagesAsked()).toEqual([5]);
  });

  it("crops from the page that was selected, and reports that page", async () => {
    const cropped: { page: number | null }[] = [];
    render(
      <SwatchPicker
        importId="import-1"
        page={5}
        pages={[5, 6]}
        code="UPH-07"
        onCropped={(image, page) => cropped.push({ page: image ? page : null })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "page 6" }));
    await userEvent.click(screen.getByRole("button", { name: "Crop the swatch" }));
    await settleCrops();
    expect(pagesAsked()).toEqual([6]);

    await dragACrop();
    await settleCrops();
    // Both the render and the crop came off page 6 …
    expect(pagesAsked()).toEqual([6, 6]);
    // … and page 6 is what the card is told, so the confirm records it.
    expect(cropped).toEqual([{ page: 6 }]);
  });

  it("says which page it is showing when the row itself has none", async () => {
    render(
      <SwatchPicker importId="import-1" page={null} pages={[7, 8]} code="WD-05" onCropped={() => undefined} />,
    );
    expect(screen.getByText(/Page unknown for this value — showing page 7/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crop the swatch" }));
    await settleCrops();
    expect(pagesAsked()).toEqual([7]);
  });
});
