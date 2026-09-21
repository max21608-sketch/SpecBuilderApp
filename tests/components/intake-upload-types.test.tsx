// What the upload screen accepts, and what it refuses before storing anything.
//
// ============================================================================
// VARIANCE MATRIX §6.10.a ROW 5 — the screen's half.
//
// The row asks for the measurement to be SAID on the upload screen, and for an
// `.xls` to be refused "before anything is stored". Both halves are here: the
// accepted-types sentence, and the guard that never reaches the blob store.
//
// `upload` is mocked and asserted NOT to have been called, which is the only
// way to prove "before anything is stored" — a refusal that happens after the
// bytes are in the store has spent a model call and left a file behind for a
// bill nobody can read.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import { BOQ_AS_PDF } from "@/lib/document-classify";

const upload = vi.fn();
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

function mount() {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  /** Drop files on the screen, the way the picker hands them over. */
  const drop = (...names: string[]) =>
    fireEvent.change(input, {
      target: { files: names.map((name) => new File(["x"], name, { type: "" })) },
    });
  return { ...view, drop };
}

const startButton = () => screen.getByRole("button", { name: /Start intake|Read the/ });

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
});

describe("the accepted types are stated before the press", () => {
  it("names what a bill reads from, including .csv", () => {
    mount();
    const sentence = screen.getByText(/A bill of quantities reads from/);
    expect(sentence.textContent).toContain(".xlsx, .csv, .tsv");
    expect(sentence.textContent).toContain("An older .xls has to be saved as .xlsx first.");
  });
});

describe("an older spreadsheet is refused in the browser", () => {
  it("says what it is and how to get out of it, and stores nothing", () => {
    const { drop } = mount();
    drop("Example bill.xls");
    expect(screen.getByText("Cannot be read")).toBeTruthy();
    expect(screen.getByText(/is an older Excel format \(\.xls\), which this app does not read/)).toBeTruthy();
    expect(screen.getByText(/Save As \.xlsx/)).toBeTruthy();
    // THE POINT OF DOING IT HERE. Nothing reached the store, so nothing was
    // classified and nothing was charged.
    expect(upload).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("leaves nothing to press, because there is nothing to retry", () => {
    // `refused` is terminal where `failed` is not: pressing again retries a
    // failed upload, and there is nothing to retry about a file format.
    const { drop } = mount();
    drop("Example bill.xls");
    expect(startButton()).toBeDisabled();
  });

  it("does not count it in what the press is about to read and charge for", () => {
    const { drop } = mount();
    drop("Example bill.xls", "Example drawings.pdf");
    expect(startButton()).not.toBeDisabled();
    // One small call, for the PDF. The .xls is not in that number, and neither
    // is it in the count on the button.
    expect(screen.getByText(/one small call/)).toBeTruthy();
    expect(startButton().textContent).toBe("Start intake (1)");
  });

  it("accepts a .csv bill without a word of complaint", () => {
    const { drop } = mount();
    drop("Example bill.csv");
    expect(screen.queryByText("Cannot be read")).toBeNull();
    expect(startButton()).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ROW 8's SCREEN HALF — a bill inside a PDF, refused after it is read.
//
// Unlike an `.xls`, nothing in the browser can tell a PDF bill from a PDF
// drawing set, so this refusal necessarily arrives from the classify call. What
// the screen has to do with it is the part worth proving: print the sentence,
// keep the file, and register NOTHING — a registration is what dispatches the
// charged read.
// ---------------------------------------------------------------------------
describe("a bill of quantities inside a PDF", () => {
  it("prints the refusal and registers nothing", async () => {
    upload.mockResolvedValue({ pathname: "projects/p1/uploads/bill.pdf" });
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
      if (url.includes("/classify")) {
        return {
          ok: true,
          status: 200,
          data: {
            genre: "bill_of_quantities",
            decision: null,
            unsupported: BOQ_AS_PDF,
            evidence: "the first page is headed BILL OF QUANTITIES",
          },
        };
      }
      return { ok: false, status: 500, error: "nothing else should be called", data: null };
    });

    const { drop } = mount();
    drop("Example bill.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText(/a bill inside a PDF is not supported/)).toBeTruthy());
    expect(screen.getByText("Say which")).toBeTruthy();
    // THE POINT: no registration, so no charged read of a spreadsheet printed
    // on paper. The file is stored and kept, and the dropdown is still open in
    // case the reading was wrong.
    expect(apiFetch.mock.calls.some((call) => String(call[0]) === "/api/imports")).toBe(false);
  });
});
