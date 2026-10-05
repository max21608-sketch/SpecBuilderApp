// The picture panel, and the thing that made it sit on "Rendering…".
//
// ============================================================================
// WHAT THIS PROVES, AND WHY IT IS WORTH A TEST
//
// The panel is driven by an effect, and the card passes its callback as an
// inline arrow — `(image) => onImage(item.id, image)` — which is a new
// function on every parent render. With that callback in the effect's
// dependencies, every re-render of the card started a fresh rasterisation of
// an A3 drawing: eleven cards were measured making thirty-three renders of the
// same pack, each superseding one that nothing cancelled.
//
// A caller passing a lambda is ordinary React and will happen again, so the
// guarantee belongs here rather than in a rule about how to call it.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemImagePicker from "@/components/imports/ItemImagePicker";
import type { ItemView } from "@/lib/drawing-document";

const crops = vi.hoisted(() => ({
  calls: [] as unknown[][],
  /** Held open, so a test can decide when — or whether — a crop finishes. */
  pending: [] as ((value: unknown) => void)[],
  settleAll: () => undefined as void,
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

const view: ItemView = { viewType: "3d", page: 3, bbox: [0, 0, 1, 1] };

/** A card that re-renders, passing a NEW inline callback every time — as the real one does. */
function Card({ onImage }: { onImage: (image: unknown) => void }) {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        re-render {tick}
      </button>
      <ItemImagePicker
        importId="import-1"
        itemPage={3}
        proposal={view}
        views={[view]}
        onCropped={(image) => onImage(image)}
      />
    </div>
  );
}

describe("the picture panel", () => {
  beforeEach(() => {
    crops.calls = [];
    // `pending`, not `resolve`: the double holds the RESOLVERS so a test can
    // decide when a crop finishes. The old name typechecked as never and left
    // one case's held-open resolvers in place for the next.
    crops.pending = [];
    // jsdom has no object URLs.
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;
  });

  it("crops the proposed view once", async () => {
    render(<Card onImage={() => undefined} />);
    await settleCrops();
    expect(crops.calls).toHaveLength(1);
    expect(crops.calls[0]?.[1]).toBe(3);
    expect(crops.calls[0]?.[2]).toEqual([0, 0, 1, 1]);
  });

  it("does NOT re-rasterise when the card re-renders around it", async () => {
    render(<Card onImage={() => undefined} />);
    await settleCrops();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /re-render/ }));
    await user.click(screen.getByRole("button", { name: /re-render/ }));
    await settleCrops();
    // Three renders of the card, one crop. This was 3 before the callback
    // moved into a ref.
    expect(crops.calls).toHaveLength(1);
  });

  it("passes a signal, so a superseded crop can be cancelled", async () => {
    render(<Card onImage={() => undefined} />);
    await settleCrops();
    const options = crops.calls[0]?.[3] as { signal?: AbortSignal } | undefined;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(false);
  });

  it("abandons a crop still in flight when the card goes away", async () => {
    // Deliberately NOT settled: this is the case that mattered — a reviewer
    // leaving the screen while eleven A3 pages are still rasterising.
    const view = render(<Card onImage={() => undefined} />);
    await act(async () => undefined);
    const options = crops.calls[0]?.[3] as { signal?: AbortSignal } | undefined;
    view.unmount();
    // A screen the reviewer has left must not go on rasterising A3 pages.
    expect(options?.signal?.aborted).toBe(true);
  });
});

describe("an item that already has a picture (Max, 2026-10-05)", () => {
  beforeEach(() => {
    crops.calls = [];
    crops.pending = [];
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;
  });

  function Held({ onImage, held = ["r-1"], of = 1 }: { onImage: (image: unknown) => void; held?: string[]; of?: number }) {
    return (
      <ItemImagePicker
        importId="import-1"
        itemPage={3}
        proposal={view}
        views={[view]}
        existingPicture={{ recordIds: held, of }}
        onCropped={(image) => onImage(image)}
      />
    );
  }

  it("starts at no picture: nothing is cropped on mount and the card holds null", async () => {
    const onImage = vi.fn();
    render(<Held onImage={onImage} />);
    await settleCrops();
    expect(crops.calls).toHaveLength(0);
    expect(onImage).toHaveBeenCalledTimes(1);
    expect(onImage).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("This item already has a picture, so none will be taken from this drawing.")).toBeTruthy();
    expect(screen.queryByText(/Confirming replaces/)).toBeNull();
  });

  it("offers the proposal back, and choosing it crops it and says it replaces the picture", async () => {
    const onImage = vi.fn();
    render(<Held onImage={onImage} />);
    await settleCrops();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use 3d view" }));
    await settleCrops();
    expect(crops.calls).toHaveLength(1);
    expect(crops.calls[0]?.[1]).toBe(3);
    expect(onImage).toHaveBeenLastCalledWith(expect.objectContaining({ width: 10, height: 10 }));
    expect(screen.getByText("Confirming replaces the item's current picture.")).toBeTruthy();
    // And back again is one click.
    await user.click(screen.getByRole("button", { name: "No picture" }));
    expect(onImage).toHaveBeenLastCalledWith(null);
  });

  it("offers the whole page where nothing was reported, still starting at none", async () => {
    const onImage = vi.fn();
    render(
      <ItemImagePicker
        importId="import-1"
        itemPage={2}
        proposal={null}
        views={[]}
        existingPicture={{ recordIds: ["r-1"], of: 1 }}
        onCropped={(image) => onImage(image)}
      />,
    );
    await settleCrops();
    expect(crops.calls).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use the whole page" }));
    await settleCrops();
    expect(crops.calls).toHaveLength(1);
    expect(crops.calls[0]?.[2]).toEqual([0, 0, 1, 1]);
  });

  it("says how many where only some of the records have one, and still defaults to none", async () => {
    render(<Held onImage={() => undefined} held={["r-1", "r-2"]} of={3} />);
    await settleCrops();
    expect(crops.calls).toHaveLength(0);
    expect(screen.getByText("2 of 3 records already have a picture, so none will be taken from this drawing.")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use 3d view" }));
    await settleCrops();
    expect(screen.getByText("Confirming replaces the current picture on 2 of the 3 records.")).toBeTruthy();
  });
});
