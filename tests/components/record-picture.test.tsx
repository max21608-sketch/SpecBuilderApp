// The record's picture panel (2026-10-05): the caption says where the picture
// came from, the swap button appears only where there is something to swap
// in, "Change crop" only under a drawing crop, and the swap sends ids only.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordPicture, { type RecordPictureState } from "@/components/records/RecordPicture";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

const CURRENT = "11111111-1111-1111-1111-111111111111";
const OFFERED = "22222222-2222-2222-2222-222222222222";

function show(picture: RecordPictureState, overrides: Partial<Parameters<typeof RecordPicture>[0]> = {}) {
  const onChosen = vi.fn();
  render(
    <RecordPicture
      recordId="rec-1"
      alt="Lounge chair"
      picture={picture}
      failed={false}
      onFailed={() => {}}
      drawingRunId="run-9"
      onChosen={onChosen}
      {...overrides}
    />,
  );
  return { onChosen };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe("the record's picture", () => {
  it("says a bill's picture came from the bill, by row, and offers no swap with nothing to swap", () => {
    show({ current: { id: CURRENT, source: { kind: "bill", row: 36 } }, offered: null });
    expect(screen.getByText("From the bill, row 36")).toBeInTheDocument();
    expect(screen.queryByText("Cropped off the drawings")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // A bill's photograph has no crop to change.
    expect(screen.queryByRole("link", { name: "Change crop" })).toBeNull();
  });

  it("says a crop came off the drawings, by page, and links to change it", () => {
    show({ current: { id: CURRENT, source: { kind: "drawing", page: 4 } }, offered: null });
    expect(screen.getByText("Cropped off the drawings, page 4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change crop" })).toHaveAttribute("href", "/dashboard/imports/run-9");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("serves the current picture under its own id, so a swap is not read out of the cache", () => {
    show({ current: { id: CURRENT, source: { kind: "bill", row: 1 } }, offered: null });
    expect(screen.getByRole("img", { name: "Lounge chair" })).toHaveAttribute("src", `/api/records/rec-1/image?v=${CURRENT}`);
  });

  it("offers the drawing's crop beside a bill's picture, and swaps it in with ids only", async () => {
    const { onChosen } = show({
      current: { id: CURRENT, source: { kind: "bill", row: 36 } },
      offered: { id: OFFERED, source: { kind: "drawing", page: 2 } },
    });
    expect(screen.getByText("The drawings offer this picture")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /as the drawings offer this picture/ })).toHaveAttribute(
      "src",
      `/api/records/rec-1/image?attachment=${OFFERED}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Use the drawing's picture" }));
    await waitFor(() => expect(onChosen).toHaveBeenCalledWith(null));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/records/rec-1/image/choose");
    expect(JSON.parse(String(init.body))).toEqual({ attachmentId: OFFERED, currentAttachmentId: CURRENT });
  });

  it("offers the bill's picture back under a crop that replaced it", () => {
    show({
      current: { id: CURRENT, source: { kind: "drawing", page: 2 } },
      offered: { id: OFFERED, source: { kind: "bill", row: 36 } },
    });
    expect(screen.getByText("The bill printed this picture")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use the bill's picture" })).toBeInTheDocument();
  });

  it("passes a refusal on in words for the screen to show after its reload", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 409, error: "This item's picture changed since you looked at it.", data: null });
    const { onChosen } = show({
      current: { id: CURRENT, source: { kind: "bill", row: 36 } },
      offered: { id: OFFERED, source: { kind: "drawing", page: null } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Use the drawing's picture" }));
    await waitFor(() => expect(onChosen).toHaveBeenCalledWith("This item's picture changed since you looked at it."));
    expect(screen.getByRole("button", { name: "Use the drawing's picture" })).not.toBeDisabled();
  });

  it("renders nothing with no picture and nothing offered", () => {
    const { container } = render(
      <RecordPicture
        recordId="rec-1"
        alt="x"
        picture={{ current: null, offered: null }}
        failed={false}
        onFailed={() => {}}
        drawingRunId={null}
        onChosen={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
