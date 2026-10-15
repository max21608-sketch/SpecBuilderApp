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
import { pdfBillRefusal } from "@/lib/pdf-bill-source";

const upload = vi.fn();
// The page count before upload (upload-check.ts) is stubbed: the component
// tier never loads pdfjs or a real PDF. Unknown means proceed.
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser: async () => null }));
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
// A DROPPED `.msg` — FIU 2026-09-21 (Coder D row 3).
//
// The route has refused one since Stage 2, before anything is recorded or
// dispatched. But `INTAKE_UPLOAD_ACCEPT` is the file PICKER's filter, which a
// file DROPPED on the zone never passes through, and `UPLOAD_CONTENT_TYPES`
// admits `application/vnd.ms-outlook` because a `.msg` is legitimate evidence
// on a change set — so the bytes landed under the project's own prefix and were
// refused afterwards. No charge and no run; a stray blob.
//
// This test drops it the way the browser does, so the picker's filter is not
// in the way of the thing being proved.
// ---------------------------------------------------------------------------
describe("an Outlook .msg is refused in the browser", () => {
  it("names the way out, and never reaches the store", () => {
    const { drop } = mount();
    drop("RE Fabric for S-201.msg");
    expect(screen.getByText("Cannot be read")).toBeTruthy();
    expect(screen.getByText(/save it as \.eml/)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("leaves a saved .eml alone, which is the format that works", () => {
    const { drop } = mount();
    drop("RE Fabric for S-201.eml");
    expect(screen.queryByText("Cannot be read")).toBeNull();
    expect(startButton()).not.toBeDisabled();
  });

  it("is not counted in what the press is about to read", () => {
    const { drop } = mount();
    drop("RE Fabric.msg", "Example drawings.pdf");
    expect(startButton().textContent).toBe("Start intake (1)");
  });
});

// ---------------------------------------------------------------------------
// ROW 8's SCREEN HALF, since C1 (2026-10-15): a bill inside a PDF is read by
// its text. Nothing in the browser can tell a PDF bill from a PDF drawing set,
// so both answers arrive from the classify call. Where the text is not a
// table, the row says so in ONE sentence with the detail behind "Why", keeps
// the file and registers NOTHING. Where it is, the row says how many lines it
// read and registers it as a bill — registration builds the workbook.
// ---------------------------------------------------------------------------
describe("a bill of quantities inside a PDF", () => {
  it("holds one whose text is not a table, in one sentence, and registers nothing", async () => {
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
            unsupported: pdfBillRefusal("no_quantity_column"),
            unsupportedDetail: "No page prints a header with one quantity column above a quantity.",
            evidence: "the first page is headed BILL OF QUANTITIES",
          },
        };
      }
      return { ok: false, status: 500, error: "nothing else should be called", data: null };
    });

    const { drop } = mount();
    drop("Example bill.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText(/This PDF bill could not be read: no quantity column was found/)).toBeTruthy());
    expect(screen.getByText("Say which")).toBeTruthy();
    // The detail is one click away, not instead of the sentence.
    expect(screen.getByText("Why")).toBeTruthy();
    expect(screen.getByText(/No page prints a header/)).toBeTruthy();
    // THE POINT: no registration. The file is stored and kept, and the
    // dropdown is still open in case the reading was wrong.
    expect(apiFetch.mock.calls.some((call) => String(call[0]) === "/api/imports")).toBe(false);
  });

  it("registers one whose text is a table as a bill, saying how many lines it read", async () => {
    upload.mockResolvedValue({ pathname: "projects/p1/uploads/bill.pdf" });
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
      if (url.includes("/classify")) {
        return {
          ok: true,
          status: 200,
          data: {
            genre: "bill_of_quantities",
            decision: { importType: "boq", documentKind: null },
            unsupported: null,
            evidence: "a schedule of line items with an ORDER QTY column",
            pdfBill: { lines: 28, pages: 3 },
          },
        };
      }
      if (url === "/api/imports") return { ok: true, status: 201, data: { importId: "r1" } };
      return { ok: false, status: 500, error: "unexpected", data: null };
    });

    const { drop } = mount();
    drop("Example schedule.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText("Added")).toBeTruthy());
    const registration = apiFetch.mock.calls.find((call) => String(call[0]) === "/api/imports");
    expect(registration).toBeTruthy();
    expect(JSON.parse(String((registration![1] as RequestInit).body))).toMatchObject({ importType: "boq", documentKind: null });
    expect(screen.getByText(/Its text reads as a table: 28 lines on 3 pages/)).toBeTruthy();
  });

  it("holds one the model called a schedule when its text is a bill's table, and registers nothing", async () => {
    upload.mockResolvedValue({ pathname: "projects/p1/uploads/schedule.pdf" });
    const held =
      "Read as an FF&E schedule, but its text is a table of 28 lines with a quantity on each: if it is the bill, choose Bill of quantities.";
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/classify")) {
        return {
          ok: true,
          status: 200,
          data: { genre: "ffe_schedule", decision: null, unsupported: null, held, evidence: "an FF&E specification" },
        };
      }
      return { ok: false, status: 500, error: "nothing else should be called", data: null };
    });

    const { drop } = mount();
    drop("Example schedule.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText(held)).toBeTruthy());
    expect(screen.getByText("Say which")).toBeTruthy();
    expect(apiFetch.mock.calls.some((call) => String(call[0]) === "/api/imports")).toBe(false);
  });

  it("holds a hand-declared PDF bill the registration could not read, with its kind cleared", async () => {
    upload.mockResolvedValue({ pathname: "projects/p1/uploads/bill.pdf" });
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
      if (url === "/api/imports") {
        return {
          ok: false,
          status: 400,
          error: pdfBillRefusal("no_rows"),
          data: { ok: false, error: pdfBillRefusal("no_rows"), detail: "The columns A | B | QTY were found, with nothing under them." },
        };
      }
      return { ok: false, status: 500, error: "unexpected", data: null };
    });

    const { drop, container } = mount();
    drop("Example bill.pdf");
    const select = container.querySelector("select") as HTMLSelectElement;
    await userEvent.selectOptions(select, "boq");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText(/This PDF bill could not be read: no line has a quantity/)).toBeTruthy());
    expect(screen.getByText("Say which")).toBeTruthy();
    expect(select.value).toBe("");
  });
});
